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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { deflateSync } from 'node:zlib';

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
const WIDTH = 1920;
const HEIGHT = 1080;
const executable = process.env.GA_NATIVE_RENDER_CORE_PATH
  || path.join(root, 'native-renderer', 'target', 'release', 'ghost-render-core');

const TIERS = [
  { name: 'performance', particles: 65_536, shadow: 1024, scene: 1024 },
  { name: 'balanced', particles: 250_000, shadow: 2048, scene: 1536 },
  { name: 'default', particles: 500_000, shadow: 2048, scene: 2048 },
  { name: 'insane', particles: 1_000_000, shadow: 4096, scene: 3072 },
];

/* ── maths (column-major, right-handed, depth 0..1) ───────────────────── */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
function lookAt(eye, target, up) {
  const f = norm(sub(target, eye));
  const r = norm(cross(f, up));
  const u = cross(r, f);
  return {
    m: [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1],
    right: r,
    up: u,
  };
}
function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0];
}
function ortho(half, near, far) {
  return [1 / half, 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1];
}
function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w];
}

const SPHERE_C = [0, 1.45, 0];
const LIGHT = norm([-0.55, 1.0, 0.4]);
function sceneState(time, orbit = true) {
  const angle = orbit ? 0.55 + time * 0.12 : 0.55;
  const eye = [Math.sin(angle) * 8.2, 3.4, Math.cos(angle) * 8.2];
  const view = lookAt(eye, [0.4, 1.3, 0], [0, 1, 0]);
  const viewProj = mul(perspective((38 * Math.PI) / 180, WIDTH / HEIGHT, 0.1, 60), view.m);
  const lightEye = [LIGHT[0] * 20, LIGHT[1] * 20, LIGHT[2] * 20];
  const lightView = lookAt(lightEye, [0, 0, 0], [0, 0, 1]);
  const lightViewProj = mul(ortho(7.5, 1, 40), lightView.m);
  return { eye, view, viewProj, lightViewProj };
}
function sceneUniform({ time, dt, particles, shadows, occluders, shadowSize, frame, orbit }) {
  const s = sceneState(time, orbit);
  const f = new Float32Array(56);
  f.set(s.viewProj, 0);
  f.set(s.lightViewProj, 16);
  f.set([...s.eye, time], 32);
  f.set([...LIGHT, 2.1], 36);
  f.set([dt, particles, shadows ? 1 : 0, occluders ? 1 : 0], 40);
  f.set([shadowSize, 0, 0, frame], 44);
  f.set([...s.view.right, 0], 48);
  f.set([...s.view.up, 0], 52);
  return { b64: Buffer.from(f.buffer).toString('base64'), state: s };
}

/* ── graph ─────────────────────────────────────────────────────────────── */
const SCENE_SHADER = 'scene3d-spike/scene';
const POST_SHADER = 'scene3d-spike/post';
const MESH_VERTS = 6 + 64 * 32 * 6 + 36;
const BLOOM_LEVELS = 6;

function buildGraph(tier, opts) {
  const id = (name) => `s3d:${tier.name}:${name}`;
  const uniform = sceneUniform({ ...opts, shadowSize: tier.shadow });
  const post = new Float32Array([1.25, opts.bloom ?? 0.8, 1.0, 0]);
  const particles = opts.particles;
  const textures = [
    { id: id('shadow'), size: tier.shadow, format: 'depth32float' },
    { id: id('hdr'), size: tier.scene, format: 'rgba16float' },
    { id: id('depth'), size: tier.scene, format: 'depth32float' },
  ];
  for (let level = 0; level < BLOOM_LEVELS; level++) {
    textures.push({ id: id(`bloom${level}`), size: Math.max(8, tier.scene >> (level + 1)), format: 'rgba16float' });
  }
  const sceneBinding = { binding: 0, resource: id('scene'), kind: 'uniform' };
  const shadowBinding = { binding: 1, kind: 'graph-depth-texture', texture: id('shadow') };
  const buffers = [
    { id: id('scene'), kind: 'uniform', initial_b64: uniform.b64 },
    { id: id('post'), kind: 'uniform', initial_b64: Buffer.from(post.buffer).toString('base64') },
  ];
  const passes = [];
  const renders = [
    {
      name: 'shadow', shader_id: SCENE_SHADER, vertex_entry: 'vs_shadow', fragment_entry: 'fs_main',
      target: 'texture', texture: id('shadow'), vertex_count: MESH_VERTS, bindings: [sceneBinding],
    },
    {
      name: 'opaque', shader_id: SCENE_SHADER, vertex_entry: 'vs_main', fragment_entry: 'fs_main',
      target: 'texture', texture: id('hdr'), depth: true, depth_write: true, depth_texture: id('depth'),
      clear: true, clear_color: [0, 0, 0, 1], vertex_count: MESH_VERTS, bindings: [sceneBinding, shadowBinding],
    },
  ];
  if (particles > 0) {
    buffers.push({ id: id('particles'), kind: 'storage', byte_length: tier.particles * 32, persistent: true });
    buffers.push({ id: id('clock'), kind: 'storage', byte_length: 16, persistent: true });
    const clockBinding = { binding: 4, resource: id('clock'), kind: 'storage' };
    passes.push({ name: 'clock', shader_id: SCENE_SHADER, entry: 'cs_clock', dispatch: [1, 1, 1], bindings: [sceneBinding, clockBinding] });
    passes.push({
      name: 'sim', shader_id: SCENE_SHADER, entry: 'cs_sim', dispatch: [Math.ceil(particles / 256), 1, 1],
      bindings: [sceneBinding, { binding: 2, resource: id('particles'), kind: 'storage' }, clockBinding],
    });
    renders.push({
      name: 'particles', shader_id: SCENE_SHADER, vertex_entry: 'vs_particle', fragment_entry: 'fs_particle',
      target: 'texture', texture: id('hdr'), clear: false, blend: 'add',
      depth: true, depth_write: false, depth_compare: 'less-equal', depth_load: true, depth_texture: id('depth'),
      vertex_count: 6, instance_count: particles,
      bindings: [sceneBinding, shadowBinding, { binding: 3, resource: id('particles'), kind: 'read-only-storage' }],
    });
  }
  const postPass = (name, entry, from, to, extra = {}) => ({
    name, shader_id: POST_SHADER, vertex_entry: 'vs_main', fragment_entry: entry,
    target: 'texture', texture: to, clear: true, clear_color: [0, 0, 0, 0],
    bindings: [
      { binding: 0, resource: id('post'), kind: 'uniform' },
      { binding: 1, kind: 'graph-texture', texture: from },
      { binding: 2, kind: 'source-frame-sampler' },
    ],
    ...extra,
  });
  if (opts.bloom !== 0) {
    renders.push(postPass('bloom-down-0', 'fs_down_first', id('hdr'), id('bloom0')));
    for (let level = 1; level < BLOOM_LEVELS; level++) {
      renders.push(postPass(`bloom-down-${level}`, 'fs_down', id(`bloom${level - 1}`), id(`bloom${level}`)));
    }
    for (let level = BLOOM_LEVELS - 2; level >= 0; level--) {
      renders.push(postPass(`bloom-up-${level}`, 'fs_up', id(`bloom${level + 1}`), id(`bloom${level}`), { clear: false, blend: 'add' }));
    }
  }
  renders.push({
    name: 'composite', shader_id: POST_SHADER, vertex_entry: 'vs_main', fragment_entry: 'fs_composite',
    target: 'source_frame', source_id: id('out'), clear: true, include_snapshot: false,
    bindings: [
      { binding: 0, resource: id('post'), kind: 'uniform' },
      { binding: 1, kind: 'graph-texture', texture: id('hdr') },
      { binding: 2, kind: 'source-frame-sampler' },
      { binding: 3, kind: 'graph-texture', texture: id('bloom0') },
    ],
  });
  return { config: { textures, buffers, passes, render_passes: renders, readbacks: [] }, state: uniform.state, out: id('out') };
}

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
function snapshotPixels(snap) {
  const w = Number(snap.width); const h = Number(snap.height);
  const padded = Number(snap.padded_bytes_per_row || snap.bytes_per_row || w * 4);
  const src = Buffer.from(String(snap.rgba_b64 || ''), 'base64');
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) src.copy(out, y * w * 4, y * padded, y * padded + w * 4);
  if (/Bgra/i.test(String(snap.format || ''))) for (let i = 0; i < out.length; i += 4) { const b = out[i]; out[i] = out[i + 2]; out[i + 2] = b; }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { w, h, rgba: out };
}
const lumaAt = (img, x, y, radius = 4) => {
  let sum = 0; let n = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const px = Math.min(img.w - 1, Math.max(0, Math.round(x) + dx));
    const py = Math.min(img.h - 1, Math.max(0, Math.round(y) + dy));
    const i = (py * img.w + px) * 4;
    sum += 0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2]; n++;
  }
  return sum / n / 255;
};

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
    { type: 'precompile_shader', shader_id: SCENE_SHADER, stage: 'render', entry: 'fs_main', source: readFileSync(path.join(here, 'scene.wgsl'), 'utf8') },
    { type: 'precompile_shader', shader_id: POST_SHADER, stage: 'render', entry: 'fs_composite', source: readFileSync(path.join(here, 'post.wgsl'), 'utf8') },
  ] }, 30_000);
  const afterCompile = await rpc('status');
  if (Number(compiled?.dropped ?? 0) > 0 || Number(afterCompile.shader_precompile_failed ?? 0) > 0) {
    throw new Error(`shader precompile failed: ${afterCompile.last_shader_error}`);
  }
  report.source_frame_format = afterCompile.source_frame_format ?? null;
  report.source_frame_size = afterCompile.source_frame_size ?? null;

  /* 1. Shadow pixel test. Synchronous graph runs, no particles, fixed camera. */
  {
    const tier = { name: 'test', particles: 0, shadow: 2048, scene: 1536 };
    const shots = {};
    let state;
    for (const [name, opts] of Object.entries({
      lit: { shadows: false, occluders: true },
      shadowed: { shadows: true, occluders: true },
      empty: { shadows: true, occluders: false },
    })) {
      const graph = buildGraph(tier, { time: 0, dt: 0, particles: 0, frame: 0, orbit: false, bloom: 0, ...opts });
      state = graph.state;
      await rpc('compute_graph', graph.config, 30_000);
      await showLayer('s3d-test', graph.out);
      await checkErrors(`pixel test (${name})`);
      shots[name] = await grab();
      writePng(path.join(outDir, `test-${name}.png`), shots[name].w, shots[name].h, shots[name].rgba);
    }
    const toPixel = (p) => { const n = project(state.viewProj, p); return [(n[0] * 0.5 + 0.5) * WIDTH, (0.5 - n[1] * 0.5) * HEIGHT]; };
    const t = SPHERE_C[1] / LIGHT[1];
    const shadowPoint = [SPHERE_C[0] - LIGHT[0] * t, 0, SPHERE_C[2] - LIGHT[2] * t];
    const controlPoint = [-2.5, 0, 2.5];
    const [sx, sy] = toPixel(shadowPoint);
    const [cx, cy] = toPixel(controlPoint);
    const test = {
      shadow_pixel: [Math.round(sx), Math.round(sy)],
      control_pixel: [Math.round(cx), Math.round(cy)],
      shadow_point_lit: lumaAt(shots.lit, sx, sy),
      shadow_point_shadowed: lumaAt(shots.shadowed, sx, sy),
      shadow_point_no_occluder: lumaAt(shots.empty, sx, sy),
      control_lit: lumaAt(shots.lit, cx, cy),
      control_shadowed: lumaAt(shots.shadowed, cx, cy),
    };
    test.darkening = test.shadow_point_shadowed / Math.max(test.shadow_point_lit, 1e-6);
    test.control_change = Math.abs(test.control_shadowed - test.control_lit) / Math.max(test.control_lit, 1e-6);
    test.no_occluder_change = Math.abs(test.shadow_point_no_occluder - test.shadow_point_lit) / Math.max(test.shadow_point_lit, 1e-6);
    test.pass = test.shadow_point_lit > 0.05 && test.darkening < 0.6 && test.control_change < 0.02 && test.no_occluder_change < 0.02;
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
