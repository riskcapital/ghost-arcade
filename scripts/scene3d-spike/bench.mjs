#!/usr/bin/env node
/**
 * Scene 3D spike (M0): can the native core draw a lit 3D scene with a real
 * shadow map, HDR bloom and a quarter of a million colliding particles, and
 * what does it cost?
 *
 *   node scripts/scene3d-spike/bench.mjs --out <dir> [--seconds 4] [--only balanced]
 *
 * Three things come out:
 *   1. A pixel test: the ground point behind the sphere gets darker when the
 *      shadow map is on, and a point outside the shadow does not change.
 *   2. GPU cost and frame rate for four size tiers.
 *   3. A still per tier, to look at.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { deflateSync } from 'node:zlib';
import { HEIGHT, SCENE_SHADER, SHADOW_TEST_CASES, WIDTH, buildGraph, shaderSources, shadowTestGraph, shadowTestResult, snapshotPixels } from './scene.mjs';

const here = import.meta.dirname;
const root = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const outDir = path.resolve(argValue('out', path.join(root, 'reports', 'scene3d-spike')));
const only = argValue('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const sampleSeconds = Number(argValue('seconds', '4'));
const warmSeconds = Number(argValue('warm', '8'));
const executable = process.env.GA_NATIVE_RENDER_CORE_PATH
  || path.join(root, 'native-renderer', 'target', 'release', 'ghost-render-core');

const TIERS = [
  { name: 'performance', particles: 65_536, shadow: 1024, scene: 1024 },
  { name: 'balanced', particles: 250_000, shadow: 2048, scene: 1536 },
  { name: 'default', particles: 500_000, shadow: 2048, scene: 2048 },
  { name: 'insane', particles: 1_000_000, shadow: 4096, scene: 3072 },
];

/* ── PNG ───────────────────────────────────────────────────────────────── */
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
/* ── RPC ───────────────────────────────────────────────────────────────── */
const child = spawn(executable, [], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, RUST_BACKTRACE: '1' } });
let stderrTail = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (text) => { stderrTail = (stderrTail + text).slice(-6000); });
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message; try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id); if (!waiter) return;
  pending.delete(message.id); clearTimeout(waiter.timer);
  if (message.ok) waiter.resolve(message.result); else waiter.reject(new Error(message.error || 'native RPC failed'));
});
function rpc(method, params = {}, timeoutMs = 20_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timed out: ${method}\n${stderrTail}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const FULLSCREEN = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

async function showLayer(layerId, sourceId) {
  await rpc('submit_commands', { commands: [
    { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN },
    { type: 'set_layer_visibility', layer_id: layerId, visible: true },
    { type: 'bind_media_source', layer_id: layerId, source_id: sourceId, uri: 'native-graph://scene3d-spike', source_type: 'image' },
  ] });
}
async function hideLayer(layerId) {
  await rpc('submit_commands', { commands: [{ type: 'remove_layer', layer_id: layerId }] }).catch(() => {});
}
async function grab() {
  await delay(250);
  return snapshotPixels(await rpc('frame_snapshot', { include_pixels: true }, 30_000));
}
async function checkErrors(label) {
  const s = await rpc('status');
  const error = String(s.last_shader_error || s.last_frame_error || '');
  if (error) throw new Error(`${label}: ${error}`);
  return s;
}

const report = { started: new Date().toISOString(), tiers: [] };
mkdirSync(outDir, { recursive: true });
let failed = false;
try {
  const started = await rpc('start', { config: {
    backend: 'metal', width: WIDTH, height: HEIGHT, target_fps: 120,
    native_quality_policy: 'fixed', present_mode: 'vsync', max_frame_latency: 1,
  } }, 30_000);
  report.adapter = started?.adapter ?? started?.adapter_name ?? null;
  const compiled = await rpc('submit_commands', { commands: [
    ...Object.entries(shaderSources()).map(([shader_id, source]) => ({
      type: 'precompile_shader', shader_id, stage: 'render', entry: shader_id === SCENE_SHADER ? 'fs_main' : 'fs_composite', source,
    })),
  ] }, 30_000);
  const afterCompile = await rpc('status');
  if (Number(compiled?.dropped ?? 0) > 0 || Number(afterCompile.shader_precompile_failed ?? 0) > 0) {
    throw new Error(`shader precompile failed: ${afterCompile.last_shader_error}`);
  }
  report.source_frame_format = afterCompile.source_frame_format ?? null;
  report.source_frame_size = afterCompile.source_frame_size ?? null;

  /* 1. Shadow pixel test. Synchronous graph runs, no particles, fixed camera. */
  {
    const shots = {};
    let state;
    for (const name of Object.keys(SHADOW_TEST_CASES)) {
      const graph = shadowTestGraph(name);
      state = graph.state;
      await rpc('compute_graph', graph.config, 30_000);
      await showLayer('s3d-test', graph.out);
      await checkErrors(`pixel test (${name})`);
      shots[name] = await grab();
      writePng(path.join(outDir, `test-${name}.png`), shots[name].w, shots[name].h, shots[name].rgba);
    }
    const test = shadowTestResult(shots, state);
    report.shadow_test = test;
    console.log('shadow test', JSON.stringify(test));
    if (!test.pass) failed = true;
    await hideLayer('s3d-test');
  }

  /* 2. Cost per tier. The graph is queued faster than the core draws, so every
        frame it draws carries one; newer jobs replace unstarted older ones. */
  const idle = await (async () => { await delay(1500); const s = await rpc('status'); return Number(s.avg_render_gpu_ms || 0); })();
  report.idle_gpu_ms = Number(idle.toFixed(3));
  for (const tier of TIERS) {
    if (only.length && !only.includes(tier.name)) continue;
    const layerId = `s3d-${tier.name}`;
    let frame = 0;
    let running = true;
    let sendError = null;
    const first = buildGraph(tier, { time: 0, dt: 1 / 60, particles: tier.particles, shadows: true, occluders: true, frame: 0 });
    await rpc('submit_commands', { commands: [{ type: 'queue_compute_graph', ...first.config }] });
    await showLayer(layerId, first.out);
    const clockStart = performance.now();
    const pump = (async () => {
      while (running) {
        frame += 1;
        const graph = buildGraph(tier, { time: (performance.now() - clockStart) / 1000, dt: 0, particles: tier.particles, shadows: true, occluders: true, frame });
        try {
          const result = await rpc('submit_commands', { commands: [{ type: 'queue_compute_graph', ...graph.config }] });
          if (Number(result?.dropped ?? 0) > 0) { sendError = (await rpc('status')).last_shader_error; running = false; }
        } catch (error) { sendError = error.message; running = false; }
        await delay(3);
      }
    })();
    await delay(warmSeconds * 1000); // let the stream fill and the pipelines warm
    const before = await rpc('status');
    const t0 = performance.now();
    const samples = [];
    const steps = Math.max(8, Math.round(sampleSeconds * 5));
    for (let i = 0; i < steps && running; i++) {
      await delay((sampleSeconds * 1000) / steps);
      const g = Number((await rpc('status')).last_render_gpu_ms || 0);
      if (g > 0) samples.push(g);
    }
    const after = await rpc('status');
    const elapsed = (performance.now() - t0) / 1000;
    const shot = snapshotPixels(await rpc('frame_snapshot', { include_pixels: true }, 30_000));
    running = false;
    await pump;
    if (sendError) throw new Error(`${tier.name}: ${sendError}`);
    await checkErrors(tier.name);
    writePng(path.join(outDir, `${tier.name}.png`), shot.w, shot.h, shot.rgba);
    samples.sort((a, b) => a - b);
    const row = {
      ...tier,
      gpu_ms_median: Number((samples[Math.floor(samples.length / 2)] ?? 0).toFixed(2)),
      gpu_ms_p90: Number((samples[Math.floor(samples.length * 0.9)] ?? 0).toFixed(2)),
      gpu_ms_max: Number((samples[samples.length - 1] ?? 0).toFixed(2)),
      cpu_ms: Number(Number(after.avg_render_cpu_ms || 0).toFixed(2)),
      fps: Number(((Number(after.gpu_frames_completed || 0) - Number(before.gpu_frames_completed || 0)) / elapsed).toFixed(1)),
      graphs_sent_per_s: Number((frame / (warmSeconds + elapsed)).toFixed(0)),
    };
    report.tiers.push(row);
    console.log(`${tier.name.padEnd(12)} ${String(tier.particles).padStart(8)} grains  scene ${tier.scene}  shadow ${tier.shadow}  gpu ${row.gpu_ms_median} ms (p90 ${row.gpu_ms_p90}, max ${row.gpu_ms_max})  ${row.fps} fps  cpu ${row.cpu_ms} ms`);
    await hideLayer(layerId);
    await delay(300);
  }
} catch (error) {
  failed = true;
  report.error = String(error?.stack || error);
  console.error(report.error);
  console.error(stderrTail.slice(-2500));
} finally {
  writeFileSync(path.join(outDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  child.kill();
}
process.exit(failed ? 1 : 0);
