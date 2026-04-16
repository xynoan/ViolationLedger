#!/usr/bin/env python3
"""
Long-running detection worker: connects to RTSP stream, captures frames,
runs YOLO vehicle detection, then Plate Recognizer for plate extraction.
Outputs JSON per detection to stdout, including vehicle class_name.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time

import cv2

from yolo_detection_service import load_models, detect_frame

def run_ocr(*_args, **_kwargs):
    """Disabled local OCR fallback."""
    return []

try:
    import requests
except Exception:
    requests = None

DETECTION_INTERVAL_SEC = 2.5
DEFAULT_CONF_VEHICLE = float(os.getenv("YOLO_VEHICLE_CONF", "0.35"))

CAPTURED_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "captured_images")
os.makedirs(CAPTURED_IMAGES_DIR, exist_ok=True) 

PLATERECOGNIZER_TOKEN = os.getenv("PLATERECOGNIZER_TOKEN") or os.getenv("PLATE_RECOGNIZER_TOKEN")
PLATERECOGNIZER_ENDPOINT = os.getenv("PLATERECOGNIZER_ENDPOINT", "https://api.platerecognizer.com/v1/plate-reader/")
PLATERECOGNIZER_TIMEOUT_SEC = float(os.getenv("PLATERECOGNIZER_TIMEOUT_SEC", "20"))
PLATERECOGNIZER_CONNECT_TIMEOUT_SEC = float(os.getenv("PLATERECOGNIZER_CONNECT_TIMEOUT_SEC", "5"))
PLATERECOGNIZER_JPEG_QUALITY = int(os.getenv("PLATERECOGNIZER_JPEG_QUALITY", "80"))
PLATERECOGNIZER_MAX_WIDTH = int(os.getenv("PLATERECOGNIZER_MAX_WIDTH", "1280"))
USE_PLATERECOGNIZER = (
    os.getenv("USE_PLATERECOGNIZER", "1").strip().lower() not in ("0", "false", "no")
    and bool(PLATERECOGNIZER_TOKEN)
    and requests is not None
)

DISABLE_GEMINI_RTSP = os.getenv("DISABLE_GEMINI_RTSP", "1").strip().lower() not in ("0", "false", "no")

if not DISABLE_GEMINI_RTSP:
    try:
        from PIL import Image
        from ai_service import extract_plates_from_image
    except Exception:
        extract_plates_from_image = None
else:
    extract_plates_from_image = None

# Map YOLO class IDs to human-readable names
CLASS_LABELS = ["person", "bicycle", "car", "motorbike", "bus", "truck"]

def main() -> int:
    parser = argparse.ArgumentParser(description="RTSP detection worker (long-running)")
    parser.add_argument("--camera-id", required=True, help="Camera ID for output")
    parser.add_argument("--rtsp-url", required=True, help="RTSP stream URL")
    parser.add_argument("--interval", type=float, default=DETECTION_INTERVAL_SEC, help="Seconds between detections")
    parser.add_argument("--conf-vehicle", type=float, default=DEFAULT_CONF_VEHICLE, help="Vehicle confidence threshold")
    args = parser.parse_args()

    print(f"[Worker {args.camera_id}] Connecting to {args.rtsp_url}...", file=sys.stderr)

    if "OPENCV_FFMPEG_CAPTURE_OPTIONS" not in os.environ:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp"

    cap = cv2.VideoCapture(args.rtsp_url)
    if not cap.isOpened():
        print(json.dumps({
            "cameraId": args.camera_id,
            "vehicles": [],
            "plates": [],
            "error": f"Failed to open RTSP stream: {args.rtsp_url}",
        }, ensure_ascii=False), flush=True)
        return 1

    vehicle_model = load_models()
    print(f"[Worker {args.camera_id}] Model loaded, starting detection loop...", file=sys.stderr)

    last_detect = 0.0
    frame_count = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                cap.release()
                time.sleep(2)
                cap = cv2.VideoCapture(args.rtsp_url)
                last_detect = 0.0
                continue

            now = time.time()
            if now - last_detect >= args.interval:
                last_detect = now
                frame_count += 1

                try:
                    result = detect_frame(frame, vehicle_model, conf_vehicle=args.conf_vehicle)
                    vehicles = result.get("vehicles", [])
                    plates_out = []

                    h, w = frame.shape[:2]
                    timestamp_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
                    ts_id = timestamp_str.replace("-", "").replace(":", "").replace("T", "").replace("Z", "")
                    image_filename = None

                    # Save frame if vehicles detected
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

                        # Map YOLO class_id to class_name
                        for v in vehicles:
                            v["class_name"] = v.get("class_name") or CLASS_LABELS[v.get("class_id", 2)]

                        # Plate Recognizer API
                        if USE_PLATERECOGNIZER:
                            try:
                                upload_frame = frame
                                if PLATERECOGNIZER_MAX_WIDTH > 0 and w > PLATERECOGNIZER_MAX_WIDTH:
                                    scale = PLATERECOGNIZER_MAX_WIDTH / w
                                    upload_frame = cv2.resize(frame, (int(w*scale), int(h*scale)))
                                ok, encoded = cv2.imencode(".jpg", upload_frame, [int(cv2.IMWRITE_JPEG_QUALITY), PLATERECOGNIZER_JPEG_QUALITY])
                                if ok:
                                    img_bytes = encoded.tobytes()
                                    headers = {"Authorization": f"Token {PLATERECOGNIZER_TOKEN}"}
                                    files = {"upload": ("frame.jpg", img_bytes, "image/jpeg")}
                                    data = {"camera_id": str(args.camera_id)}
                                    resp = requests.post(PLATERECOGNIZER_ENDPOINT, headers=headers, files=files, data=data,
                                                         timeout=(PLATERECOGNIZER_CONNECT_TIMEOUT_SEC, PLATERECOGNIZER_TIMEOUT_SEC))
                                    resp.raise_for_status()
                                    payload = resp.json()
                                    for r in payload.get("results", []):
                                        plate = (r.get("plate") or "").upper()
                                        score = float(r.get("score", 0))
                                        box = r.get("box", {})
                                        plates_out.append({
                                            "plateNumber": plate,
                                            "bbox": [round(box.get("x1",0),2), round(box.get("y1",0),2),
                                                     round(box.get("x2",0),2), round(box.get("y2",0),2)],
                                            "class_name": "plate",
                                            "confidence": round(score,3),
                                        })
                            except Exception as e:
                                print(f"[PlateRecognizer] Error: {e}", file=sys.stderr)

                        # Fallback OCR
                        if not plates_out:
                            try:
                                frame_rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                            except Exception:
                                frame_rgb = frame
                            try:
                                plates = run_ocr(frame_rgb, w, h) or []
                            except Exception as e:
                                print(f"[ALPR] Local OCR error: {e}", file=sys.stderr)
                                plates = []

                            for p in plates:
                                bbox_norm = p.get("bbox", [0,0,0,0])
                                nx, ny, nw, nh = map(float, bbox_norm)
                                plates_out.append({
                                    "plateNumber": (p.get("plateNumber") or "UNKNOWN").upper(),
                                    "bbox": [round(nx*w,2), round(ny*h,2), round((nx+nw)*w,2), round((ny+nh)*h,2)],
                                    "class_name": p.get("class_name") or "plate",
                                    "confidence": round(float(p.get("confidence",0)),3),
                                })

                        # If still no plates, register vehicle as plate-less
                        if not plates_out:
                            plates_out = [{
                                "plateNumber": "",
                                "bbox": None,
                                "class_name": v.get("class_name") or "vehicle",
                                "confidence": 0.0
                            } for v in vehicles]

                    else:
                        # No vehicles detected, create empty placeholder
                        plates_out = []

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
                    print(json.dumps({
                        "cameraId": args.camera_id,
                        "vehicles": [],
                        "plates": [],
                        "error": str(e),
                    }, ensure_ascii=False), flush=True)

            time.sleep(0.05)

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        print(f"[Worker {args.camera_id}] Stopped.", file=sys.stderr)

    return 0


if __name__ == "__main__":
    sys.exit(main())