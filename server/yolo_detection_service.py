#!/usr/bin/env python3
"""
YOLO detection service for vehicle detection only.
Accepts base64 image, runs yolov8n.pt (vehicles). Plate extraction is done via Gemini
when vehicles are detected (see detection_worker.py).
Outputs JSON to stdout for API consumption.
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import List, Tuple

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

# Work around pandas/numpy binary issues inside Ultralytics export_formats()
# which is called from AutoBackend._model_type() even for simple inference.
# On some environments this raises "numpy.dtype size changed" from pandas,
# breaking inference entirely. We don't need export functionality here, so we
# monkeypatch export_formats to a lightweight stub.
try:  # pragma: no cover - defensive environment-specific patch
    from ultralytics.nn import autobackend as _ultra_autobackend

    class _DummyFormats:
        # Minimal attribute used by AutoBackend._model_type: an iterable of suffixes
        Suffix = (".pt",)

    def _safe_export_formats():
        return _DummyFormats()

    if hasattr(_ultra_autobackend, "export_formats"):
        _ultra_autobackend.export_formats = _safe_export_formats  # type: ignore[assignment]
except Exception:
    # If anything goes wrong, fall back to the default behavior; inference may
    # still work if the environment has a compatible pandas/numpy.
    pass


COCO_VEHICLE_CLASSES = (2, 3, 5, 7)  # car, motorbike, bus, truck
COCO_CLASS_NAMES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}

WEIGHTS_DIR = Path(__file__).resolve().parent / "models" / "weights"
VEHICLE_MODEL_PATH = WEIGHTS_DIR / "yolov8n.pt"


@dataclass(frozen=True)
class VehicleBox:
    """Vehicle box for output."""
    track_id: int
    cls_id: int
    conf: float
    xyxy: Tuple[float, float, float, float]


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


def _get_vehicle_model_path() -> str:
    """Resolve vehicle model path from env or default."""
    env_vehicle = os.getenv("YOLO_VEHICLE_WEIGHTS")
    vehicle_path = str(VEHICLE_MODEL_PATH) if VEHICLE_MODEL_PATH.exists() else "yolov8n.pt"
    if env_vehicle:
        v_path = Path(env_vehicle)
        if v_path.exists():
            vehicle_path = str(v_path)
        else:
            print(f"[YOLO] Warning: YOLO_VEHICLE_WEIGHTS not found at '{env_vehicle}'", file=sys.stderr)
    return vehicle_path


def load_models() -> "YOLO":
    """Load vehicle model once. Call once at startup."""
    vehicle_path = _get_vehicle_model_path()
    print(f"[YOLO] Loading model: {vehicle_path}", file=sys.stderr)
    vehicle_model = YOLO(vehicle_path)
    print("[YOLO] Model loaded.", file=sys.stderr)
    return vehicle_model


def detect_frame(
    frame: np.ndarray,
    vehicle_model: "YOLO",
    conf_vehicle: float = 0.35,
) -> dict:
    """
    Run YOLO vehicle detection on a single frame. Returns {vehicles, plates} dict.
    plates is always empty; plate extraction is done by Gemini in detection_worker.
    """
    # Redirect Ultralytics stdout spam (banner, progress) to stderr so the worker's
    # stdout remains clean JSON for the Node server.
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    try:
        vehicle_results = vehicle_model.predict(
            frame,
            classes=list(COCO_VEHICLE_CLASSES),
            conf=conf_vehicle,
            verbose=False,
        )
    finally:
        sys.stdout = old_stdout
    vehicles = _vehicles_from_ultralytics_predict(vehicle_results[0] if vehicle_results else None)

    vehicles_out = []
    for v in vehicles:
        class_name = COCO_CLASS_NAMES.get(v.cls_id, "vehicle")
        vehicles_out.append({
            "bbox": [round(x, 2) for x in v.xyxy],
            "class_name": class_name,
            "confidence": round(v.conf, 4),
        })

    return {"vehicles": vehicles_out, "plates": []}


def main() -> int:
    parser = argparse.ArgumentParser(description="YOLO vehicle detection service.")
    parser.add_argument("--base64-file", required=True, help="Path to file containing base64 image data.")

    conf_vehicle_default = float(os.getenv("YOLO_VEHICLE_CONF", "0.35"))
    parser.add_argument(
        "--conf-vehicle",
        type=float,
        default=conf_vehicle_default,
        help="Vehicle detection confidence (overrides with YOLO_VEHICLE_CONF env if set).",
    )
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

    w, h = frame.shape[1], frame.shape[0]
    print(f"[YOLO] Image loaded ({w}x{h}), loading model...", file=sys.stderr)

    vehicle_model = load_models()
    result = detect_frame(frame, vehicle_model, conf_vehicle=float(args.conf_vehicle))
    vehicles_out = result["vehicles"]
    print(f"[YOLO] Done: {len(vehicles_out)} vehicles", file=sys.stderr)
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
