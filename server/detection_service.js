/**
 * Server-side detection service (Option C).
 * Manages long-running Python workers that capture frames from RTSP and run YOLO.
 * Broadcasts detections to WebSocket clients.
 */

import { spawn } from 'child_process';
import { WebSocketServer } from 'ws';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import db from './database.js';

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
