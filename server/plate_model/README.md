# Hugging Face License Plate Detection

## Configuration

Set these environment variables:

- `PLATE_DETECTION_MODEL`: Model ID from Hugging Face (default: morsetechlab/yolov11-license-plate-detection)
- `PLATE_DETECTION_CONFIDENCE`: Detection threshold (0.0-1.0, default: 0.5)
- `PLATE_DETECTION_USE_GPU`: Enable GPU acceleration (true/false, default: true)
- `ENABLE_BACKUP_OCR`: Run EasyOCR/Tesseract on cropped plates (true/false, default: true)

## Model Details

**Model:** morsetechlab/yolov11-license-plate-detection

- **Type:** YOLOv11 (Ultralytics)
- **Accuracy:** Precision 0.9893, Recall 0.9508, mAP@50 0.9813
- **Input Size:** 640x640
- **License:** AGPLv3 (requires open sourcing code if used commercially)
- **Downloads:** 25,065/month

## OCR Pipeline

1. **YOLOv11 Detection** - Locates license plates with high confidence
2. **Plate Cropping** - Extracts plate region from frame
3. **Preprocessing** - Applies CLAHE, Gaussian blur, thresholding
4. **OCR** - EasyOCR + Tesseract reads the plate
5. **Result** - Best OCR result merged with YOLO confidence

## Installation

```bash
# Add to requirements.txt:
pip install transformers torch torchvision

# Or install from command line:
pip install transformers torch torchvision
```

## Performance

### YOLOv11 Inference Speed:
- **GPU (CUDA):** ~10-15 FPS
- **CPU:** ~3-5 FPS

### OCR Speed (Backup):
- **GPU:** <100ms per plate
- **CPU:** ~200-300ms per plate

### Overall Pipeline:
- **GPU:** ~2-5 FPS (sufficient for parking monitoring)
- **CPU:** ~5-10 FPS (depends on plate count)

## License Compliance

⚠️ **Important:** YOLOv11 model is AGPLv3 licensed.

- If you use this model in a service or project, you must **open source** the code that uses it
- Please give proper attribution to Roboflow, Ultralytics, and MorseTechLab when using or deploying
- For personal/open-source projects, no restrictions

## Files Created

- `plate_detection_service.py` - Main detection service
- Uses existing `ocr_only.py` for backup OCR

## Testing

Run the plate detection service with a test image:

```bash
cd server
python3 plate_detection_service.py --image /path/to/test.jpg
python3 plate_detection_service.py --base64-file /path/to/base64.txt
```

## Integration

The service is automatically used in `detection_worker.py`:

1. Worker captures frames from RTSP streams
2. Runs YOLOv11 to detect plates
3. Crops detected plate regions
4. Runs OCR on cropped plates
5. Returns best result with confidence scores
