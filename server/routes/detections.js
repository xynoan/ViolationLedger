import express from 'express';
import db from '../database.js';
import { normalizePlateForMatch, isTestViolationSeedAllowed } from './violations.js';

const router = express.Router();

/** Default lookback for the Recent plate detections list (not the Barangay post-grace gate). */
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

/**
 * Insert one synthetic readable-plate detection (dev / ALLOW_TEST_VIOLATION_SEED only).
 * Does not create a violation — for Recent plate detections / presence testing.
 */
router.post('/test-seed', (req, res) => {
  try {
    if (!isTestViolationSeedAllowed()) {
      return res.status(403).json({
        error: 'Test detection seed is disabled (production). Set ALLOW_TEST_VIOLATION_SEED=true to enable.',
      });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const bodyPlate = body.plateNumber != null ? String(body.plateNumber).trim() : '';
    const bodyLoc = body.locationId != null ? String(body.locationId).trim() : '';

    let cam;
    let plateNumber;

    if (bodyPlate || bodyLoc) {
      if (!bodyPlate || !bodyLoc) {
        return res.status(400).json({
          error:
            'Provide both plateNumber and locationId to match an active warning, or omit both for random test data.',
        });
      }
      const row = db
        .prepare(
          `SELECT id, locationId FROM cameras
           WHERE locationId = ?
             AND locationId IS NOT NULL
             AND TRIM(locationId) != ''
           LIMIT 1`,
        )
        .get(bodyLoc);
      if (!row) {
        return res.status(400).json({ error: `No camera for location ${bodyLoc}` });
      }
      cam = row;
      plateNumber = bodyPlate;
    } else {
      const cameras = db
        .prepare(
          `SELECT id, locationId FROM cameras
           WHERE locationId IS NOT NULL AND TRIM(locationId) != ''`,
        )
        .all();

      if (!cameras.length) {
        return res.status(400).json({ error: 'No cameras with a location configured' });
      }

      cam = cameras[Math.floor(Math.random() * cameras.length)];

      const vehicles = db
        .prepare(
          `SELECT plateNumber FROM vehicles WHERE plateNumber IS NOT NULL AND TRIM(plateNumber) != ''`,
        )
        .all();
      if (vehicles.length) {
        plateNumber = vehicles[Math.floor(Math.random() * vehicles.length)].plateNumber;
      } else {
        plateNumber = `TST-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      }
    }

    const detectionId = `DET-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const ts = new Date().toISOString();

    db.prepare(`
      INSERT INTO detections (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name, imageBase64)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, 'car', NULL)
    `).run(detectionId, cam.id, plateNumber, ts, 1.0);

    return res.status(201).json({
      detectionId,
      plateNumber,
      cameraId: cam.id,
      locationId: cam.locationId,
      timestamp: ts,
      note: 'Test data — synthetic detection row',
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

