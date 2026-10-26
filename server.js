const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const CONFIG = require('./config');
const SystemMonitor = require('./monitor');

const app = express();
const server = http.createServer(app);

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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
// REST API ROUTES
// -----------------------------------------------------------------------------

// Login Endpoint
app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const validEmail = (CONFIG.AUTH.email || '').trim().toLowerCase();
  const inputEmail = email.trim().toLowerCase();

  if (inputEmail !== validEmail || password !== CONFIG.AUTH.password) {
    return res.status(401).json({ error: 'Invalid email or password credentials' });
  }

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

  // Client requests manual process refresh or disk refresh
  socket.on('request:refresh', async () => {
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
    console.log(`🔐 Login Password: ${CONFIG.AUTH.password}`);
    console.log(`⏳ Session Expiry: ${CONFIG.AUTH.jwtExpiresIn}`);
    console.log(`🌿 Lightweight VPS Mode: Active (Eco-sleep when 0 clients connected)`);
    console.log(`================================================================`);
  });
}

bootstrap().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
