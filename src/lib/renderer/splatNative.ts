// Native Splat / Point Cloud renderer. The parsed point buffer uploads
// ONCE into a persistent GPU storage buffer (base64, only when the file
// signature changes); every frame packs a small camera/params uniform and
// the GPU draws one instanced quad per point. Ports the release
// SplatRenderer's vertex animations, displacement fields, render modes,
// and color/opacity effects to WGSL.
import type { SplatContent } from '$lib/types';
import { resolveSplatAnimationClock } from '$lib/splat/splatMotion';
import { composeSplatRotationRadians, hexToRgb01 } from '$lib/splat/splatTransform';

export const SPLAT_NATIVE_SHADER_ID = 'splat/render-v1';
// Matches the release renderer's point budget — larger scans are sampled
// down to this during parsing (with the loader reporting decimation).
export const SPLAT_MAX_POINTS = 1_500_000;
export const SPLAT_POINT_VEC4S = 2;
export const SPLAT_UNIFORM_VEC4S = 43;
export const SPLAT_UNIFORM_BYTES = SPLAT_UNIFORM_VEC4S * 16;

const ANIMATION_TYPES = [
  'none', 'explode', 'implode', 'slice', 'voxelSnap', 'peel',
  'gravity', 'swarm', 'morph', 'orbit', 'wave3d', 'scatter', 'spiral',
  'tumble', 'breathe', 'drift', 'vortex',
];
const DISPLACEMENT_TYPES = [
  'none', 'noise', 'audioReactive', 'wave', 'glitch', 'wind', 'magnetic', 'ripple',
  'curlNoise', 'twist', 'radialPulse', 'scanline',
];
const CREATIVE_EFFECTS = ['none', 'feedback', 'kaleidoscope', 'constellation', 'datamosh', 'pixelSort', 'echo'];
const MOUSE_MODES = ['attract', 'repel', 'swirl', 'reveal'];

// Pack-side audio smoothing. The WebGL renderer smooths statefully per
// rendered frame (smoothSplatAudio EMA); packing is stateless, so the EMA
// state lives here keyed by sourceId — same recurrence, same per-frame cadence.
const splatAudioSmoothState = new Map<string, number>();

/** Invert a column-major 4x4 (general adjugate method). */
function invertMat4(m: number[]): number[] | null {
  const inv = new Array(16).fill(0);
  inv[0] = m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
  inv[4] = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
  inv[8] = m[4]*m[9]*m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
  inv[12] = -m[4]*m[9]*m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];
  inv[1] = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
  inv[5] = m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
  inv[9] = -m[0]*m[9]*m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
  inv[13] = m[0]*m[9]*m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];
  inv[2] = m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
  inv[6] = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
  inv[10] = m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
  inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];
  inv[3] = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
  inv[7] = m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
  inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9] + m[4]*m[1]*m[11] - m[4]*m[3]*m[9] - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
  inv[15] = m[0]*m[5]*m[10] - m[0]*m[6]*m[9] - m[4]*m[1]*m[10] + m[4]*m[2]*m[9] + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];
  const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null;
  for (let i = 0; i < 16; i++) inv[i] /= det;
  return inv;
}

function transformPoint(m: number[], x: number, y: number, z: number): [number, number, number, number] {
  return [
    m[0]*x + m[4]*y + m[8]*z + m[12],
    m[1]*x + m[5]*y + m[9]*z + m[13],
    m[2]*x + m[6]*y + m[10]*z + m[14],
    m[3]*x + m[7]*y + m[11]*z + m[15],
  ];
}

/** Unproject a normalized screen point (0..1, y-down) onto the world
 *  plane at the cloud's depth, matching the WebGL renderer's mouse feel. */
function unprojectSplatPointer(vp: number[], px: number, py: number): [number, number, number] {
  const inv = invertMat4(vp);
  if (!inv) return [0, 0, 0];
  const originClip = transformPoint(vp, 0, 0, 0);
  const ndcZ = originClip[3] !== 0 ? originClip[2] / originClip[3] : 0.5;
  const ndcX = px * 2 - 1;
  const ndcY = (1 - py) * 2 - 1;
  const world = transformPoint(inv, ndcX, ndcY, ndcZ);
  if (world[3] === 0) return [0, 0, 0];
  return [world[0] / world[3], world[1] / world[3], world[2] / world[3]];
}
const RENDER_MODES = ['points', 'gaussians', 'spheres', 'billboards', 'cubes'];
// Names must match the panel/WebGL canon (SplatRenderer.getColorEffectIndex):
// 'chromatic' and 'neon', not 'chromaticShift'/'neonGlow'.
const COLOR_EFFECTS = [
  'none', 'chromatic', 'heatmap', 'pointillist', 'hologram', 'rainbow',
  'audioColor', 'depthGradient', 'neon', 'pastel', 'cyberpunk', 'fire', 'ice',
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
  /** Flattened visual-audio band levels for the audioBand selector. */
  audioBands?: { sub?: number; bass?: number; lowMid?: number; mid?: number; highMid?: number; high?: number };
  audioBeat?: number;
  audioBeatPhase?: number;
  pointer?: { x: number; y: number; active: boolean; down: boolean };
  includeSnapshot?: boolean;
  /** Source-frame id holding the projection texture pixels (bound even when
   *  absent — the fragment shader statically samples it). */
  textureSourceId?: string;
  /** True once the texture pixels have been uploaded. */
  hasTexture?: boolean;
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
  // audioBand picks the driving band ('all' = full-mix level), audioSensitivity
  // scales it, audioSmoothing is the WebGL EMA reproduced pack-side (keyed by
  // sourceId; see splatAudioSmoothState).
  const band = String(c.audioBand ?? 'all');
  const bands = options.audioBands;
  const bandLevel = band === 'all' || !bands
    ? finite(options.audioLevel, 0)
    : finite(bands[band as keyof typeof bands], 0);
  const sensitivity = clamp(finite(c.audioSensitivity, 1), 0, 4);
  const smoothing = clamp(finite(c.audioSmoothing, 0.7), 0, 0.98);
  const smoothKey = String(options.sourceId || 'splat-native-source');
  const rawLevel = audioOn ? clamp(bandLevel * sensitivity, 0, 1.5) : 0;
  const smoothedLevel = (splatAudioSmoothState.get(smoothKey) ?? 0) * smoothing
    + rawLevel * (1 - smoothing);
  splatAudioSmoothState.set(smoothKey, smoothedLevel);
  const level = audioOn ? smoothedLevel : 0;
  const beat = audioOn ? clamp(finite(options.audioBeat, 0), 0, 1.5) : 0;
  const beatPhase = clamp(finite(options.audioBeatPhase, 0), 0, 1);
  const density = clamp(finite(c.pointDensity, 1), 0.01, 1);

  const clockSpeed = finite(c.animationSpeed, 1);
  const clock = resolveSplatAnimationClock({
    time,
    speed: clockSpeed > 0 ? clockSpeed : 0,
    loop: c.animationLoop !== false,
    pingPong: c.animationPingPong === true,
    manualProgress: clamp(finite(c.animationProgress, 0), 0, 1),
  });

  // Object rotation: import orientation + auto-level + manual, with the
  // native gizmo's calibrated X/Y exchange. autoRotate stays on the camera
  // (splatViewProjection) so it is not double-applied here.
  const [rotXr, rotYr, rotZr] = composeSplatRotationRadians(c, 0);
  const keyColor = hexToRgb01(c.keyLightColor as string | undefined, '#ffffff');
  const rimColor = hexToRgb01(c.rimLightColor as string | undefined, '#33aaff');
  const atmosColor = hexToRgb01(c.atmosphereColor as string | undefined, '#14202b');
  const bgColor = hexToRgb01(c.backgroundColor as string | undefined, '#000000');
  const fogColor = hexToRgb01(c.fogColor as string | undefined, '#323250');
  const depthNear = hexToRgb01(c.depthColorNear as string | undefined, '#ff5c33');
  const depthFar = hexToRgb01(c.depthColorFar as string | undefined, '#3377ff');
  const keyAz = (finite(c.keyLightAzimuth, 35) * Math.PI) / 180;
  const keyEl = (finite(c.keyLightElevation, 40) * Math.PI) / 180;
  const keyDir = [
    Math.cos(keyEl) * Math.sin(keyAz),
    Math.sin(keyEl),
    Math.cos(keyEl) * Math.cos(keyAz),
  ];
  const rimAz = (finite(c.rimLightAzimuth, -45) * Math.PI) / 180;
  const rimLen = Math.hypot(Math.sin(rimAz), 0.35, Math.cos(rimAz)) || 1;
  const rimDir = [Math.sin(rimAz) / rimLen, 0.35 / rimLen, Math.cos(rimAz) / rimLen];

  // Mouse: normalized screen -> world plane at the cloud's depth. Radius
  // scales with the normalized cloud size (extent 4) like the reference.
  const pointer = options.pointer;
  // The panel select writes `mouseInteraction`; its doUpdate mirrors that into
  // `mouseMode`, but MIDI/preset paths write `mouseInteraction` alone, so the
  // packer must prefer the panel field ('none' disables the interaction).
  const interaction = c.mouseInteraction as string | undefined;
  const mouseModeName = interaction && interaction !== 'none' ? interaction : (c.mouseMode ?? 'attract');
  const mouseModeIdx = Math.max(0, idx(MOUSE_MODES, mouseModeName));
  const mouseStrength = clamp(finite(c.mouseStrength, 1), 0, 2);
  // The panel floors mouseInfluence to 1 whenever an interaction is chosen,
  // but MIDI/preset writes to mouseInteraction skip that mirror — apply the
  // same floor here so Strength is live whenever the interaction is on.
  const rawInfluence = interaction === 'none'
    ? 0
    : clamp(
        interaction ? Math.max(finite(c.mouseInfluence, 0), 1) : finite(c.mouseInfluence, 0),
        0, 2,
      ) * mouseStrength;
  const mouseActive = !!pointer?.active && rawInfluence > 0;
  const mouseWorld = mouseActive
    ? unprojectSplatPointer(vp, clamp(finite(pointer!.x, 0.5), 0, 1), clamp(finite(pointer!.y, 0.5), 0, 1))
    : [0, 0, 0];
  const mouseRadius = clamp(finite(c.mouseRadius, 0.2), 0, 1)
    * 4 * Math.max(0.05, finite(c.scaleUniform, 1)) * 0.5;

  const slicePlane = (c as { slicePlane?: { enabled?: boolean; axis?: string; position?: number; thickness?: number; animated?: boolean; speed?: number } }).slicePlane;
  const sliceAxisIdx = slicePlane?.axis === 'x' ? 0 : slicePlane?.axis === 'z' ? 2 : 1;
  const slicePos = slicePlane?.animated
    ? Math.sin(time * finite(slicePlane?.speed, 1)) * 2
    : finite(slicePlane?.position, 0) * 2;

  const anim = Math.max(0, idx(ANIMATION_TYPES, c.animationType));
  const peel = c.peelAxis === 'x' ? 0 : c.peelAxis === 'z' ? 2 : 1;
  const waveAxisIdx = c.waveAxis === 'x' ? 0 : c.waveAxis === 'z' ? 2 : 1;
  const physics = (c as { physics?: { gravity?: number; turbulence?: number } }).physics;

  const put4 = (v4: number, a: number, b: number, cc: number, d: number) => {
    data[v4 * 4] = a; data[v4 * 4 + 1] = b; data[v4 * 4 + 2] = cc; data[v4 * 4 + 3] = d;
  };
  // vec4 4: screen
  put4(4, width, height, time, options.pointCount);
  // vec4 5: render — ×3 point size (slider calibrated for DPR-scaled WebGL)
  const sizeBase = Math.max(0.15, finite(c.pointSize, 3)) * 3
    * (audioOn ? 1 + level * finite(c.audioScale, 0) * 0.5 + beat * finite(c.audioScale, 0) * 0.3 : 1);
  // The panel toggle writes `sizeAttenuation` (doUpdate mirrors it into
  // pointSizeAttenuation, but MIDI paths write sizeAttenuation alone). The old
  // && required BOTH fields false, so the toggle alone never reached 0.
  put4(5, sizeBase,
    (c.sizeAttenuation ?? c.pointSizeAttenuation) === false ? 0 : 1,
    Math.max(0, idx(RENDER_MODES, c.renderMode)),
    clamp(finite(c.opacity, 1), 0, 1));
  // vec4 6-14: animation clock + per-animation tunables
  put4(6, anim, clock.progress, clock.phase, clamp(finite(c.animationIntensity, 1), 0, 3));
  put4(7, Math.max(0, finite(c.explodeForce, 1)), finite((c as any).explodeTurbulence, 0.35),
    finite((c as any).implodeForce, 0.85), finite((c as any).implodeSpin, 1.5));
  put4(8, clamp(finite(c.voxelGridSize, 8), 2, 64), peel, finite(c.peelDirection, 1),
    Math.max(0.01, finite((c as any).peelWidth, 0.55)));
  put4(9, finite((c as any).peelCurl, 2.2), Math.max(0.05, finite((c as any).sliceWidth, 3)),
    clamp(finite((c as any).sliceSoftness, 0.2), 0.001, 0.99), finite((c as any).sliceTravel, 1));
  put4(10, waveAxisIdx, finite((c as any).animationWaveFrequency, 5),
    finite((c as any).animationWaveAmplitude, 0.3), finite((c as any).scatterDistance, 2));
  put4(11, finite((c as any).scatterRandomness, 8), finite((c as any).spiralRadius, 0.75),
    finite((c as any).spiralTurns, 2), finite((c as any).spiralLift, 1));
  put4(12, finite(c.swarmCohesion, 0.3), finite((c as any).swarmSeparation, 0.4),
    finite(c.swarmAlignment, 0.6), finite((c as any).gravityStrength, 2));
  put4(13, finite((c as any).gravitySpread, 0.25), finite((c as any).gravityFloor, -2),
    (finite((c as any).turntableTilt, 0) * Math.PI) / 180, finite((c as any).tumbleSpread, 1));
  put4(14, finite((c as any).breatheAmount, 0.15), finite((c as any).driftAmount, 0.25),
    finite((c as any).vortexTwist, 2), finite((c as any).morphRoundness, 1));
  // vec4 15-17: physics + displacement
  // Panel's Physics section writes top-level `gravity` (-20..20); the nested
  // physics.gravity default (9.8) was shadowing it.
  put4(15, finite(c.gravity, finite(physics?.gravity, 5)), Math.max(0.1, finite(physics?.turbulence, 1)),
    Math.max(0, idx(DISPLACEMENT_TYPES, c.displacementType)),
    Math.max(0, finite(c.displacementAmount, finite(c.displacementIntensity, 0.5))));
  put4(16, Math.max(0.05, finite(c.displacementScale, finite(c.noiseScale, 2))),
    Math.max(0, finite(c.displacementSpeed, finite(c.noiseSpeed, 1))),
    Math.max(0.1, finite(c.waveFrequency, 2)), Math.max(0, finite(c.waveAmplitude, 0.3)));
  put4(17, clamp(finite(c.glitchIntensity, 0.5), 0, 1),
    finite(c.windDirection?.x, 1), finite(c.windDirection?.y, 0), finite(c.windDirection?.z, 0));
  // vec4 18-19: transform (gizmo-calibrated X/Y exchange preserved)
  put4(18, Math.max(0, finite(c.windStrength, 1)), Math.max(0.05, finite(c.scaleUniform, 1)), rotYr, rotXr);
  put4(19, rotZr, finite(c.positionX, 0), finite(c.positionY, 0), finite(c.positionZ, 0));
  // vec4 20-21: audio
  put4(20, audioOn ? 1 : 0, level, beat, clamp(finite(c.audioScale, 0.5), 0, 3));
  put4(21, clamp(finite(c.audioDisplacement, 0.5), 0, 2), clamp(finite(c.audioColor, 0.5), 0, 2), beatPhase, density);
  // vec4 22-27: color
  put4(22, c.useOriginalColors === false ? 0 : 1, clamp(finite(c.colorMix, 0), 0, 1),
    finite(c.hueShift, 0), Math.max(0, idx(COLOR_EFFECTS, c.colorEffect ?? c.colorEffectType)));
  put4(23, clamp(finite(c.colorA?.[0], 255) / 255, 0, 1), clamp(finite(c.colorA?.[1], 255) / 255, 0, 1),
    clamp(finite(c.colorA?.[2], 255) / 255, 0, 1), clamp(finite(c.colorEffectIntensity, 0.5), 0, 1));
  put4(24, clamp(finite(c.colorB?.[0], 255) / 255, 0, 1), clamp(finite(c.colorB?.[1], 255) / 255, 0, 1),
    clamp(finite(c.colorB?.[2], 255) / 255, 0, 1), Math.max(0, finite(c.hologramSpeed, 2)));
  put4(25, clamp(finite(c.hologramDensity, 10), 1, 50), clamp(finite(c.depthGradientBias, 0.5), 0.001, 1),
    Math.max(0, idx(OPACITY_EFFECTS, c.opacityEffect ?? c.opacityEffectType)),
    clamp(finite(c.opacityEffectIntensity, 0.5), 0, 1));
  // The panel's DOF slider writes `dofFocusDistance` on a 0..100 UI scale and
  // nothing syncs it into 0..1 `dofFocalDistance` (which stays at its 0.5
  // default and was shadowing the live control). Prefer the panel field.
  const dofFocusRaw = c.dofFocusDistance;
  const dofFocus = Number.isFinite(Number(dofFocusRaw))
    ? clamp(finite(dofFocusRaw, 50) / 100, 0, 1)
    : clamp(finite(c.dofFocalDistance, 0.5), 0, 1);
  put4(26, depthNear[0], depthNear[1], depthNear[2], dofFocus);
  put4(27, depthFar[0], depthFar[1], depthFar[2], Math.max(0.01, finite(c.dofBlurAmount, 1)));
  // vec4 28-29: opacity fx tail + creative
  put4(28, Math.max(0.05, finite(c.fogDensity as number, 1)), Math.max(0.05, finite(c.pulseSpeed as number, 1)),
    clamp(finite(c.dissolveProgress as number, 0.5), 0, 1),
    Math.max(0, idx(CREATIVE_EFFECTS, (c as any).creativeEffect ?? (c as any).creativeEffectType)));
  put4(29, fogColor[0], fogColor[1], fogColor[2], clamp(finite((c as any).creativeEffectIntensity, 0.5), 0, 1));
  // vec4 30-34: lighting
  put4(30, c.lightingEnabled === false ? 0 : 1, Math.max(0, finite(c.ambientIntensity, 1)),
    Math.max(0, finite(c.keyLightIntensity, 1)), clamp(finite(c.specularStrength, 0.3), 0, 2));
  put4(31, keyColor[0], keyColor[1], keyColor[2], clamp(finite(c.shadowStrength, 0.45), 0, 1));
  put4(32, keyDir[0], keyDir[1], keyDir[2], clamp(finite(c.shadowSoftness, 0.5), 0, 1));
  put4(33, rimColor[0], rimColor[1], rimColor[2], Math.max(0, finite(c.rimLightIntensity, 0.35)));
  put4(34, rimDir[0], rimDir[1], rimDir[2], c.atmosphereEnabled === true ? 1 : 0);
  // vec4 35-37: atmosphere + background
  put4(35, clamp(finite(c.atmosphereDensity, 0.2), 0, 1), Math.max(0.01, finite(c.atmosphereScale, 1.5)),
    Math.max(0, finite(c.atmosphereTurbulence, 0.7)), finite(c.atmosphereSpeed, 0.15));
  put4(36, atmosColor[0], atmosColor[1], atmosColor[2], clamp(finite(c.backgroundOpacity, 0), 0, 1));
  put4(37, bgColor[0], bgColor[1], bgColor[2], mouseModeIdx);
  // vec4 38-39: mouse + slice plane
  put4(38, mouseWorld[0], mouseWorld[1], mouseWorld[2], Math.max(0.001, mouseRadius));
  put4(39, mouseActive ? clamp(rawInfluence, 0, 2) : 0, slicePlane?.enabled ? 1 : 0, sliceAxisIdx, slicePos);
  // vec4 40: slice thickness + texture mapping (enabled, projection, blend)
  const TEX_PROJECTIONS = ['spherical', 'cylindrical', 'planarXY', 'planarXZ', 'planarYZ', 'box', 'native'];
  const texProjection = Math.max(0, TEX_PROJECTIONS.indexOf(String(c.textureProjection ?? 'spherical')));
  const texEnabled = options.hasTexture && (c.textureEnabled ?? false) ? 1 : 0;
  put4(
    40,
    Math.max(0.001, finite(slicePlane?.thickness, 0.1) * 4),
    texEnabled,
    texProjection,
    clamp(finite(c.textureBlend, 0.5), 0, 1),
  );
  // vec4 41: texture scale + offset
  put4(
    41,
    clamp(finite(c.textureScale, 1), 0.05, 8),
    clamp(finite(c.textureOffsetX, 0), -4, 4),
    clamp(finite(c.textureOffsetY, 0), -4, 4),
    Math.max(0, finite(c.colorEffectSpeed, 1)),
  );
  // vec4 42: stateless physics — enabled, friction, bounciness
  put4(
    42,
    c.physicsEnabled === true ? 1 : 0,
    clamp(finite(c.friction, 0.1), 0, 1),
    clamp(finite(c.bounciness, 0.5), 0, 1),
    0,
  );

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
        // Backdrop first: background color + scene atmosphere haze so fog
        // fills the layer, not just the points.
        name: 'splat-bg',
        shader_id: SPLAT_NATIVE_SHADER_ID,
        vertex_entry: 'vs_bg',
        fragment_entry: 'fs_bg',
        target: 'source_frame',
        source_id: sourceId,
        seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: true,
        clear_color: [0, 0, 0, 0],
        blend: 'alpha',
        primitive: 'triangle-list',
        vertex_count: 3,
        instance_count: 1,
        bindings: [
          { binding: 0, resource: uniformId, kind: 'uniform' },
          { binding: 1, resource: options.pointsBufferId, kind: 'read-only-storage' },
        ],
      }, {
        name: 'splat-render',
        shader_id: SPLAT_NATIVE_SHADER_ID,
        vertex_entry: 'vs_point',
        fragment_entry: 'fs_point',
        target: 'source_frame',
        source_id: sourceId,
        seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
        clear: false,
        include_snapshot: !!options.includeSnapshot,
        // Mirrors the WebGL material: content.depthTest toggles the test,
        // depth writes stay off (transparent points, depthWrite: false).
        depth: c.depthTest === true,
        depth_write: false,
        depth_compare: 'less-equal',
        blend: 'alpha',
        primitive: 'triangle-list',
        vertex_count: 6,
        instance_count: Math.max(1, options.pointCount),
        bindings: [
          { binding: 0, resource: uniformId, kind: 'uniform' },
          { binding: 1, resource: options.pointsBufferId, kind: 'read-only-storage' },
          // fs_point statically samples the projection texture, so the
          // binding must exist even with no texture loaded (the core assigns
          // an empty slot; texEnabled=0 keeps it a no-op).
          { binding: 2, kind: 'source-frame-texture', source_id: options.textureSourceId || `${sourceId}:splat-texture` },
          { binding: 3, kind: 'source-frame-sampler' },
        ],
      }],
    },
    sourceId,
    passCount: 2,
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
  screen: vec4<f32>,   // 4:  width, height, time, pointCount
  render0: vec4<f32>,  // 5:  pointSize, sizeAttenuation, renderMode, opacity
  anim0: vec4<f32>,    // 6:  animType, progress, phase, intensity
  anim1: vec4<f32>,    // 7:  explodeForce, explodeTurb, implodeForce, implodeSpin
  anim2: vec4<f32>,    // 8:  voxelGrid, peelAxis, peelDir, peelWidth
  anim3: vec4<f32>,    // 9:  peelCurl, sliceWidth, sliceSoftness, sliceTravel
  anim4: vec4<f32>,    // 10: waveAxis, waveFreqA, waveAmpA, scatterDist
  anim5: vec4<f32>,    // 11: scatterRand, spiralRadius, spiralTurns, spiralLift
  anim6: vec4<f32>,    // 12: swarmCoh, swarmSep, swarmAlign, gravStrength
  anim7: vec4<f32>,    // 13: gravSpread, gravFloor, turnTilt, tumbleSpread
  anim8: vec4<f32>,    // 14: breatheAmt, driftAmt, vortexTwist, morphRound
  phys: vec4<f32>,     // 15: gravity, turbulence, dispType, dispAmount
  disp0: vec4<f32>,    // 16: dispScale, dispSpeed, waveFreq, waveAmp
  disp1: vec4<f32>,    // 17: glitch, windX, windY, windZ
  xf0: vec4<f32>,      // 18: windStrength, scaleUniform, rotX, rotY
  xf1: vec4<f32>,      // 19: rotZ, posX, posY, posZ
  aud0: vec4<f32>,     // 20: audioOn, level, beat, audioScale
  aud1: vec4<f32>,     // 21: audioDisp, audioColor, beatPhase, density
  col0: vec4<f32>,     // 22: useOrig, colorMix, hueShift, colorFx
  col1: vec4<f32>,     // 23: colorA.rgb, colorFxIntensity
  col2: vec4<f32>,     // 24: colorB.rgb, holoSpeed
  col3: vec4<f32>,     // 25: holoDensity, depthBias, opacityFx, opacityFxIntensity
  col4: vec4<f32>,     // 26: depthNear.rgb, dofFocal
  col5: vec4<f32>,     // 27: depthFar.rgb, dofBlur
  op0: vec4<f32>,      // 28: fogDensity, pulseSpeed, dissolve, creativeFx
  op1: vec4<f32>,      // 29: fogColor.rgb, creativeIntensity
  li0: vec4<f32>,      // 30: lightOn, ambient, keyIntensity, specular
  li1: vec4<f32>,      // 31: keyColor.rgb, shadowStrength
  li2: vec4<f32>,      // 32: keyDir.xyz, shadowSoftness
  li3: vec4<f32>,      // 33: rimColor.rgb, rimIntensity
  li4: vec4<f32>,      // 34: rimDir.xyz, atmosOn
  at0: vec4<f32>,      // 35: atmosDensity, atmosScale, atmosTurb, atmosSpeed
  at1: vec4<f32>,      // 36: atmosColor.rgb, bgOpacity
  bg0: vec4<f32>,      // 37: bgColor.rgb, mouseMode
  mo0: vec4<f32>,      // 38: mouseX, mouseY, mouseZ, mouseRadius
  mo1: vec4<f32>,      // 39: mouseInfluence, sliceOn, sliceAxis, slicePos
  mi0: vec4<f32>,      // 40: sliceThickness, texEnabled, texProjection, texBlend
  pad: vec4<f32>,      // 41: texScale, texOffsetX, texOffsetY, colorFxSpeed
  phys2: vec4<f32>,    // 42: physicsOn, friction, bounciness, 0
}
@group(0) @binding(0) var<uniform> sp: SplatParams;
@group(0) @binding(1) var<storage, read> points: array<vec4<f32>>;
@group(0) @binding(2) var splat_tex: texture_2d<f32>;
@group(0) @binding(3) var splat_smp: sampler;

fn sp_hash(n: f32) -> f32 { return fract(sin(n * 12.9898 + 78.233) * 43758.5453); }
fn sp_hash2(p: vec2<f32>) -> f32 { return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453); }
fn sp_noise2(p: vec2<f32>) -> f32 {
  let i = floor(p); let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = sp_hash2(i);
  let b = sp_hash2(i + vec2<f32>(1.0, 0.0));
  let c = sp_hash2(i + vec2<f32>(0.0, 1.0));
  let d = sp_hash2(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
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
fn sp_axis(sel: f32) -> vec3<f32> {
  if (sel < 0.5) { return vec3<f32>(1.0, 0.0, 0.0); }
  if (sel > 1.5) { return vec3<f32>(0.0, 0.0, 1.0); }
  return vec3<f32>(0.0, 1.0, 0.0);
}

struct VsOut {
  @builtin(position) position: vec4<f32>,
  @location(0) corner: vec2<f32>,
  @location(1) color: vec4<f32>,
  @location(2) world: vec3<f32>,
  @location(3) misc: vec4<f32>, // vertexIndex, discard, viewW, mouseDistance
}

fn apply_animation(pos_in: vec3<f32>, orig: vec3<f32>, vidx: f32, t: f32, kill: ptr<function, f32>) -> vec3<f32> {
  var pos = pos_in;
  let anim = i32(sp.anim0.x + 0.5);
  let progress = clamp(sp.anim0.y, 0.0, 1.0);
  let phase = sp.anim0.z;
  let inten = sp.anim0.w;
  let at = progress * inten;
  let radial = normalize(orig + vec3<f32>(1e-4));

  if (anim == 1) { // explode
    let breakup = vec3<f32>(
      sp_noise3(orig * 2.7 + vec3<f32>(19.0, 0.0, phase * 0.12)),
      sp_noise3(orig * 2.7 + vec3<f32>(0.0, 43.0, phase * 0.15)),
      sp_noise3(orig * 2.7 + vec3<f32>(phase * 0.1, 0.0, 71.0)));
    return pos + (radial + breakup * sp.anim1.y) * at * sp.anim1.x;
  }
  if (anim == 2) { // implode
    let collapse = clamp(at * sp.anim1.z, 0.0, 0.995);
    let collapsed = pos * (1.0 - collapse);
    let angle = at * sp.anim1.w * (1.0 + length(orig.xz));
    let c = cos(angle); let s = sin(angle);
    return vec3<f32>(c * collapsed.x + s * collapsed.z, collapsed.y, -s * collapsed.x + c * collapsed.z);
  }
  if (anim == 3) { // slice bands
    let axis = sp_axis(sp.anim2.y);
    let axisPos = dot(orig, axis);
    let travel = phase * sp.anim3.w;
    let bandCoord = axisPos * max(sp.anim3.y, 0.05) - travel;
    let slab = floor(bandCoord);
    let edge = abs(fract(bandCoord) - 0.5) * 2.0;
    let bandMask = 1.0 - smoothstep(sp.anim3.z, 1.0, edge);
    var direction = 1.0;
    if ((abs(slab) % 2.0) < 1.0) { direction = -1.0; }
    var up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(axis.y) > 0.9) { up = vec3<f32>(1.0, 0.0, 0.0); }
    let tangent = normalize(cross(axis, up));
    return pos + tangent * direction * bandMask * at * 0.65;
  }
  if (anim == 4) { // voxel snap
    let grid = max(sp.anim2.x, 2.0);
    return mix(orig, floor(orig * grid + 0.5) / grid, at);
  }
  if (anim == 5) { // peel curl
    let axis = sp_axis(sp.anim2.y);
    let axisPos = dot(orig, axis) * sp.anim2.z;
    let front = mix(-2.5, 2.5, progress);
    let behind = front - axisPos;
    let w = max(sp.anim2.w, 0.01);
    let peelMask = smoothstep(0.0, w, behind) * (1.0 - smoothstep(w, w * 2.0, behind));
    var up = vec3<f32>(0.0, 0.0, 1.0);
    if (abs(axis.z) > 0.9) { up = vec3<f32>(0.0, 1.0, 0.0); }
    let tangent = normalize(cross(axis, up));
    let curl = peelMask * sp.anim3.x * inten;
    return pos + tangent * sin(curl) * w + axis * (1.0 - cos(curl)) * w;
  }
  if (anim == 6) { // gravity fall
    let delay = sp_hash(vidx * 12.9898) * 0.35;
    let fall = max(0.0, progress - delay) * inten;
    let spread = vec2<f32>(
      sp_noise3(orig * 2.0 + vec3<f32>(13.0, phase * 0.08, 0.0)),
      sp_noise3(orig * 2.0 + vec3<f32>(0.0, phase * 0.08, 37.0))) * sp.anim7.x;
    var fallen = pos + vec3<f32>(spread.x, -sp.anim6.w * fall * fall, spread.y) * at;
    fallen.y = max(fallen.y, sp.anim7.y);
    return fallen;
  }
  if (anim == 7) { // swarm
    let gp = floor(sp_noise3(orig * 0.5) * 4.0) * 1.57;
    let center = vec3<f32>(sin(t * 0.7 + gp) * 0.8, cos(t * 0.5 + gp * 0.7) * 0.5, sin(t * 0.6 + gp * 1.3) * 0.8);
    let sep = vec3<f32>(
      sp_noise3(orig * 3.0 + t * 1.5),
      sp_noise3(orig * 3.0 + t * 1.5 + 50.0),
      sp_noise3(orig * 3.0 + t * 1.5 + 100.0)) * 0.4;
    let flow = vec3<f32>(
      sp_noise3(orig * 0.8 + t * 0.8 + 200.0),
      sp_noise3(orig * 0.8 + t * 0.6 + 300.0) * 0.5,
      sp_noise3(orig * 0.8 + t * 0.8 + 400.0)) * 0.6;
    let offset = ((center - orig) * sp.anim6.x + sep * sp.anim6.y + flow * sp.anim6.z) * at * max(sp.phys.y, 0.1);
    return pos + offset;
  }
  if (anim == 8) { // morph to sphere
    let radius = mix(length(orig), max(length(orig), 0.75), sp.anim8.w);
    let sph = normalize(orig + vec3<f32>(1e-4)) * radius;
    let angle = (at * 1.5 + vidx * 0.0001) * 0.3;
    let ca = cos(angle); let sa = sin(angle);
    let rotated = vec3<f32>(
      sph.x * ca - sph.z * sa,
      sph.y + sin(t * 0.5 + length(orig.xz) * 3.0) * 0.1 * at,
      sph.x * sa + sph.z * ca);
    return mix(pos, rotated, at);
  }
  if (anim == 9) { // turntable
    let tilt = sp.anim7.z;
    let tilted = vec3<f32>(pos.x, cos(tilt) * pos.y - sin(tilt) * pos.z, sin(tilt) * pos.y + cos(tilt) * pos.z);
    let angle = phase * inten;
    let c = cos(angle); let s = sin(angle);
    return vec3<f32>(c * tilted.x + s * tilted.z, tilted.y, -s * tilted.x + c * tilted.z);
  }
  if (anim == 10) { // wave field
    let axis = sp_axis(sp.anim4.x);
    var up = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(axis.y) > 0.9) { up = vec3<f32>(1.0, 0.0, 0.0); }
    let travelAxis = normalize(cross(axis, up));
    let ph = dot(orig, travelAxis) * sp.anim4.y - phase * 2.0;
    return pos + axis * sin(ph) * sp.anim4.z * inten;
  }
  if (anim == 11) { // scatter
    let sr = sp.anim5.x;
    let scatter = vec3<f32>(
      sp_noise3(orig * sr + vec3<f32>(11.0, 0.0, 0.0)),
      sp_noise3(orig * sr + vec3<f32>(0.0, 29.0, 0.0)),
      sp_noise3(orig * sr + vec3<f32>(0.0, 0.0, 47.0)));
    return pos + normalize(scatter + vec3<f32>(1e-4)) * at * sp.anim4.w;
  }
  if (anim == 12) { // spiral
    let baseAngle = atan2(pos.z, pos.x);
    let radius = length(pos.xz) + at * sp.anim5.y;
    let angle = baseAngle + phase * sp.anim5.z + pos.y * sp.anim5.z * 0.35;
    return vec3<f32>(cos(angle) * radius, pos.y + at * sp.anim5.w, sin(angle) * radius);
  }
  if (anim == 13) { // tumble
    let spread = sp.anim7.w;
    let ax = phase * 0.37 * inten * spread;
    let ay = phase * 0.61 * inten * spread;
    let az = phase * 0.23 * inten * spread;
    let cx = cos(ax); let sx = sin(ax);
    let cy = cos(ay); let sy = sin(ay);
    let cz = cos(az); let sz = sin(az);
    let rx = vec3<f32>(pos.x, cx * pos.y - sx * pos.z, sx * pos.y + cx * pos.z);
    let ry = vec3<f32>(cy * rx.x + sy * rx.z, rx.y, -sy * rx.x + cy * rx.z);
    return vec3<f32>(cz * ry.x - sz * ry.y, sz * ry.x + cz * ry.y, ry.z);
  }
  if (anim == 14) { // breathe
    let pulse = sin(phase) * sp.anim8.x * inten;
    return pos * (1.0 + pulse);
  }
  if (anim == 15) { // drift
    let sPos = orig * 0.7;
    let drift = vec3<f32>(
      sp_noise3(sPos + vec3<f32>(phase * 0.10, 17.0, 0.0)),
      sp_noise3(sPos + vec3<f32>(0.0, phase * 0.08, 41.0)),
      sp_noise3(sPos + vec3<f32>(73.0, 0.0, phase * 0.09)));
    return pos + drift * sp.anim8.y * inten;
  }
  if (anim == 16) { // vortex
    let angle = phase * 0.3 + orig.y * sp.anim8.z * inten;
    let c = cos(angle); let s = sin(angle);
    return vec3<f32>(c * pos.x + s * pos.z, pos.y, -s * pos.x + c * pos.z);
  }
  let _unused = kill;
  return pos;
}

fn apply_displacement(pos_in: vec3<f32>, vidx: f32, t: f32) -> vec3<f32> {
  var pos = pos_in;
  let dtp = i32(sp.phys.z + 0.5);
  if (dtp == 0) { return pos; }
  let amount = sp.phys.w;
  let dScale = sp.disp0.x;
  let dSpeed = sp.disp0.y;
  let mousePos = sp.mo0.xyz;
  if (dtp == 1) { // noise
    let nt = t * dSpeed;
    return pos + vec3<f32>(
      sp_noise3(pos * dScale + vec3<f32>(100.0, 0.0, 0.0) + nt),
      sp_noise3(pos * dScale + vec3<f32>(0.0, 100.0, 0.0) + nt),
      sp_noise3(pos * dScale + vec3<f32>(0.0, 0.0, 100.0) + nt)) * amount;
  }
  if (dtp == 2) { // audio reactive
    if (sp.aud0.x < 0.5) { return pos; }
    let dir = normalize(pos + vec3<f32>(1e-4));
    let envelope = sp.aud0.y + sp.aud0.z * 0.65;
    let spatial = 0.65 + 0.35 * sin(length(pos) * max(dScale, 0.1) * 3.0 - t * dSpeed * 4.0);
    return pos + dir * envelope * sp.aud1.x * amount * spatial;
  }
  if (dtp == 3) { // wave
    var w = sin(pos.x * dScale + t * dSpeed * 2.0);
    w = w + sin(pos.z * dScale + t * dSpeed * 1.5);
    return pos + vec3<f32>(0.0, w * amount, 0.0);
  }
  if (dtp == 4) { // glitch
    let g = step(0.99 - sp.disp1.x * 0.1, fract(sin(t * 100.0 + vidx) * 43758.5453));
    let offset = vec3<f32>(
      fract(sin(vidx * 12.9898 + t) * 43758.5453) - 0.5,
      fract(sin(vidx * 78.233 + t) * 43758.5453) - 0.5,
      fract(sin(vidx * 45.164 + t) * 43758.5453) - 0.5);
    return pos + offset * g * amount;
  }
  if (dtp == 5) { // wind
    let wind = sp.disp1.yzw;
    let w = sp_noise3(pos * dScale + wind * t * dSpeed);
    return pos + wind * w * amount * max(sp.xf0.x, 0.0);
  }
  if (dtp == 6) { // magnetic — attract toward mouse (or origin)
    var attract_to = vec3<f32>(0.0);
    if (sp.mo1.x > 0.0) { attract_to = mousePos; }
    let delta = attract_to - pos;
    let dist = max(length(delta), 0.05);
    let field = 1.0 / (1.0 + dist * dist * max(dScale, 0.1));
    return pos + normalize(delta) * field * amount;
  }
  if (dtp == 7) { // ripple around mouse
    let dist = length(pos - mousePos);
    var ripple = sin(dist * dScale * 5.0 - t * dSpeed * 5.0);
    ripple = ripple * exp(-dist * max(dScale, 0.1) * 0.5);
    return pos + normalize(pos - mousePos + vec3<f32>(1e-4)) * ripple * amount;
  }
  if (dtp == 8) { // curl flow
    let p = pos * dScale;
    let ph = t * dSpeed;
    var flow = vec3<f32>(
      sp_noise3(p + vec3<f32>(ph, 31.7, 12.1)),
      sp_noise3(p + vec3<f32>(47.3, ph * 0.83, 5.9)),
      sp_noise3(p + vec3<f32>(8.2, 19.4, ph * 1.13)));
    flow = normalize(flow + vec3<f32>(1e-4));
    return pos + flow * amount;
  }
  if (dtp == 9) { // twist
    let angle = (pos.y * dScale + t * dSpeed) * amount;
    let c = cos(angle); let s = sin(angle);
    return vec3<f32>(c * pos.x + s * pos.z, pos.y, -s * pos.x + c * pos.z);
  }
  if (dtp == 10) { // radial pulse
    let radius = length(pos);
    let pulse = sin(radius * dScale * 4.0 - t * dSpeed * 5.0);
    return pos + normalize(pos + vec3<f32>(1e-4)) * pulse * amount;
  }
  if (dtp == 11) { // scanline
    let plane = sin((pos.y + t * dSpeed) * dScale * 4.0);
    let gate = smoothstep(0.65, 1.0, plane);
    let offset = vec3<f32>(
      sp_noise3(pos * dScale + t * dSpeed),
      0.0,
      sp_noise3(pos * dScale + t * dSpeed + 50.0));
    return pos + offset * gate * amount;
  }
  return pos;
}

fn apply_mouse(pos_in: vec3<f32>) -> vec3<f32> {
  var pos = pos_in;
  let influence0 = sp.mo1.x;
  if (influence0 <= 0.0) { return pos; }
  let mousePos = sp.mo0.xyz;
  let radius = sp.mo0.w;
  let mode = i32(sp.bg0.w + 0.5);
  let dist = length(pos - mousePos);
  let influence = smoothstep(radius, 0.0, dist) * influence0;
  var dir = vec3<f32>(0.0, 1.0, 0.0);
  if (dist > 0.001) { dir = normalize(pos - mousePos); }
  let strength = radius * 0.5;
  if (mode == 0) { return pos - dir * influence * strength; }
  if (mode == 1) { return pos + dir * influence * strength; }
  if (mode == 2) {
    let angle = influence * 6.28318;
    let offset = pos - mousePos;
    let swirl = vec3<f32>(
      offset.x * cos(angle) - offset.z * sin(angle),
      offset.y,
      offset.x * sin(angle) + offset.z * cos(angle));
    return mousePos + mix(offset, swirl, influence);
  }
  return pos; // reveal handled in fragment
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
  if (sp_hash(vidx * 0.61803) > sp.aud1.w) { kill = 1.0; }

  var pos = p0.xyz * sp.xf0.y;
  // Euler rotation Z*Y*X (matches the release shader)
  let cx = cos(sp.xf0.z); let sx = sin(sp.xf0.z);
  let cy = cos(sp.xf0.w); let sy = sin(sp.xf0.w);
  let cz = cos(sp.xf1.x); let sz = sin(sp.xf1.x);
  let rxv = vec3<f32>(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);
  let ryv = vec3<f32>(rxv.x * cy + rxv.z * sy, rxv.y, -rxv.x * sy + rxv.z * cy);
  pos = vec3<f32>(ryv.x * cz - ryv.y * sz, ryv.x * sz + ryv.y * cz, ryv.z);
  pos = pos + sp.xf1.yzw;

  // Rotated original (reference passes objectRotation * originalPosition)
  var orig = p0.xyz;
  let orx = vec3<f32>(orig.x, orig.y * cx - orig.z * sx, orig.y * sx + orig.z * cx);
  let ory = vec3<f32>(orx.x * cy + orx.z * sy, orx.y, -orx.x * sy + orx.z * cy);
  orig = vec3<f32>(ory.x * cz - ory.y * sz, ory.x * sz + ory.y * cz, ory.z);

  pos = apply_animation(pos, orig, vidx, t, &kill);
  pos = apply_displacement(pos, vidx, t);
  let mouseDistance = length(pos - sp.mo0.xyz) / max(sp.mo0.w, 0.001);
  pos = apply_mouse(pos);

  // Audio scale
  if (sp.aud0.x > 0.5) { pos = pos * (1.0 + sp.aud0.y * sp.aud0.w); }

  // Stateless physics approximation. The WebGL design integrates velocities
  // on the CPU; here a closed-form decaying bounce runs on time: gravity sets
  // the bounce clock, bounciness is the per-bounce energy retention (pow of
  // the bounce count), friction slows the clock. Negative gravity mirrors
  // the motion toward a ceiling instead of a floor.
  if (sp.phys2.x > 0.5) {
    let g = sp.phys.x;
    let fric = clamp(sp.phys2.y, 0.0, 1.0);
    let bounce = clamp(sp.phys2.z, 0.0, 1.0);
    let ga = max(abs(g), 0.001);
    let gsign = select(1.0, -1.0, g < 0.0);
    let bound = -2.0 * gsign * max(sp.xf0.y, 0.05);
    let h0 = max((pos.y - bound) * gsign, 0.0);
    let ph = t * sqrt(ga) * 0.45 * (1.0 - fric * 0.7) + sp_hash(vidx * 0.173) * 0.3;
    let damp = pow(max(bounce, 0.02), min(floor(ph), 9.0));
    let settle = clamp(ph, 0.0, 1.0);
    let y01 = mix(1.0, abs(cos(ph * 3.14159265)) * damp, settle);
    pos.y = bound + h0 * y01 * gsign;
  }

  // Slice plane cull
  if (sp.mo1.y > 0.5) {
    let axis = sp_axis(sp.mo1.z);
    let d = dot(pos, axis);
    if (abs(d - sp.mo1.w) > sp.mi0.x * 0.5) { kill = 1.0; }
  }

  let view = sp.vp0 * pos.x + sp.vp1 * pos.y + sp.vp2 * pos.z + sp.vp3;
  var size_px = sp.render0.x * p1.x;
  if (sp.aud0.x > 0.5) {
    size_px = size_px * (1.0 + sp.aud0.y * sp.aud0.w * 0.5) * (1.0 + sp.aud0.z * sp.aud0.w * 0.3);
  }
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
  out.misc = vec4<f32>(vidx, kill, view.w, mouseDistance);
  return out;
}

fn apply_color_effect(color_in: vec3<f32>, wp: vec3<f32>, t: f32) -> vec3<f32> {
  var color = color_in;
  if (abs(sp.col0.z) > 0.01) {
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + sp.col0.z / 360.0);
    color = sp_hsv2rgb(hsv);
  }
  let fx = i32(sp.col0.w + 0.5);
  let fi = sp.col1.w;
  if (fx == 1) { // chromatic
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + (wp.x + wp.y + wp.z) * 0.05 * fi + t * 0.05);
    hsv.y = min(1.0, hsv.y + 0.3 * fi);
    return mix(color, sp_hsv2rgb(hsv), fi);
  }
  if (fx == 2) { // heatmap
    let heat = clamp((wp.y + 5.0) / 10.0, 0.0, 1.0);
    var hc = mix(vec3<f32>(0.0, 0.0, 0.5), vec3<f32>(0.0, 0.5, 1.0), heat * 3.0);
    if (heat >= 0.33) { hc = mix(vec3<f32>(0.0, 0.5, 1.0), vec3<f32>(1.0, 1.0, 0.0), (heat - 0.33) * 3.0); }
    if (heat >= 0.66) { hc = mix(vec3<f32>(1.0, 1.0, 0.0), vec3<f32>(1.0, 0.0, 0.0), (heat - 0.66) * 3.0); }
    return mix(color, hc, fi);
  }
  if (fx == 3) { // pointillist
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + sin(t * 2.0 + sp_hash2(wp.xy) * 6.28) * 0.5 * fi);
    hsv.y = min(1.0, hsv.y + 0.2 * fi);
    hsv.z = min(1.0, hsv.z + 0.1 * fi);
    return sp_hsv2rgb(hsv);
  }
  if (fx == 4) { // hologram
    let scan = fract(wp.y * sp.col3.x * 0.1 + t * sp.col2.w);
    let flick = 0.9 + 0.1 * sin(t * 30.0 + wp.x * 10.0);
    return mix(color, vec3<f32>(0.2, 0.8, 1.0) * flick, scan * fi);
  }
  if (fx == 5) { // rainbow
    return mix(color, sp_hsv2rgb(vec3<f32>(fract((wp.y + wp.x * 0.3) * 0.1 + t * 0.1), 1.0, 1.0)), fi);
  }
  if (fx == 6) { // audio color + beat flash
    if (sp.aud0.x < 0.5) { return color; }
    var hsv = sp_rgb2hsv(color);
    hsv.x = fract(hsv.x + sp.aud0.y * sp.aud1.y);
    hsv.y = min(1.0, hsv.y + sp.aud0.y * 0.5);
    hsv.z = min(1.0, hsv.z + sp.aud0.y * 0.3 + sp.aud0.z * 0.4);
    hsv.y = max(0.0, hsv.y - sp.aud0.z * 0.3);
    return sp_hsv2rgb(hsv);
  }
  if (fx == 7) { // depth gradient (normalized cloud spans roughly z in [-2, 2])
    let depth = clamp((wp.z + 2.0) / 4.0, 0.0, 1.0);
    let bias = max(sp.col3.y, 0.001);
    let shaped = smoothstep(0.0, bias, depth) * 0.5 + smoothstep(bias, 1.0, depth) * 0.5;
    return mix(color, mix(sp.col4.xyz, sp.col5.xyz, shaped), fi);
  }
  if (fx == 8) { // neon
    var hsv = sp_rgb2hsv(color);
    let neon = sp_hsv2rgb(vec3<f32>(hsv.x, 1.0, 1.0));
    return mix(color, neon * (1.0 + 0.5 * sin(t * 3.0 + wp.x * 5.0)), fi);
  }
  if (fx == 9) { // pastel
    var hsv = sp_rgb2hsv(color);
    hsv.y = hsv.y * 0.4;
    hsv.z = 0.9 + 0.1 * hsv.z;
    return mix(color, sp_hsv2rgb(hsv), fi);
  }
  if (fx == 10) { // cyberpunk
    let m = sin(wp.x * 2.0 + t) * 0.5 + 0.5;
    return mix(color, mix(vec3<f32>(1.0, 0.0, 0.8), vec3<f32>(0.0, 1.0, 1.0), m), fi);
  }
  if (fx == 11) { // fire
    let f = sp_noise2(wp.xy * 3.0 + vec2<f32>(0.0, -t * 2.0));
    var fc = mix(vec3<f32>(1.0, 0.0, 0.0), vec3<f32>(1.0, 1.0, 0.0), f);
    fc = mix(fc, vec3<f32>(1.0, 0.5, 0.0), sin(f * 3.14));
    return mix(color, fc, fi);
  }
  if (fx == 12) { // ice
    let f = sp_noise2(wp.xy * 2.0 + t * 0.2);
    return mix(color, mix(vec3<f32>(0.7, 0.9, 1.0), vec3<f32>(0.3, 0.6, 0.9), f), fi);
  }
  return color;
}

@fragment fn fs_point(in: VsOut) -> @location(0) vec4<f32> {
  if (in.misc.y > 0.5) { discard; }
  let t = sp.screen.z;
  let coord = in.corner * 0.5;
  let dist = length(coord);
  var edge = 1.0;
  let normalZ = sqrt(max(0.0, 1.0 - min(dot(coord * 2.0, coord * 2.0), 1.0)));
  let pointNormal = normalize(vec3<f32>(coord * 2.0, normalZ));
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
    edge = 0.3 + 0.7 * max(0.0, dot(pointNormal, normalize(vec3<f32>(0.5, 0.5, 1.0))));
  } else if (mode == 3) {
    if (abs(coord.x) > 0.45 || abs(coord.y) > 0.45) { discard; }
  } else {
    if (abs(coord.x) + abs(coord.y) > 0.5) { discard; }
    edge = 1.0 - (abs(coord.x) + abs(coord.y)) * 0.5;
  }

  var color = in.color.rgb;
  if (sp.col0.x < 0.5) { color = mix(sp.col1.xyz, sp.col2.xyz, sp.col0.y); }
  let wp = in.world;
  // Texture projection: model-space position drives the UV per mode; the
  // native cloud is normalized to roughly [-2, 2] (same convention as the
  // depth-gradient effect). 'native' falls back to planarXY — splat points
  // carry no file UVs in the packed buffer.
  if (sp.mi0.y > 0.5) {
    let npos = clamp((wp + vec3<f32>(2.0)) / 4.0, vec3<f32>(0.0), vec3<f32>(1.0));
    let proj = i32(sp.mi0.z + 0.5);
    var uv = npos.xy;
    if (proj == 0) {
      let dir = normalize(wp + vec3<f32>(1e-5));
      uv = vec2<f32>(
        0.5 + atan2(dir.z, dir.x) / 6.2831853,
        0.5 - asin(clamp(dir.y, -1.0, 1.0)) / 3.14159265,
      );
    } else if (proj == 1) {
      let dir = normalize(vec3<f32>(wp.x, 0.0, wp.z) + vec3<f32>(1e-5, 0.0, 0.0));
      uv = vec2<f32>(0.5 + atan2(dir.z, dir.x) / 6.2831853, npos.y);
    } else if (proj == 3) {
      uv = npos.xz;
    } else if (proj == 4) {
      uv = npos.yz;
    } else if (proj == 5) {
      let ad = abs(normalize(wp + vec3<f32>(1e-5)));
      if (ad.x >= ad.y && ad.x >= ad.z) { uv = npos.zy; }
      else if (ad.y >= ad.x && ad.y >= ad.z) { uv = npos.xz; }
      else { uv = npos.xy; }
    }
    uv = (uv - vec2<f32>(0.5)) * sp.pad.x + vec2<f32>(0.5) + vec2<f32>(sp.pad.y, sp.pad.z);
    let sample_uv = clamp(vec2<f32>(uv.x, 1.0 - uv.y), vec2<f32>(0.0), vec2<f32>(1.0));
    let texc = textureSampleLevel(splat_tex, splat_smp, sample_uv, 0.0);
    color = mix(color, texc.rgb, sp.mi0.w * texc.a);
  }
  color = apply_color_effect(color, wp, t * max(sp.pad.w, 0.0));

  // Lighting
  if (sp.li0.x > 0.5) {
    let keyDir = normalize(sp.li2.xyz);
    let keyDiffuse = max(0.0, dot(pointNormal, keyDir));
    let softness = sp.li2.w;
    var rim = pow(1.0 - max(pointNormal.z, 0.0), mix(5.0, 1.25, softness));
    rim = rim * max(0.0, dot(pointNormal, normalize(sp.li4.xyz)) * 0.5 + 0.5);
    let halfVec = normalize(keyDir + vec3<f32>(0.0, 0.0, 1.0));
    let specular = pow(max(0.0, dot(pointNormal, halfVec)), mix(48.0, 6.0, softness));
    let heightShadow = smoothstep(-1.5, 1.5, wp.y);
    let shadow = mix(1.0 - sp.li1.w, 1.0, mix(heightShadow, 1.0, softness));
    var lit = color * max(sp.li0.y, 0.0);
    lit = lit + color * sp.li1.xyz * keyDiffuse * sp.li0.z * shadow;
    lit = lit + sp.li3.xyz * rim * sp.li3.w;
    lit = lit + sp.li1.xyz * specular * sp.li0.w;
    color = lit;
  }

  // Atmosphere on points
  var atmosphereMix = 0.0;
  if (sp.li4.w > 0.5 && sp.at0.x > 0.0) {
    let fogUV = wp.xz * max(sp.at0.y, 0.01);
    let fogNoise = sp_noise2(
      fogUV
      + vec2<f32>(t * sp.at0.w, -t * sp.at0.w * 0.63)
      + sp_noise2(fogUV * 0.47) * sp.at0.z);
    let depthFog = smoothstep(-3.0, 5.0, -wp.z);
    atmosphereMix = clamp(sp.at0.x * (0.25 + fogNoise * 0.75) * (0.55 + depthFog * 0.45), 0.0, 0.95);
    color = mix(color, sp.at1.xyz, atmosphereMix);
  }

  var alpha = in.color.a * sp.render0.w * edge;
  alpha = alpha * (1.0 - atmosphereMix * 0.12);

  // Opacity effects
  let ofx = i32(sp.col3.z + 0.5);
  let oi = sp.col3.w;
  if (ofx == 1) { // dof
    let d = abs(wp.z - sp.col4.w * 4.0 - 2.0);
    alpha = alpha * (1.0 - smoothstep(0.0, sp.col5.w * 3.0, d) * oi);
  } else if (ofx == 2) { // fog fade
    let fog = 1.0 - exp(-length(wp) * sp.op0.x * 0.1);
    alpha = alpha * (1.0 - fog * oi);
  } else if (ofx == 3) { // pulse
    let pulse = (sin(t * sp.op0.y * 3.14159) + 1.0) * 0.5;
    alpha = alpha * (1.0 - (1.0 - pulse) * oi);
  } else if (ofx == 4) { // proximity
    alpha = alpha * mix(1.0, 1.0 - smoothstep(0.0, 5.0, length(wp)), oi);
  } else if (ofx == 5) { // dissolve
    if (sp_hash2(wp.xy + wp.z) < sp.op0.z * oi) { discard; }
  } else if (ofx == 6) { // scan reveal
    let scan = fract(t * 0.3);
    alpha = alpha * mix(1.0, smoothstep(scan - 0.2, scan, (wp.y + 5.0) / 10.0), oi);
  } else if (ofx == 7) { // audio fade
    if (sp.aud0.x > 0.5) { alpha = alpha * (0.5 + sp.aud0.y * 0.5); }
  }

  // Hologram scanline enhancement
  if (i32(sp.col0.w + 0.5) == 4) {
    let scanline = abs(sin(in.position.y * 0.5));
    alpha = alpha * (0.7 + scanline * 0.3);
    color = color + vec3<f32>(0.0, 0.1, 0.2) * scanline;
  }

  var frag = vec4<f32>(color, alpha);

  // Creative effects
  let cfx = i32(sp.op0.w + 0.5);
  let ci = sp.op1.w;
  if (cfx == 1) { // feedback
    let echo = sin(t * 5.0 + wp.x * 3.0) * 0.5 + 0.5;
    frag = vec4<f32>(mix(frag.rgb, frag.rgb * 1.5, echo * ci), frag.a * (0.8 + 0.2 * echo));
  } else if (cfx == 2) { // kaleidoscope
    let angle = atan2(wp.y, wp.x);
    let seg = 3.14159 / 6.0;
    let kaleid = abs((angle % seg) - seg * 0.5);
    var hsv = sp_rgb2hsv(frag.rgb);
    hsv.x = fract(hsv.x + kaleid * ci);
    frag = vec4<f32>(sp_hsv2rgb(hsv), frag.a);
  } else if (cfx == 3) { // constellation
    let sparkle = sin(t * 10.0 + in.misc.x * 0.1) * 0.5 + 0.5;
    let twinkle = pow(sparkle, 3.0);
    frag = vec4<f32>(frag.rgb + vec3<f32>(twinkle * ci), mix(frag.a, frag.a * (0.5 + twinkle), ci));
  } else if (cfx == 4) { // datamosh
    let glitch = step(0.95, sp_hash2(vec2<f32>(floor(t * 10.0), wp.y)));
    if (glitch > 0.5) { frag = vec4<f32>(frag.bgr, frag.a); }
    let shift = sp_hash2(vec2<f32>(t, wp.x)) * ci * 0.1;
    frag.r = frag.r + shift;
    frag.b = frag.b - shift;
  } else if (cfx == 5) { // pixel sort
    let brightness = dot(frag.rgb, vec3<f32>(0.299, 0.587, 0.114));
    let threshold = 0.5 + sin(t + wp.x) * 0.3;
    if (brightness > threshold) { frag = vec4<f32>(frag.rgb * (1.0 + ci * 0.5), frag.a); }
  } else if (cfx == 6) { // echo layers
    var echoAlpha = 0.0;
    for (var i = 1.0; i <= 3.0; i = i + 1.0) {
      echoAlpha = echoAlpha + (sin((t - i * 0.1) * 3.0 + wp.x) * 0.5 + 0.5) / 3.0;
    }
    frag = vec4<f32>(frag.rgb, frag.a * (0.7 + 0.3 * echoAlpha * ci));
  }

  // Reveal mouse mode: fade in points near the pointer
  if (i32(sp.bg0.w + 0.5) == 3 && sp.mo1.x > 0.0) {
    let reveal = 1.0 - smoothstep(0.0, 1.0, in.misc.w);
    let inf = min(sp.mo1.x, 1.0);
    frag.a = frag.a * (reveal * inf + (1.0 - inf));
  }

  if (frag.a < 0.004) { discard; }
  return vec4<f32>(clamp(frag.rgb, vec3<f32>(0.0), vec3<f32>(2.0)) * frag.a, frag.a);
}

// ── Background / scene atmosphere pass ──
// Drawn before the points: the layer's backdrop color plus volumetric-
// looking animated haze so fog fills the SCENE, not just the points.
struct BgOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex fn vs_bg(@builtin(vertex_index) vi: u32) -> BgOut {
  var out: BgOut;
  let x = f32(i32(vi & 1u) * 4 - 1);
  let y = f32(i32(vi >> 1u) * 4 - 1);
  out.position = vec4<f32>(x, y, 0.999, 1.0);
  out.uv = vec2<f32>(x, y) * 0.5 + 0.5;
  return out;
}

@fragment fn fs_bg(in: BgOut) -> @location(0) vec4<f32> {
  let t = sp.screen.z;
  var color = sp.bg0.xyz;
  var alpha = sp.at1.w;
  if (sp.li4.w > 0.5 && sp.at0.x > 0.0) {
    let aspect = sp.screen.x / max(sp.screen.y, 1.0);
    let uv = vec2<f32>((in.uv.x - 0.5) * aspect, in.uv.y - 0.5) * 6.0 * max(sp.at0.y, 0.01);
    var haze = sp_noise2(uv + vec2<f32>(t * sp.at0.w, -t * sp.at0.w * 0.63) + sp_noise2(uv * 0.47) * sp.at0.z);
    haze = haze * 0.65 + sp_noise2(uv * 2.3 - vec2<f32>(t * sp.at0.w * 0.41, t * sp.at0.w * 0.29)) * 0.35;
    // Denser toward the lower half like ground fog, thinning upward.
    let vertical = mix(1.0, 0.45, in.uv.y);
    let fogAmount = clamp(sp.at0.x * (0.3 + haze * 0.7) * vertical, 0.0, 0.85);
    color = mix(color, sp.at1.xyz, clamp(fogAmount * 2.0, 0.0, 1.0));
    alpha = max(alpha, fogAmount);
  }
  if (alpha < 0.003) { discard; }
  return vec4<f32>(color * alpha, alpha);
}
`;
