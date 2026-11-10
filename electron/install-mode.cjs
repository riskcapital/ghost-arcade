'use strict';

/**
 * Install mode, main-process side: what keeps an unattended installation
 * running for weeks.
 *
 * Install mode is show mode (electron/show-startup.cjs) for a launch that is
 * not skipped (--no-show-mode) and not left with the exit key combo. While
 * it is on, this module:
 *
 *   - writes the health log (install-health-log.cjs)
 *   - runs the watchdog (install-watchdog.cjs): the editor's heartbeat, its
 *     crashes, and the render core's frame count; restarts the part that
 *     failed, rate-limited, escalating to a relaunch of the app
 *   - starts the guardian (install-guardian.cjs), which starts the app again
 *     if the whole app dies
 *   - keeps the show's anchor (where a looping show resumes, see
 *     src/lib/install/installResume.ts) across reloads and relaunches
 *   - holds a quit (confirm, or the exit key combo only), but never blocks
 *     the computer shutting down or restarting
 *   - hides the mouse pointer on the output windows
 *   - registers the exit key combo: Cmd/Ctrl + Alt + Shift + X leaves
 *     install mode for this session; the Settings switch turns it off.
 *
 * Everything outside is injected so tests can drive it without Electron.
 */

const nodeFs = require('fs');
const nodePath = require('path');
const { spawn: nodeSpawn } = require('child_process');
const { writeFileAtomicSync } = require('./atomic-write.cjs');
const { createHealthLog } = require('./install-health-log.cjs');
const { decide, normalizeHistory, createFrameStallDetector } = require('./install-watchdog.cjs');

const EXIT_ACCELERATOR = 'CommandOrControl+Alt+Shift+X';
const HEARTBEAT_TIMEOUT_MS = 20_000;
const FIRST_HEARTBEAT_TIMEOUT_MS = 90_000;
const CORE_GONE_MS = 60_000;

function createInstallMode({
  app,
  showStartup,
  getMainWindow,
  broker = null,
  dialog = null,
  globalShortcut = null,
  powerMonitor = null,
  isPowerBlockerActive = () => false,
  getOutputWindows = () => [],
  fs = nodeFs,
  path = nodePath,
  spawn = nodeSpawn,
  now = () => Date.now(),
  setInterval: setIntervalFn = setInterval,
  clearInterval: clearIntervalFn = clearInterval,
  logDir = null,
  limits = undefined,
  env = process.env,
  argv = process.argv,
  execPath = process.execPath,
  cwd = process.cwd(),
  pid = process.pid,
  guardianSource = null,
} = {}) {
  const userData = app.getPath('userData');
  const stateFile = path.join(userData, 'install-state.json');
  const health = createHealthLog({ dir: logDir || path.join(userData, 'logs'), fs, path, now });
  let paused = false;
  let started = false;
  let quitAllowed = false;
  let quitDialogOpen = false;
  let timer = null;
  let coreTimer = null;
  let coreCheckBusy = false;
  let lastHeartbeat = null;
  let lastHeartbeatAt = 0;
  let pageLoadedAt = 0;
  let coreGoneSince = 0;
  let pendingCooldownLogged = 0;
  let guardianPid = null;
  const stall = createFrameStallDetector();
  const startedAt = now();

  let state = readState();

  function readState() {
    try {
      const raw = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return { ...(raw && typeof raw === 'object' ? raw : {}), history: normalizeHistory(raw && raw.history) };
    } catch {
      return { history: normalizeHistory(null) };
    }
  }

  function saveState(patch) {
    // The guardian writes this file too; take its relaunch history in.
    const disk = readState();
    const p = patch || {};
    const history = normalizeHistory(p.history || state.history);
    history.relaunches = Array.from(new Set([...disk.history.relaunches, ...history.relaunches]))
      .sort((a, b) => a - b)
      .slice(-50);
    state = { ...disk, ...state, ...p, history };
    try {
      fs.mkdirSync(path.dirname(stateFile), { recursive: true });
      writeFileAtomicSync(stateFile, JSON.stringify(state, null, 2), { fs });
    } catch (err) {
      console.warn('[Install] could not save state:', err && err.message);
    }
  }

  function config() {
    try { return showStartup.get().config; } catch { return {}; }
  }

  /** Install mode is running for this launch. */
  function active() {
    let session = null;
    try { session = showStartup.get().session; } catch { session = null; }
    return !!(session && session.showMode) && !paused;
  }

  function log(kind, message) {
    console.log(`[Install] ${kind}: ${message}`);
    return health.write(kind, message);
  }

  // ── The watchdog ────────────────────────────────────────────────────
  function fault(kind, reason) {
    if (!active() || config().watchdog === false) return null;
    const d = decide(kind, state.history, now(), limits);
    if (d.action === 'wait') return d;
    if (d.action === 'cooldown') {
      if (now() - pendingCooldownLogged > 10 * 60_000) {
        pendingCooldownLogged = now();
        log('watchdog', `${reason}; ${d.reason}`);
      }
      return d;
    }
    saveState({ history: d.history });
    log('restart', `${reason} -> ${d.action}: ${d.reason}`);
    carryOut(d.action);
    return d;
  }

  function carryOut(action) {
    const win = getMainWindow();
    if (action === 'kill-core') {
      const corePid = broker && broker.getProcessId ? broker.getProcessId() : null;
      stall.reset();
      if (corePid) {
        try { process.kill(corePid, 'SIGKILL'); } catch (err) { log('restart', `could not end the render core: ${err && err.message}`); }
      }
      return;
    }
    if (action === 'reload-renderer') {
      lastHeartbeatAt = 0;
      pageLoadedAt = 0;
      if (!win || win.isDestroyed()) { relaunch(); return; }
      const wc = win.webContents;
      try {
        // A hung page may not unload on its own: end its process first.
        if (!wc.isCrashed() && lastHeartbeat && typeof wc.forcefullyCrashRenderer === 'function') {
          wc.forcefullyCrashRenderer();
        }
        setTimeout(() => {
          try { if (!win.isDestroyed()) wc.reload(); } catch { /* the next check escalates */ }
        }, 500);
      } catch {
        relaunch();
      }
      return;
    }
    if (action === 'relaunch-app') relaunch();
  }

  function relaunch() {
    log('restart', 'relaunching the app');
    // The guardian sees the app gone without a clean exit and starts it
    // again; without one, Electron does it.
    saveState({ cleanExit: false, relaunchRequested: true });
    if (!(guardianPid && processAlive(guardianPid))) {
      try { app.relaunch({ args: argv.slice(1) }); } catch { /* ignore */ }
      saveState({ cleanExit: true, relaunchRequested: false }); // no guardian to race with
    }
    quitAllowed = true;
    try { app.exit(0); } catch { /* ignore */ }
  }

  function processAlive(p) {
    try { process.kill(p, 0); return true; } catch (err) { return !!(err && err.code === 'EPERM'); }
  }

  function checkHeartbeat() {
    if (!active() || config().watchdog === false) return;
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    const wc = win.webContents;
    if (wc.isLoading() || wc.isCrashed() || !pageLoadedAt) return;
    const t = now();
    const since = lastHeartbeatAt || pageLoadedAt;
    const limit = lastHeartbeatAt ? HEARTBEAT_TIMEOUT_MS : FIRST_HEARTBEAT_TIMEOUT_MS;
    if (t - since > limit) {
      fault('renderer-hang', `the editor has not answered for ${Math.round((t - since) / 1000)} s`);
    }
  }

  async function checkCore() {
    if (coreCheckBusy || !active() || config().watchdog === false || !broker) return;
    coreCheckBusy = true;
    try {
      const t = now();
      const corePid = broker.getProcessId ? broker.getProcessId() : null;
      if (!corePid) {
        stall.reset();
        if (!coreGoneSince) coreGoneSince = t;
        if (t - coreGoneSince > CORE_GONE_MS && pageLoadedAt) {
          coreGoneSince = t;
          fault('core-dead', `the render core has been gone for ${Math.round(CORE_GONE_MS / 1000)} s`);
        }
        return;
      }
      coreGoneSince = 0;
      const stats = await broker.sendIfRunning('stats', {}, { fallback: null, timeoutMs: 3000 });
      const frames = stats ? Number(stats.frames_submitted ?? stats.frames_presented ?? NaN) : NaN;
      const verdict = stall.sample({ running: true, instance: broker.coreInstance ?? corePid, ok: !!stats, frames }, now());
      lastCore = { pid: corePid, frames: Number.isFinite(frames) ? frames : null, at: now(), ok: !!stats };
      if (verdict.stalled) fault('core-stall', verdict.reason);
    } catch (err) {
      console.warn('[Install] core check failed:', err && err.message);
    } finally {
      coreCheckBusy = false;
    }
  }
  let lastCore = null;

  // ── Guardian ────────────────────────────────────────────────────────
  function startGuardian() {
    if (config().relaunchOnCrash === false) return;
    try {
      const source = guardianSource ?? fs.readFileSync(path.join(__dirname, 'install-guardian.cjs'), 'utf8');
      const target = path.join(userData, 'install-guardian.cjs');
      fs.writeFileSync(target, source);
      const cfg = {
        pid,
        stateFile,
        logFile: health.file,
        command: execPath,
        args: argv.slice(1),
        cwd,
        maxRelaunches: 5,
        windowMs: 60 * 60_000,
        delayMs: 3000,
      };
      const child = spawn(execPath, [target], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        env: { ...env, ELECTRON_RUN_AS_NODE: '1', GA_GUARDIAN_CONFIG: JSON.stringify(cfg) },
      });
      child.unref?.();
      guardianPid = child.pid || null;
      saveState({ guardianPid, cleanExit: false });
      log('guardian', `watching the app (guardian pid ${guardianPid})`);
    } catch (err) {
      log('guardian', `could not start: ${err && err.message}`);
    }
  }

  function stopGuardian() {
    saveState({ cleanExit: true });
    if (guardianPid && processAlive(guardianPid)) {
      try { process.kill(guardianPid); } catch { /* gone */ }
    }
    guardianPid = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  function start() {
    if (started || !active()) return false;
    started = true;
    const cfg = config();
    const crashed = state.cleanExit === false && state.lastStartAt;
    log('start', `install mode on (pid ${pid})${crashed ? ', after the previous run ended without quitting' : ''}; project: ${cfg.projectPath || 'none chosen'}; then: ${cfg.autoStart}`);
    saveState({ lastStartAt: now(), cleanExit: false, relaunchRequested: false });
    startGuardian();
    if (globalShortcut) {
      try {
        const ok = globalShortcut.register(EXIT_ACCELERATOR, () => pause('key combo'));
        if (!ok) log('warning', `the exit key combo ${EXIT_ACCELERATOR} is taken by another app`);
      } catch (err) {
        log('warning', `could not register the exit key combo: ${err && err.message}`);
      }
    }
    if (powerMonitor) {
      // The computer is shutting down or restarting: let it.
      const allow = (why) => {
        quitAllowed = true;
        saveState({ cleanExit: true });
        log('stop', `system ${why}`);
      };
      try { powerMonitor.on('shutdown', () => allow('shutdown')); } catch { /* not on this platform */ }
      try { powerMonitor.on('suspend', () => log('power', 'the computer is going to sleep')); } catch { /* ignore */ }
      try { powerMonitor.on('resume', () => log('power', 'the computer woke up')); } catch { /* ignore */ }
    }
    timer = setIntervalFn(checkHeartbeat, 2000);
    coreTimer = setIntervalFn(() => { void checkCore(); }, 5000);
    timer?.unref?.();
    coreTimer?.unref?.();
    if (!isPowerBlockerActive()) log('warning', 'sleep prevention is not active');
    return true;
  }

  function stopMonitors() {
    if (timer) clearIntervalFn(timer);
    if (coreTimer) clearIntervalFn(coreTimer);
    timer = null;
    coreTimer = null;
  }

  /** Leave install mode for this session (key combo or Settings). */
  function pause(how = 'settings') {
    if (paused) return false;
    paused = true;
    stopMonitors();
    stopGuardian();
    try { globalShortcut?.unregister(EXIT_ACCELERATOR); } catch { /* ignore */ }
    log('stop', `install mode left for this session (${how})`);
    for (const w of getOutputWindows()) setCursor(w, true);
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      try { win.webContents.send('install-mode-paused', { how }); } catch { /* ignore */ }
      try { win.show(); win.focus(); } catch { /* ignore */ }
    }
    return true;
  }

  // ── Quit ────────────────────────────────────────────────────────────
  /** From before-quit. True: the quit is held. */
  function holdQuit() {
    if (!active() || quitAllowed) return false;
    const mode = config().quitProtection === 'combo' ? 'combo' : 'confirm';
    if (mode === 'combo') {
      log('quit', 'quit refused: leave install mode with the key combo first');
      const win = getMainWindow();
      try { win?.webContents.send('install-mode-quit-refused', { accelerator: EXIT_ACCELERATOR }); } catch { /* ignore */ }
      return true;
    }
    if (quitDialogOpen) return true;
    if (!dialog) return false;
    quitDialogOpen = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    // Nobody answers on an unattended machine: the question goes away.
    const cancelTimer = controller ? setTimeout(() => controller.abort(), 20_000) : null;
    const win = getMainWindow();
    const opts = {
      type: 'warning',
      buttons: ['Keep running', 'Quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'Install mode',
      message: 'Stop the installation and quit?',
      detail: 'Install mode is on. The show stops and the outputs close.',
      ...(controller ? { signal: controller.signal } : {}),
    };
    const shown = win && !win.isDestroyed() ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts);
    Promise.resolve(shown).then((r) => {
      if (r && r.response === 1) {
        log('stop', 'quit confirmed');
        quitAllowed = true;
        stopGuardian();
        app.quit();
      } else {
        log('quit', 'quit cancelled');
      }
    }).catch(() => { /* aborted: keep running */ }).finally(() => {
      quitDialogOpen = false;
      if (cancelTimer) clearTimeout(cancelTimer);
    });
    return true;
  }

  /** The app is going away on purpose. */
  function markCleanExit() {
    stopMonitors();
    if (started) {
      stopGuardian();
      log('stop', 'app quit');
    }
  }

  // ── Renderer events ─────────────────────────────────────────────────
  function heartbeat(payload) {
    lastHeartbeatAt = now();
    lastHeartbeat = payload && typeof payload === 'object' ? { ...payload, at: lastHeartbeatAt } : { at: lastHeartbeatAt };
    const a = payload && payload.anchor;
    if (a && typeof a === 'object' && Number.isFinite(a.anchorMs)) {
      const prev = state.anchor;
      const changed = !prev || prev.periodKey !== a.periodKey || prev.projectPath !== a.projectPath
        || prev.playlistIndex !== a.playlistIndex || Math.abs((prev.anchorMs || 0) - a.anchorMs) > 2000;
      if (changed) saveState({ anchor: { anchorMs: a.anchorMs, periodKey: String(a.periodKey || ''), projectPath: String(a.projectPath || ''), playlistIndex: Number.isInteger(a.playlistIndex) ? a.playlistIndex : undefined } });
    }
    return { ok: true, active: active() };
  }

  /** The editor page finished loading (first time or after a reload). */
  function pageLoaded() {
    pageLoadedAt = now();
    lastHeartbeatAt = 0;
  }

  /** From render-process-gone. True when install mode handles recovery. */
  function rendererGone(details) {
    if (!active() || config().watchdog === false) return false;
    lastHeartbeatAt = 0;
    pageLoadedAt = 0;
    const reason = `the editor crashed (${details && details.reason}, exit code ${details && details.exitCode})`;
    const d = fault('renderer-crash', reason);
    return !!d;
  }

  function ownsRendererRecovery() {
    return active() && config().watchdog !== false;
  }

  // ── Output windows ──────────────────────────────────────────────────
  function setCursor(win, show) {
    try {
      if (!win || win.isDestroyed()) return;
      const wc = win.webContents;
      if (show) {
        if (win.__gaCursorKey) { wc.removeInsertedCSS(win.__gaCursorKey).catch?.(() => {}); win.__gaCursorKey = null; }
      } else if (!win.__gaCursorKey) {
        Promise.resolve(wc.insertCSS('html, body, * { cursor: none !important; }')).then((key) => { win.__gaCursorKey = key; }).catch(() => {});
      }
    } catch { /* window going away */ }
  }

  /** Call for every output window once its page has loaded. */
  function outputWindowLoaded(win) {
    if (active() && config().hideCursor !== false) setCursor(win, false);
  }

  function anchor() {
    return state.anchor || null;
  }

  function status() {
    const cfg = config();
    let loginItem = null;
    try { loginItem = showStartup.get().loginItem; } catch { /* ignore */ }
    return {
      active: active(),
      paused,
      configured: !!cfg.showMode,
      startedAt,
      uptimeMs: now() - startedAt,
      exitAccelerator: EXIT_ACCELERATOR,
      powerBlocker: !!isPowerBlockerActive(),
      guardian: guardianPid ? { pid: guardianPid, alive: processAlive(guardianPid) } : null,
      loginItem,
      heartbeat: lastHeartbeat,
      core: lastCore,
      restarts: {
        coreKills: state.history.coreKills.length,
        reloads: state.history.reloads.length,
        relaunches: state.history.relaunches.length,
        last: state.history.lastActionAt || null,
      },
      anchor: anchor(),
      logFile: health.file,
      recent: health.recent(25),
    };
  }

  return {
    EXIT_ACCELERATOR,
    stateFile,
    logFile: health.file,
    active,
    start,
    pause,
    holdQuit,
    markCleanExit,
    heartbeat,
    pageLoaded,
    rendererGone,
    ownsRendererRecovery,
    outputWindowLoaded,
    setCursor,
    anchor,
    status,
    log,
    fault,
    // for tests
    _checkHeartbeat: checkHeartbeat,
    _checkCore: checkCore,
  };
}

module.exports = { createInstallMode, EXIT_ACCELERATOR };
