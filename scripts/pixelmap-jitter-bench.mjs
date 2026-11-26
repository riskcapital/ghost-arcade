/**
 * Art-Net pixel-map output: packet timing and CPU, app path vs render core.
 *
 *   node scripts/pixelmap-jitter-bench.mjs [--universes 16] [--fps 40] [--seconds 30]
 *     [--modes off,app,core] [--port 9447] [--dev-port 1447] [--out <dir>]
 *
 * Starts the source checkout hidden on a throwaway profile (as the soak test
 * does), shows a static test-bars shader, patches N 170-pixel Art-Net strips
 * at 127.0.0.1 universes 0..N-1, and listens on UDP 6454 itself. For each
 * mode it records every ArtDmx packet's arrival time, the CPU of the editor
 * page (main-thread task time), the Electron main process and the render
 * core, and the DMX values of the last frame.
 *
 *   off   pixel mapping disabled (the frame-cost baseline)
 *   app   GA_CORE_PIXELMAP=0: the editor samples and the main process sends
 *   core  the render core samples and sends
 *
 * Prints a table and writes results.json to --out.
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
const UNIVERSES = Number(arg('universes', '16'));
const FPS = Number(arg('fps', '40'));
const SECONDS = Number(arg('seconds', '30'));
// Wait after the scene and after enabling output. Note that a hidden window
// never gets the editor's native presenter, so about 15 s after start the
// editor's 1024 px JPEG preview fallback starts and the app path samples
// that (as it does whenever the VJ panel preview or a projection sim is up).
const WARMUP_MS = Number(arg('warmup', '5000'));
const MODES = arg('modes', 'off,app,core').split(',');
const CDP_PORT = Number(arg('port', '9447'));
const DEV_PORT = Number(arg('dev-port', '1447'));
const outDir = path.resolve(arg('out', fs.mkdtempSync(path.join(os.tmpdir(), 'pixelmap-bench-'))));
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

// The listener stamps packets with the kernel's receive time (SO_TIMESTAMP),
// so a busy machine delaying this script does not count as output jitter.
const LISTENER_PY = `
import socket, struct, sys
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
SO_TIMESTAMP = getattr(socket, 'SO_TIMESTAMP', 0x400 if sys.platform == 'darwin' else 29)
SCM_TIMESTAMP = getattr(socket, 'SCM_TIMESTAMP', 2 if sys.platform == 'darwin' else SO_TIMESTAMP)
s.setsockopt(socket.SOL_SOCKET, SO_TIMESTAMP, 1)
s.bind(('127.0.0.1', 6454))
print('ready', flush=True)
out = sys.stdout
while True:
    data, anc, _, _ = s.recvmsg(1500, socket.CMSG_SPACE(16))
    t = None
    for level, kind, value in anc:
        if level == socket.SOL_SOCKET and kind == SCM_TIMESTAMP and len(value) >= 12:
            sec, usec = struct.unpack('qi', value[:12])
            t = sec * 1000.0 + usec / 1000.0
    if t is None or len(data) < 18 or data[:8] != b'Art-Net\\0' or data[8:10] != b'\\x00\\x50':
        continue
    out.write('%.3f %d %d %s\\n' % (t, data[14] | (data[15] << 8), data[12], data[18:].hex()))
    out.flush()
`;

async function listen() {
  const { spawn } = await import('node:child_process');
  const child = spawn('python3', ['-I', '-u', '-c', LISTENER_PY], { stdio: ['ignore', 'pipe', 'inherit'] });
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
      const [t, universe, sequence, hex] = line.split(' ');
      packets.push({ at: Number(t), universe: Number(universe), sequence: Number(sequence), data: Buffer.from(hex, 'hex') });
    }
  });
  await Promise.race([readyPromise, sleep(5000).then(() => { throw new Error('UDP listener did not start (port 6454 busy?)'); })]);
  return { socket: { close: () => child.kill() }, packets };
}

/** Wall clock in ms, the listener's time base. */
const wallMs = () => Date.now();

const FIXTURES_JS = (universes) => `(() => {
  const fixtures = [];
  for (let i = 0; i < ${universes}; i++) fixtures.push({
    id: 'bench-' + i, name: 'Bench ' + i, enabled: true, type: 'strip', pixelCount: 170, colorOrder: 'RGB',
    protocol: 'artnet', delivery: 'unicast', address: '127.0.0.1', universe: i, channel: 1,
    mapping: { mode: 'strip', axis: 'horizontal', columns: 16, serpentine: false, reverse: false, flipX: false, flipY: false,
      sourceRegion: { x: 0, y: (i + 0.5) / ${universes} - 0.01, width: 1, height: 0.02 }, sampleRadius: 0.01 },
    brightness: 1, gamma: 1, samplingMode: 'average', testPattern: 'off', testColor: '#ffffff',
  });
  return fixtures;
})()`;

async function runMode(mode, target, dev, listener) {
  const before = process.env.GA_CORE_PIXELMAP;
  if (mode === 'app') process.env.GA_CORE_PIXELMAP = '0';
  else delete process.env.GA_CORE_PIXELMAP;
  const app = await launchApp({
    target, root, devUrl: dev.url, cdpPort: CDP_PORT, runIndex: MODES.indexOf(mode), sessionDir: outDir, hidden: true,
    log, onConsole: () => {}, onEvent: () => {},
  });
  if (before === undefined) delete process.env.GA_CORE_PIXELMAP;
  else process.env.GA_CORE_PIXELMAP = before;
  try {
    const page = (body) => app.session.eval(`(async () => { const G = window.__ghostArcade; ${body} })()`, 30000);
    await page(`
      const id = G.project.addLayer('Bench bars', 'media');
      const src = './ISF/DM-TestBars.fs';
      const code = await (await fetch(src)).text();
      G.project.setLayerSource(id, { id: crypto.randomUUID(), type: 'shader', src, name: 'DM-TestBars', shaderCode: code, shaderValues: {} });
      return id;`);
    await sleep(Math.min(3000, WARMUP_MS));
    if (mode !== 'off') {
      await page(`G.project.updatePixelMap({ enabled: true, fps: ${FPS}, artSync: false, fixtures: ${FIXTURES_JS(UNIVERSES)} }); return true;`);
    }
    await sleep(WARMUP_MS);
    await app.session.call('Performance.enable', {}, 5000).catch(() => {});
    const m0 = await app.session.metrics();
    let tree = await sampleTree(app.pid);
    listener.packets.length = 0;
    const started = wallMs();
    await sleep(SECONDS * 1000);
    const ended = wallMs();
    await sleep(300);
    tree = await sampleTree(app.pid, tree);
    const m1 = await app.session.metrics();
    const packets = listener.packets.filter((p) => p.at >= started && p.at <= ended);
    const core = await page(`return await window.electronAPI.invoke('pixelmap_get_stats', {});`).catch(() => null);
    const byUniverse = new Map();
    for (const p of packets) (byUniverse.get(p.universe) ?? byUniverse.set(p.universe, []).get(p.universe)).push(p);
    const intervals = [];
    for (const list of byUniverse.values()) for (let i = 1; i < list.length; i++) intervals.push(list[i].at - list[i - 1].at);
    const u0 = byUniverse.get(0) ?? [];
    const frameIntervals = u0.slice(1).map((p, i) => p.at - u0[i].at);
    // Spread of one frame's universes on the wire.
    const spreads = [];
    for (const p of u0) {
      const group = packets.filter((q) => Math.abs(q.at - p.at) < 1000 / FPS / 2);
      if (group.length >= UNIVERSES) spreads.push(Math.max(...group.map((q) => q.at)) - Math.min(...group.map((q) => q.at)));
    }
    const last = {};
    for (const [u, list] of byUniverse) last[u] = Buffer.from(list[list.length - 1].data).toString('hex');
    // The editor path's sampler over the same picture the core reads (the
    // 384 px raw output mirror; the scene is static), for the colour check.
    const editorDmx = mode === 'off' ? null : await page(`
      let snap = null;
      // A busy live preview answers null; ask again.
      for (let i = 0; i < 20 && !snap?.rgba_b64; i++) {
        snap = await window.electronAPI.invoke('native_renderer_get_frame_snapshot', { include_pixels: true, max_dim: 384, live_output: true }).catch(() => null);
        if (!snap?.rgba_b64) await new Promise((r) => setTimeout(r, 50));
      }
      const raw = Uint8Array.from(atob(snap.rgba_b64), (c) => c.charCodeAt(0));
      const bgra = /bgra/i.test(String(snap.format));
      const data = new Uint8ClampedArray(snap.width * snap.height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = raw[bgra ? i + 2 : i]; data[i + 1] = raw[i + 1]; data[i + 2] = raw[bgra ? i : i + 2]; data[i + 3] = 255;
      }
      const mapping = await import('/src/lib/wled/mapping.ts');
      const fixtures = await import('/src/lib/pixelmap/fixtures.ts');
      const config = fixtures.normalizePixelMapConfig(window.__soak.read(G.project).pixelMap);
      const pixels = new Map();
      for (const f of config.fixtures) {
        const resolved = fixtures.resolveFixtureMapping(f, snap.width / snap.height);
        const n = resolved.points.length * 3;
        const source = new Uint8Array(n); const rgb = new Uint8Array(n);
        mapping.sampleWLEDSourcePixels(data, snap.width, snap.height, resolved.points, resolved.sampleRadius, source, f.samplingMode ?? 'average');
        mapping.calibrateWLEDPixels(source, rgb, { brightness: f.brightness, gamma: f.gamma, calibration: f.calibration }, new Uint8Array(n));
        pixels.set(f.id, rgb);
      }
      const frame = fixtures.buildPixelMapFrame(config, pixels);
      const out = { size: [snap.width, snap.height] };
      for (const u of frame.universes) out[u.universe] = Array.from(u.data, (b) => b.toString(16).padStart(2, '0')).join('');
      return out;`).catch((error) => ({ error: String(error) }));
    let colour = null;
    if (editorDmx && !editorDmx.error) {
      let equal = 0; let differ = 0; let maxDiff = 0;
      for (const [u, hex] of Object.entries(last)) {
        const a = Buffer.from(hex, 'hex');
        const b = Buffer.from(editorDmx[u] ?? '', 'hex');
        for (let i = 0; i < a.length; i++) {
          const d = Math.abs(a[i] - (b[i] ?? 0));
          if (d === 0) equal++; else differ++;
          maxDiff = Math.max(maxDiff, d);
        }
      }
      colour = { picture: editorDmx.size, equal, differ, maxDiff };
    }
    const result = {
      mode,
      seconds: (ended - started) / 1000,
      packets: packets.length,
      universes: byUniverse.size,
      packetsPerSecond: packets.length / ((ended - started) / 1000),
      frameInterval: stats(frameIntervals),
      universeInterval: stats(intervals),
      frameSpread: stats(spreads),
      cpu: Object.fromEntries(Object.entries(tree.roles).map(([role, r]) => [role, r.cpuPct])),
      editorTaskMsPerSec: ((m1.TaskDuration ?? 0) - (m0.TaskDuration ?? 0)) * 1000 / ((ended - started) / 1000),
      editorScriptMsPerSec: ((m1.ScriptDuration ?? 0) - (m0.ScriptDuration ?? 0)) * 1000 / ((ended - started) / 1000),
      core,
      colourVsEditorSampler: colour ?? editorDmx,
      lastData: last,
    };
    return result;
  } finally {
    await app.stop({ graceful: true }).catch(() => {});
    await sleep(2000);
  }
}

const listener = await listen();
const dev = await ensureDevServer({ root, port: DEV_PORT, sessionDir: outDir, log });
const target = resolveTarget({ root, appPath: null, sessionDir: outDir, log });
const results = [];
try {
  for (const mode of MODES) {
    log(`mode ${mode}: ${SECONDS}s`);
    results.push(await runMode(mode, target, dev, listener));
  }
} finally {
  dev.stop();
  listener.socket.close();
}
fs.writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 1));
const f = (v, d = 2) => (v === undefined || v === null ? '-' : Number(v).toFixed(d));
console.log('\nmode  pkts/s  frame-int mean/sd/p99/max (ms)   univ-int sd/p99   spread p99  editor task ms/s  cpu% renderer/main/core');
for (const r of results) {
  console.log([
    r.mode.padEnd(5),
    f(r.packetsPerSecond, 0).padStart(6),
    `${f(r.frameInterval?.mean)}/${f(r.frameInterval?.sd)}/${f(r.frameInterval?.p99)}/${f(r.frameInterval?.max)}`.padStart(28),
    `${f(r.universeInterval?.sd)}/${f(r.universeInterval?.p99)}`.padStart(14),
    f(r.frameSpread?.p99).padStart(10),
    f(r.editorTaskMsPerSec, 1).padStart(14),
    `${f(r.cpu.renderer, 1)}/${f(r.cpu.main, 1)}/${f(r.cpu.core, 1)}`.padStart(20),
  ].join('  '));
}
const app = results.find((r) => r.mode === 'app');
const core = results.find((r) => r.mode === 'core');
if (app && core) {
  let same = 0; let differ = 0; let maxDiff = 0;
  for (const [u, hex] of Object.entries(app.lastData)) {
    const a = Buffer.from(hex, 'hex');
    const b = Buffer.from(core.lastData[u] ?? '', 'hex');
    for (let i = 0; i < a.length; i++) {
      const d = Math.abs(a[i] - (b[i] ?? 0));
      if (d === 0) same++; else differ++;
      maxDiff = Math.max(maxDiff, d);
    }
  }
  console.log(`\nDMX values app vs core: ${same} equal, ${differ} differ, max difference ${maxDiff}`);
}
for (const r of results) {
  if (r.colourVsEditorSampler) console.log(`${r.mode}: wire DMX vs the editor sampler on the raw 384 px mirror: ${JSON.stringify(r.colourVsEditorSampler)}`);
}
console.log(`\nresults: ${path.join(outDir, 'results.json')}`);
