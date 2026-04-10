import db from './database.js';
import { shouldCreateNotification } from './routes/notifications.js';
import { GRACE_PERIOD_MINUTES, normalizePlateForMatch } from './routes/violations.js';

/** No plate+location match in this window ⇒ treat vehicle as departed; clears Active Warnings. */
const PRESENCE_LOOKBACK_MINUTES = 3;
const PRESENCE_LOOKBACK_MS = PRESENCE_LOOKBACK_MINUTES * 60 * 1000;
/** Avoid clearing a warning before the next capture / OCR can confirm presence. */
const MIN_WARNING_AGE_MS = 90 * 1000;
import { sendSmsMessage } from './utils/smsService.js';
import { analyzeVideoStream, processVideoDetectionResults } from './ai_detection_service.js';

/**
 * Monitoring service that runs every 15 seconds to:
 * 1. Resolve Active Warnings when the vehicle is no longer detected at that location (short lookback)
 * 2. Check if warnings have expired and vehicle is still present (notify Barangay)
 */
class MonitoringService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.RECHECK_INTERVAL_MS = 15 * 1000; // 15 seconds
  }

  start() {
    if (this.isRunning) {
      console.log('⚠️  Monitoring service is already running');
      return;
    }

    console.log('🔄 Monitoring service started');
    this.isRunning = true;
    this.startVideoAnalysis();
    
    // Run immediately on start, then every 15 seconds
    this.checkAndUpdate();
    this.intervalId = setInterval(() => {
      this.checkAndUpdate();
    }, this.RECHECK_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('🛑 Monitoring service stopped');
  }

  async startVideoAnalysis() {
    console.log('📹 Starting video analysis for all active cameras...');
    try {
      const cameras = db.prepare('SELECT * FROM cameras WHERE status = ?').all('online');
      for (const camera of cameras) {
        if (camera.streamUrl) {
          console.log(`[${camera.id}] Starting analysis for stream: ${camera.streamUrl}`);
          // We run this in the background and don't wait for it to finish
          analyzeVideoStream(camera.streamUrl, camera)
            .then(result => this.processVideoDetections(result, camera.id))
            .catch(error => console.error(`[${camera.id}] Video analysis failed:`, error));
        }
      }
    } catch (error) {
      console.error('❌ Error starting video analysis:', error);
    }
  }

  processVideoDetections(result, cameraId) {
    if (result.error) {
      console.error(`[${cameraId}] Video analysis returned an error:`, result.error);
      return;
    }
    
    console.log(`[${cameraId}] Processing ${result.detections.length} detections from video analysis.`);
    
    const detections = processVideoDetectionResults(result, cameraId);
    
    if (detections.length > 0) {
      const insert = db.prepare(`
        INSERT INTO detections (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name, imageBase64, plateVisible)
        VALUES (@id, @cameraId, @plateNumber, @timestamp, @confidence, @imageUrl, @bbox, @class_name, @imageBase64, @plateVisible)
      `);

      let savedCount = 0;
      for (const detection of detections) {
        try {
          insert.run(detection);
          savedCount += 1;
        } catch (error) {
          console.error(`Error inserting detection ${detection.id}:`, error);
        }
      }

      console.log(`[${cameraId}] Saved ${savedCount}/${detections.length} detections to the database.`);
    }
  }

  /**
   * After a capture batch, mark warnings as out-of-view when the plate is no longer seen.
   * @param {string} [locationId] — if omitted, evaluates all active warnings (monitoring tick).
   * @param {string[]} [_detectedPlates] — reserved for future use; detections are already in DB.
   */
  checkVehicleRemovalRealTime(locationId, _detectedPlates) {
    if (!locationId || locationId === 'UNKNOWN') {
      return 0;
    }
    return this.updateWarningVisibilityState(locationId);
  }

  /**
   * Keep warnings active; toggle an out-of-view note based on recent detections.
   * @param {string} [locationId] — limit to warnings at this location (e.g. after POST /captures/:cameraId).
   */
  updateWarningVisibilityState(locationId = null) {
    const warningsQuery = locationId
      ? `SELECT * FROM violations WHERE status = 'warning' AND cameraLocationId = ?`
      : `SELECT * FROM violations WHERE status = 'warning'`;
    const activeWarnings = locationId
      ? db.prepare(warningsQuery).all(locationId)
      : db.prepare(warningsQuery).all();

    if (activeWarnings.length === 0) {
      return 0;
    }

    const cutoffIso = new Date(Date.now() - PRESENCE_LOOKBACK_MS).toISOString();

    const recentRows = db.prepare(`
      SELECT DISTINCT d.plateNumber, c.locationId
      FROM detections d
      JOIN cameras c ON d.cameraId = c.id
      WHERE d.timestamp > ?
      AND d.plateNumber != 'NONE'
      AND d.plateNumber != 'BLUR'
      AND d.class_name != 'none'
      AND c.locationId IS NOT NULL
    `).all(cutoffIso);

    const presenceMap = new Map();
    for (const row of recentRows) {
      const key = `${normalizePlateForMatch(row.plateNumber)}-${row.locationId}`;
      presenceMap.set(key, true);
    }

    for (const warning of activeWarnings) {
      const hasManual = db.prepare(`
        SELECT 1 FROM detections
        WHERE cameraId = 'MANUAL-UPLOAD-CAM'
        AND plateNumber = ?
        AND timestamp > ?
        AND plateNumber NOT IN ('NONE', 'BLUR')
      `).get(warning.plateNumber, cutoffIso);
      if (hasManual) {
        const key = `${normalizePlateForMatch(warning.plateNumber)}-${warning.cameraLocationId}`;
        presenceMap.set(key, true);
      }
    }

    let markedOutOfViewCount = 0;
    let restoredInViewCount = 0;

    for (const warning of activeWarnings) {
      const key = `${normalizePlateForMatch(warning.plateNumber)}-${warning.cameraLocationId}`;
      const age = Date.now() - new Date(warning.timeDetected).getTime();
      if (age < MIN_WARNING_AGE_MS) {
        continue;
      }
      if (presenceMap.has(key)) {
        restoredInViewCount += 1;
        continue;
      }
      markedOutOfViewCount += 1;
      console.log(
        `⏸️  Warning ${warning.id} currently out-of-view: plate ${warning.plateNumber} not detected at ${warning.cameraLocationId} in last ${PRESENCE_LOOKBACK_MINUTES}m.`
      );
    }

    return { markedOutOfViewCount, restoredInViewCount };
  }

  async checkAndUpdate() {
    try {
      const visibilityUpdate = this.updateWarningVisibilityState();
      const markedOutOfViewCount = visibilityUpdate.markedOutOfViewCount || 0;
      const restoredInViewCount = visibilityUpdate.restoredInViewCount || 0;

      // Get all active warnings (refresh after departures)
      const activeWarnings = db.prepare(`
        SELECT * FROM violations 
        WHERE status = 'warning'
      `).all();

      if (activeWarnings.length === 0) {
        if (markedOutOfViewCount > 0 || restoredInViewCount > 0) {
          console.log(
            `ℹ️  Monitoring check: no active warnings left (${markedOutOfViewCount} marked out-of-view, ${restoredInViewCount} restored in-view).`
          );
        } else {
          console.log('ℹ️  Monitoring check: no active warnings found.');
        }
        return;
      }

      // Get all recent detections (last 15 minutes) with their camera locations
      // Exclude 'NONE' (not visible) and 'BLUR' (blurry) - only count readable plates
      const fifteenMinutesAgo = new Date();
      fifteenMinutesAgo.setMinutes(fifteenMinutesAgo.getMinutes() - 15);
      const recentDetections = db.prepare(`
        SELECT DISTINCT d.plateNumber, d.cameraId, c.locationId
        FROM detections d
        JOIN cameras c ON d.cameraId = c.id
        WHERE d.timestamp > ? 
        AND d.plateNumber != 'NONE'
        AND d.plateNumber != 'BLUR'
        AND d.class_name != 'none'
      `).all(fifteenMinutesAgo.toISOString());

      // Create a map of recent detections by plate number and location
      const detectionMap = new Map();
      recentDetections.forEach(detection => {
        if (detection.locationId) {
          const key = `${detection.plateNumber}-${detection.locationId}`;
          detectionMap.set(key, true);
        }
      });

      // Include manual-upload detections: violations from image upload have
      // detections with cameraId = 'MANUAL-UPLOAD-CAM' (no cameras row), so they
      // were excluded above. Treat them as "still present" for the full grace period.
      const gracePeriodAgo = new Date();
      gracePeriodAgo.setMinutes(gracePeriodAgo.getMinutes() - GRACE_PERIOD_MINUTES);
      for (const warning of activeWarnings) {
        const hasManualUploadDetection = db.prepare(`
          SELECT 1 FROM detections
          WHERE cameraId = 'MANUAL-UPLOAD-CAM'
          AND plateNumber = ?
          AND timestamp > ?
          AND (plateNumber NOT IN ('NONE', 'BLUR'))
        `).get(warning.plateNumber, gracePeriodAgo.toISOString());
        if (hasManualUploadDetection) {
          const key = `${warning.plateNumber}-${warning.cameraLocationId}`;
          detectionMap.set(key, true);
        }
      }

      let notifiedCount = 0;
      let warningsTransitionedToPending = 0;

      for (const warning of activeWarnings) {
        const key = `${warning.plateNumber}-${warning.cameraLocationId}`;
        const isStillPresent = detectionMap.has(key);
        const now = new Date();
        const expiresAt = warning.warningExpiresAt ? new Date(warning.warningExpiresAt) : null;
        const isExpired = expiresAt && now >= expiresAt;

        console.log(
          `🔍 Monitoring check for violation ${warning.id}: plate=${warning.plateNumber}, location=${warning.cameraLocationId}, ` +
          `expiresAt=${expiresAt ? expiresAt.toISOString() : 'N/A'}, isExpired=${Boolean(isExpired)}, isStillPresent=${isStillPresent}`
        );

        if (isExpired && !isStillPresent) {
          console.log(
            `ℹ️  Violation ${warning.id} is expired but vehicle is no longer detected at ${warning.cameraLocationId}. ` +
            'No Barangay notification/SMS will be sent.'
          );
        }

        // Vehicle still present after grace period - notify Barangay
        if (isExpired && isStillPresent) {
          // Check if notification already exists for this violation
          const existingNotification = db.prepare(`
            SELECT * FROM notifications 
            WHERE type = 'warning_expired' 
            AND detectionId IS NULL
            AND plateNumber = ?
            AND locationId = ?
            AND read = 0
          `).get(warning.plateNumber, warning.cameraLocationId);

          if (existingNotification) {
            console.log(
              `ℹ️  Skipping new notification/SMS for violation ${warning.id}: ` +
              'existing unread warning_expired notification already present ' +
              `(notificationId=${existingNotification.id}).`
            );
          }

          if (!existingNotification) {
            // Vehicle is still present after grace period
            const vehicleStillPresent = true;
            
            // Get the most recent detection for this plate at this location
            const camera = db.prepare(`
              SELECT id FROM cameras WHERE locationId = ? LIMIT 1
            `).get(warning.cameraLocationId);
            
            let detectionId = null;
            let imageUrl = null;
            let imageBase64 = null;
            let cameraId = null;
            
            if (camera) {
              cameraId = camera.id;
              const recentDetection = db.prepare(`
                SELECT * FROM detections 
                WHERE cameraId = ? 
                AND plateNumber = ? 
                AND plateNumber != 'NONE'
                AND plateNumber != 'BLUR'
                AND class_name != 'none'
                ORDER BY timestamp DESC 
                LIMIT 1
              `).get(camera.id, warning.plateNumber);
              
              if (recentDetection) {
                detectionId = recentDetection.id;
                imageUrl = recentDetection.imageUrl;
                imageBase64 = recentDetection.imageBase64;
              }
            }

            // Check notification preferences before creating notification
            const user = db.prepare('SELECT id FROM users LIMIT 1').get();
            const userId = user ? user.id : null;
            
            if (!userId) {
              console.log('ℹ️  Skipping notification: no users found to check preferences for warning_expired.');
            }

            if (userId && shouldCreateNotification(userId, 'warning_expired')) {
              // Create notification
              const notificationId = `NOTIF-${Date.now()}-${warning.id}`;
              const notificationTitle = 'Vehicle Still Present After Warning';
              const notificationMessage = `Vehicle with plate ${warning.plateNumber} is still illegally parked at ${warning.cameraLocationId} after the ${GRACE_PERIOD_MINUTES}-minute grace period. Immediate Barangay action required.`;

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
                  null, // incidentId
                  detectionId,
                  imageUrl,
                  imageBase64,
                  warning.plateNumber,
                  warning.timeDetected,
                  `Vehicle still present after ${GRACE_PERIOD_MINUTES} minutes`,
                  new Date().toISOString(),
                  0 // not read
                );
                notifiedCount++;
                console.log(`🔔 Created notification ${notificationId} - Vehicle still present after ${GRACE_PERIOD_MINUTES} minutes`);
              } catch (notifError) {
                console.error(`❌ Error creating notification for violation ${warning.id}:`, notifError);
              }
            } else {
              console.log(`ℹ️  Notification skipped (preferences disabled or no user): warning_expired`);
            }

            // Send follow-up SMS to active Barangay users so they can ticket
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
                console.log(
                  `📱 Preparing to send follow-up SMS to ${enforcers.length} Barangay user(s) for plate ${warning.plateNumber} (violation ${warning.id}).`
                );
                const message = `Vehicle with plate ${warning.plateNumber} was warned but is still illegally parked at ${warning.cameraLocationId} after the ${GRACE_PERIOD_MINUTES}-minute grace period. You may now ticket this vehicle.`;

                for (const user of enforcers) {
                  const result = await sendSmsMessage(user.contactNumber, message);
                  if (result.success) {
                    console.log(
                      `✅ Follow-up SMS sent to Barangay user ${user.id} (${user.contactNumber}) for plate ${warning.plateNumber} (violation ${warning.id})`
                    );
                  } else {
                    console.log(
                      `⚠️  Failed to send follow-up SMS to Barangay user ${user.id} (${user.contactNumber}) for plate ${warning.plateNumber}: ${result.error}`
                    );
                  }
                }
              } else {
                console.log(
                  'ℹ️  No active Barangay users with contact numbers found for follow-up SMS.'
                );
              }
            } catch (smsError) {
              console.error(
                `❌ Error sending follow-up SMS to Barangay users for plate ${warning.plateNumber} (violation ${warning.id}):`,
                smsError
              );
            }

            // Move violation to 'pending' so it no longer counts as an active warning
            try {
              db.prepare(`
                UPDATE violations
                SET status = 'pending'
                WHERE id = ?
              `).run(warning.id);
              warningsTransitionedToPending += 1;
            } catch (statusError) {
              console.error(
                `❌ Error updating violation ${warning.id} status to 'pending' after grace period:`,
                statusError
              );
            }
          }
        }
      }

      if (notifiedCount > 0 || markedOutOfViewCount > 0 || restoredInViewCount > 0 || warningsTransitionedToPending > 0) {
        console.log(
          `✅ Monitoring check complete: ${markedOutOfViewCount} marked out-of-view, ${restoredInViewCount} restored in-view, ${notifiedCount} notified, ${warningsTransitionedToPending} moved to pending`
        );
      } else {
        console.log(`✅ Monitoring check complete: No updates needed`);
      }
    } catch (error) {
      console.error('❌ Error in monitoring check:', error);
    }
  }
}

// Export singleton instance
const monitoringService = new MonitoringService();
export default monitoringService;

