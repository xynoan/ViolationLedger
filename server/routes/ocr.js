import express from 'express';
import { runOCROnly } from '../ai_detection_service.js';
import { getDetectionEnabled } from '../detection_state.js';

const router = express.Router();

/**
 * POST /api/ocr/plate
 * Body: { imageBase64: string }
 * Returns plates from OCR only (EasyOCR + Tesseract). No Gemini - safe for 24/7 live dashboard.
 * bbox is normalized [x, y, width, height] (0-1); frontend converts to pixels.
 *
 * When detection is paused via /detect/enabled, this route short-circuits
 * and returns an empty result without running OCR to avoid extra plate calls.
 */
router.post('/plate', async (req, res) => {
  try {
    // Respect global detection toggle to avoid unnecessary OCR runs / plate API calls
    if (!getDetectionEnabled()) {
      console.log('[OCR] Plate request received while detection is paused – skipping OCR');
      return res.status(503).json({
        error: 'Detection is currently paused',
        plates: [],
      });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    console.log('[OCR] Plate request received, running EasyOCR + Tesseract...');
    const result = await runOCROnly(imageBase64);
    const plates = (result.plates || []).map((p) => ({
      plateNumber: p.plateNumber || 'NONE',
      confidence: p.confidence ?? 0.8,
      bbox: Array.isArray(p.bbox) && p.bbox.length >= 4 ? p.bbox : [0.2, 0.5, 0.6, 0.2],
      class_name: p.class_name || 'plate',
    }));

    console.log(
      '[OCR] Done.',
      plates.length > 0 ? `Plates: ${plates.map((p) => p.plateNumber).join(', ')}` : 'No plates.',
      result.error ? `(${result.error})` : ''
    );
    return res.json({ plates, error: result.error || null });
  } catch (err) {
    console.error('OCR plate error:', err);
    return res.status(500).json({
      error: err.message || 'Plate OCR failed',
      plates: [],
    });
  }
});

export default router;
