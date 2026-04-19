import express from 'express';
import db from '../database.js';
import { getResidentStreetSet, composeResidentAddress } from '../residentStreets.js';
import { getDropdownConfig } from '../dropdown_config.js';

const router = express.Router();

const ALLOWED_RESIDENT_STATUS = new Set(['verified', 'guest']);

function normalizeResidentStatus(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (ALLOWED_RESIDENT_STATUS.has(v)) return v;
  return 'verified';
}

function normalizeResidentType(value) {
  const types = getDropdownConfig().residentOccupancyTypes;
  const list = Array.isArray(types) && types.length ? types : [{ value: 'homeowner', label: 'Homeowner' }];
  const v = typeof value === 'string' ? value.trim() : '';
  const vl = v.toLowerCase();
  const hit = list.find((x) => String(x.value).toLowerCase() === vl);
  if (hit) return String(hit.value);
  return String(list[0]?.value || 'homeowner');
}

router.get('/', (req, res) => {
  try {
    const { search } = req.query;
    let residents;

    if (search) {
      const like = `%${search}%`;
      residents = db.prepare(`
        SELECT * FROM residents 
        WHERE name LIKE ? OR contactNumber LIKE ? OR address LIKE ?
           OR IFNULL(houseNumber, '') LIKE ? OR IFNULL(streetName, '') LIKE ?
        ORDER BY name ASC
      `).all(like, like, like, like, like);
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
    const { id, name, contactNumber, houseNumber, streetName, residentStatus, residentType } = req.body;

    if (!id || !name || !contactNumber) {
      return res.status(400).json({ error: 'Missing required fields: id, name, contactNumber' });
    }

    const sn = typeof streetName === 'string' ? streetName.trim() : '';
    if (!sn) {
      return res.status(400).json({ error: 'Street name is required' });
    }
    if (!getResidentStreetSet().has(sn)) {
      return res.status(400).json({ error: 'Invalid street name' });
    }
    const hn = typeof houseNumber === 'string' ? houseNumber.trim() : '';
    const composedAddress = composeResidentAddress(hn, sn, '', '');

    const createdAt = new Date().toISOString();
    const status = normalizeResidentStatus(residentStatus);
    const type = normalizeResidentType(residentType);

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = contactNumber.trim().replace(/[\s\-\(\)]/g, '');

    if (!cleanedContact || cleanedContact.length === 0) {
      return res.status(400).json({
        error: 'Contact number is required'
      });
    }

    db.prepare(`
      INSERT INTO residents (id, name, contactNumber, address, houseNumber, streetName, barangay, city, createdAt, residentStatus, residentType)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, name, cleanedContact, composedAddress, hn || null, sn, null, null, createdAt, status, type);

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
    const { name, contactNumber, houseNumber, streetName, residentStatus, residentType } = req.body;
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

    const nextH =
      houseNumber !== undefined
        ? (typeof houseNumber === 'string' ? houseNumber.trim() : '')
        : (resident.houseNumber || '').trim();
    const nextS =
      streetName !== undefined
        ? (typeof streetName === 'string' ? streetName.trim() : '')
        : (resident.streetName || '').trim();
    if (!nextS) {
      return res.status(400).json({ error: 'Street name is required' });
    }
    if (!getResidentStreetSet().has(nextS)) {
      return res.status(400).json({ error: 'Invalid street name' });
    }

    const composedAddress = composeResidentAddress(nextH, nextS, '', '');

    const nextStatus =
      residentStatus !== undefined
        ? normalizeResidentStatus(residentStatus)
        : normalizeResidentStatus(resident.residentStatus);

    const nextType =
      residentType !== undefined
        ? normalizeResidentType(residentType)
        : normalizeResidentType(resident.residentType);

    db.prepare(`
      UPDATE residents 
      SET name = ?, contactNumber = ?, address = ?, houseNumber = ?, streetName = ?, barangay = ?, city = ?, residentStatus = ?, residentType = ?
      WHERE id = ?
    `).run(
      name || resident.name,
      cleanedContact,
      composedAddress,
      nextH || null,
      nextS,
      null,
      null,
      nextStatus,
      nextType,
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
