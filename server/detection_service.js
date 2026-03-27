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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DETECTION_WORKER_PATH = join(__dirname, 'detection_worker.py');
const GO2RTC_RTSP_BASE = process.env.GO2RTC_RTSP_BASE || 'rtsp://127.0.0.1:8554';
const SYNC_INTERVAL_MS = 30000; // Re-sync workers every 30s
const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

/** cameraId -> ChildProcess */
const workers = new Map();

/** cameraId -> boolean, first frame received */
const firstFrameReceived = new Map();

/** cameraId -> Set<WebSocket> */
const subscribers = new Map();

/** HTTP server for WebSocket upgrade */
let wss = null;

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

  const uniquePlates = new Set(
    plates
      .map((p) => (p && typeof p.plateNumber === 'string' ? normalizePlateForMatch(p.plateNumber) : ''))
      .filter(Boolean)
  );

  for (const normalized of uniquePlates) {
    try {
      const camera = db.prepare('SELECT id, locationId FROM cameras WHERE id = ?').get(cameraId);
      const locationId = camera?.locationId;
      if (!locationId) {
        console.warn(`[Detection] Skipping violation for plate ${normalized} on camera ${cameraId} - no locationId`);
        continue;
      }
      await createViolationFromDetection(normalized, locationId, null);
    } catch (e) {
      console.error('[Detection] Failed to create violation from RTSP plate detection', { cameraId, plate: normalized, error: e?.message || e });
    }
  }
}

function saveVehicleDetectionsFromWorker(cameraId, msg) {
  try {
    const vehicles = Array.isArray(msg?.vehicles) ? msg.vehicles : [];
    if (!vehicles.length) return;

    const timestamp = typeof msg?.timestamp === 'string' ? msg.timestamp : new Date().toISOString();
    const timestampId = timestamp.replace(/[-:]/g, '').split('.')[0];
    const imageUrl = typeof msg?.imageUrl === 'string' ? msg.imageUrl : null;

    vehicles.forEach((v, index) => {
      if (!v || typeof v.class_name !== 'string') return;
      const detectionId = `DET-${cameraId}-${timestampId}-${index}`;
      const plateNumber = 'NONE';
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
        null
      );
    });
  } catch (e) {
    console.error('[Detection] Failed to persist vehicle detections from worker:', e);
  }
}

function getCamerasWithDeviceId() {
  try {
    const rows = db.prepare('SELECT id, deviceId FROM cameras WHERE deviceId IS NOT NULL AND deviceId != ?').all('');
    return rows.filter(r => r.deviceId && String(r.deviceId).trim());
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
  firstFrameReceived.set(cameraId, false);

  proc.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);

        // Only mark camera online after first valid detection
        if (!firstFrameReceived.get(cameraId) && msg?.vehicles?.length > 0) {
          firstFrameReceived.set(cameraId, true);
          const now = new Date().toISOString();
          db.prepare('UPDATE cameras SET status = ?, lastCapture = ? WHERE id = ?')
            .run('online', now, cameraId);
          console.log(`[Detection] Camera ${cameraId} marked ONLINE`);
        }

        handlePlateDetections(cameraId, msg).catch(console.error);
        saveVehicleDetectionsFromWorker(cameraId, msg);
        broadcast(cameraId, msg);

      } catch (e) {
        console.warn('[Detection] Parse error:', e.message);
      }
    }
  });

  proc.stderr.on('data', (data) => {
    const str = data.toString().trim();
    if (str) console.log(`[Worker ${cameraId}]`, str);
  });

  proc.on('close', (code, signal) => {
    workers.delete(cameraId);
    firstFrameReceived.delete(cameraId);
    try {
      db.prepare('UPDATE cameras SET status = ? WHERE id = ?').run('offline', cameraId);
      console.log(`[Detection] Camera ${cameraId} set to offline`);
    } catch (e) {
      console.error(`[Detection] Failed to mark camera ${cameraId} offline`, e);
    }

    if (getDetectionEnabled()) {
      console.log(`[Detection] Will retry worker for ${cameraId} in 5s`);
      setTimeout(() => startWorker(cameraId, deviceId), 5000);
    }
  });

  proc.on('error', (err) => {
    console.error(`[Detection] Worker ${cameraId} error:`, err);
    workers.delete(cameraId);
    firstFrameReceived.delete(cameraId);

    if (getDetectionEnabled()) {
      console.log(`[Detection] Will retry worker for ${cameraId} in 5s due to error`);
      setTimeout(() => startWorker(cameraId, deviceId), 5000);
    }
  });

  workers.set(cameraId, proc);
}

function stopWorker(cameraId) {
  const proc = workers.get(cameraId);
  if (proc) {
    proc.kill('SIGTERM');
    workers.delete(cameraId);
    firstFrameReceived.delete(cameraId);
    console.log(`[Detection] Stopped worker for ${cameraId}`);
  }
}

function syncWorkers() {
  if (!getDetectionEnabled()) {
    for (const [cameraId] of workers) stopWorker(cameraId);
    return;
  }

  const cameras = getCamerasWithDeviceId();
  const wanted = new Set(cameras.map((c) => c.id));

  for (const [cameraId] of workers) {
    if (!wanted.has(cameraId)) stopWorker(cameraId);
  }

  for (const cam of cameras) {
    if (!workers.has(cam.id)) startWorker(cam.id, cam.deviceId);
  }
}

function broadcast(cameraId, msg) {
  const subs = subscribers.get(cameraId);
  if (!subs || subs.size === 0) return;

  const payload = JSON.stringify({ type: 'detection', cameraId, ...msg });
  for (const ws of subs) {
    if (ws.readyState === 1) ws.send(payload);
  }
}

function subscribe(ws, cameraId) {
  if (!subscribers.has(cameraId)) subscribers.set(cameraId, new Set());
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

  wss = new WebSocketServer({ server: httpServer, path: '/api/detect/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const cameraIds = url.searchParams.get('cameraIds')?.split(',').map((s) => s.trim()).filter(Boolean) || [];

    for (const id of cameraIds) subscribe(ws, id);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribe' && Array.isArray(msg.cameraIds)) {
          for (const id of msg.cameraIds) subscribe(ws, id);
        } else if (msg.type === 'unsubscribe' && Array.isArray(msg.cameraIds)) {
          for (const id of msg.cameraIds) unsubscribe(ws, id);
        }
      } catch (_) {}
    });

    ws.on('close', () => unsubscribeAll(ws));
  });

  syncWorkers();
  const syncInterval = setInterval(syncWorkers, SYNC_INTERVAL_MS);
  console.log('[Detection] Service started. WebSocket at /api/detect/ws');

  return {
    stop() {
      clearInterval(syncInterval);
      for (const [cameraId] of workers) stopWorker(cameraId);
      if (wss) {
        wss.close();
        wss = null;
      }
    },
  };
}

export function syncDetectionWorkers() {
  syncWorkers();
}