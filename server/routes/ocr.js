import express from 'express';
import { runOCROnly } from '../ai_detection_service.js';

const router = express.Router();

/**
 * POST /api/ocr/plate
 * Body: { imageBase64: string }
 * Returns plates from OCR only (EasyOCR + Tesseract). No Gemini - safe for 24/7 live dashboard.
 * bbox is normalized [x, y, width, height] (0-1); frontend converts to pixels.
 */
router.post('/plate', async (req, res) => {
  try {
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

    console.log('[OCR] Done.', plates.length > 0 ? `Plates: ${plates.map((p) => p.plateNumber).join(', ')}` : 'No plates.', result.error ? `(${result.error})` : '');
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
