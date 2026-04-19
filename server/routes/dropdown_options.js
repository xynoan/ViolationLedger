import express from 'express';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import {
  getDropdownConfig,
  updateDropdownConfig,
  resetDropdownConfigToDefaults,
} from '../dropdown_config.js';

const router = express.Router();

router.get('/', authenticateToken, (req, res) => {
  try {
    res.json(getDropdownConfig());
  } catch (error) {
    console.error('Get dropdown options error:', error);
    res.status(500).json({ error: error.message || 'Failed to load dropdown options' });
  }
});

router.put('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const body = req.body || {};
    const updated = updateDropdownConfig(body);
    res.json({ success: true, ...updated });
  } catch (error) {
    console.error('Update dropdown options error:', error);
    res.status(500).json({ error: error.message || 'Failed to update dropdown options' });
  }
});

router.post('/reset', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const updated = resetDropdownConfigToDefaults();
    res.json({ success: true, ...updated });
  } catch (error) {
    console.error('Reset dropdown options error:', error);
    res.status(500).json({ error: error.message || 'Failed to reset dropdown options' });
  }
});

export default router;
