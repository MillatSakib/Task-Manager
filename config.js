// ==============================================================================
// SERVER CONFIGURATION & AUTHENTICATION SETTINGS
// You can edit your login email and password right here in this variable!
// ==============================================================================
require('dotenv').config();

const CONFIG = {
  // 🔐 ADMIN LOGIN CREDENTIALS
  // Change these to your preferred email and password:
  AUTH: {
    email: process.env.ADMIN_EMAIL || "admin@server.local",
    password: process.env.ADMIN_PASSWORD || "Admin#2026@SecurePass!",
    jwtSecret: process.env.JWT_SECRET || "vps-ultra-secure-jwt-secret-key-3289472398472394",
    jwtExpiresIn: "90d", // 90 days expiration as requested
  },

  // ⚙️ SERVER SETTINGS
  SERVER: {
    port: parseInt(process.env.PORT, 10) || 4000,
    host: process.env.HOST || "0.0.0.0",
  },

  // 🚀 LIGHTWEIGHT PERFORMANCE TUNING (Optimized for 1 vCore, 2GB RAM VPS)
  MONITORING: {
    historyMinutes: 15,       // Keep last 15 minutes of metrics
    fastPollIntervalMs: 2000, // Dynamic metrics (CPU, RAM, Swap) every 2 seconds
    slowPollIntervalMs: 30000,// Storage & disks every 30 seconds (saves CPU)
    processPollIntervalMs: 10000, // Top processes list every 10s (eliminates artificial CPU spikes on 1 vCore VPS)
    maxProcesses: 25,         // Track top 25 processes to prevent CPU/RAM overhead
    idleTimeoutMs: 15000,     // Sleep/throttle metric gathering when 0 clients connected
  }
};

module.exports = CONFIG;
