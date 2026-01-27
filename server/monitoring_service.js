import db from './database.js';
import { shouldCreateNotification } from './routes/notifications.js';

/**
 * Monitoring service that runs every 15 seconds to:
 * 1. Check if vehicles in warnings have been removed (mark as resolved)
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

  /**
   * Real-time vehicle removal check - called immediately when new detections arrive
   * Checks if vehicles with active warnings at a specific location have been removed
   * @param {string} locationId - Location ID to check
   * @param {Array<string>} detectedPlates - Array of plate numbers detected in the latest capture
   * @returns {number} - Number of violations resolved
   */
  checkVehicleRemovalRealTime(locationId, detectedPlates) {
    try {
      if (!locationId) {
        return 0;
      }

      // Handle null/undefined detectedPlates
      const plates = detectedPlates || [];

      // Get all active warnings for this location
      const activeWarnings = db.prepare(`
        SELECT * FROM violations 
        WHERE status = 'warning'
        AND cameraLocationId = ?
      `).all(locationId);

      if (activeWarnings.length === 0) {
        return 0;
      }

      // Create a set of detected plates for quick lookup
      // If plates array is empty, all warnings should be resolved (no vehicles detected)
      const detectedPlatesSet = new Set(plates.map(p => p.toUpperCase()));

      let resolvedCount = 0;

      for (const warning of activeWarnings) {
        const plateUpper = warning.plateNumber.toUpperCase();
        
        // If the plate is not in the detected plates (or no plates detected), vehicle has been removed
        if (!detectedPlatesSet.has(plateUpper)) {
          try {
            db.prepare(`
              UPDATE violations 
              SET status = 'cleared' 
              WHERE id = ?
            `).run(warning.id);
            resolvedCount++;
            console.log(`⚡ [REAL-TIME] Marked violation ${warning.id} as cleared - vehicle ${warning.plateNumber} removed from ${locationId}`);
          } catch (error) {
            console.error(`❌ Error marking violation ${warning.id} as resolved:`, error);
          }
        }
      }

      if (resolvedCount > 0) {
        console.log(`⚡ [REAL-TIME] Resolved ${resolvedCount} violation(s) at ${locationId} - vehicle(s) removed`);
      }

      return resolvedCount;
    } catch (error) {
      console.error('❌ Error in real-time vehicle removal check:', error);
      return 0;
    }
  }

  async checkAndUpdate() {
    try {
      // Get all active warnings
      const activeWarnings = db.prepare(`
        SELECT * FROM violations 
        WHERE status = 'warning'
      `).all();

      if (activeWarnings.length === 0) {
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

      let resolvedCount = 0;
      let notifiedCount = 0;

      for (const warning of activeWarnings) {
        const key = `${warning.plateNumber}-${warning.cameraLocationId}`;
        const isStillPresent = detectionMap.has(key);
        const now = new Date();
        const expiresAt = warning.warningExpiresAt ? new Date(warning.warningExpiresAt) : null;
        const isExpired = expiresAt && now >= expiresAt;

        // Case 1: Vehicle has been removed - mark as cleared
        if (!isStillPresent) {
          try {
            db.prepare(`
              UPDATE violations 
              SET status = 'cleared' 
              WHERE id = ?
            `).run(warning.id);
            resolvedCount++;
            console.log(`✅ Marked violation ${warning.id} as cleared - vehicle removed`);
          } catch (error) {
            console.error(`❌ Error marking violation ${warning.id} as resolved:`, error);
          }
        }
        // Case 2: Vehicle still present after 30 minutes - notify Barangay
        else if (isExpired && isStillPresent) {
          // Check if notification already exists for this violation
          const existingNotification = db.prepare(`
            SELECT * FROM notifications 
            WHERE type = 'warning_expired' 
            AND detectionId IS NULL
            AND plateNumber = ?
            AND locationId = ?
            AND read = 0
          `).get(warning.plateNumber, warning.cameraLocationId);

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
            
            if (userId && shouldCreateNotification(userId, 'warning_expired')) {
              // Create notification
              const notificationId = `NOTIF-${Date.now()}-${warning.id}`;
              const notificationTitle = 'Vehicle Still Present After Warning';
              const notificationMessage = `Vehicle with plate ${warning.plateNumber} is still illegally parked at ${warning.cameraLocationId} after the 30-minute grace period. Immediate Barangay action required.`;

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
                  'Vehicle still present after 30 minutes',
                  new Date().toISOString(),
                  0 // not read
                );
                notifiedCount++;
                console.log(`🔔 Created notification ${notificationId} - Vehicle still present after 30 minutes`);
              } catch (notifError) {
                console.error(`❌ Error creating notification for violation ${warning.id}:`, notifError);
              }
            } else {
              console.log(`ℹ️  Notification skipped (preferences disabled or no user): warning_expired`);
            }
          }
        }
      }

      if (resolvedCount > 0 || notifiedCount > 0) {
        console.log(`✅ Monitoring check complete: ${resolvedCount} resolved, ${notifiedCount} notified`);
      } else {
        console.log('✅ Monitoring check complete: No updates needed');
      }
    } catch (error) {
      console.error('❌ Error in monitoring check:', error);
    }
  }
}

// Export singleton instance
const monitoringService = new MonitoringService();
export default monitoringService;

