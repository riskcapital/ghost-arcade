/**
 * WebGPUVolumetricSpheresShader — "Volumetric Nodes".
 *
 * A ray-traced particle instrument built as a real little world rather
 * than a bag of impostors:
 *
 *   • Selectable ANALYTIC geometry per node — sphere and cube are closed
 *     form (quadratic / slab); rounded box, octahedron, capsule and torus
 *     are sphere-traced inside the node's bounding sphere so the cost per
 *     primitive stays bounded.
 *   • Node/link CONNECTORS. Neighbours are found through a uniform
 *     spatial hash grid (never O(N²)), capped per node, and drawn either
 *     as thin capsule "lines" or as semi-transparent analytic cylinders
 *     that take part in the same K-nearest-hit transparency sort as the
 *     nodes.
 *   • VOLUMETRIC LIGHTING with shafts the nodes actually cast. A compute
 *     pass splats the nodes into a light-space opacity volume and a
 *     prefix sum along the light axis turns it into optical depth, so one
 *     lookup gives transmittance anywhere in the scene. The view-ray
 *     march reads it for in-scattering (Henyey-Greenstein), the nodes
 *     read it for their key light, and the ground reads it for cast
 *     shadows. Same structure, three consumers — that is what makes the
 *     beams land on things.
 *   • A ground plane, a procedural studio environment, physically
 *     plausible spot falloff, contact AO, depth fog, AgX/ACES and a
 *     vignette, so the result reads as a lit SPACE.
 *
 * Pass order (all core-owned, one graph):
 *   sim → clear-grid → bin-grid → build-links → clear-tiles → bin-nodes
 *       → bin-edges → clear-shadow → splat-shadow → prefix-shadow → render
 *
 * The WGSL lives here and is shipped to the native core through
 * `precompile_shader`; the uniform packers below are mirrored byte for
 * byte in `native-renderer/src/main.rs`.
 */

import type { GpuShaderImpl, ParamControl } from '../gpuShaderTypes';
import { deriveDefaults } from '../gpuShaderTypes';
import { createAndWarmWgslShaderModule, resolveGhostWgsl } from '../wgsl';
import { getGhostGpuRuntime } from '../webgpuShared';

type LayoutMode = 'cluster' | 'orbital' | 'column' | 'cavern' | 'lattice';
type GeometryMode = 'sphere' | 'cube' | 'rounded' | 'octahedron' | 'capsule' | 'torus';
type ConnectMode = 'off' | 'line' | 'cylinder';
type EdgeColorMode = 'own' | 'endpoints' | 'gradient';
type TonemapMode = 'agx' | 'aces' | 'none';

export interface VolumetricSpheresParams {
  /* shape */
  geometry: GeometryMode;
  layout: LayoutMode;
  sphereCount: number;
  radiusScale: number;
  radiusVariance: number;
  roundness: number;
  spinRate: number;
  spread: number;
  depth: number;
  /* connectors */
  connectMode: ConnectMode;
  connectDistance: number;
  maxLinks: number;
  edgeThickness: number;
  edgeOpacity: number;
  edgeColorMode: EdgeColorMode;
  edgeColor: [number, number, number];
  edgeFade: number;
  /* motion */
  motion: number;
  swirl: number;
  pull: number;
  chaos: number;
  damping: number;
  separation: number;
  flowScale: number;
  /* palette */
  colorA: [number, number, number];
  colorB: [number, number, number];
  colorC: [number, number, number];
  colorD: [number, number, number];
  colorCycle: number;
  saturation: number;
  brightness: number;
  /* material */
  opacity: number;
  roughness: number;
  metalness: number;
  diffuse: number;
  specular: number;
  reflection: number;
  clearCoat: number;
  coatRoughness: number;
  rim: number;
  aoStrength: number;
  /* lighting */
  lightX: number;
  lightY: number;
  lightZ: number;
  lightDistance: number;
  lightStrength: number;
  lightColor: [number, number, number];
  spotAngle: number;
  spotSoftness: number;
  lightDecay: number;
  ambient: number;
  fillColor: [number, number, number];
  fillStrength: number;
  rimColor: [number, number, number];
  /* volumetrics */
  mediumDensity: number;
  mediumColor: [number, number, number];
  anisotropy: number;
  mediumHeight: number;
  mediumNoise: number;
  shadowDensity: number;
  marchSteps: number;
  shadowRes: number;
  sphereHits: number;
  /* atmosphere */
  fogDensity: number;
  fogColor: [number, number, number];
  backgroundOpacity: number;
  exposure: number;
  tonemap: TonemapMode;
  vignette: number;
  envStrength: number;
  /* ground */
  groundEnabled: boolean;
  groundHeight: number;
  groundColor: [number, number, number];
  groundRoughness: number;
  /* audio */
  audioReactive: boolean;
  bassPulse: number;
  trebleSparkle: number;
  /* camera */
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
  lattice: 4,
};

const GEOMETRY_ID: Record<GeometryMode, number> = {
  sphere: 0,
  cube: 1,
  rounded: 2,
  octahedron: 3,
  capsule: 4,
  torus: 5,
};

const CONNECT_ID: Record<ConnectMode, number> = {
  off: 0,
  line: 1,
  cylinder: 2,
};

const EDGE_COLOR_ID: Record<EdgeColorMode, number> = {
  own: 0,
  endpoints: 1,
  gradient: 2,
};

const TONEMAP_ID: Record<TonemapMode, number> = {
  agx: 0,
  aces: 1,
  none: 2,
};

export const volumetricSpheresParamSchema: ParamControl[] = [
  /* ── Shape ─────────────────────────────────────────────────────── */
  { kind: 'select', key: 'geometry', label: 'Geometry', group: 'Shape',
    options: [
      { value: 'sphere', label: 'Sphere' },
      { value: 'cube', label: 'Cube' },
      { value: 'rounded', label: 'Rounded Box' },
      { value: 'octahedron', label: 'Octahedron' },
      { value: 'capsule', label: 'Capsule' },
      { value: 'torus', label: 'Torus' },
    ],
    default: 'sphere' },
  { kind: 'select', key: 'layout', label: 'Layout', group: 'Shape',
    options: [
      { value: 'cluster', label: 'Cluster' },
      { value: 'orbital', label: 'Orbital' },
      { value: 'column', label: 'Column' },
      { value: 'cavern', label: 'Cavern' },
      { value: 'lattice', label: 'Lattice' },
    ],
    default: 'cluster' },
  { kind: 'slider', key: 'sphereCount', label: 'Node Count', group: 'Shape',
    min: 24, max: 1200, step: 4, default: 260 },
  { kind: 'slider', key: 'radiusScale', label: 'Node Size', group: 'Shape',
    min: 0.01, max: 0.24, step: 0.001, default: 0.058 },
  { kind: 'slider', key: 'radiusVariance', label: 'Size Variation', group: 'Shape',
    min: 0, max: 1, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'roundness', label: 'Edge Rounding', group: 'Shape',
    min: 0, max: 1, step: 0.01, default: 0.45,
    showWhen: { geometry: 'rounded' } },
  { kind: 'slider', key: 'spinRate', label: 'Tumble', group: 'Shape',
    min: 0, max: 4, step: 0.01, default: 0.5 },
  { kind: 'slider', key: 'spread', label: 'Spread', group: 'Shape',
    min: 0.25, max: 2.8, step: 0.01, default: 1.2 },
  { kind: 'slider', key: 'depth', label: 'Depth', group: 'Shape',
    min: 0.25, max: 3.5, step: 0.01, default: 1.3 },

  /* ── Connections ───────────────────────────────────────────────── */
  { kind: 'select', key: 'connectMode', label: 'Connectors', group: 'Connections',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'line', label: 'Lines' },
      { value: 'cylinder', label: 'Cylinders' },
    ],
    default: 'cylinder' },
  { kind: 'slider', key: 'connectDistance', label: 'Connect Distance', group: 'Connections',
    min: 0.04, max: 1.2, step: 0.005, default: 0.45,
    showWhen: { connectMode: undefined } },
  { kind: 'slider', key: 'maxLinks', label: 'Links / Node', group: 'Connections',
    min: 0, max: 8, step: 1, default: 4 },
  { kind: 'slider', key: 'edgeThickness', label: 'Edge Thickness', group: 'Connections',
    min: 0.001, max: 0.05, step: 0.0005, default: 0.011 },
  { kind: 'slider', key: 'edgeOpacity', label: 'Edge Opacity', group: 'Connections',
    min: 0, max: 1, step: 0.01, default: 0.7 },
  { kind: 'select', key: 'edgeColorMode', label: 'Edge Colour', group: 'Connections',
    options: [
      { value: 'own', label: 'Own Colour' },
      { value: 'endpoints', label: 'From Endpoints' },
      { value: 'gradient', label: 'Gradient Along Edge' },
    ],
    default: 'gradient' },
  { kind: 'color', key: 'edgeColor', label: 'Edge Tint', group: 'Connections',
    default: [150, 205, 255] },
  { kind: 'slider', key: 'edgeFade', label: 'Fade With Length', group: 'Connections',
    min: 0, max: 1, step: 0.01, default: 0.55 },

  /* ── Motion ────────────────────────────────────────────────────── */
  { kind: 'slider', key: 'motion', label: 'Motion', group: 'Motion',
    min: 0, max: 2.5, step: 0.01, default: 0.7 },
  { kind: 'slider', key: 'swirl', label: 'Swirl', group: 'Motion',
    min: -2, max: 2, step: 0.01, default: 0.42 },
  { kind: 'slider', key: 'pull', label: 'Center Pull', group: 'Motion',
    min: -0.5, max: 1.5, step: 0.01, default: 0.34 },
  { kind: 'slider', key: 'chaos', label: 'Chaos', group: 'Motion',
    min: 0, max: 2, step: 0.01, default: 0.38 },
  { kind: 'slider', key: 'flowScale', label: 'Flow Scale', group: 'Motion',
    min: 0.2, max: 4, step: 0.01, default: 1.15 },
  { kind: 'slider', key: 'damping', label: 'Damping', group: 'Motion',
    min: 0, max: 5, step: 0.01, default: 1.55 },
  { kind: 'slider', key: 'separation', label: 'Separation', group: 'Motion',
    min: 0, max: 2, step: 0.01, default: 0.65 },

  /* ── Palette ───────────────────────────────────────────────────── */
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
    min: 0, max: 2, step: 0.01, default: 1.3 },
  { kind: 'slider', key: 'brightness', label: 'Brightness', group: 'Palette',
    min: 0, max: 3, step: 0.01, default: 1.08 },

  /* ── Material ──────────────────────────────────────────────────── */
  { kind: 'slider', key: 'opacity', label: 'Node Opacity', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 1 },
  { kind: 'slider', key: 'roughness', label: 'Roughness', group: 'Material',
    min: 0.03, max: 1, step: 0.01, default: 0.22 },
  { kind: 'slider', key: 'metalness', label: 'Metalness', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.15 },
  { kind: 'slider', key: 'diffuse', label: 'Diffuse', group: 'Material',
    min: 0, max: 2, step: 0.01, default: 1.5 },
  { kind: 'slider', key: 'specular', label: 'Specular', group: 'Material',
    min: 0, max: 3, step: 0.01, default: 1.4 },
  { kind: 'slider', key: 'reflection', label: 'Reflection', group: 'Material',
    min: 0, max: 2, step: 0.01, default: 0.45 },
  { kind: 'slider', key: 'clearCoat', label: 'Clear Coat', group: 'Material',
    min: 0, max: 1, step: 0.01, default: 0.4 },
  { kind: 'slider', key: 'coatRoughness', label: 'Coat Roughness', group: 'Material',
    min: 0.03, max: 1, step: 0.01, default: 0.1 },
  { kind: 'slider', key: 'rim', label: 'Rim Light', group: 'Material',
    min: 0, max: 2, step: 0.01, default: 0.35 },
  { kind: 'slider', key: 'aoStrength', label: 'Contact AO', group: 'Material',
    min: 0, max: 2, step: 0.01, default: 0.85 },

  /* ── Light ─────────────────────────────────────────────────────── */
  { kind: 'slider', key: 'lightX', label: 'Light X', group: 'Light',
    min: -2, max: 2, step: 0.01, default: -0.72 },
  { kind: 'slider', key: 'lightY', label: 'Light Y', group: 'Light',
    min: -2, max: 2, step: 0.01, default: 1.22 },
  { kind: 'slider', key: 'lightZ', label: 'Light Z', group: 'Light',
    min: -2, max: 2, step: 0.01, default: -0.22 },
  { kind: 'slider', key: 'lightDistance', label: 'Light Distance', group: 'Light',
    min: 1, max: 12, step: 0.05, default: 5.5 },
  { kind: 'slider', key: 'lightStrength', label: 'Key Strength', group: 'Light',
    min: 0, max: 8, step: 0.01, default: 4.2 },
  { kind: 'color', key: 'lightColor', label: 'Key Colour', group: 'Light',
    default: [255, 238, 214] },
  { kind: 'slider', key: 'spotAngle', label: 'Spot Angle', group: 'Light',
    min: 5, max: 180, step: 1, default: 34 },
  { kind: 'slider', key: 'spotSoftness', label: 'Spot Softness', group: 'Light',
    min: 0.01, max: 1, step: 0.01, default: 0.85 },
  { kind: 'slider', key: 'lightDecay', label: 'Decay', group: 'Light',
    min: 0, max: 4, step: 0.01, default: 0.5 },
  { kind: 'slider', key: 'ambient', label: 'Ambient', group: 'Light',
    min: 0, max: 1, step: 0.01, default: 0.09 },
  { kind: 'color', key: 'fillColor', label: 'Fill Colour', group: 'Light',
    default: [86, 122, 178] },
  { kind: 'slider', key: 'fillStrength', label: 'Fill Strength', group: 'Light',
    min: 0, max: 2, step: 0.01, default: 0.5 },
  { kind: 'color', key: 'rimColor', label: 'Rim Colour', group: 'Light',
    default: [150, 200, 255] },

  /* ── Volumetrics ───────────────────────────────────────────────── */
  { kind: 'slider', key: 'mediumDensity', label: 'Haze Density', group: 'Volumetrics',
    min: 0, max: 3, step: 0.01, default: 0.5 },
  { kind: 'color', key: 'mediumColor', label: 'Haze Colour', group: 'Volumetrics',
    default: [214, 226, 255] },
  { kind: 'slider', key: 'anisotropy', label: 'Anisotropy', group: 'Volumetrics',
    min: -0.9, max: 0.9, step: 0.01, default: 0.55 },
  { kind: 'slider', key: 'mediumHeight', label: 'Haze Height Falloff', group: 'Volumetrics',
    min: 0, max: 2, step: 0.01, default: 0.2 },
  { kind: 'slider', key: 'mediumNoise', label: 'Haze Texture', group: 'Volumetrics',
    min: 0, max: 1, step: 0.01, default: 0.5 },
  { kind: 'slider', key: 'shadowDensity', label: 'Shadow Density', group: 'Volumetrics',
    min: 0, max: 8, step: 0.01, default: 6.5 },
  { kind: 'slider', key: 'marchSteps', label: 'March Steps', group: 'Volumetrics',
    min: 8, max: 128, step: 1, default: 40 },
  { kind: 'select', key: 'shadowRes', label: 'Shadow Volume', group: 'Volumetrics',
    options: [
      { value: '32', label: '32³ (fast)' },
      { value: '48', label: '48³' },
      { value: '64', label: '64³' },
      { value: '80', label: '80³ (sharp)' },
    ],
    default: '48' },
  { kind: 'slider', key: 'sphereHits', label: 'Transparency Depth', group: 'Volumetrics',
    min: 1, max: 6, step: 1, default: 3 },

  /* ── Atmosphere ────────────────────────────────────────────────── */
  { kind: 'slider', key: 'fogDensity', label: 'Depth Fog', group: 'Atmosphere',
    min: 0, max: 2.5, step: 0.01, default: 0.16 },
  { kind: 'color', key: 'fogColor', label: 'Fog / Sky Colour', group: 'Atmosphere',
    default: [12, 16, 30] },
  { kind: 'slider', key: 'backgroundOpacity', label: 'Background', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 1 },
  { kind: 'slider', key: 'envStrength', label: 'Environment', group: 'Atmosphere',
    min: 0, max: 3, step: 0.01, default: 0.6 },
  { kind: 'slider', key: 'exposure', label: 'Exposure', group: 'Atmosphere',
    min: 0.1, max: 4, step: 0.01, default: 1.05 },
  { kind: 'select', key: 'tonemap', label: 'Tonemap', group: 'Atmosphere',
    options: [
      { value: 'agx', label: 'AgX' },
      { value: 'aces', label: 'ACES' },
      { value: 'none', label: 'None' },
    ],
    default: 'agx' },
  { kind: 'slider', key: 'vignette', label: 'Vignette', group: 'Atmosphere',
    min: 0, max: 1, step: 0.01, default: 0.55 },

  /* ── Ground ────────────────────────────────────────────────────── */
  { kind: 'toggle', key: 'groundEnabled', label: 'Ground Plane', group: 'Ground',
    default: true },
  { kind: 'slider', key: 'groundHeight', label: 'Ground Height', group: 'Ground',
    min: -4, max: 1, step: 0.01, default: -1.55,
    showWhen: { groundEnabled: true } },
  { kind: 'color', key: 'groundColor', label: 'Ground Colour', group: 'Ground',
    default: [40, 44, 54], showWhen: { groundEnabled: true } },
  { kind: 'slider', key: 'groundRoughness', label: 'Ground Roughness', group: 'Ground',
    min: 0.03, max: 1, step: 0.01, default: 0.38,
    showWhen: { groundEnabled: true } },

  /* ── Audio ─────────────────────────────────────────────────────── */
  { kind: 'toggle', key: 'audioReactive', label: 'Audio Reactive', group: 'Audio',
    default: true },
  { kind: 'slider', key: 'bassPulse', label: 'Bass Pulse', group: 'Audio',
    min: 0, max: 3, step: 0.01, default: 1.05,
    showWhen: { audioReactive: true } },
  { kind: 'slider', key: 'trebleSparkle', label: 'Treble Sparkle', group: 'Audio',
    min: 0, max: 1, step: 0.01, default: 0.32,
    showWhen: { audioReactive: true } },

  /* ── Camera ────────────────────────────────────────────────────── */
  { kind: 'slider', key: 'fovDeg', label: 'FOV', group: 'Camera',
    min: 25, max: 95, step: 1, default: 46 },
  { kind: 'slider', key: 'cameraZ', label: 'Distance', group: 'Camera',
    min: 1.2, max: 8, step: 0.05, default: 3.8 },
  { kind: 'angle', key: 'rotateX', label: 'Rotate X', group: 'Camera', default: 10 },
  { kind: 'angle', key: 'rotateY', label: 'Rotate Y', group: 'Camera', default: 0 },
  { kind: 'angle', key: 'rotateZ', label: 'Rotate Z', group: 'Camera', default: 0 },
  { kind: 'slider', key: 'autoRotateX', label: 'Auto-Spin X', group: 'Camera',
    min: -24, max: 24, step: 0.1, default: 0 },
  { kind: 'slider', key: 'autoRotateY', label: 'Auto-Spin Y', group: 'Camera',
    min: -36, max: 36, step: 0.1, default: 4 },
  { kind: 'slider', key: 'autoRotateZ', label: 'Auto-Spin Z', group: 'Camera',
    min: -24, max: 24, step: 0.1, default: 0 },
];

export const volumetricSpheresParamDefaults = deriveDefaults(volumetricSpheresParamSchema);

/* ============================================================== */
/* SHARED CONSTANTS — mirrored in native-renderer/src/main.rs      */
/* ============================================================== */

const SPHERE_STRIDE_FLOATS = 16;
const MIN_SPHERES = 1;
const MAX_SPHERES = 1200;
const VS_MAX_LINKS = 8;
const VS_TILE_SIZE = 16;
const VS_TILE_CAP = 48;
const VS_EDGE_TILE_CAP = 64;
const VS_MAX_HITS = 6;
const VS_GRID_DIM = 32;
const VS_GRID_CELLS = 32768;
const VS_GRID_CAP = 12;
const VS_SHADOW_DIM_MAX = 80;
const VS_SHADOW_CELLS_MAX = 512000;
const RENDER_SAMPLE_COUNT = 1;

const SIM_UNIFORM_BYTES = 112;
const LINK_UNIFORM_BYTES = 64;
const BIN_UNIFORM_BYTES = 112;
const SHADOW_UNIFORM_BYTES = 96;
const RENDER_UNIFORM_BYTES = 528;

/* ============================================================== */
/* WGSL — simulation                                               */
/* ============================================================== */

const SIM_WGSL = /* wgsl */ `
#include <noise>

struct Particle {
  pos: vec3<f32>, radius: f32,
  vel: vec3<f32>, seed: f32,
  color: vec3<f32>, group: f32,
  rot: vec4<f32>,
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
  gridDim: vec3<u32>,
  gridCap: u32,
  gridMin: vec3<f32>,
  cellSize: f32,
  separation: f32,
  spinRate: f32,
  radiusScale: f32,
  flowScale: f32,
};

@group(0) @binding(0) var<storage, read_write> parts: array<Particle>;
@group(0) @binding(1) var<uniform>             u:     SimU;
@group(0) @binding(2) var<storage, read>       gridCounts: array<u32>;
@group(0) @binding(3) var<storage, read>       gridItems:  array<u32>;

fn vsQMul(a: vec4<f32>, b: vec4<f32>) -> vec4<f32> {
  return vec4<f32>(
    a.w * b.xyz + b.w * a.xyz + cross(a.xyz, b.xyz),
    a.w * b.w - dot(a.xyz, b.xyz),
  );
}

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }

  var s = parts[i];
  let dt = clamp(u.dt, 0.0, 1.0 / 15.0);
  let seed = s.seed;
  let centerLen = max(length(s.pos), 1.0e-4);
  let radial = s.pos / centerLen;
  let axis = normalize(vec3<f32>(
    sin(seed * 41.7 + u.time * 0.13),
    0.72 + sin(seed * 19.3) * 0.24,
    cos(seed * 37.1 - u.time * 0.11),
  ));

  // Curl noise gives a divergence-free flow, so the population drifts
  // and folds without ever piling up or thinning out — plain value
  // noise as a force field does both.
  let flowP = s.pos * max(u.flowScale, 0.05)
    + vec3<f32>(u.time * 0.07, u.time * -0.05, u.time * 0.04);
  let curl = (ghost_curl_noise3(flowP)
    + ghost_curl_noise3(flowP * 2.17 + vec3<f32>(11.3, 4.1, 7.7)) * 0.5) * 0.03;
  let tangent = normalize(cross(axis, radial) + curl * 0.6 + vec3<f32>(1.0e-5));

  var accel = vec3<f32>(0.0);
  accel = accel + tangent * (u.swirl * 0.55);
  accel = accel - s.pos * (u.pull * 0.24);
  accel = accel + curl * (u.drift * (0.45 + u.chaos * 0.7));
  accel = accel + radial * (u.bass * u.bassPulse * 0.8);

  if (u.layoutMode == 1u) {
    let orbitLift = vec3<f32>(-s.pos.z, sin(seed * 6.283) * 0.2, s.pos.x);
    accel = accel + normalize(orbitLift + vec3<f32>(1.0e-4)) * (0.38 + u.swirl * 0.2);
  } else if (u.layoutMode == 2u) {
    accel = accel + vec3<f32>(0.0, 0.45 + u.bass * 0.3, 0.0);
  } else if (u.layoutMode == 3u) {
    let shellTarget = normalize(s.pos + vec3<f32>(1.0e-4)) * u.bounds * 0.78;
    accel = accel + (shellTarget - s.pos) * 0.18;
  } else if (u.layoutMode == 4u) {
    // Lattice: a soft spring back toward the node's own seeded cell so
    // the grid breathes instead of dissolving.
    let home = vec3<f32>(
      floor(s.pos.x * 3.0 + 0.5) / 3.0,
      floor(s.pos.y * 3.0 + 0.5) / 3.0,
      floor(s.pos.z * 3.0 + 0.5) / 3.0,
    );
    accel = accel + (home - s.pos) * 1.2;
  }

  // ── Separation, through LAST frame's spatial grid. ───────────────
  // The grid is rebuilt after this pass, so the read is one frame
  // stale — at these velocities that is far below a cell and it keeps
  // the whole thing to one bounded 27-cell gather instead of O(N²).
  if (u.separation > 0.0 && u.gridCap > 0u) {
    let cellF = (s.pos - u.gridMin) / max(u.cellSize, 1.0e-5);
    let base = clamp(vec3<i32>(floor(cellF)), vec3<i32>(0), vec3<i32>(u.gridDim) - vec3<i32>(1));
    let ri = s.radius * u.radiusScale;
    var push = vec3<f32>(0.0);
    for (var dz = -1; dz <= 1; dz = dz + 1) {
      for (var dy = -1; dy <= 1; dy = dy + 1) {
        for (var dx = -1; dx <= 1; dx = dx + 1) {
          let c = base + vec3<i32>(dx, dy, dz);
          if (c.x < 0 || c.y < 0 || c.z < 0) { continue; }
          if (c.x >= i32(u.gridDim.x) || c.y >= i32(u.gridDim.y) || c.z >= i32(u.gridDim.z)) { continue; }
          let cell = u32(c.z) * u.gridDim.x * u.gridDim.y + u32(c.y) * u.gridDim.x + u32(c.x);
          let n = min(gridCounts[cell], u.gridCap);
          for (var k: u32 = 0u; k < n; k = k + 1u) {
            let j = gridItems[cell * u.gridCap + k];
            if (j >= u.count || j == i) { continue; }
            let other = parts[j];
            let d = s.pos - other.pos;
            let dist = length(d);
            let minD = (ri + other.radius * u.radiusScale) * 1.04;
            if (dist < minD && dist > 1.0e-5) {
              push = push + (d / dist) * (minD - dist);
            }
          }
        }
      }
    }
    accel = accel + push * (u.separation * 42.0);
  }

  // Soft inward push before the wall, so a node decelerates into the
  // boundary instead of snapping off it.
  let toWall = u.bounds - abs(s.pos);
  accel = accel - sign(s.pos) * max(vec3<f32>(0.16) - toWall, vec3<f32>(0.0)) * 30.0;

  s.vel = s.vel + accel * (dt * max(u.motion, 0.0));
  s.vel = s.vel * exp(-u.damping * dt);
  s.pos = s.pos + s.vel * dt;

  if (s.pos.x > u.bounds.x) { s.pos.x = u.bounds.x; s.vel.x = -abs(s.vel.x) * 0.5; }
  if (s.pos.x < -u.bounds.x) { s.pos.x = -u.bounds.x; s.vel.x = abs(s.vel.x) * 0.5; }
  if (s.pos.y > u.bounds.y) { s.pos.y = u.bounds.y; s.vel.y = -abs(s.vel.y) * 0.5; }
  if (s.pos.y < -u.bounds.y) { s.pos.y = -u.bounds.y; s.vel.y = abs(s.vel.y) * 0.5; }
  if (s.pos.z > u.bounds.z) { s.pos.z = u.bounds.z; s.vel.z = -abs(s.vel.z) * 0.5; }
  if (s.pos.z < -u.bounds.z) { s.pos.z = -u.bounds.z; s.vel.z = abs(s.vel.z) * 0.5; }

  // Per-node tumble so cubes and capsules are not all axis aligned.
  let spinAxis = normalize(vec3<f32>(
    sin(seed * 12.9 + 0.7),
    cos(seed * 7.3 + 1.9),
    sin(seed * 21.1 - 0.4),
  ) + vec3<f32>(1.0e-5));
  let ang = u.spinRate * dt * (0.35 + fract(seed * 7.77) * 1.3);
  let dq = vec4<f32>(spinAxis * sin(ang * 0.5), cos(ang * 0.5));
  var q = vsQMul(dq, s.rot);
  if (dot(q, q) < 1.0e-8) { q = vec4<f32>(0.0, 0.0, 0.0, 1.0); }
  s.rot = normalize(q);

  parts[i] = s;
}
`;

/* ============================================================== */
/* WGSL — spatial hash grid + link building                        */
/* ============================================================== */

const LINKS_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, radius: f32,
  vel: vec3<f32>, seed: f32,
  color: vec3<f32>, group: f32,
  rot: vec4<f32>,
};

struct Edge { a: u32, b: u32, w: f32, life: f32 };

struct LinkU {
  count: u32,
  gridCap: u32,
  maxLinks: u32,
  maxEdges: u32,
  gridDim: vec3<u32>,
  cellCount: u32,
  gridMin: vec3<f32>,
  cellSize: f32,
  connectDist: f32,
  fadeStart: f32,
  radiusScale: f32,
  edgeFade: f32,
};

@group(0) @binding(0) var<uniform>             u:          LinkU;
@group(0) @binding(1) var<storage, read>       parts:      array<Particle>;
@group(0) @binding(2) var<storage, read_write> gridCounts: array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> gridItems:  array<u32>;
@group(0) @binding(4) var<storage, read_write> edges:      array<Edge>;
@group(0) @binding(5) var<storage, read_write> edgeCount:  array<atomic<u32>>;

fn vsCell(p: vec3<f32>) -> vec3<i32> {
  return vec3<i32>(floor((p - u.gridMin) / max(u.cellSize, 1.0e-5)));
}

@compute @workgroup_size(64)
fn cs_clear_grid(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i == 0u) { atomicStore(&edgeCount[0], 0u); }
  if (i >= u.cellCount) { return; }
  atomicStore(&gridCounts[i], 0u);
}

@compute @workgroup_size(64)
fn cs_bin_particles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let c = clamp(vsCell(parts[i].pos), vec3<i32>(0), vec3<i32>(u.gridDim) - vec3<i32>(1));
  let cell = u32(c.z) * u.gridDim.x * u.gridDim.y + u32(c.y) * u.gridDim.x + u32(c.x);
  let slot = atomicAdd(&gridCounts[cell], 1u);
  if (slot < u.gridCap) {
    gridItems[cell * u.gridCap + slot] = i;
  }
}

@compute @workgroup_size(64)
fn cs_build_links(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }
  if (u.maxLinks == 0u) { return; }

  let pi = parts[i].pos;
  let base = clamp(vsCell(pi), vec3<i32>(0), vec3<i32>(u.gridDim) - vec3<i32>(1));
  let maxD = max(u.connectDist, 1.0e-4);
  let cap = min(u.maxLinks, ${VS_MAX_LINKS}u);

  var bestD = array<f32, ${VS_MAX_LINKS}>(1.0e30, 1.0e30, 1.0e30, 1.0e30, 1.0e30, 1.0e30, 1.0e30, 1.0e30);
  var bestI = array<u32, ${VS_MAX_LINKS}>(0u, 0u, 0u, 0u, 0u, 0u, 0u, 0u);
  var found: u32 = 0u;

  // The cell size is chosen on the host so it is never smaller than the
  // connect distance; that is what makes a 27-cell gather sufficient and
  // keeps this pass O(N) instead of O(N²).
  for (var dz = -1; dz <= 1; dz = dz + 1) {
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        let c = base + vec3<i32>(dx, dy, dz);
        if (c.x < 0 || c.y < 0 || c.z < 0) { continue; }
        if (c.x >= i32(u.gridDim.x) || c.y >= i32(u.gridDim.y) || c.z >= i32(u.gridDim.z)) { continue; }
        let cell = u32(c.z) * u.gridDim.x * u.gridDim.y + u32(c.y) * u.gridDim.x + u32(c.x);
        let n = min(atomicLoad(&gridCounts[cell]), u.gridCap);
        for (var k: u32 = 0u; k < n; k = k + 1u) {
          let j = gridItems[cell * u.gridCap + k];
          if (j >= u.count || j == i) { continue; }
          let d = distance(pi, parts[j].pos);
          if (d > maxD) { continue; }
          if (found >= cap && d >= bestD[cap - 1u]) { continue; }
          var slot = min(found, cap - 1u);
          loop {
            if (slot == 0u) { break; }
            if (bestD[slot - 1u] <= d) { break; }
            bestD[slot] = bestD[slot - 1u];
            bestI[slot] = bestI[slot - 1u];
            slot = slot - 1u;
          }
          bestD[slot] = d;
          bestI[slot] = j;
          found = min(found + 1u, cap);
        }
      }
    }
  }

  for (var e: u32 = 0u; e < found; e = e + 1u) {
    let j = bestI[e];
    // Emit each pair once. Index order is arbitrary with respect to
    // position, so this halves the edge count without biasing the graph.
    if (j <= i) { continue; }
    let d = bestD[e];
    // Smooth boundary weight: an edge is born and dies as a fade rather
    // than a pop, which is what stops the graph strobing as nodes drift
    // across the threshold.
    let w = 1.0 - smoothstep(u.fadeStart, maxD, d);
    if (w <= 0.004) { continue; }
    let slot = atomicAdd(&edgeCount[0], 1u);
    if (slot >= u.maxEdges) { continue; }
    var rec: Edge;
    rec.a = i;
    rec.b = j;
    rec.w = w;
    rec.life = mix(1.0, 1.0 - clamp(d / maxD, 0.0, 1.0) * 0.85, clamp(u.edgeFade, 0.0, 1.0));
    edges[slot] = rec;
  }
}
`;

/* ============================================================== */
/* WGSL — screen-tile binning (nodes + edges)                      */
/* ============================================================== */

const TILES_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, radius: f32,
  vel: vec3<f32>, seed: f32,
  color: vec3<f32>, group: f32,
  rot: vec4<f32>,
};

struct Edge { a: u32, b: u32, w: f32, life: f32 };

struct BinU {
  viewProj: mat4x4<f32>,
  tileCountX: u32, tileCountY: u32, tileCap: u32, nodeCount: u32,
  edgeTileCap: u32, maxEdges: u32, projY: f32, aspect: f32,
  radiusScale: f32, edgeRadius: f32, geometry: u32, pad0: f32,
};

@group(0) @binding(0) var<uniform>             bu:         BinU;
@group(0) @binding(1) var<storage, read>       parts:      array<Particle>;
@group(0) @binding(2) var<storage, read>       edges:      array<Edge>;
@group(0) @binding(3) var<storage, read_write> nodeCounts: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> nodeItems:  array<u32>;
@group(0) @binding(5) var<storage, read_write> edgeCounts: array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> edgeItems:  array<u32>;
@group(0) @binding(7) var<storage, read>       edgeTotal:  array<u32>;

@compute @workgroup_size(64)
fn cs_clear_tiles(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= bu.tileCountX * bu.tileCountY) { return; }
  atomicStore(&nodeCounts[i], 0u);
  atomicStore(&edgeCounts[i], 0u);
}

// Screen-space footprint of a world sphere, as a tile rect. projY is
// 1/tan(fov/2), so radius*projY/viewZ is the half-height in NDC.
fn vsTileRect(center: vec3<f32>, radius: f32) -> vec4<i32> {
  let clip = bu.viewProj * vec4<f32>(center, 1.0);
  if (clip.w <= 0.001) { return vec4<i32>(1, 1, 0, 0); }
  let ndc = clip.xyz / clip.w;
  let rY = radius * bu.projY / max(clip.w, 1.0e-3);
  let rX = rY / max(bu.aspect, 1.0e-3);
  let uMin = (ndc.x - rX) * 0.5 + 0.5;
  let uMax = (ndc.x + rX) * 0.5 + 0.5;
  let vMin = 0.5 - (ndc.y + rY) * 0.5;
  let vMax = 0.5 - (ndc.y - rY) * 0.5;
  return vec4<i32>(
    i32(floor(uMin * f32(bu.tileCountX))),
    i32(floor(vMin * f32(bu.tileCountY))),
    i32(floor(uMax * f32(bu.tileCountX))),
    i32(floor(vMax * f32(bu.tileCountY))),
  );
}

@compute @workgroup_size(64)
fn cs_bin_nodes(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= bu.nodeCount) { return; }
  let p = parts[i];
  let radius = max(p.radius * bu.radiusScale, 1.0e-5);
  var r = vsTileRect(p.pos, radius);
  let tcx = i32(bu.tileCountX);
  let tcy = i32(bu.tileCountY);
  if (r.z < 0 || r.w < 0 || r.x >= tcx || r.y >= tcy || r.x > r.z || r.y > r.w) { return; }
  let x0 = clamp(r.x, 0, tcx - 1);
  let y0 = clamp(r.y, 0, tcy - 1);
  let x1 = min(clamp(r.z, 0, tcx - 1), x0 + 63);
  let y1 = min(clamp(r.w, 0, tcy - 1), y0 + 63);
  for (var ty = y0; ty <= y1; ty = ty + 1) {
    for (var tx = x0; tx <= x1; tx = tx + 1) {
      let tile = u32(ty) * bu.tileCountX + u32(tx);
      let slot = atomicAdd(&nodeCounts[tile], 1u);
      if (slot < bu.tileCap) {
        nodeItems[tile * bu.tileCap + slot] = i;
      }
    }
  }
}

@compute @workgroup_size(64)
fn cs_bin_edges(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  let total = min(edgeTotal[0], bu.maxEdges);
  if (i >= total) { return; }
  let e = edges[i];
  if (e.a >= bu.nodeCount || e.b >= bu.nodeCount) { return; }
  let pa = parts[e.a].pos;
  let pb = parts[e.b].pos;
  let ra = vsTileRect(pa, bu.edgeRadius);
  let rb = vsTileRect(pb, bu.edgeRadius);
  if (ra.x > ra.z || rb.x > rb.z) { return; }
  let tcx = i32(bu.tileCountX);
  let tcy = i32(bu.tileCountY);
  var x0 = min(ra.x, rb.x);
  var y0 = min(ra.y, rb.y);
  var x1 = max(ra.z, rb.z);
  var y1 = max(ra.w, rb.w);
  if (x1 < 0 || y1 < 0 || x0 >= tcx || y0 >= tcy) { return; }
  x0 = clamp(x0, 0, tcx - 1);
  y0 = clamp(y0, 0, tcy - 1);
  x1 = min(clamp(x1, 0, tcx - 1), x0 + 95);
  y1 = min(clamp(y1, 0, tcy - 1), y0 + 95);
  for (var ty = y0; ty <= y1; ty = ty + 1) {
    for (var tx = x0; tx <= x1; tx = tx + 1) {
      let tile = u32(ty) * bu.tileCountX + u32(tx);
      let slot = atomicAdd(&edgeCounts[tile], 1u);
      if (slot < bu.edgeTileCap) {
        edgeItems[tile * bu.edgeTileCap + slot] = i;
      }
    }
  }
}
`;

/* ============================================================== */
/* WGSL — light-space opacity volume                               */
/* ============================================================== */
// This is the piece that makes the shafts real. Nodes are splatted into
// a grid oriented along the light, then a prefix sum along the light
// axis converts occupancy into accumulated optical depth. One lookup
// anywhere in the scene then answers "how much of the key reaches
// here?" — for the haze march, for the nodes themselves, and for the
// ground. It is the opacity-shadow-map family, and it costs a fraction
// of shadow-raying every march step.

const SHADOW_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, radius: f32,
  vel: vec3<f32>, seed: f32,
  color: vec3<f32>, group: f32,
  rot: vec4<f32>,
};

struct ShadowU {
  lu: vec3<f32>, extent: f32,
  lv: vec3<f32>, depth: f32,
  lw: vec3<f32>, cellCount: u32,
  center: vec3<f32>, count: u32,
  dim: vec3<u32>, radiusScale: f32,
  density: f32, geometry: u32, softness: f32, pad0: f32,
};

@group(0) @binding(0) var<uniform>             u:      ShadowU;
@group(0) @binding(1) var<storage, read>       parts:  array<Particle>;
@group(0) @binding(2) var<storage, read_write> acc:    array<atomic<u32>>;
@group(0) @binding(3) var<storage, read_write> lightDepth: array<f32>;

@compute @workgroup_size(64)
fn cs_clear_shadow(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.cellCount) { return; }
  atomicStore(&acc[i], 0u);
}

@compute @workgroup_size(64)
fn cs_splat_shadow(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x;
  if (i >= u.count) { return; }
  let p = parts[i];
  let rel = p.pos - u.center;
  let ext = max(u.extent, 1.0e-4);
  let dep = max(u.depth, 1.0e-4);
  let dimX = f32(u.dim.x);
  let dimY = f32(u.dim.y);
  let dimZ = f32(u.dim.z);
  let fx = (dot(rel, u.lu) / ext * 0.5 + 0.5) * dimX;
  let fy = (dot(rel, u.lv) / ext * 0.5 + 0.5) * dimY;
  let fz = (dot(rel, u.lw) / dep + 0.5) * dimZ;

  let rWorld = max(p.radius * u.radiusScale, 1.0e-5);
  let cellX = (2.0 * ext) / dimX;
  let cellY = (2.0 * ext) / dimY;
  let cellZ = dep / dimZ;
  let spanX = min(i32(ceil(rWorld / max(cellX, 1.0e-6))), 6);
  let spanY = min(i32(ceil(rWorld / max(cellY, 1.0e-6))), 6);
  let spanZ = min(i32(ceil(rWorld / max(cellZ, 1.0e-6))), 6);
  let bx = i32(floor(fx));
  let by = i32(floor(fy));
  let bz = i32(floor(fz));
  let soft = clamp(u.softness, 0.05, 1.0);

  for (var dz = -spanZ; dz <= spanZ; dz = dz + 1) {
    let vz = bz + dz;
    if (vz < 0 || vz >= i32(u.dim.z)) { continue; }
    for (var dy = -spanY; dy <= spanY; dy = dy + 1) {
      let vy = by + dy;
      if (vy < 0 || vy >= i32(u.dim.y)) { continue; }
      for (var dx = -spanX; dx <= spanX; dx = dx + 1) {
        let vx = bx + dx;
        if (vx < 0 || vx >= i32(u.dim.x)) { continue; }
        let offX = ((f32(vx) + 0.5) - fx) * cellX;
        let offY = ((f32(vy) + 0.5) - fy) * cellY;
        let offZ = ((f32(vz) + 0.5) - fz) * cellZ;
        let dist = length(vec3<f32>(offX, offY, offZ));
        let w = 1.0 - smoothstep(rWorld * (1.0 - soft * 0.55), rWorld, dist);
        if (w <= 0.002) { continue; }
        let idx = u32(vz) * u.dim.x * u.dim.y + u32(vy) * u.dim.x + u32(vx);
        atomicAdd(&acc[idx], u32(w * 4096.0));
      }
    }
  }
}

@compute @workgroup_size(64)
fn cs_prefix_shadow(@builtin(global_invocation_id) gid: vec3<u32>) {
  let col = gid.x;
  if (col >= u.dim.x * u.dim.y) { return; }
  let x = col % u.dim.x;
  let y = col / u.dim.x;
  let plane = u.dim.x * u.dim.y;
  var sum = 0.0;
  for (var z: u32 = 0u; z < u.dim.z; z = z + 1u) {
    let idx = z * plane + y * u.dim.x + x;
    let v = f32(atomicLoad(&acc[idx])) * (1.0 / 4096.0);
    // Half the slab's own occupancy, so a node does not fully shadow
    // itself — the classic self-shadowing bias, in volume form.
    lightDepth[idx] = sum + v * 0.5;
    sum = sum + v;
  }
}
`;
/* ============================================================== */
/* WGSL — unified ray-traced render                                */
/* ============================================================== */

const RENDER_WGSL = /* wgsl */ `
struct Particle {
  pos: vec3<f32>, radius: f32,
  vel: vec3<f32>, seed: f32,
  color: vec3<f32>, group: f32,
  rot: vec4<f32>,
};

struct Edge { a: u32, b: u32, w: f32, life: f32 };

struct RenderU {
  invViewProj:  mat4x4<f32>,
  cameraPos:    vec3<f32>, exposure:      f32,
  lightPos:     vec3<f32>, keyStrength:   f32,
  lightDir:     vec3<f32>, spotCos:       f32,
  lightColor:   vec3<f32>, spotBlend:     f32,
  fillColor:    vec3<f32>, fillStrength:  f32,
  rimColor:     vec3<f32>, rimStrength:   f32,
  fogColor:     vec3<f32>, fogDensity:    f32,
  bgColor:      vec3<f32>, bgOpacity:     f32,
  paletteA:     vec3<f32>, colorCycle:    f32,
  paletteB:     vec3<f32>, saturation:    f32,
  paletteC:     vec3<f32>, brightness:    f32,
  paletteD:     vec3<f32>, ambient:       f32,
  groundColor:  vec3<f32>, groundY:       f32,
  mediumColor:  vec3<f32>, mediumDensity: f32,
  volumeCenter: vec3<f32>, volumeRadius:  f32,
  shLightU:     vec3<f32>, shExtent:      f32,
  shLightV:     vec3<f32>, shDepth:       f32,
  shLightW:     vec3<f32>, shDensity:     f32,
  edgeColor:    vec3<f32>, edgeOpacity:   f32,
  tileCountX: u32, tileCountY: u32, tileCap: u32, edgeTileCap: u32,
  nodeCount: u32, maxEdges: u32, marchSteps: u32, maxHits: u32,
  shDimX: u32, shDimY: u32, shDimZ: u32, frameIndex: u32,
  geometry: u32, connectMode: u32, edgeColorMode: u32, tonemap: u32,
  radiusScale: f32, edgeRadius: f32, roughness: f32, metalness: f32,
  specular: f32, diffuse: f32, reflection: f32, clearCoat: f32,
  coatRoughness: f32, anisotropy: f32, mediumHeight: f32, vignette: f32,
  opacity: f32, timeSec: f32, treble: f32, bass: f32,
  lightDecay: f32, groundOn: f32, groundRough: f32, envStrength: f32,
  aoStrength: f32, roundness: f32, mediumNoise: f32, lightRange: f32,
};

@group(0) @binding(0) var<uniform>       u:          RenderU;
@group(0) @binding(1) var<storage, read> parts:      array<Particle>;
@group(0) @binding(2) var<storage, read> edges:      array<Edge>;
@group(0) @binding(3) var<storage, read> nodeCounts: array<u32>;
@group(0) @binding(4) var<storage, read> nodeItems:  array<u32>;
@group(0) @binding(5) var<storage, read> edgeCounts: array<u32>;
@group(0) @binding(6) var<storage, read> edgeItems:  array<u32>;
@group(0) @binding(7) var<storage, read> lightDepth: array<f32>;
@group(0) @binding(8) var<storage, read> edgeTotal:  array<u32>;

const VS_PI: f32 = 3.14159265359;
const VS_MISS: vec4<f32> = vec4<f32>(-1.0, 0.0, 0.0, 0.0);

struct VsHit { rgb: vec3<f32>, a: f32 };

/* ── small math ─────────────────────────────────────────────────── */

fn vsHash12(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.x, p.y, p.x) * 0.1031);
  p3 = p3 + vec3<f32>(dot(p3, p3.yzx + vec3<f32>(33.33)));
  return fract((p3.x + p3.y) * p3.z);
}

fn vsQRot(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  let t = 2.0 * cross(q.xyz, v);
  return v + q.w * t + cross(q.xyz, t);
}

fn vsQRotInv(q: vec4<f32>, v: vec3<f32>) -> vec3<f32> {
  return vsQRot(vec4<f32>(-q.xyz, q.w), v);
}

fn vsIntersectBox(ro: vec3<f32>, rd: vec3<f32>, bmin: vec3<f32>, bmax: vec3<f32>) -> vec2<f32> {
  let invD = vec3<f32>(1.0) / rd;
  let t0 = (bmin - ro) * invD;
  let t1 = (bmax - ro) * invD;
  let tmin = min(t0, t1);
  let tmax = max(t0, t1);
  return vec2<f32>(
    max(max(tmin.x, tmin.y), tmin.z),
    min(min(tmax.x, tmax.y), tmax.z),
  );
}

// Henyey-Greenstein: the forward lobe is what turns a lit haze into a
// visible BEAM when you look toward the light.
fn vsHg(cosTheta: f32, g: f32) -> f32 {
  let gg = clamp(g, -0.92, 0.92);
  let g2 = gg * gg;
  let denom = 1.0 + g2 - 2.0 * gg * cosTheta;
  return (1.0 - g2) / (4.0 * VS_PI * pow(max(denom, 1.0e-4), 1.5));
}

// Filament's numerically-hardened GGX — the textbook form loses all its
// bits in fp32 on a smooth material at grazing angles, which shows up as
// blocky highlights on exactly the glossy primitives this instrument is
// built around.
fn vsDGgx(nDotH: f32, a: f32) -> f32 {
  let a2 = nDotH * a;
  let k = a / max(1.0 - nDotH * nDotH + a2 * a2, 1.0e-8);
  return k * k * (1.0 / VS_PI);
}

// Height-correlated Smith visibility; carries the 1/(4·NoL·NoV)
// denominator, so specular is D*V*F with no further division.
fn vsVSmith(nDotV: f32, nDotL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = nDotL * sqrt(nDotV * nDotV * (1.0 - a2) + a2);
  let gl = nDotV * sqrt(nDotL * nDotL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1.0e-5);
}

// Kelemen for the clear coat: a thin smooth dielectric does not need
// the full Smith term.
fn vsVKelemen(lDotH: f32) -> f32 {
  return 0.25 / max(lDotH * lDotH, 1.0e-4);
}

fn vsFSchlick(f0: f32, cosT: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
}

fn vsFresnel(f0: vec3<f32>, cosT: f32) -> vec3<f32> {
  let f = pow(clamp(1.0 - cosT, 0.0, 1.0), 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

fn vsAces(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + vec3<f32>(b))) / (x * (c * x + vec3<f32>(d)) + vec3<f32>(e)),
               vec3<f32>(0.0), vec3<f32>(1.0));
}

// AgX — ACES' RRT skews saturated warm tones toward yellow as they
// brighten, so a hot key on a coloured node leaves the hue it started
// on. AgX desaturates toward white the way film does instead. Inset
// mixes channels before the curve (which is what stops one channel
// clipping alone and dragging the hue); outset undoes most of it after.
const VS_AGX_MID: f32 = 0.18;
const VS_AGX_TOE: f32 = 1.35;

fn vsAgxCurve(x: vec3<f32>) -> vec3<f32> {
  let shoulder = (1.0 - VS_AGX_MID) / VS_AGX_TOE;
  let c = max(x, vec3<f32>(0.0));
  let toe = vec3<f32>(VS_AGX_MID) * pow(c / VS_AGX_MID, vec3<f32>(VS_AGX_TOE));
  let d = max(c - vec3<f32>(VS_AGX_MID), vec3<f32>(0.0));
  let knee = vec3<f32>(VS_AGX_MID) + (1.0 - VS_AGX_MID) * (d / (d + vec3<f32>(shoulder)));
  return select(knee, toe, c < vec3<f32>(VS_AGX_MID));
}

fn vsAgx(x: vec3<f32>) -> vec3<f32> {
  let inset = mat3x3<f32>(
    vec3<f32>(0.544814746488245, 0.140416948464053, 0.0888104196149096),
    vec3<f32>(0.373787398372697, 0.754137554567394, 0.178871756420858),
    vec3<f32>(0.0813978551390581, 0.105445496968552, 0.732317823964232),
  );
  let outset = mat3x3<f32>(
    vec3<f32>(1.96488741169489, -0.299313364904742, -0.164352742528393),
    vec3<f32>(-0.855988495690215, 1.32639796461980, -0.238183969428088),
    vec3<f32>(-0.108898916004672, -0.0270845997150571, 1.40253671195648),
  );
  var c = inset * max(x, vec3<f32>(0.0));
  c = vsAgxCurve(c);
  c = min(vec3<f32>(1.0), c);
  return clamp(outset * c, vec3<f32>(0.0), vec3<f32>(1.0));
}

fn vsTonemap(x: vec3<f32>) -> vec3<f32> {
  if (u.tonemap == 2u) { return clamp(x, vec3<f32>(0.0), vec3<f32>(1.0)); }
  if (u.tonemap == 1u) { return vsAces(x); }
  return vsAgx(x);
}

fn vsPalette(t: f32) -> vec3<f32> {
  let x = fract(t) * 4.0;
  let idx = u32(floor(x));
  let f = fract(x);
  var c0 = u.paletteA;
  var c1 = u.paletteB;
  if (idx == 1u) { c0 = u.paletteB; c1 = u.paletteC; }
  else if (idx == 2u) { c0 = u.paletteC; c1 = u.paletteD; }
  else if (idx >= 3u) { c0 = u.paletteD; c1 = u.paletteA; }
  return mix(c0, c1, f);
}

fn vsSaturateColor(c: vec3<f32>, amount: f32) -> vec3<f32> {
  let luma = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  return mix(vec3<f32>(luma), c, amount);
}

/* ── environment ────────────────────────────────────────────────── */
// Cheap procedural studio: floor, horizon strip, sky, plus the key's own
// blob. Sampled along the reflection vector this is what makes the
// primitives read as ray traced rather than merely shaded.
fn vsEnv(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
  let ground  = u.groundColor * 0.30;
  let horizon = u.bgColor * 1.8 + vec3<f32>(0.045, 0.050, 0.062);
  let sky     = u.bgColor * 0.9 + vec3<f32>(0.012, 0.022, 0.048);
  var col = mix(ground, horizon, smoothstep(0.0, 0.5, t));
  col = mix(col, sky, smoothstep(0.5, 1.0, t));
  // A mirror needs STRUCTURE — a smooth three-band gradient has none,
  // and this is the streak that sweeps across the glossy nodes as they
  // turn.
  let band = exp(-abs(dir.y - 0.03) * 26.0) * 0.42;
  col = col + vec3<f32>(0.42, 0.44, 0.50) * band;
  let toLight = -u.lightDir;
  let blob = pow(max(dot(dir, toLight), 0.0), 72.0) * 2.6;
  let bounce = pow(max(dot(dir, u.lightDir), 0.0), 8.0) * 0.16;
  return col + u.lightColor * blob + u.fillColor * bounce;
}

/* ── light-space visibility ─────────────────────────────────────── */

fn vsShadowPlane(plane: u32, x0: u32, x1: u32, y0: u32, y1: u32, tx: f32, ty: f32) -> f32 {
  let v00 = lightDepth[plane + y0 * u.shDimX + x0];
  let v10 = lightDepth[plane + y0 * u.shDimX + x1];
  let v01 = lightDepth[plane + y1 * u.shDimX + x0];
  let v11 = lightDepth[plane + y1 * u.shDimX + x1];
  return mix(mix(v00, v10, tx), mix(v01, v11, tx), ty);
}

// The offset walks the sample point back toward the light before the
// lookup. A node's own splat sits in the volume too, so sampling at its
// surface makes every node shade ITSELF to near-black in a dense cluster;
// stepping just past its own footprint is the volume-shadow equivalent of
// a depth-map bias, and it needs no magic constant because the node's
// radius says exactly how far to step.
fn vsShadowAt(pIn: vec3<f32>, l: vec3<f32>, offset: f32) -> f32 {
  if (u.shDensity <= 0.0 || u.shDimX == 0u) { return 1.0; }
  let p = pIn + l * offset;
  let rel = p - u.volumeCenter;
  let ax = dot(rel, u.shLightU) / max(u.shExtent, 1.0e-4) * 0.5 + 0.5;
  let ay = dot(rel, u.shLightV) / max(u.shExtent, 1.0e-4) * 0.5 + 0.5;
  let az = dot(rel, u.shLightW) / max(u.shDepth, 1.0e-4) + 0.5;
  if (az < 0.0) { return 1.0; }
  // Feather the volume's own footprint. A hard in/out test leaves the
  // opacity box's RECTANGLE printed across the ground the moment the
  // beam is wide enough to reach past it.
  let fade = min(
    min(smoothstep(0.0, 0.07, ax), smoothstep(0.0, 0.07, 1.0 - ax)),
    min(smoothstep(0.0, 0.07, ay), smoothstep(0.0, 0.07, 1.0 - ay)));
  if (fade <= 0.001) { return 1.0; }
  let dx = f32(u.shDimX);
  let dy = f32(u.shDimY);
  let dz = f32(u.shDimZ);
  let fx = clamp(ax * dx - 0.5, 0.0, dx - 1.0);
  let fy = clamp(ay * dy - 0.5, 0.0, dy - 1.0);
  // Trilinear, not bilinear-plus-nearest. Sampling the light axis at the
  // nearest slab printed the voxel grid straight onto the floor as hard
  // rectangular steps; interpolating the third axis is what turns the
  // opacity volume into a smooth shadow.
  let fz = clamp(az * dz - 0.5, 0.0, dz - 1.0);
  let x0 = u32(floor(fx));
  let y0 = u32(floor(fy));
  let z0 = u32(floor(fz));
  let x1 = min(x0 + 1u, u.shDimX - 1u);
  let y1 = min(y0 + 1u, u.shDimY - 1u);
  let z1 = min(z0 + 1u, u.shDimZ - 1u);
  let tx = fx - floor(fx);
  let ty = fy - floor(fy);
  let tz = fz - floor(fz);
  let planeSize = u.shDimX * u.shDimY;
  let s0 = vsShadowPlane(z0 * planeSize, x0, x1, y0, y1, tx, ty);
  let s1 = vsShadowPlane(z1 * planeSize, x0, x1, y0, y1, tx, ty);
  let s = max(mix(s0, s1, tz), 0.0);
  return exp(-u.shDensity * s * fade);
}

// Radiance arriving at p from the key: colour * intensity, gated by the
// spot cone, the inverse-square-ish decay and the opacity volume.
fn vsLightRadiance(p: vec3<f32>, l: vec3<f32>, dist: f32, shadowOffset: f32) -> vec3<f32> {
  let cd = dot(-l, u.lightDir);
  let cone = smoothstep(u.spotCos, u.spotCos + max(u.spotBlend, 1.0e-3), cd);
  if (cone <= 0.0) { return vec3<f32>(0.0); }
  let dn = dist / max(u.lightRange, 1.0e-3);
  let att = 1.0 / (1.0 + u.lightDecay * dn * dn);
  return u.lightColor * (u.keyStrength * cone * att * vsShadowAt(p, l, shadowOffset));
}

fn vsFog(col: vec3<f32>, dist: f32) -> vec3<f32> {
  if (u.fogDensity <= 0.0) { return col; }
  let f = clamp(exp(-u.fogDensity * max(dist, 0.0)), 0.0, 1.0);
  return mix(u.fogColor * 0.9, col, f);
}

/* ── SDF primitives ─────────────────────────────────────────────── */

fn vsSdRoundBox(p: vec3<f32>, b: vec3<f32>, r: f32) -> f32 {
  let q = abs(p) - b;
  return length(max(q, vec3<f32>(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

fn vsSdOctahedron(p: vec3<f32>, s: f32) -> f32 {
  let q = abs(p);
  return (q.x + q.y + q.z - s) * 0.57735027;
}

fn vsSdCapsuleY(p: vec3<f32>, h: f32, r: f32) -> f32 {
  var q = p;
  q.y = q.y - clamp(q.y, -h, h);
  return length(q) - r;
}

fn vsSdTorus(p: vec3<f32>, tr: f32, tt: f32) -> f32 {
  let q = vec2<f32>(length(p.xz) - tr, p.y);
  return length(q) - tt;
}

fn vsSdf(kind: u32, p: vec3<f32>, r: f32, round: f32) -> f32 {
  if (kind == 2u) {
    let rr = r * (0.05 + 0.32 * clamp(round, 0.0, 1.0));
    return vsSdRoundBox(p, vec3<f32>(r * 0.60 - rr), rr);
  }
  if (kind == 3u) { return vsSdOctahedron(p, r * 0.98); }
  if (kind == 4u) { return vsSdCapsuleY(p, r * 0.54, r * 0.44); }
  if (kind == 5u) { return vsSdTorus(p, r * 0.66, r * 0.30); }
  return length(p) - r;
}

fn vsSdfNormal(kind: u32, p: vec3<f32>, r: f32, round: f32) -> vec3<f32> {
  let e = max(r * 0.006, 1.0e-5);
  let k = vec2<f32>(1.0, -1.0);
  return normalize(
      k.xyy * vsSdf(kind, p + k.xyy * e, r, round)
    + k.yyx * vsSdf(kind, p + k.yyx * e, r, round)
    + k.yxy * vsSdf(kind, p + k.yxy * e, r, round)
    + k.xxx * vsSdf(kind, p + k.xxx * e, r, round));
}

// IQ's box intersection — exact slab method with the entry-face normal
// picked out by two step() compares, no branching per axis.
fn vsRayBoxLocal(ro: vec3<f32>, rd: vec3<f32>, b: vec3<f32>) -> vec4<f32> {
  let m = vec3<f32>(1.0) / rd;
  let n = m * ro;
  let k = abs(m) * b;
  let t1 = -n - k;
  let t2 = -n + k;
  let tN = max(max(t1.x, t1.y), t1.z);
  let tF = min(min(t2.x, t2.y), t2.z);
  if (tN > tF || tF < 0.0) { return VS_MISS; }
  if (tN > 0.001) {
    let nor = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
    return vec4<f32>(tN, nor);
  }
  let nor = sign(rd) * step(t2.xyz, t2.yzx) * step(t2.xyz, t2.zxy);
  return vec4<f32>(tF, nor);
}

// IQ's capped-cylinder intersection: the quadratic in the plane
// perpendicular to the axis, plus the end-cap test.
fn vsRayCylinder(ro: vec3<f32>, rd: vec3<f32>, pa: vec3<f32>, pb: vec3<f32>, ra: f32) -> vec4<f32> {
  let ba = pb - pa;
  let oc = ro - pa;
  let baba = dot(ba, ba);
  let bard = dot(ba, rd);
  let baoc = dot(ba, oc);
  let k2 = baba - bard * bard;
  let k1 = baba * dot(oc, rd) - baoc * bard;
  let k0 = baba * dot(oc, oc) - baoc * baoc - ra * ra * baba;
  if (abs(k2) < 1.0e-9) { return VS_MISS; }
  var h = k1 * k1 - k2 * k0;
  if (h < 0.0) { return VS_MISS; }
  h = sqrt(h);
  let t = (-k1 - h) / k2;
  let y = baoc + t * bard;
  if (y > 0.0 && y < baba) {
    return vec4<f32>(t, (oc + t * rd - ba * (y / baba)) / ra);
  }
  var tc = 0.0;
  if (abs(bard) < 1.0e-9) { return VS_MISS; }
  if (y < 0.0) { tc = -baoc / bard; } else { tc = (baba - baoc) / bard; }
  if (abs(k1 + k2 * tc) < h) {
    return vec4<f32>(tc, ba * (sign(y) / sqrt(baba)));
  }
  return VS_MISS;
}

// IQ's capsule intersection — the "line" connector mode. Rounded ends
// cost nothing extra and never show at line thickness.
fn vsRayCapsule(ro: vec3<f32>, rd: vec3<f32>, pa: vec3<f32>, pb: vec3<f32>, r: f32) -> vec4<f32> {
  let ba = pb - pa;
  let oa = ro - pa;
  let baba = dot(ba, ba);
  let bard = dot(ba, rd);
  let baoa = dot(ba, oa);
  let rdoa = dot(rd, oa);
  let oaoa = dot(oa, oa);
  let a = baba - bard * bard;
  var b = baba * rdoa - baoa * bard;
  var c = baba * oaoa - baoa * baoa - r * r * baba;
  var h = b * b - a * c;
  if (h >= 0.0 && abs(a) > 1.0e-9) {
    let t = (-b - sqrt(h)) / a;
    let y = baoa + t * bard;
    if (y > 0.0 && y < baba) {
      return vec4<f32>(t, (oa + t * rd - ba * (y / baba)) / r);
    }
    var oc = oa;
    if (y > 0.0) { oc = ro - pb; }
    b = dot(rd, oc);
    c = dot(oc, oc) - r * r;
    h = b * b - c;
    if (h > 0.0) {
      let t2 = -b - sqrt(h);
      return vec4<f32>(t2, (oc + t2 * rd) / r);
    }
  }
  return VS_MISS;
}

/* ── primitive hit dispatch ─────────────────────────────────────── */

fn vsBoundT(idx: u32, ro: vec3<f32>, rd: vec3<f32>) -> f32 {
  let p = parts[idx];
  let r = max(p.radius * u.radiusScale, 1.0e-5);
  let oc = ro - p.pos;
  let b = dot(oc, rd);
  let c = dot(oc, oc) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let sq = sqrt(disc);
  var t = -b - sq;
  if (t < 0.001) { t = -b + sq; }
  return t;
}

fn vsHitNode(idx: u32, ro: vec3<f32>, rd: vec3<f32>) -> vec4<f32> {
  let p = parts[idx];
  let r = max(p.radius * u.radiusScale, 1.0e-5);
  if (u.geometry == 0u) {
    let oc = ro - p.pos;
    let b = dot(oc, rd);
    let c = dot(oc, oc) - r * r;
    let disc = b * b - c;
    if (disc < 0.0) { return VS_MISS; }
    let sq = sqrt(disc);
    var t = -b - sq;
    if (t < 0.001) { t = -b + sq; }
    if (t < 0.001) { return VS_MISS; }
    return vec4<f32>(t, (ro + rd * t - p.pos) / r);
  }
  // Everything else is solved in the node's OWN frame, so the per-node
  // random rotation is free and cubes are not all axis aligned.
  let lo = vsQRotInv(p.rot, ro - p.pos);
  let ld = vsQRotInv(p.rot, rd);
  if (u.geometry == 1u) {
    let hit = vsRayBoxLocal(lo, ld, vec3<f32>(r * 0.62));
    if (hit.x < 0.001) { return VS_MISS; }
    return vec4<f32>(hit.x, vsQRot(p.rot, hit.yzw));
  }
  // Sphere-trace inside the bounding sphere. The bound is what keeps
  // the cost per primitive fixed no matter how the SDF behaves.
  let ob = lo;
  let bq = dot(ob, ld);
  let cq = dot(ob, ob) - r * r;
  let disc = bq * bq - cq;
  if (disc < 0.0) { return VS_MISS; }
  let sq = sqrt(disc);
  let tFar = -bq + sq;
  if (tFar < 0.001) { return VS_MISS; }
  var t = max(-bq - sq, 0.001);
  var hitOk = false;
  for (var s: u32 = 0u; s < 28u; s = s + 1u) {
    let d = vsSdf(u.geometry, lo + ld * t, r, u.roundness);
    if (d < r * 0.0018) { hitOk = true; break; }
    t = t + max(d, r * 0.004);
    if (t > tFar) { break; }
  }
  if (!hitOk) { return VS_MISS; }
  let n = vsSdfNormal(u.geometry, lo + ld * t, r, u.roundness);
  return vec4<f32>(t, vsQRot(p.rot, n));
}

fn vsHitEdge(ei: u32, ro: vec3<f32>, rd: vec3<f32>) -> vec4<f32> {
  let e = edges[ei];
  if (e.a >= u.nodeCount || e.b >= u.nodeCount) { return VS_MISS; }
  let pa = parts[e.a].pos;
  let pb = parts[e.b].pos;
  let r = max(u.edgeRadius * max(e.w, 0.15), 1.0e-6);
  if (u.connectMode == 2u) { return vsRayCylinder(ro, rd, pa, pb, r); }
  return vsRayCapsule(ro, rd, pa, pb, r);
}

/* ── shading ────────────────────────────────────────────────────── */

fn vsNodeAlbedo(p: Particle) -> vec3<f32> {
  let t = p.group * 0.173 + p.seed * 0.31 + u.timeSec * u.colorCycle;
  let c = mix(p.color, vsPalette(t), 0.68);
  return max(vsSaturateColor(c, u.saturation) * u.brightness, vec3<f32>(0.0));
}

fn vsEdgeAlbedo(e: Edge, p: vec3<f32>) -> vec3<f32> {
  if (u.edgeColorMode == 0u) { return u.edgeColor; }
  let ca = vsNodeAlbedo(parts[e.a]);
  let cb = vsNodeAlbedo(parts[e.b]);
  if (u.edgeColorMode == 1u) { return mix((ca + cb) * 0.5, u.edgeColor, 0.25); }
  let pa = parts[e.a].pos;
  let ba = parts[e.b].pos - pa;
  let s = clamp(dot(p - pa, ba) / max(dot(ba, ba), 1.0e-6), 0.0, 1.0);
  return mix(mix(ca, cb, s), u.edgeColor, 0.2);
}

// IQ's cheap analytic sphere occlusion, gathered over this pixel's own
// tile bucket — the primitives overlapping the tile ARE the nearby ones,
// so the contact darkening lands where two nodes touch without any
// extra acceleration structure.
fn vsContactAO(tile: u32, p: vec3<f32>, n: vec3<f32>, skip: u32) -> f32 {
  if (u.aoStrength <= 0.0) { return 1.0; }
  let bucket = min(nodeCounts[tile], u.tileCap);
  let lim = min(bucket, 10u);
  var occ = 0.0;
  for (var b: u32 = 0u; b < lim; b = b + 1u) {
    let ni = nodeItems[tile * u.tileCap + b];
    if (ni >= u.nodeCount || ni == skip) { continue; }
    let sp = parts[ni];
    let sr = max(sp.radius * u.radiusScale, 1.0e-5);
    let di = sp.pos - p;
    let l = max(length(di), 1.0e-4);
    let nl = dot(n, di / l);
    if (nl <= 0.0) { continue; }
    let h = l / sr;
    occ = occ + nl / max(h * h, 1.0);
  }
  return clamp(1.0 - occ * u.aoStrength * 0.55, 0.12, 1.0);
}

fn vsShadeSurface(
  albedo: vec3<f32>,
  p: vec3<f32>,
  n: vec3<f32>,
  rd: vec3<f32>,
  rough: f32,
  metal: f32,
  ao: f32,
  shadowOffset: f32,
) -> vec3<f32> {
  let v = -rd;
  let nDotV = max(dot(n, v), 1.0e-4);
  let a = max(rough * rough, 0.002);
  let f0 = mix(vec3<f32>(0.04), albedo, clamp(metal, 0.0, 1.0));
  let diffAlbedo = albedo * (1.0 - clamp(metal, 0.0, 1.0));
  let coat = clamp(u.clearCoat, 0.0, 1.0);
  let coatA = max(u.coatRoughness * u.coatRoughness, 0.002);

  var lit = vec3<f32>(0.0);
  {
    let toL = u.lightPos - p;
    let dist = max(length(toL), 1.0e-4);
    let l = toL / dist;
    let h = normalize(l + v);
    let nl = max(dot(n, l), 0.0);
    let nh = max(dot(n, h), 0.0);
    let lh = max(dot(l, h), 0.0);
    let radiance = vsLightRadiance(p, l, dist, shadowOffset) * nl;
    let spec = vsDGgx(nh, a) * vsVSmith(nDotV, max(nl, 1.0e-4), a);
    let fr = vsFresnel(f0, lh);
    let fc = vsFSchlick(0.04, lh) * coat;
    let sc = vsDGgx(nh, coatA) * vsVKelemen(lh) * fc;
    lit = lit + radiance * (diffAlbedo * (u.diffuse / VS_PI) * (1.0 - fc)
      + (fr * spec * (1.0 - fc) + vec3<f32>(sc)) * u.specular);
  }
  // Hemisphere fill: sky above, bounce below. Never shadowed — bounce
  // light does not cast.
  lit = lit + diffAlbedo * u.fillColor * (u.fillStrength * (0.5 + 0.5 * n.y));
  lit = lit + diffAlbedo * u.ambient;
  // Environment mirror, obeying roughness.
  {
    let env = vsEnv(reflect(rd, n)) * u.envStrength;
    let fr = vsFresnel(f0, nDotV);
    let fc = vsFSchlick(0.04, nDotV) * coat;
    lit = lit + env * fr * (1.0 - rough * 0.72) * (1.0 - fc) * u.reflection;
    lit = lit + env * (fc * (1.0 - u.coatRoughness * 0.6)) * u.reflection;
  }
  lit = lit + u.rimColor * (u.rimStrength * pow(1.0 - nDotV, 3.0));
  return lit * ao;
}

fn vsShadeHit(t: f32, id: u32, kind: u32, n: vec3<f32>, ro: vec3<f32>, rd: vec3<f32>, tile: u32) -> VsHit {
  let p = ro + rd * t;
  let nDotV = max(dot(n, -rd), 0.0);
  var out: VsHit;
  if (kind == 0u) {
    let node = parts[id];
    let ao = vsContactAO(tile, p, n, id);
    let radius = max(node.radius * u.radiusScale, 1.0e-5);
    let cellZ = u.shDepth / f32(max(u.shDimZ, 1u));
    var col = vsShadeSurface(vsNodeAlbedo(node), p, n, rd,
      clamp(u.roughness, 0.03, 1.0), clamp(u.metalness, 0.0, 1.0), ao,
      radius * 1.25 + cellZ * 1.5);
    col = col + vec3<f32>(u.treble * 0.14 * pow(1.0 - nDotV, 2.0));
    col = vsFog(col, t);
    let op = clamp(u.opacity, 0.0, 1.0);
    // A dielectric shell covers fully at grazing incidence even when it
    // is a window face-on; that single term is most of the glass read.
    let a = select(clamp(op + (1.0 - op) * pow(1.0 - nDotV, 5.0), 0.0, 1.0), 1.0, op >= 0.999);
    out.rgb = col * a;
    out.a = a;
    return out;
  }
  let e = edges[id];
  var col = vsShadeSurface(vsEdgeAlbedo(e, p), p, n, rd, 0.26, 0.0, 1.0,
    u.edgeRadius * 1.4 + u.shDepth / f32(max(u.shDimZ, 1u)));
  col = vsFog(col, t);
  let base = clamp(u.edgeOpacity, 0.0, 1.0) * clamp(e.w, 0.0, 1.0) * clamp(e.life, 0.0, 1.0);
  let a = clamp(base + (1.0 - base) * pow(1.0 - nDotV, 4.0) * 0.65, 0.0, 1.0);
  out.rgb = col * a;
  out.a = a;
  return out;
}

/* ── participating medium ───────────────────────────────────────── */
fn vsHaze(p: vec3<f32>) -> f32 {
  let rel = (p - u.volumeCenter) / max(u.volumeRadius, 1.0e-4);
  // Graded rather than a flat ball: the beam has to fade out toward
  // the volume boundary or the cone reads as a hard grey sheet crossing
  // empty space instead of as light on something.
  var d = 1.0 - smoothstep(0.42, 1.0, length(rel));
  if (d <= 0.0) { return 0.0; }
  d = d * exp(-max(p.y - u.groundY, 0.0) * u.mediumHeight);
  if (u.mediumNoise > 0.001) {
    // Three sines instead of a hashed value noise: the march runs this
    // per step, and 8 hashed taps per step is not affordable at 1080p.
    let q = p * 1.9 + vec3<f32>(0.0, u.timeSec * 0.06, u.timeSec * 0.03);
    let nz = sin(q.x + sin(q.z * 1.3)) * sin(q.y * 1.1 + sin(q.x * 0.7)) * sin(q.z * 0.9 + sin(q.y * 1.7));
    d = d * (1.0 + nz * u.mediumNoise * 0.8);
  }
  return max(d, 0.0);
}

/* ── entry points ───────────────────────────────────────────────── */

struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) ndc: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vid: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -3.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 3.0,  1.0),
  );
  let p = positions[vid];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.ndc = p;
  return out;
}

@fragment
fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
  // ── 1. World ray for this pixel. ────────────────────────────────
  let ndc = in.ndc;
  let nearW = u.invViewProj * vec4<f32>(ndc, 0.0, 1.0);
  let farW  = u.invViewProj * vec4<f32>(ndc, 1.0, 1.0);
  let ro = nearW.xyz / nearW.w;
  let rd = normalize(farW.xyz / farW.w - ro);

  let tu = clamp(u32((ndc.x * 0.5 + 0.5) * f32(u.tileCountX)), 0u, max(u.tileCountX, 1u) - 1u);
  let tv = clamp(u32((0.5 - ndc.y * 0.5) * f32(u.tileCountY)), 0u, max(u.tileCountY, 1u) - 1u);
  let tile = tv * u.tileCountX + tu;

  // ── 2. Ground plane. It terminates every ray that reaches it, so it
  //     also bounds the haze march — which is what makes the shafts
  //     LAND on something instead of fading into nothing.
  var surfT = 1.0e30;
  if (u.groundOn > 0.5 && rd.y < -1.0e-4) {
    let tg = (u.groundY - ro.y) / rd.y;
    if (tg > 0.001 && tg < 240.0) { surfT = tg; }
  }

  // ── 3. Collect the K nearest candidates from this pixel's buckets.
  //     Nodes enter on their BOUNDING SPHERE (exact for the sphere
  //     geometry, conservative for the sphere-traced ones); edges enter
  //     already exact because the analytic cylinder/capsule is cheap.
  var hT = array<f32, ${VS_MAX_HITS}>(1.0e30, 1.0e30, 1.0e30, 1.0e30, 1.0e30, 1.0e30);
  var hI = array<u32, ${VS_MAX_HITS}>(0u, 0u, 0u, 0u, 0u, 0u);
  var hK = array<u32, ${VS_MAX_HITS}>(0u, 0u, 0u, 0u, 0u, 0u);
  var hN = array<vec3<f32>, ${VS_MAX_HITS}>(
    vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0),
    vec3<f32>(0.0), vec3<f32>(0.0), vec3<f32>(0.0),
  );
  var hCount: u32 = 0u;
  let maxHits = clamp(u.maxHits, 1u, ${VS_MAX_HITS}u);

  let nodeBucket = min(nodeCounts[tile], u.tileCap);
  for (var b: u32 = 0u; b < nodeBucket; b = b + 1u) {
    let ni = nodeItems[tile * u.tileCap + b];
    if (ni >= u.nodeCount) { continue; }
    let t = vsBoundT(ni, ro, rd);
    if (t < 0.001 || t >= surfT) { continue; }
    if (hCount >= maxHits && t >= hT[maxHits - 1u]) { continue; }
    var slot = min(hCount, maxHits - 1u);
    loop {
      if (slot == 0u) { break; }
      if (hT[slot - 1u] <= t) { break; }
      hT[slot] = hT[slot - 1u]; hI[slot] = hI[slot - 1u];
      hK[slot] = hK[slot - 1u]; hN[slot] = hN[slot - 1u];
      slot = slot - 1u;
    }
    hT[slot] = t; hI[slot] = ni; hK[slot] = 0u; hN[slot] = vec3<f32>(0.0);
    hCount = min(hCount + 1u, maxHits);
  }

  if (u.connectMode > 0u) {
    // Clamp against the count the link pass ACTUALLY emitted, not just
    // the allocation ceiling, so a tile bucket that outlived its edges
    // can never shade a stale record.
    let liveEdges = min(edgeTotal[0], u.maxEdges);
    let edgeBucket = min(edgeCounts[tile], u.edgeTileCap);
    for (var b: u32 = 0u; b < edgeBucket; b = b + 1u) {
      let ei = edgeItems[tile * u.edgeTileCap + b];
      if (ei >= liveEdges) { continue; }
      let hit = vsHitEdge(ei, ro, rd);
      let t = hit.x;
      if (t < 0.001 || t >= surfT) { continue; }
      if (hCount >= maxHits && t >= hT[maxHits - 1u]) { continue; }
      var slot = min(hCount, maxHits - 1u);
      loop {
        if (slot == 0u) { break; }
        if (hT[slot - 1u] <= t) { break; }
        hT[slot] = hT[slot - 1u]; hI[slot] = hI[slot - 1u];
        hK[slot] = hK[slot - 1u]; hN[slot] = hN[slot - 1u];
        slot = slot - 1u;
      }
      hT[slot] = t; hI[slot] = ei; hK[slot] = 1u; hN[slot] = normalize(hit.yzw);
      hCount = min(hCount + 1u, maxHits);
    }
  }

  // ── 4. Refine node candidates to their EXACT surface, then re-sort.
  //     Only the K survivors pay for a sphere trace, which is what keeps
  //     non-spherical geometry affordable.
  for (var a: u32 = 0u; a < hCount; a = a + 1u) {
    if (hK[a] != 0u) { continue; }
    let hit = vsHitNode(hI[a], ro, rd);
    if (hit.x < 0.001 || hit.x >= surfT) {
      hT[a] = 1.0e30;
    } else {
      hT[a] = hit.x;
      hN[a] = normalize(hit.yzw);
    }
  }
  for (var a: u32 = 1u; a < hCount; a = a + 1u) {
    let tv2 = hT[a];
    let iv = hI[a];
    let kv = hK[a];
    let nv = hN[a];
    var b = a;
    loop {
      if (b == 0u) { break; }
      if (hT[b - 1u] <= tv2) { break; }
      hT[b] = hT[b - 1u]; hI[b] = hI[b - 1u];
      hK[b] = hK[b - 1u]; hN[b] = hN[b - 1u];
      b = b - 1u;
    }
    hT[b] = tv2; hI[b] = iv; hK[b] = kv; hN[b] = nv;
  }
  loop {
    if (hCount == 0u) { break; }
    if (hT[hCount - 1u] < 1.0e29) { break; }
    hCount = hCount - 1u;
  }

  // ── 5. March the medium and composite the sorted hits in place.
  //     One monotonic sweep in t: whenever the march passes a hit it is
  //     composited with the transmittance accumulated SO FAR, so haze in
  //     front of a node dims it and haze behind it does not.
  var acc = vec3<f32>(0.0);
  var trans = 1.0;
  var k: u32 = 0u;

  let bmin = u.volumeCenter - vec3<f32>(u.volumeRadius);
  let bmax = u.volumeCenter + vec3<f32>(u.volumeRadius);
  let slab = vsIntersectBox(ro, rd, bmin, bmax);
  let tStart = max(slab.x, 0.0);
  let tEnd = min(slab.y, surfT);
  if (u.mediumDensity > 0.0005 && u.marchSteps > 0u && slab.y > slab.x && tEnd > tStart) {
    let steps = clamp(u.marchSteps, 4u, 128u);
    let stepLen = (tEnd - tStart) / f32(steps);
    // Golden-ratio temporal dither on the first sample, so the march
    // never bands and the residual noise averages out over frames.
    let dither = fract(vsHash12(in.pos.xy) + 0.61803398875 * f32(u.frameIndex));
    var t = tStart + stepLen * dither;
    for (var i: u32 = 0u; i < steps; i = i + 1u) {
      loop {
        if (k >= hCount) { break; }
        if (hT[k] > t) { break; }
        let sh = vsShadeHit(hT[k], hI[k], hK[k], hN[k], ro, rd, tile);
        acc = acc + trans * sh.rgb;
        trans = trans * (1.0 - sh.a);
        k = k + 1u;
      }
      if (trans < 0.004) { break; }
      let pm = ro + rd * t;
      let sigma = u.mediumDensity * vsHaze(pm);
      if (sigma > 1.0e-5) {
        let toL = u.lightPos - pm;
        let dl = max(length(toL), 1.0e-4);
        let l = toL / dl;
        // Phase NORMALISED so isotropic reads 1.0, plus a 25% isotropic
        // floor. Raw Henyey-Greenstein is correct for a single scatter,
        // but at 77 degrees off-axis (which is where a side-lit beam
        // actually lives) it is 0.025 and the shafts simply do not exist;
        // real dusty air is dominated by MULTIPLE scattering there, and
        // the floor is the cheapest honest stand-in for it. Single
        // scattering also self-limits at phase*radiance no matter how
        // dense the haze gets, so the useful range for the density knob
        // would otherwise be a sliver.
        let phase = mix(vsHg(dot(rd, l), u.anisotropy) * 12.56637061, 1.0, 0.25);
        let radiance = vsLightRadiance(pm, l, dl, 0.0);
        let stepTr = exp(-sigma * stepLen);
        let gain = 1.0 - stepTr;
        acc = acc + trans * u.mediumColor * (radiance * phase + vec3<f32>(u.ambient * 0.8)) * gain;
        trans = trans * stepTr;
      }
      t = t + stepLen;
    }
  }

  loop {
    if (k >= hCount) { break; }
    if (trans < 0.004) { break; }
    let sh = vsShadeHit(hT[k], hI[k], hK[k], hN[k], ro, rd, tile);
    acc = acc + trans * sh.rgb;
    trans = trans * (1.0 - sh.a);
    k = k + 1u;
  }

  // ── 6. Ground or sky behind everything.
  var surfRGB = vec3<f32>(0.0);
  var surfA = 0.0;
  if (trans > 0.004) {
    if (surfT < 1.0e29) {
      let gp = ro + rd * surfT;
      let gn = vec3<f32>(0.0, 1.0, 0.0);
      // Faint large-scale mottling: a perfectly flat albedo reads as a
      // card the moment a beam lands on it.
      let mott = 0.86 + 0.14 * sin(gp.x * 1.7) * sin(gp.z * 1.9);
      let ao = vsContactAO(tile, gp, gn, 0xffffffffu);
      // Jitter the shadow lookup a cell either way, per pixel and per
      // frame. The floor is where a low-resolution opacity volume shows
      // its grid, and trading a hard staircase for fine noise the eye
      // averages out is far cheaper than the resolution that would hide
      // it outright.
      let cellZ = u.shDepth / f32(max(u.shDimZ, 1u));
      let sjit = vsHash12(in.pos.xy * 1.7 + vec2<f32>(f32(u.frameIndex) * 0.37)) - 0.5;
      surfRGB = vsShadeSurface(u.groundColor * mott, gp, gn, rd,
        clamp(u.groundRough, 0.03, 1.0), 0.0, ao,
        cellZ * (1.4 + sjit * 2.2));
      surfRGB = vsFog(surfRGB, surfT);
      surfA = 1.0;
    } else {
      surfRGB = vsEnv(rd) * u.envStrength;
      surfA = clamp(u.bgOpacity, 0.0, 1.0);
    }
    acc = acc + trans * surfRGB * surfA;
    trans = trans * (1.0 - surfA);
  }

  // ── 7. Tonemap the UNPREMULTIPLIED colour so a partially covered
  //      pixel keeps a sane hue, then restore premultiplied form.
  let outA = clamp(1.0 - trans, 0.0, 1.0);
  let unpremul = acc / max(outA, 1.0e-4);
  var toned = vsTonemap(unpremul * max(u.exposure, 0.0));
  let r2 = dot(ndc, ndc);
  let vig = mix(1.0, clamp(1.0 - 0.36 * r2, 0.0, 1.0), clamp(u.vignette, 0.0, 1.0));
  toned = toned * vig;
  return vec4<f32>(toned * outA, outA);
}
`;

/* ============================================================== */
/* SHADER REGISTRY                                                 */
/* ============================================================== */

export const VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS = Object.freeze({
  sim: 'volumetric-spheres/sim',
  links: 'volumetric-spheres/links',
  tiles: 'volumetric-spheres/tiles',
  shadow: 'volumetric-spheres/shadow',
  render: 'volumetric-spheres/render',
});

/** Every shader id this instrument's native graph installs. The sync
 *  route table and the Rust manifest are checked against this list — a
 *  graph that references a shader nobody registered fails the whole
 *  route at install time. */
export const VOLUMETRIC_SPHERES_NATIVE_GRAPH_SHADER_IDS: readonly string[] = Object.freeze([
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.sim,
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.links,
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.tiles,
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.shadow,
  VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.render,
]);

export type VolumetricSpheresNativeShaderStage = 'compute' | 'render';

export interface VolumetricSpheresNativeShaderSource {
  shaderId: string;
  label: string;
  stage: VolumetricSpheresNativeShaderStage;
  entry: string;
  source: string;
}

export interface VolumetricSpheresNativePrecompileCommand {
  type: 'precompile_shader';
  shader_id: string;
  stage: VolumetricSpheresNativeShaderStage;
  entry: string;
  source: string;
}

export function getVolumetricSpheresNativeShaderSources(): VolumetricSpheresNativeShaderSource[] {
  return [
    {
      shaderId: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.sim,
      label: 'volumetric-spheres/sim',
      stage: 'compute',
      entry: 'cs_main',
      source: resolveGhostWgsl(SIM_WGSL, 'volumetric-spheres/sim'),
    },
    {
      shaderId: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.links,
      label: 'volumetric-spheres/links',
      stage: 'compute',
      entry: 'cs_build_links',
      source: resolveGhostWgsl(LINKS_WGSL, 'volumetric-spheres/links'),
    },
    {
      shaderId: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.tiles,
      label: 'volumetric-spheres/tiles',
      stage: 'compute',
      entry: 'cs_bin_nodes',
      source: resolveGhostWgsl(TILES_WGSL, 'volumetric-spheres/tiles'),
    },
    {
      shaderId: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.shadow,
      label: 'volumetric-spheres/shadow',
      stage: 'compute',
      entry: 'cs_splat_shadow',
      source: resolveGhostWgsl(SHADOW_WGSL, 'volumetric-spheres/shadow'),
    },
    {
      shaderId: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.render,
      label: 'volumetric-spheres/render',
      stage: 'render',
      entry: 'fs_main',
      source: resolveGhostWgsl(RENDER_WGSL, 'volumetric-spheres/render'),
    },
  ];
}

export function buildVolumetricSpheresNativePrecompileCommands(): VolumetricSpheresNativePrecompileCommand[] {
  return getVolumetricSpheresNativeShaderSources().map((shader) => ({
    type: 'precompile_shader',
    shader_id: shader.shaderId,
    stage: shader.stage,
    entry: shader.entry,
    source: shader.source,
  }));
}

/* ============================================================== */
/* GRAPH TYPES                                                     */
/* ============================================================== */

type VolumetricSpheresNativeGraphBinding = {
  binding: number;
  resource: string;
  kind: 'uniform' | 'storage' | 'read-only-storage';
};

type VolumetricSpheresNativeGraphBuffer = {
  id: string;
  kind: 'uniform' | 'storage' | 'read-only-storage';
  byte_length: number;
  persistent?: boolean;
  clear?: boolean;
  initial_b64?: string;
  initial_buffer?: ArrayBuffer | Uint8Array;
};

type VolumetricSpheresNativeGraphPass = {
  name: string;
  shader_id: string;
  entry: string;
  dispatch: [number, number, number];
  bindings: VolumetricSpheresNativeGraphBinding[];
};

type VolumetricSpheresNativeGraphRenderPass = {
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
  primitive?: 'triangle-list';
  vertex_count: number;
  instance_count: number;
  depth?: boolean;
  depth_write?: boolean;
  depth_compare?: 'less' | 'less-equal' | 'always';
  bindings: VolumetricSpheresNativeGraphBinding[];
};

export interface VolumetricSpheresNativeGraphState {
  layout: LayoutMode;
  sphereCount: number;
  seedKey: string;
  prevFrameTime: number;
  autoRotXPhase: number;
  autoRotYPhase: number;
  autoRotZPhase: number;
}

export interface VolumetricSpheresNativeGraphOptions {
  sourceId: string;
  params?: Partial<VolumetricSpheresParams> | Record<string, any> | null;
  width?: number;
  height?: number;
  time?: number;
  frameDelta?: number;
  frameIndex?: number;
  audioBass?: number;
  audioTreble?: number;
  state?: VolumetricSpheresNativeGraphState | null;
  reset?: boolean;
  includeSnapshot?: boolean;
}

export interface VolumetricSpheresNativeGraphBuildResult {
  config: {
    buffers: VolumetricSpheresNativeGraphBuffer[];
    passes: VolumetricSpheresNativeGraphPass[];
    render_passes: VolumetricSpheresNativeGraphRenderPass[];
    readbacks: string[];
  };
  sourceId: string;
  state: VolumetricSpheresNativeGraphState;
  sphereCount: number;
  passCount: number;
}

const BLEND_PREMULT_OVER: any = {
  color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
  alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
};

/* ============================================================== */
/* MATRIX HELPERS                                                  */
/* ============================================================== */

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

function invertMat4(m: Float32Array): Float32Array {
  const inv = new Float32Array(16);
  inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15]
    + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
  inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15]
    - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
  inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15]
    + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
  inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14]
    - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
  inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15]
    - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
  inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15]
    + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
  inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15]
    - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
  inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14]
    + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
  inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15]
    + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
  inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15]
    - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
  inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15]
    + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
  inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14]
    - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
  inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11]
    - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
  inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11]
    + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
  inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11]
    - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
  inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10]
    + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];
  const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
  if (!det) return identityMat4();
  const s = 1 / det;
  for (let i = 0; i < 16; i++) inv[i] *= s;
  return inv;
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

/* ============================================================== */
/* PARAM NORMALISATION                                             */
/* ============================================================== */

function clampFinite(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function colorParam(value: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];
  return [
    clampFinite(value[0], 0, 255, fallback[0]),
    clampFinite(value[1], 0, 255, fallback[1]),
    clampFinite(value[2], 0, 255, fallback[2]),
  ];
}

function rgb01(c: unknown, fallback: [number, number, number]): [number, number, number] {
  if (!Array.isArray(c) || c.length < 3) return fallback;
  const looksByte = Math.max(Number(c[0]) || 0, Number(c[1]) || 0, Number(c[2]) || 0) > 1.01;
  const div = looksByte ? 255 : 1;
  return [
    Math.max(0, Math.min(1, (Number(c[0]) || 0) / div)),
    Math.max(0, Math.min(1, (Number(c[1]) || 0) / div)),
    Math.max(0, Math.min(1, (Number(c[2]) || 0) / div)),
  ];
}

function enumParam<T extends string>(value: unknown, table: Record<string, number>, fallback: T): T {
  const key = String(value ?? '').trim();
  return Object.prototype.hasOwnProperty.call(table, key) ? (key as T) : fallback;
}

/** Blinn-Phong exponent → GGX roughness. Projects saved before the PBR
 *  rewrite carry `shininess` and no `roughness`; converting keeps their
 *  material read instead of snapping every one of them to the new
 *  default. */
export function volumetricSpheresShininessToRoughness(shininess: number): number {
  const s = Math.max(1, Number(shininess) || 1);
  return Math.min(1, Math.max(0.03, Math.sqrt(2 / (s + 2))));
}

const SHADOW_RES_STEPS = [32, 48, 64, 80];

function normalizeShadowRes(value: unknown): number {
  const n = clampFinite(value, 16, VS_SHADOW_DIM_MAX, 48);
  let best = SHADOW_RES_STEPS[0];
  let bestD = Infinity;
  for (const step of SHADOW_RES_STEPS) {
    const d = Math.abs(step - n);
    if (d < bestD) {
      bestD = d;
      best = step;
    }
  }
  return best;
}

export function normalizeVolumetricSpheresParams(
  input?: Partial<VolumetricSpheresParams> | Record<string, any> | null,
): VolumetricSpheresParams {
  const raw = {
    ...(volumetricSpheresParamDefaults as VolumetricSpheresParams),
    ...(input ?? {}),
  } as Record<string, any>;
  const hasLegacyGloss = (input as any)
    && (input as any).roughness === undefined
    && (input as any).shininess !== undefined;
  return {
    geometry: enumParam<GeometryMode>(raw.geometry, GEOMETRY_ID, 'sphere'),
    layout: enumParam<LayoutMode>(raw.layout, LAYOUT_ID, 'cluster'),
    sphereCount: Math.round(clampFinite(raw.sphereCount, MIN_SPHERES, MAX_SPHERES, 260)),
    radiusScale: clampFinite(raw.radiusScale, 0.001, 2, 0.058),
    radiusVariance: clampFinite(raw.radiusVariance, 0, 4, 0.6),
    roundness: clampFinite(raw.roundness, 0, 1, 0.45),
    spinRate: clampFinite(raw.spinRate, 0, 16, 0.5),
    spread: clampFinite(raw.spread, 0.01, 16, 1.2),
    depth: clampFinite(raw.depth, 0.01, 16, 1.3),

    connectMode: enumParam<ConnectMode>(raw.connectMode, CONNECT_ID, 'cylinder'),
    connectDistance: clampFinite(raw.connectDistance, 0.01, 8, 0.45),
    maxLinks: Math.round(clampFinite(raw.maxLinks, 0, VS_MAX_LINKS, 4)),
    edgeThickness: clampFinite(raw.edgeThickness, 0.0002, 0.5, 0.011),
    edgeOpacity: clampFinite(raw.edgeOpacity, 0, 1, 0.7),
    edgeColorMode: enumParam<EdgeColorMode>(raw.edgeColorMode, EDGE_COLOR_ID, 'gradient'),
    edgeColor: colorParam(raw.edgeColor, [150, 205, 255]),
    edgeFade: clampFinite(raw.edgeFade, 0, 1, 0.55),

    motion: clampFinite(raw.motion, 0, 16, 0.7),
    swirl: clampFinite(raw.swirl, -16, 16, 0.42),
    pull: clampFinite(raw.pull, -16, 16, 0.34),
    chaos: clampFinite(raw.chaos, 0, 16, 0.38),
    damping: clampFinite(raw.damping, 0, 32, 1.55),
    separation: clampFinite(raw.separation, 0, 8, 0.65),
    flowScale: clampFinite(raw.flowScale, 0.05, 16, 1.15),

    colorA: colorParam(raw.colorA, [70, 170, 255]),
    colorB: colorParam(raw.colorB, [255, 78, 166]),
    colorC: colorParam(raw.colorC, [255, 218, 94]),
    colorD: colorParam(raw.colorD, [84, 255, 214]),
    colorCycle: clampFinite(raw.colorCycle, -16, 16, 0.018),
    saturation: clampFinite(raw.saturation, 0, 8, 1.3),
    brightness: clampFinite(raw.brightness, 0, 16, 1.08),

    opacity: clampFinite(raw.opacity, 0, 1, 1),
    roughness: hasLegacyGloss
      ? volumetricSpheresShininessToRoughness(Number(raw.shininess))
      : clampFinite(raw.roughness, 0.03, 1, 0.22),
    metalness: clampFinite(raw.metalness, 0, 1, 0.15),
    diffuse: clampFinite(raw.diffuse, 0, 8, 1.5),
    specular: clampFinite(raw.specular, 0, 16, 1.4),
    reflection: clampFinite(raw.reflection, 0, 8, 0.45),
    clearCoat: clampFinite(raw.clearCoat, 0, 1, 0.4),
    coatRoughness: clampFinite(raw.coatRoughness, 0.03, 1, 0.1),
    rim: clampFinite(raw.rim, 0, 8, 0.35),
    aoStrength: clampFinite(raw.aoStrength, 0, 8, 0.85),

    lightX: clampFinite(raw.lightX, -16, 16, -0.72),
    lightY: clampFinite(raw.lightY, -16, 16, 1.22),
    lightZ: clampFinite(raw.lightZ, -16, 16, -0.22),
    lightDistance: clampFinite(raw.lightDistance, 0.2, 64, 5.5),
    lightStrength: clampFinite(raw.lightStrength, 0, 32, 4.2),
    lightColor: colorParam(raw.lightColor, [255, 238, 214]),
    spotAngle: clampFinite(raw.spotAngle, 2, 180, 34),
    spotSoftness: clampFinite(raw.spotSoftness, 0.005, 2, 0.85),
    lightDecay: clampFinite(raw.lightDecay, 0, 16, 0.5),
    ambient: clampFinite(raw.ambient, 0, 8, 0.09),
    fillColor: colorParam(raw.fillColor, [86, 122, 178]),
    fillStrength: clampFinite(raw.fillStrength, 0, 8, 0.5),
    rimColor: colorParam(raw.rimColor, [150, 200, 255]),

    mediumDensity: clampFinite(raw.mediumDensity, 0, 16, 0.5),
    mediumColor: colorParam(raw.mediumColor, [214, 226, 255]),
    anisotropy: clampFinite(raw.anisotropy, -0.95, 0.95, 0.55),
    mediumHeight: clampFinite(raw.mediumHeight, 0, 16, 0.2),
    mediumNoise: clampFinite(raw.mediumNoise, 0, 4, 0.5),
    shadowDensity: clampFinite(raw.shadowDensity, 0, 32, 6.5),
    marchSteps: Math.round(clampFinite(raw.marchSteps, 4, 128, 40)),
    shadowRes: normalizeShadowRes(raw.shadowRes),
    sphereHits: Math.round(clampFinite(raw.sphereHits, 1, VS_MAX_HITS, 3)),

    fogDensity: clampFinite(raw.fogDensity, 0, 16, 0.16),
    fogColor: colorParam(raw.fogColor, [12, 16, 30]),
    backgroundOpacity: clampFinite(raw.backgroundOpacity, 0, 1, 1),
    exposure: clampFinite(raw.exposure, 0.01, 16, 1.05),
    tonemap: enumParam<TonemapMode>(raw.tonemap, TONEMAP_ID, 'agx'),
    vignette: clampFinite(raw.vignette, 0, 1, 0.55),
    envStrength: clampFinite(raw.envStrength, 0, 8, 0.6),

    groundEnabled: typeof raw.groundEnabled === 'boolean' ? raw.groundEnabled : true,
    groundHeight: clampFinite(raw.groundHeight, -16, 16, -1.55),
    groundColor: colorParam(raw.groundColor, [40, 44, 54]),
    groundRoughness: clampFinite(raw.groundRoughness, 0.03, 1, 0.38),

    audioReactive: typeof raw.audioReactive === 'boolean' ? raw.audioReactive : true,
    bassPulse: clampFinite(raw.bassPulse, 0, 16, 1.05),
    trebleSparkle: clampFinite(raw.trebleSparkle, 0, 16, 0.32),

    fovDeg: clampFinite(raw.fovDeg, 1, 160, 46),
    cameraZ: clampFinite(raw.cameraZ, 0.05, 100, 3.8),
    rotateX: clampFinite(raw.rotateX, -3600, 3600, 10),
    rotateY: clampFinite(raw.rotateY, -3600, 3600, 0),
    rotateZ: clampFinite(raw.rotateZ, -3600, 3600, 0),
    autoRotateX: clampFinite(raw.autoRotateX, -3600, 3600, 0),
    autoRotateY: clampFinite(raw.autoRotateY, -3600, 3600, 4),
    autoRotateZ: clampFinite(raw.autoRotateZ, -3600, 3600, 0),
    clearBackground: raw.clearBackground !== false,
  };
}

/* ============================================================== */
/* DERIVED SCENE LAYOUT — mirrored exactly in Rust                 */
/* ============================================================== */

interface VolumetricSpheresScene {
  bounds: [number, number, number];
  volumeRadius: number;
  gridDim: [number, number, number];
  gridCellCount: number;
  gridMin: [number, number, number];
  cellSize: number;
  maxEdges: number;
  lightPos: [number, number, number];
  /** Unit vector pointing FROM the light INTO the scene. */
  lightDir: [number, number, number];
  shU: [number, number, number];
  shV: [number, number, number];
  shExtent: number;
  shDepth: number;
  shadowDim: number;
  shadowCells: number;
}

function normalize3(v: [number, number, number], fallback: [number, number, number]): [number, number, number] {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!(len > 1e-6)) return fallback;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function volumetricSpheresScene(params: VolumetricSpheresParams, count: number): VolumetricSpheresScene {
  const bounds: [number, number, number] = [
    Math.max(0.2, params.spread * 1.24),
    Math.max(0.2, params.spread * 0.92),
    Math.max(0.2, params.depth * 1.16),
  ];
  const maxBound = Math.max(bounds[0], bounds[1], bounds[2]);
  const volumeRadius = Math.max(maxBound * 1.28, Math.abs(params.groundHeight) * 1.08, 0.4);

  // The cell must never be smaller than the connect distance — that is
  // exactly the invariant that makes the 27-cell gather in `cs_build_links`
  // complete, and therefore the whole neighbour search O(N).
  const gridExtent: [number, number, number] = [bounds[0] * 1.06, bounds[1] * 1.06, bounds[2] * 1.06];
  const cellSize = Math.max(
    params.connectDistance,
    (2 * Math.max(gridExtent[0], gridExtent[1], gridExtent[2])) / VS_GRID_DIM,
    1e-3,
  );
  const gridDim: [number, number, number] = [
    Math.max(1, Math.min(VS_GRID_DIM, Math.ceil((2 * gridExtent[0]) / cellSize))),
    Math.max(1, Math.min(VS_GRID_DIM, Math.ceil((2 * gridExtent[1]) / cellSize))),
    Math.max(1, Math.min(VS_GRID_DIM, Math.ceil((2 * gridExtent[2]) / cellSize))),
  ];
  const gridMin: [number, number, number] = [-gridExtent[0], -gridExtent[1], -gridExtent[2]];

  const lightAxis = normalize3([params.lightX, params.lightY, params.lightZ], [-0.62, 1.05, 0.72]);
  const lightPos: [number, number, number] = [
    lightAxis[0] * params.lightDistance,
    lightAxis[1] * params.lightDistance,
    lightAxis[2] * params.lightDistance,
  ];
  const lightDir: [number, number, number] = [-lightAxis[0], -lightAxis[1], -lightAxis[2]];
  const up: [number, number, number] = Math.abs(lightDir[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
  const shU = normalize3(cross3(up, lightDir), [1, 0, 0]);
  const shV = normalize3(cross3(lightDir, shU), [0, 1, 0]);

  const shadowDim = Math.max(8, Math.min(VS_SHADOW_DIM_MAX, Math.round(params.shadowRes)));
  return {
    bounds,
    volumeRadius,
    gridDim,
    gridCellCount: gridDim[0] * gridDim[1] * gridDim[2],
    gridMin,
    cellSize,
    maxEdges: Math.max(1, count * Math.max(1, params.maxLinks)),
    lightPos,
    lightDir,
    shU,
    shV,
    shExtent: volumeRadius * 1.1,
    shDepth: volumeRadius * 2.9,
    shadowDim,
    shadowCells: shadowDim * shadowDim * shadowDim,
  };
}

/* ============================================================== */
/* SEEDING                                                         */
/* ============================================================== */

function sphereHash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function randomUnit(a: number, b: number, c: number): [number, number, number] {
  const theta = a * Math.PI * 2;
  const z = b * 2 - 1;
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  const squash = 0.72 + c * 0.36;
  return [Math.cos(theta) * r, z * squash, Math.sin(theta) * r];
}

function volumetricSpheresSeedKey(params: VolumetricSpheresParams, count: number): string {
  return [
    count,
    params.layout,
    params.radiusVariance,
    params.spread,
    params.depth,
    params.colorA?.join(','),
    params.colorB?.join(','),
    params.colorC?.join(','),
    params.colorD?.join(','),
  ].join('|');
}

export function buildVolumetricSpheresInitialBuffer(params: VolumetricSpheresParams, count: number): ArrayBuffer {
  const sphereCount = Math.max(MIN_SPHERES, Math.min(MAX_SPHERES, Math.round(count)));
  const floats = new Float32Array(sphereCount * SPHERE_STRIDE_FLOATS);
  const layout = params.layout ?? 'cluster';
  const colors = [
    rgb01(params.colorA, [0.28, 0.66, 1]),
    rgb01(params.colorB, [1, 0.31, 0.65]),
    rgb01(params.colorC, [1, 0.86, 0.37]),
    rgb01(params.colorD, [0.33, 1, 0.84]),
  ];
  for (let i = 0; i < sphereCount; i++) {
    const seed = sphereHash(i * 17.13 + 9.7);
    const seed2 = sphereHash(i * 43.91 + 2.3);
    const seed3 = sphereHash(i * 71.17 + 5.9);
    let x = 0;
    let y = 0;
    let z = 0;
    if (layout === 'orbital') {
      const ring = i % 5;
      const a = (i / Math.max(1, sphereCount) * Math.PI * 2 * (2.5 + ring * 0.23)) + seed * Math.PI * 2;
      const r = 0.24 + ring * 0.17 + seed2 * 0.18;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r * (0.74 + seed3 * 0.32);
      y = (ring - 2) * 0.12 + (seed2 - 0.5) * 0.18;
    } else if (layout === 'column') {
      const a = seed * Math.PI * 2;
      const r = Math.pow(seed2, 0.65) * 0.52;
      x = Math.cos(a) * r;
      z = Math.sin(a) * r * 0.7;
      y = (i / Math.max(1, sphereCount - 1) - 0.5) * 1.8 + (seed3 - 0.5) * 0.18;
    } else if (layout === 'cavern') {
      const dir = randomUnit(seed, seed2, seed3);
      const shell = 0.62 + Math.pow(seed, 2.0) * 0.3;
      x = dir[0] * shell;
      y = dir[1] * shell * 0.72;
      z = dir[2] * shell;
    } else if (layout === 'lattice') {
      // Cube-root packing, so the node graph starts as a readable grid
      // and the connectors immediately draw the lattice.
      const side = Math.max(2, Math.ceil(Math.pow(sphereCount, 1 / 3)));
      const ix = i % side;
      const iy = Math.floor(i / side) % side;
      const iz = Math.floor(i / (side * side)) % side;
      const step = 1.6 / Math.max(1, side - 1);
      x = (ix * step - 0.8) + (seed - 0.5) * step * 0.22;
      y = (iy * step - 0.8) * 0.78 + (seed2 - 0.5) * step * 0.22;
      z = (iz * step - 0.8) + (seed3 - 0.5) * step * 0.22;
    } else {
      const dir = randomUnit(seed, seed2, seed3);
      const r = Math.pow(sphereHash(i * 11.31 + 4.2), 0.42);
      x = dir[0] * r;
      y = dir[1] * r * 0.76;
      z = dir[2] * r;
    }

    const radiusJitter = 0.55 + Math.pow(sphereHash(i * 29.71 + 1.1), 1.8) * (0.65 + params.radiusVariance * 1.75);
    const c = colors[i % colors.length];
    // Deterministic per-node orientation, so cubes and capsules never
    // line up into an obviously synthetic grid.
    // Shoemake's uniform random rotation: guaranteed unit norm, and
    // genuinely uniform over SO(3) rather than clustered on an axis.
    const qu = sphereHash(i * 13.51 + 2.2);
    const qa = sphereHash(i * 5.37 + 0.9) * Math.PI * 2;
    const qb = sphereHash(i * 8.19 + 3.1) * Math.PI * 2;
    const s1 = Math.sqrt(1 - qu);
    const s2 = Math.sqrt(qu);
    const off = i * SPHERE_STRIDE_FLOATS;
    floats[off + 0] = x * params.spread;
    floats[off + 1] = y * params.spread;
    floats[off + 2] = z * params.depth;
    floats[off + 3] = radiusJitter;
    floats[off + 4] = (seed2 - 0.5) * 0.04;
    floats[off + 5] = (seed3 - 0.5) * 0.04;
    floats[off + 6] = (seed - 0.5) * 0.04;
    floats[off + 7] = seed;
    floats[off + 8] = c[0];
    floats[off + 9] = c[1];
    floats[off + 10] = c[2];
    floats[off + 11] = i % 16;
    floats[off + 12] = s1 * Math.sin(qa);
    floats[off + 13] = s1 * Math.cos(qa);
    floats[off + 14] = s2 * Math.sin(qb);
    floats[off + 15] = s2 * Math.cos(qb);
  }
  return floats.buffer;
}

/* ============================================================== */
/* UNIFORM PACKERS — byte-identical twins live in Rust             */
/* ============================================================== */

export function packVolumetricSpheresSimUniform(
  params: VolumetricSpheresParams,
  scene: VolumetricSpheresScene,
  count: number,
  dt: number,
  time: number,
  bass: number,
  treble: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(SIM_UNIFORM_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  f[0] = dt;
  f[1] = time;
  u[2] = count >>> 0;
  u[3] = LAYOUT_ID[params.layout] >>> 0;
  f[4] = scene.bounds[0];
  f[5] = scene.bounds[1];
  f[6] = scene.bounds[2];
  f[7] = params.motion;
  f[8] = params.swirl;
  f[9] = params.pull;
  f[10] = 0.65 + params.chaos * 0.75;
  f[11] = params.damping;
  f[12] = bass;
  f[13] = treble;
  f[14] = params.bassPulse;
  f[15] = params.chaos;
  u[16] = scene.gridDim[0] >>> 0;
  u[17] = scene.gridDim[1] >>> 0;
  u[18] = scene.gridDim[2] >>> 0;
  u[19] = VS_GRID_CAP >>> 0;
  f[20] = scene.gridMin[0];
  f[21] = scene.gridMin[1];
  f[22] = scene.gridMin[2];
  f[23] = scene.cellSize;
  f[24] = params.separation;
  f[25] = params.spinRate;
  f[26] = params.radiusScale;
  f[27] = params.flowScale;
  return buf;
}

export function packVolumetricSpheresLinkUniform(
  params: VolumetricSpheresParams,
  scene: VolumetricSpheresScene,
  count: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(LINK_UNIFORM_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  u[0] = count >>> 0;
  u[1] = VS_GRID_CAP >>> 0;
  u[2] = (params.connectMode === 'off' ? 0 : params.maxLinks) >>> 0;
  u[3] = scene.maxEdges >>> 0;
  u[4] = scene.gridDim[0] >>> 0;
  u[5] = scene.gridDim[1] >>> 0;
  u[6] = scene.gridDim[2] >>> 0;
  u[7] = scene.gridCellCount >>> 0;
  f[8] = scene.gridMin[0];
  f[9] = scene.gridMin[1];
  f[10] = scene.gridMin[2];
  f[11] = scene.cellSize;
  f[12] = params.connectDistance;
  f[13] = params.connectDistance * 0.72;
  f[14] = params.radiusScale;
  f[15] = params.edgeFade;
  return buf;
}

export function packVolumetricSpheresBinUniform(
  params: VolumetricSpheresParams,
  scene: VolumetricSpheresScene,
  viewProj: Float32Array,
  tileCountX: number,
  tileCountY: number,
  count: number,
  aspect: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(BIN_UNIFORM_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  f.set(viewProj, 0);
  u[16] = tileCountX >>> 0;
  u[17] = tileCountY >>> 0;
  u[18] = VS_TILE_CAP >>> 0;
  u[19] = count >>> 0;
  u[20] = VS_EDGE_TILE_CAP >>> 0;
  u[21] = scene.maxEdges >>> 0;
  f[22] = 1 / Math.tan((params.fovDeg * Math.PI / 180) / 2);
  f[23] = aspect;
  // Bin on the node's BOUNDING sphere, with a little slack so a
  // sphere-traced primitive never gets culled out of a tile it touches.
  f[24] = params.radiusScale * 1.08;
  f[25] = params.edgeThickness * 1.35;
  u[26] = GEOMETRY_ID[params.geometry] >>> 0;
  f[27] = 0;
  return buf;
}

export function packVolumetricSpheresShadowUniform(
  params: VolumetricSpheresParams,
  scene: VolumetricSpheresScene,
  count: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(SHADOW_UNIFORM_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  f[0] = scene.shU[0];
  f[1] = scene.shU[1];
  f[2] = scene.shU[2];
  f[3] = scene.shExtent;
  f[4] = scene.shV[0];
  f[5] = scene.shV[1];
  f[6] = scene.shV[2];
  f[7] = scene.shDepth;
  f[8] = scene.lightDir[0];
  f[9] = scene.lightDir[1];
  f[10] = scene.lightDir[2];
  u[11] = scene.shadowCells >>> 0;
  f[12] = 0;
  f[13] = 0;
  f[14] = 0;
  u[15] = count >>> 0;
  u[16] = scene.shadowDim >>> 0;
  u[17] = scene.shadowDim >>> 0;
  u[18] = scene.shadowDim >>> 0;
  f[19] = params.radiusScale;
  f[20] = params.shadowDensity;
  u[21] = GEOMETRY_ID[params.geometry] >>> 0;
  f[22] = 0.55;
  f[23] = 0;
  return buf;
}

export function packVolumetricSpheresRenderUniform(
  params: VolumetricSpheresParams,
  scene: VolumetricSpheresScene,
  invViewProj: Float32Array,
  cameraPos: [number, number, number],
  tileCountX: number,
  tileCountY: number,
  count: number,
  frameIndex: number,
  time: number,
  bass: number,
  treble: number,
): ArrayBuffer {
  const buf = new ArrayBuffer(RENDER_UNIFORM_BYTES);
  const f = new Float32Array(buf);
  const u = new Uint32Array(buf);
  const fog = rgb01(params.fogColor, [0.05, 0.06, 0.12]);
  const colorA = rgb01(params.colorA, [0.28, 0.66, 1]);
  const colorB = rgb01(params.colorB, [1, 0.31, 0.65]);
  const colorC = rgb01(params.colorC, [1, 0.86, 0.37]);
  const colorD = rgb01(params.colorD, [0.33, 1, 0.84]);
  const lightColor = rgb01(params.lightColor, [1, 0.93, 0.84]);
  const fillColor = rgb01(params.fillColor, [0.34, 0.48, 0.7]);
  const rimColor = rgb01(params.rimColor, [0.59, 0.78, 1]);
  const edgeColor = rgb01(params.edgeColor, [0.59, 0.8, 1]);
  const groundColor = rgb01(params.groundColor, [0.16, 0.17, 0.21]);
  const mediumColor = rgb01(params.mediumColor, [0.84, 0.89, 1]);
  const spotCos = Math.cos(Math.min(179.5, params.spotAngle) * 0.5 * Math.PI / 180);

  f.set(invViewProj, 0);
  f[16] = cameraPos[0];
  f[17] = cameraPos[1];
  f[18] = cameraPos[2];
  f[19] = params.exposure;
  f[20] = scene.lightPos[0];
  f[21] = scene.lightPos[1];
  f[22] = scene.lightPos[2];
  f[23] = params.lightStrength * (1 + bass * 0.22);
  f[24] = scene.lightDir[0];
  f[25] = scene.lightDir[1];
  f[26] = scene.lightDir[2];
  f[27] = spotCos;
  f[28] = lightColor[0];
  f[29] = lightColor[1];
  f[30] = lightColor[2];
  // The blend is measured in COSINE units and must stay inside the cone:
  // a wider blend than (1 - spotCos) pushes the smoothstep's upper edge
  // past cos 0, so the beam never reaches full intensity anywhere and the
  // whole scene reads as underlit.
  f[31] = Math.min(0.95, params.spotSoftness) * (1 - spotCos) + 0.002;
  f[32] = fillColor[0];
  f[33] = fillColor[1];
  f[34] = fillColor[2];
  f[35] = params.fillStrength;
  f[36] = rimColor[0];
  f[37] = rimColor[1];
  f[38] = rimColor[2];
  f[39] = params.rim;
  f[40] = fog[0];
  f[41] = fog[1];
  f[42] = fog[2];
  f[43] = params.fogDensity;
  f[44] = fog[0];
  f[45] = fog[1];
  f[46] = fog[2];
  f[47] = params.backgroundOpacity;
  f[48] = colorA[0];
  f[49] = colorA[1];
  f[50] = colorA[2];
  f[51] = params.colorCycle;
  f[52] = colorB[0];
  f[53] = colorB[1];
  f[54] = colorB[2];
  f[55] = params.saturation;
  f[56] = colorC[0];
  f[57] = colorC[1];
  f[58] = colorC[2];
  f[59] = params.brightness;
  f[60] = colorD[0];
  f[61] = colorD[1];
  f[62] = colorD[2];
  f[63] = params.ambient;
  f[64] = groundColor[0];
  f[65] = groundColor[1];
  f[66] = groundColor[2];
  f[67] = params.groundHeight;
  f[68] = mediumColor[0];
  f[69] = mediumColor[1];
  f[70] = mediumColor[2];
  f[71] = params.mediumDensity;
  f[72] = 0;
  f[73] = 0;
  f[74] = 0;
  f[75] = scene.volumeRadius;
  f[76] = scene.shU[0];
  f[77] = scene.shU[1];
  f[78] = scene.shU[2];
  f[79] = scene.shExtent;
  f[80] = scene.shV[0];
  f[81] = scene.shV[1];
  f[82] = scene.shV[2];
  f[83] = scene.shDepth;
  f[84] = scene.lightDir[0];
  f[85] = scene.lightDir[1];
  f[86] = scene.lightDir[2];
  f[87] = params.shadowDensity;
  f[88] = edgeColor[0];
  f[89] = edgeColor[1];
  f[90] = edgeColor[2];
  f[91] = params.edgeOpacity;
  u[92] = tileCountX >>> 0;
  u[93] = tileCountY >>> 0;
  u[94] = VS_TILE_CAP >>> 0;
  u[95] = VS_EDGE_TILE_CAP >>> 0;
  u[96] = count >>> 0;
  u[97] = scene.maxEdges >>> 0;
  u[98] = params.marchSteps >>> 0;
  u[99] = params.sphereHits >>> 0;
  u[100] = scene.shadowDim >>> 0;
  u[101] = scene.shadowDim >>> 0;
  u[102] = scene.shadowDim >>> 0;
  u[103] = (frameIndex >>> 0) % 4096;
  u[104] = GEOMETRY_ID[params.geometry] >>> 0;
  u[105] = CONNECT_ID[params.connectMode] >>> 0;
  u[106] = EDGE_COLOR_ID[params.edgeColorMode] >>> 0;
  u[107] = TONEMAP_ID[params.tonemap] >>> 0;
  f[108] = params.radiusScale;
  f[109] = params.edgeThickness;
  f[110] = params.roughness;
  f[111] = params.metalness;
  f[112] = params.specular;
  f[113] = params.diffuse;
  f[114] = params.reflection;
  f[115] = params.clearCoat;
  f[116] = params.coatRoughness;
  f[117] = params.anisotropy;
  f[118] = params.mediumHeight;
  f[119] = params.vignette;
  f[120] = params.opacity;
  f[121] = time;
  f[122] = treble;
  f[123] = bass;
  f[124] = params.lightDecay;
  f[125] = params.groundEnabled ? 1 : 0;
  f[126] = params.groundRoughness;
  f[127] = params.envStrength;
  f[128] = params.aoStrength;
  f[129] = params.roundness;
  f[130] = params.mediumNoise;
  f[131] = params.lightDistance;
  return buf;
}

/* ============================================================== */
/* CAMERA                                                          */
/* ============================================================== */

interface VolumetricSpheresCamera {
  viewProj: Float32Array;
  invViewProj: Float32Array;
  cameraPos: [number, number, number];
  aspect: number;
}

function volumetricSpheresCamera(
  params: VolumetricSpheresParams,
  rotX: number,
  rotY: number,
  rotZ: number,
  width: number,
  height: number,
): VolumetricSpheresCamera {
  const aspect = Math.max(0.05, Math.max(1, width) / Math.max(1, height));
  const d2r = Math.PI / 180;
  const proj = perspective(params.fovDeg, aspect, 0.05, 120);
  const view = translate(0, 0, -params.cameraZ);
  // Yaw FIRST, then pitch, then roll. The other order spins the pitch
  // axis with the yaw, so an auto-spinning scene rolls its own horizon
  // over — which is exactly what stops a grounded look reading as a
  // place rather than a floating card.
  const model = mat4Mul(
    rotateZMat((params.rotateZ + rotZ) * d2r),
    mat4Mul(
      rotateXMat((params.rotateX + rotX) * d2r),
      rotateYMat((params.rotateY + rotY) * d2r),
    ),
  );
  const viewProj = mat4Mul(proj, mat4Mul(view, model));
  // Rays are built in MODEL space, so the auto-spin orbits the camera
  // around a scene whose ground and light stay put — which is the whole
  // point of grounding the look.
  const cameraPos: [number, number, number] = [
    model[2] * params.cameraZ,
    model[6] * params.cameraZ,
    model[10] * params.cameraZ,
  ];
  return { viewProj, invViewProj: invertMat4(viewProj), cameraPos, aspect };
}

/* ============================================================== */
/* NATIVE GRAPH BUILDER                                            */
/* ============================================================== */

function volumetricSpheresInitialState(
  params: VolumetricSpheresParams,
  count: number,
  time: number,
  seedKey: string,
): VolumetricSpheresNativeGraphState {
  return {
    layout: params.layout,
    sphereCount: count,
    seedKey,
    prevFrameTime: time,
    autoRotXPhase: 0,
    autoRotYPhase: 0,
    autoRotZPhase: 0,
  };
}

function sanitizeVolumetricSpheresGraphId(value: string): string {
  return String(value || 'source').replace(/[^a-zA-Z0-9:_-]+/g, '_').slice(0, 160);
}

export function buildVolumetricSpheresNativeComputeGraph(
  options: VolumetricSpheresNativeGraphOptions,
): VolumetricSpheresNativeGraphBuildResult {
  const params = normalizeVolumetricSpheresParams(options.params);
  const sphereCount = Math.max(MIN_SPHERES, Math.min(MAX_SPHERES, Math.round(params.sphereCount)));
  const time = Math.max(0, Number.isFinite(options.time) ? Number(options.time) : 0);
  const seedKey = volumetricSpheresSeedKey(params, sphereCount);
  const mustReset = !!options.reset
    || !options.state
    || options.state.sphereCount !== sphereCount
    || options.state.layout !== params.layout
    || options.state.seedKey !== seedKey;
  const state = mustReset
    ? volumetricSpheresInitialState(params, sphereCount, time, seedKey)
    : { ...options.state! };
  let dt = typeof options.frameDelta === 'number' && Number.isFinite(options.frameDelta)
    ? options.frameDelta
    : (state.prevFrameTime === 0 ? 1 / 60 : time - state.prevFrameTime);
  dt = Math.min(Math.max(dt, 0), 1 / 15);
  state.prevFrameTime = time;
  state.autoRotXPhase += params.autoRotateX * dt;
  state.autoRotYPhase += params.autoRotateY * dt;
  state.autoRotZPhase += params.autoRotateZ * dt;

  const reactive = !!params.audioReactive;
  const bass = reactive ? Math.min(2, clampFinite(options.audioBass, 0, 2, 0) * params.bassPulse) : 0;
  const treble = reactive ? Math.min(2, clampFinite(options.audioTreble, 0, 2, 0) * params.trebleSparkle) : 0;

  const sourceId = String(options.sourceId || 'volumetric-spheres-native-source');
  const width = Math.max(1, Math.round(options.width || 1920));
  const height = Math.max(1, Math.round(options.height || 1080));
  const frameIndex = Math.max(0, Math.round(options.frameIndex ?? 0));
  const scene = volumetricSpheresScene(params, sphereCount);
  const cam = volumetricSpheresCamera(
    params, state.autoRotXPhase, state.autoRotYPhase, state.autoRotZPhase, width, height,
  );
  const tileCountX = Math.max(1, Math.ceil(width / VS_TILE_SIZE));
  const tileCountY = Math.max(1, Math.ceil(height / VS_TILE_SIZE));
  const tileCount = tileCountX * tileCountY;
  const linksActive = params.connectMode !== 'off' && params.maxLinks > 0;

  const prefix = `volumetric-spheres:${sanitizeVolumetricSpheresGraphId(sourceId)}`;
  const uid = (name: string) => `${prefix}:${name}`;
  const nid = (name: string) => `${prefix}:n${sphereCount}:${name}`;
  const tid = (name: string) => `${prefix}:t${tileCountX}x${tileCountY}:${name}`;

  const buffers: VolumetricSpheresNativeGraphBuffer[] = [
    {
      id: uid('sim-uniform'),
      kind: 'uniform',
      byte_length: SIM_UNIFORM_BYTES,
      initial_b64: bufferToBase64(
        packVolumetricSpheresSimUniform(params, scene, sphereCount, dt, time, bass, treble),
      ),
    },
    {
      id: uid('link-uniform'),
      kind: 'uniform',
      byte_length: LINK_UNIFORM_BYTES,
      initial_b64: bufferToBase64(packVolumetricSpheresLinkUniform(params, scene, sphereCount)),
    },
    {
      id: uid('bin-uniform'),
      kind: 'uniform',
      byte_length: BIN_UNIFORM_BYTES,
      initial_b64: bufferToBase64(packVolumetricSpheresBinUniform(
        params, scene, cam.viewProj, tileCountX, tileCountY, sphereCount, cam.aspect,
      )),
    },
    {
      id: uid('shadow-uniform'),
      kind: 'uniform',
      byte_length: SHADOW_UNIFORM_BYTES,
      initial_b64: bufferToBase64(packVolumetricSpheresShadowUniform(params, scene, sphereCount)),
    },
    {
      id: uid('render-uniform'),
      kind: 'uniform',
      byte_length: RENDER_UNIFORM_BYTES,
      initial_b64: bufferToBase64(packVolumetricSpheresRenderUniform(
        params, scene, cam.invViewProj, cam.cameraPos,
        tileCountX, tileCountY, sphereCount, frameIndex, time, bass, treble,
      )),
    },
    {
      id: nid('spheres'),
      kind: 'storage',
      byte_length: sphereCount * SPHERE_STRIDE_FLOATS * 4,
      persistent: true,
      clear: mustReset,
      initial_buffer: mustReset ? buildVolumetricSpheresInitialBuffer(params, sphereCount) : undefined,
    },
    { id: uid('grid-counts'), kind: 'storage', byte_length: VS_GRID_CELLS * 4, persistent: true, clear: mustReset },
    { id: uid('grid-items'), kind: 'storage', byte_length: VS_GRID_CELLS * VS_GRID_CAP * 4, persistent: true, clear: mustReset },
    { id: nid('edges'), kind: 'storage', byte_length: scene.maxEdges * 16, persistent: true, clear: mustReset },
    { id: uid('edge-count'), kind: 'storage', byte_length: 16, persistent: true, clear: mustReset },
    { id: tid('node-tile-counts'), kind: 'storage', byte_length: tileCount * 4, persistent: true, clear: mustReset },
    { id: tid('node-tile-items'), kind: 'storage', byte_length: tileCount * VS_TILE_CAP * 4, persistent: true, clear: mustReset },
    { id: tid('edge-tile-counts'), kind: 'storage', byte_length: tileCount * 4, persistent: true, clear: mustReset },
    { id: tid('edge-tile-items'), kind: 'storage', byte_length: tileCount * VS_EDGE_TILE_CAP * 4, persistent: true, clear: mustReset },
    { id: uid('shadow-acc'), kind: 'storage', byte_length: VS_SHADOW_CELLS_MAX * 4, persistent: true, clear: mustReset },
    { id: uid('shadow-depth'), kind: 'storage', byte_length: VS_SHADOW_CELLS_MAX * 4, persistent: true, clear: mustReset },
  ];

  const nodeDispatch: [number, number, number] = [Math.max(1, Math.ceil(sphereCount / 64)), 1, 1];
  const passes: VolumetricSpheresNativeGraphPass[] = [];
  const addPass = (
    name: string,
    shaderId: string,
    entry: string,
    dispatch: [number, number, number],
    bindings: VolumetricSpheresNativeGraphBinding[],
  ) => {
    passes.push({ name, shader_id: shaderId, entry, dispatch, bindings });
  };

  const simBindings: VolumetricSpheresNativeGraphBinding[] = [
    { binding: 0, resource: nid('spheres'), kind: 'storage' },
    { binding: 1, resource: uid('sim-uniform'), kind: 'uniform' },
    { binding: 2, resource: uid('grid-counts'), kind: 'read-only-storage' },
    { binding: 3, resource: uid('grid-items'), kind: 'read-only-storage' },
  ];
  const linkBindings: VolumetricSpheresNativeGraphBinding[] = [
    { binding: 0, resource: uid('link-uniform'), kind: 'uniform' },
    { binding: 1, resource: nid('spheres'), kind: 'read-only-storage' },
    { binding: 2, resource: uid('grid-counts'), kind: 'storage' },
    { binding: 3, resource: uid('grid-items'), kind: 'storage' },
    { binding: 4, resource: nid('edges'), kind: 'storage' },
    { binding: 5, resource: uid('edge-count'), kind: 'storage' },
  ];
  const binBindings: VolumetricSpheresNativeGraphBinding[] = [
    { binding: 0, resource: uid('bin-uniform'), kind: 'uniform' },
    { binding: 1, resource: nid('spheres'), kind: 'read-only-storage' },
    { binding: 2, resource: nid('edges'), kind: 'read-only-storage' },
    { binding: 3, resource: tid('node-tile-counts'), kind: 'storage' },
    { binding: 4, resource: tid('node-tile-items'), kind: 'storage' },
    { binding: 5, resource: tid('edge-tile-counts'), kind: 'storage' },
    { binding: 6, resource: tid('edge-tile-items'), kind: 'storage' },
    { binding: 7, resource: uid('edge-count'), kind: 'read-only-storage' },
  ];
  const shadowBindings: VolumetricSpheresNativeGraphBinding[] = [
    { binding: 0, resource: uid('shadow-uniform'), kind: 'uniform' },
    { binding: 1, resource: nid('spheres'), kind: 'read-only-storage' },
    { binding: 2, resource: uid('shadow-acc'), kind: 'storage' },
    { binding: 3, resource: uid('shadow-depth'), kind: 'storage' },
  ];

  // The sim reads LAST frame's grid, so the grid rebuild has to follow
  // it; that ordering is what keeps separation to one bounded gather.
  addPass('volumetric-spheres-sim', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.sim, 'cs_main', nodeDispatch, simBindings);
  addPass('volumetric-spheres-clear-grid', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.links, 'cs_clear_grid',
    [Math.max(1, Math.ceil(scene.gridCellCount / 64)), 1, 1], linkBindings);
  addPass('volumetric-spheres-bin-grid', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.links, 'cs_bin_particles',
    nodeDispatch, linkBindings);
  if (linksActive) {
    addPass('volumetric-spheres-links', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.links, 'cs_build_links',
      nodeDispatch, linkBindings);
  }
  addPass('volumetric-spheres-clear-tiles', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.tiles, 'cs_clear_tiles',
    [Math.max(1, Math.ceil(tileCount / 64)), 1, 1], binBindings);
  addPass('volumetric-spheres-bin-nodes', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.tiles, 'cs_bin_nodes',
    nodeDispatch, binBindings);
  if (linksActive) {
    addPass('volumetric-spheres-bin-edges', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.tiles, 'cs_bin_edges',
      [Math.max(1, Math.ceil(scene.maxEdges / 64)), 1, 1], binBindings);
  }
  addPass('volumetric-spheres-clear-shadow', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.shadow, 'cs_clear_shadow',
    [Math.max(1, Math.ceil(scene.shadowCells / 64)), 1, 1], shadowBindings);
  addPass('volumetric-spheres-splat-shadow', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.shadow, 'cs_splat_shadow',
    nodeDispatch, shadowBindings);
  addPass('volumetric-spheres-prefix-shadow', VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.shadow, 'cs_prefix_shadow',
    [Math.max(1, Math.ceil((scene.shadowDim * scene.shadowDim) / 64)), 1, 1], shadowBindings);

  const renderPasses: VolumetricSpheresNativeGraphRenderPass[] = [{
    name: 'volumetric-spheres-render',
    shader_id: VOLUMETRIC_SPHERES_NATIVE_SHADER_IDS.render,
    vertex_entry: 'vs_main',
    fragment_entry: 'fs_main',
    target: 'source_frame',
    source_id: sourceId,
    seq: frameIndex,
    clear: true,
    clear_color: [0, 0, 0, 0],
    include_snapshot: !!options.includeSnapshot,
    blend: 'alpha',
    primitive: 'triangle-list',
    vertex_count: 3,
    instance_count: 1,
    bindings: [
      { binding: 0, resource: uid('render-uniform'), kind: 'uniform' },
      { binding: 1, resource: nid('spheres'), kind: 'read-only-storage' },
      { binding: 2, resource: nid('edges'), kind: 'read-only-storage' },
      { binding: 3, resource: tid('node-tile-counts'), kind: 'read-only-storage' },
      { binding: 4, resource: tid('node-tile-items'), kind: 'read-only-storage' },
      { binding: 5, resource: tid('edge-tile-counts'), kind: 'read-only-storage' },
      { binding: 6, resource: tid('edge-tile-items'), kind: 'read-only-storage' },
      { binding: 7, resource: uid('shadow-depth'), kind: 'read-only-storage' },
      { binding: 8, resource: uid('edge-count'), kind: 'read-only-storage' },
    ],
  }];

  return {
    config: {
      buffers,
      passes,
      render_passes: renderPasses,
      readbacks: [],
    },
    sourceId,
    state,
    sphereCount,
    passCount: passes.length + renderPasses.length,
  };
}

/* ============================================================== */
/* BROWSER WEBGPU PATH                                             */
/* ============================================================== */
// The native compute graph above is the real instrument. This drives the
// identical pass chain through the in-browser WebGPU device, reusing the
// SAME uniform packers so the two can never drift.

export class WebGPUVolumetricSpheresShader implements GpuShaderImpl {
  private device: any;
  private presentFormat: any;
  private simPipeline: any = null;
  private clearGridPipeline: any = null;
  private binGridPipeline: any = null;
  private linksPipeline: any = null;
  private clearTilesPipeline: any = null;
  private binNodesPipeline: any = null;
  private binEdgesPipeline: any = null;
  private clearShadowPipeline: any = null;
  private splatShadowPipeline: any = null;
  private prefixShadowPipeline: any = null;
  private renderPipeline: any = null;
  private simLayout: any = null;
  private linkLayout: any = null;
  private binLayout: any = null;
  private shadowLayout: any = null;
  private renderLayout: any = null;
  private simBindGroup: any = null;
  private linkBindGroup: any = null;
  private binBindGroup: any = null;
  private shadowBindGroup: any = null;
  private renderBindGroup: any = null;

  private sphereBuffer: any = null;
  private edgeBuffer: any = null;
  private edgeCountBuffer: any = null;
  private gridCounts: any = null;
  private gridItems: any = null;
  private nodeTileCounts: any = null;
  private nodeTileItems: any = null;
  private edgeTileCounts: any = null;
  private edgeTileItems: any = null;
  private shadowAcc: any = null;
  private shadowDepth: any = null;
  private simUniform: any = null;
  private linkUniform: any = null;
  private binUniform: any = null;
  private shadowUniform: any = null;
  private renderUniform: any = null;

  private params: VolumetricSpheresParams = normalizeVolumetricSpheresParams(null);
  private sphereCount = 0;
  private maxEdges = 0;
  private tileCountX = 0;
  private tileCountY = 0;
  private viewportW = 1;
  private viewportH = 1;
  private bands = { bass: 0, mid: 0, treble: 0 };
  private rotXPhase = 0;
  private rotYPhase = 0;
  private rotZPhase = 0;
  private frameIndex = 0;
  private lastSeedKey = '';

  constructor(device: any, presentFormat: any) {
    this.device = device;
    this.presentFormat = presentFormat;

    const uniform = (size: number) => this.device.createBuffer({
      size,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.simUniform = uniform(SIM_UNIFORM_BYTES);
    this.linkUniform = uniform(LINK_UNIFORM_BYTES);
    this.binUniform = uniform(BIN_UNIFORM_BYTES);
    this.shadowUniform = uniform(SHADOW_UNIFORM_BYTES);
    this.renderUniform = uniform(RENDER_UNIFORM_BYTES);

    const storage = (size: number) => this.device.createBuffer({
      size: Math.max(16, size),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.gridCounts = storage(VS_GRID_CELLS * 4);
    this.gridItems = storage(VS_GRID_CELLS * VS_GRID_CAP * 4);
    this.edgeCountBuffer = storage(16);
    this.shadowAcc = storage(VS_SHADOW_CELLS_MAX * 4);
    this.shadowDepth = storage(VS_SHADOW_CELLS_MAX * 4);

    this.buildPipelines();
    this.allocateSpheres(this.params.sphereCount);
    this.ensureTiles(1920, 1080);
  }

  setBands(bass: number, mid: number, treble: number): void {
    this.bands.bass = this.bands.bass * 0.82 + bass * 0.18;
    this.bands.mid = this.bands.mid * 0.82 + mid * 0.18;
    this.bands.treble = this.bands.treble * 0.82 + treble * 0.18;
  }

  setParams(params: Record<string, any>): void {
    const next = normalizeVolumetricSpheresParams({ ...this.params, ...params });
    next.clearBackground = params.clearBackground ?? this.params.clearBackground ?? true;
    const count = this.clampCount(next.sphereCount);
    const seedKey = volumetricSpheresSeedKey(next, count);
    const prevLinks = this.params.maxLinks;
    this.params = next;
    if (count !== this.sphereCount || next.maxLinks !== prevLinks) {
      this.allocateSpheres(count);
    } else if (seedKey !== this.lastSeedKey) {
      this.seedSpheres();
    }
  }

  resize(width: number, height: number): void {
    this.viewportW = Math.max(1, width | 0);
    this.viewportH = Math.max(1, height | 0);
  }

  encodeFrame(
    encoder: any,
    targetView: any,
    _format: any,
    width: number,
    height: number,
    dt: number,
    time?: number,
  ): void {
    this.resize(width, height);
    this.ensureTiles(this.viewportW, this.viewportH);
    const frameDt = Number.isFinite(dt) ? Math.min(Math.max(dt, 0), 1 / 15) : 1 / 60;
    const now = typeof time === 'number' && Number.isFinite(time) ? Math.max(0, time) : performance.now() / 1000;
    const p = this.params;
    const reactive = !!p.audioReactive;
    const bass = reactive ? Math.min(2, this.bands.bass * p.bassPulse) : 0;
    const treble = reactive ? Math.min(2, this.bands.treble * p.trebleSparkle) : 0;

    this.rotXPhase += p.autoRotateX * frameDt;
    this.rotYPhase += p.autoRotateY * frameDt;
    this.rotZPhase += p.autoRotateZ * frameDt;
    this.frameIndex = (this.frameIndex + 1) % 4096;

    const scene = volumetricSpheresScene(p, this.sphereCount);
    const cam = volumetricSpheresCamera(
      p, this.rotXPhase, this.rotYPhase, this.rotZPhase, this.viewportW, this.viewportH,
    );
    const q = this.device.queue;
    q.writeBuffer(this.simUniform, 0,
      packVolumetricSpheresSimUniform(p, scene, this.sphereCount, frameDt, now, bass, treble));
    q.writeBuffer(this.linkUniform, 0,
      packVolumetricSpheresLinkUniform(p, scene, this.sphereCount));
    q.writeBuffer(this.binUniform, 0, packVolumetricSpheresBinUniform(
      p, scene, cam.viewProj, this.tileCountX, this.tileCountY, this.sphereCount, cam.aspect));
    q.writeBuffer(this.shadowUniform, 0,
      packVolumetricSpheresShadowUniform(p, scene, this.sphereCount));
    q.writeBuffer(this.renderUniform, 0, packVolumetricSpheresRenderUniform(
      p, scene, cam.invViewProj, cam.cameraPos,
      this.tileCountX, this.tileCountY, this.sphereCount, this.frameIndex, now, bass, treble));

    const linksActive = p.connectMode !== 'off' && p.maxLinks > 0;
    const nodeGroups = Math.max(1, Math.ceil(this.sphereCount / 64));
    const tileGroups = Math.max(1, Math.ceil((this.tileCountX * this.tileCountY) / 64));

    const pass = encoder.beginComputePass();
    pass.setPipeline(this.simPipeline);
    pass.setBindGroup(0, this.simBindGroup);
    pass.dispatchWorkgroups(nodeGroups);

    pass.setBindGroup(0, this.linkBindGroup);
    pass.setPipeline(this.clearGridPipeline);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(scene.gridCellCount / 64)));
    pass.setPipeline(this.binGridPipeline);
    pass.dispatchWorkgroups(nodeGroups);
    if (linksActive) {
      pass.setPipeline(this.linksPipeline);
      pass.dispatchWorkgroups(nodeGroups);
    }

    pass.setBindGroup(0, this.binBindGroup);
    pass.setPipeline(this.clearTilesPipeline);
    pass.dispatchWorkgroups(tileGroups);
    pass.setPipeline(this.binNodesPipeline);
    pass.dispatchWorkgroups(nodeGroups);
    if (linksActive) {
      pass.setPipeline(this.binEdgesPipeline);
      pass.dispatchWorkgroups(Math.max(1, Math.ceil(this.maxEdges / 64)));
    }

    pass.setBindGroup(0, this.shadowBindGroup);
    pass.setPipeline(this.clearShadowPipeline);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil(scene.shadowCells / 64)));
    pass.setPipeline(this.splatShadowPipeline);
    pass.dispatchWorkgroups(nodeGroups);
    pass.setPipeline(this.prefixShadowPipeline);
    pass.dispatchWorkgroups(Math.max(1, Math.ceil((scene.shadowDim * scene.shadowDim) / 64)));
    pass.end();

    const shouldClear = this.params.clearBackground !== false;
    const render = encoder.beginRenderPass({
      colorAttachments: [{
        view: targetView,
        loadOp: shouldClear ? 'clear' : 'load',
        clearValue: shouldClear ? { r: 0, g: 0, b: 0, a: 0 } : undefined,
        storeOp: 'store',
      }],
    });
    render.setPipeline(this.renderPipeline);
    render.setBindGroup(0, this.renderBindGroup);
    render.draw(3, 1, 0, 0);
    render.end();
  }

  dispose(): void {
    const kill = (b: any) => { try { b?.destroy?.(); } catch { /* noop */ } };
    kill(this.sphereBuffer);
    kill(this.edgeBuffer);
    kill(this.edgeCountBuffer);
    kill(this.gridCounts);
    kill(this.gridItems);
    kill(this.nodeTileCounts);
    kill(this.nodeTileItems);
    kill(this.edgeTileCounts);
    kill(this.edgeTileItems);
    kill(this.shadowAcc);
    kill(this.shadowDepth);
    kill(this.simUniform);
    kill(this.linkUniform);
    kill(this.binUniform);
    kill(this.shadowUniform);
    kill(this.renderUniform);
    this.sphereBuffer = null;
    this.edgeBuffer = null;
    this.nodeTileCounts = null;
  }

  private buildPipelines(): void {
    const runtime = getGhostGpuRuntime() ?? this.device;
    const simModule = createAndWarmWgslShaderModule(runtime, SIM_WGSL, 'volumetric-spheres/sim');
    const linkModule = createAndWarmWgslShaderModule(runtime, LINKS_WGSL, 'volumetric-spheres/links');
    const tileModule = createAndWarmWgslShaderModule(runtime, TILES_WGSL, 'volumetric-spheres/tiles');
    const shadowModule = createAndWarmWgslShaderModule(runtime, SHADOW_WGSL, 'volumetric-spheres/shadow');
    const renderModule = createAndWarmWgslShaderModule(runtime, RENDER_WGSL, 'volumetric-spheres/render');

    const c = GPUShaderStage.COMPUTE;
    const entry = (binding: number, visibility: number, type: string) => ({
      binding, visibility, buffer: { type },
    });
    this.simLayout = this.device.createBindGroupLayout({
      entries: [
        entry(0, c, 'storage'),
        entry(1, c, 'uniform'),
        entry(2, c, 'read-only-storage'),
        entry(3, c, 'read-only-storage'),
      ],
    });
    this.linkLayout = this.device.createBindGroupLayout({
      entries: [
        entry(0, c, 'uniform'),
        entry(1, c, 'read-only-storage'),
        entry(2, c, 'storage'),
        entry(3, c, 'storage'),
        entry(4, c, 'storage'),
        entry(5, c, 'storage'),
      ],
    });
    this.binLayout = this.device.createBindGroupLayout({
      entries: [
        entry(0, c, 'uniform'),
        entry(1, c, 'read-only-storage'),
        entry(2, c, 'read-only-storage'),
        entry(3, c, 'storage'),
        entry(4, c, 'storage'),
        entry(5, c, 'storage'),
        entry(6, c, 'storage'),
        entry(7, c, 'read-only-storage'),
      ],
    });
    this.shadowLayout = this.device.createBindGroupLayout({
      entries: [
        entry(0, c, 'uniform'),
        entry(1, c, 'read-only-storage'),
        entry(2, c, 'storage'),
        entry(3, c, 'storage'),
      ],
    });
    const f = GPUShaderStage.FRAGMENT;
    this.renderLayout = this.device.createBindGroupLayout({
      entries: [
        entry(0, f, 'uniform'),
        entry(1, f, 'read-only-storage'),
        entry(2, f, 'read-only-storage'),
        entry(3, f, 'read-only-storage'),
        entry(4, f, 'read-only-storage'),
        entry(5, f, 'read-only-storage'),
        entry(6, f, 'read-only-storage'),
        entry(7, f, 'read-only-storage'),
        entry(8, f, 'read-only-storage'),
      ],
    });

    const compute = (layout: any, module: any, entryPoint: string) => this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module, entryPoint },
    });
    this.simPipeline = compute(this.simLayout, simModule, 'cs_main');
    this.clearGridPipeline = compute(this.linkLayout, linkModule, 'cs_clear_grid');
    this.binGridPipeline = compute(this.linkLayout, linkModule, 'cs_bin_particles');
    this.linksPipeline = compute(this.linkLayout, linkModule, 'cs_build_links');
    this.clearTilesPipeline = compute(this.binLayout, tileModule, 'cs_clear_tiles');
    this.binNodesPipeline = compute(this.binLayout, tileModule, 'cs_bin_nodes');
    this.binEdgesPipeline = compute(this.binLayout, tileModule, 'cs_bin_edges');
    this.clearShadowPipeline = compute(this.shadowLayout, shadowModule, 'cs_clear_shadow');
    this.splatShadowPipeline = compute(this.shadowLayout, shadowModule, 'cs_splat_shadow');
    this.prefixShadowPipeline = compute(this.shadowLayout, shadowModule, 'cs_prefix_shadow');

    this.renderPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.renderLayout] }),
      vertex: { module: renderModule, entryPoint: 'vs_main' },
      fragment: {
        module: renderModule,
        entryPoint: 'fs_main',
        targets: [{ format: this.presentFormat, blend: BLEND_PREMULT_OVER }],
      },
      primitive: { topology: 'triangle-list' },
      multisample: { count: RENDER_SAMPLE_COUNT },
    });
  }

  private allocateSpheres(count: number): void {
    this.sphereCount = this.clampCount(count);
    this.maxEdges = Math.max(1, this.sphereCount * Math.max(1, this.params.maxLinks));
    try { this.sphereBuffer?.destroy?.(); } catch { /* noop */ }
    try { this.edgeBuffer?.destroy?.(); } catch { /* noop */ }
    this.sphereBuffer = this.device.createBuffer({
      size: this.sphereCount * SPHERE_STRIDE_FLOATS * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.edgeBuffer = this.device.createBuffer({
      size: Math.max(16, this.maxEdges * 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.rebuildBindGroups();
    this.seedSpheres();
  }

  private ensureTiles(width: number, height: number): void {
    const tx = Math.max(1, Math.ceil(width / VS_TILE_SIZE));
    const ty = Math.max(1, Math.ceil(height / VS_TILE_SIZE));
    if (tx === this.tileCountX && ty === this.tileCountY && this.nodeTileCounts) return;
    this.tileCountX = tx;
    this.tileCountY = ty;
    const tiles = tx * ty;
    const kill = (b: any) => { try { b?.destroy?.(); } catch { /* noop */ } };
    kill(this.nodeTileCounts);
    kill(this.nodeTileItems);
    kill(this.edgeTileCounts);
    kill(this.edgeTileItems);
    const storage = (size: number) => this.device.createBuffer({
      size: Math.max(16, size),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.nodeTileCounts = storage(tiles * 4);
    this.nodeTileItems = storage(tiles * VS_TILE_CAP * 4);
    this.edgeTileCounts = storage(tiles * 4);
    this.edgeTileItems = storage(tiles * VS_EDGE_TILE_CAP * 4);
    this.rebuildBindGroups();
  }

  private rebuildBindGroups(): void {
    if (!this.sphereBuffer || !this.nodeTileCounts) return;
    const buf = (b: any) => ({ buffer: b });
    this.simBindGroup = this.device.createBindGroup({
      layout: this.simLayout,
      entries: [
        { binding: 0, resource: buf(this.sphereBuffer) },
        { binding: 1, resource: buf(this.simUniform) },
        { binding: 2, resource: buf(this.gridCounts) },
        { binding: 3, resource: buf(this.gridItems) },
      ],
    });
    this.linkBindGroup = this.device.createBindGroup({
      layout: this.linkLayout,
      entries: [
        { binding: 0, resource: buf(this.linkUniform) },
        { binding: 1, resource: buf(this.sphereBuffer) },
        { binding: 2, resource: buf(this.gridCounts) },
        { binding: 3, resource: buf(this.gridItems) },
        { binding: 4, resource: buf(this.edgeBuffer) },
        { binding: 5, resource: buf(this.edgeCountBuffer) },
      ],
    });
    this.binBindGroup = this.device.createBindGroup({
      layout: this.binLayout,
      entries: [
        { binding: 0, resource: buf(this.binUniform) },
        { binding: 1, resource: buf(this.sphereBuffer) },
        { binding: 2, resource: buf(this.edgeBuffer) },
        { binding: 3, resource: buf(this.nodeTileCounts) },
        { binding: 4, resource: buf(this.nodeTileItems) },
        { binding: 5, resource: buf(this.edgeTileCounts) },
        { binding: 6, resource: buf(this.edgeTileItems) },
        { binding: 7, resource: buf(this.edgeCountBuffer) },
      ],
    });
    this.shadowBindGroup = this.device.createBindGroup({
      layout: this.shadowLayout,
      entries: [
        { binding: 0, resource: buf(this.shadowUniform) },
        { binding: 1, resource: buf(this.sphereBuffer) },
        { binding: 2, resource: buf(this.shadowAcc) },
        { binding: 3, resource: buf(this.shadowDepth) },
      ],
    });
    this.renderBindGroup = this.device.createBindGroup({
      layout: this.renderLayout,
      entries: [
        { binding: 0, resource: buf(this.renderUniform) },
        { binding: 1, resource: buf(this.sphereBuffer) },
        { binding: 2, resource: buf(this.edgeBuffer) },
        { binding: 3, resource: buf(this.nodeTileCounts) },
        { binding: 4, resource: buf(this.nodeTileItems) },
        { binding: 5, resource: buf(this.edgeTileCounts) },
        { binding: 6, resource: buf(this.edgeTileItems) },
        { binding: 7, resource: buf(this.shadowDepth) },
        { binding: 8, resource: buf(this.edgeCountBuffer) },
      ],
    });
  }

  private seedSpheres(): void {
    if (!this.sphereBuffer || this.sphereCount <= 0) return;
    const data = buildVolumetricSpheresInitialBuffer(this.params, this.sphereCount);
    this.device.queue.writeBuffer(this.sphereBuffer, 0, data);
    this.device.queue.writeBuffer(this.edgeCountBuffer, 0, new Uint32Array(4));
    this.lastSeedKey = volumetricSpheresSeedKey(this.params, this.sphereCount);
  }

  private clampCount(value: number): number {
    return Math.max(MIN_SPHERES, Math.min(MAX_SPHERES, Math.round(Number(value) || 0)));
  }
}

