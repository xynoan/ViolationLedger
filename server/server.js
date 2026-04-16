import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import net from 'net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, '.env');
const envResult = dotenv.config({ path: envPath, debug: false });

if (envResult.error) {
  console.warn(`⚠️  Warning: Could not load .env file from ${envPath}`);
  console.warn(`   Error: ${envResult.error.message}`);
}

import express from 'express';
import cors from 'cors';
import { WebSocket, WebSocketServer } from 'ws';
import camerasRouter from './routes/cameras.js';
import vehiclesRouter from './routes/vehicles.js';
import violationsRouter from './routes/violations.js';
import capturesRouter from './routes/captures.js';
import detectionsRouter from './routes/detections.js';
import authRouter from './routes/auth.js';
import notificationsRouter from './routes/notifications.js';
import uploadRouter from './routes/upload.js';
import healthRouter from './routes/health.js';
import analyticsRouter from './routes/analytics.js';
import usersRouter from './routes/users.js';
import auditLogsRouter from './routes/audit_logs.js';
import residentsRouter from './routes/residents.js';
import ocrRouter from './routes/ocr.js';
import detectRouter from './routes/detect.js';
import { auditLog } from './middleware/audit.js';
import db from './database.js';
import monitoringService from './monitoring_service.js';
import cleanupService from './cleanup_service.js';

const app = express();
const PORT = process.env.PORT || 3001;
const GO2RTC_PROXY_TARGET = process.env.GO2RTC_PROXY_TARGET || 'http://127.0.0.1:1984';
const GO2RTC_PROXY_WS_TARGET = GO2RTC_PROXY_TARGET.replace(/^http/i, 'ws').replace(/\/+$/, '');
const GO2RTC_STARTUP_HEALTHCHECK = process.env.GO2RTC_STARTUP_HEALTHCHECK !== '0';
if (!process.env.GEMINI_API_KEY) {
  console.warn('⚠️  GEMINI_API_KEY not set - using fallback');
}

if (!process.env.IPROGSMS_API_TOKEN) {
  console.warn('⚠️  IPROGSMS_API_TOKEN not set - SMS notifications will be disabled');
  console.warn('   To enable SMS notifications: Add IPROGSMS_API_TOKEN to your .env file in the server directory');
} else {
  console.log('✅ SMS service configured - IPROGSMS_API_TOKEN found');
}

app.set('trust proxy', true);

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((req, res, next) => {
  req.setTimeout(30000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: 'Request timeout' });
    }
  });
  next();
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (!res.headersSent) {
    res.status(err.status || 500).json({
      error: err.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
  }
});

app.use('/captured_images', express.static(path.join(__dirname, 'captured_images')));

app.use('/api/auth', authRouter);
app.use('/api/cameras', camerasRouter);
app.use('/api/vehicles', vehiclesRouter);
app.use('/api/violations', violationsRouter);
app.use('/api/captures', capturesRouter);
app.use('/api/detections', detectionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/health', healthRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api/users', usersRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/residents', residentsRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/detect', detectRouter);

// Serve built frontend in production (single-domain deployment)
const distPath = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/captured_images')) return next();
    res.sendFile(path.join(distPath, 'index.html'));
  });
  console.log('📁 Serving frontend from dist/');
}

let detectionServiceHandle = null;
const go2rtcProxyWss = new WebSocketServer({ noServer: true });

function isPrivateOrLocalHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '::1') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  if (host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  if (host.startsWith('172.')) {
    const octets = host.split('.');
    const second = Number(octets[1]);
    if (Number.isInteger(second) && second >= 16 && second <= 31) return true;
  }
  return net.isIP(host) !== 0 ? false : false;
}

function extractGo2RtcStreamSources(configText) {
  const lines = String(configText || '').split('\n');
  const streamEntries = [];
  let inStreams = false;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r/g, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!inStreams && /^streams\s*:/.test(trimmed)) {
      inStreams = true;
      continue;
    }
    if (inStreams && !line.startsWith('  ')) break;
    if (!inStreams) continue;

    const match = line.match(/^\s{2}([^:#\s][^:]*)\s*:\s*["']?(.+?)["']?\s*$/);
    if (!match) continue;
    streamEntries.push({
      streamName: match[1].trim(),
      sourceUrl: match[2].trim(),
    });
  }
  return streamEntries;
}

function createGo2RtcPrivateSourceNotification(privateSources) {
  if (!privateSources.length) return;
  try {
    const existing = db.prepare(`
      SELECT id FROM notifications
      WHERE type = 'system_alert'
      AND title = 'Go2RTC stream source unreachable from VPS'
      AND read = 0
      LIMIT 1
    `).get();
    if (existing) return;

    const now = new Date().toISOString();
    const summary = privateSources
      .map(({ streamName, sourceUrl }) => `${streamName} => ${sourceUrl}`)
      .join(', ');

    db.prepare(`
      INSERT INTO notifications (
        id, type, title, message, cameraId, locationId, incidentId, detectionId,
        imageUrl, imageBase64, plateNumber, timeDetected, reason, timestamp, read
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `NOTIF-SYSTEM-GO2RTC-${Date.now()}`,
      'system_alert',
      'Go2RTC stream source unreachable from VPS',
      `Detected private/local go2rtc upstream source(s): ${summary}. On cloud servers, use a public URL or VPN/tunnel-accessible camera endpoint.`,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      now,
      'go2rtc_startup_healthcheck',
      now,
      0
    );
  } catch (error) {
    console.error('⚠️  Failed to create go2rtc health notification:', error?.message || error);
  }
}

async function runGo2RtcStartupHealthCheck() {
  if (!GO2RTC_STARTUP_HEALTHCHECK) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  const target = `${GO2RTC_PROXY_TARGET.replace(/\/+$/, '')}/api/config`;

  try {
    const response = await fetch(target, { signal: controller.signal });
    if (!response.ok) {
      console.warn(`⚠️  go2rtc health check skipped: ${target} returned ${response.status}`);
      return;
    }
    const configText = await response.text();
    const streams = extractGo2RtcStreamSources(configText);
    const privateSources = streams
      .map((entry) => {
        try {
          const url = new URL(entry.sourceUrl);
          return { ...entry, hostname: url.hostname };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => isPrivateOrLocalHost(entry.hostname));

    if (privateSources.length === 0) {
      console.log('✅ go2rtc health check: no private/local upstream stream sources detected.');
      return;
    }

    console.error(
      `❌ go2rtc health check: detected private/local upstream source(s): ${privateSources
        .map((s) => `${s.streamName} (${s.sourceUrl})`)
        .join(', ')}`
    );
    createGo2RtcPrivateSourceNotification(privateSources);
  } catch (error) {
    console.warn(`⚠️  go2rtc health check failed: ${error?.message || error}`);
  } finally {
    clearTimeout(timeout);
  }
}

go2rtcProxyWss.on('connection', (clientWs, req) => {
  const requestPath = req.url?.replace(/^\/go2rtc/, '') || '/';
  const upstreamUrl = `${GO2RTC_PROXY_WS_TARGET}${requestPath}`;
  const upstreamWs = new WebSocket(upstreamUrl);
  let isClosing = false;

  const closeBoth = () => {
    if (isClosing) return;
    isClosing = true;
    try {
      if (clientWs.readyState === WebSocket.OPEN || clientWs.readyState === WebSocket.CONNECTING) {
        clientWs.close();
      }
    } catch {}
    try {
      if (upstreamWs.readyState === WebSocket.OPEN || upstreamWs.readyState === WebSocket.CONNECTING) {
        upstreamWs.close();
      }
    } catch {}
  };

  clientWs.on('message', (data, isBinary) => {
    if (upstreamWs.readyState === WebSocket.OPEN) {
      upstreamWs.send(data, { binary: isBinary });
    }
  });

  upstreamWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  upstreamWs.on('error', (err) => {
    const message = err?.message || String(err);
    if (!isClosing && !/closed before the connection was established/i.test(message)) {
      console.warn('[go2rtc-proxy] Upstream WS error:', message);
    }
    closeBoth();
  });

  clientWs.on('error', () => {
    closeBoth();
  });

  clientWs.on('close', () => {
    closeBoth();
  });

  upstreamWs.on('close', () => {
    closeBoth();
  });
});

function startServer(port, isRetry = false) {
  const server = app.listen(port, async () => {
    console.log(`🚀 Server running on http://localhost:${port}`);
    if (isRetry) {
      console.log(`⚠️  Note: Server started on port ${port} instead of ${PORT}`);
      console.log(`⚠️  Update VITE_API_URL in your .env file to: http://localhost:${port}/api`);
    }
    try {
      const { createDetectionService } = await import('./detection_service.js');
      detectionServiceHandle = createDetectionService(server);
    } catch (err) {
      console.warn('⚠️  Detection service failed to start:', err.message);
    }
    setTimeout(() => {
      runGo2RtcStartupHealthCheck();
    }, 3000);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`⚠️  Port ${port} is in use, trying another one...`);
      const nextPort = port + 1;
      if (nextPort <= port + 10) {
        startServer(nextPort, true);
      } else {
        console.error(`❌ Could not find an available port. Tried ports ${PORT}-${port}`);
        console.error(`💡 Please free up port ${PORT} or set PORT environment variable to an available port`);
        process.exit(1);
      }
    } else {
      console.error('❌ Server error:', err);
      process.exit(1);
    }
  });

  server.on('upgrade', (req, socket, head) => {
    if (!req.url?.startsWith('/go2rtc')) return;

    go2rtcProxyWss.handleUpgrade(req, socket, head, (ws) => {
      go2rtcProxyWss.emit('connection', ws, req);
    });
  });
}

startServer(PORT);

monitoringService.start();

cleanupService.start();

process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down...');
  if (detectionServiceHandle?.stop) {
    detectionServiceHandle.stop();
  }
  monitoringService.stop();
  cleanupService.stop();
  db.close();
  console.log('👋 Database connection closed');
  process.exit(0);
});

