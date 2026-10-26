/**
 * PULSECORE SERVER RESOURCE & TASK MANAGER — CLIENT LOGIC
 * Real-time WebSocket streaming with JWT Auth & Chart.js rendering
 */

(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // STATE & REFS
  // ---------------------------------------------------------------------------
  let socket = null;
  let chartInstance = null;
  let isStreamPaused = false;
  let currentProcessList = [];
  let serverBootTimestamp = null;
  let clientUptimeTimer = null;
  let staticSpecsCache = null;

  // DOM Elements - Auth
  const loginOverlay = document.getElementById('login-container');
  const loginForm = document.getElementById('login-form');
  const loginEmailInput = document.getElementById('login-email');
  const loginPassInput = document.getElementById('login-password');
  const loginBtn = document.getElementById('login-btn');
  const loginError = document.getElementById('login-error');
  const togglePassBtn = document.getElementById('toggle-password');

  // DOM Elements - Dashboard
  const dashboard = document.getElementById('dashboard-container');
  const connIndicator = document.getElementById('conn-indicator');
  const connText = document.getElementById('conn-text');
  const btnLogout = document.getElementById('btn-logout');
  const btnPause = document.getElementById('btn-pause-stream');
  const iconPause = document.getElementById('icon-pause');
  const iconPlay = document.getElementById('icon-play');
  const pauseText = document.getElementById('pause-text');
  const btnRefresh = document.getElementById('btn-manual-refresh');
  const userInitial = document.getElementById('user-initial');
  const userEmailDisplay = document.getElementById('user-email-display');

  // Server Header Info
  const valHostname = document.getElementById('val-hostname');
  const valOs = document.getElementById('val-os');
  const valUptime = document.getElementById('val-uptime');

  // CPU Elements
  const valCpuTotal = document.getElementById('val-cpu-total');
  const valCpuBrand = document.getElementById('val-cpu-brand');
  const valCpuUser = document.getElementById('val-cpu-user');
  const valCpuSys = document.getElementById('val-cpu-sys');
  const valCpuCores = document.getElementById('val-cpu-cores');
  const barCpu = document.getElementById('bar-cpu');
  const badgeCpuHealth = document.getElementById('badge-cpu-health');

  // RAM Elements
  const valRamPercent = document.getElementById('val-ram-percent');
  const valRamSub = document.getElementById('val-ram-sub');
  const valRamUsed = document.getElementById('val-ram-used');
  const valRamFree = document.getElementById('val-ram-free');
  const valRamCached = document.getElementById('val-ram-cached');
  const barRam = document.getElementById('bar-ram');
  const badgeRamHealth = document.getElementById('badge-ram-health');

  // Swap Elements
  const valSwapPercent = document.getElementById('val-swap-percent');
  const valSwapSub = document.getElementById('val-swap-sub');
  const valSwapUsed = document.getElementById('val-swap-used');
  const valSwapFree = document.getElementById('val-swap-free');
  const valSwapTotal = document.getElementById('val-swap-total');
  const barSwap = document.getElementById('bar-swap');
  const badgeSwapHealth = document.getElementById('badge-swap-health');

  // Primary Storage Elements
  const valDiskPercent = document.getElementById('val-disk-percent');
  const valDiskMount = document.getElementById('val-disk-mount');
  const valDiskTotal = document.getElementById('val-disk-total');
  const valDiskUsed = document.getElementById('val-disk-used');
  const valDiskFree = document.getElementById('val-disk-free');
  const barDisk = document.getElementById('bar-disk');
  const badgeDiskHealth = document.getElementById('badge-disk-health');

  // Secondary Telemetry
  const valNetRx = document.getElementById('val-net-rx');
  const valNetTx = document.getElementById('val-net-tx');
  const valLoad1 = document.getElementById('val-load-1');
  const valLoad5 = document.getElementById('val-load-5');
  const valLoad15 = document.getElementById('val-load-15');
  const valLoadCoresDesc = document.getElementById('val-load-cores-desc');

  // Disks & Partitions Container
  const disksContainer = document.getElementById('disks-container');

  // Process Elements
  const procTbody = document.getElementById('processes-tbody');
  const valProcTotal = document.getElementById('val-proc-total');
  const valProcRunning = document.getElementById('val-proc-running');
  const valProcSleeping = document.getElementById('val-proc-sleeping');
  const procSearchInput = document.getElementById('proc-search');
  const procSortSelect = document.getElementById('proc-sort-by');

  // Chart Toggle Buttons
  const chartToggles = document.getElementById('chart-toggles');

  // ---------------------------------------------------------------------------
  // AUTHENTICATION & SESSION HANDLING
  // ---------------------------------------------------------------------------
  const STORAGE_KEY = 'pulsecore_jwt_token';
  const USER_KEY = 'pulsecore_user';

  function getToken() {
    return localStorage.getItem(STORAGE_KEY);
  }

  function setSession(token, user) {
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
  }

  async function checkExistingAuth() {
    const token = getToken();
    if (!token) {
      showLogin();
      return;
    }

    try {
      const res = await fetch('/api/verify', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (res.ok) {
        const data = await res.json();
        const savedUser = JSON.parse(localStorage.getItem(USER_KEY) || '{}');
        showDashboard(savedUser.email || data.user.email);
        initSocket(token);
      } else {
        clearSession();
        showLogin();
      }
    } catch (err) {
      console.warn('Auth check network failure:', err);
      showLogin();
    }
  }

  function showLogin() {
    loginOverlay.classList.remove('hidden');
    dashboard.classList.add('hidden');
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  function showDashboard(email) {
    loginOverlay.classList.add('hidden');
    dashboard.classList.remove('hidden');
    const safeEmail = email || 'Admin';
    userEmailDisplay.textContent = safeEmail;
    userInitial.textContent = safeEmail.charAt(0).toUpperCase();
  }

  // Handle Login Form Submit
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.classList.add('hidden');
    loginBtn.disabled = true;
    loginBtn.querySelector('.btn-text').textContent = 'Authenticating...';
    loginBtn.querySelector('.btn-spinner').classList.remove('hidden');

    const email = loginEmailInput.value.trim();
    const password = loginPassInput.value;

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Login failed. Please verify credentials.');
      }

      setSession(data.token, data.user);
      showDashboard(data.user.email);
      initSocket(data.token);
    } catch (err) {
      loginError.textContent = err.message;
      loginError.classList.remove('hidden');
    } finally {
      loginBtn.disabled = false;
      loginBtn.querySelector('.btn-text').textContent = 'Connect to Server';
      loginBtn.querySelector('.btn-spinner').classList.add('hidden');
    }
  });

  // Toggle Password Visibility
  togglePassBtn.addEventListener('click', () => {
    const isPass = loginPassInput.type === 'password';
    loginPassInput.type = isPass ? 'text' : 'password';
  });

  // Logout
  btnLogout.addEventListener('click', () => {
    if (confirm('Are you sure you want to end your session?')) {
      clearSession();
      showLogin();
    }
  });

  // ---------------------------------------------------------------------------
  // WEBSOCKET (SOCKET.IO) CLIENT
  // ---------------------------------------------------------------------------
  function initSocket(token) {
    if (socket) {
      socket.disconnect();
    }

    socket = io({
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 15,
      reconnectionDelay: 2000
    });

    socket.on('connect', () => {
      connIndicator.className = 'status-dot connected';
      connText.textContent = 'Live Connected';
    });

    socket.on('disconnect', (reason) => {
      connIndicator.className = 'status-dot disconnected';
      connText.textContent = 'Disconnected';
      console.warn('Socket disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      connIndicator.className = 'status-dot disconnected';
      connText.textContent = 'Connection Error';
      if (err.message.includes('Unauthorized') || err.message.includes('token')) {
        clearSession();
        showLogin();
      }
    });

    // Complete Initial State Hydration
    socket.on('init:state', (state) => {
      if (!state) return;
      if (state.specs) renderStaticSpecs(state.specs);
      if (state.history && Array.isArray(state.history)) {
        initTimelineChart(state.history);
      }
      if (state.metrics) renderDynamicMetrics(state.metrics);
      if (state.disks) renderDisks(state.disks);
      if (state.processes) {
        renderProcessStats(state.processes.stats);
        currentProcessList = state.processes.list || [];
        renderProcessesTable();
      }
    });

    // Fast metric tick (every 2s)
    socket.on('metric:tick', (point) => {
      if (isStreamPaused) return;
      renderDynamicMetrics(point);
      appendChartPoint(point);
    });

    // Process list tick
    socket.on('process:tick', (data) => {
      if (isStreamPaused) return;
      if (data.stats) renderProcessStats(data.stats);
      if (data.list) {
        currentProcessList = data.list;
        renderProcessesTable();
      }
    });

    // Disks tick
    socket.on('disk:tick', (disks) => {
      if (isStreamPaused) return;
      renderDisks(disks);
    });
  }

  // ---------------------------------------------------------------------------
  // RENDER STATIC SERVER SPECS
  // ---------------------------------------------------------------------------
  function renderStaticSpecs(specs) {
    staticSpecsCache = specs;
    valHostname.textContent = specs.hostname || 'VPS Server';
    valOs.textContent = `${specs.distro || specs.platform} (${specs.arch})`;

    if (specs.cpu) {
      const coresCount = specs.cpu.cores || 1;
      valCpuBrand.textContent = `${specs.cpu.brand} • ${specs.cpu.speed}`;
      valCpuCores.textContent = `${coresCount} ${coresCount === 1 ? 'Core' : 'Cores'}`;
      valLoadCoresDesc.textContent = `Target ≤ ${coresCount}.0`;
    }

    if (specs.memoryTotalBytes) {
      valRamSub.textContent = `Total ${formatBytes(specs.memoryTotalBytes)}`;
    }

    if (specs.swapTotalBytes !== undefined) {
      valSwapTotal.textContent = formatBytes(specs.swapTotalBytes);
      valSwapSub.textContent = specs.swapTotalBytes > 0 
        ? `Total ${formatBytes(specs.swapTotalBytes)}` 
        : 'No Swap Configured';
    }

    if (specs.serverBootTime) {
      serverBootTimestamp = new Date(specs.serverBootTime).getTime();
      startUptimeTicker();
    }
  }

  // ---------------------------------------------------------------------------
  // RENDER DYNAMIC METRICS
  // ---------------------------------------------------------------------------
  function renderDynamicMetrics(m) {
    if (!m) return;

    // 1. CPU
    const cpuTotal = (m.cpu?.total || 0).toFixed(1);
    valCpuTotal.textContent = cpuTotal;
    barCpu.style.width = `${Math.min(100, m.cpu?.total || 0)}%`;
    valCpuUser.textContent = `${(m.cpu?.user || 0).toFixed(1)}%`;
    valCpuSys.textContent = `${(m.cpu?.system || 0).toFixed(1)}%`;

    if (m.cpu?.total >= 90) {
      badgeCpuHealth.className = 'health-badge badge-alert';
      badgeCpuHealth.textContent = 'Critical';
    } else if (m.cpu?.total >= 70) {
      badgeCpuHealth.className = 'health-badge badge-warn';
      badgeCpuHealth.textContent = 'High';
    } else {
      badgeCpuHealth.className = 'health-badge badge-normal';
      badgeCpuHealth.textContent = 'Normal';
    }

    // 2. RAM
    const ramPct = (m.memory?.percent || 0).toFixed(1);
    valRamPercent.textContent = ramPct;
    barRam.style.width = `${Math.min(100, m.memory?.percent || 0)}%`;
    valRamUsed.textContent = formatBytes(m.memory?.used || 0);
    valRamFree.textContent = formatBytes(m.memory?.free || 0);
    valRamCached.textContent = formatBytes(m.memory?.buffcache || 0);

    if (m.memory?.percent >= 85) {
      badgeRamHealth.className = 'health-badge badge-alert';
      badgeRamHealth.textContent = 'High Load';
    } else if (m.memory?.percent >= 70) {
      badgeRamHealth.className = 'health-badge badge-warn';
      badgeRamHealth.textContent = 'Moderate';
    } else {
      badgeRamHealth.className = 'health-badge badge-normal';
      badgeRamHealth.textContent = 'Healthy';
    }

    // 3. Swap
    const swapPct = (m.swap?.percent || 0).toFixed(1);
    valSwapPercent.textContent = swapPct;
    barSwap.style.width = `${Math.min(100, m.swap?.percent || 0)}%`;
    valSwapUsed.textContent = formatBytes(m.swap?.used || 0);
    valSwapFree.textContent = formatBytes(m.swap?.free || 0);
    if (m.swap?.total > 0) {
      valSwapTotal.textContent = formatBytes(m.swap?.total);
    }

    if (m.swap?.percent >= 60) {
      badgeSwapHealth.className = 'health-badge badge-warn';
      badgeSwapHealth.textContent = 'High Swap';
    } else {
      badgeSwapHealth.className = 'health-badge badge-normal';
      badgeSwapHealth.textContent = m.swap?.total > 0 ? 'Active' : 'Disabled';
    }

    // 4. Network
    valNetRx.textContent = `${formatBytes(m.network?.rxSec || 0)}/s`;
    valNetTx.textContent = `${formatBytes(m.network?.txSec || 0)}/s`;

    // 5. Load Averages
    if (Array.isArray(m.loadAverage)) {
      valLoad1.textContent = m.loadAverage[0] !== undefined ? m.loadAverage[0].toFixed(2) : '0.00';
      valLoad5.textContent = m.loadAverage[1] !== undefined ? m.loadAverage[1].toFixed(2) : '0.00';
      valLoad15.textContent = m.loadAverage[2] !== undefined ? m.loadAverage[2].toFixed(2) : '0.00';
    }

    // 6. Uptime
    if (m.uptime) {
      valUptime.textContent = formatUptime(m.uptime);
    }
  }

  // ---------------------------------------------------------------------------
  // RENDER STORAGE & DISKS
  // ---------------------------------------------------------------------------
  function renderDisks(disks) {
    if (!Array.isArray(disks) || disks.length === 0) return;

    // Find primary disk
    const primary = disks.find(d => d.isPrimary) || disks[0];

    if (primary) {
      valDiskPercent.textContent = (primary.usePercent || 0).toFixed(1);
      barDisk.style.width = `${Math.min(100, primary.usePercent || 0)}%`;
      valDiskMount.textContent = `Mount ${primary.mount} (${primary.type || 'Storage'})`;
      valDiskTotal.textContent = formatBytes(primary.size);
      valDiskUsed.textContent = formatBytes(primary.used);
      valDiskFree.textContent = formatBytes(primary.available);

      if (primary.usePercent >= 90) {
        badgeDiskHealth.className = 'health-badge badge-alert';
        badgeDiskHealth.textContent = 'Almost Full';
      } else if (primary.usePercent >= 75) {
        badgeDiskHealth.className = 'health-badge badge-warn';
        badgeDiskHealth.textContent = 'Warning';
      } else {
        badgeDiskHealth.className = 'health-badge badge-normal';
        badgeDiskHealth.textContent = 'Optimal';
      }
    }

    // Render partition cards in grid - matching the top metric cards aesthetic
    disksContainer.innerHTML = disks.map(d => {
      const isPrim = d.isPrimary;
      const pct = (d.usePercent || 0).toFixed(1);

      let badgeClass = 'badge-normal';
      let badgeText = 'Optimal';
      if (d.usePercent >= 90) {
        badgeClass = 'badge-alert';
        badgeText = 'Almost Full';
      } else if (d.usePercent >= 75) {
        badgeClass = 'badge-warn';
        badgeText = 'Warning';
      }

      let partitionTitle = isPrim ? 'Primary Storage' : (d.mount === '/home' ? 'Home Partition' : (d.mount.startsWith('/boot') ? 'Boot Partition' : 'Storage Partition'));
      let subtitle = `Mount ${escapeHtml(d.mount)} (${escapeHtml(d.type || 'ext4')})`;

      return `
        <div class="metric-card card-storage disk-partition-card-rich">
          <div class="card-header">
            <div class="card-title-group">
              <div class="metric-icon storage-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
                  <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
                  <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
                </svg>
              </div>
              <div>
                <h3 class="card-title">${partitionTitle}</h3>
                <span class="card-subtitle" title="${escapeHtml(d.mount)}">${subtitle}</span>
              </div>
            </div>
            <div style="display: flex; align-items: center; gap: 0.4rem;">
              ${isPrim ? '<span class="disk-mount-badge">Primary Root</span>' : ''}
              <span class="health-badge ${badgeClass}">${badgeText}</span>
            </div>
          </div>

          <div class="metric-big-value">
            <span class="big-number">${pct}</span>
            <span class="unit">%</span>
          </div>

          <div class="progress-bar-container">
            <div class="progress-bar-fill fill-storage" style="width: ${Math.min(100, d.usePercent || 0)}%;"></div>
          </div>

          <div class="card-details-row">
            <div class="detail-item">
              <span class="detail-label">Total</span>
              <span class="detail-val font-mono">${formatBytes(d.size)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Used</span>
              <span class="detail-val font-mono">${formatBytes(d.used)}</span>
            </div>
            <div class="detail-item">
              <span class="detail-label">Available Free</span>
              <span class="detail-val font-mono">${formatBytes(d.available)}</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ---------------------------------------------------------------------------
  // RENDER PROCESSES TABLE & FILTERING
  // ---------------------------------------------------------------------------
  function renderProcessStats(stats) {
    if (!stats) return;
    valProcTotal.textContent = stats.total || 0;
    valProcRunning.textContent = stats.running || 0;
    valProcSleeping.textContent = stats.sleeping || 0;
  }

  function renderProcessesTable() {
    if (!currentProcessList || currentProcessList.length === 0) {
      procTbody.innerHTML = '<tr><td colspan="8" class="table-loading">No active processes detected.</td></tr>';
      return;
    }

    const searchQuery = (procSearchInput.value || '').trim().toLowerCase();
    const sortBy = procSortSelect.value || 'cpu';

    // 1. Filter
    let filtered = currentProcessList.filter(p => {
      if (!searchQuery) return true;
      return (
        (p.name && p.name.toLowerCase().includes(searchQuery)) ||
        (p.command && p.command.toLowerCase().includes(searchQuery)) ||
        (p.user && p.user.toLowerCase().includes(searchQuery)) ||
        String(p.pid).includes(searchQuery)
      );
    });

    // 2. Sort
    filtered.sort((a, b) => {
      if (sortBy === 'cpu') return (b.cpu || 0) - (a.cpu || 0);
      if (sortBy === 'mem') return (b.mem || 0) - (a.mem || 0);
      if (sortBy === 'memRss') return (b.memRss || 0) - (a.memRss || 0);
      if (sortBy === 'memVsz') return (b.memVsz || 0) - (a.memVsz || 0);
      if (sortBy === 'pid') return (a.pid || 0) - (b.pid || 0);
      if (sortBy === 'name') return (a.name || '').localeCompare(b.name || '');
      return 0;
    });

    if (filtered.length === 0) {
      procTbody.innerHTML = '<tr><td colspan="8" class="table-loading">No matching processes found for query.</td></tr>';
      return;
    }

    procTbody.innerHTML = filtered.map(p => {
      const cpu = (p.cpu || 0).toFixed(1);
      const mem = (p.mem || 0).toFixed(1);
      const stateClass = p.state === 'running' ? 'state-running' : (p.state === 'blocked' ? 'state-blocked' : 'state-sleeping');
      const stateLabel = p.state || 'running';

      return `
        <tr>
          <td>
            <div class="proc-name-cell">
              <span class="proc-name-title" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</span>
              <span class="proc-cmd-sub" title="${escapeHtml(p.command)}">${escapeHtml(p.command || '')}</span>
            </div>
          </td>
          <td class="col-pid">${p.pid}</td>
          <td>${escapeHtml(p.user || 'system')}</td>
          <td>
            <span class="state-pill ${stateClass}">${escapeHtml(stateLabel)}</span>
          </td>
          <td class="text-right">
            <div class="mini-bar-cell">
              <span>${cpu}%</span>
              <div class="mini-bar-track">
                <div class="mini-bar-fill-cpu" style="width: ${Math.min(100, cpu)}%;"></div>
              </div>
            </div>
          </td>
          <td class="text-right">
            <div class="mini-bar-cell">
              <span>${mem}%</span>
              <div class="mini-bar-track">
                <div class="mini-bar-fill-ram" style="width: ${Math.min(100, mem)}%;"></div>
              </div>
            </div>
          </td>
          <td class="text-right font-mono">${formatBytes(p.memRss || 0)}</td>
          <td class="text-right font-mono">${formatBytes(p.memVsz || 0)}</td>
        </tr>
      `;
    }).join('');
  }

  // Process Search & Sort event listeners
  procSearchInput.addEventListener('input', () => renderProcessesTable());
  procSortSelect.addEventListener('change', () => renderProcessesTable());

  // ---------------------------------------------------------------------------
  // 5-MINUTE CHART.JS TIMELINE
  // ---------------------------------------------------------------------------
  function initTimelineChart(historyPoints) {
    const canvas = document.getElementById('timelineChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = [];
    const cpuData = [];
    const ramData = [];
    const swapData = [];

    historyPoints.forEach(pt => {
      labels.push(formatTime(pt.timestamp));
      cpuData.push(pt.cpu?.total || 0);
      ramData.push(pt.memory?.percent || 0);
      swapData.push(pt.swap?.percent || 0);
    });

    if (chartInstance) {
      chartInstance.destroy();
    }

    // Create subtle gradient fills
    const cpuGradient = ctx.createLinearGradient(0, 0, 0, 260);
    cpuGradient.addColorStop(0, 'rgba(6, 182, 212, 0.35)');
    cpuGradient.addColorStop(1, 'rgba(6, 182, 212, 0.0)');

    const ramGradient = ctx.createLinearGradient(0, 0, 0, 260);
    ramGradient.addColorStop(0, 'rgba(168, 85, 247, 0.35)');
    ramGradient.addColorStop(1, 'rgba(168, 85, 247, 0.0)');

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'CPU Usage (%)',
            data: cpuData,
            borderColor: '#06b6d4',
            backgroundColor: cpuGradient,
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'RAM Usage (%)',
            data: ramData,
            borderColor: '#a855f7',
            backgroundColor: ramGradient,
            borderWidth: 2,
            tension: 0.35,
            fill: true,
            pointRadius: 0,
            pointHoverRadius: 4,
          },
          {
            label: 'Swap Usage (%)',
            data: swapData,
            borderColor: '#f59e0b',
            backgroundColor: 'transparent',
            borderWidth: 1.5,
            borderDash: [4, 4],
            tension: 0.35,
            fill: false,
            pointRadius: 0,
            pointHoverRadius: 4,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300
        },
        interaction: {
          intersect: false,
          mode: 'index',
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.04)',
              drawBorder: false,
            },
            ticks: {
              color: '#64748b',
              maxRotation: 0,
              autoSkip: true,
              maxTicksLimit: 8,
              font: {
                family: 'JetBrains Mono',
                size: 11
              }
            }
          },
          y: {
            min: 0,
            max: 100,
            grid: {
              color: 'rgba(255, 255, 255, 0.06)',
              drawBorder: false,
            },
            ticks: {
              color: '#64748b',
              callback: val => `${val}%`,
              stepSize: 25,
              font: {
                family: 'JetBrains Mono',
                size: 11
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false // Using custom top toggles
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#fff',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            titleFont: {
              family: 'Inter',
              size: 12,
              weight: 'bold'
            },
            bodyFont: {
              family: 'JetBrains Mono',
              size: 12
            },
            callbacks: {
              label: context => ` ${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`
            }
          }
        }
      }
    });
  }

  function appendChartPoint(pt) {
    if (!chartInstance) return;

    const maxPoints = 450; // 15 minutes at 2s interval
    const timeLabel = formatTime(pt.timestamp);

    chartInstance.data.labels.push(timeLabel);
    chartInstance.data.datasets[0].data.push(pt.cpu?.total || 0);
    chartInstance.data.datasets[1].data.push(pt.memory?.percent || 0);
    chartInstance.data.datasets[2].data.push(pt.swap?.percent || 0);

    if (chartInstance.data.labels.length > maxPoints) {
      chartInstance.data.labels.shift();
      chartInstance.data.datasets[0].data.shift();
      chartInstance.data.datasets[1].data.shift();
      chartInstance.data.datasets[2].data.shift();
    }

    chartInstance.update('none'); // Update without full costly re-animation
  }

  // Chart Toggle Buttons
  chartToggles.addEventListener('click', (e) => {
    const btn = e.target.closest('.chart-toggle-btn');
    if (!btn || !chartInstance) return;
    const datasetIdx = parseInt(btn.dataset.dataset, 10);
    const isVisible = chartInstance.isDatasetVisible(datasetIdx);

    if (isVisible) {
      chartInstance.hide(datasetIdx);
      btn.classList.remove('active');
    } else {
      chartInstance.show(datasetIdx);
      btn.classList.add('active');
    }
  });

  // ---------------------------------------------------------------------------
  // PAUSE / RESUME & MANUAL REFRESH
  // ---------------------------------------------------------------------------
  btnPause.addEventListener('click', () => {
    isStreamPaused = !isStreamPaused;
    if (isStreamPaused) {
      iconPause.classList.add('hidden');
      iconPlay.classList.remove('hidden');
      pauseText.textContent = 'Resume';
      btnPause.style.color = '#f59e0b';
    } else {
      iconPause.classList.remove('hidden');
      iconPlay.classList.add('hidden');
      pauseText.textContent = 'Pause';
      btnPause.style.color = '';
    }
  });

  btnRefresh.addEventListener('click', () => {
    if (socket && socket.connected) {
      btnRefresh.style.transform = 'rotate(180deg)';
      setTimeout(() => { btnRefresh.style.transform = ''; }, 300);
      socket.emit('request:refresh');
    }
  });

  // ---------------------------------------------------------------------------
  // UTILITY HELPERS
  // ---------------------------------------------------------------------------
  function formatBytes(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const val = (bytes / Math.pow(k, i));
    return `${val < 10 && i > 0 ? val.toFixed(2) : val.toFixed(1)} ${sizes[i]}`;
  }

  function formatTime(timestamp) {
    const d = new Date(timestamp || Date.now());
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  }

  function formatUptime(seconds) {
    const s = Math.floor(seconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const mins = Math.floor((s % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m ${s % 60}s`;
  }

  function startUptimeTicker() {
    if (clientUptimeTimer) clearInterval(clientUptimeTimer);
    clientUptimeTimer = setInterval(() => {
      if (serverBootTimestamp) {
        const diffSec = (Date.now() - serverBootTimestamp) / 1000;
        if (diffSec > 0) {
          valUptime.textContent = formatUptime(diffSec);
        }
      }
    }, 1000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // ---------------------------------------------------------------------------
  // INITIAL BOOTSTRAP
  // ---------------------------------------------------------------------------
  checkExistingAuth();

})();
