'use strict';

/**
 * Install mode guardian: a tiny separate process that starts the app again
 * if it disappears without quitting properly (a crash of the main process,
 * the system killing it for memory, a fatal GPU fault).
 *
 * The app starts it with its own executable in Node mode
 * (ELECTRON_RUN_AS_NODE=1). The app copies this file out to its data folder
 * first, so it never has to be read from inside the packaged archive; for
 * that reason it requires nothing but Node's own modules.
 *
 * It watches the app's process id every two seconds. When the process is
 * gone it reads the install state file:
 *   - cleanExit true (the app quit on purpose, install mode was left, the
 *     computer is shutting down): it exits too.
 *   - otherwise it starts the app with the same arguments, unless it already
 *     did so `maxRelaunches` times in the last hour; then it waits until the
 *     oldest of those is an hour old, so a crash loop cannot spin.
 * The new app starts its own guardian; this one exits.
 *
 * Config comes in GA_GUARDIAN_CONFIG (JSON): pid, stateFile, logFile,
 * command, args, cwd, maxRelaunches, windowMs, delayMs.
 */

const fs = require('fs');
const { spawn } = require('child_process');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function writeJson(file, data) {
  try {
    const tmp = `${file}.guardian.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
    fs.renameSync(tmp, file);
  } catch { /* the relaunch matters more than the bookkeeping */ }
}

function pad(n) { return String(n).padStart(2, '0'); }
function stamp(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${off >= 0 ? '+' : '-'}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!(err && err.code === 'EPERM');
  }
}

/** Pure: what to do once the app is gone. */
function guardianDecision(state, now, { maxRelaunches = 5, windowMs = 60 * 60_000 } = {}) {
  if (state && state.cleanExit === true) return { action: 'exit', reason: 'the app quit normally' };
  const history = state && state.history && Array.isArray(state.history.relaunches) ? state.history.relaunches : [];
  const recent = history.filter((t) => Number.isFinite(t) && t <= now && now - t < windowMs);
  // The app asked for this relaunch itself (its watchdog already counted it).
  if (state && state.relaunchRequested === true) return { action: 'relaunch', recent, requested: true };
  if (recent.length >= maxRelaunches) {
    return { action: 'wait', retryAt: Math.min(...recent) + windowMs, reason: `${recent.length} relaunches in the last hour` };
  }
  return { action: 'relaunch', recent };
}

function run() {
  let cfg;
  try { cfg = JSON.parse(process.env.GA_GUARDIAN_CONFIG || ''); } catch { return; }
  if (!cfg || !Number.isInteger(cfg.pid) || !cfg.command) return;
  const log = (kind, message) => {
    if (!cfg.logFile) return;
    try { fs.appendFileSync(cfg.logFile, `${stamp(Date.now())}  ${kind.padEnd(9)} ${message}\n`); } catch { /* ignore */ }
  };
  const tick = () => {
    if (alive(cfg.pid)) return;
    const state = readJson(cfg.stateFile) || {};
    // A newer guardian owns the app now (the app relaunched itself).
    if (state.guardianPid && state.guardianPid !== process.pid) { clearInterval(timer); return; }
    const now = Date.now();
    const d = guardianDecision(state, now, cfg);
    if (d.action === 'exit') { clearInterval(timer); return; }
    if (d.action === 'wait') {
      if (!state.guardianWaitLogged) {
        log('guardian', `the app is gone and ${d.reason}; next try at ${stamp(d.retryAt)}`);
        writeJson(cfg.stateFile, { ...state, guardianWaitLogged: true });
      }
      return;
    }
    clearInterval(timer);
    const history = { ...(state.history || {}), relaunches: d.requested ? d.recent : [...d.recent, now] };
    writeJson(cfg.stateFile, { ...state, history, guardianWaitLogged: false, cleanExit: false, relaunchRequested: false });
    log('guardian', d.requested
      ? `starting the app again (pid ${cfg.pid} asked for a relaunch)`
      : `the app (pid ${cfg.pid}) stopped without quitting; starting it again`);
    setTimeout(() => {
      try {
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        delete env.GA_GUARDIAN_CONFIG;
        const child = spawn(cfg.command, Array.isArray(cfg.args) ? cfg.args : [], {
          cwd: cfg.cwd || undefined,
          env,
          detached: true,
          stdio: 'ignore',
          windowsHide: false,
        });
        child.on('error', (err) => log('guardian', `relaunch failed: ${err && err.message}`));
        child.unref();
      } catch (err) {
        log('guardian', `relaunch failed: ${err && err.message}`);
      }
      setTimeout(() => process.exit(0), 1000);
    }, Number.isFinite(cfg.delayMs) ? cfg.delayMs : 3000);
  };
  const timer = setInterval(tick, 2000);
}

if (require.main === module) run();

module.exports = { guardianDecision };
