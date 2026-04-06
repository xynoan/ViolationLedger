import express from 'express';
import db from '../database.js';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const { startDate, endDate, locationId } = req.query;
    
    // Build date filter
    let dateFilter = '';
    const params = [];
    
    if (startDate) {
      dateFilter += ' AND timestamp >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      dateFilter += ' AND timestamp < ?';
      params.push(endDateObj.toISOString());
    }
    
    // Build location filter for violations
    let violationLocationFilter = '';
    const violationParams = [...params];
    
    if (locationId) {
      violationLocationFilter = ' AND cameraLocationId = ?';
      violationParams.push(locationId);
    }

    // 1. USER ANALYTICS
    const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get();
    const usersByRole = db.prepare(`
      SELECT role, COUNT(*) as count 
      FROM users 
      GROUP BY role
    `).all();
    
    // 2. VEHICLE ANALYTICS
    const totalVehicles = db.prepare('SELECT COUNT(*) as count FROM vehicles').get();
    const vehiclesBySource = db.prepare(`
      SELECT dataSource, COUNT(*) as count 
      FROM vehicles 
      GROUP BY dataSource
    `).all();
    
    // Vehicle registration trends (by date)
    const vehicleRegistrations = db.prepare(`
      SELECT DATE(registeredAt) as date, COUNT(*) as count 
      FROM vehicles 
      WHERE registeredAt IS NOT NULL
      GROUP BY DATE(registeredAt)
      ORDER BY date DESC
      LIMIT 30
    `).all();
    
    // 3. VIOLATION ANALYTICS
    const violationWhere = `WHERE 1=1${dateFilter}${violationLocationFilter}`;
    
    const totalViolations = db.prepare(`SELECT COUNT(*) as count FROM violations ${violationWhere}`).get(...violationParams);
    const violationsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY status
    `).all(...violationParams);
    
    const violationsByLocation = db.prepare(`
      SELECT cameraLocationId, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY cameraLocationId
      ORDER BY count DESC
    `).all(...violationParams);
    
    // Violations over time (daily)
    const violationsOverTime = db.prepare(`
      SELECT DATE(timeDetected) as date, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY DATE(timeDetected)
      ORDER BY date DESC
      LIMIT 30
    `).all(...violationParams);
    
    // Violations by hour of day
    const violationsByHour = db.prepare(`
      SELECT CAST(strftime('%H', timeDetected) AS INTEGER) as hour, COUNT(*) as count 
      FROM violations 
      ${violationWhere}
      GROUP BY hour
      ORDER BY hour
    `).all(...violationParams);
    
    // 4. WARNING ANALYTICS
    const totalWarnings = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violations 
      ${violationWhere} AND status = 'warning'
    `).get(...violationParams);
    
    const warningsOverTime = db.prepare(`
      SELECT DATE(timeDetected) as date, COUNT(*) as count 
      FROM violations 
      ${violationWhere} AND status = 'warning'
      GROUP BY DATE(timeDetected)
      ORDER BY date DESC
      LIMIT 30
    `).all(...violationParams);
    
    // Warning conversion (warnings that became tickets)
    const warningsConverted = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violations 
      ${violationWhere} AND status IN ('issued', 'cleared')
    `).get(...violationParams);
    
    // 5. DETECTION ANALYTICS
    let detectionWhere = `WHERE 1=1`;
    const detectionParams = [];
    
    if (startDate) {
      detectionWhere += ' AND timestamp >= ?';
      detectionParams.push(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      detectionWhere += ' AND timestamp < ?';
      detectionParams.push(endDateObj.toISOString());
    }
    
    const totalDetections = db.prepare(`SELECT COUNT(*) as count FROM detections ${detectionWhere}`).get(...detectionParams);
    const detectionsByClass = db.prepare(`
      SELECT class_name, COUNT(*) as count 
      FROM detections 
      ${detectionWhere}
      GROUP BY class_name
    `).all(...detectionParams);
    
    const detectionsOverTime = db.prepare(`
      SELECT DATE(timestamp) as date, COUNT(*) as count 
      FROM detections 
      ${detectionWhere}
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
      LIMIT 30
    `).all(...detectionParams);
    
    // 6. SMS ANALYTICS
    let smsWhere = `WHERE 1=1`;
    const smsParams = [];
    
    if (startDate) {
      smsWhere += ' AND sentAt >= ?';
      smsParams.push(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      smsWhere += ' AND sentAt < ?';
      smsParams.push(endDateObj.toISOString());
    }
    
    const totalSMS = db.prepare(`SELECT COUNT(*) as count FROM sms_logs ${smsWhere}`).get(...smsParams);
    const smsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM sms_logs 
      ${smsWhere}
      GROUP BY status
    `).all(...smsParams);
    
    // 7. INCIDENT ANALYTICS
    let incidentWhere = `WHERE 1=1`;
    const incidentParams = [];
    
    if (startDate) {
      incidentWhere += ' AND timestamp >= ?';
      incidentParams.push(startDate);
    }
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      incidentWhere += ' AND timestamp < ?';
      incidentParams.push(endDateObj.toISOString());
    }
    
    const totalIncidents = db.prepare(`SELECT COUNT(*) as count FROM incidents ${incidentWhere}`).get(...incidentParams);
    const incidentsByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM incidents 
      ${incidentWhere}
      GROUP BY status
    `).all(...incidentParams);
    
    // 8. CAMERA ANALYTICS
    const totalCameras = db.prepare('SELECT COUNT(*) as count FROM cameras').get();
    const camerasByStatus = db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM cameras 
      GROUP BY status
    `).all();
    
    // 9. RECENT ACTIVITY (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    
    const recentViolations = db.prepare(`
      SELECT COUNT(*) as count 
      FROM violations 
      WHERE timeDetected >= ?
    `).get(sevenDaysAgo.toISOString());
    
    const recentVehicles = db.prepare(`
      SELECT COUNT(*) as count 
      FROM vehicles 
      WHERE registeredAt >= ?
    `).get(sevenDaysAgo.toISOString());
    
    const recentDetections = db.prepare(`
      SELECT COUNT(*) as count 
      FROM detections 
      WHERE timestamp >= ? AND class_name != 'none'
    `).get(sevenDaysAgo.toISOString());

    res.json({
      users: {
        total: totalUsers.count,
        byRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item.count;
          return acc;
        }, {})
      },
      vehicles: {
        total: totalVehicles.count,
        bySource: vehiclesBySource.reduce((acc, item) => {
          acc[item.dataSource || 'unknown'] = item.count;
          return acc;
        }, {}),
        registrationTrends: vehicleRegistrations
      },
      violations: {
        total: totalViolations.count,
        byStatus: violationsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {}),
        byLocation: violationsByLocation,
        overTime: violationsOverTime,
        byHour: violationsByHour
      },
      warnings: {
        total: totalWarnings.count,
        overTime: warningsOverTime,
        converted: warningsConverted.count,
        conversionRate: totalWarnings.count > 0 
          ? ((warningsConverted.count / totalWarnings.count) * 100).toFixed(2)
          : '0.00'
      },
      detections: {
        total: totalDetections.count,
        byClass: detectionsByClass.reduce((acc, item) => {
          acc[item.class_name || 'none'] = item.count;
          return acc;
        }, {}),
        overTime: detectionsOverTime
      },
      sms: {
        total: totalSMS.count,
        byStatus: smsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {})
      },
      incidents: {
        total: totalIncidents.count,
        byStatus: incidentsByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {})
      },
      cameras: {
        total: totalCameras.count,
        byStatus: camerasByStatus.reduce((acc, item) => {
          acc[item.status] = item.count;
          return acc;
        }, {})
      },
      recent: {
        violations: recentViolations.count,
        vehicles: recentVehicles.count,
        detections: recentDetections.count
      }
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

