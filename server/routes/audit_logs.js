import express from 'express';
import db from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { getClientIP } from '../utils/ipUtils.js';

const router = express.Router();

router.post('/log', authenticateToken, (req, res) => {
  try {
    const { action, resource, resourceId, details } = req.body;
    
    if (!action) {
      return res.status(400).json({ error: 'Action is required' });
    }
    
    const logId = `AUDIT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const timestamp = new Date().toISOString();
    
    db.prepare(`
      INSERT INTO audit_logs (
        id, userId, userEmail, userName, userRole, 
        action, resource, resourceId, details, 
        ipAddress, userAgent, timestamp
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      logId,
      req.user.id,
      req.user.email,
      req.user.name || req.user.email,
      req.user.role || 'barangay_user',
      action,
      resource || 'frontend',
      resourceId || null,
      JSON.stringify(details || {}),
      getClientIP(req),
      req.headers['user-agent'] || 'unknown',
      timestamp
    );
    
    res.json({ success: true, id: logId });
  } catch (error) {
    console.error('Error logging frontend activity:', error);
    res.status(500).json({ error: error.message });
  }
});

// All other routes require authentication and audit logging
router.use(authenticateToken);
router.use(auditLog);

router.get('/', requireRole('admin'), (req, res) => {
  try {
    const { 
      userId, 
      action, 
      startDate, 
      endDate,
      page = 1,
      limit = 50
    } = req.query;
    
    // Build WHERE clause
    const conditions = [];
    const params = [];
    
    if (userId) {
      conditions.push('userId = ?');
      params.push(userId);
    }
    
    if (action) {
      conditions.push('action = ?');
      params.push(action);
    }
    
    if (startDate) {
      conditions.push('timestamp >= ?');
      params.push(startDate);
    }
    
    if (endDate) {
      const endDateObj = new Date(endDate);
      endDateObj.setDate(endDateObj.getDate() + 1);
      conditions.push('timestamp < ?');
      params.push(endDateObj.toISOString());
    }
    
    const whereClause = conditions.length > 0 
      ? `WHERE ${conditions.join(' AND ')}`
      : '';
    
    // Get total count
    const countResult = db.prepare(`
      SELECT COUNT(*) as total 
      FROM audit_logs 
      ${whereClause}
    `).get(...params);
    const total = countResult.total;
    
    // Get paginated results
    const offset = (parseInt(page) - 1) * parseInt(limit);
    params.push(parseInt(limit), offset);
    
    const logs = db.prepare(`
      SELECT * 
      FROM audit_logs 
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `).all(...params);
    
    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/', requireRole('admin'), (req, res) => {
  try {
    const deleted = db.prepare('DELETE FROM audit_logs').run();
    
    res.json({
      success: true,
      message: 'All audit logs have been cleared',
      deletedCount: deleted.changes
    });
  } catch (error) {
    console.error('Error clearing audit logs:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/stats', requireRole('admin'), (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
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
    
    // Total logs
    const totalLogs = db.prepare(`
      SELECT COUNT(*) as count 
      FROM audit_logs 
      WHERE 1=1 ${dateFilter}
    `).get(...params);
    
    // Logs by action
    const logsByAction = db.prepare(`
      SELECT action, COUNT(*) as count 
      FROM audit_logs 
      WHERE 1=1 ${dateFilter}
      GROUP BY action
      ORDER BY count DESC
    `).all(...params);
    
    // Logs by user
    const logsByUser = db.prepare(`
      SELECT userId, userEmail, userName, userRole, COUNT(*) as count 
      FROM audit_logs 
      WHERE 1=1 ${dateFilter}
      GROUP BY userId
      ORDER BY count DESC
      LIMIT 10
    `).all(...params);
    
    // Recent activity (last 24 hours)
    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    
    const recentActivity = db.prepare(`
      SELECT COUNT(*) as count 
      FROM audit_logs 
      WHERE timestamp >= ?
    `).get(oneDayAgo.toISOString());
    
    res.json({
      total: totalLogs.count,
      byAction: logsByAction.reduce((acc, item) => {
        acc[item.action] = item.count;
        return acc;
      }, {}),
      byUser: logsByUser,
      recent24h: recentActivity.count
    });
  } catch (error) {
    console.error('Error fetching audit log stats:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

