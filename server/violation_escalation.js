import db from './database.js';
import { shouldCreateNotification } from './routes/notifications.js';
import { sendSmsMessage } from './utils/smsService.js';
import { getGracePeriodMinutes } from './runtime_config.js';

function normalizePlateForMatch(plateNumber) {
  if (!plateNumber) return '';
  return String(plateNumber).replace(/\s+/g, '').toUpperCase();
}

/**
 * True if this plate was read at this location at or after grace end (`warningExpiresAt`).
 * Same logic as the Barangay post-grace gate (Recent plate / monitoring).
 */
export function hasPostGracePlatePresence(warning, graceEndsAtIso) {
  if (!graceEndsAtIso || !warning?.plateNumber) return false;
  const loc = warning.cameraLocationId;
  if (!loc || String(loc).trim() === '') return false;

  const normalizedPlate = normalizePlateForMatch(warning.plateNumber);

  const cameraRow = db
    .prepare(`
    SELECT 1 AS ok FROM detections d
    JOIN cameras c ON d.cameraId = c.id
    WHERE REPLACE(UPPER(d.plateNumber), ' ', '') = ?
      AND c.locationId = ?
      AND d.timestamp >= ?
      AND d.plateNumber NOT IN ('NONE', 'BLUR')
      AND d.class_name != 'none'
    LIMIT 1
  `)
    .get(normalizedPlate, loc, graceEndsAtIso);

  if (cameraRow) return true;

  const manualRow = db
    .prepare(`
    SELECT 1 FROM detections
    WHERE cameraId = 'MANUAL-UPLOAD-CAM'
      AND plateNumber = ?
      AND timestamp >= ?
      AND plateNumber NOT IN ('NONE', 'BLUR')
  `)
    .get(warning.plateNumber, graceEndsAtIso);

  return Boolean(manualRow);
}

/**
 * When grace ended and plate still present (same gate as GET /detections/recent-plates / monitoring):
 * flip warning → for_ticket once, notify, SMS Barangay.
 * @returns {Promise<{ status: 'upgraded'|'skipped', reason?: string, notificationCreated?: boolean }>}
 */
export async function escalateWarningToForTicketIfEligible(warning) {
  if (!warning?.id) {
    return { status: 'skipped', reason: 'invalid' };
  }
  if (warning.status === 'for_ticket') {
    return { status: 'skipped', reason: 'already_for_ticket' };
  }
  if (warning.status !== 'warning') {
    return { status: 'skipped', reason: 'not_warning' };
  }

  const now = new Date();
  const expiresAt = warning.warningExpiresAt ? new Date(warning.warningExpiresAt) : null;
  const isExpired = expiresAt && now >= expiresAt;
  const postGracePresence = warning.warningExpiresAt
    ? hasPostGracePlatePresence(warning, warning.warningExpiresAt)
    : false;

  if (!isExpired) {
    return { status: 'skipped', reason: 'grace_not_ended' };
  }
  if (!postGracePresence) {
    return { status: 'skipped', reason: 'no_presence' };
  }

  const upgraded = db
    .prepare(`
    UPDATE violations
    SET status = 'for_ticket'
    WHERE id = ?
      AND status = 'warning'
  `)
    .run(warning.id);

  if (upgraded.changes !== 1) {
    return { status: 'skipped', reason: 'not_upgraded' };
  }

  const camera = db
    .prepare(`
    SELECT id FROM cameras WHERE locationId = ? LIMIT 1
  `)
    .get(warning.cameraLocationId);

  let detectionId = null;
  let imageUrl = null;
  let imageBase64 = null;
  let cameraId = null;

  if (camera) {
    cameraId = camera.id;
    const recentDetection = db
      .prepare(`
      SELECT * FROM detections
      WHERE cameraId = ?
        AND plateNumber = ?
        AND plateNumber != 'NONE'
        AND plateNumber != 'BLUR'
        AND class_name != 'none'
      ORDER BY timestamp DESC
      LIMIT 1
    `)
      .get(camera.id, warning.plateNumber);

    if (recentDetection) {
      detectionId = recentDetection.id;
      imageUrl = recentDetection.imageUrl;
      imageBase64 = recentDetection.imageBase64;
    }
  }

  const user = db.prepare('SELECT id FROM users LIMIT 1').get();
  const userId = user ? user.id : null;

  let notificationCreated = false;

  if (userId && shouldCreateNotification(userId, 'warning_expired')) {
    const gracePeriodMinutes = getGracePeriodMinutes();
    const notificationId = `NOTIF-${Date.now()}-${warning.id}`;
    const notificationTitle = 'Vehicle Still Present After Warning';
    const notificationMessage = `Vehicle with plate ${warning.plateNumber} is still illegally parked at ${warning.cameraLocationId} after the ${gracePeriodMinutes}-minute grace period. Status: FOR TICKET.`;

    try {
      db.prepare(`
        INSERT INTO notifications (
          id, type, title, message, cameraId, locationId,
          incidentId, detectionId, imageUrl, imageBase64,
          plateNumber, timeDetected, reason, timestamp, read
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        notificationId,
        'warning_expired',
        notificationTitle,
        notificationMessage,
        cameraId,
        warning.cameraLocationId,
        null,
        detectionId,
        imageUrl,
        imageBase64,
        warning.plateNumber,
        warning.timeDetected,
        `Vehicle still present after ${gracePeriodMinutes} minutes (for_ticket)`,
        new Date().toISOString(),
        0,
      );
      notificationCreated = true;
      console.log(`🔔 Created notification ${notificationId} — escalated ${warning.id} to for_ticket`);
    } catch (notifError) {
      console.error(`❌ Error creating notification for violation ${warning.id}:`, notifError);
    }
  } else {
    console.log(`ℹ️  Notification skipped (preferences disabled or no user): warning_expired`);
  }

  try {
    const enforcers = db
      .prepare(`
      SELECT id, name, contactNumber
      FROM users
      WHERE role = 'barangay_user'
        AND status = 'active'
        AND contactNumber IS NOT NULL
        AND TRIM(contactNumber) != ''
    `)
      .all();

    if (enforcers && enforcers.length > 0) {
      const message = `Vehicle with plate ${warning.plateNumber} was warned but is still illegally parked at ${warning.cameraLocationId} after the ${getGracePeriodMinutes()}-minute grace period. You may now ticket this vehicle.`;
      for (const u of enforcers) {
        const result = await sendSmsMessage(u.contactNumber, message);
        if (result.success) {
          console.log(
            `✅ Follow-up SMS sent to Barangay user ${u.id} (${u.contactNumber}) for plate ${warning.plateNumber} (violation ${warning.id}, for_ticket)`,
          );
        } else {
          console.log(`⚠️  Failed to send follow-up SMS to Barangay user ${u.id}: ${result.error}`);
        }
      }
    }
  } catch (smsError) {
    console.error(
      `❌ Error sending follow-up SMS for plate ${warning.plateNumber} (violation ${warning.id}):`,
      smsError,
    );
  }

  return { status: 'upgraded', notificationCreated };
}
