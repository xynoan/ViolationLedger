import express from 'express';
import db from '../database.js';

const router = express.Router();

router.get('/', (req, res) => {
  try {
    const { search } = req.query;
    let hosts;
    
    if (search) {
      hosts = db.prepare(`
        SELECT * FROM hosts 
        WHERE name LIKE ? OR contactNumber LIKE ? OR address LIKE ?
        ORDER BY name ASC
      `).all(`%${search}%`, `%${search}%`, `%${search}%`);
    } else {
      hosts = db.prepare('SELECT * FROM hosts ORDER BY name ASC').all();
    }
    
    res.json(hosts.map(host => ({
      ...host,
      createdAt: new Date(host.createdAt)
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', (req, res) => {
  try {
    const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id);
    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }
    res.json({
      ...host,
      createdAt: new Date(host.createdAt)
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { id, name, contactNumber, address } = req.body;
    
    if (!id || !name || !contactNumber) {
      return res.status(400).json({ error: 'Missing required fields: id, name, contactNumber' });
    }

    const createdAt = new Date().toISOString();
    
    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    const cleanedContact = contactNumber.trim().replace(/[\s\-\(\)]/g, '');
    
    if (!cleanedContact || cleanedContact.length === 0) {
      return res.status(400).json({ 
        error: 'Contact number is required'
      });
    }
    
    db.prepare(`
      INSERT INTO hosts (id, name, contactNumber, address, createdAt)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, cleanedContact, address || null, createdAt);

    const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(id);
    res.status(201).json({
      ...host,
      createdAt: new Date(host.createdAt)
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Host ID already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// PUT update host
router.put('/:id', (req, res) => {
  try {
    const { name, contactNumber, address } = req.body;
    const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id);
    
    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    // Store contact number exactly as input - NO CONVERSION
    // Only remove spaces, dashes, and parentheses for clean storage
    let cleanedContact = host.contactNumber;
    if (contactNumber !== undefined) {
      cleanedContact = contactNumber.trim().replace(/[\s\-\(\)]/g, '');
      if (!cleanedContact || cleanedContact.length === 0) {
        return res.status(400).json({ 
          error: 'Contact number cannot be empty'
        });
      }
    }

    db.prepare(`
      UPDATE hosts 
      SET name = ?, contactNumber = ?, address = ?
      WHERE id = ?
    `).run(
      name || host.name,
      cleanedContact,
      address !== undefined ? address : host.address,
      req.params.id
    );

    const updated = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id);
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
    const host = db.prepare('SELECT * FROM hosts WHERE id = ?').get(req.params.id);
    if (!host) {
      return res.status(404).json({ error: 'Host not found' });
    }

    db.prepare('DELETE FROM hosts WHERE id = ?').run(req.params.id);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;


