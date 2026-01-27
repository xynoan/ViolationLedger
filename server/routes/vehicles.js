import express from 'express';
import db from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

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
    const { id, plateNumber, ownerName, contactNumber, dataSource, hostId, rented, purposeOfVisit } = req.body;
    
    if (!id || !plateNumber || !ownerName || !contactNumber) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!purposeOfVisit) {
      return res.status(400).json({ error: 'Purpose of visit is required' });
    }

    const registeredAt = new Date().toISOString();
    // Default to 'barangay' if dataSource not provided
    const vehicleDataSource = dataSource || 'barangay';
    
    // If hostId is provided, fetch the host's contact number
    let finalContactNumber = contactNumber;
    if (hostId && !rented) {
      const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(hostId);
      if (host) {
        finalContactNumber = host.contactNumber;
      }
    }
    
    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = finalContactNumber.trim().replace(/[\s\-\(\)]/g, '');
    
    if (!cleanedContact || cleanedContact.length === 0) {
      return res.status(400).json({ 
        error: 'Contact number is required'
      });
    }
    
    db.prepare(`
      INSERT INTO vehicles (id, plateNumber, ownerName, contactNumber, registeredAt, dataSource, hostId, rented, purposeOfVisit)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, plateNumber, ownerName, cleanedContact, registeredAt, vehicleDataSource, hostId || null, rented || null, purposeOfVisit);

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
    const { plateNumber, ownerName, contactNumber, hostId, rented, purposeOfVisit } = req.body;
    const vehicle = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    
    if (!vehicle) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // If hostId is provided and not rented, fetch the host's contact number
    let finalContactNumber = contactNumber !== undefined ? contactNumber : vehicle.contactNumber;
    if (hostId && !rented) {
      const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(hostId);
      if (host) {
        finalContactNumber = host.contactNumber;
      }
    }

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = finalContactNumber.trim().replace(/[\s\-\(\)]/g, '');
    
    if (!cleanedContact || cleanedContact.length === 0) {
      return res.status(400).json({ 
        error: 'Contact number is required'
      });
    }

    db.prepare(`
      UPDATE vehicles 
      SET plateNumber = ?, ownerName = ?, contactNumber = ?, hostId = ?, rented = ?, purposeOfVisit = ?
      WHERE id = ?
    `).run(
      plateNumber !== undefined ? plateNumber : vehicle.plateNumber,
      ownerName !== undefined ? ownerName : vehicle.ownerName,
      cleanedContact,
      hostId !== undefined ? (hostId || null) : vehicle.hostId,
      rented !== undefined ? (rented || null) : vehicle.rented,
      purposeOfVisit !== undefined ? purposeOfVisit : vehicle.purposeOfVisit,
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



