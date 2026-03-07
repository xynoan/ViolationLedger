#!/usr/bin/env python3
"""
Long-running detection worker: connects to RTSP stream, captures frames,
runs YOLO detection (models loaded once), outputs JSON per detection to stdout.
Used by Node.js detection_service for server-side frame capture (Option C).
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import cv2

# Import detection logic from yolo_detection_service (loads models once)
from yolo_detection_service import load_models, detect_frame

DETECTION_INTERVAL_SEC = 2.5


def main() -> int:
    parser = argparse.ArgumentParser(description="RTSP detection worker (long-running)")
    parser.add_argument("--camera-id", required=True, help="Camera ID for output")
    parser.add_argument("--rtsp-url", required=True, help="RTSP stream URL (e.g. rtsp://localhost:8554/cam1)")
    parser.add_argument("--interval", type=float, default=DETECTION_INTERVAL_SEC, help="Seconds between detections")
    parser.add_argument("--conf-vehicle", type=float, default=0.35, help="Vehicle detection confidence")
    parser.add_argument("--conf-plate", type=float, default=0.40, help="Plate detection confidence")
    args = parser.parse_args()

    print(f"[Worker {args.camera_id}] Connecting to {args.rtsp_url}...", file=sys.stderr)
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

    # Load models once at startup (keeps them in memory)
    vehicle_model, plate_model = load_models()
    print(f"[Worker {args.camera_id}] Models loaded, starting detection loop...", file=sys.stderr)

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
                        plate_model,
                        conf_vehicle=args.conf_vehicle,
                        conf_plate=args.conf_plate,
                    )
                    out = {
                        "cameraId": args.camera_id,
                        "vehicles": result["vehicles"],
                        "plates": result["plates"],
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
