import express from 'express';
import { analyzeImageWithAI } from '../ai_detection_service.js';

const router = express.Router();

/**
 * POST /api/ocr/plate
 * Body: { imageBase64: string }
 * Returns plates detected in the image (from AI/Gemini) for live overlay.
 * bbox is normalized [x, y, width, height] (0-1); frontend converts to pixels.
 */
router.post('/plate', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }

    const raw = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const aiResult = await analyzeImageWithAI(raw);

    if (aiResult.error || !aiResult.vehicles?.length) {
      return res.json({
        plates: [],
        error: aiResult.error || null,
      });
    }

    const plates = aiResult.vehicles.map((v) => ({
      plateNumber: v.plateNumber || 'NONE',
      confidence: v.confidence ?? 0.8,
      bbox: Array.isArray(v.bbox) && v.bbox.length >= 4
        ? v.bbox
        : [0, 0, 0.1, 0.1],
      class_name: v.class_name || 'car',
    }));

    return res.json({ plates });
  } catch (err) {
    console.error('OCR plate error:', err);
    return res.status(500).json({
      error: err.message || 'Plate OCR failed',
      plates: [],
    });
  }
});

export default router;
