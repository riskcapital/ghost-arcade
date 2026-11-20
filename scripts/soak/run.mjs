// Soak / stress test: runs Ghost Arcade for hours doing what users do, with
// seeded random actions that check themselves, telemetry every few seconds,
// crash and hang recovery, and an HTML + JSON report at the end.
//
//   npm run soak -- [--hours 4] [--app <packaged app>] [--seed N] [--areas a,b]
//   npm run soak:smoke                      (10 minutes, for development)
//   node scripts/soak/run.mjs --report-only <session folder>
//
// Everything is written to the session folder (default
// ~/.ghost-arcade/soak/<time>-seed<seed>/); docs/SOAK-TESTING.md explains it.
// Exit code: 0 passed, 1 a threshold was crossed, 2 the runner itself failed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeRng, randomSeed } from './lib/rng.mjs';
import { ensureDevServer, resolveTarget, launchApp, setWindowSize, debugLogPath } from './lib/app.mjs';
import { listTargets, waitForTarget, memoryInfraDump } from './lib/cdp.mjs';
import { sampleTree, folderSize, killTree, alive, vmSummary } from './lib/proc.mjs';
import { ACTIONS, AREAS, STATE_JS, MONKEY_DENY, PROFILES } from './lib/actions.mjs';
import { analyse } from './lib/detect.mjs';
import { writeReport } from './lib/report.mjs';
import { PAGE_HELPERS as SHOW_HELPERS, runAction as runShowAction } from '../show-runner/steps.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = JSON.stringify;
const IS_MAC = process.platform === 'darwin';

class Skip extends Error {}
class Assert extends Error {}

// ── Arguments ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const o = { hours: 4, app: null, seed: null, areas: null, exclude: [], only: null, out: null, port: 9420, devPort: 1430, config: path.join(here, 'soak.config.json'), hidden: false, steps: null, keepOpen: false, reportOnly: null, replay: null, label: '', heapSnapshots: false, profile: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const v = () => argv[++i];
    if (a === '--hours') o.hours = Number(v());
    else if (a === '--minutes') o.hours = Number(v()) / 60;
    else if (a === '--smoke') { o.hours = 10 / 60; o.label ||= 'smoke'; }
    else if (a === '--app') o.app = v();
    else if (a === '--seed') o.seed = Number(v());
    else if (a === '--areas') o.areas = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--exclude') o.exclude = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--only') o.only = v().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') o.out = v();
    else if (a === '--port') o.port = Number(v());
    else if (a === '--dev-port') o.devPort = Number(v());
    else if (a === '--config') o.config = v();
    else if (a === '--hidden') o.hidden = true;
    else if (a === '--visible') o.hidden = false;
    else if (a === '--steps') o.steps = Number(v());
    else if (a === '--keep-open') o.keepOpen = true;
    else if (a === '--heap-snapshots') o.heapSnapshots = true;
    else if (a === '--profile') o.profile = v();
    else if (a === '--label') o.label = v();
    else if (a === '--report-only') o.reportOnly = v();
    else if (a === '--replay') o.replay = v();
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 12).join('\n')); process.exit(0); }
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function loadConfig(file) {
  const base = JSON.parse(fs.readFileSync(path.join(here, 'soak.config.json'), 'utf8'));
  if (path.resolve(file) === path.join(here, 'soak.config.json')) return base;
  const over = JSON.parse(fs.readFileSync(file, 'utf8'));
  const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v; return a; };
  return merge(base, over);
}

function gitInfo() {
  try {
    const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).toString().trim();
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root }).toString().trim().length > 0;
    return { commit, branch, dirty };
  } catch { return { commit: 'unknown', branch: 'unknown', dirty: false }; }
}

async function portFree(port) {
  const net = await import('node:net');
  // Chromium's debug port listens on 127.0.0.1 only, which a listen on every
  // interface does not collide with on macOS: try both.
  const tryListen = (host) => new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.listen(port, host, () => s.close(() => resolve(true)));
  });
  return (await tryListen('127.0.0.1')) && (await tryListen(undefined));
}

const readJsonl = (file) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { return []; } };

/** The report from what is on disk, so a killed run still gets one. */
function buildReport(sessionDir, extraMeta = {}) {
  const meta = { ...JSON.parse(fs.readFileSync(path.join(sessionDir, 'meta.json'), 'utf8')), ...extraMeta };
  const config = meta.config;
  const rows = readJsonl(path.join(sessionDir, 'telemetry.jsonl'));
  const samples = rows.filter((r) => r.kind !== 'reference');
  const baselines = samples.filter((s) => s.checkpoint);
  // Each checkpoint's reference-scene frame rate is written just after it.
  for (const ref of rows.filter((r) => r.kind === 'reference')) {
    const b = [...baselines].reverse().find((x) => x.step === ref.step && x.run === ref.run);
    if (b) { b.refFps = ref.fps ?? null; b.refGpuMs = ref.gpuMs ?? null; b.refCpuMs = ref.cpuMs ?? null; }
  }
  const incidents = readJsonl(path.join(sessionDir, 'incidents.jsonl'));
  const trace = readJsonl(path.join(sessionDir, 'trace.jsonl'));
  const consoleLog = readJsonl(path.join(sessionDir, 'console.jsonl'));
  const screenshots = readJsonl(path.join(sessionDir, 'shots.jsonl'));
  const durationMs = meta.durationMs ?? Math.max(0, ...samples.map((s) => s.t), ...trace.map((e) => e.t));
  meta.durationMs = durationMs;
  meta.steps = meta.steps ?? trace.filter((e) => e.kind === 'action').length;
  const analysis = analyse({ samples, baselines, incidents, trace, console: consoleLog, config, durationMs, hidden: meta.hidden });
  // Child processes that died, found in the app's own debug logs.
  const gone = incidents.filter((i) => i.kind === 'child-gone').length;
  analysis.findings.push({ id: 'stability.child-gone', area: 'stability', title: 'GPU/utility processes that died (from the debug log)', value: gone, threshold: `≤ ${config.thresholds.maxChildProcessGone ?? 0}`, severity: gone > (config.thresholds.maxChildProcessGone ?? 0) ? 'fail' : 'pass' });
  analysis.pass = !analysis.findings.some((f) => f.severity === 'fail');
  analysis.failedCount = analysis.findings.filter((f) => f.severity === 'fail').length;
  meta.result = analysis.pass ? 'PASS' : 'FAIL';
  const file = writeReport(sessionDir, { meta, analysis, samples, baselines, incidents, trace, screenshots });
  return { file, analysis, meta };
}

// ── Main ────────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.reportOnly) {
    const { file, analysis } = buildReport(path.resolve(opts.reportOnly), { interrupted: 'report rebuilt from the session files' });
    console.log(`${analysis.pass ? 'PASS' : 'FAIL'}: ${file}`);
    process.exit(analysis.pass ? 0 : 1);
  }
  const config = loadConfig(opts.config);
  // --replay <session>: the same actions, in the same order, with the same
  // arguments as that run (its trace), whatever state the app is in.
  let replayPlan = null;
  if (opts.replay) {
    const dir = path.resolve(opts.replay);
    const old = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    opts.seed = old.seed;
    opts.profile ??= old.profile ?? null;
    replayPlan = readJsonl(path.join(dir, 'trace.jsonl')).filter((e) => ['action', 'rest', 'checkpoint'].includes(e.kind)).sort((a, b) => a.step - b.step);
    opts.label ||= 'replay';
    if (!Number.isFinite(opts.hours) || opts.hours === 4) opts.hours = 24;
  }
  // --profile <name>: a named kind of run (lib/actions.mjs PROFILES): its own
  // actions and weights, a set built once per launch, its own checkpoints.
  const profile = opts.profile ? PROFILES[opts.profile] : null;
  if (opts.profile && !profile) throw new Error(`unknown profile "${opts.profile}" (profiles: ${Object.keys(PROFILES).join(', ')})`);
  if (opts.profile) opts.label ||= opts.profile;
  const seed = Number.isFinite(opts.seed) ? opts.seed >>> 0 : randomSeed();
  const master = makeRng(seed);
  const areas = (opts.areas ?? AREAS).filter((a) => !opts.exclude.includes(a));
  for (const a of areas) if (!AREAS.includes(a)) throw new Error(`unknown area "${a}" (areas: ${AREAS.join(', ')})`);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const sessionDir = path.resolve(opts.out ?? path.join(os.homedir(), '.ghost-arcade', 'soak', `${stamp}-seed${seed}${opts.label ? `-${opts.label}` : ''}`));
  for (const d of ['logs', 'shots', 'renders']) fs.mkdirSync(path.join(sessionDir, d), { recursive: true });
  const files = Object.fromEntries(['trace', 'telemetry', 'console', 'incidents', 'shots'].map((k) => [k, fs.createWriteStream(path.join(sessionDir, `${k}.jsonl`), { flags: 'a' })]));
  const runnerLog = fs.createWriteStream(path.join(sessionDir, 'logs', 'runner.log'), { flags: 'a' });
  const startAt = Date.now();
  const T = () => Date.now() - startAt;
  const log = (m) => { const line = `[soak ${new Date().toISOString().slice(11, 19)}] ${m}`; console.log(line); runnerLog.write(line + '\n'); };
  const deadline = startAt + opts.hours * 3600000;

  for (const p of [opts.port, opts.port + 1, opts.port + 2]) {
    if (!(await portFree(p))) throw new Error(`port ${p} is in use (another app or soak run?). Pick other ports with --port / --dev-port.`);
  }
  const target = resolveTarget({ root, appPath: opts.app, sessionDir, log });
  const replayBase = (step) => `npm run soak -- --replay "${sessionDir}" --steps ${step} --keep-open${opts.app ? ` --app "${opts.app}"` : ''}   (or: ${seedReplay} --steps ${step} --keep-open)`;
  const seedReplay = ['npm run soak --', `--seed ${seed}`, opts.profile ? `--profile ${opts.profile}` : '', opts.areas || opts.exclude.length ? `--areas ${areas.join(',')}` : '', opts.only ? `--only ${opts.only.join(',')}` : '', opts.app ? `--app "${opts.app}"` : ''].filter(Boolean).join(' ');
  const meta = {
    startedAt: new Date(startAt).toISOString(), seed, hours: opts.hours, areas, only: opts.only, profile: opts.profile, app: opts.app ? path.resolve(opts.app) : 'source checkout',
    packaged: target.packaged, git: gitInfo(), hidden: opts.hidden, command: `node scripts/soak/run.mjs ${process.argv.slice(2).join(' ')}`.trim(), sessionDir,
    machine: { platform: `${process.platform} ${os.release()} ${os.arch()}`, cpu: os.cpus()[0]?.model ?? '', cores: os.cpus().length, memGB: Math.round(os.totalmem() / 1073741824) },
    config, appVersion: target.packaged ? target.version : JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  };
  const saveMeta = () => fs.writeFileSync(path.join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2));
  saveMeta();
  log(`session ${sessionDir}`);
  log(`seed ${seed}, ${opts.hours} h, areas ${areas.join(', ')}, app: ${target.label}`);

  const dev = target.packaged ? null : await ensureDevServer({ root, port: opts.devPort, sessionDir, log });

  // ── State ──
  const st = {
    run: 0, step: 0, handle: null, launches: 0, restarts: 0, stopReason: null, finishing: false,
    consoleCount: { error: 0, warning: 0, exception: 0 }, consoleSince: { error: 0, warning: 0, exception: 0 }, consoleLines: 0,
    lastErrors: [], missed: 0, hang: false, prevProc: null, prevStatus: null, lastShotAt: 0, busy: false, events: [],
    renders: [], incidentKeys: new Set(),
  };
  const incident = (kind, detail, extra = {}) => {
    const e = { t: T(), kind, detail, run: st.run, step: st.step, ...extra };
    files.incidents.write(J(e) + '\n');
    log(`INCIDENT ${kind}: ${detail}`);
    return e;
  };
  const ignore = (config.ignoreErrors ?? []).map((r) => new RegExp(r, 'i'));
  const onConsole = (c) => {
    if (st.consoleLines > 200000) return;
    st.consoleLines++;
    const e = { t: T(), run: st.run, step: st.step, level: c.level, text: String(c.text).slice(0, 2000) };
    files.console.write(J(e) + '\n');
    st.consoleCount[c.level === 'exception' ? 'exception' : c.level === 'warning' ? 'warning' : 'error']++;
    if (c.level !== 'warning' && !ignore.some((r) => r.test(e.text))) st.lastErrors.push(e);
    if (st.lastErrors.length > 200) st.lastErrors.splice(0, 100);
  };
  const onEvent = (e) => { st.events.push({ ...e, t: T() }); if (e.kind === 'dialog') log(`native dialog answered: ${e.type} ${String(e.message).slice(0, 120)}`); };

  // ── App lifecycle ──
  async function collectLogs(handle, runIndex, upTo = null) {
    if (!handle) return;
    const src = debugLogPath({ target, root, handle });
    const dst = path.join(sessionDir, 'logs', `debug-run${runIndex}.log`);
    try { fs.copyFileSync(src, dst); } catch { return; }
    // Only what the app logged before the runner asked it to stop counts:
    // children going away during the shutdown are expected.
    const all = fs.readFileSync(dst, 'utf8');
    const text = upTo != null ? all.slice(0, upTo) : all;
    const ver = text.match(/=== Electron started \S+ \(([^,]+),/);
    if (ver && !meta.appVersion) { meta.appVersion = ver[1]; saveMeta(); }
    for (const line of text.split('\n')) {
      const gone = line.match(/child-process-gone: type=(\S+) reason=(\S+)/);
      if (gone && !/clean-exit/.test(gone[2])) incident('child-gone', line.trim().slice(0, 300), { run: runIndex });
      else if (/GPU process crashed|\[Recovery\] (reloading the editor|editor process gone|editor gone again)/.test(line)) incident('log-recovery', line.trim().slice(0, 300), { run: runIndex });
    }
  }

  async function stopApp({ graceful = true } = {}) {
    const h = st.handle;
    if (!h) return;
    st.handle = null;
    let upTo = null;
    try { upTo = fs.statSync(debugLogPath({ target, root, handle: h })).size; } catch { /* no log yet */ }
    await h.stop({ graceful }).catch(() => {});
    await collectLogs(h, h.runIndex, upTo);
  }

  async function startApp() {
    if (st.restarts > config.maxRestarts) throw new Error(`gave up after ${st.restarts} restarts`);
    st.run++; st.launches++;
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const h = await launchApp({ target, root, devUrl: dev?.url, cdpPort: opts.port, runIndex: st.run, sessionDir, hidden: opts.hidden, windowSize: config.windowSize, log, onConsole, onEvent });
        h.runIndex = st.run;
        st.handle = h;
        st.missed = 0; st.hang = false; st.prevStatus = null; st.prevProc = null; st.launchedAt = Date.now();
        await dismissStartup();
        await session().eval('window.__soak.instrument()').catch(() => {});
        await profileSetup();
        const s = await session().eval('window.__soak.status()', 10000).catch(() => null);
        if (s && !meta.machine.adapter) { meta.machine.adapter = s.adapter_name ?? 'unknown'; meta.machine.backend = s.backend ?? ''; saveMeta(); }
        log(`launch #${st.run} ready in ${(h.readyMs / 1000).toFixed(1)} s (pid ${h.pid})`);
        files.trace.write(J({ kind: 'launch', t: T(), run: st.run, readyMs: h.readyMs, pid: h.pid }) + '\n');
        return;
      } catch (err) {
        lastErr = err;
        incident('launch-failed', `attempt ${attempt}: ${err.message}`);
        if (st.handle) await stopApp({ graceful: false });
        await sleep(3000);
      }
    }
    throw new Error(`the app would not start: ${lastErr?.message}`);
  }

  const session = () => st.handle?.session;

  /** A profile's set, built after every launch. A set that cannot be built
   *  is a failed launch (retried, and counted). */
  async function profileSetup() {
    if (!profile?.setup) return;
    const rec = { kind: 'setup', step: st.step, t: T(), run: st.run, profile: opts.profile, status: 'pass', note: '', warnings: [], error: null };
    const t0 = Date.now();
    try {
      await Promise.race([
        profile.setup(makeCtx(st.step, master.fork(1e9 + st.run), rec)),
        sleep(10 * 60000).then(() => { throw new Assert('timed out after 10 minutes'); }),
      ]);
    } catch (err) {
      rec.status = 'fail'; rec.error = err.message;
      Object.assign(rec, await screenshot(`${opts.profile} setup failed`, 'fail'));
    }
    rec.ms = Date.now() - t0;
    files.trace.write(J(rec) + '\n');
    log(`${opts.profile} setup ${rec.status === 'pass' ? 'done' : 'FAILED'} in ${(rec.ms / 1000).toFixed(1)}s: ${rec.note}${rec.error ? ` — ${rec.error}` : ''}${rec.warnings.length ? ` (${rec.warnings.join('; ').slice(0, 300)})` : ''}`);
    if (rec.status === 'fail') throw new Error(`${opts.profile} setup failed: ${rec.error}`);
  }

  async function dismissStartup() {
    await session().eval(`(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      for (let i = 0; i < 50 && !document.querySelector('.welcome .choice') && !document.querySelector('.recovery-backdrop'); i++) await sleep(200);
      document.querySelector('.recovery-backdrop .btn-discard')?.click();
      await sleep(300);
      for (let i = 0; i < 20 && !document.querySelector('.welcome .choice'); i++) await sleep(200);
      document.querySelector('.welcome .choice[data-choice="blank"]')?.click();
      await sleep(800);
      return true;
    })()`, 30000).catch(() => {});
  }

  /** Close whatever an action (or the monkey) left open that would block the next one. */
  /** Hidden runs on macOS: an editor stuck at ~1 animation frame a second
   *  (a hidden app's window can stay throttled after its Output Window
   *  closes, and sometimes from launch) makes every timing check fail.
   *  Measured before every step (300 ms), after output steps and at
   *  checkpoints; when stuck, the app is shown and hidden once and the trace
   *  notes it. */
  async function keepFramesRunning(where, ms = 600) {
    if (!opts.hidden || !IS_MAC || !st.handle?.refreshHidden) return;
    const fps = await session()?.eval(`window.__soak.editorFps(${ms})`, 5000).catch(() => null);
    if (fps === null || fps === undefined || fps >= 10) return;
    st.handle.refreshHidden();
    await sleep(800);
    const after = await session()?.eval('window.__soak.editorFps(600)', 5000).catch(() => null);
    log(`hidden editor was throttled to ${fps} fps (${where}); shown and hidden again: ${after} fps`);
    files.trace.write(J({ kind: 'note', t: T(), step: st.step, run: st.run, note: `hidden editor throttled to ${fps} fps after ${where}; refreshed to ${after} fps` }) + '\n');
  }

  async function unstick() {
    await session()?.eval(`(async () => {
      const G = window.__ghostArcade; if (!G) return;
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      try { if (document.querySelector('.tp-backdrop')) G.onboarding.closeTemplates?.(); } catch {}
      try { if (document.querySelector('.tour-card, .tour-next')) G.onboarding.endTour?.(); } catch {}
      document.querySelector('.recovery-backdrop .btn-discard')?.click();
      document.querySelector('.welcome .choice[data-choice="blank"]')?.click();
      for (const b of document.querySelectorAll('.close-modal-backdrop .btn-cancel')) b.click();
      // An Auto show dialog left open (not the docked "done" one), the Analog Synth instrument.
      const auto = document.querySelector('[data-auto-phase]');
      if (auto && auto.dataset.autoPhase !== 'done') auto.querySelector('.auto-cancel, .auto-x')?.click();
      else document.querySelector('[data-auto-done]')?.click();
      [...document.querySelectorAll('button.bar-btn')].find((b) => b.textContent.trim() === 'Close' && b.closest('*')?.parentElement?.querySelector('.app-title'))?.click();
      document.querySelector('[role="dialog"][aria-label="Analog Synth"] button[aria-label="Close"]')?.click();
      try { if (G.settings.get().output?.blackout) G.settings.update((s) => ({ ...s, output: { ...s.output, blackout: false } })); } catch {}
      await sleep(100);
    })()`, 10000).catch(() => {});
    // Audio Lab's full studio view covers the deck; its key (\`) takes it back.
    const studioView = await session()?.eval(`[...document.querySelectorAll('.bar-title')].some((e) => /Audio Lab/.test(e.textContent) && e.getBoundingClientRect().width > 0)`, 5000).catch(() => false);
    if (studioView) {
      await session().eval('document.activeElement?.blur?.()').catch(() => {});
      await session().key('`', { code: 'Backquote', keyCode: 192, text: '`' }).catch(() => {});
      await sleep(300);
    }
  }

  // ── Telemetry and heartbeat ──
  let telemetryRunning = true;
  async function sample({ checkpoint = false } = {}) {
    const h = st.handle;
    if (!h) return null;
    const s = session();
    const out = { t: T(), at: new Date().toISOString(), run: st.run, step: st.step, sinceLaunchMs: Date.now() - (st.launchedAt ?? Date.now()), checkpoint };
    const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout'); })]);
    try {
      const full = await sampleTree(h.pid, st.prevProc);
      st.prevProc = full;
      const { pids, ...rest } = full;
      out.proc = rest;
      // macOS checkpoints: what each process's memory is made of (vmmap), so
      // growth can be told apart: heap, GPU/IOSurface, or shared code pages.
      if (checkpoint && process.platform === 'darwin') {
        out.vm = {};
        for (const role of ['main', 'renderer', 'core', 'gpu']) {
          const pid = Object.entries(pids).find(([, info]) => info.role === role)?.[0];
          const vm = pid ? await vmSummary(Number(pid)).catch(() => null) : null;
          if (vm) out.vm[role] = vm;
        }
      }
    } catch (err) { out.procError = err.message; }
    try {
      const m = await withTimeout(s.metrics(), 8000);
      out.renderer = { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), heapTotalMB: +(m.JSHeapTotalSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents, frames: m.Frames, layoutCount: m.LayoutCount, scriptSec: +m.ScriptDuration?.toFixed(2), taskSec: +m.TaskDuration?.toFixed(2) };
    } catch { /* page busy */ }
    try { out.editorFps = await s.eval('window.__soak.editorFps(1000)', 5000); } catch { /* page busy */ }
    try {
      const c = await s.eval('window.__soak.status()', 8000);
      const prev = st.prevStatus;
      const sameCore = prev && prev.core_instance === c.core_instance;
      const dt = prev ? (Date.now() - prev._at) / 1000 : 0;
      const d = (k) => (sameCore ? Math.max(0, (c[k] ?? 0) - (prev[k] ?? 0)) : 0);
      out.core = {
        fps: sameCore && dt > 0 ? +(d('frames_presented') / dt).toFixed(1) : null,
        cpuMs: c.avg_render_cpu_ms, gpuMs: c.avg_render_gpu_ms, gpuMaxMs: c.max_render_gpu_ms, gpuMemMB: c.gpu_memory_mb,
        graphTexMB: c.graph_texture_bytes != null ? +(c.graph_texture_bytes / 1048576).toFixed(1) : null,
        videoCacheMB: c.native_video_frame_cache_bytes != null ? +(c.native_video_frame_cache_bytes / 1048576).toFixed(1) : null,
        mediaSources: c.media_sources_active, videoSessions: Array.isArray(c.native_video_sessions) ? c.native_video_sessions.length : null,
        darkWarnings: c.dark_frame_warnings, instance: c.core_instance, running: c.running, lastError: c.last_frame_error ?? null,
      };
      out.deltas = {
        droppedFrames: d('gpu_backpressure_skips') + d('commands_dropped') + d('decode_jobs_dropped'),
        audioUnderflows: d('clip_audio_underflow_events'), audioUnderflowFrames: d('clip_audio_underflow_frames'),
        videoUnderflows: d('native_video_stream_underflows'), presentFailures: d('swapchain_present_failures'),
      };
      if (prev && prev.core_instance != null && c.core_instance != null && prev.core_instance !== c.core_instance) {
        incident('core-restart', `render core restarted (instance ${prev.core_instance} -> ${c.core_instance})${c.core_failure_hint ? `: ${c.core_failure_hint}` : ''}${c.core_exit_code != null ? ` exit ${c.core_exit_code}` : ''}${c.core_exit_signal ? ` ${c.core_exit_signal}` : ''}`);
      }
      st.prevStatus = { ...c, _at: Date.now() };
    } catch { /* core busy */ }
    // Checkpoints: the sizes of the core's maps and GPU resources (absent on
    // builds without the call), to see which one grows.
    if (checkpoint) {
      try { out.coreMem = await s.eval(`window.electronAPI.invoke('native_renderer_memory_stats', {})`, 8000); } catch { /* core busy */ }
      // Chromium's own breakdown (DOM, JS, images, canvases, compositor, GPU buffers) per process.
      try { out.chromeMem = await memoryInfraDump(opts.port); } catch (err) { out.chromeMemError = err.message; }
    }
    try { out.publish = await s.eval('window.__soak.publishRates()', 5000); } catch { /* page busy */ }
    out.temp = { tmpMB: folderSize(h.tmp).mb, tmpFiles: folderSize(h.tmp).files, profileMB: folderSize(h.profile).mb };
    out.errors = { errors: st.consoleCount.error - st.consoleSince.error, warnings: st.consoleCount.warning - st.consoleSince.warning, exceptions: st.consoleCount.exception - st.consoleSince.exception };
    st.consoleSince = { ...st.consoleCount };
    try { out.pages = (await listTargets(opts.port)).filter((x) => x.type === 'page').length; } catch { /* port busy */ }
    files.telemetry.write(J(out) + '\n');
    return out;
  }

  async function heartbeat() {
    const h = st.handle;
    if (!h) return;
    const ok = await session().eval('1 + 1', config.heartbeatSeconds * 1000).then((v) => v === 2).catch(() => false);
    if (ok) st.missed = 0;
    else if (h.isAlive()) {
      st.missed++;
      log(`heartbeat missed (${st.missed}/${config.hangAfterMissedHeartbeats})`);
      if (st.missed >= config.hangAfterMissedHeartbeats) st.hang = true;
    }
    fs.writeFileSync(path.join(sessionDir, 'heartbeat.json'), J({ at: new Date().toISOString(), t: T(), run: st.run, step: st.step, pid: h.pid, missed: st.missed, deadline: new Date(deadline).toISOString(), stopReason: st.stopReason }));
  }

  async function screenshot(label, prefix) {
    const s = session();
    if (!s) return {};
    const out = {};
    const base = `${prefix}-${String(st.step).padStart(5, '0')}`;
    try {
      fs.writeFileSync(path.join(sessionDir, 'shots', `${base}-editor.jpg`), await s.screenshot({ quality: 55, maxWidth: 1280 }));
      out.shot = `shots/${base}-editor.jpg`;
    } catch { /* page busy */ }
    try {
      const snap = await s.eval(`window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: true, max_dim: 640, live_output: true, encoding: 'jpeg', quality: 70 })`, 15000);
      if (snap?.jpeg_b64) { fs.writeFileSync(path.join(sessionDir, 'shots', `${base}-output.jpg`), Buffer.from(snap.jpeg_b64, 'base64')); out.outputShot = `shots/${base}-output.jpg`; }
    } catch { /* core busy */ }
    if (out.shot) files.shots.write(J({ t: T(), step: st.step, label, file: out.shot }) + '\n');
    if (out.outputShot) files.shots.write(J({ t: T(), step: st.step, label: `${label} (render output)`, file: out.outputShot }) + '\n');
    return out;
  }

  const telemetryLoop = (async () => {
    let next = Date.now();
    while (telemetryRunning) {
      await sleep(1000);
      if (Date.now() < next || !st.handle || st.busy) continue;
      next = Date.now() + config.telemetrySeconds * 1000;
      try { await heartbeat(); if (!st.hang && st.handle) await sample(); } catch (err) { log(`telemetry: ${err.message}`); }
      if (st.handle && Date.now() - st.lastShotAt > config.screenshotEveryMinutes * 60000) {
        st.lastShotAt = Date.now();
        await screenshot('periodic', 'periodic').catch(() => {});
      }
    }
  })();

  // ── Health between steps ──
  async function checkHealth() {
    const h = st.handle;
    if (!h) { await startApp(); return; }
    if (!h.isAlive()) {
      incident('crash', `the app exited (code ${h.exit.code}, signal ${h.exit.signal})`);
      await stopApp({ graceful: false });
      st.restarts++;
      await startApp();
      return;
    }
    if (st.hang) {
      const shots = await screenshot('hang', 'hang');
      let stack = '';
      if (IS_MAC) {
        const out = path.join(sessionDir, 'logs', `hang-run${st.run}-step${st.step}.txt`);
        spawnSync('sample', [String(h.pid), '3', '-file', out], { timeout: 20000 });
        stack = ` (stack sample: logs/${path.basename(out)})`;
      }
      incident('hang', `no answer from the editor for ${config.hangAfterMissedHeartbeats} heartbeats${stack}`, shots);
      await stopApp({ graceful: false });
      st.restarts++;
      await startApp();
      return;
    }
    const s = h.session;
    if (s.closed || s.crashed) {
      // The main process may be reloading the editor (its recovery); wait for it.
      const kind = s.crashed ? 'renderer-crash' : 'editor-reload';
      try {
        await h.reconnect();
        incident(kind, `the editor page ${s.crashed ? 'crashed' : 'went away'} and came back (reloaded)`);
        await dismissStartup();
        await session().eval('window.__soak.instrument()').catch(() => {});
      } catch (err) {
        incident(kind, `the editor page ${s.crashed ? 'crashed' : 'went away'} and did not come back: ${err.message}`);
        await stopApp({ graceful: false });
        st.restarts++;
        await startApp();
      }
      return;
    }
    const nav = st.events.filter((e) => e.kind === 'navigated');
    if (nav.length) {
      st.events = st.events.filter((e) => e.kind !== 'navigated');
      incident('editor-reload', `the editor page reloaded (${nav[0].url})`);
      for (let i = 0; i < 60; i++) {
        if (await s.eval('!!window.__ghostArcade?.vjClipLauncher', 3000).catch(() => false)) break;
        await sleep(500);
      }
      await s.eval((await import('./lib/app.mjs')).PAGE_HELPERS).catch(() => {});
      await dismissStartup();
      await s.eval('window.__soak.instrument()').catch(() => {});
    }
  }

  // ── Action context ──
  function makeCtx(step, rng, rec) {
    const s = session();
    const showCtx = st.showCtx ??= { vars: {}, perf: [], startedAt: Date.now(), stepLabel: '' };
    Object.assign(showCtx, {
      session: s, eval: (js, t) => s.eval(js, t), profile: st.handle.profile,
      livePorts: { app: opts.port + 20000, script: opts.port + 20001 },
      async openPage(match) { const t = await waitForTarget(opts.port, match, 30000); st.handle.rehide(); const { PageSession } = await import('./lib/cdp.mjs'); return new PageSession(t).connect(); },
    });
    const page = (body, args = {}, timeoutMs = 30000) => s.eval(`(async (A) => { const G = window.__ghostArcade, S = window.__soak; ${body} })(${J(args)})`, timeoutMs);
    const rectOf = async (expr) => s.eval(`(() => { const el = (${expr}); if (!el || el.disabled) return null; el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(); if (r.width <= 1 || r.height <= 1) return null; const x = r.left + r.width / 2, y = r.top + r.height / 2; const hit = document.elementFromPoint(x, y); return hit && (hit === el || el.contains(hit)) ? { x, y } : null; })()`, 10000).catch(() => null);
    const ctx = {
      rng, step, root,
      note: (m) => { rec.note = rec.note ? `${rec.note}; ${m}` : String(m); },
      warn: (m) => { rec.warnings.push(String(m)); },
      skip: (why) => { throw new Skip(why); },
      assert: (cond, msg) => { if (!cond) throw new Assert(msg); },
      page,
      state: () => s.eval(STATE_JS, 10000),
      async waitFor(expr, ms = 10000) {
        const until = Date.now() + ms;
        while (Date.now() < until) {
          if (await s.eval(`(() => { const G = window.__ghostArcade, S = window.__soak; return !!(${expr}); })()`, 5000).catch(() => false)) return true;
          await sleep(250);
        }
        return false;
      },
      async showStep(stepDef) {
        await s.eval(SHOW_HELPERS);
        showCtx.stepLabel = stepDef.do;
        await runShowAction(showCtx, stepDef);
      },
      showVars: () => showCtx.vars,
      async click(selector) {
        const r = await s.eval(`window.__soak.rect(${J(selector)})`, 10000).catch(() => null);
        if (!r) return false;
        await s.click(r.x, r.y);
        await sleep(150);
        return true;
      },
      async clickNth(selector, n) {
        const r = await rectOf(`(() => { const els = [...document.querySelectorAll(${J(selector)})].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 && !e.disabled; }); return els.length ? els[${n} % els.length] : null; })()`);
        if (!r) return false;
        await s.click(r.x, r.y);
        await sleep(150);
        return true;
      },
      async clickExpr(expr) {
        const r = await rectOf(expr);
        if (!r) return false;
        await s.click(r.x, r.y);
        await sleep(150);
        return true;
      },
      async clickText(selector, re) {
        return ctx.clickExpr(`[...document.querySelectorAll(${J(selector)})].find((e) => new RegExp(${J(re.source)}, ${J(re.flags)}).test(e.textContent.trim()))`);
      },
      key: (key, o) => s.key(key, o),
      async monkeyClick({ within = null, selector = null, randomX = false }) {
        const r = await s.eval(`(() => {
          const deny = new RegExp(${J(MONKEY_DENY.source)}, 'i');
          const scope = (${J(within)} && document.querySelector(${J(within)})) || document;
          const sel = ${J(selector)} || 'button, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], input[type="checkbox"], input[type="range"], select, .clip-cell, summary';
          const list = [...scope.querySelectorAll(sel)].filter((el) => {
            if (el.disabled || el.closest('a[href], .mac-window-titlebar, [aria-hidden="true"], input[type="file"]')) return false;
            const label = [el.textContent, el.getAttribute('title'), el.getAttribute('aria-label'), el.dataset ? Object.keys(el.dataset).join(' ') : ''].join(' ').replace(/\\s+/g, ' ').trim();
            if (deny.test(label)) return false;
            const b = el.getBoundingClientRect();
            if (b.width < 3 || b.height < 3 || b.bottom < 0 || b.right < 0 || b.top > innerHeight || b.left > innerWidth) return false;
            const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
            return !!hit && (hit === el || el.contains(hit));
          });
          if (!list.length) return null;
          const el = list[Math.floor(${rng.next()} * list.length)];
          const b = el.getBoundingClientRect();
          const label = (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 40);
          return { x: ${randomX} ? b.left + 2 + ${rng.next()} * (b.width - 4) : b.left + b.width / 2, y: b.top + b.height / 2, label, of: list.length };
        })()`, 10000).catch(() => null);
        if (!r) return false;
        ctx.note(`click "${r.label}"`);
        await s.click(r.x, r.y);
        await sleep(rng.int(100, 600));
        return true;
      },
      async monkeyDrag({ within = null }) {
        const r = await s.eval(`(() => {
          // The given element, or the biggest canvas on screen (the editor's viewport).
          let el = ${J(within)} && document.querySelector(${J(within)});
          if (!el) {
            let best = 0;
            for (const c of document.querySelectorAll('canvas, .canvas-container, .editor-canvas')) { const b = c.getBoundingClientRect(); const a = Math.max(0, Math.min(b.right, innerWidth) - Math.max(b.left, 0)) * Math.max(0, Math.min(b.bottom, innerHeight) - Math.max(b.top, 0)); if (a > best) { best = a; el = c; } }
          }
          const b = (el ?? document.body).getBoundingClientRect();
          return { x: b.left, y: b.top, w: b.width, h: b.height };
        })()`, 10000).catch(() => null);
        if (!r || r.w < 10) return false;
        const p = () => [r.x + rng.float(0.1, 0.9) * r.w, r.y + rng.float(0.1, 0.9) * r.h];
        const [x0, y0] = p(); const [x1, y1] = p();
        await s.drag(x0, y0, x1, y1, rng.int(3, 12));
        ctx.note(`drag ${Math.round(x0)},${Math.round(y0)} -> ${Math.round(x1)},${Math.round(y1)}`);
        await sleep(200);
        return true;
      },
      async expectFrames(label) {
        // The core renders on demand (a still scene presents rarely), so the
        // check is that it is up and draws a frame when asked.
        const c = await s.eval('window.__soak.status()', 10000);
        ctx.assert(c && c.running !== false && !c.core_exited_unexpectedly, `${label}: the render core is not running${c?.core_failure_hint ? ` (${c.core_failure_hint})` : ''}`);
        const snap = await s.eval('window.__soak.snapshot()', 15000).catch(() => null);
        ctx.assert(snap, `${label}: the render core gave no frame when asked`);
        if (await ctx.contentExpected()) {
          const mean = (snap.mean_rgba[0] + snap.mean_rgba[1] + snap.mean_rgba[2]) / 3;
          if (mean < 0.004) ctx.warn(`${label}: the output is black (mean ${mean.toFixed(4)})`);
        }
      },
      async contentExpected() {
        return s.eval(`(() => { const p = window.__soak.project(); const d = window.__soak.deck(); return p.layers.some((l) => l.visible !== false && (l.opacity ?? 1) > 0.05) || (d.isOpen && Object.values(d.activeClips ?? {}).some(Boolean)); })()`, 5000).catch(() => false);
      },
      async resizeWindow(w, h) {
        // Electron's DevTools has no Browser.setWindowBounds and window.resizeTo
        // does not reliably move an app window, so the editor's viewport is
        // resized through device-metrics emulation: layout, canvases and the
        // native preview geometry all follow it, on every platform.
        await s.call('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 0, mobile: false });
        st.emulated = true;
        return 'viewport';
      },
      waitForTarget: (match, ms) => waitForTarget(opts.port, match, ms).catch(() => null),
      rehide: () => st.handle.rehide(),
      profile: () => st.handle.profile,
      keepRender(file) {
        const dst = path.join(sessionDir, 'renders', `step${step}-${path.basename(file)}`);
        try { fs.renameSync(file, dst); } catch { try { fs.copyFileSync(file, dst); fs.rmSync(file, { force: true }); } catch { return file; } }
        // The encoder's temp folder goes too, as a save would leave it.
        try { const dir = path.dirname(file); if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir); } catch { /* not empty */ }
        st.renders.push(dst);
        while (st.renders.length > config.keepRenders) { try { fs.rmSync(st.renders.shift(), { force: true }); } catch { /* gone */ } }
        return `renders/${path.basename(dst)}`;
      },
    };
    return ctx;
  }

  async function runOneAction(forced = null) {
    const rng = master.fork(st.step);
    if (forced) {
      const action = ACTIONS.find((a) => a.name === forced);
      if (!action) { log(`replay: no action ${forced} in this version`); return; }
      rng.next(); // the draw that picked it in the original run
      return runAction(action, rng);
    }
    let state = null;
    try { state = await session().eval(STATE_JS, 10000); } catch { /* checked below */ }
    if (!state) { await sleep(2000); return; }
    const weightOf = (a) => config.actionWeights?.[a.name] ?? (profile ? profile.weights[a.name] ?? 0 : a.weight);
    const pool = ACTIONS.filter((a) => (profile || areas.includes(a.area)) && (!opts.only || opts.only.includes(a.name)) && weightOf(a) > 0 && (!a.when || a.when(state)))
      .map((a) => ({ a, weight: weightOf(a) * (profile ? 1 : config.areaWeights?.[a.area] ?? 1) }));
    const pick = rng.weighted(pool);
    if (!pick) { await sleep(1000); return; }
    return runAction(pick.a, rng);
  }

  async function runAction(action, rng) {
    await keepFramesRunning(`before step ${st.step}`, 300);
    const rec = { kind: 'action', step: st.step, t: T(), run: st.run, area: action.area, action: action.name, status: 'pass', note: '', warnings: [], error: null };
    const errMark = st.lastErrors.length ? st.lastErrors[st.lastErrors.length - 1] : null;
    const t0 = Date.now();
    const ctx = makeCtx(st.step, rng, rec);
    try {
      await Promise.race([
        action.run(ctx),
        sleep(action.timeoutSec * 1000).then(() => { throw new Assert(`timed out after ${action.timeoutSec} s`); }),
      ]);
    } catch (err) {
      if (err instanceof Skip) { rec.status = 'skip'; rec.note = rec.note ? `${rec.note}; ${err.message}` : err.message; }
      else { rec.status = 'fail'; rec.error = err instanceof Assert ? err.message : `error: ${err.message}`; }
    }
    rec.ms = Date.now() - t0;
    // Uncaught exceptions during the action fail it; console errors are warnings.
    const since = errMark ? st.lastErrors.slice(st.lastErrors.indexOf(errMark) + 1) : st.lastErrors.slice();
    const during = since.filter((e) => e.t >= rec.t);
    for (const e of during) rec.warnings.push(`${e.level}: ${e.text.slice(0, 300)}`);
    const exceptions = during.filter((e) => e.level === 'exception');
    if (exceptions.length && rec.status !== 'fail') { rec.status = 'fail'; rec.error = `uncaught exception: ${exceptions[0].text.slice(0, 300)}`; }
    if (rec.status === 'fail') {
      Object.assign(rec, await screenshot(`${action.name} failed`, 'fail'));
      rec.replay = replayBase(st.step);
    }
    files.trace.write(J(rec) + '\n');
    const icon = rec.status === 'pass' ? 'ok  ' : rec.status === 'skip' ? 'skip' : 'FAIL';
    log(`${icon} #${st.step} ${action.name}${rec.note ? ` [${rec.note.slice(0, 120)}]` : ''}${rec.error ? ` — ${rec.error}` : ''}${rec.warnings.length ? ` (${rec.warnings.length} warning(s))` : ''} ${(rec.ms / 1000).toFixed(1)}s`);
    await unstick();
    if (action.area === 'output') await keepFramesRunning(action.name);
  }

  /** A profile that keeps its set: measure it as it plays, after GC (the
   *  same state every time is the set itself). */
  async function playingCheckpoint() {
    const s = session();
    log(`checkpoint #${st.step}: measuring the set as it plays`);
    const t0 = Date.now();
    st.busy = true;
    try {
      if (st.emulated) { await s.call('Emulation.clearDeviceMetricsOverride').catch(() => {}); st.emulated = false; }
      await keepFramesRunning('checkpoint');
      const state = await s.eval(STATE_JS, 10000).catch(() => null);
      await sleep(5000);
      await s.call('Runtime.discardConsoleEntries', {}, 10000).catch(() => {});
      await s.call('HeapProfiler.collectGarbage', {}, 30000).catch(() => {});
      if (opts.heapSnapshots) {
        const file = path.join(sessionDir, `heap-run${st.run}-step${st.step}.heapsnapshot`);
        await s.heapSnapshot(file, fs).then(() => log(`heap snapshot: ${file}`), (err) => log(`heap snapshot failed: ${err.message}`));
      }
      st.busy = false;
      const b = await sample({ checkpoint: true });
      files.trace.write(J({ kind: 'checkpoint', step: st.step, t: T(), run: st.run, ms: Date.now() - t0, playing: state }) + '\n');
      if (b) log(`checkpoint: total ${b.proc?.totalMB} MB, renderer ${b.proc?.roles?.renderer?.rssMB} MB, heap ${b.renderer?.heapMB} MB, DOM ${b.renderer?.nodes}, core ${b.proc?.roles?.core?.rssMB} MB; layers ${state?.layers}, deck clips ${state?.filled?.length}, Timeline ${state?.playing ? 'playing' : 'stopped'}, Output Window ${state?.outputOpen ? 'open' : 'closed'}`);
      await screenshot('checkpoint', 'checkpoint');
    } catch (err) {
      log(`checkpoint failed: ${err.message}`);
      files.trace.write(J({ kind: 'checkpoint', step: st.step, t: T(), run: st.run, error: err.message }) + '\n');
    } finally { st.busy = false; }
    try { buildReport(sessionDir, { durationMs: T(), steps: st.step, launches: st.launches, interrupted: 'still running (report as of the last checkpoint)' }); } catch (err) { log(`interim report: ${err.message}`); }
  }

  /** Back to the same blank state, let it settle, GC, and take the memory baseline. */
  async function checkpoint() {
    if (profile && profile.blankCheckpoints === false) return playingCheckpoint();
    const s = session();
    log(`checkpoint #${st.step}: back to a blank project`);
    const t0 = Date.now();
    st.busy = true;
    try {
      await s.eval(`(async () => {
        const G = window.__ghostArcade; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        try { G.showTimeline.stop(); } catch {}
        try { G.takeover?.store?.release('all'); } catch {}
        try { G.vjClipLauncher.stopAll(); G.vjClipLauncher.setOpen(false); } catch {}
        document.querySelector('button.output-btn[title="Close Output Window"]')?.click();
        document.querySelector('[aria-label="Close Interactive Studio"]')?.click();
        try { G.showTimeline.setOpen(false); } catch {}
        await sleep(800);
      })()`, 20000);
      await s.eval('document.activeElement?.blur?.()').catch(() => {});
      await s.key('n', { code: 'KeyN', keyCode: 78, modifiers: IS_MAC ? 4 : 2 });
      await sleep(600);
      await s.eval(`(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        document.querySelector('.close-modal-backdrop .btn-discard')?.click();
        await sleep(300);
        document.querySelector('.close-modal-backdrop .btn-save')?.click();
        await sleep(1500);
      })()`, 10000);
      if (st.emulated) { await s.call('Emulation.clearDeviceMetricsOverride').catch(() => {}); st.emulated = false; }
      await keepFramesRunning('checkpoint');
      const blank = await s.eval(STATE_JS, 10000).catch(() => null);
      await sleep(15000);
      // DevTools keeps every console message's arguments alive; drop them so
      // the runner's own connection never shows up as a leak.
      await s.call('Runtime.discardConsoleEntries', {}, 10000).catch(() => {});
      await s.call('HeapProfiler.collectGarbage', {}, 30000).catch(() => {});
      if (opts.heapSnapshots) {
        // Compare two of these in DevTools (Memory → Load → Comparison) to see what keeps memory alive.
        const file = path.join(sessionDir, `heap-run${st.run}-step${st.step}.heapsnapshot`);
        await s.heapSnapshot(file, fs).then(() => log(`heap snapshot: ${file}`), (err) => log(`heap snapshot failed: ${err.message}`));
      }
      st.busy = false;
      const b = await sample({ checkpoint: true });
      // The like-for-like frame rate: one full-frame animated shader on the
      // blank project (a still scene is drawn on demand, so it has no fps).
      st.busy = true;
      const ref = await s.eval(`(async () => {
        const G = window.__ghostArcade, S = window.__soak; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const id = G.project.addLayer('Soak reference', 'media');
        const clip = await S.shaderClip('DM-ColorBreath');
        G.project.setLayerSource(id, { id: crypto.randomUUID(), type: 'shader', src: clip.src, name: clip.name, shaderCode: clip.shaderCode, shaderValues: {} });
        await sleep(4000);
        const a = await S.status(); const t0 = performance.now();
        await sleep(3000);
        const c = await S.status(); const secs = (performance.now() - t0) / 1000;
        G.project.removeLayer(id);
        return a.core_instance === c.core_instance ? { fps: +((c.frames_presented - a.frames_presented) / secs).toFixed(1), gpuMs: c.avg_render_gpu_ms, cpuMs: c.avg_render_cpu_ms } : null;
      })()`, 30000).catch(() => null);
      st.busy = false;
      if (b) {
        b.refFps = ref?.fps ?? null; b.refGpuMs = ref?.gpuMs ?? null; b.refCpuMs = ref?.cpuMs ?? null;
        files.telemetry.write(J({ kind: 'reference', t: T(), run: st.run, step: st.step, ...ref }) + '\n');
      }
      files.trace.write(J({ kind: 'checkpoint', step: st.step, t: T(), run: st.run, ms: Date.now() - t0, blank }) + '\n');
      if (b) log(`checkpoint: reference scene ${b.refFps} fps, GPU ${b.refGpuMs?.toFixed?.(2)} ms; total ${b.proc?.totalMB} MB, renderer ${b.proc?.roles?.renderer?.rssMB} MB, heap ${b.renderer?.heapMB} MB, core ${b.proc?.roles?.core?.rssMB} MB; layers ${blank?.layers}, tracks ${blank?.tracks}, songs ${blank?.songs}`);
      await screenshot('checkpoint', 'checkpoint');
    } catch (err) {
      log(`checkpoint failed: ${err.message}`);
      files.trace.write(J({ kind: 'checkpoint', step: st.step, t: T(), run: st.run, error: err.message }) + '\n');
    } finally { st.busy = false; }
    try { buildReport(sessionDir, { durationMs: T(), steps: st.step, launches: st.launches, interrupted: 'still running (report as of the last checkpoint)' }); } catch (err) { log(`interim report: ${err.message}`); }
  }

  // ── Finish (normal end, error, or signal) ──
  let finished = false;
  async function finish(reason, code = null) {
    if (finished) return;
    finished = true;
    telemetryRunning = false;
    log(`finishing: ${reason}`);
    if (st.handle) {
      try { await sample(); } catch { /* app gone */ }
      if (!opts.keepOpen) await stopApp();
      else { log(`left the app open (pid ${st.handle.pid}, debug port ${opts.port})`); await collectLogs(st.handle, st.run); }
    }
    if (!opts.keepOpen) { dev?.stop(); target.cleanup(); }
    await Promise.all(Object.values(files).map((f) => new Promise((r) => f.end(r))));
    meta.durationMs = T();
    meta.steps = st.step;
    meta.launches = st.launches;
    meta.interrupted = reason === 'done' ? null : reason;
    saveMeta();
    let pass = false;
    try {
      const { file, analysis } = buildReport(sessionDir);
      pass = analysis.pass;
      log(`${analysis.pass ? 'PASS' : `FAIL (${analysis.failedCount} check(s) over threshold)`}`);
      for (const f of analysis.findings.filter((x) => x.severity === 'fail')) log(`  ✗ ${f.title}: ${f.value} (threshold ${f.threshold})`);
      log(`report: ${file}`);
    } catch (err) { log(`report failed: ${err.stack}`); code = 2; }
    fs.writeFileSync(path.join(sessionDir, 'heartbeat.json'), J({ at: new Date().toISOString(), t: T(), finished: true, reason, pass }));
    runnerLog.end();
    process.exit(code ?? (pass ? 0 : 1));
  }
  const onSignal = (sig) => {
    if (st.stopReason) { finish(`stopped by ${sig} (forced)`); return; }
    st.stopReason = `stopped by ${sig}`;
    log(`${sig}: finishing after the current step (send again to stop now)`);
    setTimeout(() => finish(st.stopReason), 30000).unref();
  };
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  if (process.platform === 'win32') process.on('SIGBREAK', () => onSignal('SIGBREAK'));

  // ── The run ──
  try {
    await startApp();
    await sample({ checkpoint: true }).catch(() => null);
    if (replayPlan) log(`replaying ${replayPlan.length} steps from ${opts.replay}`);
    let planIndex = 0;
    while (Date.now() < deadline && !st.stopReason) {
      await checkHealth();
      if (opts.steps && st.step >= opts.steps) { log(`stopping after step ${st.step} (--steps)`); break; }
      if (replayPlan) {
        const e = replayPlan[planIndex++];
        if (!e) { log('replay: end of the recorded steps'); break; }
        st.step = e.step;
        if (e.kind === 'checkpoint') await checkpoint();
        else if (e.kind === 'rest') { files.trace.write(J({ kind: 'rest', step: st.step, t: T(), run: st.run, seconds: e.seconds }) + '\n'); await sleep(e.seconds * 1000); }
        else await runOneAction(e.action);
        const [p0, p1] = config.paceSeconds;
        await sleep(master.fork(st.step + 1e6).float(p0, p1) * 1000);
        continue;
      }
      st.step++;
      if (st.step % config.checkpointEverySteps === 0) await checkpoint();
      else if (st.step % config.restEverySteps === 0) {
        const secs = master.fork(st.step).int(config.restSeconds[0], config.restSeconds[1]);
        log(`rest #${st.step}: ${secs} s of just playing`);
        files.trace.write(J({ kind: 'rest', step: st.step, t: T(), run: st.run, seconds: secs }) + '\n');
        await sleep(secs * 1000);
      } else await runOneAction();
      const [p0, p1] = config.paceSeconds;
      await sleep(master.fork(st.step + 1e6).float(p0, p1) * 1000);
    }
    await finish(st.stopReason ?? 'done');
  } catch (err) {
    log(`runner error: ${err.stack}`);
    incident('runner-error', err.message);
    await finish(`runner error: ${err.message}`, 2);
  }
}

main().catch((err) => { console.error(err); process.exit(2); });
