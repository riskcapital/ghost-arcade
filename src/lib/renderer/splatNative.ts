// Native Splat / Point Cloud renderer. The parsed point buffer uploads
// ONCE into a persistent GPU storage buffer (base64, only when the file
// signature changes); every frame packs a small camera/params uniform and
// the GPU draws one instanced quad per point. Ports the release
// SplatRenderer's vertex animations, displacement fields, render modes,
// and color/opacity effects to WGSL.
import type { SplatContent } from '$lib/types';

export const SPLAT_NATIVE_SHADER_ID = 'splat/render-v1';
// Matches the release renderer's point budget — larger scans are sampled
// down to this during parsing (with the loader reporting decimation).
export const SPLAT_MAX_POINTS = 1_500_000;
export const SPLAT_POINT_VEC4S = 2;
export const SPLAT_UNIFORM_VEC4S = 24;
export const SPLAT_UNIFORM_BYTES = SPLAT_UNIFORM_VEC4S * 16;

const ANIMATION_TYPES = [
  'none', 'explode', 'implode', 'slice', 'voxelSnap', 'peel',
  'gravity', 'swarm', 'morph', 'orbit', 'wave3d', 'scatter', 'spiral',
];
const DISPLACEMENT_TYPES = ['none', 'noise', 'audioReactive', 'wave', 'glitch', 'wind', 'magnetic', 'ripple'];
const RENDER_MODES = ['points', 'gaussians', 'spheres', 'billboards', 'cubes'];
const COLOR_EFFECTS = [
  'none', 'chromaticShift', 'heatmap', 'pointillist', 'hologram', 'rainbow',
  'audioColor', 'depthGradient', 'neonGlow', 'pastel', 'cyberpunk', 'fire', 'ice',
];
const OPACITY_EFFECTS = ['none', 'dof', 'fog', 'pulse', 'proximity', 'dissolve', 'scanReveal', 'audioFade'];

function finite(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
function clamp(v: number, lo: number, hi: number): number { return Math.min(hi, Math.max(lo, v)); }
function idx(list: string[], value: unknown): number {
  const i = list.indexOf(String(value ?? ''));
  return i >= 0 ? i : 0;
}

// Pack parsed point buffers (from parsePLYPointBuffers /
// pointCloudBuffersFromPLYData) into the storage layout:
//   p0 = [x, y, z, rgba8-packed-color]   p1 = [pointScale, alpha, 0, 0]
export function packSplatNativePoints(data: {
  positions: Float32Array;
  colors: Float32Array;
  alpha?: Float32Array;
  splatScale?: Float32Array;
  sampleCount: number;
}): { buffer: Float32Array; pointCount: number } {
  const count = Math.min(SPLAT_MAX_POINTS, Math.max(0, data.sampleCount | 0));
  const out = new Float32Array(count * SPLAT_POINT_VEC4S * 4);
  const u32 = new Uint32Array(out.buffer);
  // Normalize to the release renderer's framing: centered at the origin
  // and scaled so the largest extent spans ~4 units (SPLAT_TARGET_DIAMETER),
  // which the default camera distance of 5 frames nicely.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < count; i++) {
    const x = data.positions[i * 3], y = data.positions[i * 3 + 1], z = data.positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2, cz = (minZ + maxZ) / 2;
  const extent = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 1e-6);
  const norm = 4 / extent;
  for (let i = 0; i < count; i++) {
    const base = i * 8;
    out[base] = (data.positions[i * 3] - cx) * norm;
    out[base + 1] = (data.positions[i * 3 + 1] - cy) * norm;
    out[base + 2] = (data.positions[i * 3 + 2] - cz) * norm;
    const r = clamp(Math.round(finite(data.colors[i * 3], 1) * 255), 0, 255);
    const g = clamp(Math.round(finite(data.colors[i * 3 + 1], 1) * 255), 0, 255);
    const b = clamp(Math.round(finite(data.colors[i * 3 + 2], 1) * 255), 0, 255);
    const a = clamp(Math.round(finite(data.alpha?.[i], 1) * 255), 0, 255);
    u32[base + 3] = r | (g << 8) | (b << 16) | (a << 24);
    // Gaussian scans store raw world-space radii; convert with the release
    // renderer's fit-scaled point-scale curve so Point Size acts on a sane
    // baseline. Plain point clouds have no per-point scale (1.0).
    const rawScale = data.splatScale?.[i];
    out[base + 4] = rawScale === undefined
      ? 1
      : clamp(0.65 + rawScale * norm * 160, 0.45, 10);
    out[base + 5] = 1;
  }
  return { buffer: out, pointCount: count };
}

export function encodeSplatBufferBase64(buffer: Float32Array): string {
  const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(binary);
}

// Column-major view-projection matrix from the SplatContent camera —
// mirrors the release renderer's orbit/fov/roll/pan math.
export function splatViewProjection(content: SplatContent, aspect: number, time: number): number[] {
  const fov = (clamp(finite(content.cameraFov, 50), 10, 120) * Math.PI) / 180;
  const distance = Math.max(0.2, finite(content.cameraDistance, 5));
  const orbitX = (finite(content.cameraOrbitX, 0) * Math.PI) / 180;
  let orbitY = (finite(content.cameraOrbitY, 0) * Math.PI) / 180;
  if (content.autoRotate) orbitY += time * (finite(content.autoRotateSpeed, 30) * Math.PI) / 180;
  const roll = (finite(content.cameraRoll, 0) * Math.PI) / 180;

  const eyeX = Math.sin(orbitY) * Math.cos(orbitX) * distance;
  const eyeY = Math.sin(orbitX) * distance;
  const eyeZ = Math.cos(orbitY) * Math.cos(orbitX) * distance;

  // look-at basis (target origin, up +Y), then roll about the view axis
  let fx = -eyeX, fy = -eyeY, fz = -eyeZ;
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  // right = normalize(cross(forward, up)), up' = cross(right, forward)
  const upx = 0, upy = 1, upz = 0;
  let r0 = fy * upz - fz * upy;
  let r1 = fz * upx - fx * upz;
  let r2 = fx * upy - fy * upx;
  const rl = Math.hypot(r0, r1, r2) || 1; r0 /= rl; r1 /= rl; r2 /= rl;
  let u0 = r1 * fz - r2 * fy;
  let u1 = r2 * fx - r0 * fz;
  let u2 = r0 * fy - r1 * fx;
  if (roll !== 0) {
    const cr = Math.cos(roll), sr = Math.sin(roll);
    const nr0 = r0 * cr + u0 * sr, nr1 = r1 * cr + u1 * sr, nr2 = r2 * cr + u2 * sr;
    u0 = u0 * cr - r0 * sr; u1 = u1 * cr - r1 * sr; u2 = u2 * cr - r2 * sr;
    r0 = nr0; r1 = nr1; r2 = nr2;
  }
  // view matrix (column-major)
  const tx = -(r0 * eyeX + r1 * eyeY + r2 * eyeZ);
  const ty = -(u0 * eyeX + u1 * eyeY + u2 * eyeZ);
  const tz = fx * eyeX + fy * eyeY + fz * eyeZ;
  const view = [
    r0, u0, -fx, 0,
    r1, u1, -fy, 0,
    r2, u2, -fz, 0,
    tx, ty, tz, 1,
  ];
  const f = 1 / Math.tan(fov / 2);
  const near = 0.05, far = 200;
  const panX = finite(content.cameraPanX, 0) * 0.04;
  const panY = finite(content.cameraPanY, 0) * 0.04;
  // WebGPU depth convention: z_ndc in [0, 1].
  const proj = [
    f / Math.max(0.001, aspect), 0, 0, 0,
    0, f, 0, 0,
    panX, -panY, far / (near - far), -1,
    0, 0, (far * near) / (near - far), 0,
  ];
  // vp = proj * view (column-major multiply)
  const vp = new Array(16).fill(0);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += proj[k * 4 + r] * view[c * 4 + k];
      vp[c * 4 + r] = sum;
    }
  }
  return vp;
}

export interface SplatNativeGraphOptions {
  sourceId: string;
  content: SplatContent;
  pointCount: number;
  pointsBufferId: string;
  pointsB64?: string | null; // present only when the cloud changed
  width: number;
  height: number;
  time: number;
  frameDelta: number;
  frameIndex: number;
  audioLevel?: number;
  audioBeat?: number;
  includeSnapshot?: boolean;
}

export function buildSplatNativeComputeGraph(options: SplatNativeGraphOptions) {
  const width = Math.max(2, Math.round(options.width || 1920));
  const height = Math.max(2, Math.round(options.height || 1080));
  const time = Math.max(0, finite(options.time, 0));
  const c = options.content;
  const data = new Float32Array(SPLAT_UNIFORM_VEC4S * 4);
  const vp = splatViewProjection(c, width / height, time);
  data.set(vp, 0); // 4 vec4s (0..15)

  const audioOn = !!c.audioEnabled;
  const level = audioOn ? clamp(finite(options.audioLevel, 0), 0, 1.5) : 0;
  const beat = audioOn ? clamp(finite(options.audioBeat, 0), 0, 1.5) : 0;
  const density = clamp(finite(c.pointDensity, 1), 0.01, 1);
  const anim = idx(ANIMATION_TYPES, c.animationType);
  const peel = c.peelAxis === 'x' ? 0 : c.peelAxis === 'z' ? 2 : 1;

  data[16] = width; data[17] = height; data[18] = time; data[19] = options.pointCount;
  // ×3: the slider range (0.1–20) is calibrated for the WebGL renderer's
  // DPR-scaled gl_PointSize; the native quad size is in raw pixels.
  data[20] = Math.max(0.15, finite(c.pointSize, 3)) * 3 * (audioOn ? 1 + level * finite(c.audioScale, 0) * 0.5 + beat * finite(c.audioScale, 0) * 0.3 : 1);
  data[21] = c.sizeAttenuation === false && c.pointSizeAttenuation === false ? 0 : 1;
  data[22] = idx(RENDER_MODES, c.renderMode);
  data[23] = clamp(finite(c.opacity, 1), 0, 1);
  data[24] = anim;
  data[25] = clamp(finite(c.animationProgress, 0), 0, 1) * clamp(finite(c.animationIntensity, 1), 0, 2);
  data[26] = Math.max(0, finite(c.explodeForce, 1));
  data[27] = clamp(finite(c.voxelGridSize, 8), 2, 64);
  data[28] = peel;
  data[29] = finite(c.peelDirection, 1);
  data[30] = finite(c.gravity, 5);
  data[31] = clamp(finite(c.swarmCohesion, 0.5) + finite(c.swarmAlignment, 0.5), 0, 2);
  data[32] = idx(DISPLACEMENT_TYPES, c.displacementType);
  data[33] = Math.max(0, finite(c.displacementAmount, finite(c.displacementIntensity, 0)));
  data[34] = Math.max(0.05, finite(c.noiseScale, 1));
  data[35] = Math.max(0, finite(c.noiseSpeed, 1));
  data[36] = Math.max(0.1, finite(c.waveFrequency, 2));
  data[37] = Math.max(0, finite(c.waveAmplitude, 0.3));
  data[38] = clamp(finite(c.glitchIntensity, 0.5), 0, 1);
  data[39] = Math.max(0, finite(c.windStrength, 1));
  data[40] = finite(c.windDirection?.x, 1);
  data[41] = finite(c.windDirection?.y, 0);
  data[42] = finite(c.windDirection?.z, 0);
  data[43] = Math.max(0.05, finite(c.scaleUniform, 1));
  // The transform gizmo's axes are calibrated to the release renderer's
  // euler convention; the native pipeline reads them swapped, so exchange
  // X/Y here to keep ring-drag and step-button behavior intuitive.
  data[44] = (finite(c.rotationY, 0) * Math.PI) / 180;
  data[45] = (finite(c.rotationX, 0) * Math.PI) / 180;
  data[46] = (finite(c.rotationZ, 0) * Math.PI) / 180;
  data[47] = finite(c.positionX, 0);
  data[48] = finite(c.positionY, 0);
  data[49] = finite(c.positionZ, 0);
  data[50] = level;
  data[51] = beat;
  data[52] = c.useOriginalColors === false ? 0 : 1;
  data[53] = clamp(finite(c.colorA?.[0], 255) / 255, 0, 1);
  data[54] = clamp(finite(c.colorA?.[1], 255) / 255, 0, 1);
  data[55] = clamp(finite(c.colorA?.[2], 255) / 255, 0, 1);
  data[56] = clamp(finite(c.colorB?.[0], 255) / 255, 0, 1);
  data[57] = clamp(finite(c.colorB?.[1], 255) / 255, 0, 1);
  data[58] = clamp(finite(c.colorB?.[2], 255) / 255, 0, 1);
  data[59] = clamp(finite(c.colorMix, 0), 0, 1);
  data[60] = finite(c.hueShift, 0);
  data[61] = idx(COLOR_EFFECTS, c.colorEffectType ?? c.colorEffect);
  data[62] = clamp(finite(c.colorEffectIntensity, 0.5), 0, 1);
  data[63] = Math.max(0, finite(c.hologramSpeed, 2));
  data[64] = clamp(finite(c.hologramDensity, 10), 1, 50);
  data[65] = idx(OPACITY_EFFECTS, c.opacityEffectType ?? c.opacityEffect);
  data[66] = clamp(finite(c.opacityEffectIntensity, 0.5), 0, 1);
  data[67] = clamp(finite(c.dofFocalDistance, 0.5), 0, 1);
  data[68] = Math.max(0.05, finite(c.fogDensity as number, 1));
  data[69] = Math.max(0.05, finite(c.pulseSpeed as number, 1));
  data[70] = clamp(finite(c.dissolveProgress as number, 0.5), 0, 1);
  data[71] = density;
  data[72] = clamp(finite(c.audioDisplacement, 0.5), 0, 1);
  data[73] = clamp(finite(c.audioColor, 0.5), 0, 1);
  data[74] = clamp(finite(c.audioSensitivity, 1), 0, 3);
  data[75] = 0;

  const sourceId = String(options.sourceId || 'splat-native-source');
  const safe = sourceId.replace(/[^a-zA-Z0-9:_-]+/g, '_');
  const uniformId = `splat:${safe}:uniform`;
  const pointBytes = Math.max(32, options.pointCount * SPLAT_POINT_VEC4S * 16);
  const pointsBuffer: Record<string, unknown> = {
    id: options.pointsBufferId,
    kind: 'storage',
    byte_length: pointBytes,
    persistent: true,
  };
  if (options.pointsB64) {
    pointsBuffer.initial_b64 = options.pointsB64;
    pointsBuffer.clear = true; // force recreate so byte_length changes apply
  }
  return {
    state: null as null,
    config: {
      buffers: [
        { id: uniformId, kind: 'uniform', byte_length: SPLAT_UNIFORM_BYTES, initial_f32: Array.from(data) },
        pointsBuffer,
      ],
      passes: [],
      readbacks: [],
      render_passes: [{
        name: 'splat-render',
        shader_id: SPLAT_NATIVE_SHADER_ID,
        vertex_entry: 'vs_point',
        fragment_entry: 'fs_point',
        target: 'source_frame',
        source_id: sourceId,
        seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: true,
        clear_color: [0, 0, 0, 0],
        include_snapshot: !!options.includeSnapshot,
        blend: 'alpha',
        primitive: 'triangle-list',
        vertex_count: 6,
        instance_count: Math.max(1, options.pointCount),
        bindings: [
          { binding: 0, resource: uniformId, kind: 'uniform' },
          { binding: 1, resource: options.pointsBufferId, kind: 'read-only-storage' },
        ],
      }],
    },
    sourceId,
    passCount: 1,
  };
}

export function buildSplatNativePrecompileCommands() {
  return [{
    type: 'precompile_shader' as const,
    shader_id: SPLAT_NATIVE_SHADER_ID,
    stage: 'render' as const,
    entry: 'fs_point',
    source: SPLAT_NATIVE_WGSL,
  }];
}

export const SPLAT_NATIVE_WGSL = /* wgsl */`
struct SplatParams {
  vp0: vec4<f32>, vp1: vec4<f32>, vp2: vec4<f32>, vp3: vec4<f32>,
  screen: vec4<f32>,   // width, height, time, pointCount
  render0: vec4<f32>,  // pointSize, sizeAttenuation, renderMode, opacity
  anim0: vec4<f32>,    // animType, progress*intensity, explodeForce, voxelGrid
  anim1: vec4<f32>,    // peelAxis, peelDir, gravity, turbulence
  disp0: vec4<f32>,    // dispType, amount, noiseScale, noiseSpeed
  disp1: vec4<f32>,    // waveFreq, waveAmp, glitch, windStrength
  wind: vec4<f32>,     // windDir.xyz, scaleUniform
  rot: vec4<f32>,      // rotXYZ, posX
  pos: vec4<f32>,      // posY, posZ, audioLevel, beat
  colA: vec4<f32>,     // useOriginal, colorA.rgb
  colB: vec4<f32>,     // colorB.rgb, colorMix
  colFx: vec4<f32>,    // hueShift, colorEffect, colorIntensity, holoSpeed
  opFx: vec4<f32>,     // holoDensity, opacityEffect, opacityIntensity, dofFocal
  opFx2: vec4<f32>,    // fogDensity, pulseSpeed, dissolve, density
  audio: vec4<f32>,    // audioDisp, audioColor, audioSens, pad
  pad0: vec4<f32>, pad1: vec4<f32>, pad2: vec4<f32>, pad3: vec4<f32>, pad4: vec4<f32>,
}
@group(0) @binding(0) var<uniform> sp: SplatParams;
@group(0) @binding(1) var<storage, read> points: array<vec4<f32>>;

fn sp_hash(n: f32) -> f32 { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
fn sp_hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn sp_noise3(p: vec3<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = sp_hash2(i.xy + i.z * 57.0);
  let n100 = sp_hash2(i.xy + vec2<f32>(1.0, 0.0) + i.z * 57.0);
  let n010 = sp_hash2(i.xy + vec2<f32>(0.0, 1.0) + i.z * 57.0);
  let n110 = sp_hash2(i.xy + vec2<f32>(1.0, 1.0) + i.z * 57.0);
  let n001 = sp_hash2(i.xy + (i.z + 1.0) * 57.0);
  let n101 = sp_hash2(i.xy + vec2<f32>(1.0, 0.0) + (i.z + 1.0) * 57.0);
  let n011 = sp_hash2(i.xy + vec2<f32>(0.0, 1.0) + (i.z + 1.0) * 57.0);
  let n111 = sp_hash2(i.xy + vec2<f32>(1.0, 1.0) + (i.z + 1.0) * 57.0);
  let nx00 = mix(n000, n100, u.x); let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x); let nx11 = mix(n011, n111, u.x);
  return mix(mix(nx00, nx10, u.y), mix(nx01, nx11, u.y), u.z) * 2.0 - 1.0;
}
fn sp_hsv2rgb(c: vec3<f32>) -> vec3<f32> {
  let k = vec4<f32>(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(c.xxx + k.xyz) * 6.0 - k.www);
  return c.z * mix(vec3<f32>(1.0), clamp(p - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0)), c.y);
}
fn sp_rgb2hsv(c: vec3<f32>) -> vec3<f32> {
  let k = vec4<f32>(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = mix(vec4<f32>(c.bg, k.wz), vec4<f32>(c.gb, k.xy), step(c.b, c.g));
  let q = mix(vec4<f32>(p.xyw, c.r), vec4<f32>(c.r, p.yzx), step(p.x, c.r));
  let d = q.x - min(q.w, q.y);
  let e = 1.0e-10;
  return vec3<f32>(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) world: vec3<f32>,
  @location(3) misc: vec4<f32>, // vertexIndex, discard, viewZ, unused
}

@vertex fn vs_point(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VsOut {
  var out: VsOut;
  let p0 = points[ii * 2u];
  let p1 = points[ii * 2u + 1u];
  let t = sp.screen.z;
  let vidx = f32(ii);
  var kill = 0.0;

  // No points yet (file still parsing) or index beyond the uploaded cloud.
  if (vidx >= sp.screen.w) { kill = 1.0; }
  // Point density: deterministically drop the tail of the shuffle.
  if (sp_hash(vidx * 0.61803) > sp.opFx2.w) { kill = 1.0; }

  var pos = p0.xyz * sp.wind.w;
  // Euler rotation Z*Y*X (matches the release shader)
  let cx = cos(sp.rot.x); let sx = sin(sp.rot.x);
  let cy = cos(sp.rot.y); let sy = sin(sp.rot.y);
  let cz = cos(sp.rot.z); let sz = sin(sp.rot.z);
  let rx = vec3<f32>(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);
  let ry = vec3<f32>(rx.x * cy + rx.z * sy, rx.y, -rx.x * sy + rx.z * cy);
  pos = vec3<f32>(ry.x * cz - ry.y * sz, ry.x * sz + ry.y * cz, ry.z);
  pos = pos + vec3<f32>(sp.rot.w, sp.pos.x, sp.pos.y);

  let orig = p0.xyz;
  let anim = i32(sp.anim0.x + 0.5);
  let at = sp.anim0.y;
  if (anim == 1) { pos = pos + normalize(orig + vec3<f32>(1e-5)) * at * sp.anim0.z; }
  else if (anim == 2) { pos = pos - normalize(orig + vec3<f32>(1e-5)) * at * sp.anim0.z; }
  else if (anim == 3) {
    var axis = vec3<f32>(0.0, 1.0, 0.0);
    if (sp.anim1.x < 0.5) { axis = vec3<f32>(1.0, 0.0, 0.0); }
    else if (sp.anim1.x > 1.5) { axis = vec3<f32>(0.0, 0.0, 1.0); }
    if (dot(pos, axis * sp.anim1.y) > (at * 2.0 - 1.0) * 2.0) { kill = 1.0; }
  }
  else if (anim == 4) { pos = mix(orig, floor(orig * sp.anim0.w + 0.5) / sp.anim0.w, at); }
  else if (anim == 5) {
    var axis = vec3<f32>(0.0, 1.0, 0.0);
    if (sp.anim1.x < 0.5) { axis = vec3<f32>(1.0, 0.0, 0.0); }
    else if (sp.anim1.x > 1.5) { axis = vec3<f32>(0.0, 0.0, 1.0); }
    if (dot(orig, axis * sp.anim1.y) > mix(-2.0, 2.0, at)) { kill = 1.0; }
  }
  else if (anim == 6) {
    let fall = max(0.0, at - vidx * 0.0001);
    pos = pos + vec3<f32>(0.0, -sp.anim1.z * fall * fall, 0.0);
  }
  else if (anim == 7) {
    let gp = floor(sp_noise3(orig * 0.5) * 4.0) * 1.57;
    let center = vec3<f32>(sin(t * 0.7 + gp) * 0.8, cos(t * 0.5 + gp * 0.7) * 0.5, sin(t * 0.6 + gp * 1.3) * 0.8);
    let sep = vec3<f32>(sp_noise3(orig * 3.0 + t * 1.5), sp_noise3(orig * 3.0 + t * 1.5 + 50.0), sp_noise3(orig * 3.0 + t * 1.5 + 100.0)) * 0.4;
    let flow = vec3<f32>(sp_noise3(orig * 0.8 + t * 0.8 + 200.0), sp_noise3(orig * 0.8 + t * 0.6 + 300.0) * 0.5, sp_noise3(orig * 0.8 + t * 0.8 + 400.0)) * 0.6;
    pos = pos + ((center - orig) * 0.3 + sep + flow) * at * sp.anim1.w;
  }
  else if (anim == 8) {
    let r = max(length(orig), 0.001);
    let angle = (at * 1.5 + vidx * 0.0001) * 0.3;
    let ca = cos(angle); let sa = sin(angle);
    let sph = normalize(orig + vec3<f32>(1e-5)) * r;
    let rotated = vec3<f32>(sph.x * ca - sph.z * sa, sph.y + sin(t * 0.5 + length(orig.xz) * 3.0) * 0.1 * at, sph.x * sa + sph.z * ca);
    pos = mix(pos, rotated, at);
  }
  else if (anim == 9) {
    let angle = at * 6.28318 + vidx * 0.01;
    let r = length(pos.xz);
    pos = vec3<f32>(cos(angle) * r, pos.y, sin(angle) * r);
  }
  else if (anim == 10) { pos = pos + vec3<f32>(0.0, sin(length(orig.xz) * 5.0 - t * 3.0) * 0.3 * at, 0.0); }
  else if (anim == 11) {
    pos = pos + vec3<f32>(sp_noise3(orig * 10.0 + t), sp_noise3(orig * 10.0 + t + 100.0), sp_noise3(orig * 10.0 + t + 200.0)) * at * 2.0;
  }
  else if (anim == 12) {
    let angle = at * 12.5664 + vidx * 0.001;
    pos = pos + vec3<f32>(cos(angle) * at * 2.0, at * 2.0, sin(angle) * at * 2.0) * 0.5;
  }

  // Displacement
  let dtp = i32(sp.disp0.x + 0.5);
  if (dtp == 1) {
    let ns = sp.disp0.z; let nt = t * sp.disp0.w;
    pos = pos + vec3<f32>(
      sp_noise3(pos * ns + vec3<f32>(100.0, 0.0, 0.0) + nt),
      sp_noise3(pos * ns + vec3<f32>(0.0, 100.0, 0.0) + nt),
      sp_noise3(pos * ns + vec3<f32>(0.0, 0.0, 100.0) + nt)) * sp.disp0.y;
  } else if (dtp == 2) {
    let ad = sp.pos.z * sp.audio.x + sp.pos.w * sp.audio.x * 0.5;
    pos = pos + normalize(pos + vec3<f32>(1e-5)) * ad;
  } else if (dtp == 3) {
    var w = sin(pos.x * sp.disp1.x + t * 2.0) * sp.disp1.y;
    w = w + sin(pos.z * sp.disp1.x + t * 1.5) * sp.disp1.y;
    pos = pos + vec3<f32>(0.0, w * sp.disp0.y, 0.0);
  } else if (dtp == 4) {
    let g = step(0.99 - sp.disp1.z * 0.1, fract(sin(t * 100.0 + vidx) * 43758.5453));
    pos = pos + (vec3<f32>(sp_hash(vidx * 12.9898 + t), sp_hash(vidx * 78.233 + t), sp_hash(vidx * 45.164 + t)) - 0.5) * g * sp.disp0.y;
  } else if (dtp == 5) {
    let w = sp_noise3(pos * 2.0 + sp.wind.xyz * t * sp.disp1.w);
    pos = pos + sp.wind.xyz * w * sp.disp0.y;
  } else if (dtp == 7) {
    let d = length(pos);
    let ripple = sin(d * 10.0 - t * 5.0) * exp(-d * 2.0);
    pos = pos + normalize(pos + vec3<f32>(1e-5)) * ripple * sp.disp0.y;
  }

  // Audio scale
  pos = pos * (1.0 + sp.pos.z * sp.audio.z * 0.2);

  let view = sp.vp0 * pos.x + sp.vp1 * pos.y + sp.vp2 * pos.z + sp.vp3;
  var size_px = sp.render0.x * p1.x;
  if (sp.render0.y > 0.5) { size_px = size_px * clamp(6.0 / max(0.1, view.w), 0.1, 20.0); }
  size_px = clamp(size_px, 0.5, 900.0);

  var corner = vec2<f32>(-1.0, -1.0);
  switch (vi) {
    case 1u, 4u: { corner = vec2<f32>(1.0, -1.0); }
    case 2u, 3u: { corner = vec2<f32>(-1.0, 1.0); }
    case 5u: { corner = vec2<f32>(1.0, 1.0); }
    default: { corner = vec2<f32>(-1.0, -1.0); }
  }
  var clip = view;
  if (view.w <= 0.01 || kill > 0.5) {
    clip = vec4<f32>(0.0, 0.0, -10.0, 1.0); // off-screen cull
  } else {
    let px = corner * size_px / vec2<f32>(sp.screen.x, sp.screen.y) * view.w;
    clip = vec4<f32>(view.x + px.x, view.y + px.y, view.z, view.w);
  }
  out.position = clip;
  out.corner = corner;
  let packed = bitcast<u32>(p0.w);
  out.color = vec4<f32>(
    f32(packed & 0xffu) / 255.0,
    f32((packed >> 8u) & 0xffu) / 255.0,
    f32((packed >> 16u) & 0xffu) / 255.0,
    f32((packed >> 24u) & 0xffu) / 255.0);
  out.world = pos;
  out.misc = vec4<f32>(vidx, kill, view.w, 0.0);
  return out;
}

@fragment fn fs_point(in: VsOut) -> @location(0) vec4<f32> {
  if (in.misc.y > 0.5) { discard; }
  let t = sp.screen.z;
  let coord = in.corner * 0.5;
  let dist = length(coord);
  var edge = 1.0;
  let mode = i32(sp.render0.z + 0.5);
  if (mode == 0) {
    if (dist > 0.5) { discard; }
    edge = 1.0 - smoothstep(0.4, 0.5, dist);
  } else if (mode == 1) {
    let g = exp(-dist * dist * 8.0);
    if (g < 0.01) { discard; }
    edge = g;
  } else if (mode == 2) {
    if (dist > 0.5) { discard; }
    let z = sqrt(max(0.0, 0.25 - dist * dist));
    let n = normalize(vec3<f32>(coord, z));
    edge = 0.3 + 0.7 * max(0.0, dot(n, normalize(vec3<f32>(0.5, 0.5, 1.0))));
  } else if (mode == 3) {
    if (abs(coord.x) > 0.45 || abs(coord.y) > 0.45) { discard; }
  } else {
    if (abs(coord.x) + abs(coord.y) > 0.5) { discard; }
    edge = 1.0 - (abs(coord.x) + abs(coord.y)) * 0.5;
  }

  var color = in.color.rgb;
  if (sp.colA.x < 0.5) { color = mix(sp.colA.yzw, sp.colB.xyz, sp.colB.w); }

  // Hue shift
  if (abs(sp.colFx.x) > 0.01) {
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + sp.colFx.x / 360.0);
    color = sp_hsv2rgb(hsv);
  }
  let fx = i32(sp.colFx.y + 0.5);
  let fi = sp.colFx.z;
  let wp = in.world;
  if (fx == 1) {
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + (wp.x + wp.y + wp.z) * 0.05 * fi + t * 0.05);
    hsv.y = min(1.0, hsv.y + 0.3 * fi);
    color = mix(color, sp_hsv2rgb(hsv), fi);
  } else if (fx == 2) {
    let heat = clamp((wp.y + 5.0) / 10.0, 0.0, 1.0);
    var hc = mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(0.0, 0.5, 1.0), heat * 3.0);
    if (heat >= 0.33) { hc = mix(vec3<f32>(0.0, 0.5, 1.0), vec3<f32>(1.0, 1.0, 0.0), (heat - 0.33) * 3.0); }
    if (heat >= 0.66) { hc = mix(vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), (heat - 0.66) * 3.0); }
    color = mix(color, hc, fi);
  } else if (fx == 3) {
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + sin(t * 2.0 + sp_hash2(wp.xy) * 6.28) * 0.5 * fi);
    color = sp_hsv2rgb(hsv);
  } else if (fx == 4) {
    let scan = fract(wp.y * sp.opFx.x * 0.1 + t * sp.colFx.w);
    let flick = 0.9 + 0.1 * sin(t * 30.0 + wp.x * 10.0);
    color = mix(color, vec3<f32>(0.2, 0.8, 1.0) * flick, scan * fi);
  } else if (fx == 5) {
    color = mix(color, sp_hsv2rgb(vec3<f32>(fract((wp.y + wp.x * 0.3) * 0.1 + t * 0.1), 1.0, 1.0)), fi);
  } else if (fx == 6) {
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + sp.pos.z * sp.audio.y);
    hsv.z = min(1.0, hsv.z + sp.pos.z * 0.3 + sp.pos.w * 0.4);
    color = sp_hsv2rgb(hsv);
  } else if (fx == 7) {
    let depth = clamp((wp.z + 10.0) / 20.0, 0.0, 1.0);
    color = mix(color, mix(vec3<f32>(1.0, 0.3, 0.1), vec3<f32>(0.1, 0.3, 1.0), depth), fi);
  } else if (fx == 8) {
    var hsv = sp_rgb2hsv(color);
    let neon = sp_hsv2rgb(vec3<f32>(hsv.x, 1.0, 1.0));
    color = mix(color, neon * (1.0 + 0.5 * sin(t * 3.0 + wp.x * 5.0)), fi);
  } else if (fx == 9) {
    var hsv = sp_rgb2hsv(color);
    hsv.y = hsv.y * 0.4;
    hsv.z = 0.9 + 0.1 * hsv.z;
    color = mix(color, sp_hsv2rgb(hsv), fi);
  } else if (fx == 10) {
    let m = sin(wp.x * 2.0 + t) * 0.5 + 0.5;
    color = mix(color, mix(vec3<f32>(1.0, 0.0, 0.8), vec3<f32>(0.0, 1.0, 1.0), m), fi);
  } else if (fx == 11) {
    let f = sp_hash2(wp.xy * 3.0 + vec2<f32>(0.0, -t * 2.0));
    var fc = mix(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), f);
    fc = mix(fc, vec3<f32>(1.0, 0.5, 0.0), sin(f * 3.14));
    color = mix(color, fc, fi);
  } else if (fx == 12) {
    let f = sp_hash2(wp.xy * 2.0 + t * 0.2);
    color = mix(color, mix(vec3<f32>(0.7, 0.9, 1.0), vec3<f32>(0.3, 0.6, 0.9), f), fi);
  }

  var alpha = in.color.a * sp.render0.w * edge;
  let ofx = i32(sp.opFx.y + 0.5);
  let oi = sp.opFx.z;
  if (ofx == 1) {
    let d = abs(wp.z - sp.opFx.w * 4.0 - 2.0);
    alpha = alpha * (1.0 - smoothstep(0.0, 3.0, d) * oi);
  } else if (ofx == 2) {
    let fog = 1.0 - exp(-length(wp) * sp.opFx2.x * 0.1);
    alpha = alpha * (1.0 - fog * oi);
  } else if (ofx == 3) {
    let pulse = (sin(t * sp.opFx2.y * 3.14159) + 1.0) * 0.5;
    alpha = alpha * (1.0 - (1.0 - pulse) * oi);
  } else if (ofx == 4) {
    alpha = alpha * mix(1.0, 1.0 - smoothstep(0.0, 5.0, length(wp)), oi);
  } else if (ofx == 5) {
    if (sp_hash2(wp.xy + wp.z) < sp.opFx2.z * oi) { discard; }
  } else if (ofx == 6) {
    let scan = fract(t * 0.3);
    alpha = alpha * mix(1.0, smoothstep(scan - 0.2, scan, (wp.y + 5.0) / 10.0), oi);
  } else if (ofx == 7) {
    alpha = alpha * (0.5 + sp.pos.z * 0.5);
  }

  if (alpha < 0.004) { discard; }
  return vec4<f32>(color * alpha, alpha);
}
`;
