import express from 'express';
import db from '../database.js';
import crypto from 'crypto';
import { authenticateToken } from '../middleware/auth.js';
import { sendSmsMessage } from '../utils/smsService.js';

const router = express.Router();

const TOKEN_EXPIRY_24H = 24 * 60 * 60 * 1000;
const TOKEN_EXPIRY_30_DAYS = 30 * 24 * 60 * 60 * 1000;
const TWOFA_CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes

// In-memory store for pending 2FA: tempTokenId -> { userId, code, expiresAt }
const twoFASessions = new Map();

function hashTrustedDeviceToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function generateToken(userId, options = {}) {
  const expiresInMs = options.trustDevice ? TOKEN_EXPIRY_30_DAYS : TOKEN_EXPIRY_24H;
  const payload = {
    userId,
    timestamp: Date.now(),
    expiresInMs,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    const expiresInMs = payload.expiresInMs ?? TOKEN_EXPIRY_24H;
    if (Date.now() - payload.timestamp > expiresInMs) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function generateSixDigitCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
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

    // Block inactive users from logging in
    if (user.status && user.status !== 'active') {
      return res.status(403).json({ error: 'Account is deactivated. Please contact an administrator.' });
    }

    const contactNumber = (user.contactNumber || '').trim();
    if (contactNumber) {
      // If this device is trusted (valid trustedDeviceToken), skip 2FA.
      const trustedDeviceToken = (req.body?.trustedDeviceToken || '').toString().trim();
      if (trustedDeviceToken) {
        try {
          const tokenHash = hashTrustedDeviceToken(trustedDeviceToken);
          const trusted = db
            .prepare('SELECT id, expiresAt FROM trusted_devices WHERE userId = ? AND tokenHash = ?')
            .get(user.id, tokenHash);

          if (trusted) {
            const expiresAt = Number(trusted.expiresAt || 0);
            if (expiresAt && Date.now() < expiresAt) {
              // Touch lastUsedAt for audit/housekeeping
              try {
                db.prepare('UPDATE trusted_devices SET lastUsedAt = ? WHERE id = ?').run(Date.now(), trusted.id);
              } catch (e) {
                // Non-critical
              }

              const token = generateToken(user.id);
              return res.json({
                token,
                user: {
                  id: user.id,
                  email: user.email,
                  name: user.name || user.email,
                  role: user.role || 'barangay_user',
                  status: user.status || 'active',
                  mustResetPassword: !!user.mustResetPassword,
                },
              });
            }

            // Expired: clean it up
            try {
              db.prepare('DELETE FROM trusted_devices WHERE id = ?').run(trusted.id);
            } catch (e) {
              // Ignore cleanup errors
            }
          }
        } catch (e) {
          // Ignore trust-device errors; fall back to normal 2FA flow
        }
      }

      // 2FA: send 6-digit code to user's contact number
      const code = generateSixDigitCode();
      const tempTokenId = crypto.randomBytes(24).toString('hex');
      const expiresAt = Date.now() + TWOFA_CODE_EXPIRY_MS;
      twoFASessions.set(tempTokenId, { userId: user.id, code, expiresAt });

      const message = `Your ViolationLedger login code is: ${code}. It expires in 10 minutes. Do not share this code.`;
      const sendResult = await sendSmsMessage(contactNumber, message);
      if (!sendResult.success) {
        twoFASessions.delete(tempTokenId);
        console.error('2FA send failed:', sendResult.error);
        return res.status(503).json({
          error: 'Could not send verification code to your contact number. Please try again or contact support.',
        });
      }

      return res.json({
        requires2FA: true,
        tempToken: tempTokenId,
        message: 'Verification code sent to your contact number.',
      });
    }

    // No 2FA: issue token immediately
    const token = generateToken(user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role || 'barangay_user',
        status: user.status || 'active',
        mustResetPassword: !!user.mustResetPassword,
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

// POST /api/auth/verify-2fa - verify 6-digit code and issue token
router.post('/verify-2fa', (req, res) => {
  try {
    const { tempToken, code, trustDevice } = req.body;

    if (!tempToken || !code) {
      return res.status(400).json({ error: 'Temp token and code are required' });
    }

    const session = twoFASessions.get(tempToken);
    if (!session) {
      return res.status(401).json({ error: 'Invalid or expired verification session. Please log in again.' });
    }
    if (Date.now() > session.expiresAt) {
      twoFASessions.delete(tempToken);
      return res.status(401).json({ error: 'Verification code has expired. Please log in again.' });
    }
    const normalizedCode = String(code).trim().replace(/\s/g, '');
    if (normalizedCode !== session.code) {
      return res.status(401).json({ error: 'Invalid verification code.' });
    }

    twoFASessions.delete(tempToken);

    let user;
    try {
      user = db.prepare('SELECT * FROM users WHERE id = ?').get(session.userId);
    } catch (dbError) {
      console.error('Database error in verify-2fa:', dbError);
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const token = generateToken(user.id, { trustDevice: !!trustDevice });
    let trustedDeviceTokenOut;
    let trustedDeviceExpiresAt;

    if (trustDevice) {
      try {
        trustedDeviceTokenOut = crypto.randomBytes(32).toString('hex');
        const tokenHash = hashTrustedDeviceToken(trustedDeviceTokenOut);
        trustedDeviceExpiresAt = Date.now() + TOKEN_EXPIRY_30_DAYS;
        const trustedId = crypto.randomBytes(16).toString('hex');

        db.prepare(`
          INSERT INTO trusted_devices (id, userId, tokenHash, createdAt, expiresAt, lastUsedAt)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(trustedId, user.id, tokenHash, Date.now(), trustedDeviceExpiresAt, Date.now());
      } catch (e) {
        // If persistence fails, still allow login (trust just won't persist)
        trustedDeviceTokenOut = undefined;
        trustedDeviceExpiresAt = undefined;
      }
    }

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name || user.email,
        role: user.role || 'barangay_user',
        status: user.status || 'active',
        mustResetPassword: !!user.mustResetPassword,
      },
      ...(trustedDeviceTokenOut
        ? { trustedDeviceToken: trustedDeviceTokenOut, trustedDeviceExpiresAt }
        : {}),
    });
  } catch (error) {
    console.error('Verify-2FA error:', error);
    res.status(500).json({
      error: 'Failed to verify code',
      details: error?.message || String(error),
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
      status: user.status || 'active',
      mustResetPassword: !!user.mustResetPassword,
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ 
      error: 'Failed to verify token',
      details: error?.message || String(error)
    });
  }
});

// POST /api/auth/change-password - change own password (clears mustResetPassword)
router.post('/change-password', authenticateToken, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Current password and new password are required' });
    }

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    const currentHash = crypto.createHash('sha256').update(currentPassword).digest('hex');
    if (user.password !== currentHash) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = crypto.createHash('sha256').update(newPassword).digest('hex');
    db.prepare('UPDATE users SET password = ?, mustResetPassword = 0 WHERE id = ?').run(newHash, userId);

    res.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Failed to change password',
      details: error?.message || String(error),
    });
  }
});

export default router;

