/**
 * WebGPUVolumetricSpheresShader
 *
 * Dedicated analytic sphere field. This intentionally does not reuse
 * Particle Field: each instance is a sphere impostor with a real
 * ray/sphere hit in the fragment shader, per-pixel normals, depth
 * output, and alpha-over compositing. It should read as objects in
 * space instead of "round particles".
 */

import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';
import { createAndWarmWgslShaderModule } from '../wgsl';
import { getGhostGpuRuntime } from '../webgpuShared';

type LayoutMode = 'cluster' | 'orbital' | 'column' | 'cavern';

export interface VolumetricSpheresParams {
  sphereCount: number;
  layout: LayoutMode;
  radiusScale: number;
  radiusVariance: number;
  spread: number;
  depth: number;
  motion: number;
  swirl: number;
  pull: number;
  chaos: number;
  damping: number;
  opacity: number;
  fogDensity: number;
  backgroundOpacity: number;
  fogColor: [number, number, number];
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorC: [number, number, number];
  colorD: [number, number, number];
  colorCycle: number;
  saturation: number;
  brightness: number;
  ambient: number;
  diffuse: number;
  specular: number;
  shininess: number;
  reflection: number;
  rim: number;
  lightX: number;
  lightY: number;
  lightZ: number;
  lightStrength: number;
  audioReactive: boolean;
  bassPulse: number;
  trebleSparkle: number;
  fovDeg: number;
  cameraZ: number;
  rotateX: number;
  rotateY: number;
  rotateZ: number;
  autoRotateX: number;
  autoRotateY: number;
  autoRotateZ: number;
  clearBackground?: boolean;
}

const LAYOUT_ID: Record<LayoutMode, number> = {
  cluster: 0,
  orbital: 1,
  column: 2,
  cavern: 3,
};

export const volumetricSpheresParamSchema: ParamControl[] = [
  { kind: 'select', key: 'layout', label: 'Layout', group: 'Shape',
    options: [
      { value: 'cluster', label: 'Cluster' },
      { value: 'orbital', label: 'Orbital' },
      { value: 'column', label: 'Column' },
      { value: 'cavern', label: 'Cavern' },
    ],
    default: 'cluster' },
  { kind: 'slider', key: 'sphereCount', label: 'Sphere Count', group: 'Shape',
    min: 24, max: 1200, step: 12, default: 192 },
  { kind: 'slider', key: 'radiusScale', label: 'Sphere Size', group: 'Shape',
    min: 0.025, max: 0.24, step: 0.001, default: 0.085 },
  { kind: 'slider', key: 'radiusVariance', label: 'Size Variation', group: 'Shape',
    min: 0, max: 1, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'spread', label: 'Spread', group: 'Shape',
    min: 0.25, max: 2.8, step: 0.01, default: 1.08 },
  { kind: 'slider', key: 'depth', label: 'Depth', group: 'Shape',
    min: 0.25, max: 3.5, step: 0.01, default: 1.35 },

  { kind: 'slider', key: 'motion', label: 'Motion', group: 'Motion',
    min: 0, max: 2.5, step: 0.01, default: 0.72 },
  { kind: 'slider', key: 'swirl', label: 'Swirl', group: 'Motion',
    min: -2, max: 2, step: 0.01, default: 0.58 },
  { kind: 'slider', key: 'pull', label: 'Center Pull', group: 'Motion',
    min: -0.5, max: 1.5, step: 0.01, default: 0.28 },
  { kind: 'slider', key: 'chaos', label: 'Chaos', group: 'Motion',
    min: 0, max: 2, step: 0.01, default: 0.34 },
  { kind: 'slider', key: 'damping', label: 'Damping', group: 'Motion',
    min: 0, max: 5, step: 0.01, default: 1.7 },

  { kind: 'slider', key: 'opacity', label: 'Opacity', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 0.96 },
  { kind: 'slider', key: 'fogDensity', label: 'Depth Fog', group: 'Atmosphere',
    min: 0, max: 2.5, step: 0.01, default: 0.38 },
  { kind: 'slider', key: 'backgroundOpacity', label: 'Background', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 0.88 },
  { kind: 'color', key: 'fogColor', label: 'Fog Color', group: 'Atmosphere',
    default: [8, 10, 20] },

  { kind: 'color', key: 'colorA', label: 'Color A', group: 'Palette',
    default: [70, 170, 255] },
  { kind: 'color', key: 'colorB', label: 'Color B', group: 'Palette',
    default: [255, 78, 166] },
  { kind: 'color', key: 'colorC', label: 'Color C', group: 'Palette',
    default: [255, 218, 94] },
  { kind: 'color', key: 'colorD', label: 'Color D', group: 'Palette',
    default: [84, 255, 214] },
  { kind: 'slider', key: 'colorCycle', label: 'Color Cycle', group: 'Palette',
    min: -0.35, max: 0.35, step: 0.001, default: 0.018 },
  { kind: 'slider', key: 'saturation', label: 'Saturation', group: 'Palette',
    min: 0, max: 2, step: 0.01, default: 1.08 },
  { kind: 'slider', key: 'brightness', label: 'Brightness', group: 'Palette',
    min: 0, max: 3, step: 0.01, default: 1.12 },

  { kind: 'slider', key: 'ambient', label: 'Ambient', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.24 },
  { kind: 'slider', key: 'diffuse', label: 'Diffuse', group: 'Material',
    min: 0, max: 2, step: 0.01, default: 1.08 },
  { kind: 'slider', key: 'specular', label: 'Specular', group: 'Material',
    min: 0, max: 3, step: 0.01, default: 0.9 },
  { kind: 'slider', key: 'shininess', label: 'Gloss', group: 'Material',
    min: 4, max: 220, step: 1, default: 78 },
  { kind: 'slider', key: 'reflection', label: 'Reflection', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.22 },
  { kind: 'slider', key: 'rim', label: 'Rim Light', group: 'Material',
    min: 0, max: 2, step: 0.01, default: 0.46 },

  { kind: 'slider', key: 'lightX', label: 'Light X', group: 'Light',
    min: -2, max: 2, step: 0.01, default: -0.55 },
  { kind: 'slider', key: 'lightY', label: 'Light Y', group: 'Light',
    min: -2, max: 2, step: 0.01, default: 0.8 },
  { kind: 'slider', key: 'lightZ', label: 'Light Z', group: 'Light',
    min: -2, max: 2, step: 0.01, default: 1.0 },
  { kind: 'slider', key: 'lightStrength', label: 'Strength', group: 'Light',
    min: 0, max: 2.5, step: 0.01, default: 1.1 },

  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio',
    default: true },
  { kind: 'slider', key: 'bassPulse', label: 'Bass Pulse', group: 'Audio',
    min: 0, max: 3, step: 0.01, default: 1.15,
    showWhen: { audioReactive: true } },
  { kind: 'slider', key: 'trebleSparkle', label: 'Treble Sparkle', group: 'Audio',
    min: 0, max: 1, step: 0.01, default: 0.32,
    showWhen: { audioReactive: true } },

  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 25, max: 95, step: 1, default: 48 },
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 1.2, max: 8, step: 0.05, default: 2.75 },
  { kind: 'angle', key: 'rotateX', label: 'Rotate X', group: 'Camera', default: -4 },
  { kind: 'angle', key: 'rotateY', label: 'Rotate Y', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'rotateZ', label: 'Rotate Z', group: 'Camera', default: 0 },
  { kind: 'slider', key: 'autoRotateX', label: 'Auto-Spin X', group: 'Camera',
    min: -24, max: 24, step: 0.1, default: -0.3 },
  { kind: 'slider', key: 'autoRotateY', label: 'Auto-Spin Y', group: 'Camera',
    min: -36, max: 36, step: 0.1, default: 4.4 },
  { kind: 'slider', key: 'autoRotateZ', label: 'Auto-Spin Z', group: 'Camera',
    min: -24, max: 24, step: 0.1, default: 0.15 },
];

export const volumetricSpheresParamDefaults = deriveDefaults(volumetricSpheresParamSchema);

const SPHERE_STRIDE_FLOATS = 12;
const MIN_SPHERES = 1;
const MAX_SPHERES = 1200;
const RENDER_SAMPLE_COUNT = 4;

const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

function mat4Mul(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function identityMat4(): Float32Array {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

function perspective(fovDeg: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan((fovDeg * Math.PI / 180) / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = far / (near - far);
  m[11] = -1;
  m[14] = (near * far) / (near - far);
  return m;
}

function translate(x: number, y: number, z: number): Float32Array {
  const m = identityMat4();
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

function rotateXMat(rad: number): Float32Array {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotateYMat(rad: number): Float32Array {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotateZMat(rad: number): Float32Array {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

const SIM_WGSL = /* wgsl */ `
struct Sphere {
  pos: vec3<f32>,
  radius: f32,
  vel: vec3<f32>,
  seed: f32,
  color: vec3<f32>,
  group: f32,
};

struct SimU {
  dt: f32,
  time: f32,
  count: u32,
  layoutMode: u32,
  bounds: vec3<f32>,
  motion: f32,
  swirl: f32,
  pull: f32,
  drift: f32,
  damping: f32,
  bass: f32,
  treble: f32,
  bassPulse: f32,
  chaos: f32,
};

@group(0) @binding(0) var<storage, read_write> spheres: array<Sphere>;
@group(0) @binding(1) var<uniform> u: SimU;

fn hash11(n: f32) -> f32 {
  return fract(sin(n * 12.9898) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let n = dot(i, vec3<f32>(1.0, 57.0, 113.0));
  let a = hash11(n + 0.0);
  let b = hash11(n + 1.0);
  let c = hash11(n + 57.0);
  let d = hash11(n + 58.0);
  let e = hash11(n + 113.0);
  let f1 = hash11(n + 114.0);
  let g = hash11(n + 170.0);
  let h = hash11(n + 171.0);
  let x1 = mix(a, b, s.x);
  let x2 = mix(c, d, s.x);
  let x3 = mix(e, f1, s.x);
  let x4 = mix(g, h, s.x);
  let y1 = mix(x1, x2, s.y);
  let y2 = mix(x3, x4, s.y);
  return mix(y1, y2, s.z);
}

fn flow(p: vec3<f32>, seed: f32, t: f32) -> vec3<f32> {
  let q = p * (1.4 + seed * 1.7) + vec3<f32>(t * 0.08, -t * 0.06, t * 0.05);
  let x = noise3(q + vec3<f32>(7.1, 0.0, 2.3)) - 0.5;
  let y = noise3(q + vec3<f32>(0.0, 11.8, 5.2)) - 0.5;
  let z = noise3(q + vec3<f32>(4.4, 1.9, 13.7)) - 0.5;
  return vec3<f32>(x, y, z) * 2.0;
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }

  var s = spheres[i];
  let dt = clamp(u.dt, 0.0, 1.0 / 15.0);
  let seed = s.seed;
  let centerLen = max(length(s.pos), 0.0001);
  let radial = s.pos / centerLen;
  let axis = normalize(vec3<f32>(
    sin(seed * 41.7 + u.time * 0.13),
    0.72 + sin(seed * 19.3) * 0.24,
    cos(seed * 37.1 - u.time * 0.11),
  ));
  let tangent = normalize(cross(axis, radial) + flow(s.pos, seed, u.time) * 0.12);
  var accel = vec3<f32>(0.0);

  accel = accel + tangent * u.swirl * 0.55;
  accel = accel - s.pos * u.pull * 0.22;
  accel = accel + flow(s.pos, seed, u.time) * u.drift * (0.22 + u.chaos * 0.35);
  accel = accel + radial * u.bass * u.bassPulse * 0.8;

  if (u.layoutMode == 1u) {
    let orbitLift = vec3<f32>(-s.pos.z, sin(seed * 6.283) * 0.2, s.pos.x);
    accel = accel + normalize(orbitLift + 0.001) * (0.38 + u.swirl * 0.2);
  } else if (u.layoutMode == 2u) {
    accel = accel + vec3<f32>(0.0, 0.45 + u.bass * 0.3, 0.0);
  } else if (u.layoutMode == 3u) {
    let shellTarget = normalize(s.pos + 0.001) * vec3<f32>(u.bounds.x, u.bounds.y, u.bounds.z) * 0.78;
    accel = accel + (shellTarget - s.pos) * 0.18;
  }

  s.vel = s.vel + accel * dt * max(u.motion, 0.0);
  s.vel = s.vel * exp(-u.damping * dt);
  s.pos = s.pos + s.vel * dt;

  if (s.pos.x > u.bounds.x) { s.pos.x = u.bounds.x; s.vel.x = -abs(s.vel.x) * 0.74; }
  if (s.pos.x < -u.bounds.x) { s.pos.x = -u.bounds.x; s.vel.x = abs(s.vel.x) * 0.74; }
  if (s.pos.y > u.bounds.y) { s.pos.y = u.bounds.y; s.vel.y = -abs(s.vel.y) * 0.74; }
  if (s.pos.y < -u.bounds.y) { s.pos.y = -u.bounds.y; s.vel.y = abs(s.vel.y) * 0.74; }
  if (s.pos.z > u.bounds.z) { s.pos.z = u.bounds.z; s.vel.z = -abs(s.vel.z) * 0.74; }
  if (s.pos.z < -u.bounds.z) { s.pos.z = -u.bounds.z; s.vel.z = abs(s.vel.z) * 0.74; }

  spheres[i] = s;
}
`;

const RENDER_WGSL = /* wgsl */ `
struct Sphere {
  pos: vec3<f32>,
  radius: f32,
  vel: vec3<f32>,
  seed: f32,
  color: vec3<f32>,
  group: f32,
};

struct RenderU {
  viewProj: mat4x4<f32>,
  model: mat4x4<f32>,
  cameraPos: vec3<f32>,
  radiusScale: f32,
  camRight: vec3<f32>,
  opacity: f32,
  camUp: vec3<f32>,
  time: f32,
  lightDir: vec3<f32>,
  lightStrength: f32,
  fogColor: vec3<f32>,
  fogDensity: f32,
  ambient: f32,
  diffuse: f32,
  specular: f32,
  shininess: f32,
  reflection: f32,
  rim: f32,
  exposure: f32,
  treble: f32,
  colorA: vec3<f32>,
  colorCycle: f32,
  colorB: vec3<f32>,
  saturation: f32,
  colorC: vec3<f32>,
  brightness: f32,
  colorD: vec3<f32>,
  bass: f32,
};

@group(0) @binding(0) var<storage, read> spheres: array<Sphere>;
@group(0) @binding(1) var<uniform> u: RenderU;

struct VSOut {
  @builtin(position) clip: vec4<f32>,
  @location(0) planeWorld: vec3<f32>,
  @location(1) center: vec3<f32>,
  @location(2) radius: f32,
  @location(3) color: vec3<f32>,
  @location(4) seed: f32,
  @location(5) sphereUv: vec2<f32>,
};

struct FSOut {
  @location(0) color: vec4<f32>,
  @builtin(frag_depth) depth: f32,
};

fn palette(tIn: f32) -> vec3<f32> {
  let t = fract(tIn);
  if (t < 0.333333) {
    return mix(u.colorA, u.colorB, smoothstep(0.0, 0.333333, t));
  }
  if (t < 0.666667) {
    return mix(u.colorB, u.colorC, smoothstep(0.333333, 0.666667, t));
  }
  return mix(u.colorC, u.colorD, smoothstep(0.666667, 1.0, t));
}

fn saturateColor(c: vec3<f32>, amount: f32) -> vec3<f32> {
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  return mix(vec3<f32>(luma), c, amount);
}

fn raySphere(ro: vec3<f32>, rd: vec3<f32>, c: vec3<f32>, r: f32) -> vec3<f32> {
  let oc = ro - c;
  let b = dot(oc, rd);
  let cc = dot(oc, oc) - r * r;
  let h = b * b - cc;
  let sh = sqrt(max(h, 0.0));
  return vec3<f32>(-b - sh, -b + sh, h);
}

@vertex
fn vs_main(
  @builtin(vertex_index) vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  let xy = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
  );
  let q = xy[vid];
  let s = spheres[iid];
  let center = (u.model * vec4<f32>(s.pos, 1.0)).xyz;
  let radius = max(s.radius * u.radiusScale * (1.0 + u.bass * 0.12), 0.0001);
  let planeWorld = center + (u.camRight * q.x + u.camUp * q.y) * radius * 1.16;
  let t = s.group * 0.173 + s.seed * 0.31 + u.time * u.colorCycle;
  let pal = palette(t);
  let color = saturateColor(mix(s.color, pal, 0.68), u.saturation) * u.brightness;

  var out: VSOut;
  out.clip = u.viewProj * vec4<f32>(planeWorld, 1.0);
  out.planeWorld = planeWorld;
  out.center = center;
  out.radius = radius;
  out.color = color;
  out.seed = s.seed;
  out.sphereUv = q;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> FSOut {
  let billboardRadius = length(in.sphereUv);
  let silhouetteRadius = 1.0 / 1.16;
  let silhouetteAa = max(0.0085, fwidth(billboardRadius) * 3.8);
  let silhouetteCoverage = 1.0 - smoothstep(
    silhouetteRadius - silhouetteAa,
    silhouetteRadius + silhouetteAa,
    billboardRadius,
  );
  if (silhouetteCoverage <= 0.001) { discard; }

  let ro = u.cameraPos;
  let rd = normalize(in.planeWorld - ro);
  let hitSpan = raySphere(ro, rd, in.center, in.radius);
  let rayAa = max(0.00005, fwidth(hitSpan.z) * 2.65);
  let rayCoverage = smoothstep(-rayAa, rayAa, hitSpan.z);
  if (rayCoverage <= 0.001) { discard; }
  var t = hitSpan.x;
  if (t < 0.0) {
    t = hitSpan.y;
  }
  if (t < 0.0) { discard; }

  let hit = ro + rd * t;
  let n = normalize(hit - in.center);
  let viewDir = normalize(ro - hit);
  let l = normalize(u.lightDir);
  let ndl = max(dot(n, l), 0.0);
  let wrapped = pow(clamp(dot(n, l) * 0.5 + 0.5, 0.0, 1.0), 1.35);
  let h = normalize(l + viewDir);
  let spec = pow(max(dot(n, h), 0.0), max(u.shininess, 1.0)) * u.specular * (0.45 + u.lightStrength);
  let fresnel = pow(clamp(1.0 - dot(n, viewDir), 0.0, 1.0), 2.6);
  let rim = fresnel * u.rim;
  let light = u.ambient + u.diffuse * mix(wrapped, ndl, 0.72) * u.lightStrength;
  let reflectionTint = mix(vec3<f32>(0.12, 0.18, 0.3), vec3<f32>(0.88, 0.95, 1.0), clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
  var color = in.color * light;
  color = color + vec3<f32>(1.0, 0.96, 0.88) * spec;
  color = color + reflectionTint * u.reflection * (0.1 + fresnel * 0.7);
  color = color + in.color * rim * 0.45;
  color = color + vec3<f32>(1.0) * u.treble * 0.12 * (0.4 + fresnel);

  let dist = length(hit - ro);
  let fog = exp(-u.fogDensity * dist);
  color = mix(u.fogColor, color, max(fog, 0.12)) * u.exposure;
  color = color / (color + vec3<f32>(1.0));
  color = pow(max(color, vec3<f32>(0.0)), vec3<f32>(0.454545));

  let grazing = abs(dot(n, viewDir));
  let grazingAa = max(0.055, fwidth(grazing) * 3.1);
  let edge = smoothstep(0.0, 0.095 + grazingAa, grazing);
  let coverage = min(silhouetteCoverage, rayCoverage);
  let alpha = clamp(u.opacity * edge * coverage * (0.78 + fresnel * 0.22), 0.0, 1.0);
  let clip = u.viewProj * vec4<f32>(hit, 1.0);

  var out: FSOut;
  out.color = vec4<f32>(color * alpha, alpha);
  out.depth = clip.z / clip.w;
  return out;
}
`;

export class WebGPUVolumetricSpheresShader implements GpuShaderImpl {
  private device: any;
  private presentFormat: any;
  private simPipeline: any;
  private renderPipeline: any;
  private simLayout: any;
  private renderLayout: any;
  private simBindGroup: any;
  private renderBindGroup: any;
  private sphereBuffer: any = null;
  private simUniform: any;
  private renderUniform: any;
  private depthTexture: any = null;
  private depthView: any = null;
  private msaaTexture: any = null;
  private msaaView: any = null;
  private depthW = 0;
  private depthH = 0;
  private params: VolumetricSpheresParams = {
    ...(volumetricSpheresParamDefaults as VolumetricSpheresParams),
    clearBackground: true,
  };
  private sphereCount = 0;
  private viewportW = 1;
  private viewportH = 1;
  private bands = { bass: 0, mid: 0, treble: 0 };
  private rotXPhase = 0;
  private rotYPhase = 0;
  private rotZPhase = 0;
  private lastSeedKey = '';

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;

    this.simUniform = this.device.createBuffer({
      size: 80,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.renderUniform = this.device.createBuffer({
      size: 320,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.buildPipelines();
    this.allocateSpheres(this.params.sphereCount);
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands.bass = this.bands.bass * 0.82 + bass * 0.18;
    this.bands.mid = this.bands.mid * 0.82 + mid * 0.18;
    this.bands.treble = this.bands.treble * 0.82 + treble * 0.18;
  }

  setParams(params: Record<string, any>): void {
    const next = {
      ...volumetricSpheresParamDefaults,
      ...this.params,
      ...params,
      clearBackground: params.clearBackground ?? this.params.clearBackground ?? true,
    } as VolumetricSpheresParams;
    const count = this.clampCount(next.sphereCount);
    const seedKey = [
      count,
      next.layout,
      next.radiusVariance,
      next.spread,
      next.depth,
      next.colorA?.join(','),
      next.colorB?.join(','),
      next.colorC?.join(','),
      next.colorD?.join(','),
    ].join('|');
    this.params = next;
    if (count !== this.sphereCount) {
      this.allocateSpheres(count);
    } else if (seedKey !== this.lastSeedKey) {
      this.seedSpheres();
    }
  }

  resize(width: number, height: number): void {
    this.viewportW = Math.max(1, width | 0);
    this.viewportH = Math.max(1, height | 0);
  }

  encodeFrame(encoder: any, targetView: any, _format: any, width: number, height: number, dt: number, time?: number): void {
    this.resize(width, height);
    this.ensureRenderTargets(this.viewportW, this.viewportH);
    const frameDt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 1 / 15) : 1 / 60;
    const now = typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : performance.now() / 1000;
    const reactive = !!this.params.audioReactive;
    const bass = reactive ? Math.min(2, this.bands.bass * this.params.bassPulse) : 0;
    const treble = reactive ? Math.min(2, this.bands.treble * this.params.trebleSparkle) : 0;

    this.rotXPhase += this.params.autoRotateX * frameDt;
    this.rotYPhase += this.params.autoRotateY * frameDt;
    this.rotZPhase += this.params.autoRotateZ * frameDt;

    this.writeSimUniform(frameDt, now, bass, treble);
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.simPipeline);
      pass.setBindGroup(0, this.simBindGroup);
      pass.dispatchWorkgroups(Math.ceil(this.sphereCount / 64));
      pass.end();
    }

    this.writeRenderUniform(now, bass, treble);
    const fog = this.rgb01(this.params.fogColor, [0.03, 0.04, 0.08]);
    const bgOpacity = Math.max(0, Math.min(1, this.params.backgroundOpacity));
    const shouldClear = this.params.clearBackground !== false;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: this.msaaView ?? targetView,
        resolveTarget: this.msaaView ? targetView : undefined,
        loadOp: shouldClear ? 'clear' : 'load',
        clearValue: shouldClear
          ? { r: fog[0] * bgOpacity, g: fog[1] * bgOpacity, b: fog[2] * bgOpacity, a: bgOpacity }
          : undefined,
        storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1.0,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
    });
    pass.setPipeline(this.renderPipeline);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(6, this.sphereCount, 0, 0);
    pass.end();
  }

  dispose(): void {
    try { this.sphereBuffer?.destroy?.(); } catch { /* noop */ }
    try { this.simUniform?.destroy?.(); } catch { /* noop */ }
    try { this.renderUniform?.destroy?.(); } catch { /* noop */ }
    try { this.depthTexture?.destroy?.(); } catch { /* noop */ }
    try { this.msaaTexture?.destroy?.(); } catch { /* noop */ }
    this.sphereBuffer = null;
    this.depthTexture = null;
    this.depthView = null;
    this.msaaTexture = null;
    this.msaaView = null;
  }

  private buildPipelines(): void {
    const shaderRuntime = getGhostGpuRuntime() ?? this.device;
    const simModule = createAndWarmWgslShaderModule(shaderRuntime, SIM_WGSL, 'volumetric-spheres/sim');
    const renderModule = createAndWarmWgslShaderModule(shaderRuntime, RENDER_WGSL, 'volumetric-spheres/render');

    this.simLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.renderLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      ],
    });
    this.simPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.simLayout] }),
      compute: { module: simModule, entryPoint: 'cs_main' },
    });
    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
      depthStencil: {
        format: 'depth24plus',
        depthWriteEnabled: true,
        depthCompare: 'less',
      },
      multisample: { count: RENDER_SAMPLE_COUNT, alphaToCoverageEnabled: true },
    });
  }

  private allocateSpheres(count: number): void {
    this.sphereCount = this.clampCount(count);
    try { this.sphereBuffer?.destroy?.(); } catch { /* noop */ }
    this.sphereBuffer = this.device.createBuffer({
      size: this.sphereCount * SPHERE_STRIDE_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.rebuildBindGroups();
    this.seedSpheres();
  }

  private rebuildBindGroups(): void {
    this.simBindGroup = this.device.createBindGroup({
      layout: this.simLayout,
      entries: [
        { binding: 0, resource: { buffer: this.sphereBuffer } },
        { binding: 1, resource: { buffer: this.simUniform } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: { buffer: this.sphereBuffer } },
        { binding: 1, resource: { buffer: this.renderUniform } },
      ],
    });
  }

  private seedSpheres(): void {
    if (!this.sphereBuffer || this.sphereCount <= 0) return;
    const p = this.params;
    const layout = p.layout ?? 'cluster';
    const floats = new Float32Array(this.sphereCount * SPHERE_STRIDE_FLOATS);
    const colors = [
      this.rgb01(p.colorA, [0.28, 0.66, 1]),
      this.rgb01(p.colorB, [1, 0.31, 0.65]),
      this.rgb01(p.colorC, [1, 0.86, 0.37]),
      this.rgb01(p.colorD, [0.33, 1, 0.84]),
    ];
    for (let i = 0; i < this.sphereCount; i++) {
      const seed = this.hash(i * 17.13 + 9.7);
      const seed2 = this.hash(i * 43.91 + 2.3);
      const seed3 = this.hash(i * 71.17 + 5.9);
      let x = 0;
      let y = 0;
      let z = 0;
      if (layout === 'orbital') {
        const ring = i % 5;
        const a = (i / Math.max(1, this.sphereCount) * Math.PI * 2 * (2.5 + ring * 0.23)) + seed * Math.PI * 2;
        const r = 0.24 + ring * 0.17 + seed2 * 0.18;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r * (0.74 + seed3 * 0.32);
        y = (ring - 2) * 0.12 + (seed2 - 0.5) * 0.18;
      } else if (layout === 'column') {
        const a = seed * Math.PI * 2;
        const r = Math.pow(seed2, 0.65) * 0.52;
        x = Math.cos(a) * r;
        z = Math.sin(a) * r * 0.7;
        y = (i / Math.max(1, this.sphereCount - 1) - 0.5) * 1.8 + (seed3 - 0.5) * 0.18;
      } else if (layout === 'cavern') {
        const dir = this.randomUnit(seed, seed2, seed3);
        const shell = 0.62 + Math.pow(seed, 2.0) * 0.3;
        x = dir[0] * shell;
        y = dir[1] * shell * 0.72;
        z = dir[2] * shell;
      } else {
        const dir = this.randomUnit(seed, seed2, seed3);
        const r = Math.pow(this.hash(i * 11.31 + 4.2), 0.42);
        x = dir[0] * r;
        y = dir[1] * r * 0.76;
        z = dir[2] * r;
      }

      const radiusJitter = 0.55 + Math.pow(this.hash(i * 29.71 + 1.1), 1.8) * (0.65 + p.radiusVariance * 1.75);
      const c = colors[i % colors.length];
      const off = i * SPHERE_STRIDE_FLOATS;
      floats[off + 0] = x * p.spread;
      floats[off + 1] = y * p.spread;
      floats[off + 2] = z * p.depth;
      floats[off + 3] = radiusJitter;
      floats[off + 4] = (seed2 - 0.5) * 0.04;
      floats[off + 5] = (seed3 - 0.5) * 0.04;
      floats[off + 6] = (seed - 0.5) * 0.04;
      floats[off + 7] = seed;
      floats[off + 8] = c[0];
      floats[off + 9] = c[1];
      floats[off + 10] = c[2];
      floats[off + 11] = i % 16;
    }
    this.device.queue.writeBuffer(this.sphereBuffer, 0, floats);
    this.lastSeedKey = [
      this.sphereCount,
      p.layout,
      p.radiusVariance,
      p.spread,
      p.depth,
      p.colorA?.join(','),
      p.colorB?.join(','),
      p.colorC?.join(','),
      p.colorD?.join(','),
    ].join('|');
  }

  private writeSimUniform(dt: number, time: number, bass: number, treble: number): void {
    const buf = new ArrayBuffer(80);
    const f = new Float32Array(buf);
    const u = new Uint32Array(buf);
    f[0] = dt;
    f[1] = time;
    u[2] = this.sphereCount >>> 0;
    u[3] = LAYOUT_ID[this.params.layout ?? 'cluster'] >>> 0;
    f[4] = Math.max(0.2, this.params.spread * 1.24);
    f[5] = Math.max(0.2, this.params.spread * 0.92);
    f[6] = Math.max(0.2, this.params.depth * 1.16);
    f[7] = this.params.motion;
    f[8] = this.params.swirl;
    f[9] = this.params.pull;
    f[10] = 0.65 + this.params.chaos * 0.75;
    f[11] = this.params.damping;
    f[12] = bass;
    f[13] = treble;
    f[14] = this.params.bassPulse;
    f[15] = this.params.chaos;
    this.device.queue.writeBuffer(this.simUniform, 0, buf);
  }

  private writeRenderUniform(time: number, bass: number, treble: number): void {
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const D2R = Math.PI / 180;
    const proj = perspective(this.params.fovDeg, aspect, 0.05, 100);
    const view = translate(0, 0, -this.params.cameraZ);
    const model = mat4Mul(
      rotateZMat((this.params.rotateZ + this.rotZPhase) * D2R),
      mat4Mul(
        rotateYMat((this.params.rotateY + this.rotYPhase) * D2R),
        rotateXMat((this.params.rotateX + this.rotXPhase) * D2R),
      ),
    );
    const viewProj = mat4Mul(proj, view);
    const fog = this.rgb01(this.params.fogColor, [0.03, 0.04, 0.08]);
    const colorA = this.rgb01(this.params.colorA, [0.28, 0.66, 1]);
    const colorB = this.rgb01(this.params.colorB, [1, 0.31, 0.65]);
    const colorC = this.rgb01(this.params.colorC, [1, 0.86, 0.37]);
    const colorD = this.rgb01(this.params.colorD, [0.33, 1, 0.84]);
    const lx = this.params.lightX;
    const ly = this.params.lightY;
    const lz = this.params.lightZ;
    const llen = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1;

    const buf = new ArrayBuffer(320);
    const f = new Float32Array(buf);
    f.set(viewProj, 0);
    f.set(model, 16);
    f[32] = 0;
    f[33] = 0;
    f[34] = this.params.cameraZ;
    f[35] = this.params.radiusScale;
    f[36] = 1;
    f[37] = 0;
    f[38] = 0;
    f[39] = this.params.opacity;
    f[40] = 0;
    f[41] = 1;
    f[42] = 0;
    f[43] = time;
    f[44] = lx / llen;
    f[45] = ly / llen;
    f[46] = lz / llen;
    f[47] = this.params.lightStrength;
    f[48] = fog[0];
    f[49] = fog[1];
    f[50] = fog[2];
    f[51] = this.params.fogDensity;
    f[52] = this.params.ambient;
    f[53] = this.params.diffuse;
    f[54] = this.params.specular;
    f[55] = this.params.shininess;
    f[56] = this.params.reflection;
    f[57] = this.params.rim;
    f[58] = 1.0 + Math.max(0, bass) * 0.08;
    f[59] = treble;
    f[60] = colorA[0];
    f[61] = colorA[1];
    f[62] = colorA[2];
    f[63] = this.params.colorCycle;
    f[64] = colorB[0];
    f[65] = colorB[1];
    f[66] = colorB[2];
    f[67] = this.params.saturation;
    f[68] = colorC[0];
    f[69] = colorC[1];
    f[70] = colorC[2];
    f[71] = this.params.brightness;
    f[72] = colorD[0];
    f[73] = colorD[1];
    f[74] = colorD[2];
    f[75] = bass;
    this.device.queue.writeBuffer(this.renderUniform, 0, buf);
  }

  private ensureRenderTargets(width: number, height: number): void {
    const w = Math.max(1, width | 0);
    const h = Math.max(1, height | 0);
    if (this.depthTexture && this.msaaTexture && this.depthW === w && this.depthH === h) return;
    try { this.depthTexture?.destroy?.(); } catch { /* noop */ }
    try { this.msaaTexture?.destroy?.(); } catch { /* noop */ }
    this.msaaTexture = this.device.createTexture({
      size: [w, h, 1],
      sampleCount: RENDER_SAMPLE_COUNT,
      format: this.presentFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.msaaView = this.msaaTexture.createView();
    this.depthTexture = this.device.createTexture({
      size: [w, h, 1],
      sampleCount: RENDER_SAMPLE_COUNT,
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
    this.depthW = w;
    this.depthH = h;
  }

  private clampCount(value: number): number {
    return Math.max(MIN_SPHERES, Math.min(MAX_SPHERES, Math.round(Number(value) || 0)));
  }

  private rgb01(c: any, fallback: [number, number, number]): [number, number, number] {
    if (!Array.isArray(c) || c.length < 3) return fallback;
    const looksByte = Math.max(c[0] ?? 0, c[1] ?? 0, c[2] ?? 0) > 1.01;
    const div = looksByte ? 255 : 1;
    return [
      Math.max(0, Math.min(1, (c[0] ?? 0) / div)),
      Math.max(0, Math.min(1, (c[1] ?? 0) / div)),
      Math.max(0, Math.min(1, (c[2] ?? 0) / div)),
    ];
  }

  private hash(n: number): number {
    const x = Math.sin(n * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  }

  private randomUnit(a: number, b: number, c: number): [number, number, number] {
    const theta = a * Math.PI * 2;
    const z = b * 2 - 1;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const squash = 0.72 + c * 0.36;
    return [Math.cos(theta) * r, z * squash, Math.sin(theta) * r];
  }
}
