# Plate detection model

The OCR pipeline can use a YOLOv8-based license plate detector for better accuracy. Place the model weights here so the server finds them by default.

## Default path

- **File**: `best.pt` (YOLOv8 format, e.g. from Ultralytics or Roboflow export)
- **Env override**: Set `PLATE_MODEL_PATH` to a full path to your `.pt` file if you store it elsewhere.

## How to obtain weights

1. **Roboflow Universe**  
   Export a YOLOv8 PyTorch model from a license-plate detection dataset, for example:
   - [License Plate Recognition](https://universe.roboflow.com/roboflow-universe-projects/license-plate-recognition-rxg4e)  
   - [YOLOv8 number plate detection](https://universe.roboflow.com/ml-sdznj/yolov8-number-plate-detection)  
   Download the `.pt` file and save it as `best.pt` in this directory.

2. **Custom training**  
   Train YOLOv8 (e.g. `yolo detect train ...`) on your own plate dataset and copy the best weights to `best.pt` here.

3. **Disable detector**  
   If no model is present, the server falls back to full-frame OCR (no crash). To force full-frame OCR even when a model exists, set `USE_PLATE_DETECTOR=0` in the environment.
