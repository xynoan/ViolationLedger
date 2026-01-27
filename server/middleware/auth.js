import db from '../database.js';

/**
 * Middleware to verify authentication token and get user
 */
export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  
  const token = authHeader.substring(7);
  
  // Simple token verification (matches auth.js)
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    // Token expires after 24 hours
    if (Date.now() - payload.timestamp > 24 * 60 * 60 * 1000) {
      return res.status(401).json({ error: 'Token expired' });
    }
    
    // Get user from database
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role || 'barangay_user'
    };
    
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Middleware to check if user has required role
 */
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`
      });
    }
    
    next();
  };
}

