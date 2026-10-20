// Ableton bridge — the main-process end of the link to Ghost Arcade's Live
// control surface (ableton/GhostArcade). The script sends JSON datagrams to
// 127.0.0.1:11050 describing the set and every clip and scene launch; we
// forward them to the renderer and send its requests back to the script on
// 127.0.0.1:11051. Both ends stay on loopback.

const dgram = require('dgram');
const fs = require('fs');
const path = require('path');

const APP_PORT = 11050;
const SCRIPT_PORT = 11051;
const HOST = '127.0.0.1';
const SCRIPT_FOLDER = 'GhostArcade';

let socket = null;
let lastError = null;
let targetWindow = null;
// Launch events must reach the renderer quickly, so batching is limited to
// what arrives within one task.
let queue = [];
let flushScheduled = false;

function emit(channel, payload) {
  if (targetWindow && !targetWindow.isDestroyed()) targetWindow.webContents.send(channel, payload);
}

function flush() {
  flushScheduled = false;
  const batch = queue;
  queue = [];
  if (batch.length) emit('ableton-bridge-msg', batch);
}

function stop() {
  if (socket) {
    try { socket.close(); } catch { /* already closed */ }
    socket = null;
  }
  queue = [];
}

function start(win) {
  targetWindow = win;
  if (socket) return Promise.resolve({ ok: true, port: APP_PORT });
  lastError = null;
  return new Promise((resolve) => {
    const sock = dgram.createSocket({ type: 'udp4' });
    socket = sock;
    let settled = false;
    const finish = (result) => {
      if (!settled) { settled = true; resolve(result); }
    };
    sock.on('error', (err) => {
      lastError = err?.code === 'EADDRINUSE'
        ? `Port ${APP_PORT} is in use by another app`
        : String(err?.message || err);
      console.error('[Ableton] bridge socket error:', err);
      try { sock.close(); } catch { /* already closed */ }
      if (socket === sock) socket = null;
      emit('ableton-bridge-status', { listening: false, error: lastError });
      finish({ ok: false, error: lastError });
    });
    sock.on('message', (buf) => {
      try {
        queue.push(JSON.parse(buf.toString('utf8')));
      } catch {
        return;
      }
      if (queue.length > 4096) queue.splice(0, queue.length - 4096);
      if (!flushScheduled) {
        flushScheduled = true;
        setImmediate(flush);
      }
    });
    sock.once('listening', () => {
      console.log('[Ableton] bridge listening on', `${HOST}:${APP_PORT}`);
      emit('ableton-bridge-status', { listening: true, error: null });
      finish({ ok: true, port: APP_PORT });
    });
    sock.bind({ port: APP_PORT, address: HOST, exclusive: true });
  });
}

function send(message) {
  if (!socket || !message || typeof message !== 'object') return { ok: false };
  const data = Buffer.from(JSON.stringify(message), 'utf8');
  socket.send(data, SCRIPT_PORT, HOST, (err) => {
    if (err) console.warn('[Ableton] send failed:', err.message || err);
  });
  return { ok: true };
}

function status() {
  return { listening: socket !== null, port: APP_PORT, error: lastError };
}

// Live keeps one preferences folder per version ("Live 10.1.43", "Live
// 12.1"); its Library.cfg records where the User Library lives.
function livePreferenceFolders(app) {
  const root = process.platform === 'darwin'
    ? path.join(app.getPath('home'), 'Library', 'Preferences', 'Ableton')
    : path.join(app.getPath('appData'), 'Ableton');
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^Live \d/.test(entry.name))
      .map((entry) => path.join(root, entry.name, process.platform === 'darwin' ? '' : 'Preferences'));
  } catch { /* Live has never run here */ }
  const modified = (folder) => {
    try { return fs.statSync(path.join(folder, 'Library.cfg')).mtimeMs; } catch { return 0; }
  };
  return entries.sort((a, b) => modified(b) - modified(a));
}

function configuredUserLibrary(app) {
  for (const folder of livePreferenceFolders(app)) {
    try {
      const config = fs.readFileSync(path.join(folder, 'Library.cfg'), 'utf8');
      const userLibrary = config.match(/<UserLibrary>[\s\S]*?<ProjectPath Value="([^"]+)"/);
      if (userLibrary) return path.join(userLibrary[1], 'User Library');
    } catch { /* unreadable; try the next version */ }
  }
  return null;
}

// Live reads extra control surfaces from "Remote Scripts" in the User
// Library. Without a Library.cfg, use Live's defaults: Documents\Ableton on
// Windows, Music/Ableton on macOS.
function remoteScriptsFolder(app) {
  const fallback = path.join(
    process.platform === 'darwin' ? app.getPath('music') : app.getPath('documents'),
    'Ableton', 'User Library',
  );
  return path.join(configuredUserLibrary(app) || fallback, 'Remote Scripts');
}

function bundledScriptFolder(app, appRoot) {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'ableton', SCRIPT_FOLDER) : null,
    path.join(appRoot, 'ableton', SCRIPT_FOLDER),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(path.join(candidate, '__init__.py'))) || null;
}

function scriptFiles(folder) {
  return fs.readdirSync(folder).filter((name) => name.endsWith('.py'));
}

function scriptStatus(app, appRoot) {
  const target = path.join(remoteScriptsFolder(app), SCRIPT_FOLDER);
  const source = bundledScriptFolder(app, appRoot);
  const installed = fs.existsSync(path.join(target, '__init__.py'));
  let current = false;
  if (installed && source) {
    current = scriptFiles(source).every((name) => {
      const installedFile = path.join(target, name);
      return fs.existsSync(installedFile)
        && fs.readFileSync(installedFile).equals(fs.readFileSync(path.join(source, name)));
    });
  }
  return {
    installed,
    current,
    path: target,
    libraryFound: fs.existsSync(path.join(remoteScriptsFolder(app), '..')),
    available: !!source,
  };
}

function installScript(app, appRoot, folder = null) {
  const source = bundledScriptFolder(app, appRoot);
  if (!source) return { ok: false, error: 'The Live script is missing from this install' };
  const root = folder || remoteScriptsFolder(app);
  const target = path.join(root, SCRIPT_FOLDER);
  try {
    fs.mkdirSync(target, { recursive: true });
    for (const name of scriptFiles(source)) {
      fs.copyFileSync(path.join(source, name), path.join(target, name));
    }
    // Stale bytecode from an older version would shadow the new files.
    fs.rmSync(path.join(target, '__pycache__'), { recursive: true, force: true });
    return { ok: true, path: target };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), path: target };
  }
}

module.exports = {
  APP_PORT,
  SCRIPT_PORT,
  start,
  stop,
  send,
  status,
  scriptStatus,
  installScript,
  remoteScriptsFolder,
};
