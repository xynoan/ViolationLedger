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
import { sendSmsMessage } from './utils/smsService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DETECTION_WORKER_PATH = join(__dirname, 'detection_worker.py');
const GO2RTC_RTSP_BASE = process.env.GO2RTC_RTSP_BASE || 'rtsp://127.0.0.1:8554';
const SYNC_INTERVAL_MS = 30000; // Re-sync workers every 30s
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

/** cameraId -> ChildProcess */
const workers = new Map();

/** cameraId -> Set<WebSocket> */
const subscribers = new Map();

/** HTTP server for WebSocket upgrade */
let wss = null;

// In-memory throttle map to avoid spamming SMS for the same plate on the same camera.
// Key format: `${cameraId}:${normalizedPlate}` -> lastSentTimestamp (ms)
const smsThrottle = new Map();
const SMS_THROTTLE_MS = 5 * 60 * 1000; // 5 minutes

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

async function sendPlateSmsIfRegistered(cameraId, plateNumber) {
  const normalizedPlate = normalizePlateForMatch(plateNumber);
  if (!normalizedPlate) return;

  const key = `${cameraId}:${normalizedPlate}`;
  const now = Date.now();
  const lastSent = smsThrottle.get(key) || 0;
  if (now - lastSent < SMS_THROTTLE_MS) {
    return;
  }

  // Look up vehicle using the same normalization as violations/sms services:
  // REPLACE(UPPER(plateNumber), ' ', '') = normalizedPlate
  let vehicle;
  try {
    vehicle = db
      .prepare(`SELECT * FROM vehicles WHERE REPLACE(UPPER(plateNumber), ' ', '') = ?`)
      .get(normalizedPlate);
  } catch (e) {
    console.error('[Detection][SMS] DB lookup error for plate', plateNumber, e);
    return;
  }

  if (!vehicle || !vehicle.contactNumber) {
    return;
  }

  const currentTime = new Date().toLocaleString('en-US', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  const message =
    `Hi ${vehicle.ownerName}, ` +
    `your vehicle ${vehicle.plateNumber} was detected entering or parked at ${cameraId} on ${currentTime}. ` +
    `This is an automated notification from ViolationLedger.`;

  try {
    const result = await sendSmsMessage(vehicle.contactNumber, message);
    if (result.success) {
      smsThrottle.set(key, now);
      console.log(
        `[Detection][SMS] SMS sent for plate ${vehicle.plateNumber} on camera ${cameraId} (status: ${result.status || 'accepted'})`
      );
    } else {
      console.warn(
        `[Detection][SMS] Failed to send SMS for plate ${vehicle.plateNumber} on camera ${cameraId}:`,
        result.error
      );
    }
  } catch (e) {
    console.error('[Detection][SMS] Unexpected error while sending SMS', e);
  }
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
    await sendPlateSmsIfRegistered(cameraId, normalized);
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
    const timestampId = timestamp.replace(/[-:]/g, '').split('.')[0];
    const imageUrl = typeof msg?.imageUrl === 'string' ? msg.imageUrl : null;

    vehicles.forEach((v, index) => {
      if (!v || typeof v.class_name !== 'string') return;

      const detectionId = `DET-${cameraId}-${timestampId}-${index}`;
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
    });
  } catch (e) {
    console.error('[Detection] Failed to persist vehicle detections from worker:', e);
  }
}

function getOnlineCamerasWithDeviceId() {
  try {
    const rows = db.prepare('SELECT id, deviceId FROM cameras WHERE status = ? AND deviceId IS NOT NULL AND deviceId != ?').all('online', '');
    return rows.filter((r) => r.deviceId && String(r.deviceId).trim());
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

function startWorker(cameraId, deviceId) {
  if (workers.has(cameraId)) return;

  const rtspUrl = buildRtspUrl(deviceId);
  console.log(`[Detection] Starting worker for ${cameraId} -> ${rtspUrl}`);

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
        saveVehicleDetectionsFromWorker(cameraId, msg);
        broadcast(cameraId, msg);
      } catch (e) {
        console.warn('[Detection] Parse error:', e.message, 'line:', line.slice(0, 80));
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const str = data.toString().trim();
    if (str) console.log(`[Worker ${cameraId}]`, str);
  });

  proc.on('close', (code, signal) => {
    workers.delete(cameraId);
    if (code !== 0 && code !== null) {
      console.warn(`[Detection] Worker ${cameraId} exited: code=${code} signal=${signal}`);
    }
  });

  proc.on('error', (err) => {
    console.error(`[Detection] Worker ${cameraId} error:`, err);
    workers.delete(cameraId);
  });

  workers.set(cameraId, proc);
}

function stopWorker(cameraId) {
  const proc = workers.get(cameraId);
  if (proc) {
    proc.kill('SIGTERM');
    workers.delete(cameraId);
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

  const cameras = getOnlineCamerasWithDeviceId();
  const wanted = new Set(cameras.map((c) => c.id));

  for (const [cameraId] of workers) {
    if (!wanted.has(cameraId)) {
      stopWorker(cameraId);
    }
  }

  for (const cam of cameras) {
    if (!workers.has(cam.id)) {
      startWorker(cam.id, cam.deviceId);
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
