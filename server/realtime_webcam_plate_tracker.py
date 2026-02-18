#!/usr/bin/env python3
"""
Real-time webcam vehicle tracking + license plate OCR (console output).

Pipeline (inspired by YOLO+SORT examples):
- Detect vehicles (COCO YOLOv8) for classes: car, motorbike, bus, truck
- Track vehicles with persistent IDs (Ultralytics built-in tracking; stateful in this process)
- Detect license plates (your Philippines plate model: server/models/weights/best.pt)
- Assign each plate to a tracked vehicle
- Crop plate -> preprocess (grayscale + fixed threshold INV) -> OCR (EasyOCR/Tesseract helpers reused)
- Console-log JSON results

Run:
  python server/realtime_webcam_plate_tracker.py --source 0

Notes:
- Ultralytics requires a working PyTorch install.
- EasyOCR is heavy on first run; pytesseract also requires the Tesseract binary installed and on PATH.
- Press 'q' to quit if you run with --show.
"""

from __future__ import annotations

import argparse
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

# PyTorch 2.6+ defaults to weights_only=True; Ultralytics YOLO .pt files require weights_only=False
import torch
_orig_load = torch.load
def _torch_load(*args, **kwargs):
    kwargs.setdefault("weights_only", False)
    return _orig_load(*args, **kwargs)
torch.load = _torch_load

import cv2
import numpy as np

try:
    from ultralytics import YOLO
except Exception as e:  # pragma: no cover
    raise RuntimeError(
        "Ultralytics is required. Install with: pip install ultralytics (and torch).\n"
        f"Import error: {e}"
    )


# Reuse OCR logic from existing service (EasyOCR + Tesseract + cleanup/corrections).
try:
    from ocr_only import run_ocr_on_crop  # type: ignore
except Exception as e:  # pragma: no cover
    raise RuntimeError(
        "Could not import OCR helpers from server/ocr_only.py. "
        "Run this script from the repo root or from the server/ directory.\n"
        f"Import error: {e}"
    )


COCO_VEHICLE_DEFAULT = (2, 3, 5, 7)  # car, motorbike, bus, truck


@dataclass(frozen=True)
class TrackedVehicle:
    track_id: int
    cls_id: int
    conf: float
    xyxy: Tuple[float, float, float, float]


@dataclass(frozen=True)
class PlateDetection:
    conf: float
    xyxy: Tuple[float, float, float, float]


def _parse_int_list(csv: str) -> List[int]:
    out: List[int] = []
    for part in (csv or "").split(","):
        part = part.strip()
        if not part:
            continue
        out.append(int(part))
    return out


def iou_xyxy(a: Sequence[float], b: Sequence[float]) -> float:
    ax1, ay1, ax2, ay2 = a
    bx1, by1, bx2, by2 = b
    inter_x1 = max(ax1, bx1)
    inter_y1 = max(ay1, by1)
    inter_x2 = min(ax2, bx2)
    inter_y2 = min(ay2, by2)
    inter_w = max(0.0, inter_x2 - inter_x1)
    inter_h = max(0.0, inter_y2 - inter_y1)
    inter_area = inter_w * inter_h
    if inter_area <= 0:
        return 0.0
    area_a = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1)
    area_b = max(0.0, bx2 - bx1) * max(0.0, by2 - by1)
    union = area_a + area_b - inter_area
    return float(inter_area / union) if union > 0 else 0.0


def center_inside(box_xyxy: Sequence[float], container_xyxy: Sequence[float]) -> bool:
    x1, y1, x2, y2 = box_xyxy
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    vx1, vy1, vx2, vy2 = container_xyxy
    return (vx1 <= cx <= vx2) and (vy1 <= cy <= vy2)


def assign_plate_to_vehicle(
    plate_xyxy: Sequence[float],
    vehicles: Sequence[TrackedVehicle],
) -> Optional[TrackedVehicle]:
    if not vehicles:
        return None

    inside = [v for v in vehicles if center_inside(plate_xyxy, v.xyxy)]
    candidates = inside if inside else list(vehicles)
    best = None
    best_score = 0.0
    for v in candidates:
        score = iou_xyxy(plate_xyxy, v.xyxy)
        if score > best_score:
            best_score = score
            best = v
    if best is None:
        return None
    # If the plate isn't even inside any vehicle, require some overlap to avoid random assignment.
    if not inside and best_score <= 0.0:
        return None
    return best


def _boxes_from_ultralytics_track(result) -> List[TrackedVehicle]:
    """
    Extract tracked vehicle boxes from a single Ultralytics result.
    Expects result.boxes.xyxy and result.boxes.id to exist (id is from tracker).
    """
    if result is None or getattr(result, "boxes", None) is None:
        return []
    boxes = result.boxes
    if getattr(boxes, "xyxy", None) is None or getattr(boxes, "id", None) is None:
        return []

    xyxy = boxes.xyxy
    ids = boxes.id
    conf = getattr(boxes, "conf", None)
    cls = getattr(boxes, "cls", None)

    xyxy_np = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.asarray(xyxy)
    ids_np = ids.cpu().numpy() if hasattr(ids, "cpu") else np.asarray(ids)
    conf_np = conf.cpu().numpy() if (conf is not None and hasattr(conf, "cpu")) else (np.asarray(conf) if conf is not None else None)
    cls_np = cls.cpu().numpy() if (cls is not None and hasattr(cls, "cpu")) else (np.asarray(cls) if cls is not None else None)

    out: List[TrackedVehicle] = []
    for i in range(len(xyxy_np)):
        x1, y1, x2, y2 = map(float, xyxy_np[i])
        track_id = int(ids_np[i])
        c = float(conf_np[i]) if conf_np is not None else 0.0
        k = int(cls_np[i]) if cls_np is not None else -1
        out.append(TrackedVehicle(track_id=track_id, cls_id=k, conf=c, xyxy=(x1, y1, x2, y2)))
    return out


def _plates_from_ultralytics_predict(result) -> List[PlateDetection]:
    if result is None or getattr(result, "boxes", None) is None:
        return []
    boxes = result.boxes
    if getattr(boxes, "xyxy", None) is None:
        return []
    xyxy = boxes.xyxy
    conf = getattr(boxes, "conf", None)
    xyxy_np = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.asarray(xyxy)
    conf_np = conf.cpu().numpy() if (conf is not None and hasattr(conf, "cpu")) else (np.asarray(conf) if conf is not None else None)

    out: List[PlateDetection] = []
    for i in range(len(xyxy_np)):
        x1, y1, x2, y2 = map(float, xyxy_np[i])
        c = float(conf_np[i]) if conf_np is not None else 0.0
        out.append(PlateDetection(conf=c, xyxy=(x1, y1, x2, y2)))
    return out


def clamp_xyxy(x1: float, y1: float, x2: float, y2: float, w: int, h: int) -> Tuple[int, int, int, int]:
    ix1 = max(0, min(w - 1, int(x1)))
    iy1 = max(0, min(h - 1, int(y1)))
    ix2 = max(0, min(w, int(x2)))
    iy2 = max(0, min(h, int(y2)))
    if ix2 <= ix1:
        ix2 = min(w, ix1 + 1)
    if iy2 <= iy1:
        iy2 = min(h, iy1 + 1)
    return ix1, iy1, ix2, iy2


def preprocess_plate_crop_threshold_inv(bgr_crop: np.ndarray) -> np.ndarray:
    """As requested: gray -> fixed threshold -> binary inverse."""
    gray = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 64, 255, cv2.THRESH_BINARY_INV)
    return thresh


def main() -> int:
    parser = argparse.ArgumentParser(description="Real-time webcam plate OCR with vehicle tracking.")
    parser.add_argument("--source", default="0", help="Webcam index (0,1,2,...) or video file path.")
    parser.add_argument("--vehicle-model", default="yolov8n.pt", help="COCO vehicle model path/name.")
    parser.add_argument(
        "--plate-model",
        default=str((Path(__file__).resolve().parent / "models" / "weights" / "license_detection.pt")),
        help="License plate YOLO model path (Philippines).",
    )
    parser.add_argument("--vehicle-classes", default="2,3,5,7", help="COCO class IDs to track (csv).")
    parser.add_argument("--conf-vehicle", type=float, default=0.35, help="Vehicle detect confidence.")
    parser.add_argument("--conf-plate", type=float, default=0.40, help="Plate detect confidence.")
    parser.add_argument("--ocr-every-n", type=int, default=12, help="Run OCR at most every N frames per track.")
    parser.add_argument("--show", action="store_true", help="Show debug window with boxes.")
    args = parser.parse_args()

    vehicle_classes = _parse_int_list(args.vehicle_classes) or list(COCO_VEHICLE_DEFAULT)

    # Source can be an int webcam index or a string file path.
    source: object
    if isinstance(args.source, str) and args.source.isdigit():
        source = int(args.source)
    else:
        source = args.source

    vehicle_model = YOLO(args.vehicle_model)
    plate_model = YOLO(args.plate_model)

    cap = cv2.VideoCapture(source)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open source: {args.source}")

    track_state: Dict[int, Dict[str, object]] = {}
    frame_idx = -1
    last_fps_time = time.time()
    fps_frames = 0

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                break
            frame_idx += 1
            h, w = frame.shape[:2]

            # 1) Vehicle detect+track (persistent IDs in-process).
            # Ultralytics uses ByteTrack/BOT-SORT internally. persist=True keeps state across calls.
            track_results = vehicle_model.track(
                frame,
                persist=True,
                classes=vehicle_classes,
                conf=float(args.conf_vehicle),
                verbose=False,
            )
            tracked: List[TrackedVehicle] = _boxes_from_ultralytics_track(track_results[0] if track_results else None)

            # 2) Plate detection.
            plate_results = plate_model.predict(frame, conf=float(args.conf_plate), verbose=False)
            plates: List[PlateDetection] = _plates_from_ultralytics_predict(plate_results[0] if plate_results else None)

            # 3) Assign plates to vehicles, crop, preprocess, OCR, log.
            for p in plates:
                vehicle = assign_plate_to_vehicle(p.xyxy, tracked)
                if vehicle is None:
                    continue

                state = track_state.setdefault(vehicle.track_id, {"last_ocr_frame": -10**9, "last_plate": None})
                last_ocr_frame = int(state.get("last_ocr_frame", -10**9))
                if frame_idx - last_ocr_frame < int(args.ocr_every_n):
                    continue

                x1, y1, x2, y2 = p.xyxy
                ix1, iy1, ix2, iy2 = clamp_xyxy(x1, y1, x2, y2, w, h)
                crop = frame[iy1:iy2, ix1:ix2]
                if crop.size == 0:
                    continue

                thresh = preprocess_plate_crop_threshold_inv(crop)

                # OCR attempt 1: thresholded image (requested preprocessing)
                ocr = run_ocr_on_crop(thresh)
                # OCR attempt 2 (fallback): original crop but in RGB (ocr_only assumes RGB when converting)
                if ocr is None:
                    rgb_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                    ocr = run_ocr_on_crop(rgb_crop)

                state["last_ocr_frame"] = frame_idx

                if ocr is None:
                    continue
                plate_text, ocr_conf = ocr

                prev_plate = state.get("last_plate")
                if isinstance(prev_plate, str) and prev_plate == plate_text:
                    # Avoid spamming identical logs for the same track.
                    continue
                state["last_plate"] = plate_text

                payload = {
                    "frame": frame_idx,
                    "track_id": vehicle.track_id,
                    "vehicle_class": vehicle.cls_id,
                    "vehicle_conf": round(vehicle.conf, 4),
                    "vehicle_bbox_xyxy": [round(v, 2) for v in vehicle.xyxy],
                    "plate_bbox_xyxy": [round(v, 2) for v in p.xyxy],
                    "plate_bbox_conf": round(p.conf, 4),
                    "plate": plate_text,
                    "ocr_conf": float(ocr_conf),
                }
                print(json.dumps(payload, ensure_ascii=False))

            # Optional debug view
            if args.show:
                dbg = frame.copy()
                for v in tracked:
                    x1, y1, x2, y2 = map(int, v.xyxy)
                    cv2.rectangle(dbg, (x1, y1), (x2, y2), (255, 200, 0), 2)
                    cv2.putText(
                        dbg,
                        f"id={v.track_id}",
                        (x1, max(0, y1 - 8)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.6,
                        (255, 200, 0),
                        2,
                        cv2.LINE_AA,
                    )
                for p in plates:
                    x1, y1, x2, y2 = map(int, p.xyxy)
                    cv2.rectangle(dbg, (x1, y1), (x2, y2), (200, 0, 255), 2)
                cv2.imshow("realtime_webcam_plate_tracker", dbg)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

            # Cheap FPS meter
            fps_frames += 1
            now = time.time()
            if now - last_fps_time >= 2.0:
                fps = fps_frames / (now - last_fps_time)
                fps_frames = 0
                last_fps_time = now
                # stderr would be cleaner, but keep simple.
                # print(json.dumps({"fps": round(fps, 2)}))

    finally:
        cap.release()
        if args.show:
            cv2.destroyAllWindows()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

