import express from 'express';
import db from '../database.js';
import { sendViolationSms } from '../utils/smsService.js';

const router = express.Router();

/**
 * Grace period in minutes before a warning elapses (timer on Warnings UI; monitoring uses the same window).
 */
export const GRACE_PERIOD_MINUTES = 30;

function normalizePlateForMatch(plateNumber) {
  if (!plateNumber) return '';
  return String(plateNumber).replace(/\s+/g, '').toUpperCase();
}

/** Warnings never extend beyond grace after detection (fixes legacy / bad seed rows without mutating DB). */
function clampWarningExpiresAtForResponse(violation) {
  if (violation.status !== 'warning' || !violation.warningExpiresAt) {
    return violation.warningExpiresAt ? new Date(violation.warningExpiresAt) : null;
  }
  const detectedAt = new Date(violation.timeDetected);
  const cap = new Date(detectedAt.getTime() + GRACE_PERIOD_MINUTES * 60 * 1000);
  let w = new Date(violation.warningExpiresAt);
  if (w.getTime() > cap.getTime()) w = cap;
  if (w.getTime() < detectedAt.getTime()) w = cap;
  return w;
}

export async function createViolationFromDetection(plateNumber, cameraLocationId, detectionId = null) {
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
    expiresDate.setMinutes(expiresDate.getMinutes() + GRACE_PERIOD_MINUTES);
    const expiresAt = expiresDate.toISOString();
    
    let messageSent = false;
    let messageLogId = null;
    
    // Create violation only if it's a new violation
    if (true) {
      db.prepare(`
        INSERT INTO violations (id, ticketId, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        violationId,
        null, // ticketId (assigned later)
        canonicalPlateNumber,
        cameraLocationId,
        timeDetected,
        status,
        expiresAt
      );
      
      // Send SMS message to vehicle owner (only for new violations)
      try {
        const smsResult = await sendViolationSms(canonicalPlateNumber, cameraLocationId, violationId);
        if (smsResult.success) {
          messageSent = true;
          messageLogId = smsResult.messageLogId || null;
          console.log(`✅ SMS sent to owner for plate ${canonicalPlateNumber} (Log ID: ${smsResult.messageLogId || 'N/A'})`);
        } else {
          console.log(`⚠️  SMS not sent for plate ${canonicalPlateNumber}: ${smsResult.error}`);
        }
      } catch (smsError) {
        console.error(`❌ Error sending SMS for plate ${canonicalPlateNumber}:`, smsError);
      }
      
      // Create notification for new warning
      try {
        const camera = db.prepare('SELECT * FROM cameras WHERE locationId = ?').get(cameraLocationId);
        const cameraId = camera?.id || null;
        
        const warningNotificationId = `NOTIF-WARNING-${violationId}-${Date.now()}`;
        const warningTitle = `New Warning - ${canonicalPlateNumber}`;
        const warningMessage = `Illegal parking detected for vehicle ${canonicalPlateNumber} at ${cameraLocationId}. ${GRACE_PERIOD_MINUTES}-minute grace period started.${messageSent ? ' SMS message sent to owner.' : ' SMS message could not be sent to owner.'}`;
        
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
      const gracePeriodAgo = new Date(Date.now() - GRACE_PERIOD_MINUTES * 60 * 1000).toISOString();
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
        smsSentAt: smsSentMap.has(violation.id) ? new Date(smsSentMap.get(violation.id)) : null,
      };
    });
    
    res.json(enrichedViolations);
  } catch (error) {
    res.status(500).json({ error: error.message });
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
      expiresDate.setMinutes(expiresDate.getMinutes() + GRACE_PERIOD_MINUTES);
      expiresAt = expiresDate.toISOString();
    }
    
    db.prepare(`
      INSERT INTO violations (id, ticketId, plateNumber, cameraLocationId, timeDetected, status, warningExpiresAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      ticketId || null,
      plateNumber,
      cameraLocationId,
      timeDetected,
      status,
      expiresAt || null
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



