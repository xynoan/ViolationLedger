import express from 'express';
import db from '../database.js';

const router = express.Router();

function getStatements() {
  return {
    getAll: db.prepare('SELECT * FROM notifications ORDER BY timestamp DESC'),
    getUnread: db.prepare('SELECT * FROM notifications WHERE read = 0 ORDER BY timestamp DESC'),
    getById: db.prepare('SELECT * FROM notifications WHERE id = ?'),
    markAsRead: db.prepare('UPDATE notifications SET read = 1 WHERE id = ?'),
    markAllAsRead: db.prepare('UPDATE notifications SET read = 1'),
    delete: db.prepare('DELETE FROM notifications WHERE id = ?'),
  };
}

router.get('/', (req, res) => {
  try {
    const { unread, limit } = req.query;
    const statements = getStatements();
    
    let notifications;
    if (unread === 'true') {
      notifications = statements.getUnread.all();
    } else {
      notifications = statements.getAll.all();
    }
    
    // Apply pagination limit (default 100, max 500)
    const maxLimit = Math.min(parseInt(limit) || 100, 500);
    notifications = notifications.slice(0, maxLimit);
    
    res.json(notifications.map(notif => ({
      ...notif,
      read: notif.read === 1,
      timestamp: new Date(notif.timestamp),
      timeDetected: notif.timeDetected ? new Date(notif.timeDetected) : null
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const statements = getStatements();
    const notification = statements.getById.get(req.params.id);
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    res.json({
      ...notification,
      read: notification.read === 1,
      timestamp: new Date(notification.timestamp),
      timeDetected: notification.timeDetected ? new Date(notification.timeDetected) : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id/read', (req, res) => {
  try {
    const statements = getStatements();
    const notification = statements.getById.get(req.params.id);
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    statements.markAsRead.run(req.params.id);
    
    res.json({
      ...notification,
      read: true,
      timestamp: new Date(notification.timestamp),
      timeDetected: notification.timeDetected ? new Date(notification.timeDetected) : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/read-all', (req, res) => {
  try {
    const statements = getStatements();
    statements.markAllAsRead.run();
    
    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const statements = getStatements();
    const notification = statements.getById.get(req.params.id);
    
    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    statements.delete.run(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/preferences/:userId', (req, res) => {
  try {
    const preferences = db.prepare('SELECT * FROM notification_preferences WHERE userId = ?').get(req.params.userId);
    
    if (!preferences) {
      // Return default preferences if none exist
      return res.json({
        userId: req.params.userId,
        plate_not_visible: true,
        warning_expired: true,
        vehicle_detected: true,
        incident_created: true,
      });
    }
    
    res.json({
      userId: preferences.userId,
      plate_not_visible: preferences.plate_not_visible === 1,
      warning_expired: preferences.warning_expired === 1,
      vehicle_detected: preferences.vehicle_detected === 1,
      incident_created: preferences.incident_created === 1,
      updatedAt: new Date(preferences.updatedAt),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/preferences/:userId', (req, res) => {
  try {
    const { plate_not_visible, warning_expired, vehicle_detected, incident_created } = req.body;
    const now = new Date().toISOString();
    
    // Check if preferences exist
    const existing = db.prepare('SELECT * FROM notification_preferences WHERE userId = ?').get(req.params.userId);
    
    if (existing) {
      db.prepare(`
        UPDATE notification_preferences 
        SET plate_not_visible = ?,
            warning_expired = ?,
            vehicle_detected = ?,
            incident_created = ?,
            updatedAt = ?
        WHERE userId = ?
      `).run(
        plate_not_visible ? 1 : 0,
        warning_expired ? 1 : 0,
        vehicle_detected ? 1 : 0,
        incident_created ? 1 : 0,
        now,
        req.params.userId
      );
    } else {
      db.prepare(`
        INSERT INTO notification_preferences (userId, plate_not_visible, warning_expired, vehicle_detected, incident_created, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        req.params.userId,
        plate_not_visible !== false ? 1 : 0,
        warning_expired !== false ? 1 : 0,
        vehicle_detected !== false ? 1 : 0,
        incident_created !== false ? 1 : 0,
        now
      );
    }
    
    res.json({
      success: true,
      message: 'Notification preferences updated',
      preferences: {
        userId: req.params.userId,
        plate_not_visible: plate_not_visible !== false,
        warning_expired: warning_expired !== false,
        vehicle_detected: vehicle_detected !== false,
        incident_created: incident_created !== false,
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Check if notification type should be created based on user preferences
 * @param {string} userId - User ID
 * @param {string} notificationType - Notification type (plate_not_visible, warning_expired, etc.)
 * @returns {boolean} - True if notification should be created
 */
export function shouldCreateNotification(userId, notificationType) {
  try {
    const preferences = db.prepare('SELECT * FROM notification_preferences WHERE userId = ?').get(userId);
    
    // If no preferences exist, default to enabled (true)
    if (!preferences) {
      return true;
    }
    
    // Map notification type to preference field
    const preferenceMap = {
      'plate_not_visible': 'plate_not_visible',
      'warning_expired': 'warning_expired',
      'vehicle_detected': 'vehicle_detected',
      'incident_created': 'incident_created',
    };
    
    const preferenceField = preferenceMap[notificationType];
    if (!preferenceField) {
      // Unknown notification type, default to enabled
      return true;
    }
    
    return preferences[preferenceField] === 1;
  } catch (error) {
    console.error('Error checking notification preferences:', error);
    // Default to enabled on error
    return true;
  }
}

export default router;

