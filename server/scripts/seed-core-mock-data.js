import db from '../database.js';
import { pathToFileURL } from 'url';
import { RESIDENT_STREET_OPTIONS } from '../residentStreets.js';

const MIN_ROWS = 50;
const ROWS_PER_TABLE = Math.max(
  MIN_ROWS,
  Number.parseInt(process.env.SEED_ROWS || '', 10) || MIN_ROWS
);
const RESET_MODE = process.argv.includes('--reset');

const TABLES = [
  'residents',
  'vehicles',
  'cameras',
  'detections',
  'incidents',
  'violations',
  'notifications',
];

function id(prefix, n) {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

function isoHoursAgo(hoursAgo) {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function plateFromIndex(n) {
  const a = String.fromCharCode(65 + (n % 26));
  const b = String.fromCharCode(65 + ((n + 7) % 26));
  const c = String.fromCharCode(65 + ((n + 13) % 26));
  const num = String(((n * 37) % 900) + 100).padStart(3, '0');
  return `${a}${b}${c}-${num}`;
}

function seededStatus(list, n) {
  return list[n % list.length];
}

function asInt(value) {
  return Number(value || 0);
}

function clearCoreTables() {
  // Clear in reverse dependency order for predictable reseeds.
  const clearOrder = [
    'notifications',
    'incidents',
    'detections',
    'violations',
    'vehicles',
    'cameras',
    'residents',
  ];
  for (const table of clearOrder) {
    db.prepare(`DELETE FROM ${table}`).run();
  }
}

function seedResidents() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO residents (id, name, contactNumber, address, houseNumber, streetName, createdAt, residentStatus)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    const residentId = id('RESIDENT', i);
    const street = RESIDENT_STREET_OPTIONS[(i - 1) % RESIDENT_STREET_OPTIONS.length];
    const hn = String(100 + ((i - 1) % 180));
    const brgy = ((i - 1) % 10) + 1;
    const composed = `${hn} ${street}, Barangay ${brgy}`;
    stmt.run(
      residentId,
      `Resident ${i}`,
      `0917${String(1000000 + i).slice(-7)}`,
      composed,
      hn,
      street,
      isoHoursAgo(24 * (ROWS_PER_TABLE - i + 1)),
      i % 7 === 0 ? 'guest' : 'verified'
    );
  }
}

function seedVehicles() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO vehicles
      (id, plateNumber, ownerName, contactNumber, registeredAt, dataSource, residentId, rented, purposeOfVisit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const visitPurposes = ['Delivery', 'Resident Visit', 'Maintenance', 'Pickup', 'Drop-off'];
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    stmt.run(
      id('VEH', i),
      plateFromIndex(i),
      `Owner ${i}`,
      `09${String(100000000 + i).slice(-9)}`,
      isoHoursAgo(24 * ((i % 45) + 1)),
      seededStatus(['barangay', 'hosted', 'manual'], i),
      id('RESIDENT', ((i - 1) % ROWS_PER_TABLE) + 1),
      seededStatus(['yes', 'no'], i),
      visitPurposes[i % visitPurposes.length]
    );
  }
}

function seedCameras() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO cameras
      (id, name, locationId, status, lastCapture, deviceId, isFixed, illegalParkingZone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    stmt.run(
      id('CAM', i),
      `Camera ${i}`,
      `LOC-${String(((i - 1) % 20) + 1).padStart(3, '0')}`,
      seededStatus(['online', 'offline'], i),
      isoHoursAgo(i),
      `DEV-${String(i).padStart(4, '0')}`,
      i % 5 === 0 ? 0 : 1,
      i % 3 === 0 ? 0 : 1
    );
  }
}

function seedDetections() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO detections
      (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const classes = ['car', 'motorcycle', 'truck', 'van'];
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    stmt.run(
      id('DET', i),
      id('CAM', ((i - 1) % ROWS_PER_TABLE) + 1),
      plateFromIndex(i),
      isoHoursAgo(i),
      0.7 + ((i % 25) / 100),
      `/mock/captures/detection-${i}.jpg`,
      JSON.stringify({ x: 20 + i, y: 35 + i, w: 120, h: 55 }),
      classes[i % classes.length]
    );
  }
}

function seedIncidents() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO incidents
      (id, cameraId, locationId, detectionId, plateNumber, timestamp, reason, imageUrl, imageBase64, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const reasons = ['Illegal parking', 'Blocking driveway', 'No visible permit', 'Expired warning'];
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    const cameraId = id('CAM', ((i - 1) % ROWS_PER_TABLE) + 1);
    stmt.run(
      id('INC', i),
      cameraId,
      `LOC-${String(((i - 1) % 20) + 1).padStart(3, '0')}`,
      id('DET', i),
      plateFromIndex(i),
      isoHoursAgo(i - 1),
      reasons[i % reasons.length],
      `/mock/incidents/incident-${i}.jpg`,
      null,
      seededStatus(['open', 'reviewing', 'resolved'], i)
    );
  }
}

function seedViolations() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO violations
      (id, ticketId, plateNumber, cameraLocationId, timeDetected, timeIssued, status, warningExpiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const statuses = ['warning', 'pending', 'issued', 'cancelled', 'cleared', 'resolved'];
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    const status = statuses[i % statuses.length];
    const detectedAt = isoHoursAgo(i + 2);
    stmt.run(
      id('VIO', i),
      `TCK-${String(10000 + i)}`,
      plateFromIndex(i),
      `LOC-${String(((i - 1) % 20) + 1).padStart(3, '0')}`,
      detectedAt,
      status === 'issued' ? isoHoursAgo(i + 1) : null,
      status,
      status === 'warning' ? isoHoursAgo(i - 24) : null
    );
  }
}

function seedNotifications() {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO notifications
      (id, type, title, message, cameraId, locationId, incidentId, detectionId, imageUrl, imageBase64, plateNumber, timeDetected, reason, timestamp, read, handledBy, handledAt, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const types = ['vehicle_detected', 'incident_created', 'warning_expired'];
  for (let i = 1; i <= ROWS_PER_TABLE; i += 1) {
    const type = types[i % types.length];
    const status = seededStatus(['open', 'acknowledged', 'closed'], i);
    const isRead = i % 3 === 0 ? 1 : 0;
    stmt.run(
      id('NTF', i),
      type,
      `Notification ${i}`,
      `${type.replaceAll('_', ' ')} for plate ${plateFromIndex(i)}`,
      id('CAM', ((i - 1) % ROWS_PER_TABLE) + 1),
      `LOC-${String(((i - 1) % 20) + 1).padStart(3, '0')}`,
      id('INC', i),
      id('DET', i),
      `/mock/notifications/notification-${i}.jpg`,
      null,
      plateFromIndex(i),
      isoHoursAgo(i),
      seededStatus(['Illegal parking', 'Blocked lane', 'Warning window expired'], i),
      isoHoursAgo(i - 1),
      isRead,
      isRead ? 'system' : null,
      isRead ? isoHoursAgo(i - 1) : null,
      status
    );
  }
}

function verifyCounts() {
  const counts = {};
  for (const table of TABLES) {
    const row = db.prepare(`SELECT COUNT(*) as total FROM ${table}`).get();
    counts[table] = asInt(row?.total);
  }
  return counts;
}

function printValidationReports() {
  const unreadStats = db
    .prepare('SELECT read, COUNT(*) as total FROM notifications GROUP BY read ORDER BY read ASC')
    .all();
  const violationStats = db
    .prepare('SELECT status, COUNT(*) as total FROM violations GROUP BY status ORDER BY status ASC')
    .all();
  const cameraStats = db
    .prepare(
      `SELECT c.id as cameraId,
              COUNT(DISTINCT d.id) as detections,
              COUNT(DISTINCT i.id) as incidents
       FROM cameras c
       LEFT JOIN detections d ON d.cameraId = c.id
       LEFT JOIN incidents i ON i.cameraId = c.id
       GROUP BY c.id
       ORDER BY c.id ASC
       LIMIT 10`
    )
    .all();

  console.log('\nSanity checks:');
  console.log('- notifications by read flag:', unreadStats);
  console.log('- violations by status:', violationStats);
  console.log('- incidents/detections by camera (sample 10):', cameraStats);
}

function ensureMinimums(counts) {
  const failures = Object.entries(counts).filter(([, total]) => total < MIN_ROWS);
  if (failures.length > 0) {
    const details = failures.map(([table, total]) => `${table}=${total}`).join(', ');
    throw new Error(`Minimum row check failed: ${details}`);
  }
}

function run() {
  try {
    db.exec('BEGIN TRANSACTION');

    if (RESET_MODE) {
      clearCoreTables();
    }

    seedResidents();
    seedVehicles();
    seedCameras();
    seedDetections();
    seedIncidents();
    seedViolations();
    seedNotifications();

    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Ignore rollback errors if transaction already closed.
    }
    throw error;
  }

  const counts = verifyCounts();
  ensureMinimums(counts);

  console.log('\nCore table row counts:');
  for (const table of TABLES) {
    console.log(`- ${table}: ${counts[table]}`);
  }
  printValidationReports();

  if (typeof db.saveImmediate === 'function') {
    db.saveImmediate();
  }
  db.close();
}

const entryFile = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
const isDirectExecution = import.meta.url === entryFile;

if (isDirectExecution) {
  run();
}
