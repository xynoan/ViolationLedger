# Deploying LedgerMonitor with Your Domain

This guide gets the app running on a server and reachable at **your domain** with HTTPS.

## What you need

- A **VPS** (e.g. DigitalOcean, Linode, Vultr, or any Ubuntu 22.04+ server)
- A **domain** whose DNS you control
- SSH access to the server

## How to find your server’s public IP

You need this for the GoDaddy (or other) DNS A records.

- **From your host’s dashboard:** When you create or open the VPS, the public IP is shown on the droplet/server page (e.g. DigitalOcean: **Droplets** → click the server → **Public IPv4**; Linode/Vultr: same idea).
- **From the server itself (over SSH):** After you log in, run:
  ```bash
  curl -s ifconfig.me
  ```
  or
  ```bash
  curl -s icanhazip.com
  ```
  The printed value is your server’s public IP — use it as the **Value** for the A records.

## 1. Point your domain to the server

### If your domain is on GoDaddy

1. Log in at [godaddy.com](https://www.godaddy.com) → **My Products**.
2. Find your domain → click **DNS** (or **Manage DNS**).
3. Add or edit records so the domain points to your server’s **public IP**:
   - **Root domain (yourdomain.com):**
     - **Type:** `A`
     - **Name:** `@`
     - **Value:** your server’s public IP (e.g. `123.45.67.89`)
     - **TTL:** 600 (or default)
   - **www (www.yourdomain.com):**
     - **Type:** `A`
     - **Name:** `www`
     - **Value:** same IP as above
     - **TTL:** 600 (or default)
4. **Save**. GoDaddy often propagates within 10–30 minutes; sometimes up to a few hours.

If you see an existing **CNAME** for `www` pointing to something like `@` or `parkingpage`, you can delete it and add the **A** record for `www` as above so both `yourdomain.com` and `www.yourdomain.com` work.

### Other DNS providers

- Add an **A record**: name `@` (root), value = **your server’s public IP**.
- Optional: add another A record for `www` → same IP.

### Check that it’s working

After a few minutes:

```bash
ping yourdomain.com
```

The IP shown should be your server’s public IP.

## 2. Prepare the server (Ubuntu 22.04)

SSH in and install Node 20 and Nginx:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Optional (recommended for keeping the app running):

```bash
sudo npm install -g pm2
```

## 3. Deploy the app

Clone the repo (or upload your code) and build:

```bash
cd /opt   # or another directory you prefer
sudo git clone https://github.com/YOUR_USER/LedgerMonitor.git
sudo chown -R $USER:$USER LedgerMonitor
cd LedgerMonitor
npm install
npm run build:prod
cd server
npm install
cp .env.example .env
# Edit .env and set at least: PORT=3001, GEMINI_API_KEY (if you use AI), etc.
```

Create the admin user (first time only):

```bash
cd /opt/LedgerMonitor/server
node create-admin-user.js
```

Run with PM2 so it restarts on reboot:

```bash
cd /opt/LedgerMonitor
NODE_ENV=production pm2 start server/server.js --name ledger-monitor -i 1
pm2 save
pm2 startup   # follow the command it prints to enable on boot
```

The app is now listening on **port 3001**. Keep the default port or set `PORT` in `server/.env`.

## 4. Nginx + SSL (HTTPS) for your domain

Nginx will accept HTTPS for your domain and proxy to the Node app.

Create a config (replace `yourdomain.com` with your domain):

```bash
sudo nano /etc/nginx/sites-available/ledger-monitor
```

Paste (and fix the domain):

```nginx
server {
    listen 80;
    server_name yourdomain.com www.yourdomain.com;
    # Proxy go2rtc WebSocket under the same HTTPS domain.
    # Frontend uses: wss://yourdomain.com/go2rtc/api/ws?src=cam1
    location /go2rtc/ {
        proxy_pass http://127.0.0.1:1984/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable the site and get a free SSL certificate:

```bash
sudo ln -s /etc/nginx/sites-available/ledger-monitor /etc/nginx/sites-enabled/
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com
```

Follow the prompts. Certbot will add HTTPS and redirect HTTP → HTTPS.

Reload Nginx:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## 5. Open the app

Visit **https://yourdomain.com**. You should see LedgerMonitor and can log in with the admin user you created.

## Environment variables (production)

**Root (for build):**

- `VITE_API_URL=/api` — already set by `npm run build:prod` for same-domain use.
- `VITE_GO2RTC_WS_URL` — only if you run go2rtc on another host/path; recommended with proxy: `VITE_GO2RTC_WS_URL=wss://yourdomain.com/go2rtc npm run build:prod`.

**Server (`server/.env`):**

- `PORT=3001` — must match Nginx `proxy_pass`.
- `NODE_ENV=production` — set when running (e.g. in PM2).
- `GEMINI_API_KEY` — if you use AI features.
- Optional: SMTP, SMS (iProgSMS), camera URLs, etc. (see `server/.env.example`).

## Updating after code changes

```bash
cd /opt/LedgerMonitor
git pull
npm install
npm run build:prod
cd server
npm install
pm2 restart ledger-monitor
```

## Optional: go2rtc (live camera streams)

If you use go2rtc for RTSP camera streams, run it on the same server (or another) and either:

- Proxy its WebSocket under your domain (e.g. `/go2rtc` → go2rtc), then set `VITE_GO2RTC_WS_URL=wss://yourdomain.com/go2rtc` and rebuild the frontend, or  
- Expose go2rtc on a separate port and set `VITE_GO2RTC_WS_URL=wss://yourdomain.com:1984` (and open that port / firewall) when building.

## Troubleshooting

- **502 Bad Gateway** — App not running or wrong port. Check: `pm2 status`, `pm2 logs ledger-monitor`, and that `PORT` in `server/.env` matches Nginx.
- **Blank page** — Ensure you ran `npm run build:prod` (not just `npm run build`) so the frontend uses `/api` on your domain.
- **API errors** — Check `server/.env`, `pm2 logs`, and that Nginx forwards `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto` (as in the config above).
