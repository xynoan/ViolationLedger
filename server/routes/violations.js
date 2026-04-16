import express from 'express';
import db from '../database.js';
import { sendViolationSms } from '../utils/smsService.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { getGracePeriodMinutes, getOwnerSmsDelayConfig } from '../runtime_config.js';

const router = express.Router();

const OUT_OF_VIEW_NOTE = 'Vehicle is not in the camera view anymore.';

function computeOwnerSmsScheduledAtIso() {
  const smsDelayConfig = getOwnerSmsDelayConfig();
  const delayMinutes = Number(smsDelayConfig?.effectiveDelayMinutes ?? 5);
  return new Date(Date.now() + delayMinutes * 60 * 1000).toISOString();
}

export function normalizePlateForMatch(plateNumber) {
  if (!plateNumber) return '';
  return String(plateNumber).replace(/\s+/g, '').toUpperCase();
}

/** Dev / explicit-flag only: POST /test-seed-active-warning */
function isTestViolationSeedAllowed() {
  if (process.env.ALLOW_TEST_VIOLATION_SEED === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

/** Warnings never extend beyond grace after detection (fixes legacy / bad seed rows without mutating DB). */
function clampWarningExpiresAtForResponse(violation) {
  if (violation.status !== 'warning' || !violation.warningExpiresAt) {
    return violation.warningExpiresAt ? new Date(violation.warningExpiresAt) : null;
  }
  const detectedAt = new Date(violation.timeDetected);
  const cap = new Date(detectedAt.getTime() + getGracePeriodMinutes() * 60 * 1000);
  let w = new Date(violation.warningExpiresAt);
  if (w.getTime() > cap.getTime()) w = cap;
  if (w.getTime() < detectedAt.getTime()) w = cap;
  return w;
}

export async function createViolationFromDetection(plateNumber, cameraLocationId, detectionId = null, class_name = 'vehicle') {
  try {
    if (!plateNumber || plateNumber.toUpperCase() === 'NONE' || plateNumber.toUpperCase() === 'BLUR') {
      return null;
    }

    // Get vehicle info to check if registered
    const normalizedPlate = normalizePlateForMatch(plateNumber);
    const vehicle = db
      .prepare(`SELECT * FROM vehicles WHERE REPLACE(UPPER(plateNumber), ' ', '') = ?`)
      .get(normalizedPlate);
    if (!vehicle) {
      console.log(`ℹ️  Vehicle ${plateNumber} not registered - skipping automatic violation creation`);
      return null;
    }

    // Use the stored plate number (may include spaces) as canonical everywhere downstream.
    const canonicalPlateNumber = vehicle.plateNumber;

    // Check if there's already an active violation for this plate at this location.
    // If found, re-use it and DO NOT reset the warning timer.
    const existingViolation = db.prepare(`
      SELECT * FROM violations 
      WHERE plateNumber = ? 
      AND cameraLocationId = ?
      AND status IN ('warning', 'pending')
    `).get(canonicalPlateNumber, cameraLocationId);

    if (existingViolation) {
      console.log(
        `ℹ️  Active violation already exists for ${canonicalPlateNumber} at ${cameraLocationId} ` +
        `(status=${existingViolation.status}, warningExpiresAt=${existingViolation.warningExpiresAt || 'null'}) - ` +
        'keeping existing warning timer and skipping new violation creation.'
      );

      return {
        ...existingViolation,
        timeDetected: new Date(existingViolation.timeDetected),
        timeIssued: existingViolation.timeIssued ? new Date(existingViolation.timeIssued) : null,
        warningExpiresAt: existingViolation.warningExpiresAt
          ? new Date(existingViolation.warningExpiresAt)
          : null,
        messageSent: false,
        messageLogId: null
      };
    }

    // No existing active violation at this location - create a new warning
    const violationId = `VIOL-${canonicalPlateNumber}-${Date.now()}`;
    const timeDetected = new Date().toISOString();
    
    // Set status to 'warning' (automatic violations start as warnings)
    const status = 'warning';
    
    // Set warningExpiresAt to grace period from now
    const expiresDate = new Date();
    const gracePeriodMinutes = getGracePeriodMinutes();
    expiresDate.setMinutes(expiresDate.getMinutes() + gracePeriodMinutes);
    const expiresAt = expiresDate.toISOString();
    
    let messageSent = false;
    let messageLogId = null;
    const smsScheduledAt = computeOwnerSmsScheduledAtIso();
    
    // Create violation only if it's a new violation
    if (true) {
      db.prepare(`
        INSERT INTO violations (
          id, ticketId, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt, ownerSmsScheduledAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        violationId,
        null, // ticketId (assigned later)
        canonicalPlateNumber,
        cameraLocationId,
        timeDetected,
        status,
        expiresAt,
        smsScheduledAt
      );
      
      // Create notification for new warning
      try {
        const camera = db.prepare('SELECT * FROM cameras WHERE locationId = ?').get(cameraLocationId);
        const cameraId = camera?.id || null;
        
        const warningNotificationId = `NOTIF-WARNING-${violationId}-${Date.now()}`;
        const warningTitle = `New Warning - ${canonicalPlateNumber}`;
        const ownerSmsDelayConfig = getOwnerSmsDelayConfig();
        const warningMessage = `Illegal parking detected for vehicle ${canonicalPlateNumber} at ${cameraLocationId}. ${gracePeriodMinutes}-minute grace period started. Owner SMS is scheduled in ${ownerSmsDelayConfig.effectiveDelayMinutes} minute(s) if the warning remains active.`;
        
        db.prepare(`
          INSERT INTO notifications (
            id, type, title, message, cameraId, locationId, 
            incidentId, detectionId, imageUrl, imageBase64, 
            plateNumber, timeDetected, reason, timestamp, read
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          warningNotificationId,
          'warning_created',
          warningTitle,
          warningMessage,
          cameraId,
          cameraLocationId,
          null, // incidentId
          detectionId,
          null, // imageUrl
          null, // imageBase64
          canonicalPlateNumber,
          timeDetected,
          'Illegal parking warning created',
          new Date().toISOString(),
          0 // not read
        );
      } catch (notifError) {
        console.error('Error creating warning notification:', notifError);
      }
    } else {
      // Update existing violation's warningExpiresAt
      db.prepare(`
        UPDATE violations 
        SET warningExpiresAt = ?
        WHERE id = ?
      `).run(expiresAt, violationId);
    }

    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(violationId);
    console.log(`✅ Automatic violation created: ${violationId} for plate ${canonicalPlateNumber} at ${cameraLocationId}`);
    
    return {
      ...violation,
      timeDetected: new Date(violation.timeDetected),
      timeIssued: violation.timeIssued ? new Date(violation.timeIssued) : null,
      warningExpiresAt: violation.warningExpiresAt ? new Date(violation.warningExpiresAt) : null,
      messageSent: messageSent || false,
      messageLogId: messageLogId || null
    };
  } catch (error) {
    console.error(`❌ Error creating automatic violation for ${plateNumber}:`, error);
    return null;
  }
}

router.get('/', (req, res) => {
  try {
    const { status, locationId, startDate, endDate, plateNumber, residentId } = req.query;
    
    let query = 'SELECT * FROM violations WHERE 1=1';
    const params = [];
    
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    
    if (locationId) {
      query += ' AND cameraLocationId = ?';
      params.push(locationId);
    }
    
    if (startDate) {
      query += ' AND timeDetected >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      // Add one day to endDate to include the entire end date
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      query += ' AND timeDetected < ?';
      params.push(endDateObj.toISOString());
    }

    if (residentId) {
      const plateRows = db.prepare('SELECT plateNumber FROM vehicles WHERE residentId = ?').all(residentId);
      const plates = plateRows.map((r) => r.plateNumber).filter(Boolean);
      if (plates.length === 0) {
        query += ' AND 1=0';
      } else {
        const ph = plates.map(() => '?').join(',');
        query += ` AND plateNumber IN (${ph})`;
        params.push(...plates);
      }
    }
    
    if (plateNumber) {
      query += ' AND plateNumber LIKE ?';
      params.push(`%${plateNumber}%`);
    }
    
    // Add pagination limit (default 100, max 500)
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    query += ' ORDER BY timeDetected DESC LIMIT ?';
    params.push(limit);
    
    const violations = db.prepare(query).all(...params);
    
    // Optimize: Batch fetch cameras, vehicles, and detections to avoid N+1 queries
    const locationIds = [...new Set(violations.map(v => v.cameraLocationId))];
    const plateNumbers = [...new Set(violations.map(v => v.plateNumber).filter(p => p && p !== 'NONE' && p !== 'BLUR'))];
    
    // Batch fetch cameras
    const camerasMap = new Map();
    if (locationIds.length > 0) {
      const placeholders = locationIds.map(() => '?').join(',');
      const cameras = db.prepare(`SELECT id, locationId FROM cameras WHERE locationId IN (${placeholders})`).all(...locationIds);
      cameras.forEach(camera => {
        camerasMap.set(camera.locationId, camera.id);
      });
    }
    
    // Batch fetch vehicles
    const vehiclesMap = new Map();
    if (plateNumbers.length > 0) {
      const placeholders = plateNumbers.map(() => '?').join(',');
      const vehicles = db.prepare(`SELECT * FROM vehicles WHERE plateNumber IN (${placeholders})`).all(...plateNumbers);
      vehicles.forEach(vehicle => {
        vehiclesMap.set(vehicle.plateNumber, vehicle);
      });
    }

    const violationIds = [...new Set(violations.map((v) => v.id))];
    const smsSentMap = new Map();
    if (violationIds.length > 0) {
      const ph = violationIds.map(() => '?').join(',');
      const smsRows = db
        .prepare(
          `SELECT violationId, MAX(sentAt) as smsSentAt FROM sms_logs WHERE status = 'sent' AND violationId IN (${ph}) GROUP BY violationId`,
        )
        .all(...violationIds);
      smsRows.forEach((row) => {
        if (row.smsSentAt) smsSentMap.set(row.violationId, row.smsSentAt);
      });
    }
    
    // Batch fetch recent detections (last grace period for all violations)
    const detectionsMap = new Map();
    if (locationIds.length > 0) {
      const gracePeriodAgo = new Date(Date.now() - getGracePeriodMinutes() * 60 * 1000).toISOString();
      const cameraIds = Array.from(camerasMap.values());
      if (cameraIds.length > 0) {
        const placeholders = cameraIds.map(() => '?').join(',');
        const detections = db.prepare(`
          SELECT d.*, c.locationId 
          FROM detections d
          JOIN cameras c ON d.cameraId = c.id
          WHERE d.cameraId IN (${placeholders})
          AND d.timestamp >= ?
          ORDER BY d.timestamp DESC
        `).all(...cameraIds, gracePeriodAgo);
        
        // Group detections by violation key (plateNumber-locationId)
        detections.forEach(detection => {
          const key = `${normalizePlateForMatch(detection.plateNumber)}-${detection.locationId}`;
          if (!detectionsMap.has(key)) {
            detectionsMap.set(key, detection);
          }
        });
      }
    }
    
    // Enrich violations with batched data
    const enrichedViolations = violations.map(violation => {
      const cameraId = camerasMap.get(violation.cameraLocationId);
      const detectionKey = `${normalizePlateForMatch(violation.plateNumber)}-${violation.cameraLocationId}`;
      const detection = detectionsMap.get(detectionKey);
      const vehicle = vehiclesMap.get(violation.plateNumber);
      const unregisteredUrgent =
        violation.plateNumber !== 'NONE' &&
        violation.plateNumber !== 'BLUR' &&
        !vehicle;
      
      // Build message based on violation type
      let message = '';
      if (violation.plateNumber === 'BLUR') {
        message = `Vehicle illegally parked at location ${violation.cameraLocationId}. License plate is visible but unclear or blurry - cannot be read. Immediate Barangay attention required at ${violation.cameraLocationId}.`;
      } else if (violation.plateNumber === 'NONE') {
        message = `Vehicle illegally parked at location ${violation.cameraLocationId}. License plate is not visible or readable. Immediate Barangay attention required at ${violation.cameraLocationId}.`;
      } else if (vehicle) {
        message = `Vehicle with plate ${violation.plateNumber} detected illegally parked at ${violation.cameraLocationId}. ${vehicle.ownerName ? `Owner: ${vehicle.ownerName}.` : ''} Immediate action required.`;
      } else {
        message = `Vehicle with plate ${violation.plateNumber} detected illegally parked at ${violation.cameraLocationId}. Vehicle is not registered in the system. Immediate Barangay attention required.`;
      }
      if (violation.status === 'warning' && !detection) {
        message = `${message} ${OUT_OF_VIEW_NOTE}`;
      }
      
      return {
        ...violation,
        timeDetected: new Date(violation.timeDetected),
        timeIssued: violation.timeIssued ? new Date(violation.timeIssued) : null,
        warningExpiresAt: clampWarningExpiresAtForResponse(violation),
        // Add detection image data
        imageUrl: detection ? detection.imageUrl : null,
        imageBase64: detection ? detection.imageBase64 : null,
        // Add message
        message: message,
        // Add detection details
        detectionId: detection ? detection.id : null,
        vehicleType: detection ? detection.class_name : null,
        unregisteredUrgent,
        smsSentAt: smsSentMap.has(violation.id) ? new Date(smsSentMap.get(violation.id)) : null,
      };
    });
    
    res.json(enrichedViolations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/assign', authenticateToken, requireRole('barangay_user', 'admin'), (req, res) => {
  try {
    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }
    if (violation.status !== 'warning') {
      return res.status(400).json({ error: 'Only active warnings can be assigned' });
    }

    const now = new Date().toISOString();
    const assigneeName = req.user?.name?.trim() || req.user?.email || 'Barangay User';
    const assignResult = db.prepare(`
      UPDATE violations
      SET assignedToUserId = ?, assignedToName = ?, assignedAt = ?
      WHERE id = ?
      AND (assignedToUserId IS NULL OR TRIM(assignedToUserId) = '' OR assignedToUserId = ?)
    `).run(req.user.id, assigneeName, now, req.params.id, req.user.id);

    if (!assignResult?.changes) {
      const current = db.prepare('SELECT assignedToUserId, assignedToName, assignedAt FROM violations WHERE id = ?').get(req.params.id);
      return res.status(409).json({
        error: `This warning is already assigned to ${current?.assignedToName || 'another user'}.`,
        assignedToUserId: current?.assignedToUserId || null,
        assignedToName: current?.assignedToName || null,
        assignedAt: current?.assignedAt || null,
      });
    }

    const updated = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    return res.json({
      ...updated,
      timeDetected: new Date(updated.timeDetected),
      timeIssued: updated.timeIssued ? new Date(updated.timeIssued) : null,
      warningExpiresAt: updated.warningExpiresAt ? new Date(updated.warningExpiresAt) : null,
      assignedAt: updated.assignedAt ? new Date(updated.assignedAt) : null,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/stats', (req, res) => {
  try {
    const { startDate, endDate, locationId } = req.query;
    
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (startDate) {
      whereClause += ' AND timeDetected >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      whereClause += ' AND timeDetected < ?';
      params.push(endDateObj.toISOString());
    }
    
    if (locationId) {
      whereClause += ' AND cameraLocationId = ?';
      params.push(locationId);
    }
    
    // Get total violations
    const total = db.prepare(`SELECT COUNT(*) as count FROM violations ${whereClause}`).get(...params);
    
    // Get violations by status
    const byStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM violations 
      ${whereClause}
      GROUP BY status
    `).all(...params);
    
    // Get violations by location
    const byLocation = db.prepare(`
      SELECT cameraLocationId, COUNT(*) as count 
      FROM violations 
      ${whereClause}
      GROUP BY cameraLocationId
      ORDER BY count DESC
    `).all(...params);
    
    // Get violations by date (daily)
    const byDate = db.prepare(`
      SELECT DATE(timeDetected) as date, COUNT(*) as count 
      FROM violations 
      ${whereClause}
      GROUP BY DATE(timeDetected)
      ORDER BY date DESC
      LIMIT 30
    `).all(...params);
    
    res.json({
      total: total.count,
      byStatus: byStatus.reduce((acc, item) => {
        acc[item.status] = item.count;
        return acc;
      }, {}),
      byLocation: byLocation,
      byDate: byDate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function parsePlatesParam(input) {
  if (!input) return [];
  const plates = String(input)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  return plates.slice(0, 250);
}

// Count warnings/tickets by plate (active-ish infractions).
// Query: /api/violations/count/by-plates?plates=ABC123,XYZ789
router.get('/count/by-plates', (req, res) => {
  try {
    const plates = parsePlatesParam(req.query.plates);
    if (!plates.length) return res.json([]);

    const plateKeys = plates.map((p) => String(p).replace(/\s+/g, '').toUpperCase());
    const ph = plateKeys.map(() => '?').join(',');
    const rows = db
      .prepare(`
        SELECT REPLACE(UPPER(plateNumber), ' ', '') AS plateNumber, COUNT(*) AS infractionCount
        FROM violations
        WHERE plateNumber NOT IN ('NONE', 'BLUR')
          AND REPLACE(UPPER(plateNumber), ' ', '') IN (${ph})
          AND status IN ('warning', 'pending', 'issued')
        GROUP BY REPLACE(UPPER(plateNumber), ' ', '')
      `)
      .all(...plateKeys);

    res.json(
      rows.map((r) => ({
        plateNumber: r.plateNumber,
        infractionCount: r.infractionCount,
      })),
    );
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Insert a random active warning with timeDetected in the past (random elapsed time since detection).
 * Adds a recent synthetic detection when a camera exists so auto-departure does not clear it immediately.
 * Disabled in production unless ALLOW_TEST_VIOLATION_SEED=true.
 */
router.post('/test-seed-active-warning', (req, res) => {
  try {
    if (!isTestViolationSeedAllowed()) {
      return res.status(403).json({
        error: 'Test warning seed is disabled (production). Set ALLOW_TEST_VIOLATION_SEED=true to enable.',
      });
    }

    const vehicles = db.prepare('SELECT plateNumber FROM vehicles').all();
    if (!vehicles.length) {
      return res.status(400).json({ error: 'No registered vehicles in the database' });
    }

    const cameras = db
      .prepare(
        `SELECT id, locationId FROM cameras 
 WHERE locationId IS NOT NULL AND TRIM(locationId) != ''`,
      )
      .all();

    const hasActiveConflict = db.prepare(`
      SELECT 1 FROM violations 
      WHERE plateNumber = ? AND cameraLocationId = ? AND status IN ('warning', 'pending')
    `);

    let plateNumber;
    let cameraLocationId;
    let cameraId = null;
    let attempts = 0;
    let picked = false;

    while (attempts < 50 && !picked) {
      attempts += 1;
      plateNumber = vehicles[Math.floor(Math.random() * vehicles.length)].plateNumber;
      if (cameras.length > 0) {
        const cam = cameras[Math.floor(Math.random() * cameras.length)];
        cameraLocationId = cam.locationId;
        cameraId = cam.id;
      } else {
        const locRows = db
          .prepare(
            `SELECT DISTINCT cameraLocationId as loc FROM violations 
             WHERE cameraLocationId IS NOT NULL AND TRIM(cameraLocationId) != '' LIMIT 100`,
          )
          .all();
        const locs = locRows.map((r) => r.loc).filter(Boolean);
        cameraLocationId =
          locs.length > 0 ? locs[Math.floor(Math.random() * locs.length)] : 'TEST-LOCATION-1';
        cameraId = null;
      }
      if (!hasActiveConflict.get(plateNumber, cameraLocationId)) {
        picked = true;
      }
    }

    if (!picked) {
      return res.status(409).json({
        error:
          'Could not pick a vehicle/location pair without an active warning; clear one or add vehicles.',
      });
    }

    const elapsedMinutes = Math.floor(Math.random() * 88) + 3;
    const now = Date.now();
    const timeDetected = new Date(now - elapsedMinutes * 60 * 1000).toISOString();
    const warningExpiresAt = new Date(
      new Date(timeDetected).getTime() + getGracePeriodMinutes() * 60 * 1000,
    ).toISOString();

    const violationId = `VIOL-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    db.prepare(`
      INSERT INTO violations (id, ticketId, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt)
      VALUES (?, NULL, ?, ?, ?, 'warning', ?)
    `).run(violationId, plateNumber, cameraLocationId, timeDetected, warningExpiresAt);

    let detectionId = null;
    if (cameraId) {
      detectionId = `DET-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const detTs = new Date(now - 60 * 1000).toISOString();
      try {
        db.prepare(`
          INSERT INTO detections (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name, imageBase64)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, 'car', NULL)
        `).run(detectionId, cameraId, plateNumber, detTs, 1.0);
      } catch (detErr) {
        console.warn('test-seed-active-warning: could not insert synthetic detection:', detErr.message);
        detectionId = null;
      }
    }

    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(violationId);

    return res.status(201).json({
      ...violation,
      timeDetected: new Date(violation.timeDetected),
      warningExpiresAt: violation.warningExpiresAt ? new Date(violation.warningExpiresAt) : null,
      elapsedMinutesSinceDetection: elapsedMinutes,
      syntheticDetectionId: detectionId,
      note: 'Test data — no owner SMS sent from this endpoint',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Insert a random UNREGISTERED active warning (immediate urgent / overdue).
 * Disabled in production unless ALLOW_TEST_VIOLATION_SEED=true.
 */
router.post('/test-seed-unregistered-warning', (req, res) => {
  try {
    if (!isTestViolationSeedAllowed()) {
      return res.status(403).json({
        error: 'Test warning seed is disabled (production). Set ALLOW_TEST_VIOLATION_SEED=true to enable.',
      });
    }

    const cameras = db
      .prepare(
        `SELECT id, locationId FROM cameras
         WHERE locationId IS NOT NULL AND TRIM(locationId) != ''`,
      )
      .all();

    let cameraLocationId = 'TEST-LOCATION-UNREG';
    let cameraId = null;
    if (cameras.length > 0) {
      const cam = cameras[Math.floor(Math.random() * cameras.length)];
      cameraLocationId = cam.locationId;
      cameraId = cam.id;
    }

    const existingPlates = new Set(
      db
        .prepare(`SELECT plateNumber FROM vehicles WHERE plateNumber IS NOT NULL AND TRIM(plateNumber) != ''`)
        .all()
        .map((r) => normalizePlateForMatch(r.plateNumber)),
    );

    let plateNumber = '';
    for (let i = 0; i < 30; i += 1) {
      const raw = `TST-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
      if (!existingPlates.has(normalizePlateForMatch(raw))) {
        plateNumber = raw;
        break;
      }
    }
    if (!plateNumber) {
      plateNumber = `UNR-${Date.now().toString().slice(-5)}`;
    }

    const hasActiveConflict = db.prepare(`
      SELECT 1 FROM violations
      WHERE plateNumber = ? AND cameraLocationId = ? AND status IN ('warning', 'pending')
    `).get(plateNumber, cameraLocationId);

    if (hasActiveConflict) {
      return res.status(409).json({
        error: 'Random unregistered plate already has an active warning at that location. Try again.',
      });
    }

    const nowIso = new Date().toISOString();
    const violationId = `VIOL-UNREG-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    db.prepare(`
      INSERT INTO violations (id, ticketId, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt)
      VALUES (?, NULL, ?, ?, ?, 'warning', ?)
    `).run(violationId, plateNumber, cameraLocationId, nowIso, nowIso);

    let detectionId = null;
    if (cameraId) {
      detectionId = `DET-UNREG-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        db.prepare(`
          INSERT INTO detections (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name, imageBase64)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, 'car', NULL)
        `).run(detectionId, cameraId, plateNumber, nowIso, 1.0);
      } catch (detErr) {
        console.warn('test-seed-unregistered-warning: could not insert synthetic detection:', detErr.message);
        detectionId = null;
      }
    }

    const notificationId = `NOTIF-UNREG-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    try {
      db.prepare(`
        INSERT INTO notifications (
          id, type, title, message, cameraId, locationId,
          incidentId, detectionId, imageUrl, imageBase64,
          plateNumber, timeDetected, reason, timestamp, read
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        notificationId,
        'unregistered_vehicle_urgent',
        'URGENT: Unregistered Vehicle Detected (Test)',
        `URGENT TEST: Vehicle with plate ${plateNumber} detected at ${cameraLocationId}. Immediate Barangay attention required.`,
        cameraId,
        cameraLocationId,
        null,
        detectionId,
        null,
        null,
        plateNumber,
        nowIso,
        'Test unregistered urgent warning',
        nowIso,
        0,
      );
    } catch (notifErr) {
      console.warn('test-seed-unregistered-warning: could not insert notification:', notifErr.message);
    }

    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(violationId);
    return res.status(201).json({
      ...violation,
      timeDetected: new Date(violation.timeDetected),
      warningExpiresAt: violation.warningExpiresAt ? new Date(violation.warningExpiresAt) : null,
      unregisteredUrgent: true,
      syntheticDetectionId: detectionId,
      note: 'Test data — unregistered urgent warning with immediate notification',
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Manually resend the owner SMS for an active warning (same template as automatic send).
 */
router.post('/:id/send-sms', async (req, res) => {
  try {
    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }
    if (violation.status !== 'warning') {
      return res.status(400).json({ error: 'SMS can only be sent for active warnings' });
    }
    const plate = violation.plateNumber;
    if (!plate || String(plate).toUpperCase() === 'NONE' || String(plate).toUpperCase() === 'BLUR') {
      return res.status(400).json({
        error: 'Cannot send SMS: license plate is missing or unreadable for this warning',
      });
    }

    const smsResult = await sendViolationSms(plate, violation.cameraLocationId, violation.id);

    const smsRow = db
      .prepare(
        `SELECT MAX(sentAt) as smsSentAt FROM sms_logs WHERE violationId = ? AND status = 'sent'`,
      )
      .get(violation.id);

    if (smsResult.success) {
      return res.json({
        success: true,
        messageLogId: smsResult.messageLogId || null,
        smsSentAt: smsRow?.smsSentAt || new Date().toISOString(),
      });
    }

    return res.status(502).json({
      success: false,
      error: smsResult.error || 'SMS send failed',
      messageLogId: smsResult.messageLogId || null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }
    const smsRow = db
      .prepare(
        `SELECT MAX(sentAt) as smsSentAt FROM sms_logs WHERE violationId = ? AND status = 'sent'`,
      )
      .get(req.params.id);
    res.json({
      ...violation,
      timeDetected: new Date(violation.timeDetected),
      timeIssued: violation.timeIssued ? new Date(violation.timeIssued) : null,
      warningExpiresAt: clampWarningExpiresAtForResponse(violation),
      smsSentAt: smsRow?.smsSentAt ? new Date(smsRow.smsSentAt) : null,
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { id, ticketId, plateNumber, cameraLocationId, status, warningExpiresAt } = req.body;
    
    if (!id || !plateNumber || !cameraLocationId || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Pre-registration check: Vehicle must be registered before violation can be created
    // Skip check if plateNumber is 'NONE' (unreadable plate - handled separately)
    if (plateNumber && plateNumber.toUpperCase() !== 'NONE') {
      const normalizedPlate = normalizePlateForMatch(plateNumber);
      const vehicle = db
        .prepare(`SELECT * FROM vehicles WHERE REPLACE(UPPER(plateNumber), ' ', '') = ?`)
        .get(normalizedPlate);
      if (!vehicle) {
        return res.status(400).json({ 
          error: 'Vehicle not registered',
          details: `Plate number ${plateNumber} is not registered in the system. Vehicle must be pre-registered before violations can be created.`
        });
      }
    }

    const timeDetected = new Date().toISOString();
    
    // If status is 'warning' and warningExpiresAt is not provided, set it to grace period from now
    let expiresAt = warningExpiresAt;
    
    if (status === 'warning' && !expiresAt) {
      const expiresDate = new Date();
      expiresDate.setMinutes(expiresDate.getMinutes() + getGracePeriodMinutes());
      expiresAt = expiresDate.toISOString();
    }
    
    const ownerSmsScheduledAt =
      status === 'warning' && plateNumber !== 'NONE' && plateNumber !== 'BLUR'
        ? computeOwnerSmsScheduledAtIso()
        : null;

    db.prepare(`
      INSERT INTO violations (
        id, ticketId, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt, ownerSmsScheduledAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ticketId || null,
      plateNumber,
      cameraLocationId,
      timeDetected,
      status,
      expiresAt || null,
      ownerSmsScheduledAt
    );

    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(id);
    const response = {
      ...violation,
      timeDetected: new Date(violation.timeDetected),
      timeIssued: violation.timeIssued ? new Date(violation.timeIssued) : null,
      warningExpiresAt: violation.warningExpiresAt ? new Date(violation.warningExpiresAt) : null
    };
    
    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', (req, res) => {
  try {
    const { status, timeIssued, warningExpiresAt } = req.body;
    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }

    db.prepare(`
      UPDATE violations 
      SET status = ?, timeIssued = ?, warningExpiresAt = ?
      WHERE id = ?
    `).run(
      status || violation.status,
      timeIssued || violation.timeIssued,
      warningExpiresAt !== undefined ? warningExpiresAt : violation.warningExpiresAt,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    res.json({
      ...updated,
      timeDetected: new Date(updated.timeDetected),
      timeIssued: updated.timeIssued ? new Date(updated.timeIssued) : null,
      warningExpiresAt: updated.warningExpiresAt ? new Date(updated.warningExpiresAt) : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const violation = db.prepare('SELECT * FROM violations WHERE id = ?').get(req.params.id);
    if (!violation) {
      return res.status(404).json({ error: 'Violation not found' });
    }

    db.prepare('DELETE FROM violations WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;



