/**
 * PM2: Node app + go2rtc (RTSP relay for browser WebRTC + server-side detection).
 * Do NOT add detection_worker.py here; server/server.js spawns workers with CLI args.
 *
 * Usage (from repo root):
 *   NODE_ENV=production pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * go2rtc binary: install to /usr/local/bin/go2rtc or set GO2RTC_BIN to the full path.
 */
const fs = require('fs');
const path = require('path');

function resolveGo2rtcBinary() {
  const fromEnv = process.env.GO2RTC_BIN;
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (fs.existsSync('/usr/local/bin/go2rtc')) return '/usr/local/bin/go2rtc';
  return 'go2rtc';
}

const go2rtcConfig = path.join(__dirname, 'server', 'go2rtc', 'go2rtc.yaml');

module.exports = {
  apps: [
    {
      name: 'go2rtc',
      cwd: __dirname,
      script: resolveGo2rtcBinary(),
      args: ['-config', go2rtcConfig],
      interpreter: 'none',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_restarts: 20,
      min_uptime: '3s',
    },
    {
      name: 'ledger-monitor',
      cwd: __dirname,
      script: 'server/server.js',
      interpreter: 'node',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
