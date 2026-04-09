import express from 'express';
import db from '../database.js';

const router = express.Router();

const ALLOWED_RESIDENT_STATUS = new Set(['verified', 'guest']);

function normalizeResidentStatus(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (ALLOWED_RESIDENT_STATUS.has(v)) return v;
  return 'verified';
}

router.get('/', (req, res) => {
  try {
    const { search } = req.query;
    let residents;

    if (search) {
      residents = db.prepare(`
        SELECT * FROM residents 
        WHERE name LIKE ? OR contactNumber LIKE ? OR address LIKE ?
        ORDER BY name ASC
      `).all(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      residents = db.prepare('SELECT * FROM residents ORDER BY name ASC').all();
    }

    res.json(residents.map((resident) => ({
      ...resident,
      createdAt: new Date(resident.createdAt)
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const resident = db.prepare('SELECT * FROM residents WHERE id = ?').get(req.params.id);
    if (!resident) {
      return res.status(404).json({ error: 'Resident not found' });
    }
    res.json({
      ...resident,
      createdAt: new Date(resident.createdAt)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { id, name, contactNumber, address, residentStatus } = req.body;

    if (!id || !name || !contactNumber) {
      return res.status(400).json({ error: 'Missing required fields: id, name, contactNumber' });
    }

    const createdAt = new Date().toISOString();
    const status = normalizeResidentStatus(residentStatus);

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = contactNumber.trim().replace(/[\s\-\(\)]/g, '');

    if (!cleanedContact || cleanedContact.length === 0) {
      return res.status(400).json({
        error: 'Contact number is required'
      });
    }

    db.prepare(`
      INSERT INTO residents (id, name, contactNumber, address, createdAt, residentStatus)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, name, cleanedContact, address || null, createdAt, status);

    const created = db.prepare('SELECT * FROM residents WHERE id = ?').get(id);
    res.status(201).json({
      ...created,
      createdAt: new Date(created.createdAt)
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Resident ID already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

router.put('/:id', (req, res) => {
  try {
    const { name, contactNumber, address, residentStatus } = req.body;
    const resident = db.prepare('SELECT * FROM residents WHERE id = ?').get(req.params.id);

    if (!resident) {
      return res.status(404).json({ error: 'Resident not found' });
    }

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    let cleanedContact = resident.contactNumber;
    if (contactNumber !== undefined) {
      cleanedContact = contactNumber.trim().replace(/[\s\-\(\)]/g, '');
      if (!cleanedContact || cleanedContact.length === 0) {
        return res.status(400).json({
          error: 'Contact number cannot be empty'
        });
      }
    }

    const nextStatus =
      residentStatus !== undefined
        ? normalizeResidentStatus(residentStatus)
        : normalizeResidentStatus(resident.residentStatus);

    db.prepare(`
      UPDATE residents 
      SET name = ?, contactNumber = ?, address = ?, residentStatus = ?
      WHERE id = ?
    `).run(
      name || resident.name,
      cleanedContact,
      address !== undefined ? address : resident.address,
      nextStatus,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM residents WHERE id = ?').get(req.params.id);
    res.json({
      ...updated,
      createdAt: new Date(updated.createdAt)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const resident = db.prepare('SELECT * FROM residents WHERE id = ?').get(req.params.id);
    if (!resident) {
      return res.status(404).json({ error: 'Resident not found' });
    }

    db.prepare('DELETE FROM residents WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
