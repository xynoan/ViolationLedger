import express from 'express';
import db from '../database.js';
import { normalizePlateForMatch } from './violations.js';

const router = express.Router();

/** Same default as `monitoring_service.js` grace-expiry presence lookback. */
const DEFAULT_RECENT_PLATES_MINUTES = 15;

function getStatements() {
  return {
    getByCamera: db.prepare(`
      SELECT * FROM detections 
      WHERE cameraId = ? 
      ORDER BY timestamp DESC
    `),
    getLatest: db.prepare(`
      SELECT * FROM detections 
      WHERE cameraId = ? 
      ORDER BY timestamp DESC
      LIMIT 1
    `),
    getAll: db.prepare('SELECT * FROM detections ORDER BY timestamp DESC'),
  };
}

/**
 * Readable plate detections in a time window, one row per (plate, location) — newest first per pair.
 * Query: minutes (1–120, default 15), optional locationId, optional plateNumber.
 */
router.get('/recent-plates', (req, res) => {
  try {
    const rawMin = parseInt(String(req.query.minutes ?? ''), 10);
    const minutes = Number.isFinite(rawMin)
      ? Math.min(Math.max(rawMin, 1), 120)
      : DEFAULT_RECENT_PLATES_MINUTES;
    const locationId = req.query.locationId ? String(req.query.locationId).trim() : null;
    const plateNumber = req.query.plateNumber ? String(req.query.plateNumber).trim() : null;

    const since = new Date(Date.now() - minutes * 60 * 1000).toISOString();

    let sql = `
      SELECT d.*, c.locationId AS locationId
      FROM detections d
      JOIN cameras c ON d.cameraId = c.id
      WHERE d.timestamp >= ?
      AND d.plateNumber != 'NONE'
      AND d.plateNumber != 'BLUR'
      AND d.class_name != 'none'
      AND c.locationId IS NOT NULL
    `;
    const params = [since];
    if (locationId) {
      sql += ' AND c.locationId = ?';
      params.push(locationId);
    }
    if (plateNumber) {
      sql += ' AND REPLACE(UPPER(d.plateNumber), \' \', \'\') = ?';
      params.push(normalizePlateForMatch(plateNumber));
    }
    sql += ' ORDER BY d.timestamp DESC';

    const rows = db.prepare(sql).all(...params);

    const seen = new Map();
    for (const d of rows) {
      const key = `${normalizePlateForMatch(d.plateNumber)}-${d.locationId}`;
      if (!seen.has(key)) {
        seen.set(key, d);
      }
    }

    const entries = Array.from(seen.values()).map((d) => ({
      detectionId: d.id,
      cameraId: d.cameraId,
      plateNumber: d.plateNumber,
      locationId: d.locationId,
      timestamp: d.timestamp,
      confidence: d.confidence,
      vehicleClass: d.class_name,
      imageUrl: d.imageUrl || null,
    }));

    res.json({
      lookbackMinutes: minutes,
      since,
      count: entries.length,
      entries,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/camera/:cameraId', (req, res) => {
  try {
    const statements = getStatements();
    let detections = statements.getByCamera.all(req.params.cameraId);
    
    // Apply pagination limit (default 100, max 500)
    const maxLimit = Math.min(parseInt(req.query.limit) || 100, 500);
    detections = detections.slice(0, maxLimit);
    
    // Apply confidence threshold if specified (≥80% = 0.8)
    const minConfidence = req.query.minConfidence ? parseFloat(req.query.minConfidence) : 0.0;
    
    const filteredDetections = detections
      .filter(detection => detection.confidence >= minConfidence)
      .map(detection => {
        let bbox = null;
        if (detection.bbox) {
          try {
            bbox = JSON.parse(detection.bbox);
          } catch (e) {
            bbox = null;
          }
        }
        
        return {
          ...detection,
          timestamp: detection.timestamp, // Keep as ISO string for grouping
          timestampDate: new Date(detection.timestamp), // Also provide Date object
          bbox: bbox,
          confidence: detection.confidence,
          imageBase64: detection.imageBase64 || null
        };
      });
    
    res.json(filteredDetections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/camera/:cameraId/latest', (req, res) => {
  try {
    const statements = getStatements();
    const detection = statements.getLatest.get(req.params.cameraId);
    
    // Return null instead of 404 when no detections found (this is expected for new cameras)
    if (!detection) {
      return res.json(null);
    }
    
    let bbox = null;
    if (detection.bbox) {
      try {
        bbox = JSON.parse(detection.bbox);
      } catch (e) {
        bbox = null;
      }
    }
    
    res.json({
      ...detection,
      timestamp: detection.timestamp, // Keep as ISO string
      timestampDate: new Date(detection.timestamp), // Also provide Date object
      bbox: bbox,
      confidence: detection.confidence,
      imageBase64: detection.imageBase64 || null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/all', (req, res) => {
  try {
    const statements = getStatements();
    const detections = statements.getAll.all();
    res.json(detections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

