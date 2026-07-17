// Electron main process — a thin desktop shell for Shepherd.
//
// It owns nothing important: the daemon and the web dev server are separate,
// detached processes that both a browser and this app connect to. On launch it
// health-checks each and starts it only if it isn't already up; on quit it
// leaves them running, so closing the app never drops the daemon or the live
// session PTYs it holds (a browser tab or a later launch just reconnects).
//
// Because the daemon runs as a plain-Node child (not inside Electron), its
// native modules (node-pty, @xterm/headless) need no Electron-specific rebuild.

const { app, BrowserWindow, shell } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DAEMON_PORT = 4177; // ws daemon (server/src/index.ts)
const WEB_PORT = 5173; // vite dev server
const WEB_URL = `http://localhost:${WEB_PORT}`;

/** Resolve when a TCP connect to localhost:port succeeds, else false. */
function isPortUp(port) {
  return new Promise((resolve) => {
    const sock = net.connect(port, '127.0.0.1');
    const done = (up) => {
      sock.destroy();
      resolve(up);
    };
    sock.setTimeout(500);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => resolve(false));
  });
}

/** Start `pnpm <args>` from the repo root, detached so it outlives this app. */
function spawnDetached(args, name) {
  console.log(`[desktop] starting ${name}: pnpm ${args.join(' ')}`);
  const child = spawn('pnpm', args, {
    cwd: REPO_ROOT,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    // pnpm resolves to a .cmd shim on Windows; a shell handles that + PATH.
    shell: process.platform === 'win32',
  });
  child.on('error', (e) => console.error(`[desktop] failed to start ${name}:`, e.message));
  child.unref();
}

/** Start a service only if its port isn't already answering. */
async function ensureService(port, args, name) {
  if (await isPortUp(port)) {
    console.log(`[desktop] ${name} already running on ${port} — reusing it`);
    return;
  }
  spawnDetached(args, name);
}

/** Poll until the port answers (or give up after timeoutMs). */
async function waitForPort(port, timeoutMs = 30_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isPortUp(port)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    title: 'Shepherd',
    backgroundColor: '#080b10',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  // Open target=_blank / external links in the real browser, not a bare window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });

  const up = await waitForPort(WEB_PORT);
  if (up) {
    win.loadURL(WEB_URL);
  } else {
    win.loadURL(
      'data:text/html,' +
        encodeURIComponent(
          '<body style="font:14px system-ui;background:#080b10;color:#c9d1d9;padding:2rem">' +
            '<h1>🐑 Shepherd</h1><p>The web dev server did not come up on ' +
            WEB_PORT +
            '. Start it with <code>pnpm dev:web</code> and reopen.</p></body>',
        ),
    );
  }
}

app.whenReady().then(async () => {
  // Ensure the shared daemon is up (started detached if not — it outlives us).
  await ensureService(DAEMON_PORT, ['--filter', '@shepherd/server', 'dev'], 'daemon');
  // Dev-wrapper: also ensure the vite dev server the window loads is up.
  await ensureService(WEB_PORT, ['--filter', '@shepherd/web', 'dev'], 'web');
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Closing the app must NOT stop the daemon or web server — they're shared,
// detached services (keeps browser clients and live session PTYs alive).
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
