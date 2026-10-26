const fs = require('fs');
const os = require('os');
const si = require('systeminformation');
const CircularRingBuffer = require('./ringBuffer');

class SystemMonitor {
  constructor(config, onMetricTick, onProcessTick, onDiskTick) {
    this.config = config;
    this.onMetricTick = onMetricTick;     // Callback when fast metrics are ready
    this.onProcessTick = onProcessTick;   // Callback when processes are refreshed
    this.onDiskTick = onDiskTick;         // Callback when disks are refreshed

    // 5-minute rolling window history buffer
    const pointsCount = Math.max(
      30,
      Math.ceil((config.MONITORING.historyMinutes * 60 * 1000) / config.MONITORING.fastPollIntervalMs)
    );
    this.historyBuffer = new CircularRingBuffer(pointsCount);

    // Cached static server specifications
    this.staticSpecs = null;

    // Latest state
    this.latestMetrics = null;
    this.latestDisks = [];
    this.latestProcesses = [];
    this.processStats = { total: 0, running: 0, sleeping: 0 };

    // Network delta calculation
    this.lastNetStats = null;
    this.lastNetTime = 0;

    // Polling intervals & Active client tracking
    this.activeClients = 0;
    this.fastTimer = null;
    this.slowTimer = null;
    this.processTimer = null;
    this.isRunning = false;
  }

  /**
   * Initializes static hardware specs and baseline metrics
   */
  async init() {
    try {
      const [osInfo, cpuInfo, memInfo, fsList] = await Promise.all([
        si.osInfo(),
        si.cpu(),
        si.mem(),
        si.fsSize()
      ]);

      this.staticSpecs = {
        hostname: os.hostname(),
        platform: osInfo.platform,
        distro: osInfo.distro,
        release: osInfo.release,
        kernel: osInfo.kernel,
        arch: osInfo.arch,
        cpu: {
          brand: cpuInfo.brand || `${os.cpus()[0]?.model || 'Generic CPU'}`,
          manufacturer: cpuInfo.manufacturer,
          speed: cpuInfo.speed ? `${cpuInfo.speed} GHz` : 'N/A',
          cores: cpuInfo.cores || os.cpus().length,
          physicalCores: cpuInfo.physicalCores || os.cpus().length
        },
        memoryTotalBytes: memInfo.total,
        swapTotalBytes: memInfo.swaptotal,
        serverBootTime: new Date(Date.now() - (os.uptime() * 1000)).toISOString()
      };

      this.processDisks(fsList);

      // Perform an initial sampling to prime the buffer
      await this.pollDynamicMetrics();
      await this.pollProcesses();
      console.log('⚡ [Monitor] Static specs initialized successfully.');
    } catch (err) {
      console.error('❌ [Monitor] Error initializing specs:', err.message);
    }
  }

  /**
   * Called when an authenticated socket client connects
   */
  clientConnected() {
    this.activeClients++;
    if (this.activeClients === 1 && !this.isRunning) {
      this.startPolling();
    }
  }

  /**
   * Called when an authenticated socket client disconnects
   */
  clientDisconnected() {
    this.activeClients = Math.max(0, this.activeClients - 1);
    if (this.activeClients === 0) {
      // Zero clients connected: Pause continuous polling to save VPS CPU!
      this.stopPolling();
    }
  }

  /**
   * Starts periodic polling cycles
   */
  startPolling() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('🟢 [Monitor] Active clients connected. Starting dynamic resource monitor.');

    // Fast polling: CPU, RAM, Swap, Network delta
    this.fastTimer = setInterval(() => {
      this.pollDynamicMetrics().catch(err => {
        console.error('❌ [Monitor] Fast poll error:', err.message);
      });
    }, this.config.MONITORING.fastPollIntervalMs);

    // Process polling: Top processes
    this.processTimer = setInterval(() => {
      this.pollProcesses().catch(err => {
        console.error('❌ [Monitor] Process poll error:', err.message);
      });
    }, this.config.MONITORING.processPollIntervalMs);

    // Slow polling: Storage & Disks
    this.slowTimer = setInterval(() => {
      this.pollDisks().catch(err => {
        console.error('❌ [Monitor] Disk poll error:', err.message);
      });
    }, this.config.MONITORING.slowPollIntervalMs);

    // Run first tick immediately
    this.pollDynamicMetrics();
  }

  /**
   * Stops periodic polling (VPS Eco Mode)
   */
  stopPolling() {
    if (!this.isRunning) return;
    this.isRunning = false;
    console.log('🌙 [Monitor] Zero clients connected. Entering VPS Eco-Sleep (0% CPU overhead).');

    if (this.fastTimer) clearInterval(this.fastTimer);
    if (this.processTimer) clearInterval(this.processTimer);
    if (this.slowTimer) clearInterval(this.slowTimer);
    this.fastTimer = null;
    this.processTimer = null;
    this.slowTimer = null;
  }

  /**
   * Ultra-lightweight dynamic metrics poll: CPU, RAM, Swap, Net
   */
  async pollDynamicMetrics() {
    try {
      const now = Date.now();
      const [currentLoad, memInfo, netStats] = await Promise.all([
        si.currentLoad().catch(err => {
          return { currentLoad: 0, currentLoadUser: 0, currentLoadSystem: 0 };
        }),
        si.mem().catch(err => {
          const total = os.totalmem() || 1;
          const free = os.freemem() || 0;
          return { total, free, used: total - free, swaptotal: 0, swapused: 0, swapfree: 0 };
        }),
        si.networkStats().catch(err => {
          return [];
        })
      ]);

      // Calculate network speeds (bytes/sec)
      let rxSec = 0;
      let txSec = 0;

      if (Array.isArray(netStats) && netStats.length > 0) {
        let totalRxBytes = 0;
        let totalTxBytes = 0;
        for (const iface of netStats) {
          totalRxBytes += (iface.rx_bytes || 0);
          totalTxBytes += (iface.tx_bytes || 0);
        }

        if (this.lastNetStats && this.lastNetTime > 0) {
          const deltaSec = (now - this.lastNetTime) / 1000;
          if (deltaSec > 0.3) {
            rxSec = Math.max(0, Math.round((totalRxBytes - this.lastNetStats.rx) / deltaSec));
            txSec = Math.max(0, Math.round((totalTxBytes - this.lastNetStats.tx) / deltaSec));
          }
        }

        this.lastNetStats = { rx: totalRxBytes, tx: totalTxBytes };
        this.lastNetTime = now;
      }

      // Memory breakdown
      const memTotal = memInfo.total || 1;
      const memUsed = memInfo.used || (memTotal - memInfo.free);
      const memFree = memInfo.free || (memTotal - memUsed);
      const memPercent = Math.min(100, Math.round((memUsed / memTotal) * 1000) / 10);

      // Swap breakdown
      const swapTotal = memInfo.swaptotal || 0;
      const swapUsed = memInfo.swapused || 0;
      const swapFree = memInfo.swapfree || (swapTotal - swapUsed);
      const swapPercent = swapTotal > 0 ? Math.min(100, Math.round((swapUsed / swapTotal) * 1000) / 10) : 0;

      // Load average (Linux standard: 1m, 5m, 15m)
      const loadAvg = os.loadavg();

      const point = {
        timestamp: now,
        cpu: {
          total: Math.round(currentLoad.currentLoad * 10) / 10,
          user: Math.round(currentLoad.currentLoadUser * 10) / 10,
          system: Math.round(currentLoad.currentLoadSystem * 10) / 10,
        },
        memory: {
          total: memTotal,
          used: memUsed,
          free: memFree,
          active: memInfo.active || memUsed,
          buffcache: memInfo.buffcache || memInfo.buffers || 0,
          percent: memPercent
        },
        swap: {
          total: swapTotal,
          used: swapUsed,
          free: swapFree,
          percent: swapPercent
        },
        uptime: os.uptime(),
        loadAverage: [
          Math.round(loadAvg[0] * 100) / 100,
          Math.round(loadAvg[1] * 100) / 100,
          Math.round(loadAvg[2] * 100) / 100
        ],
        network: {
          rxSec, // bytes per second download
          txSec  // bytes per second upload
        }
      };

      this.latestMetrics = point;
      this.historyBuffer.push(point);

      if (typeof this.onMetricTick === 'function') {
        this.onMetricTick(point);
      }
    } catch (err) {
      console.error('❌ [Monitor] Dynamic poll exception:', err.message);
    }
  }

  /**
   * Processes list polling (lightweight top N filtering)
   */
  async pollProcesses() {
    try {
      const procData = await si.processes();
      const rawList = procData.list || [];

      this.processStats = {
        total: procData.all || rawList.length,
        running: procData.running || 0,
        sleeping: procData.sleeping || 0,
        blocked: procData.blocked || 0
      };

      // Filter and pick the top N resource-hungry processes to prevent heavy client-server payloads
      const maxToKeep = this.config.MONITORING.maxProcesses || 25;

      // Sort by CPU first, then memory
      const sorted = rawList
        .filter(p => p.name && p.name !== 'System Idle Process')
        .sort((a, b) => (b.cpu - a.cpu) || (b.mem - a.mem))
        .slice(0, maxToKeep)
        .map(p => ({
          pid: p.pid,
          name: p.name,
          user: p.user || 'system',
          cpu: Math.round((p.cpu || 0) * 10) / 10,
          mem: Math.round((p.mem || 0) * 10) / 10,
          memRss: p.memRss ? p.memRss * 1024 : 0, // bytes
          memVsz: p.memVsz ? p.memVsz * 1024 : 0, // bytes
          state: p.state || 'running',
          command: p.command ? p.command.substring(0, 100) : p.name
        }));

      this.latestProcesses = sorted;

      if (typeof this.onProcessTick === 'function') {
        this.onProcessTick({
          stats: this.processStats,
          list: sorted
        });
      }
    } catch (err) {
      console.error('❌ [Monitor] Processes poll exception:', err.message);
    }
  }

  /**
   * Storage and Disks polling
   */
  async pollDisks() {
    try {
      const fsList = await si.fsSize();
      this.processDisks(fsList);

      if (typeof this.onDiskTick === 'function') {
        this.onDiskTick(this.latestDisks);
      }
    } catch (err) {
      console.error('❌ [Monitor] Disks poll exception:', err.message);
    }
  }

  /**
   * Helper to format and classify disk partitions (with zero-fail native statfs fallback)
   */
  processDisks(fsList) {
    let disks = [];
    if (Array.isArray(fsList) && fsList.length > 0) {
      let primary = fsList.find(d => d.mount === '/' || d.mount.toLowerCase() === 'c:' || d.mount === 'C:\\');
      if (!primary && fsList.length > 0) primary = fsList[0];

      disks = fsList.map(d => ({
        fs: d.fs,
        mount: d.mount,
        type: d.type || 'ext4',
        size: d.size,
        used: d.used,
        available: d.available,
        usePercent: Math.round((d.use || 0) * 10) / 10,
        isPrimary: primary ? (d.mount === primary.mount) : false
      }));
    }

    // High-reliability fallback if si.fsSize() returned empty (e.g. Windows wmic permission issue)
    if (disks.length === 0) {
      const rootPath = os.platform() === 'win32' ? (process.env.SystemDrive || 'C:') : '/';
      try {
        const stats = fs.statfsSync(rootPath);
        const size = stats.blocks * stats.bsize;
        const available = stats.bavail * stats.bsize;
        const used = size - available;
        const usePercent = size > 0 ? Math.round((used / size) * 1000) / 10 : 0;
        disks.push({
          fs: rootPath,
          mount: rootPath,
          type: os.platform() === 'win32' ? 'NTFS' : 'ext4',
          size,
          used,
          available,
          usePercent,
          isPrimary: true
        });
      } catch (err) {
        console.warn('⚠️ [Monitor] statfs fallback error:', err.message);
      }
    }

    this.latestDisks = disks;
  }

  /**
   * Returns complete initial package for newly connected dashboard clients
   */
  getInitialState() {
    return {
      specs: this.staticSpecs,
      metrics: this.latestMetrics,
      history: this.historyBuffer.toArray(),
      disks: this.latestDisks,
      processes: {
        stats: this.processStats,
        list: this.latestProcesses
      }
    };
  }
}

module.exports = SystemMonitor;
