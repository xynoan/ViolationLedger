import express from 'express';
import db from '../database.js';
import { authenticateToken, requireRole } from '../middleware/auth.js';

const router = express.Router();

function getStatements() {
  return {
    getAll: db.prepare('SELECT * FROM cameras ORDER BY name'),
    getById: db.prepare('SELECT * FROM cameras WHERE id = ?'),
    create: db.prepare(`
      INSERT INTO cameras (id, name, locationId, status, lastCapture, deviceId, isFixed, illegalParkingZone)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    update: db.prepare(`
      UPDATE cameras 
      SET name = ?, locationId = ?, status = ?, deviceId = ?, isFixed = ?, illegalParkingZone = ?
      WHERE id = ?
    `),
    delete: db.prepare('DELETE FROM cameras WHERE id = ?'),
  };
}

router.get('/', (req, res) => {
  try {
    const statements = getStatements();
    const cameras = statements.getAll.all();
    res.json(cameras.map(camera => {
      // Handle deviceId: preserve non-empty strings, convert null/empty to null
      const deviceIdValue = (camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim()) 
        ? camera.deviceId.trim() 
        : null;
      
      // Safely handle lastCapture date - convert to ISO string for JSON response
      let lastCaptureDate;
      try {
        const dateObj = camera.lastCapture ? new Date(camera.lastCapture) : new Date();
        lastCaptureDate = dateObj.toISOString();
      } catch (dateError) {
        console.warn('Invalid lastCapture date for camera', camera.id, ':', camera.lastCapture);
        lastCaptureDate = new Date().toISOString();
      }
      
      // Build explicit object to avoid sql.js serialization issues
      return {
        id: String(camera.id || ''),
        name: String(camera.name || ''),
        locationId: String(camera.locationId || ''),
        status: String(camera.status || 'offline'),
        lastCapture: lastCaptureDate,
        deviceId: deviceIdValue,
        isFixed: camera.isFixed === 1 || camera.isFixed === true,
        illegalParkingZone: camera.illegalParkingZone === 1 || camera.illegalParkingZone === true
      };
    }));
  } catch (error) {
    console.error('Error getting cameras:', error);
    res.status(500).json({ 
      error: 'Failed to load cameras',
      details: error?.message || String(error)
    });
  }
});

router.get('/:id', (req, res) => {
  try {
    const statements = getStatements();
    const camera = statements.getById.get(req.params.id);
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }
    
    const deviceIdValue = (camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim()) 
      ? camera.deviceId.trim() 
      : null;
    
    // Safely handle lastCapture date - convert to ISO string for JSON response
    let lastCaptureDate;
    try {
      const dateObj = camera.lastCapture ? new Date(camera.lastCapture) : new Date();
      lastCaptureDate = dateObj.toISOString();
    } catch (dateError) {
      console.warn('Invalid lastCapture date for camera', camera.id, ':', camera.lastCapture);
      lastCaptureDate = new Date().toISOString();
    }
    
    // Build explicit object to avoid sql.js serialization issues
    res.json({
      id: String(camera.id || ''),
      name: String(camera.name || ''),
      locationId: String(camera.locationId || ''),
      status: String(camera.status || 'offline'),
      lastCapture: lastCaptureDate,
      deviceId: deviceIdValue,
      isFixed: camera.isFixed === 1 || camera.isFixed === true,
      illegalParkingZone: camera.illegalParkingZone === 1 || camera.illegalParkingZone === true
    });
  } catch (error) {
    console.error('Error getting camera:', error);
    res.status(500).json({ 
      error: 'Failed to load camera',
      details: error?.message || String(error)
    });
  }
});

router.post('/', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    console.log('POST /api/cameras - Request body:', JSON.stringify(req.body, null, 2));
    
    const statements = getStatements();
    const { id, name, locationId, status, deviceId, isFixed, illegalParkingZone } = req.body;
    
    // Validate required fields
    if (!id || !name || !locationId || !status) {
      console.log('Missing required fields:', { id: !!id, name: !!name, locationId: !!locationId, status: !!status });
      return res.status(400).json({ 
        error: 'Missing required fields',
        received: { id: !!id, name: !!name, locationId: !!locationId, status: !!status }
      });
    }

    // Validate status value
    if (status !== 'online' && status !== 'offline') {
      return res.status(400).json({ error: 'Status must be "online" or "offline"' });
    }

    const lastCapture = new Date().toISOString();
    // Ensure deviceId is properly handled (null if empty/undefined)
    const deviceIdValue = (deviceId && typeof deviceId === 'string' && deviceId.trim()) ? deviceId.trim() : null;
    // Convert boolean to integer (SQLite uses INTEGER for booleans: 1 = true, 0 = false)
    const isFixedValue = isFixed === true || isFixed === 1 || isFixed === 'true' ? 1 : 1; // Default to 1 (true)
    const illegalParkingZoneValue = illegalParkingZone === true || illegalParkingZone === 1 || illegalParkingZone === 'true' ? 1 : 1; // Default to 1 (true)
    
    console.log('Creating camera with data:', { 
      id, 
      name, 
      locationId, 
      status, 
      lastCapture, 
      deviceId: deviceIdValue 
    });
    
    // Check if camera ID already exists
    const existingCamera = statements.getById.get(id);
    if (existingCamera) {
      return res.status(409).json({ 
        error: 'Camera ID already exists',
        details: `A camera with ID "${id}" already exists. Please use a different ID.`
      });
    }
    
    // Execute the insert
    try {
      const result = statements.create.run(id, name, locationId, status, lastCapture, deviceIdValue, isFixedValue, illegalParkingZoneValue);
      if (result.changes === 0) {
        throw new Error('Failed to insert camera - no rows affected');
      }
    } catch (insertError) {
      // Convert sql.js errors to a more standard format
      const errorMessage = insertError?.message || String(insertError);
      const errorString = errorMessage.toLowerCase();
      
      // Check for constraint violations
      if (errorString.includes('unique') || errorString.includes('primary key') || errorString.includes('constraint')) {
        return res.status(409).json({ 
          error: 'Camera ID already exists',
          details: `A camera with ID "${id}" already exists.`
        });
      }
      
      throw new Error(errorMessage);
    }

    // Retrieve the created camera
    const camera = statements.getById.get(id);
    if (!camera) {
      console.error('Camera was created but could not be retrieved');
      return res.status(500).json({ error: 'Camera created but retrieval failed' });
    }
    
    console.log('Created camera retrieved:', camera);
    
    // Handle deviceId: preserve non-empty strings, convert null/empty to null
    const responseDeviceId = (camera.deviceId && typeof camera.deviceId === 'string' && camera.deviceId.trim()) 
      ? camera.deviceId.trim() 
      : null;
    
    // Safely handle lastCapture date - convert to ISO string for JSON response
    let lastCaptureDate;
    try {
      const dateObj = camera.lastCapture ? new Date(camera.lastCapture) : new Date();
      lastCaptureDate = dateObj.toISOString();
    } catch (dateError) {
      console.warn('Invalid lastCapture date, using current date');
      lastCaptureDate = new Date().toISOString();
    }
    
    // Build response object explicitly to avoid serialization issues
    const response = {
      id: camera.id,
      name: camera.name,
      locationId: camera.locationId,
      status: camera.status,
      lastCapture: lastCaptureDate,
      deviceId: responseDeviceId,
      isFixed: camera.isFixed === 1 || camera.isFixed === true,
      illegalParkingZone: camera.illegalParkingZone === 1 || camera.illegalParkingZone === true
    };
    
    console.log('Sending response:', JSON.stringify(response, null, 2));
    
    // Send response - wrap in try-catch to handle any serialization errors
    try {
      res.status(201).json(response);
      console.log('Response sent successfully');
    } catch (responseError) {
      console.error('Error sending JSON response:', responseError);
      // If JSON serialization fails, try sending a simpler response
      // Camera was already created successfully
      try {
        res.status(201).json({
          id: camera.id,
          name: camera.name,
          locationId: camera.locationId,
          status: camera.status,
          lastCapture: lastCaptureDate,
          deviceId: responseDeviceId
        });
      } catch (fallbackError) {
        console.error('Fallback response also failed:', fallbackError);
        // Last resort - send minimal response
        res.status(201).send(JSON.stringify({
          id: String(camera.id),
          name: String(camera.name),
          locationId: String(camera.locationId),
          status: String(camera.status),
          lastCapture: String(lastCaptureDate),
          deviceId: responseDeviceId ? String(responseDeviceId) : null
        }));
      }
    }
  } catch (error) {
    console.error('Error creating camera - Full error:', error);
    console.error('Error name:', error?.name);
    console.error('Error message:', error?.message);
    console.error('Error stack:', error?.stack);
    
    // Check if response was already sent
    if (res.headersSent) {
      console.error('Response already sent, cannot send error response');
      return;
    }
    
    const errorMessage = error?.message || String(error);
    const errorString = errorMessage.toLowerCase();
    
    // Check for various error patterns that sql.js might use
    if (errorString.includes('unique constraint') || 
        errorString.includes('already exists') ||
        errorString.includes('duplicate') ||
        errorString.includes('primary key')) {
      res.status(409).json({ 
        error: 'Camera ID already exists',
        details: `A camera with ID "${id}" already exists. Please use a different ID.`
      });
    } else if (errorString.includes('not null constraint') || 
               errorString.includes('null constraint')) {
      res.status(400).json({ 
        error: 'Missing required fields',
        details: errorMessage
      });
    } else {
      res.status(500).json({ 
        error: 'Failed to create camera',
        details: errorMessage,
        // Include more details in development
        ...(process.env.NODE_ENV !== 'production' && {
          stack: error?.stack,
          originalError: error?.originalError ? String(error.originalError) : undefined
        })
      });
    }
  }
});

router.put('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    const statements = getStatements();
    const { name, locationId, status, deviceId, isFixed, illegalParkingZone } = req.body;
    const camera = statements.getById.get(req.params.id);
    
    if (!camera) {
      return res.status(404).json({ error: 'Camera not found' });
    }

    // Handle deviceId properly
    const deviceIdValue = (deviceId !== undefined) 
      ? ((deviceId && typeof deviceId === 'string' && deviceId.trim()) ? deviceId.trim() : null)
      : camera.deviceId;
    
    // Convert boolean to integer (SQLite uses INTEGER for booleans: 1 = true, 0 = false)
    const isFixedValue = (isFixed !== undefined)
      ? (isFixed === true || isFixed === 1 || isFixed === 'true' ? 1 : 0)
      : (camera.isFixed === 1 || camera.isFixed === true ? 1 : 1); // Default to 1 if not provided
    const illegalParkingZoneValue = (illegalParkingZone !== undefined)
      ? (illegalParkingZone === true || illegalParkingZone === 1 || illegalParkingZone === 'true' ? 1 : 0)
      : (camera.illegalParkingZone === 1 || camera.illegalParkingZone === true ? 1 : 1); // Default to 1 if not provided

    statements.update.run(
      name || camera.name,
      locationId || camera.locationId,
      status || camera.status,
      deviceIdValue,
      isFixedValue,
      illegalParkingZoneValue,
      req.params.id
    );

    const updated = statements.getById.get(req.params.id);
    const responseDeviceId = (updated.deviceId && typeof updated.deviceId === 'string' && updated.deviceId.trim()) 
      ? updated.deviceId.trim() 
      : null;
    
    // Safely handle lastCapture date - convert to ISO string for JSON response
    let lastCaptureDate;
    try {
      const dateObj = updated.lastCapture ? new Date(updated.lastCapture) : new Date();
      lastCaptureDate = dateObj.toISOString();
    } catch (dateError) {
      console.warn('Invalid lastCapture date for camera', updated.id, ':', updated.lastCapture);
      lastCaptureDate = new Date().toISOString();
    }
    
    res.json({
      ...updated,
      lastCapture: lastCaptureDate,
      status: updated.status,
      deviceId: responseDeviceId,
      isFixed: updated.isFixed === 1 || updated.isFixed === true,
      illegalParkingZone: updated.illegalParkingZone === 1 || updated.illegalParkingZone === true
    });
  } catch (error) {
    console.error('Error updating camera:', error);
    res.status(500).json({ 
      error: 'Failed to update camera',
      details: error?.message || String(error)
    });
  }
});

// DELETE camera
// DELETE camera (Admin only)
router.delete('/:id', authenticateToken, requireRole('admin'), (req, res) => {
  try {
    console.log('DELETE /api/cameras/:id - Camera ID:', req.params.id);
    const statements = getStatements();
    const camera = statements.getById.get(req.params.id);
    
    if (!camera) {
      console.log('Camera not found:', req.params.id);
      return res.status(404).json({ error: 'Camera not found' });
    }

    console.log('Deleting camera:', camera.name);
    statements.delete.run(req.params.id);
    console.log('Camera deleted successfully');
    
    // Send 204 No Content - some clients expect .end() instead of .send()
    res.status(204).end();
  } catch (error) {
    console.error('Error deleting camera:', error);
    console.error('Error stack:', error?.stack);
    res.status(500).json({ 
      error: 'Failed to delete camera',
      details: error?.message || String(error)
    });
  }
});

export default router;

