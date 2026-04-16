import express from 'express';
import db from '../database.js';
import { RESIDENT_STREET_SET, composeResidentAddress } from '../residentStreets.js';
import { composeResidentDisplayName } from '../residentName.js';

const router = express.Router();

const ALLOWED_RESIDENT_STATUS = new Set(['verified', 'guest']);
const ALLOWED_RESIDENT_TYPE = new Set(['homeowner', 'tenant']);

function normalizeResidentStatus(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (ALLOWED_RESIDENT_STATUS.has(v)) return v;
  return 'verified';
}

function normalizeResidentType(value) {
  const v = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (ALLOWED_RESIDENT_TYPE.has(v)) return v;
  return 'homeowner';
}

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
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
           OR IFNULL(firstName, '') LIKE ? OR IFNULL(middleName, '') LIKE ?
           OR IFNULL(lastName, '') LIKE ? OR IFNULL(nameSuffix, '') LIKE ?
        ORDER BY name ASC
      `).all(like, like, like, like, like, like, like, like, like);
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
    const {
      id,
      firstName,
      middleName,
      lastName,
      nameSuffix,
      contactNumber,
      houseNumber,
      streetName,
      residentStatus,
      residentType,
    } = req.body;

    if (!id || contactNumber === undefined || contactNumber === null) {
      return res.status(400).json({ error: 'Missing required fields: id, contactNumber' });
    }

    const fn = trimStr(firstName);
    const mn = trimStr(middleName);
    const ln = trimStr(lastName);
    const sfx = trimStr(nameSuffix);

    if (!fn) {
      return res.status(400).json({ error: 'First name is required' });
    }
    if (!ln) {
      return res.status(400).json({ error: 'Last name is required' });
    }

    const sn = typeof streetName === 'string' ? streetName.trim() : '';
    if (!sn) {
      return res.status(400).json({ error: 'Street name is required' });
    }
    if (!RESIDENT_STREET_SET.has(sn)) {
      return res.status(400).json({ error: 'Invalid street name' });
    }
    const hn = typeof houseNumber === 'string' ? houseNumber.trim() : '';
    if (!hn) {
      return res.status(400).json({ error: 'House / lot number is required' });
    }

    const composedName = composeResidentDisplayName(fn, mn, ln, sfx);
    if (!composedName) {
      return res.status(400).json({ error: 'Could not build display name from parts' });
    }

    const composedAddress = composeResidentAddress(hn, sn);

    const createdAt = new Date().toISOString();
    const status = normalizeResidentStatus(residentStatus);
    const type = normalizeResidentType(residentType);

    const cleanedContact = String(contactNumber).trim().replace(/[\s\-\(\)]/g, '');

    if (!cleanedContact || cleanedContact.length === 0) {
      return res.status(400).json({
        error: 'Contact number is required'
      });
    }

    db.prepare(`
      INSERT INTO residents (
        id, name, firstName, middleName, lastName, nameSuffix,
        contactNumber, address, houseNumber, streetName, createdAt, residentStatus, residentType
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      composedName,
      fn,
      mn || null,
      ln,
      sfx || null,
      cleanedContact,
      composedAddress,
      hn,
      sn,
      createdAt,
      status,
      type,
    );

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
    const {
      firstName,
      middleName,
      lastName,
      nameSuffix,
      contactNumber,
      houseNumber,
      streetName,
      residentStatus,
      residentType,
    } = req.body;
    const resident = db.prepare('SELECT * FROM residents WHERE id = ?').get(req.params.id);

    if (!resident) {
      return res.status(404).json({ error: 'Resident not found' });
    }

    let cleanedContact = resident.contactNumber;
    if (contactNumber !== undefined) {
      cleanedContact = String(contactNumber).trim().replace(/[\s\-\(\)]/g, '');
      if (!cleanedContact || cleanedContact.length === 0) {
        return res.status(400).json({
          error: 'Contact number cannot be empty'
        });
      }
    }

    const nextFirst =
      firstName !== undefined ? trimStr(firstName) : trimStr(resident.firstName ?? '');
    const nextMiddle =
      middleName !== undefined ? trimStr(middleName) : trimStr(resident.middleName ?? '');
    const nextLast =
      lastName !== undefined
        ? trimStr(lastName)
        : trimStr(resident.lastName ?? '') || trimStr(resident.name ?? '');
    const nextSuffix =
      nameSuffix !== undefined ? trimStr(nameSuffix) : trimStr(resident.nameSuffix ?? '');

    if (!nextFirst) {
      return res.status(400).json({ error: 'First name is required' });
    }
    if (!nextLast) {
      return res.status(400).json({ error: 'Last name is required' });
    }

    const nextH =
      houseNumber !== undefined
        ? (typeof houseNumber === 'string' ? houseNumber.trim() : '')
        : (resident.houseNumber || '').trim();
    const nextS =
      streetName !== undefined
        ? (typeof streetName === 'string' ? streetName.trim() : '')
        : (resident.streetName || '').trim();
    if (!nextH) {
      return res.status(400).json({ error: 'House / lot number is required' });
    }
    if (!nextS) {
      return res.status(400).json({ error: 'Street name is required' });
    }
    if (!RESIDENT_STREET_SET.has(nextS)) {
      return res.status(400).json({ error: 'Invalid street name' });
    }

    const composedAddress = composeResidentAddress(nextH, nextS);
    const composedName = composeResidentDisplayName(nextFirst, nextMiddle, nextLast, nextSuffix);
    if (!composedName) {
      return res.status(400).json({ error: 'Could not build display name from parts' });
    }

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
      SET name = ?, firstName = ?, middleName = ?, lastName = ?, nameSuffix = ?,
          contactNumber = ?, address = ?, houseNumber = ?, streetName = ?, residentStatus = ?, residentType = ?
      WHERE id = ?
    `).run(
      composedName,
      nextFirst,
      nextMiddle || null,
      nextLast,
      nextSuffix || null,
      cleanedContact,
      composedAddress,
      nextH,
      nextS,
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
