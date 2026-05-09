#!/usr/bin/env python3
"""
Plate Detection Service using YOLOv11 from Hugging Face
Provides license plate detection and cropped images for OCR
"""

import os
import sys
import json
import cv2
import numpy as np
from typing import Dict, List, Tuple, Optional
from pathlib import Path
from PIL import Image
import io

try:
    from transformers import YOLOImageDetPipeline
    import torch
except ImportError as e:
    print(f"[Plate Detection] Missing required package: {e}", file=sys.stderr)
    print(f"[Plate Detection] Install with: pip install transformers torch torchvision", file=sys.stderr)
    sys.exit(1)

# Configuration
MODEL_ID = os.getenv("PLATE_DETECTION_MODEL", "morsetechlab/yolov11-license-plate-detection")
CONFIDENCE_THRESHOLD = float(os.getenv("PLATE_DETECTION_CONFIDENCE", "0.5"))
USE_GPU = os.getenv("PLATE_DETECTION_USE_GPU", "true").lower() not in ("0", "false", "no")

# Global model instance
detector = None

def load_plate_detector() -> "YOLOImageDetPipeline":
    """Load YOLOv11 model from Hugging Face (lazy loading)"""
    global detector

    if detector is None:
        print(f"[Plate Detection] Loading YOLOv11 model: {MODEL_ID}...")
        print(f"[Plate Detection] Using GPU: {USE_GPU}", file=sys.stderr)

        try:
            detector = YOLOImageDetPipeline.from_pretrained(MODEL_ID)
            if USE_GPU:
                detector.to("cuda")
                print("[Plate Detection] Model loaded on GPU", file=sys.stderr)
            else:
                print("[Plate Detection] Model loaded on CPU", file=sys.stderr)
            print("[Plate Detection] Model loaded successfully", file=sys.stderr)
        except Exception as e:
            print(f"[Plate Detection] Failed to load model: {e}", file=sys.stderr)
            sys.exit(1)

    return detector

def crop_plate_region(frame: np.ndarray, bbox: List[float]) -> Optional[np.ndarray]:
    """
    Crop license plate region from frame based on bbox.
    bbox format: [x1, y1, x2, y2] in normalized or absolute coordinates
    """
    try:
        h, w = frame.shape[:2]

        # Convert normalized to absolute if needed
        if len(bbox) == 4 and max(bbox) <= 1.0:
            # Normalized coordinates
            x1 = int(bbox[0] * w)
            y1 = int(bbox[1] * h)
            x2 = int(bbox[2] * w)
            y2 = int(bbox[3] * h)
        else:
            # Absolute coordinates
            x1, y1, x2, y2 = int(bbox[0]), int(bbox[1]), int(bbox[2]), int(bbox[3])

        # Ensure valid crop
        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(w, x2)
        y2 = min(h, y2)

        if x2 <= x1 or y2 <= y1:
            return None

        crop = frame[y1:y2, x1:x2]

        # Minimum size check
        if crop.size < 100:  # Less than 10x10 pixels
            return None

        return crop

    except Exception as e:
        print(f"[Plate Detection] Error cropping plate: {e}", file=sys.stderr)
        return None

def preprocess_plate_for_ocr(crop: np.ndarray) -> Tuple[np.ndarray, dict]:
    """
    Preprocess cropped plate image for better OCR accuracy.
    Returns: (preprocessed_image, preprocessing_metadata)
    """
    try:
        # Convert to grayscale
        gray = cv2.cvtColor(crop, cv2.COLOR_BGR2GRAY)

        # Apply CLAHE (Contrast Limited Adaptive Histogram Equalization)
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
        enhanced = clahe.apply(gray)

        # Apply Gaussian blur to reduce noise
        blurred = cv2.GaussianBlur(enhanced, (5, 5), 0)

        # Thresholding (Otsu's method) to get binary image
        _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

        # Optional: invert if plates are light on dark
        binary = cv2.bitwise_not(binary)

        metadata = {
            'preprocessing': {
                'grayscale': True,
                'clahe': True,
                'gaussian_blur': True,
                'thresholding': True,
                'binary_image': True
            }
        }

        return binary, metadata

    except Exception as e:
        print(f"[Plate Detection] Error preprocessing plate: {e}", file=sys.stderr)
        return crop, {}

def detect_plates(image: np.ndarray, return_crops: bool = True) -> List[Dict]:
    """
    Detect license plates in image using YOLOv11.

    Args:
        image: OpenCV image (BGR format)
        return_crops: If True, return cropped plate regions for OCR

    Returns:
        List of plate detections with details and cropped images
    """
    try:
        detector = load_plate_detector()

        # Convert OpenCV image to PIL
        if isinstance(image, np.ndarray):
            if len(image.shape) == 3 and image.shape[2] == 3:
                pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
            else:
                pil_image = Image.fromarray(image)
        else:
            pil_image = image

        # Run detection with YOLOv11
        results = detector(pil_image, threshold=CONFIDENCE_THRESHOLD)

        plate_detections = []

        for result in results:
            if result['label'] == 'license plate' and result['score'] >= CONFIDENCE_THRESHOLD:
                # Extract detection info
                detection = {
                    'text': result['text'] or '',
                    'score': float(result['score']),
                    'bbox': result['box'],
                    'class_name': result['label']
                }

                # Crop plate region for OCR
                if return_crops:
                    crop = crop_plate_region(image, result['box'])

                    if crop is not None:
                        # Preprocess for OCR
                        preprocessed, metadata = preprocess_plate_for_ocr(crop)

                        detection['crop'] = preprocessed
                        detection['preprocessing'] = metadata
                        detection['original_crop_size'] = crop.shape[:2]
                        detection['preprocessed_size'] = preprocessed.shape[:2]

                plate_detections.append(detection)

        return plate_detections

    except Exception as e:
        print(f"[Plate Detection] Error detecting plates: {e}", file=sys.stderr)
        return []

def detect_and_ocr_plates(image: np.ndarray) -> List[Dict]:
    """
    Complete pipeline: detect plates with YOLOv11, then run OCR on cropped regions.
    This is the main function to be used in detection_worker.py.
    """
    try:
        # Check if backup OCR is enabled
        ENABLE_BACKUP_OCR = os.getenv("ENABLE_BACKUP_OCR", "true").lower() not in ("0", "false", "no")

        # Step 1: Detect plates with YOLOv11
        detections = detect_plates(image, return_crops=True)

        # Step 2: Run OCR on each cropped plate
        for detection in detections:
            crop = detection.get('crop')

            if crop is not None and ENABLE_BACKUP_OCR:
                # Import OCR module
                try:
                    from ocr_only import run_ocr

                    # Run OCR on preprocessed image
                    h, w = crop.shape[:2]
                    ocr_results = run_ocr(crop, w, h)

                    if ocr_results:
                        # Use best OCR result
                        best_ocr = ocr_results[0]
                        detection['plate_number'] = best_ocr.get('plateNumber', '')
                        detection['ocr_confidence'] = best_ocr.get('confidence', 0.0)
                        detection['ocr_success'] = True
                        detection['ocr_method'] = 'EasyOCR + Tesseract'

                        # Update detection info
                        detection['plateNumber'] = best_ocr.get('plateNumber', '')
                        detection['confidence'] = best_ocr.get('confidence', 0.5)
                    else:
                        # OCR failed, use YOLOv11's text prediction
                        detection['ocr_success'] = False
                        detection['ocr_method'] = 'YOLOv11 text prediction only'
                        detection['plate_number'] = detection['text']

                except ImportError:
                    # OCR not available, use YOLO text only
                    detection['ocr_success'] = False
                    detection['ocr_method'] = 'YOLOv11 text prediction only'
                    detection['plate_number'] = detection['text']
            elif crop is not None:
                # OCR disabled, use YOLO text only
                detection['ocr_success'] = False
                detection['ocr_method'] = 'YOLOv11 text prediction only'
                detection['plate_number'] = detection['text']

        return detections

    except Exception as e:
        print(f"[Plate Detection] Error in detect_and_ocr_plates: {e}", file=sys.stderr)
        return []

# CLI interface for testing
def main():
    import argparse

    parser = argparse.ArgumentParser(description='Plate Detection Service')
    parser.add_argument('--image', type=str, help='Path to image file')
    parser.add_argument('--base64-file', type=str, help='Path to file with base64 image')
    parser.add_argument('--output', type=str, help='Output JSON file path')

    args = parser.parse_args()

    # Load image
    image = None
    if args.image:
        image = cv2.imread(args.image)
    elif args.base64_file:
        import base64
        with open(args.base64_file, 'r') as f:
            base64_data = f.read().strip()
        if ',' in base64_data:
            base64_data = base64_data.split(',')[1]
        img_data = base64.b64decode(base64_data)
        nparr = np.frombuffer(img_data, np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if image is None:
        print("Error: No image provided", file=sys.stderr)
        sys.exit(1)

    # Run detection
    results = detect_and_ocr_plates(image)

    # Output
    output = {
        'plates': [
            {
                'plateNumber': r.get('plateNumber') or r.get('plate_number', r.get('text', '')),
                'confidence': r.get('confidence', r.get('score', 0.0)),
                'bbox': r.get('bbox'),
                'class_name': r.get('class_name'),
                'ocr_success': r.get('ocr_success', False),
                'ocr_method': r.get('ocr_method', 'N/A'),
                'original_crop_size': r.get('original_crop_size'),
                'preprocessed_size': r.get('preprocessed_size')
            }
            for r in results
        ]
    }

    if args.output:
        with open(args.output, 'w') as f:
            json.dump(output, f, indent=2)
        print(f"Results saved to {args.output}")
    else:
        print(json.dumps(output, indent=2))

if __name__ == '__main__':
    main()
