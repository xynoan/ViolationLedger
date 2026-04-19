/**
 * Server-side detection service (Option C).
 * Manages long-running Python workers that capture frames from RTSP and run YOLO.
 * Broadcasts detections to WebSocket clients.
 * Respects detection enabled/disabled toggle (stops workers when paused).
 */

import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './database.js';
import { getDetectionEnabled } from './detection_state.js';
import { createViolationFromDetection } from './routes/violations.js';
import { getPythonExecutable } from './python_executable.js';
import { sendSmsMessage } from './utils/smsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DETECTION_WORKER_PATH = join(__dirname, 'detection_worker.py');
const GO2RTC_RTSP_BASE = process.env.GO2RTC_RTSP_BASE || 'rtsp://127.0.0.1:8554';
const SYNC_INTERVAL_MS = 30000; // Re-sync workers every 30s
const pythonCmd = getPythonExecutable();

/** cameraId -> ChildProcess */
const workers = new Map();

/** cameraId -> RTSP URL this worker was started with (restart if config changes) */
const workerRtspUrls = new Map();

/** cameraId -> epoch ms; delay restarting after a failed worker exit */
const workerBackoffUntil = new Map();

/** cameraId -> Set<WebSocket> */
const subscribers = new Map();

/** cameraId -> latest worker status text */
const workerStatuses = new Map();
/** cameraId -> epoch ms last vehicle-only Barangay alert */
const lastNoPlateAlertAt = new Map();
const NO_PLATE_ALERT_COOLDOWN_MS = 5 * 60 * 1000;

/** HTTP server for WebSocket upgrade */
let wss = null;

// Prepared statement for persisting detections so Dashboard "Capture Results"
// can reflect live detections produced by the RTSP worker, even when plates
// are not readable.
const insertDetectionStmt = db.prepare(`
  INSERT INTO detections (id, cameraId, plateNumber, timestamp, confidence, imageUrl, bbox, class_name, imageBase64)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

function normalizePlateForMatch(plateNumber) {
  if (!plateNumber) return '';
  return String(plateNumber).replace(/\s+/g, '').toUpperCase();
}

async function handlePlateDetections(cameraId, msg) {
  const plates = Array.isArray(msg?.plates) ? msg.plates : [];
  if (!plates.length) return;

  // Plate Recognizer already returns uppercase plates without spaces.
  // We still normalize before lookup to stay consistent with Vehicles registry.
  const uniquePlates = new Set(
    plates
      .map((p) => (p && typeof p.plateNumber === 'string' ? normalizePlateForMatch(p.plateNumber) : ''))
      .filter(Boolean)
  );

  for (const normalized of uniquePlates) {
    try {
      // Look up camera to get locationId for violation creation
      const camera = db
        .prepare('SELECT id, locationId FROM cameras WHERE id = ?')
        .get(cameraId);
      const locationId = camera?.locationId;
      if (!locationId) {
        console.warn(
          `[Detection] Skipping violation for plate ${normalized} on camera ${cameraId} - no locationId`
        );
        continue;
      }

      // createViolationFromDetection will:
      // - ensure vehicle is registered
      // - create or update a 'warning' violation
      // - send SMS to the vehicle owner
      await createViolationFromDetection(normalized, locationId, null);
    } catch (e) {
      console.error(
        '[Detection] Failed to create violation from RTSP plate detection',
        { cameraId, plate: normalized, error: e?.message || e }
      );
    }
  }
}

/**
 * Persist vehicle detections from the RTSP worker into the detections table so
 * the dashboard capture list updates whenever a vehicle is detected, even if
 * the plate is not visible/readable.
 */
function saveVehicleDetectionsFromWorker(cameraId, msg) {
  try {
    const vehicles = Array.isArray(msg?.vehicles) ? msg.vehicles : [];
    if (!vehicles.length) return;

    const timestamp = typeof msg?.timestamp === 'string'
      ? msg.timestamp
      : new Date().toISOString();
    const imageUrl = typeof msg?.imageUrl === 'string' ? msg.imageUrl : null;
    let savedCount = 0;

    vehicles.forEach((v, index) => {
      if (!v || typeof v.class_name !== 'string') return;

      const detectionId = `DET-${cameraId}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;
      const plateNumber = 'NONE'; // We don't have a stable plate association here
      const confidence = typeof v.confidence === 'number' ? v.confidence : 0.0;
      const bbox = v.bbox ? JSON.stringify(v.bbox) : null;
      const className = v.class_name || 'vehicle';

      insertDetectionStmt.run(
        detectionId,
        cameraId,
        plateNumber,
        timestamp,
        confidence,
        imageUrl,
        bbox,
        className,
        null // imageBase64
      );
      savedCount += 1;
    });
    console.log(`[Detection] Camera ${cameraId}: saved ${savedCount} detections from worker cycle`);
  } catch (e) {
    console.error('[Detection] Failed to persist vehicle detections from worker:', e);
  }
}

/**
 * Persist readable plate OCR rows so GET /detections/recent-plates and monitoring can see them.
 * Vehicle-only rows use plateNumber NONE; plates come from msg.plates separately.
 */
function savePlateDetectionsFromWorker(cameraId, msg) {
  try {
    const plates = Array.isArray(msg?.plates) ? msg.plates : [];
    if (!plates.length) return;

    const timestamp =
      typeof msg?.timestamp === 'string' ? msg.timestamp : new Date().toISOString();
    const imageUrl = typeof msg?.imageUrl === 'string' ? msg.imageUrl : null;
    let savedCount = 0;

    plates.forEach((p, index) => {
      if (!p || typeof p.plateNumber !== 'string') return;
      const raw = p.plateNumber.trim();
      const upper = raw.toUpperCase();
      if (!raw || upper === 'NONE' || upper === 'BLUR' || upper === 'UNKNOWN') return;

      const detectionId = `DET-${cameraId}-${Date.now()}-p${index}-${Math.random().toString(36).slice(2, 10)}`;
      const confidence = typeof p.confidence === 'number' ? p.confidence : 0;
      const bbox = p.bbox ? JSON.stringify(p.bbox) : null;
      const className =
        typeof p.class_name === 'string' && p.class_name.trim()
          ? p.class_name.trim()
          : 'plate';

      insertDetectionStmt.run(
        detectionId,
        cameraId,
        raw,
        timestamp,
        confidence,
        imageUrl,
        bbox,
        className,
        null,
      );
      savedCount += 1;
    });

    if (savedCount > 0) {
      console.log(`[Detection] Camera ${cameraId}: saved ${savedCount} readable plate row(s) for recent-plates`);
    }
  } catch (e) {
    console.error('[Detection] Failed to persist plate detections from worker:', e);
  }
}

async function sendNoPlateBarangayAlert(cameraId, msg) {
  const vehicles = Array.isArray(msg?.vehicles) ? msg.vehicles : [];
  const plates = Array.isArray(msg?.plates) ? msg.plates : [];
  const hasReadablePlate = plates.some(
    (p) => p?.plateNumber && p.plateNumber !== 'NONE' && p.plateNumber !== 'BLUR'
  );
  if (!vehicles.length || hasReadablePlate) return;

  const lastSentAt = lastNoPlateAlertAt.get(cameraId) || 0;
  if (Date.now() - lastSentAt < NO_PLATE_ALERT_COOLDOWN_MS) return;
  lastNoPlateAlertAt.set(cameraId, Date.now());

  const camera = db.prepare('SELECT id, locationId, name FROM cameras WHERE id = ?').get(cameraId);
  const locationLabel = camera?.locationId || 'Unknown location';
  const cameraLabel = camera?.name || cameraId;
  const nowIso = new Date().toISOString();

  try {
    const notificationId = `NOTIF-NOPLATE-${cameraId}-${Date.now()}`;
    db.prepare(`
      INSERT INTO notifications (
        id, type, title, message, cameraId, locationId,
        incidentId, detectionId, imageUrl, imageBase64,
        plateNumber, timeDetected, reason, timestamp, read
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      notificationId,
      'plate_not_visible',
      'Vehicle detected with no readable plate',
      `Vehicle detected at ${locationLabel} (${cameraLabel}) but no readable plate was captured. Barangay follow-up is required.`,
      camera?.id || cameraId,
      locationLabel,
      null,
      null,
      msg?.imageUrl || null,
      null,
      'NONE',
      nowIso,
      'vehicle_detected_no_plate',
      nowIso,
      0
    );
  } catch (error) {
    console.error('[Detection] Failed to create no-plate notification:', error?.message || error);
  }

  try {
    const enforcers = db.prepare(`
      SELECT id, name, contactNumber
      FROM users
      WHERE role = 'barangay_user'
        AND status = 'active'
        AND contactNumber IS NOT NULL
        AND TRIM(contactNumber) != ''
    `).all();
    if (!enforcers.length) return;

    const message = `Vehicle detected at ${locationLabel}, but plate number is not readable. Please check camera ${cameraLabel}.`;
    for (const user of enforcers) {
      const result = await sendSmsMessage(user.contactNumber, message);
      if (!result.success) {
        console.log(
          `[Detection] No-plate SMS failed for user ${user.id} (${user.contactNumber}): ${result.error}`
        );
      }
    }
  } catch (error) {
    console.error('[Detection] Failed sending no-plate Barangay SMS:', error?.message || error);
  }
}

function broadcastStatus(cameraId, status, detail = null) {
  const text = detail || status;
  workerStatuses.set(cameraId, text);

  const subs = subscribers.get(cameraId);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({
    type: 'status',
    cameraId,
    status,
    detail: text,
  });

  for (const ws of subs) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

function getOnlineCamerasForDetection() {
  try {
    const rows = db.prepare(
      'SELECT id, deviceId, detectionRtspUrl FROM cameras WHERE status = ?',
    ).all('online');
    return rows.filter((r) => {
      const d = r.deviceId && String(r.deviceId).trim();
      const u = r.detectionRtspUrl && String(r.detectionRtspUrl).trim();
      return Boolean(d || u);
    });
  } catch (e) {
    console.error('[Detection] DB error:', e);
    return [];
  }
}

function buildRtspUrl(deviceId) {
  const stream = String(deviceId).trim();
  const base = GO2RTC_RTSP_BASE.replace(/\/+$/, '');
  return `${base}/${stream}`;
}

/** Full RTSP URL for the Python worker: per-camera override, else go2rtc base + stream name. */
function resolveDetectionRtspUrl(cam) {
  const override = cam.detectionRtspUrl && String(cam.detectionRtspUrl).trim();
  if (override) {
    if (/^rtsp:\/\//i.test(override)) return override;
    console.warn(
      `[Detection] Camera ${cam.id}: detectionRtspUrl must start with rtsp:// — falling back to go2rtc path`,
    );
  }
  const deviceId = cam.deviceId && String(cam.deviceId).trim();
  if (!deviceId) return null;
  return buildRtspUrl(deviceId);
}

function startWorker(cameraId, rtspUrl) {
  const backoffUntil = workerBackoffUntil.get(cameraId);
  if (backoffUntil && Date.now() < backoffUntil) {
    return;
  }
  if (workers.has(cameraId)) return;

  console.log(`[Detection] Starting worker for ${cameraId} -> ${rtspUrl}`);
  broadcastStatus(cameraId, 'loading_model', 'Loading model...');

  const proc = spawn(pythonCmd, [
    DETECTION_WORKER_PATH,
    '--camera-id', cameraId,
    '--rtsp-url', rtspUrl,
    '--interval', '2.5',
  ], {
    cwd: __dirname,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  let buffer = '';
  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        // Fire-and-forget side effects; do not block broadcast.
        handlePlateDetections(cameraId, msg).catch((e) => {
          console.error('[Detection][SMS] handlePlateDetections error:', e);
        });
        sendNoPlateBarangayAlert(cameraId, msg).catch((e) => {
          console.error('[Detection] sendNoPlateBarangayAlert error:', e);
        });
        savePlateDetectionsFromWorker(cameraId, msg);
        saveVehicleDetectionsFromWorker(cameraId, msg);
        broadcast(cameraId, msg);
      } catch (e) {
        console.warn('[Detection] Parse error:', e.message, 'line:', line.slice(0, 80));
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const str = data.toString().trim();
    // Torch can emit frequent NNPACK CPU capability warnings on small VPS CPUs.
    // They are noisy but non-fatal, so skip logging them.
    if (str && !str.includes('NNPACK.cpp:56')) console.log(`[Worker ${cameraId}]`, str);
    if (str.includes('Loading model')) {
      broadcastStatus(cameraId, 'loading_model', 'Loading model...');
    } else if (str.includes('Model loaded') && str.includes('starting detection loop')) {
      workerBackoffUntil.delete(cameraId);
      broadcastStatus(cameraId, 'starting_detection_loop', 'Starting detection loop...');
    } else if (str.includes('Model loaded')) {
      workerBackoffUntil.delete(cameraId);
      broadcastStatus(cameraId, 'model_loaded', 'Model loaded');
    }
  });

  proc.on('close', (code, signal) => {
    workers.delete(cameraId);
    workerStatuses.delete(cameraId);
    workerRtspUrls.delete(cameraId);
    if (code !== 0 && code !== null) {
      console.warn(`[Detection] Worker ${cameraId} exited: code=${code} signal=${signal}`);
      workerBackoffUntil.set(cameraId, Date.now() + 20000);
    }
  });

  proc.on('error', (err) => {
    console.error(`[Detection] Worker ${cameraId} error:`, err);
    workers.delete(cameraId);
    workerStatuses.delete(cameraId);
    workerRtspUrls.delete(cameraId);
    workerBackoffUntil.set(cameraId, Date.now() + 20000);
  });

  workers.set(cameraId, proc);
  workerRtspUrls.set(cameraId, rtspUrl);
}

function stopWorker(cameraId) {
  const proc = workers.get(cameraId);
  if (proc) {
    proc.kill('SIGTERM');
    workers.delete(cameraId);
    workerStatuses.delete(cameraId);
    workerRtspUrls.delete(cameraId);
    console.log(`[Detection] Stopped worker for ${cameraId}`);
  }
}

function syncWorkers() {
  if (!getDetectionEnabled()) {
    for (const [cameraId] of workers) {
      stopWorker(cameraId);
    }
    return;
  }

  const cameras = getOnlineCamerasForDetection();
  const wanted = new Set(cameras.map((c) => c.id));

  for (const [cameraId] of workers) {
    if (!wanted.has(cameraId)) {
      stopWorker(cameraId);
    }
  }

  for (const cam of cameras) {
    const rtspUrl = resolveDetectionRtspUrl(cam);
    if (!rtspUrl) continue;

    const runningUrl = workerRtspUrls.get(cam.id);
    if (workers.has(cam.id) && runningUrl && runningUrl !== rtspUrl) {
      stopWorker(cam.id);
    }

    if (!workers.has(cam.id)) {
      startWorker(cam.id, rtspUrl);
    }
  }
}

function broadcast(cameraId, msg) {
  const subs = subscribers.get(cameraId);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({ type: 'detection', cameraId, ...msg });
  for (const ws of subs) {
    if (ws.readyState === 1) {
      ws.send(payload);
    }
  }
}

function subscribe(ws, cameraId) {
  if (!subscribers.has(cameraId)) {
    subscribers.set(cameraId, new Set());
  }
  subscribers.get(cameraId).add(ws);

  if (workerStatuses.has(cameraId) && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: 'status',
      cameraId,
      status: 'current',
      detail: workerStatuses.get(cameraId),
    }));
  }
}

function unsubscribe(ws, cameraId) {
  const subs = subscribers.get(cameraId);
  if (subs) {
    subs.delete(ws);
    if (subs.size === 0) subscribers.delete(cameraId);
  }
}

function unsubscribeAll(ws) {
  for (const [cameraId, subs] of subscribers) {
    subs.delete(ws);
    if (subs.size === 0) subscribers.delete(cameraId);
  }
}

export function createDetectionService(httpServer) {
  if (wss) return;

  wss = new WebSocketServer({
    server: httpServer,
    path: '/api/detect/ws',
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const cameraIds = url.searchParams.get('cameraIds')?.split(',').map((s) => s.trim()).filter(Boolean) || [];

    for (const id of cameraIds) {
      subscribe(ws, id);
    }

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribe' && Array.isArray(msg.cameraIds)) {
          for (const id of msg.cameraIds) {
            subscribe(ws, id);
          }
        } else if (msg.type === 'unsubscribe' && Array.isArray(msg.cameraIds)) {
          for (const id of msg.cameraIds) {
            unsubscribe(ws, id);
          }
        }
      } catch (_) {}
    });

    ws.on('close', () => {
      unsubscribeAll(ws);
    });
  });

  syncWorkers();
  const syncInterval = setInterval(syncWorkers, SYNC_INTERVAL_MS);

  console.log('[Detection] Service started. WebSocket at /api/detect/ws');

  return {
    stop() {
      clearInterval(syncInterval);
      for (const [cameraId] of workers) {
        stopWorker(cameraId);
      }
      if (wss) {
        wss.close();
        wss = null;
      }
    },
  };
}

/** Called when detection enabled state changes to immediately sync workers. */
export function syncDetectionWorkers() {
  syncWorkers();
}
