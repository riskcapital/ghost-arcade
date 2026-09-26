// Main-process event-loop lag probe (debug only, GA_MAIN_LAG_PROBE=1).
//
// Every main-process IPC call -- DMX and OSC input, MIDI routing, pixel-map
// and WLED output, recording -- waits behind whatever is holding the Electron
// main thread. A native presenter that blocks that thread (for example a
// CAMetalLayer nextDrawable wait while the editor window is covered) shows up
// here as lag long before anyone notices the symptom downstream.
//
// Two independent measures, because they fail differently:
//  - perf_hooks.monitorEventLoopDelay: libuv timer-based histogram (ns).
//  - a 10 ms setInterval drift sampler: how late each tick fired (ms), which
//    also catches a thread held inside a single native call.
//
// The probe is exposed as globalThis.__gaMainLagProbe so a test driver attached
// with --inspect can read and reset it and script window states.
import { monitorEventLoopDelay } from 'perf_hooks';

const DRIFT_INTERVAL_MS = 10;

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

export function startMainLagProbe({ logIntervalMs = 5000, extras = {} } = {}) {
  const histogram = monitorEventLoopDelay({ resolution: 5 });
  histogram.enable();
  let drift = [];
  let windowStartedAt = Date.now();
  let expected = performance.now() + DRIFT_INTERVAL_MS;
  const driftTimer = setInterval(() => {
    const now = performance.now();
    drift.push(Math.max(0, now - expected));
    expected = now + DRIFT_INTERVAL_MS;
    // Bound memory if nobody resets the window for a long time.
    if (drift.length > 200000) drift = drift.slice(-100000);
  }, DRIFT_INTERVAL_MS);
  driftTimer.unref?.();

  const snapshot = (reset = false) => {
    const sorted = drift.slice().sort((a, b) => a - b);
    const result = {
      seconds: (Date.now() - windowStartedAt) / 1000,
      drift: {
        samples: sorted.length,
        p50: percentile(sorted, 50),
        p99: percentile(sorted, 99),
        max: sorted.length ? sorted[sorted.length - 1] : 0,
        over50: sorted.filter(v => v > 50).length,
      },
      eventLoopDelay: {
        p50: histogram.percentile(50) / 1e6,
        p99: histogram.percentile(99) / 1e6,
        max: histogram.max / 1e6,
      },
    };
    if (reset) {
      drift = [];
      histogram.reset();
      windowStartedAt = Date.now();
    }
    return result;
  };

  const logTimer = logIntervalMs > 0
    ? setInterval(() => {
      const s = snapshot(false);
      console.log(
        `[MainLag] drift p50=${s.drift.p50.toFixed(1)}ms p99=${s.drift.p99.toFixed(1)}ms max=${s.drift.max.toFixed(1)}ms` +
        ` (>50ms: ${s.drift.over50}) | eld p99=${s.eventLoopDelay.p99.toFixed(1)}ms max=${s.eventLoopDelay.max.toFixed(1)}ms`
      );
    }, logIntervalMs)
    : null;
  logTimer?.unref?.();

  const probe = {
    snapshot,
    stop() {
      clearInterval(driftTimer);
      if (logTimer) clearInterval(logTimer);
      histogram.disable();
    },
    ...extras,
  };
  globalThis.__gaMainLagProbe = probe;
  console.log('[MainLag] probe enabled (GA_MAIN_LAG_PROBE=1)');
  return probe;
}
