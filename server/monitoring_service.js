import db from './database.js';
import { normalizePlateForMatch } from './routes/violations.js';
import {
  escalateWarningToForTicketIfEligible,
  hasPostGracePlatePresence,
} from './violation_escalation.js';
import {
  sendUnregisteredViolationSmsToBarangay,
  sendViolationSms,
} from './utils/smsService.js';
import {
  getOwnerSmsDelayConfig,
  getPostGraceVerificationMinutes,
  setOwnerSmsDelayDisabledForDemo,
} from './runtime_config.js';

/** No plate+location match in this window ⇒ treat vehicle as departed; clears Active Warnings. */
const PRESENCE_LOOKBACK_MINUTES = 3;
const PRESENCE_LOOKBACK_MS = PRESENCE_LOOKBACK_MINUTES * 60 * 1000;
/** Avoid clearing a warning before the next capture / OCR can confirm presence. */
const MIN_WARNING_AGE_MS = 90 * 1000;
import { analyzeVideoStream, processVideoDetectionResults } from './ai_detection_service.js';

/**
 * Monitoring service that runs every 15 seconds to:
 * 1. Resolve Active Warnings when the vehicle is no longer detected at that location (short lookback)
 * 2. Check if warnings have expired and vehicle is still present (notify Barangay)
 * 3. After grace + post-grace verification window, if the plate was never seen at/after grace end, clear the warning
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

  getOwnerSmsDelayConfig() {
    return getOwnerSmsDelayConfig();
  }

  setDisableOwnerSmsDelayForDemo(disabled) {
    const updatedConfig = setOwnerSmsDelayDisabledForDemo(disabled);
    console.log(
      `⚙️  Owner SMS delay demo mode: ${updatedConfig.disabledForDemo ? 'disabled (send immediately)' : `enabled (${updatedConfig.delayMinutes} minutes)`}`,
    );
    return updatedConfig;
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
      ? `SELECT * FROM violations WHERE status IN ('warning', 'for_ticket') AND cameraLocationId = ?`
      : `SELECT * FROM violations WHERE status IN ('warning', 'for_ticket')`;
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

      // Warnings + for_ticket: owner SMS may still be pending after escalation; keep processing until sent/logged.
      const activeWarnings = db.prepare(`
        SELECT * FROM violations 
        WHERE status IN ('warning', 'for_ticket')
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

      let notifiedCount = 0;
      let warningsAutoCleared = 0;
      let ownerSmsSentCount = 0;

      for (const warning of activeWarnings) {
        const now = new Date();
        const expiresAt = warning.warningExpiresAt ? new Date(warning.warningExpiresAt) : null;
        const isExpired = expiresAt && now >= expiresAt;
        const postGracePresence = warning.warningExpiresAt
          ? hasPostGracePlatePresence(warning, warning.warningExpiresAt)
          : false;
        const hasPostGraceDetection = Boolean(isExpired && postGracePresence);
        const clearanceMinutes = getPostGraceVerificationMinutes();
        const verificationEndsAt =
          expiresAt && warning.warningExpiresAt
            ? new Date(expiresAt.getTime() + clearanceMinutes * 60 * 1000)
            : null;
        const shouldAutoClearNoPresence =
          verificationEndsAt &&
          now >= verificationEndsAt &&
          !postGracePresence;
        const hasReadablePlate =
          warning.plateNumber &&
          warning.plateNumber !== 'NONE' &&
          warning.plateNumber !== 'BLUR';

        if (hasReadablePlate) {
          const normalizedPlate = normalizePlateForMatch(warning.plateNumber);
          const registeredVehicle = db
            .prepare(`SELECT 1 FROM vehicles WHERE REPLACE(UPPER(plateNumber), ' ', '') = ? LIMIT 1`)
            .get(normalizedPlate);
          const alreadySent = db.prepare(`
            SELECT 1 FROM sms_logs
            WHERE violationId = ?
              AND status = 'sent'
            LIMIT 1
          `).get(warning.id);
          const smsDelayConfig = getOwnerSmsDelayConfig();
          const smsScheduleAt = warning.ownerSmsScheduledAt
            ? new Date(warning.ownerSmsScheduledAt)
            : new Date(
                new Date(warning.timeDetected).getTime() + smsDelayConfig.delayMinutes * 60 * 1000,
              );
          const smsDue = smsDelayConfig.disabledForDemo ? true : now >= smsScheduleAt;
          if (!alreadySent && smsDue) {
            try {
              const smsResult = registeredVehicle
                ? await sendViolationSms(
                    warning.plateNumber,
                    warning.cameraLocationId,
                    warning.id,
                  )
                : await sendUnregisteredViolationSmsToBarangay(
                    warning.plateNumber,
                    warning.cameraLocationId,
                    warning.id,
                  );
              if (smsResult?.success) {
                ownerSmsSentCount += 1;
                console.log(
                  registeredVehicle
                    ? `✅ Delayed owner SMS sent for violation ${warning.id} (plate ${warning.plateNumber})`
                    : `✅ Delayed Barangay SMS sent for unregistered violation ${warning.id} (plate ${warning.plateNumber})`,
                );
              } else {
                console.log(
                  registeredVehicle
                    ? `⚠️  Delayed owner SMS failed for violation ${warning.id}: ${smsResult?.error || 'unknown error'}`
                    : `⚠️  Delayed Barangay SMS failed for unregistered violation ${warning.id}: ${smsResult?.error || 'unknown error'}`,
                );
              }
            } catch (smsError) {
              console.error(`❌ Delayed scheduled SMS error for violation ${warning.id}:`, smsError);
            }
          }
        }

        console.log(
          `🔍 Monitoring check for violation ${warning.id}: plate=${warning.plateNumber}, location=${warning.cameraLocationId}, ` +
          `expiresAt=${expiresAt ? expiresAt.toISOString() : 'N/A'}, isExpired=${Boolean(isExpired)}, hasPostGraceDetection=${hasPostGraceDetection}`
        );

        if (isExpired && !hasPostGraceDetection) {
          console.log(
            `ℹ️  Violation ${warning.id}: grace ended but no readable plate detection at ${warning.cameraLocationId} ` +
            'at or after grace end — no Barangay notification/SMS.'
          );
        }

        // Escalate once when grace ended and plate is still seen at/after grace (same gate as Recent plate / post-grace presence).
        const shouldEscalateForTicket =
          warning.status === 'warning' && isExpired && postGracePresence;

        if (shouldEscalateForTicket) {
          const esc = await escalateWarningToForTicketIfEligible(warning);
          if (esc.status === 'upgraded' && esc.notificationCreated) {
            notifiedCount += 1;
          }
        }

        if (shouldAutoClearNoPresence && warning.status === 'warning') {
          try {
            db.prepare(`
              UPDATE violations
              SET status = 'cleared'
              WHERE id = ?
                AND status = 'warning'
            `).run(warning.id);
            warningsAutoCleared += 1;
            console.log(
              `✅ Auto-cleared warning ${warning.id} (plate ${warning.plateNumber}): no detection at/after grace end within ${clearanceMinutes}m verification window after grace.`
            );
          } catch (clearErr) {
            console.error(`❌ Error auto-clearing violation ${warning.id}:`, clearErr);
          }
        }
      }

      if (
        notifiedCount > 0 ||
        markedOutOfViewCount > 0 ||
        restoredInViewCount > 0 ||
        warningsAutoCleared > 0 ||
        ownerSmsSentCount > 0
      ) {
        console.log(
          `✅ Monitoring check complete: ${markedOutOfViewCount} marked out-of-view, ${restoredInViewCount} restored in-view, ${ownerSmsSentCount} owner SMS sent, ${notifiedCount} notified, ${warningsAutoCleared} auto-cleared`
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

