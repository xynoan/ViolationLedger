#!/usr/bin/env python3
"""
Long-running detection worker: connects to RTSP stream, captures frames,
runs YOLO vehicle detection, then Gemini for plate extraction when vehicles detected.
Outputs JSON per detection to stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import cv2

from yolo_detection_service import load_models, detect_frame
from ocr_only import run_ocr

try:
    import requests  # For Plate Recognizer Snapshot Cloud
except Exception:
    requests = None  # type: ignore

DETECTION_INTERVAL_SEC = 2.5
DEFAULT_CONF_VEHICLE = float(os.getenv("YOLO_VEHICLE_CONF", "0.35"))

# Directory where captured JPEG frames are stored so the Node.js server
# can serve them from /captured_images (shared with captures.js).
CAPTURED_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "captured_images")
os.makedirs(CAPTURED_IMAGES_DIR, exist_ok=True)

# Plate Recognizer Snapshot Cloud configuration.
# If PLATERECOGNIZER_TOKEN is set and USE_PLATERECOGNIZER is truthy (default),
# frames will be sent to Snapshot Cloud for ALPR before falling back to local OCR.
PLATERECOGNIZER_TOKEN = os.getenv("PLATERECOGNIZER_TOKEN") or os.getenv("PLATE_RECOGNIZER_TOKEN")
PLATERECOGNIZER_ENDPOINT = os.getenv(
    "PLATERECOGNIZER_ENDPOINT",
    "https://api.platerecognizer.com/v1/plate-reader/",
)
USE_PLATERECOGNIZER = (
    os.getenv("USE_PLATERECOGNIZER", "1").strip().lower() not in ("0", "false", "no")
    and bool(PLATERECOGNIZER_TOKEN)
    and requests is not None
)

# By default, disable Gemini for RTSP ALPR and use local OCR-only or Plate Recognizer instead.
# Set DISABLE_GEMINI_RTSP=0 (or false) if you explicitly want to re-enable Gemini here.
DISABLE_GEMINI_RTSP = os.getenv("DISABLE_GEMINI_RTSP", "1").strip().lower() not in ("0", "false", "no")

if not DISABLE_GEMINI_RTSP:
    try:
        from PIL import Image
        from ai_service import extract_plates_from_image  # type: ignore
    except Exception:
        extract_plates_from_image = None  # type: ignore
else:
    extract_plates_from_image = None  # type: ignore


def main() -> int:
    parser = argparse.ArgumentParser(description="RTSP detection worker (long-running)")
    parser.add_argument("--camera-id", required=True, help="Camera ID for output")
    parser.add_argument("--rtsp-url", required=True, help="RTSP stream URL (e.g. rtsp://localhost:8554/cam1)")
    parser.add_argument("--interval", type=float, default=DETECTION_INTERVAL_SEC, help="Seconds between detections")
    parser.add_argument(
        "--conf-vehicle",
        type=float,
        default=DEFAULT_CONF_VEHICLE,
        help="Vehicle detection confidence (overrides with YOLO_VEHICLE_CONF env if set)",
    )
    args = parser.parse_args()

    print(f"[Worker {args.camera_id}] Connecting to {args.rtsp_url}...", file=sys.stderr)

    if "OPENCV_FFMPEG_CAPTURE_OPTIONS" not in os.environ:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

    cap = cv2.VideoCapture(args.rtsp_url)

    if not cap.isOpened():
        err = json.dumps({
            "cameraId": args.camera_id,
            "vehicles": [],
            "plates": [],
            "error": f"Failed to open RTSP stream: {args.rtsp_url}",
        }, ensure_ascii=False)
        print(err, flush=True)
        return 1

    # Load vehicle model once at startup
    vehicle_model = load_models()
    print(f"[Worker {args.camera_id}] Model loaded, starting detection loop...", file=sys.stderr)

    last_detect = 0.0
    frame_count = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                # Reconnect on read failure
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(args.rtsp_url)
                if not cap.isOpened():
                    err = json.dumps({
                        "cameraId": args.camera_id,
                        "vehicles": [],
                        "plates": [],
                        "error": "Stream disconnected, reconnect failed",
                    }, ensure_ascii=False)
                    print(err, flush=True)
                    continue
                last_detect = 0.0
                continue

            now = time.time()
            if now - last_detect >= args.interval:
                last_detect = now
                frame_count += 1
                try:
                    result = detect_frame(
                        frame,
                        vehicle_model,
                        conf_vehicle=args.conf_vehicle,
                    )
                    vehicles = result["vehicles"]
                    plates_out = []

                    # Derive a stable timestamp string for this detection cycle.
                    timestamp_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
                    ts_id = timestamp_str.replace("-", "").replace(":", "").replace("T", "").replace("Z", "")
                    image_filename = None

                    # If we detected any vehicles, save the current frame as a JPEG
                    # so the dashboard can show a still image for this detection.
                    if vehicles:
                        try:
                            ok, encoded = cv2.imencode(".jpg", frame)
                            if ok:
                                image_filename = f"capture-{args.camera_id}-{ts_id}.jpg"
                                filepath = os.path.join(CAPTURED_IMAGES_DIR, image_filename)
                                with open(filepath, "wb") as f:
                                    f.write(encoded.tobytes())
                        except Exception as e:
                            print(f"[Worker {args.camera_id}] Failed to save capture frame: {e}", file=sys.stderr)

                        h, w = frame.shape[:2]

                        # First choice: Plate Recognizer Snapshot Cloud if configured.
                        if USE_PLATERECOGNIZER:
                            try:
                                ok, encoded = cv2.imencode(".jpg", frame)
                                if ok:
                                    img_bytes = encoded.tobytes()
                                    headers = {
                                        "Authorization": f"Token {PLATERECOGNIZER_TOKEN}",
                                    }
                                    files = {
                                        "upload": ("frame.jpg", img_bytes, "image/jpeg"),
                                    }
                                    data = {
                                        "camera_id": str(args.camera_id),
                                    }
                                    resp = requests.post(
                                        PLATERECOGNIZER_ENDPOINT,
                                        headers=headers,
                                        files=files,
                                        data=data,
                                        timeout=5,
                                    )
                                    resp.raise_for_status()
                                    payload = resp.json()
                                    results = payload.get("results") or []
                                    for r in results:
                                        plate = (r.get("plate") or "").upper()
                                        score = float(r.get("score") or 0.0)
                                        box = r.get("box") or {}
                                        x1 = float(box.get("x1", 0.0))
                                        y1 = float(box.get("y1", 0.0))
                                        x2 = float(box.get("x2", 0.0))
                                        y2 = float(box.get("y2", 0.0))
                                        if plate:
                                            plates_out.append({
                                                "plateNumber": plate,
                                                "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                                                "class_name": "plate",
                                                "confidence": round(score, 3),
                                            })
                                    if plates_out:
                                        print(f"[PlateRecognizer] Plates detected: {[p['plateNumber'] for p in plates_out]}", file=sys.stderr)
                            except Exception as e:
                                print(f"[PlateRecognizer] Error: {e}", file=sys.stderr)

                        # Fallback: local OCR-only ALPR pipeline (ocr_only.run_ocr)
                        if not plates_out:
                            try:
                                # Convert BGR (OpenCV) to RGB to match ocr_only expectations.
                                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                            except Exception:
                                frame_rgb = frame

                            try:
                                plates = run_ocr(frame_rgb, w, h) or []
                            except Exception as e:
                                print(f"[ALPR] Local OCR error: {e}", file=sys.stderr)
                                plates = []

                            # Convert normalized [x, y, w, h] bboxes to absolute [x1, y1, x2, y2] pixels
                            # to match frontend expectations in useDetectionStream/VideoPlayer.
                            for p in plates:
                                bbox_norm = p.get("bbox") or [0.0, 0.0, 0.0, 0.0]
                                try:
                                    nx, ny, nw, nh = map(float, bbox_norm)
                                except Exception:
                                    nx, ny, nw, nh = 0.0, 0.0, 0.0, 0.0
                                x1 = nx * w
                                y1 = ny * h
                                x2 = (nx + nw) * w
                                y2 = (ny + nh) * h
                                plate_number = p.get("plateNumber", "UNKNOWN")
                                conf = float(p.get("confidence") or 0.0)
                                class_name = p.get("class_name") or "plate"
                                plates_out.append({
                                    "plateNumber": plate_number,
                                    "bbox": [round(x1, 2), round(y1, 2), round(x2, 2), round(y2, 2)],
                                    "class_name": class_name,
                                    "confidence": round(conf, 3),
                                })

                        # Optional Gemini path (disabled by default via DISABLE_GEMINI_RTSP).
                        if not plates_out and not DISABLE_GEMINI_RTSP and extract_plates_from_image is not None:
                            try:
                                pil_image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                                plate_numbers = extract_plates_from_image(pil_image)
                                if plate_numbers:
                                    print(f"[Gemini] Plates detected: {plate_numbers}", file=sys.stderr)
                                plates_out = [
                                    {"plateNumber": p, "bbox": None, "class_name": "plate", "confidence": 0.0}
                                    for p in plate_numbers
                                ]
                            except Exception as e:
                                print(f"[Gemini] Plate extraction error: {e}", file=sys.stderr)

                    out = {
                        "cameraId": args.camera_id,
                        "vehicles": vehicles,
                        "plates": plates_out,
                        "timestamp": timestamp_str,
                        "frameIndex": frame_count,
                        "imageUrl": image_filename,
                    }
                    print(json.dumps(out, ensure_ascii=False), flush=True)
                except Exception as e:
                    err = json.dumps({
                        "cameraId": args.camera_id,
                        "vehicles": [],
                        "plates": [],
                        "error": str(e),
                    }, ensure_ascii=False)
                    print(err, flush=True)

            time.sleep(0.05)  # Small sleep to avoid busy loop

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        print(f"[Worker {args.camera_id}] Stopped.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())
