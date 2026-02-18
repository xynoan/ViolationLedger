#!/usr/bin/env python3
"""
YOLO detection service for vehicle + license plate detection.
Accepts base64 image, runs yolov8n.pt (vehicles) + license_detection.pt (plates),
assigns plates to vehicles, runs OCR on plate crops, logs plate results.
Outputs JSON to stdout for API consumption.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

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
except Exception as e:
    print(json.dumps({"vehicles": [], "plates": [], "error": f"Ultralytics required: {e}"}), file=sys.stderr)
    sys.exit(1)

try:
    from ocr_only import run_ocr_on_crop
except Exception as e:
    print(json.dumps({"vehicles": [], "plates": [], "error": f"ocr_only import failed: {e}"}), file=sys.stderr)
    sys.exit(1)


COCO_VEHICLE_CLASSES = (2, 3, 5, 7)  # car, motorbike, bus, truck
COCO_CLASS_NAMES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

WEIGHTS_DIR = Path(__file__).resolve().parent / "models" / "weights"
VEHICLE_MODEL_PATH = WEIGHTS_DIR / "yolov8n.pt"
PLATE_MODEL_PATH = WEIGHTS_DIR / "license_detection.pt"


@dataclass(frozen=True)
class VehicleBox:
    """Vehicle box for plate assignment (track_id used as index for single-frame)."""
    track_id: int
    cls_id: int
    conf: float
    xyxy: Tuple[float, float, float, float]


@dataclass(frozen=True)
class PlateBox:
    conf: float
    xyxy: Tuple[float, float, float, float]


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
    vehicles: Sequence[VehicleBox],
) -> Optional[VehicleBox]:
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
    if not inside and best_score <= 0.0:
        return None
    return best


def _vehicles_from_ultralytics_predict(result) -> List[VehicleBox]:
    """Extract vehicle boxes from Ultralytics predict result (no tracking)."""
    if result is None or getattr(result, "boxes", None) is None:
        return []
    boxes = result.boxes
    if getattr(boxes, "xyxy", None) is None:
        return []
    xyxy = boxes.xyxy
    conf = getattr(boxes, "conf", None)
    cls_ = getattr(boxes, "cls", None)
    xyxy_np = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.asarray(xyxy)
    conf_np = conf.cpu().numpy() if (conf is not None and hasattr(conf, "cpu")) else (np.asarray(conf) if conf is not None else None)
    cls_np = cls_.cpu().numpy() if (cls_ is not None and hasattr(cls_, "cpu")) else (np.asarray(cls_) if cls_ is not None else None)

    out: List[VehicleBox] = []
    for i in range(len(xyxy_np)):
        x1, y1, x2, y2 = map(float, xyxy_np[i])
        c = float(conf_np[i]) if conf_np is not None else 0.0
        k = int(cls_np[i]) if cls_np is not None else -1
        out.append(VehicleBox(track_id=i, cls_id=k, conf=c, xyxy=(x1, y1, x2, y2)))
    return out


def _plates_from_ultralytics_predict(result) -> List[PlateBox]:
    if result is None or getattr(result, "boxes", None) is None:
        return []
    boxes = result.boxes
    if getattr(boxes, "xyxy", None) is None:
        return []
    xyxy = boxes.xyxy
    conf = getattr(boxes, "conf", None)
    xyxy_np = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.asarray(xyxy)
    conf_np = conf.cpu().numpy() if (conf is not None and hasattr(conf, "cpu")) else (np.asarray(conf) if conf is not None else None)

    out: List[PlateBox] = []
    for i in range(len(xyxy_np)):
        x1, y1, x2, y2 = map(float, xyxy_np[i])
        c = float(conf_np[i]) if conf_np is not None else 0.0
        out.append(PlateBox(conf=c, xyxy=(x1, y1, x2, y2)))
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
    gray = cv2.cvtColor(bgr_crop, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 64, 255, cv2.THRESH_BINARY_INV)
    return thresh


def main() -> int:
    parser = argparse.ArgumentParser(description="YOLO vehicle + plate detection service.")
    parser.add_argument("--base64-file", required=True, help="Path to file containing base64 image data.")
    parser.add_argument("--conf-vehicle", type=float, default=0.35, help="Vehicle detection confidence.")
    parser.add_argument("--conf-plate", type=float, default=0.40, help="Plate detection confidence.")
    args = parser.parse_args()

    try:
        with open(args.base64_file, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        if "," in raw:
            raw = raw.split(",", 1)[1]
        img_data = base64.b64decode(raw)
        nparr = np.frombuffer(img_data, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None:
            print(json.dumps({"vehicles": [], "plates": [], "error": "Failed to decode image"}))
            return 1
    except Exception as e:
        print(json.dumps({"vehicles": [], "plates": [], "error": str(e)}))
        return 1

    h, w = frame.shape[:2]
    vehicle_path = str(VEHICLE_MODEL_PATH) if VEHICLE_MODEL_PATH.exists() else "yolov8n.pt"
    plate_path = str(PLATE_MODEL_PATH)

    vehicle_model = YOLO(vehicle_path)
    plate_model = YOLO(plate_path)

    # 1) Vehicle detection
    vehicle_results = vehicle_model.predict(
        frame,
        classes=list(COCO_VEHICLE_CLASSES),
        conf=float(args.conf_vehicle),
        verbose=False,
    )
    vehicles = _vehicles_from_ultralytics_predict(vehicle_results[0] if vehicle_results else None)

    # 2) Plate detection
    plate_results = plate_model.predict(frame, conf=float(args.conf_plate), verbose=False)
    plates = _plates_from_ultralytics_predict(plate_results[0] if plate_results else None)

    # Build output
    vehicles_out = []
    for v in vehicles:
        class_name = COCO_CLASS_NAMES.get(v.cls_id, "vehicle")
        vehicles_out.append({
            "bbox": [round(x, 2) for x in v.xyxy],
            "class_name": class_name,
            "confidence": round(v.conf, 4),
        })

    plates_out = []
    for p in plates:
        plate_obj: dict = {
            "bbox": [round(x, 2) for x in p.xyxy],
            "class_name": "plate",
            "confidence": round(p.conf, 4),
        }

        vehicle = assign_plate_to_vehicle(p.xyxy, vehicles)
        if vehicle is not None:
            x1, y1, x2, y2 = p.xyxy
            ix1, iy1, ix2, iy2 = clamp_xyxy(x1, y1, x2, y2, w, h)
            crop = frame[iy1:iy2, ix1:ix2]
            if crop.size > 0:
                thresh = preprocess_plate_crop_threshold_inv(crop)
                ocr = run_ocr_on_crop(thresh)
                if ocr is None:
                    rgb_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                    ocr = run_ocr_on_crop(rgb_crop)
                if ocr is not None:
                    plate_text, ocr_conf = ocr
                    plate_obj["plateNumber"] = plate_text
                    plate_obj["ocrConf"] = round(ocr_conf, 3)
                    print(f"[YOLO] Plate detected: {plate_text}", file=sys.stderr)

        plates_out.append(plate_obj)

    result = {"vehicles": vehicles_out, "plates": plates_out}
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
