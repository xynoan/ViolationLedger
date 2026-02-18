#!/usr/bin/env python3
"""
OCR-only plate recognition. No Gemini.
Pipeline: detect plate regions (YOLOv8, optional) -> crop each -> run EasyOCR + Tesseract on crops.
If plate detector is disabled or finds no plates, falls back to full-frame OCR.
Used by /api/ocr/plate for 24/7 live dashboard to minimize API usage.

Plate model: set PLATE_MODEL_PATH to a YOLOv8 .pt file (e.g. from Roboflow Universe
"license-plate-recognition" or "yolov8-number-plate-detection" export). Default: server/plate_model/best.pt.
Set USE_PLATE_DETECTOR=0 or false to disable and use full-frame OCR only.
"""

import os
import sys
import json
import base64
import argparse
import re
import io
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

# PyTorch 2.6+ defaults to weights_only=True; Ultralytics YOLO .pt files require weights_only=False
try:
    import torch
    _orig_load = torch.load
    def _torch_load(*args, **kwargs):
        kwargs.setdefault("weights_only", False)
        return _orig_load(*args, **kwargs)
    torch.load = _torch_load
except ImportError:
    pass

try:
    from PIL import Image
    # Pillow 10+ removed ANTIALIAS; EasyOCR still expects it
    if not hasattr(Image, "ANTIALIAS"):
        Image.ANTIALIAS = Image.Resampling.LANCZOS
    import cv2
    import numpy as np
    import easyocr
    import pytesseract
except ImportError as e:
    print(json.dumps({"plates": [], "error": f"Missing package: {e}"}), file=sys.stderr)
    sys.exit(1)

# Optional Ultralytics for plate detection; import delayed to avoid stdout spam (see get_plate_model)
_plate_model = None
_YOLO_CLS = None  # set on first get_plate_model() call

# Lazy-init EasyOCR (heavy on first use)
_reader: Optional[easyocr.Reader] = None

# Plate detector: env to disable or custom path
USE_PLATE_DETECTOR = os.environ.get("USE_PLATE_DETECTOR", "1").strip().lower() not in ("0", "false")
DEFAULT_PLATE_MODEL_DIR = Path(__file__).resolve().parent / "models" / "weights"
PLATE_MODEL_PATH = os.environ.get("PLATE_MODEL_PATH") or str(DEFAULT_PLATE_MODEL_DIR / "best.pt")
PLATE_DETECT_CONF = 0.45
CROP_PADDING = 0.1
CROP_MIN_SIDE = 32


def get_reader() -> easyocr.Reader:
    global _reader
    if _reader is None:
        # EasyOCR prints "Progress: ..." to stdout; redirect so only JSON goes to stdout
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            _reader = easyocr.Reader(["en", "tl"])
        finally:
            sys.stdout = old_stdout
    return _reader


def get_plate_model():
    """Lazy-load YOLO plate detection model. Returns None if disabled, missing, or import failed."""
    global _plate_model, _YOLO_CLS
    if _plate_model is not None:
        return _plate_model
    if not USE_PLATE_DETECTOR:
        return None
    # Import Ultralytics only when needed, with stdout redirected so "Creating Settings" etc. don't break JSON
    if _YOLO_CLS is None:
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            try:
                from ultralytics import YOLO as _YOLO
                _YOLO_CLS = _YOLO  # type: ignore
            except ImportError:
                pass
        finally:
            sys.stdout = old_stdout
    if _YOLO_CLS is None:
        return None
    if not os.path.isfile(PLATE_MODEL_PATH):
        print(f"[Plate detector] Model not found: {PLATE_MODEL_PATH}", file=sys.stderr)
        return None
    try:
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            _plate_model = _YOLO_CLS(PLATE_MODEL_PATH)
        finally:
            sys.stdout = old_stdout
        return _plate_model
    except Exception as e:
        print(f"[Plate detector] Load failed: {e}", file=sys.stderr)
        return None


def detect_plate_bboxes(image: np.ndarray) -> List[Tuple[float, float, float, float]]:
    """
    Run plate detection on full image. Returns list of normalized [x, y, w, h] bboxes (0-1).
    Returns empty list if detector unavailable or finds nothing.
    """
    model = get_plate_model()
    if model is None:
        return []
    try:
        # Redirect stdout so Ultralytics messages don't break JSON output for Node caller
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            results = model.predict(image, conf=PLATE_DETECT_CONF, verbose=False)
        finally:
            sys.stdout = old_stdout
        out = []
        h, w = image.shape[:2]
        if not w or not h:
            return []
        for r in results:
            if r.boxes is None:
                continue
            xyxy = r.boxes.xyxy
            if xyxy is None:
                continue
            xyxy = xyxy.cpu().numpy() if hasattr(xyxy, "cpu") else np.asarray(xyxy)
            for i in range(len(xyxy)):
                x1, y1, x2, y2 = xyxy[i]
                x1, y1 = max(0, float(x1)), max(0, float(y1))
                x2, y2 = min(w, float(x2)), min(h, float(y2))
                if x2 <= x1 or y2 <= y1:
                    continue
                nx = x1 / w
                ny = y1 / h
                nw = (x2 - x1) / w
                nh = (y2 - y1) / h
                out.append((round(nx, 4), round(ny, 4), round(nw, 4), round(nh, 4)))
        return out
    except Exception as e:
        print(f"[Plate detector] Inference error: {e}", file=sys.stderr)
        return []


def crop_by_bbox(
    image: np.ndarray,
    bbox_norm: Tuple[float, float, float, float],
    img_width: int,
    img_height: int,
    padding: float = CROP_PADDING,
    min_side: int = CROP_MIN_SIDE,
) -> np.ndarray:
    """Crop image to normalized bbox [x, y, w, h] with padding and minimum size. Returns BGR crop for OCR."""
    nx, ny, nw, nh = bbox_norm
    pad_w = nw * padding
    pad_h = nh * padding
    x1 = max(0, int((nx - pad_w) * img_width))
    y1 = max(0, int((ny - pad_h) * img_height))
    x2 = min(img_width, int((nx + nw + pad_w) * img_width))
    y2 = min(img_height, int((ny + nh + pad_h) * img_height))
    if x2 <= x1 or y2 <= y1:
        return image[:1, :1]  # minimal fallback
    crop = image[y1:y2, x1:x2]
    ch, cw = crop.shape[:2]
    if cw < min_side or ch < min_side:
        scale = max(min_side / cw, min_side / ch, 1.0)
        new_w = max(min_side, int(round(cw * scale)))
        new_h = max(min_side, int(round(ch * scale)))
        crop = cv2.resize(crop, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    return crop


def load_image_from_base64(base64_string: str) -> np.ndarray:
    if "," in base64_string:
        base64_string = base64_string.split(",")[1]
    image_data = base64.b64decode(base64_string)
    pil_image = Image.open(io.BytesIO(image_data))
    return np.array(pil_image)


def bbox_from_easyocr_points(points: List, width: int, height: int) -> List[float]:
    """Convert EasyOCR bbox (4 points) to normalized [x, y, width, height]."""
    xs = [p[0] for p in points]
    ys = [p[1] for p in points]
    x_min = max(0, min(xs))
    y_min = max(0, min(ys))
    x_max = min(width, max(xs))
    y_max = min(height, max(ys))
    x = x_min / width if width else 0
    y = y_min / height if height else 0
    w = (x_max - x_min) / width if width else 0.1
    h = (y_max - y_min) / height if height else 0.1
    return [round(x, 4), round(y, 4), round(w, 4), round(h, 4)]


# Plate-like: letters, digits, spaces, dashes; 2+ chars
PLATE_PATTERN = re.compile(r"^[A-Z0-9\- ]{2,}$")
# Looser pattern for individual OCR fragments to combine (e.g. "DBN" + "3766")
PLATE_FRAGMENT_PATTERN = re.compile(r"^[A-Z0-9]+$")

# Common OCR confusions: in digit positions use left, in letter positions use right
TO_DIGIT = str.maketrans("OILSBZGQ", "01158260")   # letter read as digit (O→0, I/L→1, S→5, B→8, Z→2, G→6, Q→0)
TO_LETTER = str.maketrans("015826", "OISBZG")      # digit read as letter


def correct_plate_ocr(raw: str) -> str:
    """
    Fix common OCR misreads for Philippine-style plates (letters + digits).
    Assumes format like XXX#### or XX####; applies TO_DIGIT in the digit part and TO_LETTER in the letter part.
    """
    s = re.sub(r"[\s\-]+", "", (raw or "").upper())
    if len(s) < 2:
        return s
    # Philippine-style: usually 2–3 letters + 3–4 digits (e.g. AB1234, ABC1234)
    if len(s) >= 6:
        digit_len = 4
    elif len(s) >= 5:
        digit_len = 3
    else:
        digit_len = 2
    digit_len = min(digit_len, len(s) - 1)  # keep at least one letter
    letter_part = s[: -digit_len]
    digit_part = s[-digit_len:]
    letter_fixed = letter_part.translate(TO_LETTER)
    digit_fixed = digit_part.translate(TO_DIGIT)
    return letter_fixed + digit_fixed


def preprocess_for_plates(gray: np.ndarray) -> tuple:
    """Resize small images, CLAHE contrast, Otsu binarization. Returns (gray_work, clahe, binary)."""
    h, w = gray.shape[:2]
    min_side = 300
    if min(h, w) < min_side:
        scale = min_side / min(h, w)
        new_w = int(round(w * scale))
        new_h = int(round(h * scale))
        gray = cv2.resize(gray, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    enhanced = clahe.apply(gray)
    _, binary = cv2.threshold(enhanced, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return gray, enhanced, binary


def run_ocr_on_crop(crop: np.ndarray) -> Optional[Tuple[str, float]]:
    """
    Run OCR on a single plate crop. Returns (plate_number, confidence) or None if no plate-like text.
    """
    try:
        if len(crop.shape) == 3:
            gray = cv2.cvtColor(crop, cv2.COLOR_RGB2GRAY)
        else:
            gray = np.asarray(crop, dtype=np.uint8)
    except Exception:
        gray = np.asarray(crop, dtype=np.uint8)

    gray_work, clahe, binary = preprocess_for_plates(gray)
    best_text: Optional[str] = None
    best_conf = 0.0

    try:
        reader = get_reader()
        for img_variant in [clahe, gray_work]:
            results = reader.readtext(img_variant)
            # EasyOCR returns multiple regions (e.g. "DBN" and "3766" separately); combine left-to-right
            candidates: List[Tuple[str, float, float]] = []
            for item in results:
                if len(item) < 3:
                    continue
                bbox_points, text, prob = item[0], (item[1] or "").strip().upper(), float(item[2])
                text_clean = re.sub(r"[\s\-]+", "", text)
                if len(text_clean) < 1 or prob < 0.15:
                    continue
                if not PLATE_FRAGMENT_PATTERN.match(text_clean):
                    continue
                left_x = min(p[0] for p in bbox_points) if bbox_points else 0
                candidates.append((text_clean, prob, left_x))
            if candidates:
                # Sort left-to-right, concatenate, then correct
                candidates.sort(key=lambda c: c[2])
                combined = "".join(c[0] for c in candidates)
                if len(combined) >= 2 and PLATE_PATTERN.match(combined):
                    best_conf = max(c[1] for c in candidates)
                    best_text = correct_plate_ocr(combined)
                    break
    except Exception as e:
        print(f"EasyOCR error (crop): {e}", file=sys.stderr)

    if not best_text:
        try:
            tess_config = "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 --oem 3"
            for img_variant in [binary, clahe]:
                for psm in [7, 6, 8, 13]:
                    text = pytesseract.image_to_string(img_variant, config=f"--psm {psm} {tess_config}").strip()
                    text_clean = re.sub(r"[\s\-]+", "", text).upper()
                    if text_clean and len(text_clean) >= 3 and PLATE_PATTERN.match(text_clean):
                        best_text = correct_plate_ocr(text_clean)
                        best_conf = 0.75
                        break
                if best_text:
                    break
        except Exception as e:
            print(f"Tesseract error (crop): {e}", file=sys.stderr)

    if best_text:
        return (best_text, round(best_conf, 3))
    return None


def _run_full_frame_ocr(image: np.ndarray, img_width: int, img_height: int) -> List[Dict[str, Any]]:
    """Original full-frame OCR: EasyOCR + Tesseract on entire image, filter by PLATE_PATTERN."""
    plates: List[Dict[str, Any]] = []
    try:
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
        else:
            gray = np.asarray(image, dtype=np.uint8)
    except Exception:
        gray = np.asarray(image, dtype=np.uint8)

    gray_work, clahe, binary = preprocess_for_plates(gray)
    ocr_w, ocr_h = gray_work.shape[1], gray_work.shape[0]

    def norm_bbox_from_points(points: List) -> List[float]:
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        x_min = max(0, min(xs)) / ocr_w if ocr_w else 0
        y_min = max(0, min(ys)) / ocr_h if ocr_h else 0
        x_max = min(ocr_w, max(xs)) / ocr_w if ocr_w else 0.1
        y_max = min(ocr_h, max(ys)) / ocr_h if ocr_h else 0.1
        return [round(x_min, 4), round(y_min, 4), round(x_max - x_min, 4), round(y_max - y_min, 4)]

    try:
        reader = get_reader()
        for img_variant in [clahe, gray_work]:
            results = reader.readtext(img_variant)
            for item in results:
                if len(item) < 3:
                    continue
                bbox_points, text, prob = item[0], item[1], float(item[2])
                text = (text or "").strip().upper()
                text_clean = re.sub(r"[\s\-]+", "", text)
                if len(text_clean) < 2 or prob < 0.2:
                    continue
                if not PLATE_PATTERN.match(text_clean):
                    continue
                bbox_norm = norm_bbox_from_points(bbox_points)
                plate_number = correct_plate_ocr(text_clean or text)
                plates.append({
                    "plateNumber": plate_number,
                    "confidence": round(prob, 3),
                    "bbox": bbox_norm,
                    "class_name": "plate",
                })
            if plates:
                break
    except Exception as e:
        print(f"EasyOCR error: {e}", file=sys.stderr)

    if not plates:
        try:
            tess_config = "-c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 --oem 3"
            for img_variant in [binary, clahe]:
                for psm in [7, 6, 8, 13]:
                    text = pytesseract.image_to_string(img_variant, config=f"--psm {psm} {tess_config}").strip()
                    text_clean = re.sub(r"[\s\-]+", "", text).upper()
                    if text_clean and len(text_clean) >= 3 and PLATE_PATTERN.match(text_clean):
                        plates.append({
                            "plateNumber": correct_plate_ocr(text_clean),
                            "confidence": 0.75,
                            "bbox": [0.25, 0.5, 0.5, 0.2],
                            "class_name": "plate",
                        })
                        break
                if plates:
                    break
        except Exception as e:
            print(f"Tesseract error: {e}", file=sys.stderr)

    return plates


def run_ocr(image: np.ndarray, img_width: int, img_height: int) -> List[Dict[str, Any]]:
    """
    Detect plate regions first (if model available), then OCR each crop.
    Fallback to full-frame OCR when detector is off or finds no plates.
    """
    bboxes = detect_plate_bboxes(image)
    if bboxes:
        plates = []
        for bbox_norm in bboxes:
            crop = crop_by_bbox(image, bbox_norm, img_width, img_height)
            ocr_result = run_ocr_on_crop(crop)
            if ocr_result:
                plate_number, conf = ocr_result
                plates.append({
                    "plateNumber": plate_number,
                    "confidence": conf,
                    "bbox": list(bbox_norm),
                    "class_name": "plate",
                })
            else:
                plates.append({
                    "plateNumber": "NONE",
                    "confidence": 0.0,
                    "bbox": list(bbox_norm),
                    "class_name": "plate",
                })
        return plates
    return _run_full_frame_ocr(image, img_width, img_height)


def main() -> None:
    parser = argparse.ArgumentParser(description="OCR-only plate recognition (no Gemini)")
    parser.add_argument("--base64-file", type=str, help="Path to file containing base64 image")
    parser.add_argument("--image", type=str, help="Path to image file")
    args = parser.parse_args()

    base64_content: Optional[str] = None
    if args.base64_file:
        try:
            with open(args.base64_file, "r", encoding="utf-8") as f:
                base64_content = f.read()
        except Exception as e:
            print(json.dumps({"plates": [], "error": str(e)}))
            sys.exit(1)
    elif args.image:
        try:
            with open(args.image, "rb") as f:
                base64_content = base64.b64encode(f.read()).decode("utf-8")
        except Exception as e:
            print(json.dumps({"plates": [], "error": str(e)}))
            sys.exit(1)

    if not base64_content:
        print(json.dumps({"plates": [], "error": "No image input (use --base64-file or --image)"}))
        sys.exit(1)

    try:
        image = load_image_from_base64(base64_content)
        if image is None or image.size == 0:
            print(json.dumps({"plates": [], "error": "Invalid image"}))
            sys.exit(0)
        h, w = image.shape[:2]
        # Redirect stdout during OCR so EasyOCR/Tesseract debug output doesn't corrupt JSON
        old_stdout = sys.stdout
        sys.stdout = sys.stderr
        try:
            plates = run_ocr(image, w, h)
        finally:
            sys.stdout = old_stdout
        print(json.dumps({"plates": plates}))
    except Exception as e:
        print(json.dumps({"plates": [], "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
