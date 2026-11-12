/**
 * The Scene 3D spike scene, shared by the bench and the GPU test: camera and
 * light maths, the compute graph (shadow map, lit mesh, particles, bloom) and
 * the shadow pixel check.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

const here = import.meta.dirname;
export const WIDTH = 1920;
export const HEIGHT = 1080;

/* ── maths (column-major, right-handed, depth 0..1) ───────────────────── */
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export function lookAt(eye, target, up) {
  const f = norm(sub(target, eye));
  const r = norm(cross(f, up));
  const u = cross(r, f);
  return {
    m: [r[0], u[0], -f[0], 0, r[1], u[1], -f[1], 0, r[2], u[2], -f[2], 0, -dot(r, eye), -dot(u, eye), dot(f, eye), 1],
    right: r,
    up: u,
  };
}
export function perspective(fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0];
}
export function ortho(half, near, far) {
  return [1 / half, 0, 0, 0, 0, 1 / half, 0, 0, 0, 0, 1 / (near - far), 0, 0, 0, near / (near - far), 1];
}
export function mul(a, b) {
  const o = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
  return o;
}
export function project(m, p) {
  const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
  const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
  const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
  return [x / w, y / w];
}

export const SPHERE_C = [0, 1.45, 0];
export const LIGHT = norm([-0.55, 1.0, 0.4]);
export function sceneState(time, orbit = true) {
  const angle = orbit ? 0.55 + time * 0.12 : 0.55;
  const eye = [Math.sin(angle) * 8.2, 3.4, Math.cos(angle) * 8.2];
  const view = lookAt(eye, [0.4, 1.3, 0], [0, 1, 0]);
  const viewProj = mul(perspective((38 * Math.PI) / 180, WIDTH / HEIGHT, 0.1, 60), view.m);
  const lightEye = [LIGHT[0] * 20, LIGHT[1] * 20, LIGHT[2] * 20];
  const lightView = lookAt(lightEye, [0, 0, 0], [0, 0, 1]);
  const lightViewProj = mul(ortho(7.5, 1, 40), lightView.m);
  return { eye, view, viewProj, lightViewProj };
}
export function sceneUniform({ time, dt, particles, shadows, occluders, shadowSize, frame, orbit }) {
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
export const SCENE_SHADER = 'scene3d-spike/scene';
export const POST_SHADER = 'scene3d-spike/post';
export const MESH_VERTS = 6 + 64 * 32 * 6 + 36;
export const BLOOM_LEVELS = 6;

export function buildGraph(tier, opts) {
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

export function snapshotPixels(snap) {
  const w = Number(snap.width); const h = Number(snap.height);
  const padded = Number(snap.padded_bytes_per_row || snap.bytes_per_row || w * 4);
  const src = Buffer.from(String(snap.rgba_b64 || ''), 'base64');
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) src.copy(out, y * w * 4, y * padded, y * padded + w * 4);
  if (/Bgra/i.test(String(snap.format || ''))) for (let i = 0; i < out.length; i += 4) { const b = out[i]; out[i] = out[i + 2]; out[i + 2] = b; }
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  return { w, h, rgba: out };
}
export const lumaAt = (img, x, y, radius = 4) => {
  let sum = 0; let n = 0;
  for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
    const px = Math.min(img.w - 1, Math.max(0, Math.round(x) + dx));
    const py = Math.min(img.h - 1, Math.max(0, Math.round(y) + dy));
    const i = (py * img.w + px) * 4;
    sum += 0.2126 * img.rgba[i] + 0.7152 * img.rgba[i + 1] + 0.0722 * img.rgba[i + 2]; n++;
  }
  return sum / n / 255;
};


export const shaderSources = () => ({
  [SCENE_SHADER]: readFileSync(path.join(here, 'scene.wgsl'), 'utf8'),
  [POST_SHADER]: readFileSync(path.join(here, 'post.wgsl'), 'utf8'),
});

/** The three graphs of the shadow check: no shadow map, shadow map, and shadow map with nothing to cast. */
export const SHADOW_TEST_CASES = {
  lit: { shadows: false, occluders: true },
  shadowed: { shadows: true, occluders: true },
  empty: { shadows: true, occluders: false },
};
export const SHADOW_TEST_TIER = { name: 'test', particles: 0, shadow: 2048, scene: 1536 };
export const shadowTestGraph = (name) => buildGraph(SHADOW_TEST_TIER, {
  time: 0, dt: 0, particles: 0, frame: 0, orbit: false, bloom: 0, ...SHADOW_TEST_CASES[name],
});

/**
 * The ground point behind the sphere darkens with the shadow map on; a point
 * outside the shadow, and the same point with nothing casting, do not change.
 * `shots` are snapshotPixels() images of the three cases at `width`x`height`.
 */
export function shadowTestResult(shots, state, width = WIDTH, height = HEIGHT) {
  const toPixel = (p) => { const n = project(state.viewProj, p); return [(n[0] * 0.5 + 0.5) * width, (0.5 - n[1] * 0.5) * height]; };
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
  return test;
}
