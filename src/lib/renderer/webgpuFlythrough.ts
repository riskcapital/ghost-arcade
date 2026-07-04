import { getGhostGpuRuntime } from './webgpuShared';
import { createAndWarmWgslShaderModule, resolveGhostWgsl } from './wgsl';

/**
 * WebGPUFlythrough — endless point-cloud tunnel through any 2D source.
 *
 * Visual concept: take an image or video frame, derive a depth field
 * from it (luminance / edge density), seed N particles across the UV
 * anchor grid, and replicate the resulting 3D cloud into K "slabs"
 * stacked along the camera's Z axis. Move the camera forward through
 * them continuously; whenever a slab passes behind the camera, wrap
 * its Z offset to the far end of the stack. Net effect: the user
 * appears to fly THROUGH an infinite recursion of the source.
 *
 * Why a dedicated renderer (not a mode of WebGPUPixelParticles):
 *   - Camera model is fundamentally different — auto-translating Z
 *     accumulator, not a fixed orbit-from-knobs camera.
 *   - Particle topology is fundamentally different — either point
 *     sprites OR velocity-extruded quads (worm/brush strokes), the
 *     latter needing 6 verts/particle in an instanced draw.
 *   - Slab replication is unique to this mode — single particle
 *     buffer rendered as K instances at staggered Z offsets.
 *   - Curl-noise advection (rather than per-mode arithmetic) drives
 *     particle motion, giving the fluid-worm look without a fluid sim.
 * Cramming all of this into PixelParticles would double its size and
 * obscure both implementations. Routing flythrough mode to this class
 * keeps both clean.
 *
 * Architecture per frame:
 *   1. Update source texture if it's a video frame (one writeTexture
 *      per frame at ~1ms for 1080p; cheap relative to the visual).
 *   2. Tick `flyDistance` by `flySpeed * dt`. Accumulator wraps
 *      naturally through the modulo in the vertex shader.
 *   3. Compute pass — one thread per particle:
 *        - Compute curl-noise velocity at current pos
 *        - Lerp velocity toward (curl + anchor-pull) over dt
 *        - Integrate position by velocity * dt
 *      Particles near their anchor swirl smoothly; particles that
 *      escape get yanked back by anchor-pull. No need to reset
 *      particles — the slab recycling in the vertex shader handles
 *      the spatial wrap.
 *   4. Render pass — instanced draw with K instances:
 *        - Vertex shader: decode (instance_id, vertex_id) →
 *          (slab_index, particle_corner). Compute slab Z offset via
 *          modulo-wrap of flyDistance. Add to particle.pos. Project.
 *        - Stroke topology: extrude the particle into a quad along
 *          its velocity vector; UV.x runs head→tail for the alpha
 *          taper.
 *        - Point topology: classic billboard, size scales with depth.
 *        - Fragment shader: sample source texture at particle's
 *          anchor UV, multiply by alpha taper (strokes) or radial
 *          falloff (points). Output additive over whatever's behind.
 *
 * Particle layout (48 bytes per particle, std430-aligned):
 *   pos:         vec3<f32>     // slab-local 3D position
 *   alpha:       f32           // per-particle alpha
 *   vel:         vec3<f32>     // current velocity (used for stroke direction)
 *   depthAnchor: f32           // source-derived Z anchor
 *   anchor:      vec2<f32>     // fixed XY anchor in [-1..1]
 *   _pad:        vec2<f32>     // pad to 48 (16-byte alignment for vec4)
 */

const PARTICLE_BYTES = 48;
const MAX_PARTICLES = 1_000_000;
const DEFAULT_PARTICLES = 250_000;

type Topology = 'points' | 'strokes';
type DepthSource = 'luminance' | 'inverse-luminance' | 'edge-density';

const DEPTH_SRC_IDS: Record<DepthSource, number> = {
  'luminance': 0,
  'inverse-luminance': 1,
  'edge-density': 2,
};

/** Column-major 4x4 multiply: out = a × b. */
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
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

/* ============================================================== */
/* COMPUTE SHADER — curl-noise advection + anchor pull            */
/* ============================================================== */
const COMPUTE_WGSL = /* wgsl */ `
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  _pad:        vec2<f32>,
};

struct U {
  dt:              f32,
  time:            f32,
  flowStrength:    f32,
  flowScale:       f32,
  anchorPull:      f32,
  tunnelDepth:     f32,
  depthStrength:   f32,
  particleCount:   u32,
  flyDistance:     f32,
  _pad0:           f32,
  _pad1:           f32,
  _pad2:           f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;

// Cheap value-noise gradient hash. Good enough for the curl field —
// we're not after physically-correct flow, just smooth swirly motion.
fn hash3(p: vec3<f32>) -> f32 {
  let q = vec3<f32>(
    dot(p, vec3<f32>(127.1, 311.7, 74.7)),
    dot(p, vec3<f32>(269.5, 183.3, 246.1)),
    dot(p, vec3<f32>(113.5, 271.9, 124.6)),
  );
  return fract(sin(q.x + q.y + q.z) * 43758.5453);
}

fn noise3(p: vec3<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let n000 = hash3(i + vec3<f32>(0.0, 0.0, 0.0));
  let n100 = hash3(i + vec3<f32>(1.0, 0.0, 0.0));
  let n010 = hash3(i + vec3<f32>(0.0, 1.0, 0.0));
  let n110 = hash3(i + vec3<f32>(1.0, 1.0, 0.0));
  let n001 = hash3(i + vec3<f32>(0.0, 0.0, 1.0));
  let n101 = hash3(i + vec3<f32>(1.0, 0.0, 1.0));
  let n011 = hash3(i + vec3<f32>(0.0, 1.0, 1.0));
  let n111 = hash3(i + vec3<f32>(1.0, 1.0, 1.0));
  let nx00 = mix(n000, n100, u.x);
  let nx10 = mix(n010, n110, u.x);
  let nx01 = mix(n001, n101, u.x);
  let nx11 = mix(n011, n111, u.x);
  let nxy0 = mix(nx00, nx10, u.y);
  let nxy1 = mix(nx01, nx11, u.y);
  return mix(nxy0, nxy1, u.z) * 2.0 - 1.0;
}

// curl(noise) — divergence-free flow field, gives smooth swirly motion
// that looks like fluid. Cheap finite-difference approximation.
fn curl(p: vec3<f32>) -> vec3<f32> {
  let e = 0.05;
  let dx = vec3<f32>(e, 0.0, 0.0);
  let dy = vec3<f32>(0.0, e, 0.0);
  let dz = vec3<f32>(0.0, 0.0, e);
  // Three independent noise fields (offset by large constants to
  // decorrelate them) define a vector potential A; curl(A) is the
  // divergence-free velocity field.
  let a_x = vec2<f32>(
    noise3(p + dy + vec3<f32>(0.0, 0.0, 11.0)),
    noise3(p - dy + vec3<f32>(0.0, 0.0, 11.0)),
  );
  let a_y = vec2<f32>(
    noise3(p + dz + vec3<f32>(31.0, 0.0, 0.0)),
    noise3(p - dz + vec3<f32>(31.0, 0.0, 0.0)),
  );
  let a_z = vec2<f32>(
    noise3(p + dx + vec3<f32>(0.0, 47.0, 0.0)),
    noise3(p - dx + vec3<f32>(0.0, 47.0, 0.0)),
  );
  let b_x = vec2<f32>(
    noise3(p + dz + vec3<f32>(0.0, 0.0, 11.0)),
    noise3(p - dz + vec3<f32>(0.0, 0.0, 11.0)),
  );
  let b_y = vec2<f32>(
    noise3(p + dx + vec3<f32>(31.0, 0.0, 0.0)),
    noise3(p - dx + vec3<f32>(31.0, 0.0, 0.0)),
  );
  let b_z = vec2<f32>(
    noise3(p + dy + vec3<f32>(0.0, 47.0, 0.0)),
    noise3(p - dy + vec3<f32>(0.0, 47.0, 0.0)),
  );
  let cx = (a_x.x - a_x.y) - (b_x.x - b_x.y);
  let cy = (a_y.x - a_y.y) - (b_y.x - b_y.y);
  let cz = (a_z.x - a_z.y) - (b_z.x - b_z.y);
  return vec3<f32>(cx, cy, cz) / (2.0 * e);
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.particleCount) { return; }
  var p = particles[i];

  // Curl-noise velocity in the slab-local frame. Scale the sample
  // position so flowScale knob is intuitive — flowScale=1 gives ~one
  // swirl across the slab; higher = tighter swirls.
  let samplePos = vec3<f32>(p.pos.x, p.pos.y, p.pos.z) * u.flowScale + vec3<f32>(0.0, 0.0, u.time * 0.1);
  let flow = curl(samplePos) * u.flowStrength;

  // Anchor pull — keeps the image legible by yanking particles
  // toward their UV-anchor home position. Without this the image
  // dissolves into chaos within a second.
  let homeXY = vec3<f32>(p.anchor.x, p.anchor.y, p.depthAnchor * u.depthStrength);
  let pull = (homeXY - p.pos) * u.anchorPull;

  // Critically-damped-ish blend toward the target velocity. dt-scaled
  // so the visual is frame-rate independent.
  let targetVel = flow + pull;
  p.vel = mix(p.vel, targetVel, clamp(u.dt * 6.0, 0.0, 1.0));

  // Integrate position.
  p.pos = p.pos + p.vel * u.dt;

  // Keep particles inside the slab Z range — the slab itself wraps
  // in the vertex shader, but per-particle Z still needs to live in
  // ~[-tunnelDepth/2, +tunnelDepth/2] or strokes will pierce slab
  // boundaries and read as glitches.
  let halfDepth = u.tunnelDepth * 0.5;
  if (p.pos.z >  halfDepth) { p.pos.z = -halfDepth; }
  if (p.pos.z < -halfDepth) { p.pos.z =  halfDepth; }

  particles[i] = p;
}
`;

/* ============================================================== */
/* RENDER SHADER — point and stroke topology in one module        */
/* ============================================================== */
const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos:         vec3<f32>,
  alpha:       f32,
  vel:         vec3<f32>,
  depthAnchor: f32,
  anchor:      vec2<f32>,
  _pad:        vec2<f32>,
};

struct U {
  viewProj:        mat4x4<f32>,
  // camera-space basis for billboarding the point-topology quads
  camRight:        vec3<f32>,
  _pad0:           f32,
  camUp:           vec3<f32>,
  _pad1:           f32,
  // sizing / topology
  baseSize:        f32,        // point size in world units
  strokeLength:    f32,        // stroke length in world units
  strokeWidth:     f32,        // stroke width in world units
  topology:        u32,        // 0 = points, 1 = strokes
  // slab replication
  slabCount:       u32,
  tunnelDepth:     f32,
  flyDistance:     f32,
  particleCount:   u32,
  // depth source params (handled in fs via the sourceTexture sample)
  opacity:         f32,
  fadeNearAlpha:   f32,        // alpha at the camera-nearest slab boundary
  fadeFarAlpha:    f32,        // alpha at the farthest slab boundary
  _pad2:           f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> u: U;
@group(0) @binding(2) var sourceTexture: texture_2d<f32>;
@group(0) @binding(3) var sourceSampler: sampler;

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:        vec2<f32>,   // (corner-uv): for strokes, x=along, y=across; for points, classic 0..1
  @location(1) anchor:    vec2<f32>,   // texture-sample UV for color
  @location(2) alpha:     f32,
};

// Wrap the per-slab Z offset so that the K slabs continuously cycle
// past the camera as flyDistance accumulates. Slab 0 is the nearest
// to the camera by default; over time each slab slides toward the
// camera and wraps to the far end when it passes Z = -tunnelDepth/2.
fn slabZ(slabIndex: u32) -> f32 {
  let total = f32(u.slabCount) * u.tunnelDepth;
  let raw   = f32(slabIndex) * u.tunnelDepth - u.flyDistance;
  // floor-mod so negative inputs land in [0, total)
  let m     = raw - floor(raw / total) * total;
  return m - u.tunnelDepth * 0.5;
}

@vertex
fn vs_main(
  @builtin(vertex_index)   vid: u32,
  @builtin(instance_index) iid: u32,
) -> VSOut {
  // iid encodes (slabIndex, particleIndex) packed as:
  //   particleIndex = iid % particleCount
  //   slabIndex     = iid / particleCount
  let pIdx = iid % u.particleCount;
  let sIdx = iid / u.particleCount;
  let p    = particles[pIdx];

  // Anchor color sample: use UV derived from anchor.xy (already in
  // [-1..1]; remap to [0..1] for texture sampling).
  let anchorUV = vec2<f32>(p.anchor.x * 0.5 + 0.5, 1.0 - (p.anchor.y * 0.5 + 0.5));

  // Slab-local position + slab Z offset = world position.
  let worldPos = vec3<f32>(p.pos.x, p.pos.y, p.pos.z + slabZ(sIdx));

  // Per-vertex corner offset depends on topology.
  var cornerUV: vec2<f32> = vec2<f32>(0.0, 0.0);
  var offset:   vec3<f32> = vec3<f32>(0.0, 0.0, 0.0);

  if (u.topology == 1u) {
    // STROKE TOPOLOGY — quad extruded along velocity vector.
    //   vid 0..5: two triangles forming a quad
    //   x ∈ {0, 1} = along velocity (head, tail)
    //   y ∈ {-1, +1} = perpendicular to velocity
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(0.0, -1.0), vec2<f32>(1.0, -1.0), vec2<f32>(0.0,  1.0),
      vec2<f32>(0.0,  1.0), vec2<f32>(1.0, -1.0), vec2<f32>(1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x, q.y * 0.5 + 0.5);

    // Stroke direction is the CAMERA'S BACKWARD axis (uniformly,
    // not per-particle velocity). Reasoning: flythrough particles
    // are nearly stationary (anchor pull dominates the curl-noise
    // velocity), so velocity-aligned strokes pointed in random
    // directions for every particle. Visually that produced a
    // radial "starburst" pattern emanating from the center
    // vanishing point — with a black vertical wedge in the middle
    // where no stroke endpoints happened to land. By making every
    // stroke trail backward along the camera's flight axis we get
    // proper uniform "motion lines" that read as the camera flying
    // forward through the tunnel — and no center-column gap.
    //
    // dir = (0, 0, -1) so that -dir * q.x * strokeLength extends
    // the stroke into +Z (away from camera, deeper into the
    // tunnel). perp = (1, 0, 0) gives the stroke width along
    // screen-X.
    let dir = vec3<f32>(0.0, 0.0, -1.0);
    let perp = vec3<f32>(1.0, 0.0, 0.0);

    // Stroke tail trails AWAY from the camera (head at the
    // particle's anchor position, tail extending deeper into Z).
    offset = -dir * (q.x * u.strokeLength) + perp * (q.y * u.strokeWidth * 0.5);
  } else {
    // POINT TOPOLOGY — billboard quad facing the camera.
    let xy = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0), vec2<f32>( 1.0, -1.0), vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0), vec2<f32>( 1.0, -1.0), vec2<f32>( 1.0,  1.0),
    );
    let q = xy[vid];
    cornerUV = vec2<f32>(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
    offset = u.camRight * (q.x * u.baseSize) + u.camUp * (q.y * u.baseSize);
  }

  let finalWorld = worldPos + offset;

  // Depth-based fade so slabs fade in as they emerge from the far
  // end of the tunnel + fade out as they leave the near end. This
  // softens the wrap discontinuity — without it you can SEE slabs pop.
  let z = worldPos.z;
  let total = f32(u.slabCount) * u.tunnelDepth;
  let t = clamp((z + u.tunnelDepth * 0.5) / total, 0.0, 1.0);
  let edgeFade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t));
  let depthAlpha = mix(u.fadeNearAlpha, u.fadeFarAlpha, t) * edgeFade;

  var out: VSOut;
  out.pos    = u.viewProj * vec4<f32>(finalWorld, 1.0);
  out.uv     = cornerUV;
  out.anchor = anchorUV;
  out.alpha  = p.alpha * depthAlpha * u.opacity;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // Sample source color at the anchor's UV.
  let srcColor = textureSample(sourceTexture, sourceSampler, in.anchor);

  // Falloff shape:
  //   Points  — radial disc with soft edge
  //   Strokes — taper along x (head→tail) for streak look
  var mask: f32 = 1.0;
  if (u.topology == 1u) {
    // Stroke: alpha tapers from 1 at head (uv.x=0) to 0 at tail (uv.x=1)
    // with a soft pinch at the perpendicular edges (uv.y).
    let headTail = 1.0 - in.uv.x;
    let perp = 1.0 - abs(in.uv.y - 0.5) * 2.0;
    mask = headTail * smoothstep(0.0, 0.4, perp);
  } else {
    // Point: radial soft disc
    let d = distance(in.uv, vec2<f32>(0.5, 0.5)) * 2.0;
    mask = smoothstep(1.0, 0.2, d);
  }
  let a = srcColor.a * in.alpha * mask;
  // Additive-friendly premultiplied alpha. The host pipeline picks
  // the blend mode via the layer setting; we just produce premul-RGBA.
  return vec4<f32>(srcColor.rgb * a, a);
}
`;

/* ============================================================== */
/* TYPESCRIPT WRAPPER                                              */
/* ============================================================== */

interface FlythroughParams {
  topology: Topology;
  depthSource: DepthSource;
  flySpeed: number;
  tunnelDepth: number;
  slabCount: number;
  flowStrength: number;
  flowScale: number;
  anchorPull: number;
  strokeLength: number;
  strokeWidth: number;
  depthStrength: number;
  baseSize: number;
  opacity: number;
  fovDeg: number;
  cameraYaw: number;
  cameraPitch: number;
  particleCount: number;
}

/** Internal default params. Used as the starting state of the renderer
 *  before the first `setParams` call from the host. Sensible enough to
 *  produce a visible result if someone instantiates and renders
 *  without configuring — useful for the dev console + smoke tests. */
const DEFAULT_PARAMS: FlythroughParams = {
  topology: 'strokes',
  depthSource: 'luminance',
  flySpeed: 0.8,
  tunnelDepth: 2.0,
  slabCount: 4,
  flowStrength: 0.4,
  flowScale: 2.0,
  anchorPull: 1.2,
  strokeLength: 0.08,
  strokeWidth: 0.006,
  depthStrength: 0.5,
  baseSize: 0.005,
  opacity: 1.0,
  fovDeg: 50,
  cameraYaw: 0,
  cameraPitch: 0,
  particleCount: DEFAULT_PARTICLES,
};

export const FLYTHROUGH_NATIVE_SHADER_IDS = Object.freeze({
  compute: 'flythrough/compute',
  render: 'flythrough/render',
});

export type FlythroughNativeShaderStage = 'compute' | 'render';

export interface FlythroughNativeShaderSource {
  shaderId: string;
  label: string;
  stage: FlythroughNativeShaderStage;
  entry: string;
  source: string;
}

export interface FlythroughNativePrecompileCommand {
  type: 'precompile_shader';
  shader_id: string;
  stage: FlythroughNativeShaderStage;
  entry: string;
  source: string;
}

type FlythroughNativeGraphBinding = {
  binding: number;
  resource?: string;
  kind?: string;
  source_id?: string;
  allow_missing?: boolean;
};

type FlythroughNativeGraphBuffer = {
  id: string;
  kind: 'uniform' | 'storage' | 'read-only-storage';
  byte_length: number;
  persistent?: boolean;
  clear?: boolean;
  initial_b64?: string;
  initial_buffer?: ArrayBuffer | Uint8Array;
};

type FlythroughNativeGraphPass = {
  name: string;
  shader_id: string;
  entry: string;
  dispatch: [number, number, number];
  bindings: FlythroughNativeGraphBinding[];
};

type FlythroughNativeGraphRenderPass = {
  name: string;
  shader_id: string;
  vertex_entry: string;
  fragment_entry: string;
  target: 'source_frame';
  source_id: string;
  seq: number;
  clear: boolean;
  clear_color?: [number, number, number, number];
  include_snapshot?: boolean;
  blend: 'replace' | 'alpha' | 'add';
  vertex_count: number;
  instance_count: number;
  bindings: FlythroughNativeGraphBinding[];
};

export interface FlythroughNativeGraphState {
  particleCount: number;
  prevFrameTime: number;
  flyDistance: number;
}

export interface FlythroughNativeGraphOptions {
  sourceId: string;
  mediaSourceId?: string | null;
  params?: Partial<FlythroughParams> & Record<string, any>;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  state?: FlythroughNativeGraphState | null;
  reset?: boolean;
  includeSnapshot?: boolean;
  audioBass?: number;
  audioTreble?: number;
}

export interface FlythroughNativeGraphBuildResult {
  config: {
    buffers: FlythroughNativeGraphBuffer[];
    passes: FlythroughNativeGraphPass[];
    render_passes: FlythroughNativeGraphRenderPass[];
    readbacks: string[];
  };
  sourceId: string;
  mediaSourceId: string | null;
  state: FlythroughNativeGraphState;
  particleCount: number;
  topology: Topology;
  passCount: number;
}

// GPUBlendState — typed `any` to match the codebase convention (the
// ambient declarations file deliberately keeps WebGPU types narrow
// to avoid pulling in the full @webgpu/types package).
const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

export function getFlythroughNativeShaderSources(): FlythroughNativeShaderSource[] {
  return [
    {
      shaderId: FLYTHROUGH_NATIVE_SHADER_IDS.compute,
      label: 'flythrough/compute',
      stage: 'compute',
      entry: 'cs_main',
      source: resolveGhostWgsl(COMPUTE_WGSL, 'flythrough/compute'),
    },
    {
      shaderId: FLYTHROUGH_NATIVE_SHADER_IDS.render,
      label: 'flythrough/render',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(RENDER_WGSL, 'flythrough/render'),
    },
  ];
}

export function buildFlythroughNativePrecompileCommands(): FlythroughNativePrecompileCommand[] {
  return getFlythroughNativeShaderSources().map((shader) => ({
    type: 'precompile_shader',
    shader_id: shader.shaderId,
    stage: shader.stage,
    entry: shader.entry,
    source: shader.source,
  }));
}

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function enumParam<T extends string>(value: unknown, allowed: Record<T, number>, fallback: T): T {
  const key = String(value ?? '').trim() as T;
  return Object.prototype.hasOwnProperty.call(allowed, key) ? key : fallback;
}

function normalizeFlythroughParams(raw: Partial<FlythroughParams> & Record<string, any> | undefined): FlythroughParams {
  const src = raw ?? {};
  return {
    topology: enumParam(src.topology, { points: 0, strokes: 1 }, DEFAULT_PARAMS.topology),
    depthSource: enumParam(src.depthSource, DEPTH_SRC_IDS, DEFAULT_PARAMS.depthSource),
    flySpeed: clampFinite(src.flySpeed, -16, 16, DEFAULT_PARAMS.flySpeed),
    tunnelDepth: clampFinite(src.tunnelDepth, 0.05, 64, DEFAULT_PARAMS.tunnelDepth),
    slabCount: Math.round(clampFinite(src.slabCount, 1, 8, DEFAULT_PARAMS.slabCount)),
    flowStrength: clampFinite(src.flowStrength, 0, 16, DEFAULT_PARAMS.flowStrength),
    flowScale: clampFinite(src.flowScale, 0.001, 64, DEFAULT_PARAMS.flowScale),
    anchorPull: clampFinite(src.anchorPull, 0, 16, DEFAULT_PARAMS.anchorPull),
    strokeLength: clampFinite(src.strokeLength, 0, 8, DEFAULT_PARAMS.strokeLength),
    strokeWidth: clampFinite(src.strokeWidth, 0.0001, 4, DEFAULT_PARAMS.strokeWidth),
    depthStrength: clampFinite(src.depthStrength, -8, 8, DEFAULT_PARAMS.depthStrength),
    baseSize: clampFinite(src.baseSize, 0.0001, 2, DEFAULT_PARAMS.baseSize),
    opacity: clampFinite(src.opacity, 0, 4, DEFAULT_PARAMS.opacity),
    fovDeg: clampFinite(src.fovDeg, 1, 160, DEFAULT_PARAMS.fovDeg),
    cameraYaw: clampFinite(src.cameraYaw, -3600, 3600, DEFAULT_PARAMS.cameraYaw),
    cameraPitch: clampFinite(src.cameraPitch, -3600, 3600, DEFAULT_PARAMS.cameraPitch),
    particleCount: Math.round(clampFinite(src.particleCount, 1024, MAX_PARTICLES, DEFAULT_PARAMS.particleCount)),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function bufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}

function flythroughParticleInitialBuffer(count: number): ArrayBuffer {
  const particleCount = Math.max(1024, Math.min(MAX_PARTICLES, Math.floor(count)));
  const seed = new Float32Array(particleCount * (PARTICLE_BYTES / 4));
  for (let i = 0; i < particleCount; i++) {
    const u1 = (i + 0.5) / particleCount;
    let bits = i;
    bits = ((bits >> 1) & 0x55555555) | ((bits & 0x55555555) << 1);
    bits = ((bits >> 2) & 0x33333333) | ((bits & 0x33333333) << 2);
    bits = ((bits >> 4) & 0x0f0f0f0f) | ((bits & 0x0f0f0f0f) << 4);
    bits = ((bits >> 8) & 0x00ff00ff) | ((bits & 0x00ff00ff) << 8);
    bits = ((bits >> 16) >>> 0) | ((bits << 16) >>> 0);
    const u2 = (bits >>> 0) / 0x100000000;

    const ax = u1 * 2 - 1;
    const ay = u2 * 2 - 1;
    const off = i * (PARTICLE_BYTES / 4);
    seed[off + 0] = ax;
    seed[off + 1] = ay;
    seed[off + 2] = 0;
    seed[off + 3] = 1;
    seed[off + 4] = 0;
    seed[off + 5] = 0;
    seed[off + 6] = 0;
    seed[off + 7] = (Math.sin(ax * 7.3 + ay * 11.1) * 0.5 + 0.5);
    seed[off + 8] = ax;
    seed[off + 9] = ay;
    seed[off + 10] = 0;
    seed[off + 11] = 0;
  }
  return seed.buffer;
}

function flythroughNativeInitialState(params: FlythroughParams, time: number): FlythroughNativeGraphState {
  return {
    particleCount: params.particleCount,
    prevFrameTime: time,
    flyDistance: 0,
  };
}

function flythroughSourcePrefix(sourceId: string, params: FlythroughParams): string {
  return `flythrough:${String(sourceId || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160)}:${params.particleCount}`;
}

function buildFlythroughComputeUniform(params: FlythroughParams, state: FlythroughNativeGraphState, dt: number, time: number): string {
  const buffer = new ArrayBuffer(64);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  f[0] = dt;
  f[1] = time;
  f[2] = params.flowStrength;
  f[3] = params.flowScale;
  f[4] = params.anchorPull;
  f[5] = params.tunnelDepth;
  f[6] = params.depthStrength;
  u[7] = params.particleCount >>> 0;
  f[8] = state.flyDistance;
  return bufferToBase64(buffer);
}

function buildFlythroughRenderUniform(params: FlythroughParams, state: FlythroughNativeGraphState, width: number, height: number): string {
  const aspect = Math.max(1, width) / Math.max(1, height);
  const proj = perspective(params.fovDeg, aspect, 0.05, 100);
  const yawRad = (params.cameraYaw ?? 0) * Math.PI / 180;
  const pitchRad = (params.cameraPitch ?? 0) * Math.PI / 180;
  const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
  const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
  const ry = new Float32Array([cy, 0, sy, 0, 0, 1, 0, 0, -sy, 0, cy, 0, 0, 0, 0, 1]);
  const rx = new Float32Array([1, 0, 0, 0, 0, cp, -sp, 0, 0, sp, cp, 0, 0, 0, 0, 1]);
  const rot = mat4Mul(ry, rx);
  const view = mat4Mul(rot, translate(0, 0, -0.1));
  const viewProj = mat4Mul(proj, view);
  const buffer = new ArrayBuffer(256);
  const f = new Float32Array(buffer);
  const u = new Uint32Array(buffer);
  f.set(viewProj, 0);
  f[16] = rot[0]; f[17] = rot[1]; f[18] = rot[2]; f[19] = 0;
  f[20] = rot[4]; f[21] = rot[5]; f[22] = rot[6]; f[23] = 0;
  f[24] = params.baseSize;
  f[25] = params.strokeLength;
  f[26] = params.strokeWidth;
  u[27] = params.topology === 'strokes' ? 1 : 0;
  u[28] = Math.max(1, Math.min(8, params.slabCount | 0));
  f[29] = params.tunnelDepth;
  f[30] = state.flyDistance;
  u[31] = params.particleCount >>> 0;
  f[32] = params.opacity;
  f[33] = 1;
  f[34] = 1;
  f[35] = 0;
  return bufferToBase64(buffer);
}

export function buildFlythroughNativeComputeGraph(options: FlythroughNativeGraphOptions): FlythroughNativeGraphBuildResult {
  const rawParams = options.params ?? {};
  const params = normalizeFlythroughParams(rawParams);
  if (rawParams.audioReactive) {
    const bass = clampFinite(options.audioBass, 0, 4, 0);
    const treble = clampFinite(options.audioTreble, 0, 4, 0);
    params.flySpeed *= 1 + bass * 1.8;
    params.flowStrength *= 1 + treble * 1.5;
  }
  const sourceId = String(options.sourceId || 'flythrough-native-source');
  const mediaSourceId = options.mediaSourceId ? String(options.mediaSourceId) : '';
  const time = Math.max(0, Number.isFinite(options.time) ? Number(options.time) : 0);
  const mustReset = !!options.reset
    || !options.state
    || options.state.particleCount !== params.particleCount;
  const state = mustReset ? flythroughNativeInitialState(params, time) : { ...options.state! };
  let dt = typeof options.frameDelta === 'number' && Number.isFinite(options.frameDelta)
    ? options.frameDelta
    : (state.prevFrameTime === 0 ? 1 / 60 : time - state.prevFrameTime);
  dt = Math.min(Math.max(dt, 0), 1 / 15);
  state.prevFrameTime = time;
  state.flyDistance += params.flySpeed * dt;

  const prefix = flythroughSourcePrefix(sourceId, params);
  const id = (name: string) => `${prefix}:${name}`;
  const width = Math.round(options.width || 1920);
  const height = Math.round(options.height || 1080);
  const buffers: FlythroughNativeGraphBuffer[] = [
    {
      id: id('compute-uniform'),
      kind: 'uniform',
      byte_length: 64,
      initial_b64: buildFlythroughComputeUniform(params, state, dt, time),
    },
    {
      id: id('render-uniform'),
      kind: 'uniform',
      byte_length: 256,
      initial_b64: buildFlythroughRenderUniform(params, state, width, height),
    },
    {
      id: id('particles'),
      kind: 'storage',
      byte_length: params.particleCount * PARTICLE_BYTES,
      persistent: true,
      clear: mustReset,
      initial_buffer: mustReset ? flythroughParticleInitialBuffer(params.particleCount) : undefined,
    },
  ];

  const sourceTextureBinding: FlythroughNativeGraphBinding = mediaSourceId
    ? { binding: 2, kind: 'source-frame-texture', source_id: mediaSourceId }
    : { binding: 2, kind: 'source-frame-texture', allow_missing: true };
  const passes: FlythroughNativeGraphPass[] = [
    {
      name: 'flythrough-compute',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.compute,
      entry: 'cs_main',
      dispatch: [Math.ceil(params.particleCount / 64), 1, 1],
      bindings: [
        { binding: 0, resource: id('particles'), kind: 'storage' },
        { binding: 1, resource: id('compute-uniform'), kind: 'uniform' },
      ],
    },
  ];

  const slabs = Math.max(1, Math.min(8, params.slabCount | 0));
  const renderPasses: FlythroughNativeGraphRenderPass[] = [
    {
      name: 'flythrough-render',
      shader_id: FLYTHROUGH_NATIVE_SHADER_IDS.render,
      vertex_entry: 'vs_main',
      fragment_entry: 'fs_main',
      target: 'source_frame',
      source_id: sourceId,
      seq: Math.max(0, Math.round(options.frameIndex ?? 0)),
      clear: true,
      clear_color: [0, 0, 0, 0],
      include_snapshot: !!options.includeSnapshot,
      blend: 'alpha',
      vertex_count: 6,
      instance_count: slabs * params.particleCount,
      bindings: [
        { binding: 0, resource: id('particles'), kind: 'read-only-storage' },
        { binding: 1, resource: id('render-uniform'), kind: 'uniform' },
        sourceTextureBinding,
        { binding: 3, kind: 'source-frame-sampler' },
      ],
    },
  ];

  return {
    config: {
      buffers,
      passes,
      render_passes: renderPasses,
      readbacks: [],
    },
    sourceId,
    mediaSourceId: mediaSourceId || null,
    state,
    particleCount: params.particleCount,
    topology: params.topology,
    passCount: passes.length + renderPasses.length,
  };
}

export class WebGPUFlythrough {
  private device: any;
  private presentFormat: any;

  // GPU resources
  private particleBuffer: any = null;
  private computeUniformBuffer: any = null;
  private renderUniformBuffer: any = null;
  private sourceTexture: any = null;
  private sourceTextureView: any = null;
  private sourceSampler: any = null;
  private computePipeline: any = null;
  private renderPipelinePoints: any = null;
  private renderPipelineStrokes: any = null;
  private computeBindGroup: any = null;
  private renderBindGroup: any = null;

  // CPU state
  private params: FlythroughParams = { ...DEFAULT_PARAMS };
  private flyDistance = 0;
  private prevFrameTime = 0;
  private viewportW = 1920;
  private viewportH = 1080;
  private blendMode: string = 'add';
  private sourceW = 1;
  private sourceH = 1;

  // Computed at construction. Capped by hardware support; default 250K
  // is the sweet spot for 1080p.
  private particleCount = DEFAULT_PARTICLES;

  /** Synchronous constructor — matches WebGPUPixelParticles's API so
   *  the host (WebGPUCanvas) can lazily instantiate a renderer per
   *  layer inside its frame loop without awaiting. All GPU resource
   *  creation here is synchronous in the WebGPU API; the only async
   *  surface is `setSourceImage(...)` which awaits createImageBitmap.
   *  Throws on init failure so the caller can skip / log. */
  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;
    this.init();
  }

  private init(): void {
    this.particleCount = Math.min(this.params.particleCount, MAX_PARTICLES);

    // Particle buffer — STORAGE for compute write, also bound as
    // read-only storage in the render pass. COPY_DST so we can seed
    // it from the CPU at init time.
    this.particleBuffer = this.device.createBuffer({
      size: this.particleCount * PARTICLE_BYTES,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Seed particle anchors from a Hammersley sequence in UV space
    // so the cloud has uniform-looking coverage without the obvious
    // banding of a regular grid.
    this.device.queue.writeBuffer(
      this.particleBuffer,
      0,
      new Float32Array(flythroughParticleInitialBuffer(this.particleCount)),
    );

    // Compute uniform buffer — 48 bytes (12 floats), but rounded up
    // to the WebGPU 16-byte alignment.
    this.computeUniformBuffer = this.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Render uniform buffer — fixed-size struct (see RENDER_WGSL `U`).
    // 64 (viewProj) + 16 (camRight) + 16 (camUp) + 64 (params) = 160.
    // Round up to 256 for safety / future expansion.
    this.renderUniformBuffer = this.device.createBuffer({
      size: 256,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Source texture — starts 1×1 black; replaced on first
    // setSourceImage / updateSourceFromVideo call.
    this.sourceTexture = this.device.createTexture({
      size: [1, 1, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sourceTextureView = this.sourceTexture.createView();
    this.sourceSampler = this.device.createSampler({
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
    });

    // ── Compute pipeline ─────────────────────────────────────────
    const shaderRuntime = getGhostGpuRuntime() ?? this.device;
    const computeModule = createAndWarmWgslShaderModule(shaderRuntime, COMPUTE_WGSL, 'flythrough/compute');
    const computeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.computePipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
      compute: { module: computeModule, entryPoint: 'cs_main' },
    });
    this.computeBindGroup = this.device.createBindGroup({
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.computeUniformBuffer } },
      ],
    });

    // ── Render pipelines (one per topology) ──────────────────────
    const renderModule = createAndWarmWgslShaderModule(shaderRuntime, RENDER_WGSL, 'flythrough/render');
    const renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX,   buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    const renderPipelineLayout = this.device.createPipelineLayout({
      bindGroupLayouts: [renderBindGroupLayout],
    });

    const makePipeline = () => this.device.createRenderPipeline({
      layout: renderPipelineLayout,
      vertex:   { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
    });
    // Same shader covers both topology branches via the topology
    // uniform — so one pipeline is sufficient. The two-pipeline
    // structure is reserved for if/when we need topology-specific
    // blend states or vertex layouts.
    this.renderPipelinePoints = makePipeline();
    this.renderPipelineStrokes = this.renderPipelinePoints;

    this.renderBindGroup = this.device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: this.sourceTextureView },
        { binding: 3, resource: this.sourceSampler },
      ],
    });
  }

  /** Rebuild the source texture at the given dimensions and re-create
   *  the render bind group to point at the new view. Called whenever
   *  the source size changes (e.g. user picks a different image, video
   *  resolution-switches). */
  private resizeSourceTexture(w: number, h: number): void {
    if (this.sourceW === w && this.sourceH === h && this.sourceTexture) return;
    try { this.sourceTexture?.destroy?.(); } catch { /* */ }
    this.sourceTexture = this.device.createTexture({
      size: [w, h, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.sourceTextureView = this.sourceTexture.createView();
    this.sourceW = w;
    this.sourceH = h;

    // Re-create the render bind group — it captured the old view.
    // The compute pipeline doesn't touch the source texture so its
    // bind group is unaffected.
    const renderBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX,   buffer: { type: 'read-only-storage' } },
        { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.particleBuffer } },
        { binding: 1, resource: { buffer: this.renderUniformBuffer } },
        { binding: 2, resource: this.sourceTextureView },
        { binding: 3, resource: this.sourceSampler },
      ],
    });
  }

  /** Replace the source pixels from a still image. The image is
   *  uploaded once; subsequent frames sample the texture without
   *  re-uploading. Use this for image sources or one-time stills. */
  async setSourceImage(img: HTMLImageElement | ImageBitmap | HTMLCanvasElement): Promise<void> {
    const w = (img as any).naturalWidth ?? (img as any).width ?? 1;
    const h = (img as any).naturalHeight ?? (img as any).height ?? 1;
    this.resizeSourceTexture(w, h);
    let bitmap: ImageBitmap | null = null;
    let src: any = img;
    if (img instanceof HTMLImageElement) {
      // createImageBitmap with the right orientation + premultiply
      // hint so copyExternalImageToTexture writes the same pixels the
      // user sees in the source.
      try {
        bitmap = await createImageBitmap(img, { premultiplyAlpha: 'premultiply' });
        src = bitmap;
      } catch { /* fall through to the raw element */ }
    }
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: src, flipY: false },
        { texture: this.sourceTexture, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } finally {
      if (bitmap) { try { bitmap.close(); } catch { /* */ } }
    }
  }

  /** Replace the source pixels from a canvas. The renderer uses this
   *  when a `gpu` layer's source resolves to another layer's render
   *  canvas (e.g. one gpu layer feeding another). Cheap — one
   *  copyExternalImageToTexture per frame at canvas resolution. */
  updateSourceFromCanvas(canvas: HTMLCanvasElement): void {
    const w = canvas.width | 0;
    const h = canvas.height | 0;
    if (w === 0 || h === 0) return;
    this.resizeSourceTexture(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: canvas, flipY: false },
        { texture: this.sourceTexture, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* skip frame on transient failures (context loss, etc.) */ }
  }

  /** Zero-copy byte upload for sources that already hand us a flat
   *  RGBA8 buffer (Spout / Syphon receivers, custom GPU capture
   *  paths). Caller must guarantee `data.length === w * h * 4`. */
  updateSourceFromBytes(data: Uint8Array, w: number, h: number): void {
    if (w === 0 || h === 0) return;
    this.resizeSourceTexture(w, h);
    try {
      this.device.queue.writeTexture(
        { texture: this.sourceTexture },
        data,
        { bytesPerRow: w * 4, rowsPerImage: h },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch { /* */ }
  }

  /** Replace the source pixels from a video frame. Called per frame
   *  while a video source is active. Skips when the video isn't
   *  ready (readyState < 2) or has 0×0 dimensions — caller doesn't
   *  need to gate. */
  updateSourceFromVideo(video: HTMLVideoElement): void {
    if (video.readyState < 2) return;
    const w = video.videoWidth | 0;
    const h = video.videoHeight | 0;
    if (w === 0 || h === 0) return;
    this.resizeSourceTexture(w, h);
    try {
      this.device.queue.copyExternalImageToTexture(
        { source: video, flipY: false },
        { texture: this.sourceTexture, premultipliedAlpha: true },
        { width: w, height: h, depthOrArrayLayers: 1 },
      );
    } catch (e) {
      // Common during seek / texture-loss recovery; skip the frame.
    }
  }

  setParams(p: Partial<FlythroughParams>): void {
    this.params = { ...this.params, ...p };
  }

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  setBlendMode(mode: string): void {
    this.blendMode = mode;
  }

  /** Force-set the camera Z position along the tunnel. Useful for
   *  scrubbing the fly position from a timeline or external control.
   *  Otherwise flyDistance accumulates automatically via setParams. */
  setFlyDistance(d: number): void {
    this.flyDistance = d;
  }

  /** Encode the per-frame compute + render passes into the supplied
   *  encoder. The host (WebGPUCanvas) owns the encoder + the final
   *  queue.submit so we composite cleanly with other render passes. */
  encodeFrame(encoder: any, targetView: any, time?: number, frameDt?: number): void {
    if (!this.computePipeline || !this.renderPipelinePoints) return;

    const wallNow = performance.now() / 1000;
    const now = typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : wallNow;
    let dt = typeof frameDt === 'number' && Number.isFinite(frameDt)
      ? frameDt
      : (this.prevFrameTime === 0 ? 1 / 60 : (now - this.prevFrameTime));
    // Clamp dt so a tab-switch or stall doesn't catapult particles
    // halfway across the universe.
    dt = Math.min(Math.max(dt, 0), 1 / 15);
    this.prevFrameTime = now;
    this.flyDistance += this.params.flySpeed * dt;

    // ── Write compute uniforms ────────────────────────────────────
    const cu = new Float32Array(16);
    cu[0]  = dt;
    cu[1]  = now;
    cu[2]  = this.params.flowStrength;
    cu[3]  = this.params.flowScale;
    cu[4]  = this.params.anchorPull;
    cu[5]  = this.params.tunnelDepth;
    cu[6]  = this.params.depthStrength;
    // u32 lives in the same buffer — view as Uint32 at offset 28
    new Uint32Array(cu.buffer, cu.byteOffset)[7] = this.particleCount >>> 0;
    cu[8]  = this.flyDistance;
    // remaining padding stays zero
    this.device.queue.writeBuffer(this.computeUniformBuffer, 0, cu);

    // ── Compute pass ──────────────────────────────────────────────
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.computePipeline);
      pass.setBindGroup(0, this.computeBindGroup);
      const wg = Math.ceil(this.particleCount / 64);
      pass.dispatchWorkgroups(wg);
      pass.end();
    }

    // ── Build view + projection matrices ──────────────────────────
    const aspect = this.viewportW / Math.max(1, this.viewportH);
    const proj = perspective(this.params.fovDeg, aspect, 0.05, 100);

    // View transform: camera sits at world origin, looking +Z. Slabs
    // do all the moving via flyDistance + the modulo wrap in the
    // vertex shader — the camera itself is fixed so the projection
    // math stays trivial.
    //
    // Yaw + pitch rotate the world around the camera origin so users
    // can angle into the tunnel slightly without breaking the
    // straight-Z fly model.
    const yawRad = (this.params.cameraYaw ?? 0) * Math.PI / 180;
    const pitchRad = (this.params.cameraPitch ?? 0) * Math.PI / 180;
    const cy = Math.cos(yawRad), sy = Math.sin(yawRad);
    const cp = Math.cos(pitchRad), sp = Math.sin(pitchRad);
    const ry = new Float32Array([cy, 0, sy, 0,  0, 1, 0, 0,  -sy, 0, cy, 0,  0, 0, 0, 1]);
    const rx = new Float32Array([1, 0, 0, 0,  0, cp, -sp, 0,  0, sp, cp, 0,  0, 0, 0, 1]);
    const rot = mat4Mul(ry, rx);
    // Push the world slightly forward so Z=0 is in front of the camera
    // (avoids near-plane clipping on the first slab).
    const view = mat4Mul(rot, translate(0, 0, -0.1));
    const viewProj = mat4Mul(proj, view);

    // Camera basis vectors for billboarding the point quads. With the
    // identity-ish view, right = +X and up = +Y, rotated by yaw/pitch.
    const camRight = [rot[0], rot[1], rot[2]];
    const camUp    = [rot[4], rot[5], rot[6]];

    // ── Write render uniforms ─────────────────────────────────────
    const ru = new ArrayBuffer(256);
    const ruF = new Float32Array(ru);
    const ruU = new Uint32Array(ru);
    // viewProj  @ offset 0  (64 bytes)
    ruF.set(viewProj, 0);
    // camRight  @ offset 16 (16 bytes)
    ruF[16] = camRight[0]; ruF[17] = camRight[1]; ruF[18] = camRight[2]; ruF[19] = 0;
    // camUp     @ offset 20 (16 bytes)
    ruF[20] = camUp[0]; ruF[21] = camUp[1]; ruF[22] = camUp[2]; ruF[23] = 0;
    // params @ offset 24+
    ruF[24] = this.params.baseSize;
    ruF[25] = this.params.strokeLength;
    ruF[26] = this.params.strokeWidth;
    ruU[27] = this.params.topology === 'strokes' ? 1 : 0;
    ruU[28] = Math.max(1, Math.min(8, this.params.slabCount | 0));
    ruF[29] = this.params.tunnelDepth;
    ruF[30] = this.flyDistance;
    ruU[31] = this.particleCount >>> 0;
    ruF[32] = this.params.opacity;
    ruF[33] = 1.0;   // fadeNearAlpha — fully visible at near edge of stack
    ruF[34] = 1.0;   // fadeFarAlpha  — fully visible at far edge of stack
    ruF[35] = 0;     // pad
    this.device.queue.writeBuffer(this.renderUniformBuffer, 0, ru);

    // ── Render pass ───────────────────────────────────────────────
    const slabs = Math.max(1, Math.min(8, this.params.slabCount | 0));
    const totalInstances = slabs * this.particleCount;
    const pass = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: 'load',
        storeOp: 'store',
      }],
    });
    pass.setPipeline(this.renderPipelinePoints);
    pass.setBindGroup(0, this.renderBindGroup);
    pass.draw(6, totalInstances, 0, 0);
    pass.end();
  }

  dispose(): void {
    try { this.particleBuffer?.destroy?.(); } catch { /* */ }
    try { this.computeUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.renderUniformBuffer?.destroy?.(); } catch { /* */ }
    try { this.sourceTexture?.destroy?.(); } catch { /* */ }
    this.particleBuffer = null;
    this.computeUniformBuffer = null;
    this.renderUniformBuffer = null;
    this.sourceTexture = null;
    this.sourceTextureView = null;
    this.computePipeline = null;
    this.renderPipelinePoints = null;
    this.renderPipelineStrokes = null;
  }
}
