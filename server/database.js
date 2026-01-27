import initSqlJs from 'sql.js';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, 'parking.db');

let db = null;
let SQL = null;

// Initialize database
async function initDatabase() {
  SQL = await initSqlJs({
    locateFile: (file) => {
      // sql.js needs to find the wasm file
      const wasmPath = join(__dirname, 'node_modules', 'sql.js', 'dist', file);
      if (fs.existsSync(wasmPath)) {
        return wasmPath;
      }
      // Fallback to default location
      return `https://sql.js.org/dist/${file}`;
    }
  });
  
  // Load existing database or create new one
  let buffer;
  try {
    if (fs.existsSync(dbPath)) {
      buffer = fs.readFileSync(dbPath);
    } else {
      buffer = null;
    }
  } catch (error) {
    buffer = null;
  }
  
  db = buffer ? new SQL.Database(buffer) : new SQL.Database();
  
  // Enable foreign keys and optimize SQLite settings
  db.run('PRAGMA foreign_keys = ON');
  db.run('PRAGMA journal_mode = WAL'); // Write-Ahead Logging for better concurrency
  db.run('PRAGMA synchronous = NORMAL'); // Balance between safety and performance
  db.run('PRAGMA cache_size = -64000'); // 64MB cache
  db.run('PRAGMA temp_store = MEMORY'); // Store temp tables in memory
  
  // Create hosts table
  db.run(`
    CREATE TABLE IF NOT EXISTS hosts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      contactNumber TEXT NOT NULL,
      address TEXT,
      createdAt TEXT NOT NULL
    )
  `);

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      plateNumber TEXT NOT NULL UNIQUE,
      ownerName TEXT NOT NULL,
      contactNumber TEXT NOT NULL,
      registeredAt TEXT NOT NULL,
      dataSource TEXT NOT NULL DEFAULT 'barangay',
      hostId TEXT,
      rented TEXT,
      purposeOfVisit TEXT,
      FOREIGN KEY (hostId) REFERENCES hosts(id) ON DELETE SET NULL
    )
  `);
  
  // Migrate existing vehicles table to add dataSource column if needed
  try {
    db.run('ALTER TABLE vehicles ADD COLUMN dataSource TEXT NOT NULL DEFAULT \'barangay\'');
  } catch (error) {
    // Column already exists or table doesn't exist yet - that's fine
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: dataSource column migration:', errorMsg);
    }
  }
  
  // Update existing vehicles without dataSource to have barangay as source
  try {
    db.run(`UPDATE vehicles SET dataSource = 'barangay' WHERE dataSource IS NULL OR dataSource = ''`);
  } catch (error) {
    // Ignore errors
  }

  // Migrate existing vehicles table to add hostId, rented, and purposeOfVisit columns if needed
  try {
    db.run('ALTER TABLE vehicles ADD COLUMN hostId TEXT');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: hostId column migration:', errorMsg);
    }
  }

  try {
    db.run('ALTER TABLE vehicles ADD COLUMN rented TEXT');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: rented column migration:', errorMsg);
    }
  }

  try {
    db.run('ALTER TABLE vehicles ADD COLUMN purposeOfVisit TEXT');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: purposeOfVisit column migration:', errorMsg);
    }
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS cameras (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      locationId TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('online', 'offline')),
      lastCapture TEXT NOT NULL,
      deviceId TEXT,
      isFixed INTEGER NOT NULL DEFAULT 1,
      illegalParkingZone INTEGER NOT NULL DEFAULT 1
    )
  `);
  
  // Migrate existing cameras table to add new columns if needed
  try {
    db.run('ALTER TABLE cameras ADD COLUMN isFixed INTEGER NOT NULL DEFAULT 1');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: isFixed column migration:', errorMsg);
    }
  }
  
  try {
    db.run('ALTER TABLE cameras ADD COLUMN illegalParkingZone INTEGER NOT NULL DEFAULT 1');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: illegalParkingZone column migration:', errorMsg);
    }
  }
  
  // Update existing cameras to have fixed and illegal parking zone enabled by default
  try {
    db.run(`UPDATE cameras SET isFixed = 1 WHERE isFixed IS NULL`);
    db.run(`UPDATE cameras SET illegalParkingZone = 1 WHERE illegalParkingZone IS NULL`);
  } catch (error) {
    // Ignore errors
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS violations (
      id TEXT PRIMARY KEY,
      ticketId TEXT,
      plateNumber TEXT NOT NULL,
      cameraLocationId TEXT NOT NULL,
      timeDetected TEXT NOT NULL,
      timeIssued TEXT,
      status TEXT NOT NULL CHECK(status IN ('warning', 'pending', 'issued', 'cancelled', 'cleared', 'resolved')),
      warningExpiresAt TEXT
    )
  `);
  
  // Migrate existing violations table to add 'resolved' status if needed
  try {
    // SQLite doesn't support ALTER TABLE to modify CHECK constraint, so we'll handle it in application logic
    // Violations table supports resolved status
  } catch (error) {
    // Ignore errors
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS detections (
      id TEXT PRIMARY KEY,
      cameraId TEXT NOT NULL,
      plateNumber TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      confidence REAL NOT NULL,
      imageUrl TEXT,
      bbox TEXT,
      class_name TEXT
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS incidents (
      id TEXT PRIMARY KEY,
      cameraId TEXT NOT NULL,
      locationId TEXT NOT NULL,
      detectionId TEXT,
      plateNumber TEXT,
      timestamp TEXT NOT NULL,
      reason TEXT NOT NULL,
      imageUrl TEXT,
      imageBase64 TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      cameraId TEXT,
      locationId TEXT,
      incidentId TEXT,
      detectionId TEXT,
      imageUrl TEXT,
      imageBase64 TEXT,
      plateNumber TEXT,
      timeDetected TEXT,
      reason TEXT,
      timestamp TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS sms_logs (
      id TEXT PRIMARY KEY,
      violationId TEXT,
      plateNumber TEXT NOT NULL,
      contactNumber TEXT NOT NULL,
      message TEXT NOT NULL,
      status TEXT NOT NULL,
      statusMessage TEXT,
      sentAt TEXT NOT NULL,
      deliveredAt TEXT,
      error TEXT,
      retryCount INTEGER NOT NULL DEFAULT 0,
      lastRetryAt TEXT
    )
  `);
  
  // Migrate existing sms_logs table to add retry columns if needed
  try {
    db.run('ALTER TABLE sms_logs ADD COLUMN retryCount INTEGER NOT NULL DEFAULT 0');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: retryCount column migration:', errorMsg);
    }
  }
  
  try {
    db.run('ALTER TABLE sms_logs ADD COLUMN lastRetryAt TEXT');
  } catch (error) {
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: lastRetryAt column migration:', errorMsg);
    }
  }
  
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'barangay_user',
      createdAt TEXT NOT NULL
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS notification_preferences (
      userId TEXT PRIMARY KEY,
      plate_not_visible INTEGER NOT NULL DEFAULT 1,
      warning_expired INTEGER NOT NULL DEFAULT 1,
      vehicle_detected INTEGER NOT NULL DEFAULT 1,
      incident_created INTEGER NOT NULL DEFAULT 1,
      updatedAt TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Migrate: Create default preferences for existing users
  try {
    const users = db.prepare('SELECT id FROM users').all();
    const now = new Date().toISOString();
    for (const user of users) {
      try {
        db.prepare(`
          INSERT OR IGNORE INTO notification_preferences (userId, plate_not_visible, warning_expired, vehicle_detected, incident_created, updatedAt)
          VALUES (?, 1, 1, 1, 1, ?)
        `).run(user.id, now);
      } catch (err) {
        // User might already have preferences
      }
    }
    // Notification preferences initialized
  } catch (error) {
    // Ignore errors
  }
  
  // Migrate existing users table to add role column if needed
  try {
    db.run('ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT \'barangay_user\'');
  } catch (error) {
    // Column already exists or table doesn't exist yet - that's fine
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: role column migration:', errorMsg);
    }
  }
  
  // Update existing users without role to have barangay_user role
  try {
    db.run(`UPDATE users SET role = 'barangay_user' WHERE role IS NULL OR role = ''`);
  } catch (error) {
    // Ignore errors
  }
  
  // Seed Barangay user if it doesn't exist (will be done after crypto import)
  // This is handled in a separate function after database initialization
  
  // Migrate existing detections table to add missing columns if needed
  // Try to add columns - if they exist, the error will be caught and ignored
  try {
    db.run('ALTER TABLE detections ADD COLUMN bbox TEXT');
  } catch (error) {
    // Column already exists or table doesn't exist yet - that's fine
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: bbox column migration:', errorMsg);
    }
  }
  
  try {
    db.run('ALTER TABLE detections ADD COLUMN class_name TEXT');
  } catch (error) {
    // Column already exists or table doesn't exist yet - that's fine
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: class_name column migration:', errorMsg);
    }
  }
  
  try {
    db.run('ALTER TABLE detections ADD COLUMN imageBase64 TEXT');
  } catch (error) {
    // Column already exists or table doesn't exist yet - that's fine
    const errorMsg = error?.message || String(error);
    if (!errorMsg.includes('duplicate column name') && !errorMsg.includes('no such table')) {
      console.log('Note: imageBase64 column migration:', errorMsg);
    }
  }
  
  // Create audit_logs table for tracking user activities
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      userEmail TEXT NOT NULL,
      userName TEXT,
      userRole TEXT NOT NULL,
      action TEXT NOT NULL,
      resource TEXT,
      resourceId TEXT,
      details TEXT,
      ipAddress TEXT,
      userAgent TEXT,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  // Create indexes for faster queries
  try {
    // Audit logs indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_userId ON audit_logs(userId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp)');
    
    // Violations indexes (frequently queried)
    db.run('CREATE INDEX IF NOT EXISTS idx_violations_status ON violations(status)');
    db.run('CREATE INDEX IF NOT EXISTS idx_violations_location ON violations(cameraLocationId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_violations_plate ON violations(plateNumber)');
    db.run('CREATE INDEX IF NOT EXISTS idx_violations_timeDetected ON violations(timeDetected)');
    
    // Detections indexes (frequently queried)
    db.run('CREATE INDEX IF NOT EXISTS idx_detections_cameraId ON detections(cameraId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_detections_timestamp ON detections(timestamp)');
    db.run('CREATE INDEX IF NOT EXISTS idx_detections_plateNumber ON detections(plateNumber)');
    db.run('CREATE INDEX IF NOT EXISTS idx_detections_class_name ON detections(class_name)');
    
    // Notifications indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read)');
    db.run('CREATE INDEX IF NOT EXISTS idx_notifications_timestamp ON notifications(timestamp)');
    db.run('CREATE INDEX IF NOT EXISTS idx_notifications_locationId ON notifications(locationId)');
    
    // Vehicles indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_vehicles_plateNumber ON vehicles(plateNumber)');
    
    // Cameras indexes
    db.run('CREATE INDEX IF NOT EXISTS idx_cameras_locationId ON cameras(locationId)');
    db.run('CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)');
  } catch (error) {
    // Indexes might already exist
  }
  
  // Save database to file
  saveDatabase();
  
  // Database initialized
}


// Batched database save to reduce I/O operations
let saveTimeout = null;
let pendingSave = false;
const SAVE_DEBOUNCE_MS = 1000; // Save at most once per second

function saveDatabase() {
  if (!db) return;
  
  // Mark that a save is pending
  pendingSave = true;
  
  // Clear existing timeout
  if (saveTimeout) {
    clearTimeout(saveTimeout);
  }
  
  // Schedule save after debounce period
  saveTimeout = setTimeout(() => {
    if (pendingSave && db) {
      try {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.ensureDirSync(dirname(dbPath));
        fs.writeFileSync(dbPath, buffer);
        pendingSave = false;
      } catch (error) {
        console.error('Error saving database:', error);
        pendingSave = false;
      }
    }
  }, SAVE_DEBOUNCE_MS);
}

// Force immediate save (for critical operations)
function saveDatabaseImmediate() {
  if (!db) return;
  
  // Clear any pending debounced save
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.ensureDirSync(dirname(dbPath));
    fs.writeFileSync(dbPath, buffer);
    pendingSave = false;
  } catch (error) {
    console.error('Error saving database:', error);
  }
}

// Database wrapper with better-sqlite3-like API
const dbWrapper = {
  prepare: (sql) => {
    // Prepare a fresh statement for each operation to avoid "Statement closed" errors
    return {
      run: (...params) => {
        const stmt = db.prepare(sql);
        try {
          if (params.length > 0) {
            stmt.bind(params);
          }
          stmt.step();
          const changes = db.getRowsModified() || 1;
          stmt.free();
          saveDatabase();
          return { changes };
        } catch (error) {
          try {
            stmt.free();
          } catch (freeError) {
            // Ignore free errors
          }
          // Ensure error message is a string for consistent error handling
          const errorMessage = error?.message || String(error);
          const err = new Error(errorMessage);
          throw err;
        }
      },
      get: (...params) => {
        const stmt = db.prepare(sql);
        try {
          if (params.length > 0) {
            stmt.bind(params);
          }
          const result = stmt.step() ? stmt.getAsObject() : null;
          stmt.free();
          return result;
        } catch (error) {
          try {
            stmt.free();
          } catch (freeError) {
            // Ignore free errors
          }
          throw error;
        }
      },
      all: (...params) => {
        const stmt = db.prepare(sql);
        try {
          if (params.length > 0) {
            stmt.bind(params);
          }
          const results = [];
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        } catch (error) {
          try {
            stmt.free();
          } catch (freeError) {
            // Ignore free errors
          }
          throw error;
        }
      }
    };
  },
  exec: (sql) => {
    db.run(sql);
    saveDatabase();
  },
  close: () => {
    if (db) {
      try {
        // Force immediate save on close
        saveDatabaseImmediate();
        // sql.js doesn't have an explicit close, but we can save the database
        console.log('Database saved and closed');
      } catch (error) {
        console.error('Error closing database:', error);
      }
    }
  },
  // Force immediate save (for critical operations)
  saveImmediate: () => {
    saveDatabaseImmediate();
  }
};

// Initialize and export
await initDatabase();

export default dbWrapper;

