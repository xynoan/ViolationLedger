import express from 'express';
import db from '../database.js';
import crypto from 'crypto';

const router = express.Router();

function generateToken(userId) {
  const payload = {
    userId,
    timestamp: Date.now(),
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    // Token expires after 24 hours
    if (Date.now() - payload.timestamp > 24 * 60 * 60 * 1000) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    // Hash the provided password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    // Find user by email
    let user;
    try {
      user = db.prepare('SELECT * FROM users WHERE email = ?').get(email.toLowerCase().trim());
    } catch (dbError) {
      console.error('Database error in login:', dbError);
      return res.status(500).json({ 
        error: 'Database error',
        details: dbError?.message || String(dbError)
      });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Verify password
    if (user.password !== passwordHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    // Generate token
    const token = generateToken(user.id);
    
    // Return user data (without password)
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role || 'barangay_user',
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Failed to login',
      details: error?.message || String(error)
    });
  }
});

// GET /api/auth/verify
router.get('/verify', (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }
    
    const token = authHeader.substring(7);
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    
    // Get user from database
    let user;
    try {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(payload.userId);
    } catch (dbError) {
      console.error('Database error in verify:', dbError);
      return res.status(500).json({ 
        error: 'Database error',
        details: dbError?.message || String(dbError)
      });
    }
    
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }
    
    // Return user data (without password)
    res.json({
      id: user.id,
      email: user.email,
      name: user.name || user.email,
      role: user.role || 'barangay_user',
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ 
      error: 'Failed to verify token',
      details: error?.message || String(error)
    });
  }
});

export default router;

