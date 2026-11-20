// Starts Ghost Arcade for a soak run (the source checkout through Vite, or a
// packaged build given its path), on a throwaway profile with its own temp
// folder and ports, and stops it again. Restarts are the runner's job; this
// file only knows how to start, watch and stop one copy.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { PageSession, waitForTarget, browserCall } from './cdp.mjs';
import { alive, killTree } from './proc.mjs';

const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';

async function urlUp(url) {
  try { return (await fetch(url, { signal: AbortSignal.timeout(3000) })).ok; } catch { return false; }
}

/**
 * The Vite dev server for a source run. Reuses one already on `port`;
 * otherwise starts one with its own dependency cache (a symlinked
 * node_modules would otherwise share .vite with every other checkout).
 */
export async function ensureDevServer({ root, port, sessionDir, log }) {
  const url = `http://localhost:${port}`;
  if (await urlUp(`${url}/`)) { log(`using the dev server already on ${port}`); return { url, stop() {} }; }
  const wrapper = path.join(sessionDir, 'vite.soak.config.mjs');
  const projectConfig = path.join(root, 'vite.config.ts').replace(/\\/g, '/');
  const cacheDir = path.join(sessionDir, 'vite-cache').replace(/\\/g, '/');
  // An absolute path with forward slashes resolves on every platform (C:/... on Windows).
  fs.writeFileSync(wrapper, `import base from ${JSON.stringify(projectConfig)};
export default async (env) => {
  const c = typeof base === 'function' ? await base(env) : base;
  return { ...c, cacheDir: ${JSON.stringify(cacheDir)}, clearScreen: false, server: { ...(c.server ?? {}), port: ${port}, strictPort: true, open: false } };
};
`);
  log(`starting the dev server on ${port}`);
  const logFile = fs.openSync(path.join(sessionDir, 'logs', 'vite.log'), 'a');
  const viteBin = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  const child = spawn(process.execPath, [viteBin, '--config', wrapper, '--port', String(port), '--strictPort'], {
    cwd: root, stdio: ['ignore', logFile, logFile], detached: !IS_WIN, windowsHide: true,
  });
  for (let i = 0; i < 240 && !(await urlUp(`${url}/`)); i++) {
    if (child.exitCode !== null) throw new Error('the dev server exited; see logs/vite.log');
    await sleep(500);
  }
  if (!(await urlUp(`${url}/`))) throw new Error('the dev server did not start; see logs/vite.log');
  return {
    url,
    pid: child.pid,
    stop() {
      try { IS_WIN ? killTree(child.pid, 'SIGKILL') : process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ }
    },
  };
}

/**
 * What to run. `appPath` empty = the source checkout. Otherwise a packaged
 * build: macOS .app or .dmg (mounted read-only, never installed), Windows
 * .exe or the folder that holds it, Linux binary or AppImage.
 */
export function resolveTarget({ root, appPath, sessionDir, log }) {
  if (!appPath) {
    return { packaged: false, exe: require(path.join(root, 'node_modules', 'electron')), args: [root], label: 'source checkout', cleanup() {} };
  }
  let p = path.resolve(appPath);
  if (!fs.existsSync(p)) throw new Error(`no app at ${p}`);
  let cleanup = () => {};
  if (IS_MAC && p.endsWith('.dmg')) {
    const mnt = path.join(sessionDir, 'mnt');
    fs.mkdirSync(mnt, { recursive: true });
    log(`mounting ${path.basename(p)} read-only`);
    execFileSync('hdiutil', ['attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mnt, p], { stdio: 'ignore' });
    cleanup = () => { try { execFileSync('hdiutil', ['detach', mnt, '-force'], { stdio: 'ignore' }); } catch { /* already gone */ } };
    const app = fs.readdirSync(mnt).find((f) => f.endsWith('.app'));
    if (!app) { cleanup(); throw new Error('no .app inside the disk image'); }
    p = path.join(mnt, app);
  }
  let exe = p;
  if (IS_MAC && p.endsWith('.app')) {
    let name = null;
    try { name = execFileSync('plutil', ['-extract', 'CFBundleExecutable', 'raw', path.join(p, 'Contents', 'Info.plist')]).toString().trim(); } catch { /* fall back */ }
    const macos = path.join(p, 'Contents', 'MacOS');
    exe = path.join(macos, name || fs.readdirSync(macos)[0]);
  } else if (fs.statSync(p).isDirectory()) {
    const found = fs.readdirSync(p).find((f) => (IS_WIN ? /^Ghost Arcade.*\.exe$/i.test(f) : /^ghost-arcade/i.test(f)));
    if (!found) throw new Error(`no Ghost Arcade executable in ${p}`);
    exe = path.join(p, found);
  }
  let version = null;
  if (IS_MAC && p.endsWith('.app')) { try { version = execFileSync('plutil', ['-extract', 'CFBundleShortVersionString', 'raw', path.join(p, 'Contents', 'Info.plist')]).toString().trim(); } catch { /* unknown */ } }
  return { packaged: true, exe, args: [], label: exe, version, cleanup };
}

function showMacProcess(pid) {
  try {
    execFileSync('osascript', ['-e', `tell application "System Events" to set visible of (first process whose unix id is ${pid}) to true`], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}

function hideMacProcess(pid) {
  try {
    execFileSync('osascript', ['-e', `tell application "System Events" to set visible of (first process whose unix id is ${pid}) to false`], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch { return false; }
}

/** The page helpers the actions and telemetry use; installed on every (re)load. */
export const PAGE_HELPERS = `(() => {
  if (window.__soak) return 'present';
  const g = () => window.__ghostArcade;
  const read = (store) => { let v; const off = store.subscribe((x) => { v = x; }); off(); return v; };
  const pub = { counts: {}, since: performance.now(), offs: [] };
  const watch = (name, store) => {
    if (!store || typeof store.subscribe !== 'function') return;
    try { pub.offs.push(store.subscribe(() => { pub.counts[name] = (pub.counts[name] ?? 0) + 1; })); } catch { /* not a store */ }
  };
  window.__soak = {
    g, read, pub, vars: {},
    instrument() {
      const G = g();
      if (!G || pub.offs.length) return pub.offs.length;
      for (const k of ['project', 'settings', 'showTimeline', 'vjClipLauncher', 'keyframeTimeline', 'dmxStore', 'modulationStore']) watch(k, G[k]);
      watch('takeover', G.takeover?.store);
      return pub.offs.length;
    },
    /** Store notifications per second since the last call. */
    publishRates() {
      const dt = (performance.now() - pub.since) / 1000;
      const out = {};
      for (const [k, n] of Object.entries(pub.counts)) out[k] = Math.round((n / dt) * 10) / 10;
      pub.counts = {}; pub.since = performance.now();
      return out;
    },
    project: () => read(g().project),
    deck: () => read(g().vjClipLauncher),
    show: () => read(g().showTimeline),
    async shaderClip(name, values = {}) {
      const src = './ISF/' + (name + '.fs').split('/').map(encodeURIComponent).join('/');
      const code = await (await fetch(src)).text();
      return { id: crypto.randomUUID(), type: 'shader', name, src, shaderCode: code, shaderValues: values };
    },
    async status() { return window.electronAPI.invoke('native_renderer_get_status'); },
    async snapshot(opts = {}) {
      const s = await window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: false, ...opts }).catch(() => null);
      return s && s.mean_rgba ? s : null;
    },
    async editorFps(ms = 1000) {
      const t0 = performance.now(); let frames = 0;
      await new Promise((res) => { const f = () => { frames++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); setTimeout(res, ms + 500); });
      return Math.round(frames / ((performance.now() - t0) / 1000));
    },
    /** Centre of the first visible, enabled element for a selector. */
    rect(sel) {
      for (const el of document.querySelectorAll(sel)) {
        if (el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 2 && r.height > 2 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth) {
          return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: r.width, h: r.height };
        }
      }
      return null;
    },
    modalOpen() {
      return !!document.querySelector('.close-modal-backdrop, .tp-backdrop, .welcome, .tour-card, [role="dialog"][aria-modal="true"]');
    },
  };
  // Never let a native alert/confirm stall the run (save failures use them).
  window.alert = (m) => console.warn('[soak] alert: ' + m);
  window.confirm = (m) => { console.warn('[soak] confirm (answered no): ' + m); return false; };
  return 'installed';
})()`;

/**
 * Start one copy. Returns a handle with the page session, pid, and stop().
 * `onConsole` / `onEvent` receive the page's console problems and events.
 */
export async function launchApp({ target, root, devUrl, cdpPort, runIndex, sessionDir, hidden, windowSize, log, onConsole, onEvent }) {
  const sandbox = path.join(sessionDir, 'sandbox');
  const profile = path.join(sandbox, `profile-run${runIndex}`);
  const tmp = path.join(sandbox, 'tmp');
  const home = path.join(sandbox, 'home');
  for (const d of [profile, tmp, home]) fs.mkdirSync(d, { recursive: true });
  // A packaged app copies an older install's settings (and autosave) into a
  // new profile on first launch; the marker says that already happened, so
  // every run starts from a clean profile, not this machine's own.
  const marker = path.join(profile, '.ga-profile-migrated.json');
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify({ from: 'soak test', migrated: false, reason: 'soak test profile', at: new Date().toISOString() }));
  const env = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    // Temp files land in the session's own folder, so their growth is measurable
    // and nothing is left in the system temp folder.
    TMPDIR: tmp, TEMP: tmp, TMP: tmp,
    // The Live bridge on ports of its own, so a soak never talks to a real Live set.
    GA_ABLETON_APP_PORT: String(cdpPort + 20000),
    GA_ABLETON_SCRIPT_PORT: String(cdpPort + 20001),
  };
  const args = [...target.args, `--remote-debugging-port=${cdpPort}`];
  if (target.packaged) {
    // Packaged builds ignore GA_USER_DATA_DIR; Chromium's own switch moves the profile.
    args.push(`--user-data-dir=${profile}`);
    // The packaged debug log goes to ~/Library/Logs (macOS) or %LOCALAPPDATA%
    // (Windows): point those at the sandbox so an installed copy's log is never rotated.
    if (IS_MAC) { env.HOME = home; fs.mkdirSync(path.join(home, 'Library', 'Logs'), { recursive: true }); }
    if (IS_WIN) env.LOCALAPPDATA = home;
  } else {
    env.GA_USER_DATA_DIR = profile;
    // The debug log in the session, not the checkout's electron-debug.log
    // (which another copy started from the same checkout would rotate).
    env.GA_DEBUG_LOG_DIR = home;
    env.VITE_DEV_SERVER_URL = devUrl;
    env.WS_PORT = String(cdpPort + 1);
    env.HTTP_PORT = String(cdpPort + 2);
  }
  if (process.platform === 'linux') args.push('--no-sandbox');
  const logPath = path.join(sessionDir, 'logs', `app-run${runIndex}.log`);
  const out = fs.openSync(logPath, 'a');
  log(`launch #${runIndex}: ${target.label}`);
  const child = spawn(target.exe, args, { cwd: target.packaged ? path.dirname(target.exe) : root, env, stdio: ['ignore', out, out], windowsHide: false });
  const exit = { code: null, signal: null, at: null };
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => { exit.code = code; exit.signal = signal; exit.at = Date.now(); resolve(exit); }));
  const isAlive = () => exit.at === null;

  const startedAt = Date.now();
  // A copy that fails to come up is never left running.
  const abandon = async (err) => {
    await killTree(child.pid, 'SIGKILL');
    await Promise.race([exited, sleep(5000)]);
    try { fs.closeSync(out); } catch { /* closed */ }
    throw err;
  };
  let pageTarget; let session;
  try {
  pageTarget = await waitForTarget(cdpPort, (t) => !t.url.includes('mode=') && !t.url.startsWith('devtools://') && (target.packaged ? true : t.url.startsWith(devUrl)), 120000, isAlive);
  if (hidden && IS_MAC) { for (let i = 0; i < 10 && !hideMacProcess(child.pid); i++) await sleep(300); }
  session = await new PageSession(pageTarget, { onConsole, onEvent }).connect();
  // The stores are exposed once the editor has mounted.
  let ready = false;
  for (let i = 0; i < 240 && isAlive(); i++) {
    ready = await session.eval('!!window.__ghostArcade?.vjClipLauncher && !!window.__ghostArcade?.showTimeline', 5000).catch(() => false);
    if (ready) break;
    await sleep(500);
  }
  if (!ready) throw new Error(isAlive() ? 'the editor never became ready (no window.__ghostArcade)' : 'the app exited while starting');
  await session.eval(PAGE_HELPERS);
  } catch (err) {
    try { session?.close(); } catch { /* gone */ }
    await abandon(err);
  }
  const readyMs = Date.now() - startedAt;
  if (windowSize) await setWindowSize(cdpPort, pageTarget.id, windowSize).catch(() => {});

  return {
    pid: child.pid,
    session,
    pageTargetId: pageTarget.id,
    profile,
    tmp,
    home,
    readyMs,
    logPath,
    exit,
    exited,
    isAlive,
    rehide() { if (hidden && IS_MAC) hideMacProcess(child.pid); },
    /** Show the hidden app for a moment and hide it again. macOS can leave a
     *  hidden app's editor window throttled to one animation frame a second
     *  (seen after its Output Window closed while hidden); showing it once
     *  restores normal frames, and they stay after it is hidden again. */
    refreshHidden() {
      if (!hidden || !IS_MAC) return false;
      showMacProcess(child.pid);
      execFileSync('sleep', ['0.5']);
      return hideMacProcess(child.pid);
    },
    /** Reconnect after the editor reloaded itself (recovery), keeping the same process. */
    async reconnect() {
      try { session.close(); } catch { /* gone */ }
      const t = await waitForTarget(cdpPort, (x) => !x.url.includes('mode=') && !x.url.startsWith('devtools://') && (target.packaged ? true : x.url.startsWith(devUrl)), 60000, isAlive);
      const s = await new PageSession(t, { onConsole, onEvent }).connect();
      for (let i = 0; i < 120; i++) {
        if (await s.eval('!!window.__ghostArcade?.vjClipLauncher', 5000).catch(() => false)) break;
        await sleep(500);
      }
      await s.eval(PAGE_HELPERS);
      this.session = s;
      this.pageTargetId = t.id;
      return s;
    },
    async stop({ graceful = true } = {}) {
      try { this.session?.close(); } catch { /* gone */ }
      if (isAlive()) {
        // Ask the main process to quit; it closes its own children. The
        // whole tree is killed only if it does not.
        // (On Windows a signal would end only the main process, so taskkill
        // closes the tree's windows instead.)
        if (graceful) {
          if (IS_WIN) await killTree(child.pid, 'SIGTERM');
          else { try { process.kill(child.pid, 'SIGTERM'); } catch { /* gone */ } }
        }
        else await killTree(child.pid, 'SIGKILL');
        await Promise.race([exited, sleep(10000)]);
        if (isAlive()) { await killTree(child.pid, 'SIGKILL'); await Promise.race([exited, sleep(5000)]); }
      }
      // Wait for the debug port to close so the next launch never attaches to this copy.
      for (let i = 0; i < 40; i++) {
        const up = await fetch(`http://127.0.0.1:${cdpPort}/json/version`, { signal: AbortSignal.timeout(1000) }).then(() => true).catch(() => false);
        if (!up) break;
        await sleep(250);
      }
      try { fs.closeSync(out); } catch { /* closed */ }
    },
  };
}

export async function setWindowSize(cdpPort, targetId, { width, height }) {
  const { windowId } = await browserCall(cdpPort, 'Browser.getWindowForTarget', { targetId });
  await browserCall(cdpPort, 'Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } }).catch(() => {});
  await browserCall(cdpPort, 'Browser.setWindowBounds', { windowId, bounds: { width, height } });
}

/** Where this copy writes its main-process debug log. */
export function debugLogPath({ target, root, handle }) {
  if (!target.packaged) return path.join(handle.home, 'electron-debug.log');
  if (IS_MAC) return path.join(handle.home, 'Library', 'Logs', 'ghost-arcade-debug.log');
  if (IS_WIN) return path.join(handle.home, 'ghost-arcade-debug.log');
  // Linux: LOCALAPPDATA is unset, so the log follows TEMP (the session's temp folder).
  return path.join(handle.tmp, 'ghost-arcade-debug.log');
}
