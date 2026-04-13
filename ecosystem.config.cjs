/**
 * PM2: run exactly ONE Node process — server/server.js.
 * Do NOT add a separate app for detection_worker.py; the server spawns workers with CLI args.
 *
 * Usage (from repo root):
 *   NODE_ENV=production pm2 start ecosystem.config.cjs
 *   pm2 save
 */
module.exports = {
  apps: [
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
