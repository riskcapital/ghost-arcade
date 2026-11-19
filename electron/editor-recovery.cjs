'use strict';

/**
 * Recovery for the editor window's page (its renderer process).
 *
 * One explicit state per window:
 *
 *   healthy ──unresponsive──▶ unresponsive (grace timer)
 *      ▲                        │ responsive / navigation: back to healthy
 *      │                        │ grace over: reload (attempt n)
 *      │ loaded                 ▼
 *      └──────────────────── recovering (attempt n) ◀── crashed (any state)
 *                               │ attempts used up
 *                               ▼
 *                            exhausted ── retry / navigation / responsive ──▶
 *
 *   closed: the window is gone; every later event is ignored.
 *
 * Attempts count until the page has stayed healthy for `stableMs` after a
 * recovery, so a page that keeps crashing or hanging ends in `exhausted`
 * instead of reloading forever. Only one timer is ever pending, and leaving
 * the state that set it clears it: a page that answers again is never
 * reloaded later by a timer from its hang.
 *
 * Electron-free and timer-injectable, so every transition is tested
 * (src/lib/utils/editorRecovery.test.ts).
 */

const REASON_WORDS = {
  crashed: 'the editor crashed',
  oom: 'the editor ran out of memory',
  'memory-eviction': 'the system took the editor\'s memory back',
  killed: 'the editor was stopped by the system or another program',
  'launch-failed': 'the editor could not start',
  'integrity-failure': 'the editor failed a code integrity check',
  'abnormal-exit': 'the editor closed unexpectedly',
  'clean-exit': 'the editor closed',
  hang: 'the editor stopped responding',
};

/** Plain words for a render-process-gone reason (or 'hang'). */
function describeReason(reason) {
  return REASON_WORDS[reason] || `the editor stopped (${reason || 'unknown reason'})`;
}

/**
 * @param {{
 *   reload: () => void,
 *   canReload?: () => boolean,
 *   onExhausted?: (info: { cause: string, reason: string, exitCode: number | null, attempts: number }) => (void | (() => void)),
 *   diagnostics?: () => string,
 *   log?: { info?: (m: string) => void, warn?: (m: string) => void, error?: (m: string) => void },
 *   flush?: () => void,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (t: any) => void,
 *   graceMs?: number,
 *   maxAttempts?: number,
 *   stableMs?: number,
 *   reloadDelayMs?: number,
 * }} options
 */
function createEditorRecovery(options) {
  const {
    reload,
    canReload = () => true,
    onExhausted = () => {},
    diagnostics = () => '',
    flush = () => {},
    setTimer = (fn, ms) => setTimeout(fn, ms),
    clearTimer = (t) => clearTimeout(t),
    graceMs = 10_000,
    maxAttempts = 3,
    stableMs = 60_000,
    reloadDelayMs = 100,
  } = options;
  const log = {
    info: options.log?.info || (() => {}),
    warn: options.log?.warn || options.log?.info || (() => {}),
    error: options.log?.error || options.log?.warn || options.log?.info || (() => {}),
  };

  /** @type {{ kind: 'healthy', attempts: number } | { kind: 'unresponsive', attempts: number } | { kind: 'recovering', attempts: number, cause: string, reason: string } | { kind: 'exhausted', attempts: number, cause: string, reason: string } | { kind: 'closed' }} */
  let state = { kind: 'healthy', attempts: 0 };
  let timer = null;
  let dismissExhausted = null;

  function cancelTimer() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  function startTimer(ms, fn) {
    cancelTimer();
    const handle = setTimer(() => {
      if (timer !== handle) return;
      timer = null;
      fn();
    }, ms);
    timer = handle;
  }

  function leaveExhausted() {
    const dismiss = dismissExhausted;
    dismissExhausted = null;
    if (typeof dismiss === 'function') {
      try { dismiss(); } catch { /* the message may already be gone */ }
    }
  }

  function snapshot() {
    try { return diagnostics() || ''; } catch (err) { return `diagnostics failed: ${err?.message || err}`; }
  }

  function setHealthy(attempts) {
    state = { kind: 'healthy', attempts };
    if (attempts > 0) {
      startTimer(stableMs, () => {
        if (state.kind !== 'healthy') return;
        state = { kind: 'healthy', attempts: 0 };
        log.info(`[Recovery] editor has run for ${Math.round(stableMs / 1000)} s since it was recovered; recovery attempts reset`);
      });
    } else {
      cancelTimer();
    }
  }

  function exhaust(cause, reason, exitCode, attempts) {
    cancelTimer();
    state = { kind: 'exhausted', attempts, cause, reason };
    log.error(
      `[Recovery] GAVE UP after ${attempts} attempt(s): ${describeReason(cause === 'hang' ? 'hang' : reason)}`
      + ` (cause=${cause} reason=${reason} exitCode=${exitCode ?? 'n/a'}). The editor is left as it is and the user is asked what to do.`
      + ` ${snapshot()}`,
    );
    flush();
    try {
      const dismiss = onExhausted({ cause, reason, exitCode: exitCode ?? null, attempts });
      dismissExhausted = typeof dismiss === 'function' ? dismiss : null;
    } catch (err) {
      log.error(`[Recovery] could not show the recovery message: ${err?.message || err}`);
    }
  }

  function attempt(cause, reason, exitCode, attempts) {
    const n = attempts + 1;
    if (n > maxAttempts) {
      exhaust(cause, reason, exitCode, attempts);
      return;
    }
    state = { kind: 'recovering', attempts: n, cause, reason };
    log.warn(`[Recovery] reloading the editor, attempt ${n} of ${maxAttempts} (cause=${cause} reason=${reason} exitCode=${exitCode ?? 'n/a'})`);
    flush();
    // Never reload from inside the crash event itself: reloading a crashed
    // page synchronously in 'render-process-gone' takes the whole app down
    // (Electron aborts the main process). The next task is safe.
    startTimer(reloadDelayMs, () => {
      if (state.kind !== 'recovering') return;
      try {
        reload();
      } catch (err) {
        log.error(`[Recovery] reload failed: ${err?.message || err}`);
      }
    });
  }

  function onGraceOver() {
    if (state.kind !== 'unresponsive') return;
    const { attempts } = state;
    if (!canReload()) {
      // Crashed (its own event follows), loading a new page or gone: there is
      // nothing for a hang reload to do.
      log.info('[Recovery] editor still unresponsive, but it is crashed, loading or closed; not reloading for the hang');
      setHealthy(attempts);
      return;
    }
    log.warn(`[Recovery] editor still unresponsive after ${Math.round(graceMs / 1000)} s more. ${snapshot()}`);
    attempt('hang', 'hang', null, attempts);
  }

  return {
    /** Electron 'unresponsive': the page has not answered for a while. */
    unresponsive() {
      if (state.kind === 'healthy' || state.kind === 'recovering') {
        const { attempts } = state;
        state = { kind: 'unresponsive', attempts };
        log.warn(`[Recovery] editor unresponsive; waiting ${Math.round(graceMs / 1000)} s before reloading it. ${snapshot()}`);
        flush();
        startTimer(graceMs, onGraceOver);
      }
    },

    /** Electron 'responsive': the page answers again. */
    responsive() {
      if (state.kind === 'unresponsive') {
        log.info('[Recovery] editor responsive again; reload cancelled');
        setHealthy(state.attempts);
      } else if (state.kind === 'exhausted' && state.cause === 'hang') {
        log.info('[Recovery] editor responsive again after recovery gave up');
        leaveExhausted();
        setHealthy(0);
      }
    },

    /** Electron 'render-process-gone' for the editor's page. */
    gone(details) {
      if (state.kind === 'closed') return;
      const reason = String(details?.reason || 'unknown');
      const exitCode = typeof details?.exitCode === 'number' ? details.exitCode : null;
      if (state.kind === 'exhausted') {
        log.error(`[Recovery] editor gone again while recovery has given up (reason=${reason} exitCode=${exitCode ?? 'n/a'})`);
        state = { ...state, cause: 'crash', reason };
        return;
      }
      log.error(`[Recovery] editor process gone: ${describeReason(reason)} (reason=${reason} exitCode=${exitCode ?? 'n/a'}). ${snapshot()}`);
      attempt('crash', reason, exitCode, state.attempts);
    },

    /** Someone else (install mode) owns this failure's recovery. */
    handedOff(why) {
      if (state.kind === 'closed') return;
      cancelTimer();
      leaveExhausted();
      log.info(`[Recovery] ${why || 'another recovery'} handles this; editor recovery stands down`);
      state = { kind: 'healthy', attempts: state.attempts };
    },

    /** A new page starts loading in the editor (main frame, new document). */
    navigationStarted() {
      if (state.kind === 'unresponsive') {
        log.info('[Recovery] editor is loading a new page; pending reload cancelled');
        setHealthy(state.attempts);
      } else if (state.kind === 'exhausted') {
        // The user reloaded it themselves: a fresh set of attempts.
        log.info('[Recovery] editor reloaded by hand after recovery gave up');
        leaveExhausted();
        state = { kind: 'recovering', attempts: 0, cause: 'user', reason: 'user' };
      }
    },

    /** The editor's page finished loading. */
    loaded() {
      if (state.kind === 'recovering') {
        log.info(`[Recovery] editor loaded again after ${state.cause === 'user' ? 'a reload by hand' : `attempt ${state.attempts}`}`);
        setHealthy(state.attempts);
      }
    },

    /** The user chose to try again from the recovery message. */
    retry() {
      if (state.kind !== 'exhausted') return;
      leaveExhausted();
      log.info('[Recovery] user asked to reload the editor');
      attempt('user', 'user', null, 0);
    },

    /** The window closed: nothing may reload it any more. */
    closed() {
      cancelTimer();
      leaveExhausted();
      state = { kind: 'closed' };
    },

    /** The current state (a copy), for tests and diagnostics. */
    state() {
      return { ...state };
    },
  };
}

function hex4(n) {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? `0x${v.toString(16).padStart(4, '0')}` : '?';
}

function mb(kb) {
  const v = Number(kb);
  return Number.isFinite(v) ? `${Math.round(v / 1024)} MB` : '?';
}

/**
 * One line for the log with what support needs to tell a driver reset, a
 * two-GPU laptop or memory pressure apart. Every input is optional: a
 * missing piece reads "unknown" rather than failing.
 *
 * @param {{
 *   coreStatus?: any,      // the native broker's lastStatus
 *   gpuInfo?: any,         // app.getGPUInfo('basic')
 *   featureStatus?: any,   // app.getGPUFeatureStatus()
 *   systemMemory?: any,    // process.getSystemMemoryInfo() (KB)
 *   appMetrics?: any[],    // app.getAppMetrics()
 * }} input
 */
function formatRecoveryDiagnostics(input = {}) {
  const parts = [];
  const core = input.coreStatus;
  if (core && typeof core === 'object') {
    const caps = core.native_caps && typeof core.native_caps === 'object' ? core.native_caps : {};
    const name = core.adapter_name || caps.adapter_name || 'unknown';
    const driver = [caps.adapter_driver, caps.adapter_driver_info].filter(Boolean).join(' ') || 'unknown';
    let line = `core adapter="${name}" (${core.backend || '?'}, vendor=${hex4(caps.adapter_vendor)} device=${hex4(caps.adapter_device)}`;
    if (core.adapter_luid) line += ` luid=${core.adapter_luid}`;
    line += `) driver="${driver}" running=${!!core.running}`;
    if (core.adapter_is_software) line += ' SOFTWARE';
    if (core.core_exited_unexpectedly) line += ` core-exited code=${core.core_exit_code ?? '?'} signal=${core.core_exit_signal ?? '-'}`;
    if (core.last_frame_error) line += ` last-error="${String(core.last_frame_error).slice(0, 200)}"`;
    parts.push(line);
  } else {
    parts.push('core adapter=unknown');
  }
  const devices = Array.isArray(input.gpuInfo?.gpuDevice) ? input.gpuInfo.gpuDevice : [];
  if (devices.length) {
    parts.push(`chromium gpu=${devices.map((d) => `${d.active ? '*' : ''}${hex4(d.vendorId)}:${hex4(d.deviceId)}${d.driverVendor ? ` ${d.driverVendor}` : ''}${d.driverVersion ? ` driver ${d.driverVersion}` : ''}`).join(', ')}`);
  } else {
    parts.push('chromium gpu=unknown');
  }
  const fs = input.featureStatus;
  if (fs && typeof fs === 'object') {
    parts.push(`compositing=${fs.gpu_compositing || '?'} webgl=${fs.webgl || '?'}`);
  }
  const mem = input.systemMemory;
  if (mem && typeof mem === 'object') {
    parts.push(`memory free=${mb(mem.free)} of ${mb(mem.total)}`);
  }
  if (Array.isArray(input.appMetrics) && input.appMetrics.length) {
    let total = 0;
    const big = [];
    for (const m of input.appMetrics) {
      const kb = Number(m?.memory?.workingSetSize) || 0;
      total += kb;
      if (m?.type === 'GPU' || m?.type === 'Tab' || m?.type === 'Browser') big.push(`${m.type}=${mb(kb)}`);
    }
    parts.push(`app=${mb(total)} (${big.join(' ')})`);
  }
  return parts.join(' | ');
}

module.exports = { createEditorRecovery, describeReason, formatRecoveryDiagnostics };
