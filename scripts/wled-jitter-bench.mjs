/**
 * WLED output: packet timing, CPU and LED colours, app path vs render core.
 *
 *   node scripts/wled-jitter-bench.mjs [--strips 4] [--leds 300] [--fps 20] [--seconds 20]
 *     [--modes off,app,core] [--port 9741] [--dev-port 9745] [--udp-port 21324] [--out <dir>]
 *
 * Starts the source checkout hidden on a throwaway profile (as the soak test
 * does), shows a scrolling test shader, adds N WLED controllers at
 * 127.0.0.1 on UDP ports --udp-port.. (one per strip) and listens on them
 * itself. For each mode it records every DRGB packet's kernel receive time,
 * the CPU of the editor page, the Electron main process and the render
 * core, and the last frame each strip got.
 *
 *   off   no WLED controllers (the frame-cost baseline)
 *   app   GA_CORE_WLED=0: the editor samples the composite mirror and the
 *         main process sends
 *   core  the render core samples and sends
 *
 * --fps sets both paths' rate: the app path follows the composite mirror,
 * so the bench holds a mirror handle at that rate in the page; the core
 * path is set with GA_CORE_WLED_FPS. The shipping rate is 20 on both.
 *
 * Then a static picture (--static-seconds) checks the LED colours: each
 * mode's last frame against the editor's own sampler on the 192 px raw
 * mirror, and app against core.
 *
 * In core mode the first strip is then moved to the app path and back (an
 * LED FX with amount 0 reaches it, then stops): the longest gap between its
 * packets around each move and any all-black packet are reported.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDevServer, resolveTarget, launchApp } from './soak/lib/app.mjs';
import { sampleTree } from './soak/lib/proc.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const STRIPS = Number(arg('strips', '4'));
const LEDS = Number(arg('leds', '300'));
const FPS = Number(arg('fps', '20'));
const SECONDS = Number(arg('seconds', '20'));
const STATIC_SECONDS = Number(arg('static-seconds', '3'));
const WARMUP_MS = Number(arg('warmup', '3000'));
const MODES = arg('modes', 'off,app,core').split(',');
const CDP_PORT = Number(arg('port', '9741'));
const DEV_PORT = Number(arg('dev-port', '9745'));
const UDP_PORT = Number(arg('udp-port', '21324'));
const outDir = path.resolve(arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'wled-bench-'))));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(path.join(outDir, 'logs'), { recursive: true });
const log = (...m) => console.log('[bench]', ...m);

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const sd = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
  const q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  return { n: values.length, mean, sd, p50: q(0.5), p99: q(0.99), min: sorted[0], max: sorted[sorted.length - 1] };
}

// Kernel receive times (SO_TIMESTAMP), so a busy machine delaying this
// script does not count as output jitter.
const LISTENER_PY = `
import socket, struct, sys, select
SO_TIMESTAMP = getattr(socket, 'SO_TIMESTAMP', 0x400 if sys.platform == 'darwin' else 29)
SCM_TIMESTAMP = getattr(socket, 'SCM_TIMESTAMP', 2 if sys.platform == 'darwin' else SO_TIMESTAMP)
socks = []
for port in [int(p) for p in sys.argv[1].split(',')]:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, SO_TIMESTAMP, 1)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 1 << 20)
    s.bind(('127.0.0.1', port))
    socks.append((s, port))
print('ready', flush=True)
out = sys.stdout
by_fd = {s.fileno(): (s, port) for s, port in socks}
while True:
    ready, _, _ = select.select([s for s, _ in socks], [], [])
    for r in ready:
        s, port = by_fd[r.fileno()]
        data, anc, _, _ = s.recvmsg(2000, socket.CMSG_SPACE(16))
        t = None
        for level, kind, value in anc:
            if level == socket.SOL_SOCKET and kind == SCM_TIMESTAMP and len(value) >= 12:
                sec, usec = struct.unpack('qi', value[:12])
                t = sec * 1000.0 + usec / 1000.0
        if t is None or len(data) < 5 or data[0] != 2:
            continue
        out.write('%.3f %d %d %s\\n' % (t, port, data[1], data[2:].hex()))
        out.flush()
`;

async function listen(ports) {
  const { spawn } = await import('node:child_process');
  const child = spawn('python3', ['-I', '-u', '-c', LISTENER_PY, ports.join(',')], { stdio: ['ignore', 'pipe', 'inherit'] });
  const packets = [];
  let buffer = '';
  let ready;
  const readyPromise = new Promise((resolve) => { ready = resolve; });
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line === 'ready') { ready(); continue; }
      const [t, port, timeout, hex] = line.split(' ');
      packets.push({ at: Number(t), port: Number(port), timeout: Number(timeout), hex });
    }
  });
  await Promise.race([readyPromise, sleep(5000).then(() => { throw new Error(`UDP listener did not start (ports ${ports.join(',')} busy?)`); })]);
  return { close: () => child.kill(), packets };
}

const CONTROLLERS_JS = `(() => {
  const list = [];
  for (let i = 0; i < ${STRIPS}; i++) list.push({
    id: 'bench-' + i, name: 'Bench ' + i, ipAddr: '127.0.0.1', port: ${UDP_PORT} + i, ledCount: ${LEDS}, enabled: true,
    brightness: 1, gamma: 1, samplingMode: 'dominant',
    mapping: { mode: 'strip', axis: 'horizontal', columns: 16, serpentine: false, reverse: false, flipX: false, flipY: false,
      sourceRegion: { x: 0, y: (i + 0.5) / ${STRIPS} - 0.01, width: 1, height: 0.02 }, sampleRadius: 0.01 },
  });
  return list;
})()`;

// A moving picture (every frame differs, so every tick sends) and a still one.
const MOVING_SHADER = `/*{ "DESCRIPTION": "bench", "INPUTS": [] }*/
void main() {
  vec2 uv = isf_FragNormCoord;
  float t = TIME * 0.7;
  gl_FragColor = vec4(0.5 + 0.5 * sin(uv.x * 9.0 + t * 3.0), 0.5 + 0.5 * sin(uv.y * 7.0 - t * 2.0), 0.5 + 0.5 * sin((uv.x + uv.y) * 5.0 + t), 1.0);
}`;

function analyse(packets, started, ended) {
  const inRun = packets.filter((p) => p.at >= started && p.at <= ended);
  const byPort = new Map();
  for (const p of inRun) (byPort.get(p.port) ?? byPort.set(p.port, []).get(p.port)).push(p);
  const intervals = [];
  for (const list of byPort.values()) for (let i = 1; i < list.length; i++) intervals.push(list[i].at - list[i - 1].at);
  // An unchanged frame is not sent again (until the keep-alive), so a strip
  // may skip ticks when no new picture came: the distance of each interval
  // from a whole number of periods is the timing error.
  const period = 1000 / FPS;
  const phase = intervals.map((v) => Math.abs(v - Math.max(1, Math.round(v / period)) * period));
  // Spread of one tick's strips on the wire.
  const first = byPort.get(UDP_PORT) ?? [];
  const spreads = [];
  for (const p of first) {
    const group = inRun.filter((q) => Math.abs(q.at - p.at) < 1000 / FPS / 2);
    if (group.length >= STRIPS) spreads.push(Math.max(...group.map((q) => q.at)) - Math.min(...group.map((q) => q.at)));
  }
  return { count: inRun.length, ports: byPort.size, interval: stats(intervals), phase: stats(phase), spread: stats(spreads), timeouts: [...new Set(inRun.map((p) => p.timeout))] };
}

async function runMode(mode, target, dev, listener) {
  const saved = { core: process.env.GA_CORE_WLED, fps: process.env.GA_CORE_WLED_FPS };
  if (mode === 'app') process.env.GA_CORE_WLED = '0';
  else delete process.env.GA_CORE_WLED;
  process.env.GA_CORE_WLED_FPS = String(FPS);
  const app = await launchApp({
    target, root, devUrl: dev.url, cdpPort: CDP_PORT, runIndex: MODES.indexOf(mode), sessionDir: outDir, hidden: true,
    log, onConsole: () => {}, onEvent: () => {},
  });
  for (const [key, value] of [['GA_CORE_WLED', saved.core], ['GA_CORE_WLED_FPS', saved.fps]]) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  try {
    const page = (body) => app.session.eval(`(async () => { const G = window.__ghostArcade; ${body} })()`, 30000);
    const layer = await page(`
      const id = G.project.addLayer('Bench', 'media');
      window.__benchLayer = id;
      G.project.setLayerSource(id, { id: crypto.randomUUID(), type: 'shader', src: 'bench.fs', name: 'Bench', shaderCode: ${JSON.stringify(MOVING_SHADER)}, shaderValues: {} });
      return id;`);
    await sleep(Math.min(3000, WARMUP_MS));
    if (mode !== 'off') {
      await page(`for (const c of ${CONTROLLERS_JS}) G.project.addWLEDController(c); return true;`);
      // The app path follows the composite mirror's rate: hold it at --fps.
      if (mode === 'app' && FPS !== 20) {
        await page(`const m = await import('/src/lib/sync/nativeCompositeMirror.ts'); window.__benchMirror = m.acquireNativeCompositeMirror({ maxDim: 192, fps: ${FPS} }); return true;`);
      }
    }
    await sleep(WARMUP_MS);
    await app.session.call('Performance.enable', {}, 5000).catch(() => {});
    const m0 = await app.session.metrics();
    let tree = await sampleTree(app.pid);
    const started = Date.now();
    await sleep(SECONDS * 1000);
    const ended = Date.now();
    tree = await sampleTree(app.pid, tree);
    const m1 = await app.session.metrics();
    const timing = analyse(listener.packets, started, ended);
    const coreStats = mode === 'off' ? null : await page(`return await window.electronAPI.invoke('wled_get_stats', {});`).catch(() => null);
    // What the app path samples: the shared mirror grows to the largest consumer's size.
    const mirror = await page(`const m = await import('/src/lib/sync/nativeCompositeMirror.ts'); const c = m.compositeMirrorCanvas(); const px = m.compositeMirrorPixels(); return { canvas: c ? [c.width, c.height] : null, raw: px ? [px.width, px.height] : null };`).catch(() => null);
    const links = mode === 'off' ? null : await page(`return await window.electronAPI.invoke('wled_link_status');`).catch(() => null);

    // Colours on a still picture.
    let colour = null;
    let last = {};
    if (mode !== 'off') {
      await page(`
        const src = './ISF/DM-TestBars.fs';
        const code = await (await fetch(src)).text();
        G.project.setLayerSource(window.__benchLayer, { id: crypto.randomUUID(), type: 'shader', src, name: 'DM-TestBars', shaderCode: code, shaderValues: {} });
        return true;`);
      await sleep(STATIC_SECONDS * 1000);
      const cut = Date.now() - 300;
      for (const p of listener.packets) if (p.at <= cut && p.at >= cut - 2000) last[p.port] = p.hex;
      const expected = await page(`
        let snap = null;
        for (let i = 0; i < 20 && !snap?.rgba_b64; i++) {
          snap = await window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: true, max_dim: 192, live_output: true }).catch(() => null);
          if (!snap?.rgba_b64) await new Promise((r) => setTimeout(r, 50));
        }
        const raw = Uint8Array.from(atob(snap.rgba_b64), (c) => c.charCodeAt(0));
        const bgra = /bgra/i.test(String(snap.format));
        const data = new Uint8ClampedArray(snap.width * snap.height * 4);
        for (let i = 0; i < data.length; i += 4) {
          data[i] = raw[bgra ? i + 2 : i]; data[i + 1] = raw[i + 1]; data[i + 2] = raw[bgra ? i : i + 2]; data[i + 3] = 255;
        }
        const mapping = await import('/src/lib/wled/mapping.ts');
        const out = { size: [snap.width, snap.height] };
        for (const c of window.__soak.read(G.project).wledControllers) {
          const resolved = mapping.resolveWLEDMapping(c.ledCount, c.mapping, snap.width / snap.height);
          const n = resolved.points.length * 3;
          const source = new Uint8Array(n); const rgb = new Uint8Array(n);
          mapping.sampleWLEDSourcePixels(data, snap.width, snap.height, resolved.points, resolved.sampleRadius, source, c.samplingMode ?? 'dominant');
          mapping.calibrateWLEDPixels(source, rgb, { brightness: c.brightness, gamma: c.gamma, calibration: c.calibration }, new Uint8Array(n));
          out[c.port] = Array.from(rgb, (b) => b.toString(16).padStart(2, '0')).join('');
        }
        return out;`).catch((error) => ({ error: String(error) }));
      if (expected && !expected.error) {
        let equal = 0; let differ = 0; let maxDiff = 0; let missing = 0;
        for (let i = 0; i < STRIPS; i++) {
          const port = UDP_PORT + i;
          const a = Buffer.from(last[port] ?? '', 'hex');
          const b = Buffer.from(expected[port] ?? '', 'hex');
          if (a.length === 0) { missing++; continue; }
          for (let j = 0; j < b.length; j++) {
            const d = Math.abs((a[j] ?? 0) - b[j]);
            if (d === 0) equal++; else differ++;
            maxDiff = Math.max(maxDiff, d);
          }
        }
        colour = { picture: expected.size, equal, differ, maxDiff, missingStrips: missing };
      } else colour = expected;
    }
    let handover = null;
    if (mode === 'core') {
      // Back to the moving picture, so every tick sends and a gap shows.
      await page(`G.project.setLayerSource(window.__benchLayer, { id: crypto.randomUUID(), type: 'shader', src: 'bench.fs', name: 'Bench', shaderCode: ${JSON.stringify(MOVING_SHADER)}, shaderValues: {} }); return true;`);
      await sleep(1000);
      const t0 = Date.now();
      await page(`
        const fx = await import('/src/lib/wled/effects.ts');
        const effect = { ...fx.createWLEDEffect('chase'), id: 'bench-fx', active: true, amount: 0, target: { mode: 'controller', controllerId: 'bench-0' } };
        G.project.addWLEDEffect(effect);
        return true;`);
      await sleep(2000);
      const onApp = await page(`return (await window.electronAPI.invoke('wled_link_status')).map((l) => [l.controllerId, l.core === true]);`).catch(() => null);
      const t1 = Date.now();
      await page(`G.project.removeWLEDEffect('bench-fx'); return true;`);
      await sleep(2000);
      const backOnCore = await page(`return (await window.electronAPI.invoke('wled_link_status')).map((l) => [l.controllerId, l.core === true]);`).catch(() => null);
      const t2 = Date.now();
      const strip = listener.packets.filter((p) => p.port === UDP_PORT && p.at >= t0 - 500 && p.at <= t2);
      const gap = (from, to) => {
        const list = strip.filter((p) => p.at >= from - 300 && p.at <= to);
        let max = 0;
        for (let i = 1; i < list.length; i++) max = Math.max(max, list[i].at - list[i - 1].at);
        return max;
      };
      handover = {
        toAppMaxGapMs: gap(t0, t1),
        toCoreMaxGapMs: gap(t1, t2),
        blackPackets: strip.filter((p) => /^0+$/.test(p.hex)).length,
        // Gaps over two periods: [ms after the move to the app, length].
        longGaps: strip.slice(1).map((p, i) => [Math.round(strip[i].at - t0), Math.round(p.at - strip[i].at)]).filter(([, g]) => g > 2000 / FPS),
        secondMoveAtMs: t1 - t0,
        packets: strip.length,
        onApp,
        backOnCore,
      };
    }
    return {
      mode,
      fps: FPS,
      handover,
      seconds: (ended - started) / 1000,
      packets: timing.count,
      strips: timing.ports,
      packetsPerSecond: timing.count / ((ended - started) / 1000),
      interval: timing.interval,
      phase: timing.phase,
      mirror,
      spread: timing.spread,
      timeoutByte: timing.timeouts,
      cpu: Object.fromEntries(Object.entries(tree.roles).map(([role, r]) => [role, r.cpuPct])),
      editorTaskMsPerSec: ((m1.TaskDuration ?? 0) - (m0.TaskDuration ?? 0)) * 1000 / ((ended - started) / 1000),
      editorScriptMsPerSec: ((m1.ScriptDuration ?? 0) - (m0.ScriptDuration ?? 0)) * 1000 / ((ended - started) / 1000),
      coreStats: coreStats ? { ...coreStats, controllers: undefined } : null,
      links,
      colourVsEditorSampler: colour,
      lastData: last,
    };
  } finally {
    await app.stop({ graceful: true }).catch(() => {});
    await sleep(2000);
  }
}

const ports = Array.from({ length: STRIPS }, (_, i) => UDP_PORT + i);
const listener = await listen(ports);
const dev = await ensureDevServer({ root, port: DEV_PORT, sessionDir: outDir, log });
const target = resolveTarget({ root, appPath: null, sessionDir: outDir, log });
const results = [];
try {
  for (const mode of MODES) {
    log(`mode ${mode}: ${SECONDS}s at ${FPS} fps, ${STRIPS} x ${LEDS} LEDs`);
    results.push(await runMode(mode, target, dev, listener));
  }
} finally {
  dev.stop();
  listener.close();
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
const f = (v, d = 2) => (v === undefined || v === null ? '-' : Number(v).toFixed(d));
console.log('\nmode  pkts/s  strip-int mean/sd/p99/max (ms)   timing err p50/p99/max   spread p99  editor task ms/s  cpu% renderer/main/core');
for (const r of results) {
  console.log([
    r.mode.padEnd(5),
    f(r.packetsPerSecond, 0).padStart(6),
    `${f(r.interval?.mean)}/${f(r.interval?.sd)}/${f(r.interval?.p99)}/${f(r.interval?.max)}`.padStart(28),
    `${f(r.phase?.p50)}/${f(r.phase?.p99)}/${f(r.phase?.max)}`.padStart(22),
    f(r.spread?.p99).padStart(10),
    f(r.editorTaskMsPerSec, 1).padStart(14),
    `${f(r.cpu.renderer, 1)}/${f(r.cpu.main, 1)}/${f(r.cpu.core, 1)}`.padStart(20),
  ].join('  '));
}
const appRun = results.find((r) => r.mode === 'app');
const coreRun = results.find((r) => r.mode === 'core');
if (appRun && coreRun) {
  let same = 0; let differ = 0; let maxDiff = 0;
  for (const [port, hex] of Object.entries(appRun.lastData)) {
    const a = Buffer.from(hex, 'hex');
    const b = Buffer.from(coreRun.lastData[port] ?? '', 'hex');
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - (b[i] ?? 0));
      if (d === 0) same++; else differ++;
      maxDiff = Math.max(maxDiff, d);
    }
  }
  console.log(`\nLED bytes app vs core (still picture): ${same} equal, ${differ} differ, max difference ${maxDiff}`);
}
for (const r of results) {
  if (r.handover) console.log(`${r.mode}: hand-over of strip 0 to the app and back: ${JSON.stringify(r.handover)}`);
  if (r.colourVsEditorSampler) console.log(`${r.mode}: wire vs the editor sampler on the raw 192 px mirror: ${JSON.stringify(r.colourVsEditorSampler)} (mirror ${JSON.stringify(r.mirror)})`);
}
console.log(`\nresults: ${path.join(outDir, 'results.json')}`);
