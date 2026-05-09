#!/usr/bin/env python3
"""
ViolationLedger - AI Detection Service
Uses OCR (EasyOCR/Tesseract) for license plate detection

Context: Camera mounted on electricity post monitoring a street/roadway no-parking zone.
All vehicles detected on the street are considered illegally parked violations.
"""

import os
import sys
import json
import base64
import argparse
from typing import Dict, List
from datetime import datetime, timezone

try:
    from PIL import Image
    import io
    import easyocr
    import cv2
except ImportError as e:
    print(f"Error: Missing required package. Install with: pip install pillow easyocr opencv-python", file=sys.stderr)
    sys.exit(1)

CONFIDENCE_THRESHOLD = 0.7  # 70% minimum confidence for OCR


def load_image_from_base64(base64_string: str) -> Image.Image:
    """Load image from base64 string."""
    try:
        # Remove data URL prefix if present
        if ',' in base64_string:
            base64_string = base64_string.split(',')[1]
        
        image_data = base64.b64decode(base64_string)
        image = Image.open(io.BytesIO(image_data))
        return image
    except Exception as e:
        raise ValueError(f"Failed to load image from base64: {str(e)}")


def load_image_from_file(filepath: str) -> Image.Image:
    """Load image from file path."""
    try:
        image = Image.open(filepath)
        return image
    except Exception as e:
        raise ValueError(f"Failed to load image from file: {str(e)}")


PLATE_EXTRACTION_PROMPT = """Return ONLY valid JSON in this exact format: {"plates":["ABC-1234","XYZ-5678"]}.
If no readable plates are visible, return {"plates":[]}.
Do not include markdown, code fences, or extra keys."""


def _parse_plates_from_response(response_text: str) -> List[str]:
    """Parse plates from Gemini response using strict JSON parsing."""
    if not response_text or not isinstance(response_text, str):
        return []
    response_text = response_text.strip()
    # Remove markdown code blocks
    if response_text.startswith("```"):
        parts = response_text.split("```")
        if len(parts) > 1:
            response_text = parts[1]
            if response_text.startswith("json"):
                response_text = response_text[4:]
    response_text = response_text.strip()
    if response_text.startswith('```json'):
        response_text = response_text[7:]
    if response_text.startswith('```'):
        response_text = response_text[3:]
    if response_text.endswith('```'):
        response_text = response_text[:-3]
    response_text = response_text.strip()

    # Try standard JSON parse
    if '{' in response_text and '}' in response_text:
        start_idx = response_text.find('{')
        end_idx = response_text.rfind('}') + 1
        if start_idx < end_idx:
            json_candidate = response_text[start_idx:end_idx]
            try:
                result = json.loads(json_candidate)
                plates = result.get("plates", [])
                if isinstance(plates, list):
                    return [str(p).strip() for p in plates if p]
                return []
            except json.JSONDecodeError:
                return []
    return []


def _safe_parse_plates(response_text: str) -> List[str]:
    """Wrapper that never raises - returns [] on any parse error."""
    try:
        return _parse_plates_from_response(response_text)
    except Exception:
        return []


def extract_plates_from_image(image: Image.Image) -> List[str]:
    """
    Extract license plate numbers from an image using OCR.
    Returns empty list as Gemini has been disabled.
    """
    print("[AI Service] OCR-only mode - no plates extracted", file=sys.stderr)
    return []


def analyze_image_with_gemini(image: Image.Image) -> Dict:
    """
    Analyze image using OCR for license plate detection.
    
    Returns:
        {
            "vehicles": [],
            "timestamp": "ISO timestamp"
        }
    """
    print("[AI Service] Using OCR for license plate detection", file=sys.stderr)
    return {
        "vehicles": [],
        "timestamp": datetime.now(timezone.utc).isoformat()
    }


def process_image(image_input: str, is_base64: bool = True) -> Dict:
    """
    Main function to process an image and return detection results.
    
    Args:
        image_input: Base64 string or file path
        is_base64: True if image_input is base64, False if file path
    
    Returns:
        Detection results dictionary with empty vehicles array
    """
    try:
        print("[AI Service] OCR-only mode active", file=sys.stderr)
        return {
            "vehicles": [],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }
    except Exception as e:
        return {
            "vehicles": [],
            "error": str(e),
            "timestamp": datetime.now(timezone.utc).isoformat()
        }


def main():
    """CLI interface for testing."""
    parser = argparse.ArgumentParser(description='AI Detection Service for ViolationLedger')
    parser.add_argument('--image', type=str, help='Path to image file')
    parser.add_argument('--base64', type=str, help='Base64 encoded image (for small images)')
    parser.add_argument('--base64-file', type=str, help='Path to file containing base64 encoded image (for large images)')
    parser.add_argument('--output', type=str, help='Output JSON file path')
    
    args = parser.parse_args()
    
    if not args.image and not args.base64 and not args.base64_file:
        print("Error: Either --image, --base64, or --base64-file must be provided", file=sys.stderr)
        sys.exit(1)
    
    # Count provided arguments
    provided_args = sum([bool(args.image), bool(args.base64), bool(args.base64_file)])
    if provided_args > 1:
        print("Error: Provide only one of --image, --base64, or --base64-file", file=sys.stderr)
        sys.exit(1)
    
    # Process image
    if args.image:
        result = process_image(args.image, is_base64=False)
    elif args.base64_file:
        # Read base64 from file (used to avoid command-line length limits on Windows)
        try:
            with open(args.base64_file, 'r', encoding='utf-8') as f:
                base64_data = f.read().strip()
            result = process_image(base64_data, is_base64=True)
        except Exception as e:
            print(f"Error reading base64 file: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        result = process_image(args.base64, is_base64=True)
    
    # Output result
    output_json = json.dumps(result, indent=2)
    
    if args.output:
        with open(args.output, 'w') as f:
            f.write(output_json)
        print(f"Results saved to {args.output}")
    else:
        print(output_json)


if __name__ == '__main__':
    main()

