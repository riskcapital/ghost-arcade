/**
 * Phone remote server: Electron main's CPU and event-loop lag, and relay
 * latency, with the JS server (in main) and the Rust one (its own process).
 *
 *   node scripts/phone-server-bench.mjs [--modes js,rust] [--seconds 20]
 *     [--port 9840] [--inspect-port 9850] [--dev-port 9855] [--out <dir>]
 *
 * Starts the source checkout hidden on a throwaway profile (as the soak test
 * does) once per mode, reads the real remote port from
 * window.ghostRemote.info(), and opens two scripted phones. Phone A paints:
 * light-painting stroke points at 120 Hz, a layer opacity change at 30 Hz
 * (a state write the server keeps and sends to everyone). Phone B watches,
 * and every stroke point it receives gives one relay latency (A to server to
 * B, one clock). The app itself is the desktop and receives all of it too.
 *
 * Scenarios, each --seconds long:
 *   idle    no phones
 *   stream  the phones as above
 *   stalls  stream, with main made busy for 30 ms every 200 ms (as a heavy
 *           IPC burst or a sync file write would), to show whether the relay
 *           waits for main
 *   bulk    stream, plus a 1.5 MB message from A every 250 ms (a scan or
 *           calibration chunk's size)
 *
 * Main's event-loop delay comes from perf_hooks.monitorEventLoopDelay over
 * the main process's inspector (--inspect); CPU from the process tree.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { ensureDevServer, resolveTarget, launchApp } from './soak/lib/app.mjs';
import { sampleTree, listProcesses } from './soak/lib/proc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const MODES = arg('modes', 'js,rust').split(',');
const SECONDS = Number(arg('seconds', '20'));
const SCENARIOS = arg('scenarios', 'idle,stream,stalls,bulk').split(',');
const CDP_PORT = Number(arg('port', '9840'));
const INSPECT_PORT = Number(arg('inspect-port', '9850'));
const DEV_PORT = Number(arg('dev-port', '9855'));
const outDir = path.resolve(arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'phone-server-bench-'))));
fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...m) => console.log('[bench]', ...m);

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const r = (v) => Math.round(v * 100) / 100;
  return { n: values.length, mean: r(values.reduce((s, v) => s + v, 0) / values.length), p50: r(q(0.5)), p99: r(q(0.99)), max: r(sorted[sorted.length - 1]) };
}

/** Runtime.evaluate in Electron's main process, over its inspector. */
async function mainInspector(port) {
  let list = null;
  for (let i = 0; i < 60 && !list; i++) {
    list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => null);
    if (!list) await sleep(250);
  }
  if (!list?.[0]) throw new Error('main process inspector not reachable');
  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  let id = 0;
  const waiting = new Map();
  ws.on('message', (d) => {
    const msg = JSON.parse(d.toString());
    if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  });
  const evaluate = (expression) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, (msg) => (msg.error || msg.result?.exceptionDetails ? reject(new Error(JSON.stringify(msg.error || msg.result.exceptionDetails))) : resolve(msg.result?.result?.value)));
    ws.send(JSON.stringify({ id: n, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
  });
  return { evaluate, close: () => ws.close() };
}

function openPhone(wsPort, token, onMessage) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}/?pair=${token}`, { perMessageDeflate: false });
    ws.on('message', (d) => onMessage?.(d));
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function phoneServerCpu(prev) {
  const rows = await listProcesses();
  const row = rows.find((r) => /ghost-phone-server/.test(r.args));
  if (!row) return { at: Date.now(), cpuSec: null };
  const now = { at: Date.now(), cpuSec: row.cpuSec, rssMB: row.rssMB };
  if (prev?.cpuSec != null) now.cpuPct = Math.round(((row.cpuSec - prev.cpuSec) / ((now.at - prev.at) / 1000)) * 1000) / 10;
  return now;
}

async function scenario(name, app, main, remote) {
  const latencies = [];
  let a = null; let b = null; let received = 0;
  const timers = [];
  if (name !== 'idle') {
    b = await openPhone(remote.wsPort, remote.token, (d) => {
      const text = d.toString();
      if (!text.startsWith('{"type":"lightpainting_stroke_point"')) return;
      received++;
      const at = Number(/"t":([\d.]+)/.exec(text)?.[1]);
      if (at) latencies.push(performance.now() - at);
    });
    a = await openPhone(remote.wsPort, remote.token);
    await sleep(1000);
  }
  await main.evaluate(`(() => {
    const { monitorEventLoopDelay } = process.getBuiltinModule('perf_hooks');
    globalThis.__benchEld?.disable();
    globalThis.__benchEld = monitorEventLoopDelay({ resolution: 1 });
    globalThis.__benchEld.enable();
    clearInterval(globalThis.__benchStall);
    ${name === 'stalls' ? 'globalThis.__benchStall = setInterval(() => { const end = Date.now() + 30; while (Date.now() < end) {} }, 200);' : ''}
    return true;
  })()`);
  let sent = 0;
  if (a) {
    let seq = 0;
    timers.push(setInterval(() => {
      // 120 Hz in 8.33 ms steps; Node timers are 1 ms grained, so send to schedule.
      const due = Math.floor((performance.now() - startAt) / (1000 / 120));
      while (seq < due) {
        seq++;
        a.send(`{"type":"lightpainting_stroke_point","t":${performance.now()},"layerId":"lp-bench","strokeId":"s1","point":{"x":${(seq % 100) / 100},"y":0.5,"pressure":0.5,"tilt":0},"seq":${seq}}`);
        sent++;
      }
    }, 2));
    timers.push(setInterval(() => a.send(JSON.stringify({ type: 'parameter', layerId: 'bench-layer', param: 'opacity', value: Math.random() })), 1000 / 30));
    if (name === 'bulk') {
      const pad = 'x'.repeat(1.5 * 1024 * 1024);
      timers.push(setInterval(() => a.send(`{"type":"set_vj_master_opacity","opacity":0.5,"pad":"${pad}"}`), 250));
    }
  }
  const startAt = performance.now();
  let tree = await sampleTree(app.pid);
  let ps = await phoneServerCpu();
  await sleep(SECONDS * 1000);
  tree = await sampleTree(app.pid, tree);
  ps = await phoneServerCpu(ps);
  for (const t of timers) clearInterval(t);
  const eld = await main.evaluate(`(() => {
    const h = globalThis.__benchEld; h.disable(); clearInterval(globalThis.__benchStall);
    return { mean: h.mean / 1e6, p50: h.percentile(50) / 1e6, p99: h.percentile(99) / 1e6, max: h.max / 1e6 };
  })()`);
  await sleep(300);
  a?.close(); b?.close();
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v * 100) / 100]));
  return {
    scenario: name,
    cpuPct: { main: tree.roles.main?.cpuPct ?? null, renderer: tree.roles.renderer?.cpuPct ?? null, phoneServer: ps.cpuPct ?? null },
    mainEventLoopMs: round(eld),
    relayMs: stats(latencies),
    strokes: { sent, received },
  };
}

async function runMode(mode, target, dev) {
  if (mode === 'rust') process.env.GA_RUST_PHONE_SERVER = '1';
  else delete process.env.GA_RUST_PHONE_SERVER;
  const app = await launchApp({
    target: { ...target, args: [`--inspect=127.0.0.1:${INSPECT_PORT}`, ...target.args] },
    root, devUrl: dev.url, cdpPort: CDP_PORT, runIndex: MODES.indexOf(mode), sessionDir: outDir, hidden: true,
    log, onConsole: () => {}, onEvent: () => {},
  });
  let main = null;
  try {
    main = await mainInspector(INSPECT_PORT);
    const remote = await app.session.eval('window.ghostRemote.info()', 10000);
    const rows = await listProcesses();
    const rustRunning = rows.some((r) => /ghost-phone-server/.test(r.args));
    log(`${mode}: remote ws ${remote.wsPort} http ${remote.httpPort}; Rust server process ${rustRunning ? 'running' : 'absent'}`);
    if ((mode === 'rust') !== rustRunning) throw new Error(`mode ${mode} but the Rust server is ${rustRunning ? 'running' : 'not running'}`);
    await sleep(3000);
    const results = [];
    for (const name of SCENARIOS) {
      const r = await scenario(name, app, main, remote);
      log(mode, JSON.stringify(r));
      results.push(r);
    }
    return { mode, remote: { wsPort: remote.wsPort, httpPort: remote.httpPort }, results };
  } finally {
    main?.close();
    await app.stop({ graceful: true }).catch(() => {});
  }
}

const dev = await ensureDevServer({ root, port: DEV_PORT, sessionDir: outDir, log });
const target = resolveTarget({ root, appPath: null, sessionDir: outDir, log });
const all = [];
try {
  for (const mode of MODES) all.push(await runMode(mode, target, dev));
} finally {
  await dev.stop?.();
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(all, null, 2));
log(`results in ${path.join(outDir, 'results.json')}`);
for (const m of all) {
  for (const r of m.results) {
    console.log([m.mode.padEnd(5), r.scenario.padEnd(7),
      `main ${r.cpuPct.main}%`, `renderer ${r.cpuPct.renderer}%`, `server ${r.cpuPct.phoneServer ?? '-'}%`,
      `eld p50 ${r.mainEventLoopMs.p50} p99 ${r.mainEventLoopMs.p99} max ${r.mainEventLoopMs.max}`,
      r.relayMs ? `relay p50 ${r.relayMs.p50} p99 ${r.relayMs.p99} max ${r.relayMs.max} (${r.strokes.received}/${r.strokes.sent})` : ''].join(' | '));
  }
}
