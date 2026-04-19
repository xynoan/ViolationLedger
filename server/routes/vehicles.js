import express from 'express';
import db from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';
import { auditLog } from '../middleware/audit.js';

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
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return 'car';
  const normalized = raw.toLowerCase();
  if (ALLOWED_VEHICLE_TYPES.has(normalized)) return normalized;
  // Preserve custom types entered when "Other" is selected.
  return raw;
}

const ALLOWED_VISITOR_CATEGORY = new Set(['guest', 'delivery', 'rental']);

function normalizeVisitorCategory(value) {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (ALLOWED_VISITOR_CATEGORY.has(v)) return v;
  return null;
}

function isUniquePlateConstraintError(error) {
  const message = String(error?.message || '').toLowerCase();
  return (
    error?.code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    message.includes('unique constraint failed') ||
    message.includes('vehicles.platenumber')
  );
}

router.use(authenticateToken);
router.use(auditLog);
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
      ownerFirstName,
      ownerMiddleName,
      ownerLastName,
      ownerSuffix,
      contactNumber,
      houseNumber,
      streetName,
      barangay,
      city,
      dataSource,
      residentId,
      rented,
      purposeOfVisit,
      vehicleType,
      visitorCategory: visitorCategoryRaw,
    } = req.body;

    const ofn = typeof ownerFirstName === 'string' ? ownerFirstName.trim() : '';
    const omn = typeof ownerMiddleName === 'string' ? ownerMiddleName.trim() : '';
    const oln = typeof ownerLastName === 'string' ? ownerLastName.trim() : '';
    const osf = typeof ownerSuffix === 'string' ? ownerSuffix.trim() : '';
    const hn = typeof houseNumber === 'string' ? houseNumber.trim() : '';
    const sn = typeof streetName === 'string' ? streetName.trim() : '';
    const bg = typeof barangay === 'string' ? barangay.trim() : '';
    const ct = typeof city === 'string' ? city.trim() : '';
    const resolvedOwnerName = (typeof ownerName === 'string' ? ownerName.trim() : '') || [ofn, omn, oln, osf].filter(Boolean).join(' ');

    if (!id || !plateNumber || !resolvedOwnerName) {
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
      INSERT INTO vehicles (id, plateNumber, ownerName, ownerFirstName, ownerMiddleName, ownerLastName, ownerSuffix, contactNumber, houseNumber, streetName, barangay, city, registeredAt, dataSource, residentId, rented, purposeOfVisit, vehicleType, visitorCategory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      plateNumber,
      resolvedOwnerName,
      ofn || null,
      omn || null,
      oln || null,
      osf || null,
      cleanedContact,
      hn || null,
      sn || null,
      bg || null,
      ct || null,
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
    if (isUniquePlateConstraintError(error)) {
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
      ownerFirstName,
      ownerMiddleName,
      ownerLastName,
      ownerSuffix,
      contactNumber,
      houseNumber,
      streetName,
      barangay,
      city,
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

    const nextOwnerFirstName =
      ownerFirstName !== undefined ? String(ownerFirstName || '').trim() : String(vehicle.ownerFirstName || '').trim();
    const nextOwnerMiddleName =
      ownerMiddleName !== undefined ? String(ownerMiddleName || '').trim() : String(vehicle.ownerMiddleName || '').trim();
    const nextOwnerLastName =
      ownerLastName !== undefined ? String(ownerLastName || '').trim() : String(vehicle.ownerLastName || '').trim();
    const nextOwnerSuffix =
      ownerSuffix !== undefined ? String(ownerSuffix || '').trim() : String(vehicle.ownerSuffix || '').trim();
    const nextOwnerName =
      (ownerName !== undefined ? String(ownerName || '').trim() : String(vehicle.ownerName || '').trim()) ||
      [nextOwnerFirstName, nextOwnerMiddleName, nextOwnerLastName, nextOwnerSuffix].filter(Boolean).join(' ');

    const nextHouseNumber =
      houseNumber !== undefined ? String(houseNumber || '').trim() : String(vehicle.houseNumber || '').trim();
    const nextStreetName =
      streetName !== undefined ? String(streetName || '').trim() : String(vehicle.streetName || '').trim();
    const nextBarangay =
      barangay !== undefined ? String(barangay || '').trim() : String(vehicle.barangay || '').trim();
    const nextCity =
      city !== undefined ? String(city || '').trim() : String(vehicle.city || '').trim();

    db.prepare(`
      UPDATE vehicles 
      SET plateNumber = ?, ownerName = ?, ownerFirstName = ?, ownerMiddleName = ?, ownerLastName = ?, ownerSuffix = ?, contactNumber = ?, houseNumber = ?, streetName = ?, barangay = ?, city = ?, residentId = ?, rented = ?, purposeOfVisit = ?, vehicleType = ?, visitorCategory = ?
      WHERE id = ?
    `).run(
      plateNumber !== undefined ? plateNumber : vehicle.plateNumber,
      nextOwnerName,
      nextOwnerFirstName || null,
      nextOwnerMiddleName || null,
      nextOwnerLastName || null,
      nextOwnerSuffix || null,
      cleanedContact,
      nextHouseNumber || null,
      nextStreetName || null,
      nextBarangay || null,
      nextCity || null,
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



