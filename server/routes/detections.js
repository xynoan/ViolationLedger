import express from 'express';
import db from '../database.js';

const router = express.Router();

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

function parsePlatesParam(input) {
  if (!input) return [];
  const plates = String(input)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  // avoid pathological inputs
  return plates.slice(0, 250);
}

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

// Get latest detection timestamp for a list of plates.
// Query: /api/detections/latest/by-plates?plates=ABC123,XYZ789
router.get('/latest/by-plates', (req, res) => {
  try {
    const plates = parsePlatesParam(req.query.plates);
    if (!plates.length) return res.json([]);

    const plateKeys = plates.map((p) => String(p).replace(/\s+/g, '').toUpperCase());
    const ph = plateKeys.map(() => '?').join(',');
    const rows = db
      .prepare(`
        SELECT REPLACE(UPPER(plateNumber), ' ', '') AS plateNumber, MAX(timestamp) AS lastSeen
        FROM detections
        WHERE class_name = 'plate'
          AND plateNumber NOT IN ('NONE', 'BLUR')
          AND REPLACE(UPPER(plateNumber), ' ', '') IN (${ph})
        GROUP BY REPLACE(UPPER(plateNumber), ' ', '')
      `)
      .all(...plateKeys);

    res.json(
      rows.map((r) => ({
        plateNumber: r.plateNumber,
        lastSeen: r.lastSeen,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Recent unique plates (by last seen), for rapid-entry suggestions.
// Query: /api/detections/plates/recent?limit=10
router.get('/plates/recent', (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);
    const rows = db
      .prepare(`
        SELECT REPLACE(UPPER(plateNumber), ' ', '') AS plateNumber, MAX(timestamp) AS lastSeen
        FROM detections
        WHERE class_name = 'plate'
          AND plateNumber NOT IN ('NONE', 'BLUR')
        GROUP BY REPLACE(UPPER(plateNumber), ' ', '')
        ORDER BY lastSeen DESC
        LIMIT ?
      `)
      .all(limit);

    res.json(
      rows.map((r) => ({
        plateNumber: r.plateNumber,
        lastSeen: r.lastSeen,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

