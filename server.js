const http = require('http');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const CONFIG = require('./config');
const SystemMonitor = require('./monitor');

const app = express();
const server = http.createServer(app);

// Disable Express fingerprinting
app.disable('x-powered-by');

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Initialize Socket.io with optimized transport settings
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  pingInterval: 10000,
  pingTimeout: 5000
});

// JSON and URL-encoded body parser
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// Serve frontend static files
app.use(express.static(path.join(__dirname, 'public')));

// -----------------------------------------------------------------------------
// JWT AUTHENTICATION MIDDLEWARE FOR REST ENDPOINTS
// -----------------------------------------------------------------------------
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access denied: Token required' });
  }

  jwt.verify(token, CONFIG.AUTH.jwtSecret, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Access denied: Invalid or expired session' });
    }
    req.user = user;
    next();
  });
}

// -----------------------------------------------------------------------------
// RATE LIMITING & SECURITY HELPERS
// -----------------------------------------------------------------------------
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes lockout window
const MAX_FAILED_ATTEMPTS = 5;

// Periodically purge expired rate limit entries to avoid memory leak
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of loginAttempts.entries()) {
    if (now - record.firstAttempt > RATE_LIMIT_WINDOW_MS && now > record.lockedUntil) {
      loginAttempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeMatch(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest();
  const hashB = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

// -----------------------------------------------------------------------------
// REST API ROUTES
// -----------------------------------------------------------------------------

// Login Endpoint with Rate Limiting & Timing-Safe Verification
app.post('/api/login', (req, res) => {
  const clientIp = (req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim();
  const now = Date.now();

  let ipRecord = loginAttempts.get(clientIp);
  if (!ipRecord) {
    ipRecord = { failedCount: 0, firstAttempt: now, lockedUntil: 0 };
    loginAttempts.set(clientIp, ipRecord);
  }

  // Check if IP is currently locked out
  if (now < ipRecord.lockedUntil) {
    const remainingMinutes = Math.ceil((ipRecord.lockedUntil - now) / 60000);
    return res.status(429).json({
      error: `Too many failed login attempts. IP temporarily blocked. Try again in ${remainingMinutes} minute(s).`
    });
  }

  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const validEmail = (CONFIG.AUTH.email || '').trim().toLowerCase();
  const inputEmail = email.trim().toLowerCase();

  const isEmailMatch = timingSafeMatch(inputEmail, validEmail);
  const isPassMatch = timingSafeMatch(password, CONFIG.AUTH.password);

  if (!isEmailMatch || !isPassMatch) {
    ipRecord.failedCount++;
    if (ipRecord.failedCount >= MAX_FAILED_ATTEMPTS) {
      ipRecord.lockedUntil = now + RATE_LIMIT_WINDOW_MS;
      return res.status(429).json({
        error: 'Too many failed login attempts. Your IP has been temporarily locked for 15 minutes.'
      });
    }

    const remaining = MAX_FAILED_ATTEMPTS - ipRecord.failedCount;
    return res.status(401).json({
      error: `Invalid email or password credentials (${remaining} attempt${remaining === 1 ? '' : 's'} remaining)`
    });
  }

  // Successful authentication: Reset failed attempts for this IP
  loginAttempts.delete(clientIp);

  // Generate 90-day JWT token
  const token = jwt.sign(
    { email: validEmail, role: 'admin' },
    CONFIG.AUTH.jwtSecret,
    { expiresIn: CONFIG.AUTH.jwtExpiresIn }
  );

  return res.json({
    success: true,
    token,
    expiresIn: CONFIG.AUTH.jwtExpiresIn,
    user: {
      email: validEmail,
      role: 'admin'
    }
  });
});

// Verify Token Endpoint
app.get('/api/verify', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

// System Health API (Protected)
app.get('/api/snapshot', authenticateToken, (req, res) => {
  res.json(monitor.getInitialState());
});

// -----------------------------------------------------------------------------
// SYSTEM MONITOR & REAL-TIME WEBSOCKET PIPELINE
// -----------------------------------------------------------------------------

const monitor = new SystemMonitor(
  CONFIG,
  // Fast metric tick handler
  (metricPoint) => {
    io.emit('metric:tick', metricPoint);
  },
  // Process tick handler
  (processData) => {
    io.emit('process:tick', processData);
  },
  // Disk tick handler
  (diskData) => {
    io.emit('disk:tick', diskData);
  }
);

// Socket.io JWT Authentication Barrier
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;

  if (!token) {
    return next(new Error('Unauthorized: Authentication token is missing'));
  }

  jwt.verify(token, CONFIG.AUTH.jwtSecret, (err, decoded) => {
    if (err) {
      return next(new Error('Unauthorized: Invalid or expired token'));
    }
    socket.user = decoded;
    next();
  });
});

// Socket.io Connection Logic
io.on('connection', (socket) => {
  console.log(`🔌 [Socket] Authenticated client connected (${socket.user.email}) - Socket ID: ${socket.id}`);
  monitor.clientConnected();

  // Send initial hydration data immediately so UI charts render in full
  socket.emit('init:state', monitor.getInitialState());

  // Client requests manual process refresh or disk refresh (with 5-second anti-DoS throttle)
  socket.lastManualRefresh = 0;
  socket.on('request:refresh', async () => {
    const now = Date.now();
    if (now - socket.lastManualRefresh < 5000) {
      return; // Ignore spam requests
    }
    socket.lastManualRefresh = now;

    await monitor.pollDynamicMetrics();
    await monitor.pollProcesses();
    await monitor.pollDisks();
    socket.emit('init:state', monitor.getInitialState());
  });

  socket.on('disconnect', (reason) => {
    console.log(`🔌 [Socket] Client disconnected (${socket.id}) - Reason: ${reason}`);
    monitor.clientDisconnected();
  });
});

// Fallback to index.html for SPA routing (Express 5 compatible)
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// -----------------------------------------------------------------------------
// START SERVER
// -----------------------------------------------------------------------------
async function bootstrap() {
  await monitor.init();

  const { port, host } = CONFIG.SERVER;
  server.listen(port, host, () => {
    console.log(`================================================================`);
    console.log(`🚀 [VPS Monitor] Server running at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    console.log(`🔑 Login Email:    ${CONFIG.AUTH.email}`);
    console.log(`🔐 Login Password: [PROTECTED - Configured in .env]`);
    console.log(`⏳ Session Expiry: ${CONFIG.AUTH.jwtExpiresIn}`);
    console.log(`🌿 Lightweight VPS Mode: Active (Eco-sleep when 0 clients connected)`);

    if (CONFIG.AUTH.jwtSecret.includes('vps-ultra-secure-jwt-secret-key')) {
      console.warn(`⚠️  [SECURITY NOTICE] Using default JWT secret! Change JWT_SECRET in .env for production.`);
    }
    if (CONFIG.AUTH.password === 'Admin#2026@SecurePass!') {
      console.warn(`⚠️  [SECURITY NOTICE] Using default admin password! Change ADMIN_PASSWORD in .env for production.`);
    }
    console.log(`================================================================`);
  });
}

bootstrap().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
