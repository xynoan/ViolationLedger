#!/usr/bin/env python3
"""
ViolationLedger - AI Detection Service
Uses Google Gemini 2.5 Flash for ILLEGAL PARKING VIOLATION detection on streets/roadways

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
    import google.generativeai as genai
    from PIL import Image
    import io
except ImportError as e:
    print(f"Error: Missing required package. Install with: pip install google-generativeai pillow", file=sys.stderr)
    sys.exit(1)

# Gemini API Configuration
# Use environment variable for API key, fallback to default if not set
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY', 'AIzaSyD8nAPVUIUnNABP7mjHU9HDTnSk0rh1ZBI')
# Use gemini-2.5-flash as requested
GEMINI_MODEL = 'gemini-2.5-flash'
CONFIDENCE_THRESHOLD = 0.7  # 70% minimum confidence (lowered for better consistency with stationary vehicles)
PARSE_FAILURE_COUNT = 0


def get_gemini_model():
    """
    Get or create Gemini model instance with proper error handling.
    This follows the pattern from main.py for better error handling.
    """
    if genai is None:
        raise RuntimeError("google-generativeai is not installed. Install with: pip install google-generativeai")
    
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY is not set in environment")
    
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        return genai.GenerativeModel(GEMINI_MODEL)
    except Exception as e:
        raise RuntimeError(f"Failed to initialize Gemini model: {str(e)}")


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
    Use Gemini to extract license plate numbers from an image.
    Called when YOLO detects vehicles. Returns empty list on rate limit or error.
    """
    try:
        model = get_gemini_model()
        response = model.generate_content(
            [PLATE_EXTRACTION_PROMPT, image],
            generation_config={
                "temperature": 0.0,
                "max_output_tokens": 512,
            }
        )
        text = getattr(response, 'text', None) or ''
        plates = _safe_parse_plates(text)
        return plates
    except Exception as e:
        err_str = str(e)
        if "429" in err_str or "quota" in err_str.lower():
            print("[Gemini] Rate limit exceeded, skipping plate extraction", file=sys.stderr)
            return []
        print(f"[Gemini] Plate extraction error: {e}", file=sys.stderr)
        return []


def analyze_image_with_gemini(image: Image.Image) -> Dict:
    """
    Analyze image using Gemini 2.5 Flash for ILLEGAL PARKING VIOLATION detection on streets/roadways.
    
    Context: Camera monitors a street/roadway from an electricity post. ALL vehicles detected
    on the street are considered illegally parked violations (no-parking zone).
    
    Returns:
        {
            "vehicles": [
                {
                    "plateNumber": "ABC-1234" or "NONE",
                    "confidence": 0.95,
                    "bbox": [x, y, width, height],
                    "class_name": "car" | "motorcycle" | "truck" | "bus",
                    "plateVisible": true | false
                }
            ],
            "timestamp": "ISO timestamp"
        }
        
    Note: All vehicles in the result are illegally parked violations on the street/roadway.
    """
    
    prompt = """You are an illegal parking detector for roadway cameras.
Return ONLY valid JSON with this exact schema:
{"vehicles":[{"plateNumber":"ABC-1234","confidence":0.95,"bbox":[0.1,0.2,0.3,0.4],"class_name":"car","plateVisible":true}]}

Rules:
- Detect illegally parked vehicles visible in the scene (car, motorcycle, truck, bus).
- Use confidence 0.0-1.0; include only detections with confidence >= 0.7.
- plateNumber:
  - readable plate text when clearly readable
  - "BLUR" when plate area is visible but unreadable
  - "NONE" when plate area is not visible
- plateVisible should be true for readable or BLUR, false for NONE.
- bbox must be normalized [x, y, width, height] in 0-1.
- If no qualifying vehicles exist, return {"vehicles":[]}.
- Do not add extra keys, markdown, explanations, or prose."""

    try:
        # Get model instance (lazy initialization)
        model = get_gemini_model()
        
        # Generate content with Gemini
        response = model.generate_content(
            [prompt, image],
            generation_config={
                "temperature": 0.0,  # Zero temperature for maximum accuracy and consistency
                "top_p": 0.9,  # Lower top_p for more focused responses
                "top_k": 20,  # Lower top_k for more deterministic output
                "max_output_tokens": 768,
            }
        )
        
        # Extract JSON from response - improved parsing like main.py
        response_text = response.text.strip()
        
        # Remove markdown code blocks if present (multiple cleanup attempts)
        if response_text.startswith("```"):
            # Split by ``` and take the middle part
            parts = response_text.split("```")
            if len(parts) > 1:
                response_text = parts[1]
                # Remove "json" prefix if present
                if response_text.startswith("json"):
                    response_text = response_text[4:]
        
        # Additional cleanup
        if response_text.startswith('```json'):
            response_text = response_text[7:]
        if response_text.startswith('```'):
            response_text = response_text[3:]
        if response_text.endswith('```'):
            response_text = response_text[:-3]
        response_text = response_text.strip()
        
        # Try to find JSON object in the response if it's embedded in text
        if '{' in response_text and '}' in response_text:
            start_idx = response_text.find('{')
            end_idx = response_text.rfind('}') + 1
            if start_idx < end_idx:
                response_text = response_text[start_idx:end_idx]
        
        # Parse JSON with strict error handling for malformed responses
        try:
            result = json.loads(response_text)
        except json.JSONDecodeError as parse_error:
            global PARSE_FAILURE_COUNT
            PARSE_FAILURE_COUNT += 1
            print(f"[Gemini] Parse failure count={PARSE_FAILURE_COUNT}", file=sys.stderr)
            print(f"Error: Failed to parse Gemini response as JSON: {parse_error}", file=sys.stderr)
            print(f"Response was: {response_text[:500]}", file=sys.stderr)
            return {"vehicles": [], "error": f"Failed to parse AI response: {str(parse_error)}"}
        
        # Validate and filter by confidence threshold
        if 'vehicles' not in result:
            result['vehicles'] = []
        
        # Filter vehicles by confidence threshold
        filtered_vehicles = [
            vehicle for vehicle in result['vehicles']
            if vehicle.get('confidence', 0.0) >= CONFIDENCE_THRESHOLD
        ]
        
        result['vehicles'] = filtered_vehicles
        
        return result
        
    except RuntimeError as e:
        # API key or model initialization errors
        error_msg = str(e)
        print(f"Error: Gemini model initialization failed: {error_msg}", file=sys.stderr)
        return {"vehicles": [], "error": error_msg}
    except json.JSONDecodeError as e:
        # JSON parsing errors - provide more context
        print(f"Error: Failed to parse Gemini response as JSON: {e}", file=sys.stderr)
        print(f"Response was: {response_text[:500]}", file=sys.stderr)
        return {"vehicles": [], "error": f"Failed to parse AI response: {str(e)}"}
    except Exception as e:
        # Other API errors (quota, network, etc.)
        error_msg = str(e)
        print(f"Error: Gemini API call failed: {error_msg}", file=sys.stderr)
        # Check for quota errors specifically
        if "quota" in error_msg.lower() or "429" in error_msg:
            return {"vehicles": [], "error": "API quota exceeded. Please check your Gemini API plan and billing."}
        return {"vehicles": [], "error": error_msg}


def process_image(image_input: str, is_base64: bool = True) -> Dict:
    """
    Main function to process an image and return detection results.
    
    Args:
        image_input: Base64 string or file path
        is_base64: True if image_input is base64, False if file path
    
    Returns:
        Detection results dictionary
    """
    try:
        # Validate API key before processing
        if not GEMINI_API_KEY:
            return {
                "vehicles": [],
                "error": "GEMINI_API_KEY is not set in environment",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
        
        # Load image
        if is_base64:
            image = load_image_from_base64(image_input)
        else:
            image = load_image_from_file(image_input)
        
        # Analyze with Gemini
        result = analyze_image_with_gemini(image)
        
        # Add timestamp
        result['timestamp'] = datetime.utcnow().isoformat() + 'Z'
        
        return result
        
    except ValueError as e:
        # Image loading errors
        return {
            "vehicles": [],
            "error": f"Failed to load image: {str(e)}",
            "timestamp": datetime.utcnow().isoformat() + 'Z'
        }
    except Exception as e:
        # Other errors
        return {
            "vehicles": [],
            "error": str(e),
            "timestamp": datetime.utcnow().isoformat() + 'Z'
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

