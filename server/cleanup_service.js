import db from './database.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs-extra';
import { unlink } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Cleanup Service
 * Automatically deletes empty detections (0 vehicles detected) older than 24 hours
 * to save storage space
 */
class CleanupService {
  constructor() {
    this.intervalId = null;
    this.isRunning = false;
    this.CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // Run every 6 hours
    this.DETECTION_RETENTION_HOURS = 24; // Delete empty detections older than 24 hours
    this.CAPTURED_IMAGES_DIR = join(__dirname, 'captured_images');
  }

  start() {
    if (this.isRunning) {
      console.log('⚠️  Cleanup service is already running');
      return;
    }

    console.log('🧹 Cleanup service started');
    this.isRunning = true;
    
    // Run immediately on start, then every 6 hours
    this.cleanupEmptyDetections();
    this.intervalId = setInterval(() => {
      this.cleanupEmptyDetections();
    }, this.CLEANUP_INTERVAL_MS);
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    console.log('🛑 Cleanup service stopped');
  }

  /**
   * Clean up empty detections older than 24 hours
   * Empty detections are those with class_name = 'none' (no vehicles detected)
   */
  async cleanupEmptyDetections() {
    try {
      // Calculate cutoff time (24 hours ago)
      const cutoffTime = new Date();
      cutoffTime.setHours(cutoffTime.getHours() - this.DETECTION_RETENTION_HOURS);
      const cutoffISO = cutoffTime.toISOString();
      
      // Find empty detections older than 24 hours
      // Empty detections have class_name = 'none' or plateNumber = 'NONE' with class_name = 'none'
      const emptyDetections = db.prepare(`
        SELECT id, imageUrl, timestamp 
        FROM detections 
        WHERE class_name = 'none' 
        AND timestamp < ?
        ORDER BY timestamp ASC
      `).all(cutoffISO);
      
      if (emptyDetections.length === 0) {
        return;
      }
      
      let deletedCount = 0;
      let imageDeletedCount = 0;
      let imageErrorCount = 0;
      
      for (const detection of emptyDetections) {
        try {
          // Check if detection is referenced by incidents or notifications
          const incidentRef = db.prepare('SELECT id FROM incidents WHERE detectionId = ?').get(detection.id);
          const notificationRef = db.prepare('SELECT id FROM notifications WHERE detectionId = ?').get(detection.id);
          
          // Skip if detection is referenced (don't delete if it's part of an incident or notification)
          if (incidentRef || notificationRef) {
            console.log(`⏭️  Skipping detection ${detection.id} - referenced by incident or notification`);
            continue;
          }
          
          // Delete associated image file if it exists
          if (detection.imageUrl) {
            try {
              const imagePath = join(this.CAPTURED_IMAGES_DIR, detection.imageUrl);
              if (fs.existsSync(imagePath)) {
                await unlink(imagePath);
                imageDeletedCount++;
                console.log(`🗑️  Deleted image: ${detection.imageUrl}`);
              }
            } catch (imageError) {
              imageErrorCount++;
              console.warn(`⚠️  Failed to delete image ${detection.imageUrl}:`, imageError.message);
              // Continue with detection deletion even if image deletion fails
            }
          }
          
          // Delete detection record
          db.prepare('DELETE FROM detections WHERE id = ?').run(detection.id);
          deletedCount++;
          
        } catch (error) {
          console.error(`❌ Error cleaning up detection ${detection.id}:`, error.message);
        }
      }
      
      if (deletedCount > 0) {
        console.log(`🧹 Cleanup: Deleted ${deletedCount} empty detection(s), ${imageDeletedCount} image(s)`);
      }
      
    } catch (error) {
      console.error('❌ Cleanup service error:', error);
    }
  }

  /**
   * Manual cleanup trigger (for testing or API endpoint)
   */
  async runCleanup() {
    await this.cleanupEmptyDetections();
  }
}

// Create singleton instance
const cleanupService = new CleanupService();

export default cleanupService;

