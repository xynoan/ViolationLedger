import db from '../database.js';
import { pathToFileURL } from 'url';
import { getAllowedResidentStreets, composeResidentAddress } from '../residentStreets.js';
import { getGracePeriodMinutes } from '../runtime_config.js';

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

/** Mulberry32 PRNG — set DEMO_SEED in env for reproducible demo data. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pickWeighted(rng, weights) {
  const total = weights.reduce((s, w) => s + w.p, 0);
  let r = rng() * total;
  for (const w of weights) {
    r -= w.p;
    if (r <= 0) return w.v;
  }
  return weights[weights.length - 1].v;
}

function id(prefix, n) {
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

function isoMs(ms) {
  return new Date(ms).toISOString();
}

function isoHoursAgo(rng, minH, maxH) {
  const h = minH + rng() * (maxH - minH);
  return isoMs(Date.now() - h * 60 * 60 * 1000);
}

function uniquePlate(rng, used, index) {
  let p;
  do {
    const a = String.fromCharCode(65 + randInt(rng, 0, 25));
    const b = String.fromCharCode(65 + randInt(rng, 0, 25));
    const c = String.fromCharCode(65 + randInt(rng, 0, 25));
    const num = String(randInt(rng, 100, 999)).padStart(3, '0');
    p = `${a}${b}${c}-${num}`;
  } while (used.has(p));
  used.add(p);
  return p;
}

function mockStreetLocationId(zeroBasedSlot) {
  const n = getAllowedResidentStreets().length;
  const street = getAllowedResidentStreets()[zeroBasedSlot % n];
  const block = Math.floor(zeroBasedSlot / n) + 1;
  return block === 1 ? street : `${street} (${block})`;
}

function cameraLocationForIndex(camIndex) {
  return mockStreetLocationId(camIndex % Math.max(getAllowedResidentStreets().length, 1));
}

const MOCK_FIRST_NAMES = [
  'Maria',
  'Jose',
  'Ana',
  'Carlos',
  'Liza',
  'Miguel',
  'Angela',
  'Roberto',
  'Patricia',
  'Daniel',
  'Christine',
  'Mark',
  'Jennifer',
  'Antonio',
  'Michelle',
  'Francis',
  'Grace',
  'Paul',
  'Katherine',
  'Ryan',
  'Beatriz',
  'Eduardo',
  'Sofia',
  'Luis',
  'Camille',
  'Ricardo',
  'Isabel',
  'Gabriel',
  'Nicole',
  'Andres',
  'Teresa',
  'Ramon',
  'Carmen',
  'Diego',
  'Rosa',
  'Fernando',
  'Lucia',
  'Javier',
  'Elena',
  'Alberto',
  'Marisol',
  'Hector',
  'Diana',
  'Rafael',
  'Claudia',
  'Victor',
  'Monica',
  'Sergio',
  'Adriana',
  'Felipe',
  'Paola',
  'Oscar',
  'Valeria',
  'Jorge',
  'Natalia',
  'Emilio',
  'Cecilia',
  'Rodrigo',
  'Mariana',
  'Gustavo',
  'Daniela',
  'Arturo',
  'Gabriela',
  'Enrique',
  'Silvia',
  'Mario',
  'Pilar',
  'Alfredo',
  'Ines',
  'Raul',
  'Esperanza',
  'Jaime',
  'Consuelo',
  'Ruben',
  'Aurora',
  'Salvador',
  'Lourdes',
  'Ernesto',
  'Imelda',
  'Cesar',
  'Corazon',
  'Armando',
  'Divina',
];

const MOCK_LAST_NAMES = [
  'Reyes',
  'Santos',
  'Cruz',
  'Bautista',
  'Ocampo',
  'Del Rosario',
  'Fernandez',
  'Garcia',
  'Torres',
  'Ramos',
  'Mendoza',
  'Villanueva',
  'Castillo',
  'Aquino',
  'Navarro',
  'Dizon',
  'Romero',
  'Valdez',
  'Herrera',
  'Morales',
  'Salazar',
  'Pascual',
  'Rivera',
  'Marquez',
  'Lozada',
  'Jimenez',
  'Alvarez',
  'Espiritu',
  'Manalo',
  'Santiago',
  'De Guzman',
  'Flores',
  'Gonzales',
  'Lopez',
  'Martinez',
  'Tan',
  'Lim',
  'Ong',
  'Chua',
  'Sy',
  'Cruzada',
  'Borja',
  'Magbanua',
  'Pangilinan',
  'Sison',
  'Tuazon',
  'Mercado',
  'Domingo',
  'Fuentes',
  'Ignacio',
  'Jacinto',
  'Lacson',
  'Medina',
  'Nieto',
  'Ortega',
  'Paredes',
  'Quinto',
  'Rosales',
  'Salcedo',
  'Tiangco',
  'Urbina',
  'Velasco',
  'Yap',
  'Zamora',
  'Agbayani',
  'Benitez',
  'Castro',
  'Dela Cruz',
  'Enriquez',
  'Francisco',
  'Gutierrez',
  'Hernandez',
  'Ilagan',
  'Javier',
  'King',
  'Luna',
  'Montenegro',
  'Natividad',
  'Olivarez',
  'Penaflor',
  'Quisumbing',
  'Ramirez',
  'Santillan',
  'Tolentino',
  'Urbano',
  'Verano',
  'Wenceslao',
  'Yulo',
  'Zabala',
  'Acosta',
  'Ballesteros',
  'Caballero',
  'Dalupan',
  'Estrella',
  'Fabian',
  'Guevarra',
  'Hidalgo',
  'Ibarra',
  'Jalandoni',
  'Kapunan',
];

function buildUniqueResidentNames(rng, count) {
  const combos = [];
  for (const f of MOCK_FIRST_NAMES) {
    for (const l of MOCK_LAST_NAMES) {
      combos.push(`${f} ${l}`);
    }
  }
  for (let i = combos.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [combos[i], combos[j]] = [combos[j], combos[i]];
  }
  if (count > combos.length) {
    throw new Error(`Need more name combinations: ${count} > ${combos.length}`);
  }
  return combos.slice(0, count);
}

function clearCoreTables() {
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

function asInt(value) {
  return Number(value || 0);
}

function run() {
  const seedArg = Number.parseInt(process.env.DEMO_SEED || '', 10);
  const rngSeed = Number.isFinite(seedArg) ? seedArg >>> 0 : (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const rng = mulberry32(rngSeed);

  const numCameras = randInt(rng, 1, 5);
  const numResidents = randInt(rng, 50, 100);
  const names = buildUniqueResidentNames(rng, numResidents);

  const plateUsed = new Set();
  const residents = [];
  const vehicles = [];
  const cameras = [];

  let vehSeq = 0;

  const residentStmt = db.prepare(
    `INSERT OR REPLACE INTO residents (id, name, contactNumber, address, houseNumber, streetName, createdAt, residentStatus, residentType)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  for (let i = 0; i < numResidents; i += 1) {
    const idx = i + 1;
    const residentId = id('RESIDENT', idx);
    const street = getAllowedResidentStreets()[i % getAllowedResidentStreets().length];
    const hn = String(100 + randInt(rng, 0, 179));
    const composed = `${composeResidentAddress(hn, street)}, Quezon City`;
    const residentType = rng() < 0.42 ? 'tenant' : 'homeowner';
    const residentStatus = rng() < 0.88 ? 'verified' : 'guest';
    const contact = `09${String(1700000000 + idx * 17 + randInt(rng, 0, 999)).slice(-9)}`;

    residentStmt.run(
      residentId,
      names[i],
      contact,
      composed,
      hn,
      street,
      isoHoursAgo(rng, 24 * 2, 24 * 400),
      residentStatus,
      residentType,
    );

    residents.push({ id: residentId, name: names[i], contactNumber: contact });

    const numVeh = pickWeighted(rng, [
      { v: 1, p: 48 },
      { v: 2, p: 35 },
      { v: 3, p: 17 },
    ]);

    const vtypes = ['car', 'motorcycle', 'truck', 'van', 'suv', 'tricycle', 'other'];
    for (let v = 0; v < numVeh; v += 1) {
      vehSeq += 1;
      const plate = uniquePlate(rng, plateUsed, vehSeq);
      vehicles.push({
        id: id('VEH', vehSeq),
        plateNumber: plate,
        ownerName: names[i],
        contactNumber: contact,
        registeredAt: isoHoursAgo(rng, 1, 24 * 120),
        dataSource: pickWeighted(rng, [
          { v: 'barangay', p: 55 },
          { v: 'hosted', p: 30 },
          { v: 'manual', p: 15 },
        ]),
        residentId,
        rented: null,
        purposeOfVisit: 'Resident vehicle',
        vehicleType: vtypes[(idx + v) % vtypes.length],
        visitorCategory: null,
      });
    }
  }

  const numVisitorVehicles = randInt(rng, 6, 20);
  const visitPurposes = ['Delivery', 'Guest visit', 'Pickup', 'Drop-off', 'Maintenance'];
  const visitorCats = ['guest', 'delivery', 'rental'];
  for (let k = 0; k < numVisitorVehicles; k += 1) {
    vehSeq += 1;
    const plate = uniquePlate(rng, plateUsed, vehSeq);
    const cat = visitorCats[k % visitorCats.length];
    vehicles.push({
      id: id('VEH', vehSeq),
      plateNumber: plate,
      ownerName: `Visitor ${k + 1}`,
      contactNumber: `09${String(1800000000 + k * 31).slice(-9)}`,
      registeredAt: isoHoursAgo(rng, 1, 72),
      dataSource: 'barangay',
      residentId: null,
      rented: cat === 'rental' ? pickWeighted(rng, [{ v: 'Clubhouse', p: 1 }, { v: 'Basketball Court', p: 1 }]) : null,
      purposeOfVisit: visitPurposes[k % visitPurposes.length],
      vehicleType: 'car',
      visitorCategory: cat,
    });
  }

  const vehicleStmt = db.prepare(
    `INSERT OR REPLACE INTO vehicles
      (id, plateNumber, ownerName, contactNumber, registeredAt, dataSource, residentId, rented, purposeOfVisit, vehicleType, visitorCategory)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const v of vehicles) {
    vehicleStmt.run(
      v.id,
      v.plateNumber,
      v.ownerName,
      v.contactNumber,
      v.registeredAt,
      v.dataSource,
      v.residentId,
      v.rented,
      v.purposeOfVisit,
      v.vehicleType,
      v.visitorCategory,
    );
  }

  const cameraStmt = db.prepare(
    `INSERT OR REPLACE INTO cameras
      (id, name, locationId, status, lastCapture, deviceId, isFixed, illegalParkingZone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let c = 0; c < numCameras; c += 1) {
    const camId = id('CAM', c + 1);
    const locationId = cameraLocationForIndex(c);
    const status = rng() < 0.82 ? 'online' : 'offline';
    cameras.push({ id: camId, locationId, name: `Gate / Lane ${c + 1}`, status });
    cameraStmt.run(
      camId,
      cameras[c].name,
      locationId,
      status,
      isoHoursAgo(rng, 0.05, 48),
      `DEV-${String(c + 1).padStart(4, '0')}`,
      rng() < 0.15 ? 0 : 1,
      rng() < 0.2 ? 0 : 1,
    );
  }

  const residentVehicles = vehicles.filter((v) => v.residentId);
  const platesForViolations = [...new Set(residentVehicles.map((v) => v.plateNumber))];

  const numActiveWarnings = Math.max(
    3,
    Math.min(
      Math.floor(numResidents * (0.06 + rng() * 0.14)),
      Math.floor(platesForViolations.length * 0.35),
    ),
  );

  const shuffledPlates = [...platesForViolations];
  for (let i = shuffledPlates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffledPlates[i], shuffledPlates[j]] = [shuffledPlates[j], shuffledPlates[i]];
  }
  const platesWithActiveWarning = new Set(shuffledPlates.slice(0, numActiveWarnings));

  const historicalPlatePool = shuffledPlates.slice(numActiveWarnings, numActiveWarnings + Math.floor(platesForViolations.length * (0.28 + rng() * 0.22)));

  const violations = [];
  let vioSeq = 0;
  const gracePeriodMinutes = getGracePeriodMinutes();

  const pushViolation = (row) => {
    vioSeq += 1;
    violations.push({ ...row, id: id('VIO', vioSeq) });
  };

  const graceMs = gracePeriodMinutes * 60 * 1000;
  for (const plate of platesWithActiveWarning) {
    const loc = cameras[randInt(rng, 0, numCameras - 1)].locationId;
    // warningExpiresAt is exactly timeDetected + grace (same as createViolationFromDetection). Age within
    // [0, grace−1min] so the UI always shows between ~1 and configured grace minutes remaining.
    const ageMs = rng() * Math.max(60 * 1000, graceMs - 60 * 1000);
    const detectedMs = Date.now() - ageMs;
    const detected = isoMs(detectedMs);
    const expires = isoMs(detectedMs + graceMs);
    pushViolation({
      ticketId: null,
      plateNumber: plate,
      cameraLocationId: loc,
      timeDetected: detected,
      timeIssued: null,
      status: 'warning',
      warningExpiresAt: expires,
    });
  }

  const statusHistoryWeights = [
    { v: 'issued', p: 22 },
    { v: 'resolved', p: 25 },
    { v: 'cleared', p: 18 },
    { v: 'cancelled', p: 10 },
    { v: 'pending', p: 15 },
    { v: 'warning', p: 10 },
  ];

  for (const plate of historicalPlatePool) {
    const count = pickWeighted(rng, [
      { v: 1, p: 45 },
      { v: 2, p: 40 },
      { v: 3, p: 15 },
    ]);
    for (let h = 0; h < count; h += 1) {
      const loc = cameras[randInt(rng, 0, numCameras - 1)].locationId;
      const st = pickWeighted(rng, statusHistoryWeights);
      const hoursBack = 30 + rng() * 24 * 90 + h * 20;
      const detectedMs = Date.now() - hoursBack * 60 * 60 * 1000;
      const detected = isoMs(detectedMs);
      const isWarning = st === 'warning';
      // Past warnings: expiry is still exactly grace after detection (always in the past here because hoursBack is large).
      const expires = isWarning ? isoMs(detectedMs + gracePeriodMinutes * 60 * 1000) : null;
      pushViolation({
        ticketId: st === 'issued' ? `TCK-${100000 + vioSeq}` : null,
        plateNumber: plate,
        cameraLocationId: loc,
        timeDetected: detected,
        timeIssued: st === 'issued' ? isoMs(new Date(detected).getTime() + rng() * 3600000) : null,
        status: st,
        warningExpiresAt: expires,
      });
    }
  }

  const extraViolations = randInt(rng, 8, 28);
  for (let e = 0; e < extraViolations; e += 1) {
    const v = residentVehicles[randInt(rng, 0, residentVehicles.length - 1)];
    const loc = cameras[randInt(rng, 0, numCameras - 1)].locationId;
    const st = pickWeighted(rng, [
      { v: 'pending', p: 20 },
      { v: 'issued', p: 25 },
      { v: 'resolved', p: 30 },
      { v: 'cleared', p: 25 },
    ]);
    const detected = isoHoursAgo(rng, 10, 24 * 60);
    pushViolation({
      ticketId: st === 'issued' ? `TCK-${200000 + vioSeq}` : null,
      plateNumber: v.plateNumber,
      cameraLocationId: loc,
      timeDetected: detected,
      timeIssued: st === 'issued' ? isoHoursAgo(rng, 8, 200) : null,
      status: st,
      warningExpiresAt: null,
    });
  }

  const numDetections = randInt(rng, 35, 160);
  const detections = [];
  let detSeq = 0;
  const classes = ['car', 'motorcycle', 'truck', 'van', 'suv'];

  const platePoolForCam = [...vehicles.map((v) => v.plateNumber)];

  for (let d = 0; d < numDetections; d += 1) {
    detSeq += 1;
    const cam = cameras[randInt(rng, 0, numCameras - 1)];
    const plate = platePoolForCam[randInt(rng, 0, platePoolForCam.length - 1)];
    const ts =
      d === 0
        ? isoMs(Date.now() - rng() * 2 * 60 * 60 * 1000)
        : isoHoursAgo(rng, 0.5, 24 * 14);
    detections.push({
      id: id('DET', detSeq),
      cameraId: cam.id,
      plateNumber: plate,
      timestamp: ts,
      confidence: 0.72 + rng() * 0.27,
      imageUrl: `/mock/captures/detection-${detSeq}.jpg`,
      bbox: JSON.stringify({
        x: 15 + randInt(rng, 0, 40),
        y: 25 + randInt(rng, 0, 50),
        w: 100 + randInt(rng, 0, 80),
        h: 45 + randInt(rng, 0, 40),
      }),
      class_name: classes[randInt(rng, 0, classes.length - 1)],
    });
  }

  const detectionStmt = db.prepare(
    `INSERT OR REPLACE INTO detections
      (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const d of detections) {
    detectionStmt.run(
      d.id,
      d.cameraId,
      d.plateNumber,
      d.timestamp,
      d.confidence,
      d.imageUrl,
      d.bbox,
      d.class_name,
    );
  }

  const numIncidents = Math.min(randInt(rng, 12, 55), detections.length);
  const incidents = [];
  let incSeq = 0;
  const detIndices = detections.map((_, i) => i);
  for (let i = detIndices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [detIndices[i], detIndices[j]] = [detIndices[j], detIndices[i]];
  }
  const reasons = ['Illegal parking', 'Blocking driveway', 'No visible permit', 'Expired warning', 'Obstructing gate'];

  for (let k = 0; k < numIncidents; k += 1) {
    const det = detections[detIndices[k]];
    const cam = cameras.find((c) => c.id === det.cameraId);
    incSeq += 1;
    incidents.push({
      id: id('INC', incSeq),
      cameraId: det.cameraId,
      locationId: cam.locationId,
      detectionId: det.id,
      plateNumber: det.plateNumber,
      timestamp: isoMs(new Date(det.timestamp).getTime() + rng() * 120000),
      reason: reasons[k % reasons.length],
      imageUrl: `/mock/incidents/incident-${incSeq}.jpg`,
      imageBase64: null,
      status: pickWeighted(rng, [
        { v: 'open', p: 35 },
        { v: 'reviewing', p: 35 },
        { v: 'resolved', p: 30 },
      ]),
    });
  }

  const incidentStmt = db.prepare(
    `INSERT OR REPLACE INTO incidents
      (id, cameraId, locationId, detectionId, plateNumber, timestamp, reason, imageUrl, imageBase64, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const inc of incidents) {
    incidentStmt.run(
      inc.id,
      inc.cameraId,
      inc.locationId,
      inc.detectionId,
      inc.plateNumber,
      inc.timestamp,
      inc.reason,
      inc.imageUrl,
      inc.imageBase64,
      inc.status,
    );
  }

  const violationStmt = db.prepare(
    `INSERT OR REPLACE INTO violations
      (id, ticketId, plateNumber, cameraLocationId, timeDetected, timeIssued, status, warningExpiresAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const v of violations) {
    violationStmt.run(
      v.id,
      v.ticketId,
      v.plateNumber,
      v.cameraLocationId,
      v.timeDetected,
      v.timeIssued,
      v.status,
      v.warningExpiresAt,
    );
  }

  const numNotifications = Math.min(randInt(rng, 15, 85), incidents.length + violations.length);
  const notifStmt = db.prepare(
    `INSERT OR REPLACE INTO notifications
      (id, type, title, message, cameraId, locationId, incidentId, detectionId, imageUrl, imageBase64, plateNumber, timeDetected, reason, timestamp, read, handledBy, handledAt, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const types = ['vehicle_detected', 'incident_created', 'warning_expired'];
  for (let n = 0; n < numNotifications; n += 1) {
    const type = types[n % types.length];
    const inc = incidents[n % incidents.length];
    const det = inc ? detections.find((d) => d.id === inc.detectionId) : detections[n % detections.length];
    const cam = inc ? cameras.find((c) => c.id === inc.cameraId) : cameras[n % cameras.length];
    const read = rng() < 0.38 ? 1 : 0;
    const status = pickWeighted(rng, [
      { v: 'open', p: 40 },
      { v: 'acknowledged', p: 35 },
      { v: 'closed', p: 25 },
    ]);
    notifStmt.run(
      id('NTF', n + 1),
      type,
      `Alert ${n + 1}`,
      `${type.replaceAll('_', ' ')} — ${inc?.plateNumber || det?.plateNumber || 'vehicle'}`,
      cam.id,
      cam.locationId,
      inc?.id || null,
      det?.id || null,
      `/mock/notifications/notification-${n + 1}.jpg`,
      null,
      inc?.plateNumber || det?.plateNumber || 'ABC-000',
      inc?.timestamp || det?.timestamp,
      inc?.reason || 'Monitoring event',
      isoHoursAgo(rng, 0.2, 72),
      read,
      read ? 'system' : null,
      read ? isoHoursAgo(rng, 0.1, 48) : null,
      status,
    );
  }

  return {
    rngSeed,
    numCameras,
    numResidents,
    numVehicles: vehicles.length,
    numDetections: detections.length,
    numIncidents: incidents.length,
    numViolations: violations.length,
    numNotifications,
    activeWarnings: violations.filter((v) => v.status === 'warning').length,
  };
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
       ORDER BY c.id ASC`,
    )
    .all();

  console.log('\nSanity checks:');
  console.log('- notifications by read flag:', unreadStats);
  console.log('- violations by status:', violationStats);
  console.log('- incidents/detections by camera:', cameraStats);
}

function main() {
  let meta;
  try {
    db.exec('BEGIN TRANSACTION');

    if (RESET_MODE) {
      clearCoreTables();
    }

    meta = run();

    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }

  const counts = verifyCounts();

  console.log(`\nDemo seed: ${meta.rngSeed} (set DEMO_SEED=${meta.rngSeed} to reproduce)`);
  console.log(
    `Profile: ${meta.numCameras} cameras, ${meta.numResidents} residents, ${meta.numVehicles} vehicles, ` +
      `${meta.numDetections} detections, ${meta.numIncidents} incidents, ${meta.numViolations} violations ` +
      `(${meta.activeWarnings} active warnings), ${meta.numNotifications} notifications`,
  );

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
  main();
}
