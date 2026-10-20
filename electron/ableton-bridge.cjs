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
const REMOTE_SCRIPTS = 'Remote Scripts';
const SETTINGS_FILE = 'ableton-bridge.json';

let socket = null;
let lastError = null;
let targetWindow = null;
/** The bind in progress, so a repeat start() waits for it and stop() can end it. */
let pendingStart = null;
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
  if (pendingStart) {
    pendingStart.settle({ ok: false, error: 'stopped' });
    pendingStart = null;
  }
  queue = [];
}

function start(win) {
  targetWindow = win;
  if (pendingStart) return pendingStart.promise;
  if (socket) return Promise.resolve({ ok: true, port: APP_PORT });
  lastError = null;
  let settle;
  const promise = new Promise((resolve) => {
    let settled = false;
    settle = (result) => {
      if (settled) return;
      settled = true;
      if (pendingStart?.promise === promise) pendingStart = null;
      resolve(result);
    };
  });
  pendingStart = { promise, settle };
  const sock = dgram.createSocket({ type: 'udp4' });
  socket = sock;
  sock.on('error', (err) => {
    lastError = err?.code === 'EADDRINUSE'
      ? `Port ${APP_PORT} is in use by another app`
      : String(err?.message || err);
    console.error('[Ableton] bridge socket error:', err);
    try { sock.close(); } catch { /* already closed */ }
    if (socket === sock) socket = null;
    emit('ableton-bridge-status', { listening: false, error: lastError });
    settle({ ok: false, error: lastError });
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
    settle({ ok: true, port: APP_PORT });
  });
  sock.bind({ port: APP_PORT, address: HOST, exclusive: true });
  return promise;
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

// ── Where Live looks for the script ─────────────────────────────────────

function readSettings(app) {
  try {
    return JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), SETTINGS_FILE), 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeSettings(app, settings) {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), SETTINGS_FILE), JSON.stringify(settings, null, 2));
  } catch (err) {
    console.warn('[Ableton] could not save bridge settings:', err?.message || err);
  }
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

function decodeXml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Every User Library the installed versions of Live use, newest first. */
function configuredUserLibraries(app) {
  const libraries = [];
  for (const folder of livePreferenceFolders(app)) {
    try {
      const config = fs.readFileSync(path.join(folder, 'Library.cfg'), 'utf8');
      const block = config.match(/<UserLibrary>([\s\S]*?)<\/UserLibrary>/)?.[1] ?? '';
      const projectPath = block.match(/<ProjectPath Value="([^"]+)"/)?.[1];
      if (!projectPath) continue;
      const projectName = block.match(/<ProjectName Value="([^"]+)"/)?.[1] || 'User Library';
      const library = path.join(decodeXml(projectPath), decodeXml(projectName));
      if (!libraries.some((known) => known.toLowerCase() === library.toLowerCase())) libraries.push(library);
    } catch { /* unreadable; try the next version */ }
  }
  return libraries;
}

/** Live's default User Library when it has never recorded one. */
function defaultUserLibrary(app) {
  return path.join(process.platform === 'darwin' ? app.getPath('music') : app.getPath('documents'), 'Ableton', 'User Library');
}

/** A folder the user picked, corrected to the "Remote Scripts" folder Live
 *  reads: picking the script's own folder or the User Library both work. */
function normalizeChosenFolder(folder) {
  if (path.basename(folder) === SCRIPT_FOLDER) return path.dirname(folder);
  if (path.basename(folder) === REMOTE_SCRIPTS) return folder;
  const nested = path.join(folder, REMOTE_SCRIPTS);
  if (fs.existsSync(nested) || path.basename(folder) === 'User Library') return nested;
  return folder;
}

/** Every "Remote Scripts" folder to install into: a folder the user chose,
 *  else each User Library Live records (or Live's default). */
function remoteScriptsFolders(app) {
  const chosen = readSettings(app).remoteScripts;
  if (typeof chosen === 'string' && chosen && fs.existsSync(path.dirname(chosen))) return [chosen];
  const libraries = configuredUserLibraries(app);
  return (libraries.length ? libraries : [defaultUserLibrary(app)]).map((library) => path.join(library, REMOTE_SCRIPTS));
}

function remoteScriptsFolder(app) {
  return remoteScriptsFolders(app)[0];
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
  try {
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
      libraryFound: fs.existsSync(path.dirname(path.dirname(target))),
      available: !!source,
    };
  } catch (err) {
    return { installed: false, current: false, path: target, libraryFound: false, available: false, error: String(err?.message || err) };
  }
}

function installInto(source, root) {
  const target = path.join(root, SCRIPT_FOLDER);
  fs.mkdirSync(target, { recursive: true });
  for (const name of scriptFiles(source)) {
    fs.copyFileSync(path.join(source, name), path.join(target, name));
  }
  // Stale bytecode from an older version would shadow the new files.
  fs.rmSync(path.join(target, '__pycache__'), { recursive: true, force: true });
  return target;
}

/** Copy the script into Live's "Remote Scripts" folder(s). A folder the
 *  user picks is remembered for status checks and later updates. */
function installScript(app, appRoot, folder = null) {
  const source = bundledScriptFolder(app, appRoot);
  if (!source) return { ok: false, error: 'The Live script is missing from this install' };
  let roots;
  if (folder) {
    const chosen = normalizeChosenFolder(folder);
    writeSettings(app, { ...readSettings(app), remoteScripts: chosen });
    roots = [chosen];
  } else {
    roots = remoteScriptsFolders(app);
  }
  const installed = [];
  try {
    for (const root of roots) installed.push(installInto(source, root));
    return { ok: true, path: installed[0], paths: installed };
  } catch (err) {
    return { ok: false, error: String(err?.message || err), path: path.join(roots[installed.length] ?? roots[0], SCRIPT_FOLDER) };
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
