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
import re
from typing import Dict, List, Optional, Tuple
from pathlib import Path
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
    
    # Create a detailed, accurate prompt for illegal parking detection on roadways
    prompt = """You are a highly accurate AI vision system specialized in ILLEGAL PARKING VIOLATION detection on STREETS and ROADWAYS.

CONTEXT:
- This camera monitors streets and roadways for illegal parking violations
- Your task is to detect ALL illegally parked vehicles and extract their license plates
- The system will automatically send SMS warnings to registered vehicle owners via Semaphore or notify Barangay officials

ILLEGAL PARKING SCENARIOS TO DETECT:

1. VEHICLES ON STREET/ROADWAY:
   - Any vehicle PARKED on the street/roadway (not in designated parking areas)
   - Vehicles parked on asphalt/concrete road surfaces
   - This is the PRIMARY violation type - ALL vehicles on roadways are violations

2. VEHICLES ON RED-PAINTED CURBS (6-METER NO PARKING ZONES):
   - Vehicles parked on or near RED-PAINTED curbs
   - Red curbs indicate "NO PARKING" zones (typically 6-meter zones)
   - Even partial parking on red curbs is a violation

3. VEHICLES ON SIDEWALKS/CURBS:
   - Vehicles with wheels partially or fully on sidewalks
   - Vehicles parked on raised concrete curbs or walkways
   - Vehicles blocking pedestrian pathways

4. VEHICLES NEAR "NO PARKING" SIGNS:
   - Vehicles parked in areas with visible "NO PARKING" signs
   - Vehicles near "ONE WAY" signs where parking is restricted
   - Vehicles in clearly marked no-parking zones

5. VEHICLES BLOCKING DRIVEWAYS/EXITS:
   - Vehicles partially or fully blocking driveways
   - Vehicles parked in front of gates or property entrances
   - Vehicles obstructing exit routes

6. VEHICLES IN RESTRICTED AREAS:
   - Vehicles parked in areas with yellow speed bumps indicating restricted zones
   - Vehicles in areas marked with parking restriction signs

STRICT REQUIREMENTS FOR ACCURACY:

1. ILLEGAL PARKING DETECTION:
   - Identify ALL vehicles that match ANY of the above violation scenarios
   - Focus on vehicles that are PARKED (not moving) in violation zones
   - Include: cars, motorcycles, trucks, buses
   - CRITICAL: Motorcycles are smaller vehicles - carefully scan the entire image for motorcycles parked on streets, sidewalks, or curbs
   - Motorcycles may be partially obscured or in corners - check ALL areas of the image
   - CRITICAL FOR CONSISTENCY: If a vehicle appears in the same location across multiple captures, it is definitely parked and MUST be detected with high confidence (≥0.7)
   - Stationary vehicles that remain in the same position are ALWAYS violations - detect them consistently
   - Only report vehicles that are clearly visible and identifiable as parked violations
   - Do NOT include:
     * Moving vehicles (in motion)
     * Vehicles in designated parking lots or legal parking spaces
     * Vehicles that are clearly legally parked
   - Priority: Detect ALL violations - it's better to catch all violations than miss any
   - If you see ANY vehicle (including motorcycles) parked illegally, it MUST be included in the results
   - CONSISTENCY IS CRITICAL: The same parked vehicle should be detected with similar confidence scores across multiple captures

2. LICENSE PLATE RECOGNITION (CRITICAL):
   - For EACH detected illegally parked vehicle, carefully examine the license plate area
   - Check BOTH front and rear plates - use whichever is more visible
   - If plate is CLEARLY visible and FULLY readable: Extract the EXACT plate number
   - Plate format examples: "NHJ 9720", "NEI 1951", "ZTN 972", "ABR 9485", "PPU1472", "237816"
   - Philippine plates may be: XXX ####, XXX-####, XXX####, or ####### format
   - PRESERVE EXACT FORMAT including spaces, dashes, and letter case
   - IMPORTANT DISTINCTION:
     * If plate area is VISIBLE but BLURRY, UNCLEAR, or PARTIALLY READABLE: Use "BLUR" (plate is visible but unreadable)
     * If plate area is COMPLETELY NOT VISIBLE, HIDDEN, or ABSENT: Use "NONE" (plate not visible at all)
   - Use "BLUR" when you can see the plate area exists but cannot read the numbers/letters clearly
   - Use "NONE" when the plate area is completely obscured, hidden, or not present
   - Be conservative but thorough - extract plates you are CERTAIN about
   - Plate visibility is CRITICAL - system needs plate to send SMS to owner
   - If plate cannot be read, system will notify Barangay officials instead

3. CONFIDENCE SCORING:
   - Confidence must be between 0.0 and 1.0
   - High confidence (0.9-1.0): Clear violation with fully readable plate
   - Medium confidence (0.7-0.89): Clear violation but plate uncertain or partially visible
   - Low confidence (<0.7): Exclude from results (threshold filter)
   - IMPORTANT: For motorcycles and smaller vehicles, use confidence 0.7+ if the vehicle is clearly visible and illegally parked, even if the plate is not readable
   - CRITICAL: For stationary/parked vehicles that are clearly visible, use confidence ≥0.7 even if partially obscured
   - Confidence should reflect your certainty about BOTH:
     * Vehicle is illegally parked (violation detection)
     * License plate recognition accuracy
   - If a vehicle is clearly illegally parked but plate is blurry/unclear, use confidence 0.7-0.85 with plateNumber "BLUR"
   - If a vehicle is clearly illegally parked but plate is completely not visible, use confidence 0.7-0.85 with plateNumber "NONE"
   - CONSISTENCY: If you detect a vehicle in one capture, similar vehicles in similar positions should have similar confidence scores

4. BOUNDING BOX:
   - Provide [x, y, width, height] coordinates relative to image size (normalized 0-1)
   - x, y = top-left corner of the vehicle
   - width, height = dimensions of the vehicle
   - Box should tightly fit the entire illegally parked vehicle

5. VEHICLE CLASSIFICATION:
   - Use exactly: "car", "motorcycle", "truck", or "bus"
   - Be accurate - don't confuse truck with bus, etc.
   - All detected vehicles are violations (illegally parked)

6. PLATE VISIBILITY FLAG:
   - Set "plateVisible": true if plate number was successfully extracted (plateNumber is a valid plate)
   - Set "plateVisible": false if plate is not visible at all (plateNumber = "NONE")
   - Set "plateVisible": true if plate area is visible but blurry/unclear (plateNumber = "BLUR")
   - "BLUR" means the plate area is visible but the text is unreadable
   - "NONE" means the plate area is completely not visible or absent

7. OUTPUT FORMAT:
   - Return ONLY valid JSON, no markdown, no code blocks, no explanations
   - JSON structure must be exact:
{
  "vehicles": [
    {
      "plateNumber": "ABC-1234" or "BLUR" or "NONE",
      "confidence": 0.95,
      "bbox": [x, y, width, height],
      "class_name": "car",
      "plateVisible": true
    }
  ]
}

CRITICAL ACCURACY RULES:
- DETECT ALL ILLEGAL PARKING VIOLATIONS - don't miss any
- Focus on: street parking, red curbs, sidewalks, NO PARKING signs, blocked driveways
- Only include vehicles with confidence ≥ 0.7 (lowered threshold for better consistency)
- CONSISTENCY IS PARAMOUNT: If a vehicle is parked in the same location, detect it consistently with confidence ≥0.7
- For stationary vehicles that never move, always detect them - they are clear violations
- For plate numbers: If not 100% certain, use "NONE" - accuracy is critical
- Double-check plate numbers - wrong plates cause wrong SMS recipients
- Return empty vehicles array ONLY if you are certain there are no vehicles (not just low confidence)
- Remember: System automatically handles SMS to owners via Semaphore (if registered) or notifies Barangay (if plate not visible/not registered)
- Output ONLY the JSON object, nothing else"""

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
                "max_output_tokens": 2048,
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
        
        # Parse JSON with better error handling for malformed responses
        try:
            result = json.loads(response_text)
        except json.JSONDecodeError as parse_error:
            # Try to fix common JSON issues
            # Remove trailing commas before closing brackets/braces
            # Fix trailing commas in arrays/objects
            fixed_text = re.sub(r',\s*}', '}', response_text)
            fixed_text = re.sub(r',\s*]', ']', fixed_text)
            
            # Try to extract valid JSON by finding the last complete structure
            try:
                # Find the last complete closing brace
                last_brace = fixed_text.rfind('}')
                if last_brace > 0:
                    # Try to find matching opening brace
                    brace_count = 0
                    start_idx = last_brace
                    for i in range(last_brace, -1, -1):
                        if fixed_text[i] == '}':
                            brace_count += 1
                        elif fixed_text[i] == '{':
                            brace_count -= 1
                            if brace_count == 0:
                                start_idx = i
                                break
                    
                    # Extract the JSON object
                    json_candidate = fixed_text[start_idx:last_brace + 1]
                    result = json.loads(json_candidate)
                else:
                    raise parse_error
            except (json.JSONDecodeError, ValueError) as e:
                # If still can't parse, try to extract partial vehicle data using regex
                vehicles = []
                
                # Try to extract vehicle objects using regex as last resort
                vehicle_pattern = r'\{\s*"plateNumber"\s*:\s*"([^"]+)"\s*,\s*"confidence"\s*:\s*([0-9.]+)'
                matches = re.finditer(vehicle_pattern, response_text)
                for match in matches:
                    plate = match.group(1)
                    try:
                        confidence = float(match.group(2))
                        if confidence >= CONFIDENCE_THRESHOLD:
                            vehicles.append({
                                "plateNumber": plate,
                                "confidence": confidence,
                                "bbox": [0, 0, 0, 0],  # Default bbox
                                "class_name": "car",  # Default class
                                "plateVisible": plate.upper() not in ["NONE", "BLUR"]
                            })
                    except (ValueError, IndexError):
                        continue
                
                if vehicles:
                    print(f"Warning: Extracted {len(vehicles)} vehicles from malformed JSON response", file=sys.stderr)
                    return {"vehicles": vehicles, "error": f"Partial parse: {str(parse_error)}"}
                
                # If still can't parse, return error with partial response
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

