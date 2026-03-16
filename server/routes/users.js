import express from 'express';
import db from '../database.js';
import crypto from 'crypto';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';
import { sendActivationEmailStub } from '../utils/emailStub.js';

const router = express.Router();

router.use(authenticateToken);
router.use(auditLog);
router.get('/', requireRole('admin'), (req, res) => {
  try {
    const users = db.prepare(`
      SELECT id, email, name, role, contactNumber, status, createdAt 
      FROM users 
      ORDER BY createdAt DESC
    `).all();
    
    res.json(users);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', requireRole('admin'), (req, res) => {
  try {
    const user = db.prepare(`
      SELECT id, email, name, role, contactNumber, status, createdAt 
      FROM users 
      WHERE id = ?
    `).get(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(user);
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { email, password, name, role, contactNumber } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Name is required' });
    }
    
    // Allow admin to create encoder or barangay_user (never admin via UI)
    const allowedRoles = ['encoder', 'barangay_user'];
    const userRole = role && allowedRoles.includes(role) ? role : 'encoder';
    
    // Check if email already exists
    const existingUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
    if (existingUser) {
      return res.status(400).json({ error: 'Email already exists' });
    }
    
    // Hash password
    const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
    
    // Generate user ID
    const userId = `USER-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    const now = new Date().toISOString();
    
    // Insert user into database
    db.prepare(`
      INSERT INTO users (id, email, password, name, role, viberNumber, createdAt, status, contactNumber, mustResetPassword)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      email.toLowerCase().trim(),
      passwordHash,
      String(name).trim(),
      userRole,
      null,
      now,
      'active',
      contactNumber ? String(contactNumber).trim() : null,
      1
    );
    
    // Create default notification preferences for new user
    db.prepare(`
      INSERT INTO notification_preferences (userId, plate_not_visible, warning_expired, vehicle_detected, incident_created, updatedAt)
      VALUES (?, 1, 1, 1, 1, ?)
    `).run(userId, now);
    
    // Return user without password
    const newUser = db.prepare(`
      SELECT id, email, name, role, contactNumber, status, createdAt 
      FROM users 
      WHERE id = ?
    `).get(userId);
    
    // Send activation email (real SMTP if configured, else stub logs to console)
    try {
      await sendActivationEmailStub(newUser, password);
    } catch (emailError) {
      console.error('Error sending activation email:', emailError);
    }
    
    res.status(201).json(newUser);
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', requireRole('admin'), (req, res) => {
  try {
    const { email, password, name, role, contactNumber, status } = req.body;
    const userId = req.params.id;
    
    // Check if user exists
    const existingUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!existingUser) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    // Only allow updating to encoder role - no role changes to admin/barangay_user
    let updateRole = existingUser.role;
    if (role === 'encoder') {
      updateRole = 'encoder';
    }
    
    // Check email uniqueness if changing email
    if (email && email.toLowerCase().trim() !== existingUser.email) {
      const emailUser = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase().trim());
      if (emailUser && emailUser.id !== userId) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }
    
    // Build update query dynamically
    const updates = [];
    const values = [];
    
    if (email) {
      updates.push('email = ?');
      values.push(email.toLowerCase().trim());
    }
    
    if (name !== undefined) {
      updates.push('name = ?');
      values.push(String(name).trim() || null);
    }

    if (contactNumber !== undefined) {
      updates.push('contactNumber = ?');
      values.push(String(contactNumber).trim() || null);
    }
    
    if (role === 'encoder') {
      updates.push('role = ?');
      values.push('encoder');
    }

    if (status !== undefined) {
      const normalizedStatus = String(status).toLowerCase();
      if (normalizedStatus !== 'active' && normalizedStatus !== 'inactive') {
        return res.status(400).json({ error: 'Invalid status. Allowed values are active or inactive.' });
      }
      // Prevent deactivating your own account
      if (normalizedStatus === 'inactive' && userId === req.user.id) {
        return res.status(400).json({ error: 'Cannot deactivate your own account' });
      }
      updates.push('status = ?');
      values.push(normalizedStatus);
    }
    
    if (password) {
      const passwordHash = crypto.createHash('sha256').update(password).digest('hex');
      updates.push('password = ?');
      values.push(passwordHash);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }
    
    values.push(userId);
    
    db.prepare(`
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = ?
    `).run(...values);
    
    // Return updated user
    const updatedUser = db.prepare(`
      SELECT id, email, name, role, viberNumber, contactNumber, status, createdAt 
      FROM users 
      WHERE id = ?
    `).get(userId);
    
    res.json(updatedUser);
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  try {
    const userId = req.params.id;

    // Prevent deleting yourself
    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Permanent delete (notification_preferences and audit_logs CASCADE per schema)
    db.prepare('DELETE FROM users WHERE id = ?').run(userId);

    res.status(204).send();
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;

