'use strict';

const { app, BrowserWindow, Tray, Menu, nativeImage, dialog } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 3001;
const isDev = !app.isPackaged;

let mainWindow = null;
let tray = null;
let serverProcess = null;

// ─── Icon ────────────────────────────────────────────────────────────────────

function makeTrayIcon() {
  // 22x22 RGBA — solid blue square, rendered as tray icon
  const size = 22;
  const buf = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4 + 0] = 59;
    buf[i * 4 + 1] = 130;
    buf[i * 4 + 2] = 246;
    buf[i * 4 + 3] = 255;
  }
  return nativeImage.createFromBuffer(buf, { width: size, height: size });
}

// ─── Server ───────────────────────────────────────────────────────────────────

function getResourcePath(...segments) {
  return isDev
    ? path.join(__dirname, '..', ...segments)
    : path.join(process.resourcesPath, ...segments);
}

function getNodeBin() {
  if (!isDev) return process.execPath; // Electron binary with ELECTRON_RUN_AS_NODE
  // In dev, use the system node that launched npm
  const { execSync } = require('child_process');
  try { return execSync('which node', { encoding: 'utf8' }).trim(); } catch { return 'node'; }
}

function startServer() {
  const serverDir = getResourcePath('server');
  const serverIndex = path.join(serverDir, 'index.js');
  const userData = app.getPath('userData');
  const nodeBin = getNodeBin();

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    DATA_DIR: userData,
  };
  if (!isDev) env.ELECTRON_RUN_AS_NODE = '1';

  serverProcess = spawn(nodeBin, [serverIndex], {
    cwd: serverDir,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  serverProcess.stdout?.on('data', d => console.log('[Server]', d.toString().trimEnd()));
  serverProcess.stderr?.on('data', d => console.error('[Server]', d.toString().trimEnd()));
  serverProcess.on('exit', code => console.log(`[Server] exited (${code})`));
}

function waitForServer(retries = 40) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = http.get(`http://localhost:${PORT}/api/health`, (res) => {
        if (res.statusCode === 200) return resolve();
        schedule(n);
      });
      req.on('error', () => schedule(n));
      req.setTimeout(500, () => { req.destroy(); schedule(n); });
    };
    const schedule = (n) => {
      if (n <= 0) return reject(new Error('Server failed to start'));
      setTimeout(() => attempt(n - 1), 500);
    };
    attempt(retries);
  });
}

// ─── Window ───────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: 'NCO AI Dashboard',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://localhost:${PORT}`);

  // Hide to tray instead of quitting
  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function createTray() {
  tray = new Tray(makeTrayIcon());
  tray.setToolTip('NCO AI Dashboard');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Open Dashboard',
      click: () => { mainWindow.show(); mainWindow.focus(); },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
}

// ─── Auto-launch ──────────────────────────────────────────────────────────────

async function setupAutoLaunch() {
  try {
    const AutoLaunch = require('auto-launch');
    const launcher = new AutoLaunch({ name: 'NCO AI Dashboard', isHidden: true });
    const enabled = await launcher.isEnabled();
    if (!enabled) await launcher.enable();
  } catch (e) {
    console.warn('[AutoLaunch] Setup failed:', e.message);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  startServer();

  try {
    await waitForServer();
  } catch (err) {
    dialog.showErrorBox('Startup Error', 'The server failed to start. Check that port 3001 is not already in use.');
    app.quit();
    return;
  }

  createWindow();
  createTray();
  setupAutoLaunch();
}

app.whenReady().then(main);

// Keep running when all windows are closed (live in tray)
app.on('window-all-closed', (e) => e.preventDefault());

app.on('before-quit', () => {
  app.isQuitting = true;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
});
