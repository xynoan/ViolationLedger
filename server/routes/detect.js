import express from 'express';
import { runYoloDetection } from '../ai_detection_service.js';

const router = express.Router();

/**
 * POST /api/detect/yolo
 * Body: { imageBase64: string }
 * Returns vehicles and plates from YOLO detection (yolov8n.pt + license_detection.pt).
 * Plate OCR results are logged server-side.
 */
router.post('/yolo', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required', vehicles: [], plates: [] });
    }

    console.log('[YOLO] Request received, running detection...');
    const result = await runYoloDetection(imageBase64);
    const vCount = (result.vehicles || []).length;
    const pCount = (result.plates || []).length;
    console.log(`[YOLO] Detection complete: ${vCount} vehicles, ${pCount} plates` + (result.error ? ` (error: ${result.error})` : ''));
    return res.json({
      vehicles: result.vehicles || [],
      plates: result.plates || [],
      error: result.error || null,
    });
  } catch (err) {
    console.error('YOLO detect error:', err);
    return res.status(500).json({
      error: err.message || 'YOLO detection failed',
      vehicles: [],
      plates: [],
    });
  }
});

export default router;
