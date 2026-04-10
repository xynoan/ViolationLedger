import express from 'express';
import db from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

const ALLOWED_VEHICLE_TYPES = new Set([
  'car',
  'motorcycle',
  'truck',
  'van',
  'suv',
  'tricycle',
  'other',
]);

function normalizeVehicleType(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ALLOWED_VEHICLE_TYPES.has(v)) return v;
  return 'car';
}

const ALLOWED_VISITOR_CATEGORY = new Set(['guest', 'delivery', 'rental']);

function normalizeVisitorCategory(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ALLOWED_VISITOR_CATEGORY.has(v)) return v;
  return null;
}

router.use(authenticateToken);
router.get('/', (req, res) => {
  try {
    const { search } = req.query;
    let vehicles;
    
    if (search) {
      vehicles = db.prepare(`
        SELECT * FROM vehicles 
        WHERE plateNumber LIKE ? OR ownerName LIKE ?
        ORDER BY registeredAt DESC
      `).all(`%${search}%`, `%${search}%`);
    } else {
      vehicles = db.prepare('SELECT * FROM vehicles ORDER BY registeredAt DESC').all();
    }
    
    res.json(vehicles.map(vehicle => ({
      ...vehicle,
      registeredAt: new Date(vehicle.registeredAt)
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET vehicle by ID
router.get('/:id', (req, res) => {
  try {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }
    res.json({
      ...vehicle,
      registeredAt: new Date(vehicle.registeredAt)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const {
      id,
      plateNumber,
      ownerName,
      contactNumber,
      dataSource,
      residentId,
      rented,
      purposeOfVisit,
      vehicleType,
      visitorCategory: visitorCategoryRaw,
    } = req.body;

    if (!id || !plateNumber || !ownerName) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const registeredAt = new Date().toISOString();
    // Default to 'barangay' if dataSource not provided
    const vehicleDataSource = dataSource || 'barangay';
    const vt = normalizeVehicleType(vehicleType);
    const purpose = purposeOfVisit != null && purposeOfVisit !== '' ? String(purposeOfVisit) : null;

    const rid = residentId ? String(residentId).trim() : null;
    let visitorCategory = rid ? null : normalizeVisitorCategory(visitorCategoryRaw);

    let finalContactNumber =
      contactNumber !== undefined && contactNumber !== null ? String(contactNumber) : '';
    if (rid && !rented) {
      const resident = db.prepare('SELECT * FROM residents WHERE id = ?').get(rid);
      if (!resident) {
        return res.status(400).json({ error: 'Invalid resident' });
      }
      finalContactNumber = resident.contactNumber;
    }

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = finalContactNumber.trim().replace(/[\s\-\(\)]/g, '');

    if (rid && !rented && (!cleanedContact || cleanedContact.length === 0)) {
      return res.status(400).json({
        error: 'Could not resolve contact for linked resident',
      });
    }

    if (!rid) {
      if (!visitorCategory) {
        return res.status(400).json({ error: 'Visitor category is required for vehicles not linked to a resident' });
      }
      if (!purpose || String(purpose).trim() === '') {
        return res.status(400).json({ error: 'Purpose of visit is required' });
      }
      if (!cleanedContact || cleanedContact.length === 0) {
        return res.status(400).json({ error: 'Contact number is required' });
      }
      if (visitorCategory === 'rental' && (!rented || String(rented).trim() === '')) {
        return res.status(400).json({ error: 'Rental location is required for short-term rentals' });
      }
    }

    db.prepare(`
      INSERT INTO vehicles (id, plateNumber, ownerName, contactNumber, registeredAt, dataSource, residentId, rented, purposeOfVisit, vehicleType, visitorCategory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      plateNumber,
      ownerName,
      cleanedContact,
      registeredAt,
      vehicleDataSource,
      rid,
      rented || null,
      purpose,
      vt,
      visitorCategory,
    );

    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id);
    res.status(201).json({
      ...vehicle,
      registeredAt: new Date(vehicle.registeredAt)
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Plate number already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

router.put('/:id', requireRole('admin', 'barangay_user'), (req, res) => {
  try {
    const {
      plateNumber,
      ownerName,
      contactNumber,
      residentId,
      rented,
      purposeOfVisit,
      vehicleType,
      visitorCategory: visitorCategoryRaw,
    } = req.body;
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    const nextResidentId =
      residentId !== undefined ? residentId || null : vehicle.residentId;
    const nextRented = rented !== undefined ? rented || null : vehicle.rented;

    // If residentId is provided and not rented, fetch the resident's contact number
    let finalContactNumber = contactNumber !== undefined ? contactNumber : vehicle.contactNumber;
    if (nextResidentId && !nextRented) {
      const resident = db.prepare('SELECT * FROM residents WHERE id = ?').get(nextResidentId);
      if (!resident) {
        return res.status(400).json({ error: 'Invalid resident' });
      }
      finalContactNumber = resident.contactNumber;
    }

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = String(finalContactNumber ?? '')
      .trim()
      .replace(/[\s\-\(\)]/g, '');

    if (nextResidentId && !nextRented && (!cleanedContact || cleanedContact.length === 0)) {
      return res.status(400).json({
        error: 'Could not resolve contact for linked resident',
      });
    }

    const nextVt =
      vehicleType !== undefined ? normalizeVehicleType(vehicleType) : vehicle.vehicleType || 'car';

    let nextVisitorCategory = null;
    if (nextResidentId) {
      nextVisitorCategory = null;
    } else if (visitorCategoryRaw !== undefined) {
      nextVisitorCategory = normalizeVisitorCategory(visitorCategoryRaw);
    } else {
      nextVisitorCategory = vehicle.visitorCategory ?? null;
      if (!nextVisitorCategory) {
        nextVisitorCategory =
          vehicle.rented && String(vehicle.rented).trim()
            ? 'rental'
            : String(vehicle.purposeOfVisit || '')
                .toLowerCase()
                .includes('deliver')
              ? 'delivery'
              : 'guest';
      }
    }
    if (!nextResidentId && purposeOfVisit !== undefined) {
      const p = purposeOfVisit != null && purposeOfVisit !== '' ? String(purposeOfVisit) : null;
      if (!p || String(p).trim() === '') {
        return res.status(400).json({ error: 'Purpose of visit is required' });
      }
    }
    if (!nextResidentId && nextVisitorCategory === 'rental') {
      const r = rented !== undefined ? rented : vehicle.rented;
      if (!r || String(r).trim() === '') {
        return res.status(400).json({ error: 'Rental location is required for short-term rentals' });
      }
    }

    db.prepare(`
      UPDATE vehicles 
      SET plateNumber = ?, ownerName = ?, contactNumber = ?, residentId = ?, rented = ?, purposeOfVisit = ?, vehicleType = ?, visitorCategory = ?
      WHERE id = ?
    `).run(
      plateNumber !== undefined ? plateNumber : vehicle.plateNumber,
      ownerName !== undefined ? ownerName : vehicle.ownerName,
      cleanedContact,
      residentId !== undefined ? (residentId || null) : vehicle.residentId,
      rented !== undefined ? (rented || null) : vehicle.rented,
      purposeOfVisit !== undefined ? purposeOfVisit : vehicle.purposeOfVisit,
      nextVt,
      nextVisitorCategory,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    res.json({
      ...updated,
      registeredAt: new Date(updated.registeredAt)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', requireRole('admin', 'barangay_user'), (req, res) => {
  try {
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;



