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
from PIL import Image

from yolo_detection_service import load_models, detect_frame
from ai_service import extract_plates_from_image

DETECTION_INTERVAL_SEC = 2.5
DEFAULT_CONF_VEHICLE = float(os.getenv("YOLO_VEHICLE_CONF", "0.35"))


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

                    # Only call Gemini when YOLO detects vehicles (saves API usage)
                    if vehicles:
                        pil_image = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                        plate_numbers = extract_plates_from_image(pil_image)
                        if plate_numbers:
                            print(f"[Gemini] Plates detected: {plate_numbers}", file=sys.stderr)
                        plates_out = [
                            {"plateNumber": p, "bbox": None, "class_name": "plate", "confidence": 0.0}
                            for p in plate_numbers
                        ]

                    out = {
                        "cameraId": args.camera_id,
                        "vehicles": vehicles,
                        "plates": plates_out,
                        "timestamp": now,
                        "frameIndex": frame_count,
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
