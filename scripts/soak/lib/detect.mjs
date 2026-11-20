// Turns a session's samples, incidents and action trace into findings, each
// checked against the thresholds in soak.config.json. A finding with
// severity 'fail' makes the run fail (non-zero exit).

/** Least-squares slope of y over x, plus r². */
export function regression(points) {
  const n = points.length;
  if (n < 2) return { slope: 0, r2: 0, n };
  let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
  for (const [x, y] of points) { sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y; }
  const den = n * sxx - sx * sx;
  if (!den) return { slope: 0, r2: 0, n };
  const slope = (n * sxy - sx * sy) / den;
  const r = (n * sxy - sx * sy) / Math.sqrt(den * (n * syy - sy * sy) || 1);
  return { slope, r2: r * r, n };
}

export function median(xs) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function percentile(xs, p) {
  const v = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

/** An error message with numbers, ids and paths taken out, for grouping. */
export function errorKey(text) {
  return String(text)
    .split('\n')[0]
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/(file|ghost-asset|https?):\/\/\S+/g, '<url>')
    .replace(/(\/[\w .-]+){2,}/g, '<path>')
    .replace(/\b0x[0-9a-f]+\b/gi, '<hex>')
    .replace(/\d+(\.\d+)?/g, '#')
    .slice(0, 220);
}

const H = 3600000;

export function analyse({ samples, baselines, incidents, trace, console: consoleLog, config, durationMs, hidden }) {
  const findings = [];
  const add = (f) => findings.push({ severity: 'fail', ...f });
  const th = config.thresholds;
  const hours = Math.max(durationMs / H, 1e-6);

  // ── Stability ──
  const count = (kinds) => incidents.filter((i) => kinds.includes(i.kind)).length;
  const crashes = count(['crash']);
  const hangs = count(['hang']);
  const rendererCrashes = count(['renderer-crash', 'editor-reload']);
  const coreRestarts = count(['core-restart']);
  const startFails = count(['launch-failed']);
  const stab = [
    ['crashes', 'App crashes (process exited)', crashes, th.maxCrashes],
    ['hangs', 'App hangs (no heartbeat)', hangs, th.maxHangs],
    ['renderer', 'Editor crashes or recovery reloads', rendererCrashes, th.maxRendererCrashes],
    ['core', 'Render core restarts', coreRestarts, th.maxCoreRestarts],
    ['launch', 'Failed launches', startFails, th.maxLaunchFailures],
  ];
  for (const [id, title, value, max] of stab) {
    add({ id: `stability.${id}`, area: 'stability', title, value, threshold: `≤ ${max}`, severity: value > max ? 'fail' : 'pass' });
  }

  // ── Memory growth: at checkpoints (same state, after GC) ──
  const leak = th.leakMBPerHour;
  const spanH = baselines.length > 1 ? (baselines[baselines.length - 1].t - baselines[0].t) / H : 0;
  const enough = baselines.length >= th.minCheckpointsForLeak && spanH >= th.minHoursForLeak;
  // Per process: the physical footprint where the run measured it (macOS
  // checkpoints, from vmmap), else resident memory. Resident memory on macOS
  // also counts clean pages of shared code and pages the allocator has freed
  // but the system has not taken back yet, both of which grow with use and
  // are not a leak; and it leaves out GPU memory the process owns. The
  // footprint is what the system charges the process (Activity Monitor's
  // Memory), so the leak checks use it, and resident memory is shown for reading.
  const ROLES = [['main', 'main', leak.main], ['renderer', 'renderer', leak.renderer], ['gpu', 'gpu', leak.gpu], ['core', 'core', leak.core]];
  const hasFootprint = (role) => baselines.length > 0 && baselines.every((b) => Number.isFinite(b.vm?.[role]?.footprintMB));
  const series = {};
  const limits = {};
  for (const [label, role, limit] of ROLES) {
    const fp = hasFootprint(role);
    series[`${label} MB`] = { get: fp ? (b) => b.vm?.[role]?.footprintMB : (b) => b.proc?.roles?.[role]?.rssMB, kind: fp ? 'footprint' : 'resident' };
    limits[`${label} MB`] = limit;
    if (fp) { series[`${label} resident MB`] = { get: (b) => b.proc?.roles?.[role]?.rssMB, kind: 'resident', info: true }; limits[`${label} resident MB`] = limit; }
  }
  series['JS heap MB'] = { get: (b) => b.renderer?.heapMB, kind: 'heap' };
  limits['JS heap MB'] = leak.jsHeap;
  const allFootprint = ROLES.every(([, role]) => hasFootprint(role));
  series['total MB'] = allFootprint
    ? { get: (b) => ROLES.reduce((sum, [, role]) => sum + b.vm[role].footprintMB, 0), kind: 'footprint of main, editor, GPU and core' }
    : { get: (b) => b.proc?.totalMB, kind: 'resident' };
  limits['total MB'] = leak.total;
  // Warm-up: the first use of a feature allocates once what it then keeps for
  // the session (Audio Lab's audio graph, the deck's interface, compiled
  // pipelines, decoder pre-rolls, GPU tiles), so memory climbs steeply in the
  // first minutes whatever the build. The leak checks fit only the checkpoints
  // from `leakWarmupMinutes` after the app started; the whole-run slope is
  // shown for reading.
  const warmupMs = (th.leakWarmupMinutes ?? 0) * 60000;
  const fit = (points) => {
    const reg = regression(points);
    const growth = points.length > 1 ? points[points.length - 1][1] - points[0][1] : 0;
    const spanH = points.length > 1 ? points[points.length - 1][0] - points[0][0] : 0;
    return { reg, growth, spanH, n: points.length };
  };
  const describe = (f) => (f.n > 1 ? `${f.reg.slope.toFixed(1)} MB/h (r² ${f.reg.r2.toFixed(2)}, +${f.growth.toFixed(0)} MB over ${f.n} checkpoints)` : 'not enough checkpoints');
  for (const [name, { get, kind, info }] of Object.entries(series)) {
    // Only checkpoints within one app run compare like with like.
    const byRun = new Map();
    for (const b of baselines) { const v = get(b); if (Number.isFinite(v)) (byRun.get(b.run) ?? byRun.set(b.run, []).get(b.run)).push({ x: b.t / H, v, since: b.sinceLaunchMs ?? Infinity }); }
    const longest = [...byRun.values()].sort((a, b) => b.length - a.length)[0] ?? [];
    const whole = fit(longest.map((p) => [p.x, p.v]));
    const steady = fit(longest.filter((p) => p.since >= warmupMs).map((p) => [p.x, p.v]));
    const limit = limits[name];
    const judged = steady.n >= th.minCheckpointsForLeak && steady.spanH >= th.minHoursForLeak;
    const over = enough && judged && steady.reg.slope > limit && steady.reg.r2 > 0.5;
    add({
      id: `memory.${name.replace(/ /g, '-')}`, area: 'memory',
      title: `${name} growth at checkpoints after ${th.leakWarmupMinutes ?? 0} min warm-up (${kind}${info ? ', for reading' : ''})`,
      value: judged ? describe(steady) : `not enough checkpoints after warm-up (${steady.n})`,
      threshold: info ? 'for reading' : `≤ ${limit} MB/h`,
      severity: info || !enough || !judged ? 'info' : over ? 'fail' : 'pass',
    });
    if (warmupMs > 0) {
      add({ id: `memory.${name.replace(/ /g, '-')}-whole-run`, area: 'memory', title: `${name} growth over the whole run, warm-up included (${kind}, for reading)`, value: describe(whole), threshold: 'for reading', severity: 'info' });
    }
  }
  // The same warm-up: the first time the deck or a studio opens, the editor
  // keeps some of its interface for the session.
  for (const [name, key, limit] of [['DOM nodes', 'nodes', th.domNodesPerHour], ['Event listeners', 'listeners', th.listenersPerHour]]) {
    const all = baselines.filter((b) => Number.isFinite(b.renderer?.[key]));
    const show = (pts) => { const reg = regression(pts); return { reg, text: pts.length > 1 ? `${reg.slope.toFixed(0)}/h (r² ${reg.r2.toFixed(2)}, ${pts.length} checkpoints)` : 'not enough checkpoints' }; };
    const steadyPts = all.filter((b) => (b.sinceLaunchMs ?? Infinity) >= warmupMs).map((b) => [b.t / H, b.renderer[key]]);
    const steady = show(steadyPts);
    const span = steadyPts.length > 1 ? steadyPts[steadyPts.length - 1][0] - steadyPts[0][0] : 0;
    const judged = steadyPts.length >= th.minCheckpointsForLeak && span >= th.minHoursForLeak;
    add({ id: `memory.${key}`, area: 'memory', title: `${name} growth at checkpoints after ${th.leakWarmupMinutes ?? 0} min warm-up`, value: judged ? steady.text : `not enough checkpoints after warm-up (${steadyPts.length})`, threshold: `≤ ${limit}/h`, severity: !enough || !judged ? 'info' : steady.reg.slope > limit && steady.reg.r2 > 0.5 ? 'fail' : 'pass' });
    if (warmupMs > 0) add({ id: `memory.${key}-whole-run`, area: 'memory', title: `${name} growth over the whole run, warm-up included (for reading)`, value: show(all.map((b) => [b.t / H, b.renderer[key]])).text, threshold: 'for reading', severity: 'info' });
  }

  // ── Performance: first vs last fifth of the run ──
  const steady = samples.filter((s) => s.sinceLaunchMs > 60000);
  const fifth = Math.max(1, Math.floor(steady.length / 5));
  const head = steady.slice(0, fifth); const tail = steady.slice(-fifth);
  const cmp = (get, label, maxDrop, severityIfOver = 'fail') => {
    const a = median(head.map(get)); const b = median(tail.map(get));
    if (a === null || b === null || steady.length < 10) { add({ id: `performance.${label}`, area: 'performance', title: label, value: 'not enough samples', threshold: '', severity: 'info' }); return; }
    const drop = a > 0 ? (a - b) / a : 0;
    add({ id: `performance.${label}`, area: 'performance', title: `${label}: first fifth vs last fifth (median)`, value: `${a.toFixed(1)} → ${b.toFixed(1)} (${(drop * 100).toFixed(0)}% lower)`, threshold: `drop ≤ ${(maxDrop * 100).toFixed(0)}%`, severity: drop > maxDrop ? severityIfOver : 'pass' });
  };
  // What is on screen changes all the time (random shaders, worlds, shows), so
  // over-the-run numbers are for reading; the pass/fail ones are measured on
  // the same blank project at every checkpoint.
  cmp((s) => s.core?.fps, 'Render core fps over the run', th.maxFpsDrop, 'warn');
  cmp((s) => s.editorFps, 'Editor fps over the run', th.maxFpsDrop, 'warn');
  const cps = baselines.filter((b) => Number.isFinite(b.refFps) && b.sinceLaunchMs > 60000);
  if (cps.length >= 2) {
    const half = Math.max(1, Math.floor(cps.length / 2));
    const a = median(cps.slice(0, half).map((b) => b.refFps)); const b = median(cps.slice(-half).map((b) => b.refFps));
    const drop = a > 0 ? (a - b) / a : 0;
    add({ id: 'performance.blank-fps-drop', area: 'performance', title: 'Render core fps in the reference scene: early vs late checkpoints', value: `${a.toFixed(1)} → ${b.toFixed(1)}`, threshold: `drop ≤ ${(th.maxFpsDrop * 100).toFixed(0)}%`, severity: drop > th.maxFpsDrop ? 'fail' : 'pass' });
    const ga = median(cps.slice(0, half).map((x) => x.refGpuMs)); const gb = median(cps.slice(-half).map((x) => x.refGpuMs));
    if (ga !== null && gb !== null) add({ id: 'performance.blank-gpu-ms', area: 'performance', title: 'GPU ms per frame in the reference scene: early vs late checkpoints', value: `${ga.toFixed(2)} → ${gb.toFixed(2)} ms`, threshold: `rise ≤ ${(th.maxGpuMsRise * 100).toFixed(0)}% (or under 4 ms)`, severity: ga > 0 && (gb - ga) / ga > th.maxGpuMsRise && gb > 4 ? 'fail' : 'pass' });
  }
  const blankMed = median(baselines.map((b) => b.refFps));
  if (blankMed !== null) add({ id: 'performance.blank-fps', area: 'performance', title: 'Render core fps in the reference scene (median of checkpoints)', value: blankMed.toFixed(1), threshold: `≥ ${th.minCoreFpsMedian}`, severity: blankMed < th.minCoreFpsMedian ? 'fail' : 'pass' });
  const slow = steady.filter((s) => Number.isFinite(s.core?.fps) && s.core.fps < 20);
  if (steady.length) add({ id: 'performance.slow-samples', area: 'performance', title: 'Samples with the render core under 20 fps (heavy content)', value: `${slow.length} of ${steady.length}${slow.length ? ` (worst ${Math.min(...slow.map((s) => s.core.fps)).toFixed(1)} fps at step ${slow.sort((x, y) => x.core.fps - y.core.fps)[0].step})` : ''}`, threshold: 'for reading', severity: 'info' });
  const dropped = samples.reduce((s, x) => s + (x.deltas?.droppedFrames ?? 0), 0);
  add({ id: 'performance.dropped', area: 'performance', title: 'Dropped frames (GPU back-pressure skips + dropped commands + dropped decodes)', value: `${dropped} (${(dropped / hours).toFixed(0)}/h)`, threshold: `≤ ${th.maxDroppedFramesPerHour}/h`, severity: dropped / hours > th.maxDroppedFramesPerHour ? 'warn' : 'pass' });
  const gaps = samples.reduce((s, x) => s + (x.deltas?.audioUnderflows ?? 0), 0);
  add({ id: 'performance.audio-gaps', area: 'performance', title: 'Clip audio gaps (underflow events)', value: `${gaps} (${(gaps / hours).toFixed(1)}/h)`, threshold: `≤ ${th.maxAudioGapsPerHour}/h`, severity: gaps / hours > th.maxAudioGapsPerHour ? 'fail' : 'pass' });

  // Store publish rates (no store should be republishing many times a second while idle).
  const pub = {};
  for (const s of samples) for (const [k, v] of Object.entries(s.publish ?? {})) (pub[k] ??= []).push(v);
  for (const [k, vs] of Object.entries(pub)) {
    const p95 = percentile(vs, 95);
    add({ id: `performance.publish.${k}`, area: 'performance', title: `Store "${k}" updates per second (95th percentile)`, value: p95?.toFixed(1), threshold: `≤ ${th.maxStorePublishPerSec}/s`, severity: p95 > th.maxStorePublishPerSec ? 'warn' : 'pass' });
  }

  // ── Errors ──
  const allowed = (config.ignoreErrors ?? []).map((r) => new RegExp(r, 'i'));
  const errs = consoleLog.filter((c) => (c.level === 'error' || c.level === 'exception') && !allowed.some((r) => r.test(c.text)));
  add({ id: 'errors.rate', area: 'errors', title: 'Console errors and uncaught exceptions', value: `${errs.length} (${(errs.length / hours).toFixed(0)}/h)`, threshold: `≤ ${th.maxErrorsPerHour}/h`, severity: errs.length / hours > th.maxErrorsPerHour ? 'fail' : 'pass' });
  const exceptions = errs.filter((c) => c.level === 'exception').length;
  add({ id: 'errors.exceptions', area: 'errors', title: 'Uncaught exceptions', value: exceptions, threshold: `≤ ${th.maxExceptions}`, severity: exceptions > th.maxExceptions ? 'fail' : 'pass' });
  let spike = 0;
  const win = th.errorSpikeWindowSec * 1000;
  for (let i = 0, j = 0; i < errs.length; i++) {
    while (errs[i].t - errs[j].t > win) j++;
    spike = Math.max(spike, i - j + 1);
  }
  add({ id: 'errors.spike', area: 'errors', title: `Most errors in any ${th.errorSpikeWindowSec}s`, value: spike, threshold: `≤ ${th.maxErrorSpike}`, severity: spike > th.maxErrorSpike ? 'fail' : 'pass' });
  const groups = new Map();
  for (const c of errs) {
    const k = errorKey(c.text);
    const g = groups.get(k) ?? { key: k, count: 0, first: c.t, example: c.text.slice(0, 400), level: c.level, steps: new Set() };
    g.count++; if (c.step != null) g.steps.add(c.step);
    groups.set(k, g);
  }
  const topErrors = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 25).map((g) => ({ ...g, steps: [...g.steps].slice(0, 8) }));

  // ── Disk ──
  const tmp = samples.map((s) => s.temp?.tmpMB).filter(Number.isFinite);
  if (tmp.length > 2) {
    const growth = tmp[tmp.length - 1] - Math.min(...tmp.slice(0, Math.max(1, Math.floor(tmp.length / 10))));
    add({ id: 'disk.temp', area: 'disk', title: 'Temp folder growth (start → end)', value: `${growth.toFixed(0)} MB (end ${tmp[tmp.length - 1].toFixed(0)} MB)`, threshold: `≤ ${th.maxTempGrowthMB} MB`, severity: growth > th.maxTempGrowthMB ? 'fail' : 'pass' });
    const pts = samples.filter((s) => Number.isFinite(s.temp?.tmpMB)).map((s) => [s.t / H, s.temp.tmpMB]);
    const reg = regression(pts);
    add({ id: 'disk.temp-slope', area: 'disk', title: 'Temp folder growth rate', value: `${reg.slope.toFixed(0)} MB/h (r² ${reg.r2.toFixed(2)})`, threshold: `≤ ${th.maxTempMBPerHour} MB/h`, severity: reg.slope > th.maxTempMBPerHour && reg.r2 > 0.5 ? 'fail' : 'pass' });
  }
  const prof = samples.map((s) => s.temp?.profileMB).filter(Number.isFinite);
  if (prof.length > 2) {
    const growth = prof[prof.length - 1] - prof[0];
    add({ id: 'disk.profile', area: 'disk', title: 'Profile folder growth (one app run)', value: `${growth.toFixed(0)} MB`, threshold: `≤ ${th.maxProfileGrowthMB} MB`, severity: growth > th.maxProfileGrowthMB ? 'warn' : 'pass' });
  }

  // ── Areas (actions) ──
  const areas = {};
  for (const e of trace) {
    if (e.kind !== 'action') continue;
    const a = (areas[e.area] ??= { area: e.area, runs: 0, passed: 0, failed: 0, skipped: 0, warnings: 0, ms: 0, failures: [] });
    a.runs++;
    a.ms += e.ms ?? 0;
    if (e.status === 'pass') a.passed++;
    else if (e.status === 'skip') a.skipped++;
    else { a.failed++; a.failures.push(e); }
    a.warnings += (e.warnings ?? []).length;
  }
  for (const a of Object.values(areas)) {
    const ran = a.runs - a.skipped;
    a.failRate = ran ? a.failed / ran : 0;
    const limit = th.maxAreaFailureRate[a.area] ?? th.maxAreaFailureRate.default;
    a.threshold = limit;
    a.status = a.failRate > limit ? 'fail' : a.failed ? 'warn' : ran ? 'pass' : 'not run';
    add({ id: `area.${a.area}`, area: a.area, title: `${a.area}: ${a.failed} of ${ran} actions failed`, value: `${(a.failRate * 100).toFixed(1)}%`, threshold: `≤ ${(limit * 100).toFixed(0)}%`, severity: a.status === 'fail' ? 'fail' : a.status === 'warn' ? 'warn' : 'pass' });
  }

  const failed = findings.filter((f) => f.severity === 'fail');
  return { findings, areas, topErrors, pass: failed.length === 0, failedCount: failed.length };
}
