# 🚀 PulseCore — Real-time Server Task Manager & Resource Telemetry Dashboard

> **Ultra-Lightweight, Production-Grade Server Resource Dashboard** built specifically for low-resource VPS (1 vCore, 2 GB RAM). Monitors CPU, RAM, Swap, Disks, and active processes in real time with zero unnecessary CPU overhead.

---

## 🌟 Key Highlights & Features

1. **Task Manager Level Inspection**:
   - **5-Minute Telemetry History**: Rolling real-time line charts for CPU %, RAM %, and Swap % using a zero-overhead $O(1)$ Circular Ring Buffer.
   - **CPU Usage Breakdown**: Real-time total CPU load, user space %, system kernel %, core count, and base frequency.
   - **Memory (RAM) Telemetry**: Used, Free, Active, and Buffers/Cached breakdown with visual progress bar and health status indicators.
   - **Swap Usage**: Allocated virtual memory, swap used, swap free, and percentage gauge.
   - **Primary Storage & Partitions**: Detection of primary storage root mount (`/` on Linux, `C:` on Windows) showing total size, available free space, used space, and filesystem type.
   - **Running Services & Process Manager**: Lists all running processes with PID, Process Name, User, Status, % CPU, % RAM, Physical RSS RAM (MB), and Virtual/Swap memory (MB). Includes **instant search** and **multi-column sorting** (by CPU, RAM, RSS, VSZ, PID).
   - **Network Throughput**: Real-time download (RX) and upload (TX) speed calculations in KB/s and MB/s.
   - **System Load Averages**: Linux 1-min, 5-min, and 15-min load averages with core threshold target indicators.

2. **World-Class Lightweight Architecture for 1 vCore / 2GB RAM**:
   - **Adaptive Polling (Eco-Sleep Mode)**: When no dashboard tabs are open in a browser, polling automatically pauses or throttles, ensuring **0.0% CPU overhead** on your VPS while idle!
   - **O(1) Fixed Circular Ring Buffer**: Pre-allocated memory for 5 minutes of telemetry. No `array.shift()` memory churn or garbage collection pauses.
   - **Staggered Metric Collection**: Fast metrics (CPU, RAM) poll every 2s, process tables poll every 4s, and static storage polls every 30s.
   - **Payload Truncation**: Only top 25 resource-consuming processes are broadcast over WebSockets, keeping data packets under 5 KB.

3. **Security & Authentication**:
   - **Top-Level Variable Configuration**: You can change your admin login credentials directly at the top of [`config.js`](file:///config.js) or via environment variables in [`.env`](file:///server-res/.env).
   - **JWT Authentication & Authorization**: Session tokens are cryptographically signed with a **90-day expiration time** (`90d`).
   - **WebSocket Handshake Guard**: Socket.io verifies the JWT token before allowing real-time telemetry streaming.

---

## 🔐 Login Credentials

The login credentials can be found and customized in [`config.js`](file:///config.js):

| Parameter | Default Value | Description |
|---|---|---|
| **Email** | `admin@server.local` | Admin login email |
| **Password** | `Admin#2026@SecurePass!` | Admin login password |
| **Session Validity** | `90d` | JWT Token valid for 90 days |

---

## 🛠️ Quick Start (Running Locally)

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm start
```
The server will start at:
👉 **`http://localhost:4000`**

---

## 🐧 VPS Deployment (Ubuntu / Debian Linux)

To run PulseCore 24/7 on your 1 vCore, 2 GB RAM VPS:

### Option A: Using PM2 (Recommended)
```bash
# 1. Install PM2 globally
sudo npm install -g pm2

# 2. Navigate to project directory
cd /path/to/server-res

# 3. Start PulseCore with PM2
pm2 start server.js --name "pulsecore"

# 4. Save and configure auto-start on VPS boot
pm2 save
pm2 startup
```

### Option B: Using Systemd Service
Create a service file:
```bash
sudo nano /etc/systemd/system/pulsecore.service
```

Paste the following configuration:
```ini
[Unit]
Description=PulseCore Server Resource Monitor
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/var/www/server-res
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=PORT=4000
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable pulsecore
sudo systemctl start pulsecore
```

---

## ⚙️ Configuration (`config.js`)

```javascript
const CONFIG = {
  AUTH: {
    email: process.env.ADMIN_EMAIL || "admin@server.local",
    password: process.env.ADMIN_PASSWORD || "Admin#2026@SecurePass!",
    jwtSecret: process.env.JWT_SECRET || "vps-ultra-secure-jwt-secret-key-3289472398472394",
    jwtExpiresIn: "90d",
  },
  SERVER: {
    port: parseInt(process.env.PORT, 10) || 4000,
    host: process.env.HOST || "0.0.0.0",
  },
  MONITORING: {
    historyMinutes: 5,        // Last 5 minutes history
    fastPollIntervalMs: 2000, // Dynamic metrics (CPU, RAM, Swap)
    slowPollIntervalMs: 30000,// Storage & disks every 30s
    processPollIntervalMs: 4000, // Top processes every 4s
    maxProcesses: 25,         // Payload limit
  }
};
```

---

## 📁 Project Structure

```
├── config.js         # Top-level credentials and performance settings
├── ringBuffer.js     # O(1) in-memory circular buffer for 5-min history
├── monitor.js        # High-efficiency system resource collector
├── server.js         # Express, JWT authentication & Socket.io pipeline
├── package.json      # Dependencies and scripts
├── .env.example      # Environment variables template
└── public/
    ├── index.html    # Clean responsive layout & login modal
    ├── style.css     # Modern DevOps cockpit glassmorphic dark theme
    └── app.js        # Socket.io client, Chart.js timeline & process filtering
```
