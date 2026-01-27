import db from '../database.js';
import { getClientIP } from '../utils/ipUtils.js';

/**
 * Middleware to log user activities to audit_logs table
 * Should be used after authenticateToken middleware
 */
export function auditLog(req, res, next) {
  // Only log if user is authenticated
  if (!req.user) {
    return next();
  }
  
  // Capture original res.json to intercept responses
  const originalJson = res.json.bind(res);
  
  res.json = function(data) {
    // Log the activity after response is sent
    setImmediate(() => {
      try {
        const action = getActionFromRequest(req);
        const resource = getResourceFromRequest(req);
        const resourceId = getResourceIdFromRequest(req);
        const details = JSON.stringify({
          method: req.method,
          path: req.path,
          query: req.query,
          body: sanitizeBody(req.body),
          statusCode: res.statusCode
        });
        
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
          resource,
          resourceId,
          details,
          getClientIP(req),
          req.headers['user-agent'] || 'unknown',
          timestamp
        );
      } catch (error) {
        // Don't fail the request if logging fails
        console.error('Error logging audit:', error);
      }
    });
    
    return originalJson(data);
  };
  
  next();
}

/**
 * Determine action type from request
 */
function getActionFromRequest(req) {
  const method = req.method.toUpperCase();
  const path = req.path.toLowerCase();
  
  // Map HTTP methods to actions
  if (method === 'GET') {
    if (path.includes('login') || path.includes('verify')) return 'login';
    if (path.includes('logout')) return 'logout';
    return 'view';
  }
  
  if (method === 'POST') {
    if (path.includes('login')) return 'login';
    if (path.includes('capture')) return 'capture';
    if (path.includes('upload')) return 'upload';
    return 'create';
  }
  
  if (method === 'PUT' || method === 'PATCH') {
    return 'update';
  }
  
  if (method === 'DELETE') {
    return 'delete';
  }
  
  return 'unknown';
}

/**
 * Determine resource type from request path
 * More accurate detection by checking exact path patterns
 * Note: req.path is relative to the route mount point (e.g., /api/cameras -> /cameras or just /)
 */
function getResourceFromRequest(req) {
  // Get the original URL to check full path
  const originalUrl = req.originalUrl || req.url || '';
  const path = originalUrl.toLowerCase();
  
  // Also check req.path which is relative to route
  const routePath = (req.path || '').toLowerCase();
  
  // Extract resource from path - check both full path and route-relative path
  const pathToCheck = routePath || path;
  const segments = pathToCheck.split('/').filter(p => p && p !== 'api');
  
  if (segments.length === 0) return 'root';
  
  const firstSegment = segments[0];
  
  // Map route segments to resources
  const resourceMap = {
    'cameras': 'camera',
    'vehicles': 'vehicle',
    'violations': 'violation',
    'detections': 'detection',
    'incidents': 'incident',
    'notifications': 'notification',
    'users': 'user',
    'audit-logs': 'audit_log',
    'captures': 'capture',
    'upload': 'upload',
    'health': 'health',
    'analytics': 'analytics',
    'settings': 'settings',
    'auth': 'authentication',
    'sms': 'sms',
  };
  
  // Check for exact match
  if (resourceMap[firstSegment]) {
    // Special case: don't log the log endpoint itself
    if (firstSegment === 'audit-logs' && segments[1] === 'log') {
      return 'audit_logging';
    }
    return resourceMap[firstSegment];
  }
  
  // Fallback: check if path contains resource keywords
  const pathStr = pathToCheck;
  if (pathStr.includes('camera')) return 'camera';
  if (pathStr.includes('vehicle')) return 'vehicle';
  if (pathStr.includes('violation')) return 'violation';
  if (pathStr.includes('detection')) return 'detection';
  if (pathStr.includes('incident')) return 'incident';
  if (pathStr.includes('notification')) return 'notification';
  if (pathStr.includes('user')) return 'user';
  if (pathStr.includes('audit')) return 'audit_log';
  if (pathStr.includes('capture')) return 'capture';
  if (pathStr.includes('upload')) return 'upload';
  if (pathStr.includes('health')) return 'health';
  if (pathStr.includes('analytics')) return 'analytics';
  if (pathStr.includes('setting')) return 'settings';
  if (pathStr.includes('auth') || pathStr.includes('login')) return 'authentication';
  if (pathStr.includes('sms')) return 'sms';
  
  return 'unknown';
}

/**
 * Extract resource ID from request
 */
function getResourceIdFromRequest(req) {
  // Check URL params
  if (req.params && req.params.id) {
    return req.params.id;
  }
  
  if (req.params && req.params.cameraId) {
    return req.params.cameraId;
  }
  
  if (req.params && req.params.vehicleId) {
    return req.params.vehicleId;
  }
  
  // Check body
  if (req.body && req.body.id) {
    return req.body.id;
  }
  
  return null;
}

/**
 * Sanitize request body to remove sensitive data
 */
function sanitizeBody(body) {
  if (!body || typeof body !== 'object') {
    return body;
  }
  
  const sanitized = { ...body };
  
  // Remove sensitive fields
  if (sanitized.password) {
    sanitized.password = '***';
  }
  
  if (sanitized.token) {
    sanitized.token = '***';
  }
  
  if (sanitized.imageData) {
    sanitized.imageData = '[base64 image data]';
  }
  
  if (sanitized.imageBase64) {
    sanitized.imageBase64 = '[base64 image data]';
  }
  
  return sanitized;
}

