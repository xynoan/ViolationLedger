import express from 'express';
import db from '../database.js';

const router = express.Router();

function getStatements() {
  return {
    getAll: db.prepare('SELECT * FROM incidents ORDER BY timestamp DESC'),
    getByStatus: db.prepare('SELECT * FROM incidents WHERE status = ? ORDER BY timestamp DESC'),
    getById: db.prepare('SELECT * FROM incidents WHERE id = ?'),
    updateStatus: db.prepare('UPDATE incidents SET status = ? WHERE id = ?'),
  };
}

// GET all incidents
router.get('/', (req, res) => {
  try {
    const { status } = req.query;
    const statements = getStatements();
    
    let incidents;
    if (status) {
      incidents = statements.getByStatus.all(status);
    } else {
      incidents = statements.getAll.all();
    }
    
    res.json(incidents.map(incident => ({
      ...incident,
      timestamp: new Date(incident.timestamp),
    })));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET incident by ID
router.get('/:id', (req, res) => {
  try {
    const statements = getStatements();
    const incident = statements.getById.get(req.params.id);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    
    res.json({
      ...incident,
      timestamp: new Date(incident.timestamp),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT update incident status
router.put('/:id', (req, res) => {
  try {
    const { status } = req.body;
    const statements = getStatements();
    const incident = statements.getById.get(req.params.id);
    
    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    if (!status || !['open', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Must be "open" or "closed"' });
    }

    statements.updateStatus.run(status, req.params.id);
    
    const updated = statements.getById.get(req.params.id);
    res.json({
      ...updated,
      timestamp: new Date(updated.timestamp),
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;

