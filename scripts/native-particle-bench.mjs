/**
 * Measure and capture the source-driven particle shaders on the native core.
 *
 *   node scripts/native-particle-bench.mjs --out <dir> [--only a,b] [--seconds 4]
 *
 * Runs Flythrough and Pixel Particles as core-owned graph layers, exactly the
 * way the app does (set_native_graph_layer, not a JS-built graph), over the
 * built-in demo image at 1920x1080. For each workload it records the core's own
 * GPU timestamp-query cost and completed frame rate, and writes a PNG still.
 *
 * Why this exists: the particle work changes shaders that are authored in
 * TypeScript but laid out and driven by Rust, and "it compiles" says nothing
 * about either the cost or the picture. Every change is measured against a
 * saved run of this script and looked at, not assumed.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = path.resolve(argValue('out', path.join(root, 'reports', 'particle-bench')));
const only = argValue('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const sampleSeconds = Number(argValue('seconds', '4'));
const width = Number(argValue('width', '1920'));
const height = Number(argValue('height', '1080'));

const executable = path.join(
  root,
  'native-renderer',
  'target',
  'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core',
);

/* ── workloads ─────────────────────────────────────────────────────────── */
/* Params are the shader defaults plus the few that matter for the question
   being asked. Kept here, in one list, so a before/after run compares like
   with like. Extra params the current build does not understand are ignored
   by the core's normalizers, so later runs can add knobs without breaking
   earlier comparisons. */
const WORKLOADS = [
  { name: 'flythrough-points-250k', kind: 'flythrough', params: { topology: 'points', particleCount: 250_000 } },
  { name: 'flythrough-points-1m', kind: 'flythrough', params: { topology: 'points', particleCount: 1_000_000 } },
  { name: 'flythrough-strokes-250k', kind: 'flythrough', params: { topology: 'strokes', particleCount: 250_000 } },
  { name: 'pixel-depth-250k', kind: 'pixel-particles', params: { mode: 'depth-shift', particleCount: 250_000, depthMotion: 'drift' } },
  { name: 'pixel-depth-1m', kind: 'pixel-particles', params: { mode: 'depth-shift', particleCount: 1_000_000, depthMotion: 'drift' } },
  { name: 'pixel-depth-lit-250k', kind: 'pixel-particles', params: { mode: 'depth-shift', particleCount: 250_000, depthMotion: 'drift', lightEnabled: true } },
  { name: 'pixel-depth-lit-1m', kind: 'pixel-particles', params: { mode: 'depth-shift', particleCount: 1_000_000, depthMotion: 'drift', lightEnabled: true } },
];

/* Extra workloads can be appended from a JSON file so a feature can be
   measured without editing this list: --extra path/to/workloads.json */
const extraPath = argValue('extra', '');
if (extraPath) {
  const { readFileSync } = await import('node:fs');
  WORKLOADS.push(...JSON.parse(readFileSync(path.resolve(extraPath), 'utf8')));
}

/* ── PNG ───────────────────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}

/* ── RPC ───────────────────────────────────────────────────────────────── */
const child = spawn(executable, [], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env, RUST_BACKTRACE: '1' },
});
let stderrTail = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunkText) => {
  stderrTail = (stderrTail + chunkText).slice(-4000);
  if (process.env.GHOST_DEBUG_DIRECTOR) {
    for (const line of String(chunkText).split('\n')) if (line.includes('[director]')) console.log(line);
  }
});
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error || 'native RPC failed'));
});
function rpc(method, params = {}, timeoutMs = 15_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timed out: ${method}\n${stderrTail}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measure(warmupMs, sampleMs) {
  await delay(warmupMs);
  const before = await rpc('status');
  const started = performance.now();
  const gpuSamples = [];
  const steps = Math.max(4, Math.round(sampleMs / 250));
  for (let i = 0; i < steps; i++) {
    await delay(sampleMs / steps);
    const s = await rpc('status');
    const g = Number(s.last_render_gpu_ms || 0);
    if (g > 0) gpuSamples.push(g);
  }
  const after = await rpc('status');
  const elapsed = (performance.now() - started) / 1000;
  const completed = Number(after.gpu_frames_completed || 0) - Number(before.gpu_frames_completed || 0);
  gpuSamples.sort((a, b) => a - b);
  const median = gpuSamples.length ? gpuSamples[Math.floor(gpuSamples.length / 2)] : 0;
  return {
    completed_fps: Number((completed / elapsed).toFixed(1)),
    gpu_ms_ema: Number(Number(after.avg_render_gpu_ms || 0).toFixed(3)),
    gpu_ms_median: Number(median.toFixed(3)),
    gpu_ms_p90: Number((gpuSamples[Math.floor(gpuSamples.length * 0.9)] ?? 0).toFixed(3)),
    cpu_ms_ema: Number(Number(after.avg_render_cpu_ms || 0).toFixed(3)),
    blocked: after.native_graph_blocked ?? after.blocked_layers ?? null,
  };
}

function snapshotToPng(snap, file) {
  const w = Number(snap.width);
  const h = Number(snap.height);
  const padded = Number(snap.padded_bytes_per_row || snap.bytes_per_row || w * 4);
  const src = Buffer.from(String(snap.rgba_b64 || ''), 'base64');
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) src.copy(out, y * w * 4, y * padded, y * padded + w * 4);
  if (/Bgra/i.test(String(snap.format || ''))) {
    for (let i = 0; i < out.length; i += 4) {
      const b = out[i];
      out[i] = out[i + 2];
      out[i + 2] = b;
    }
  }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  writePng(file, w, h, out);
}

const FULLSCREEN = {
  topLeft: { x: 0, y: 1 },
  topRight: { x: 1, y: 1 },
  bottomRight: { x: 1, y: 0 },
  bottomLeft: { x: 0, y: 0 },
};

let vite;
const results = [];
mkdirSync(outDir, { recursive: true });
try {
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const fly = await vite.ssrLoadModule('/src/lib/renderer/webgpuFlythrough.ts');
  const pixel = await vite.ssrLoadModule('/src/lib/renderer/webgpuPixelParticles.ts');
  const demo = await vite.ssrLoadModule('/src/lib/renderer/defaultSourceImage.ts');

  const status0 = await rpc('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width,
      height,
      target_fps: 120,
      native_quality_policy: 'fixed',
      present_mode: 'vsync',
      max_frame_latency: 1,
    },
  }, 20_000);

  const precompile = [
    ...fly.buildFlythroughNativePrecompileCommands(),
    ...pixel.buildPixelParticlesNativePrecompileCommands(),
  ];
  /* --override <shaderId>=<file.wgsl> swaps one shader's source for another
     under the same id, so two versions of a shader can be A/B'd against the
     same Rust job in the same process. Repeatable. */
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--override' || !args[i + 1]) continue;
    const [shaderId, file] = args[i + 1].split('=');
    const { readFileSync } = await import('node:fs');
    const target = precompile.find((command) => command.shader_id === shaderId);
    if (!target) throw new Error(`--override: no shader ${shaderId}`);
    target.source = readFileSync(path.resolve(file), 'utf8');
    console.log(`override ${shaderId} <- ${file}`);
  }
  const compiled = await rpc('submit_commands', { commands: precompile }, 30_000);
  if (Number(compiled?.dropped ?? 0) > 0) {
    throw new Error(`precompile dropped ${compiled.dropped} commands: ${JSON.stringify(compiled).slice(0, 600)}`);
  }
  // A WGSL error is not a dropped command: the core records it and moves on,
  // and the graph only fails later with "has not been precompiled".
  const afterCompile = await rpc('status');
  if (Number(afterCompile.shader_precompile_failed ?? 0) > 0) {
    throw new Error(`shader precompile failed: ${afterCompile.last_shader_error}`);
  }

  const image = demo.renderDefaultGpuSourceImage();
  const sourceId = 'bench:demo-source';
  const imageB64 = Buffer.from(image.rgba.buffer, image.rgba.byteOffset, image.rgba.byteLength).toString('base64');
  let uploadSeq = 0;
  /* Uploaded again before every workload. The core releases a source frame's
     slot once no layer references it, so removing one workload's layer frees
     the demo image and the next workload would find its input "not ready" and
     measure an empty compositor instead. That is what the first version of
     this script did, and the stills gave it away. */
  const uploadSource = () => rpc('submit_commands', {
    commands: [{
      type: 'upload_source_frame',
      source_id: sourceId,
      width: image.width,
      height: image.height,
      rgba_b64: imageB64,
      seq: ++uploadSeq,
    }],
  }, 20_000);

  for (const workload of WORKLOADS) {
    if (only.length && !only.some((o) => workload.name.includes(o))) continue;
    await uploadSource();
    const layerId = `bench-${workload.name}`;
    const outputId = `bench:${workload.name}:output`;
    await rpc('submit_commands', {
      commands: [
        { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN },
        { type: 'set_layer_visibility', layer_id: layerId, visible: true },
        {
          type: 'set_native_graph_layer',
          layer_id: layerId,
          kind: workload.kind,
          instrument_source_id: outputId,
          composite_source_id: outputId,
          input_source_id: sourceId,
          effect_graph: null,
          params: workload.params,
        },
      ],
    }, 15_000);

    const metrics = await measure(2_500, sampleSeconds * 1000);
    /* --sequence <count>x<seconds>: after measuring, take <count> more stills
       <seconds> apart, for anything that changes over time (Auto Camera). */
    const sequenceArg = argValue('sequence', '');
    if (sequenceArg) {
      const [countText, secondsText] = sequenceArg.split('x');
      const frames = Math.max(1, Number(countText) || 1);
      const gap = Math.max(0.1, Number(secondsText) || 1);
      for (let frame = 0; frame < frames; frame++) {
        if (frame > 0) await delay(gap * 1000);
        const shot = await rpc('frame_snapshot', { include_pixels: true }, 30_000);
        snapshotToPng(shot, path.join(outDir, `${workload.name}-seq${String(frame + 1).padStart(2, '0')}.png`));
      }
      console.log(`${workload.name}: ${frames} stills, ${gap}s apart`);
    }
    const graphStatus = await rpc('status');
    const graphError = String(graphStatus.last_shader_error || '');
    if (graphError.includes(layerId)) {
      throw new Error(`${workload.name} did not render: ${graphError}`);
    }
    if (args.includes('--debug')) {
      const s = await rpc('status');
      const pick = Object.fromEntries(Object.entries(s).filter(([k]) => /block|error|graph|layer|fail|skip/i.test(k)));
      console.log(workload.name, JSON.stringify(pick).slice(0, 2500));
    }
    const snap = await rpc('frame_snapshot', { include_pixels: true }, 30_000);
    const png = path.join(outDir, `${workload.name}.png`);
    snapshotToPng(snap, png);
    const row = {
      name: workload.name,
      ...metrics,
      luma: Number(Number(snap.average_luma ?? 0).toFixed(4)),
      dark: Boolean(snap.dark_frame),
      png: path.relative(root, png),
    };
    results.push(row);
    console.log(
      `${workload.name.padEnd(26)} gpu ${String(row.gpu_ms_median).padStart(7)} ms (p90 ${row.gpu_ms_p90})`
      + `  fps ${String(row.completed_fps).padStart(6)}  luma ${row.luma}${row.dark ? '  DARK' : ''}`,
    );

    await rpc('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }] }, 10_000);
    await delay(300);
  }

  const status = await rpc('status');
  const report = {
    at: new Date().toISOString(),
    backend: status.backend,
    adapter: status.adapter_name,
    resolution: `${width}x${height}`,
    started: { backend: status0?.backend },
    results,
  };
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(report, null, 2));
  console.log(`\n${path.relative(root, path.join(outDir, 'results.json'))}  (${status.adapter_name})`);
} finally {
  await vite?.close().catch(() => {});
  await rpc('shutdown', {}, 2_000).catch(() => {});
  child.stdin.end();
}
