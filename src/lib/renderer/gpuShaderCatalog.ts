/**
 * gpuShaderCatalog — registry of WebGPU shaders available inside
 * a gpu layer. Each entry is metadata + factory + param schema.
 * The panel renders the shader-picker dropdown from this catalog;
 * the runner uses `create` to instantiate.
 *
 * Adding a new shader is a one-stop edit:
 *   1. Implement GpuShaderImpl in src/lib/renderer/shaders/your.ts
 *   2. Export an entry below with a unique `id`, label, schema
 *   3. Done — UI + lifecycle are handled by the runner.
 */

import type { GpuShaderDef, GpuShaderQualityApplyResult, GpuShaderQualityContext, GpuShaderQualityTierBudget } from './gpuShaderTypes';
import { GHOST_GPU_QUALITY_PROFILES, type GhostGpuQualityTier } from './gpuCaps';
import { WebGPUPlanet, planetParamSchema, planetParamDefaults, prewarmWebGPUPlanet } from './shaders/webgpuPlanet';
import { WebGPUPixelParticlesShader, pixelParticlesParamSchema, pixelParticlesParamDefaults } from './shaders/webgpuPixelParticlesShader';
import { WebGPUFlythroughShader, flythroughParamSchema, flythroughParamDefaults } from './shaders/webgpuFlythroughShader';
import { WebGPUPointCloudFXShader, pointCloudFXParamSchema, pointCloudFXParamDefaults } from './shaders/webgpuPointCloudFXShader';
import { WebGPUParticleFieldShader, particleFieldParamSchema, particleFieldParamDefaults } from './shaders/webgpuParticleFieldShader';
import { WebGPUVolumetricSpheresShader, volumetricSpheresParamSchema, volumetricSpheresParamDefaults } from './shaders/webgpuVolumetricSpheresShader';
import { WebGPUInkCloudShader, inkCloudParamSchema, inkCloudParamDefaults } from './shaders/webgpuInkCloudShader';
// Fluid Smoke removed from catalog — overlapped with Ink Cloud.
// The shader file remains on disk for now as dead code; can clean up
// later if we're sure we won't bring it back.
import { WebGPU3DSmokeShader, smoke3DParamSchema, smoke3DParamDefaults } from './shaders/webgpu3DSmokeShader';
import {
  WebGPUSmokeRidersShader,
  smokeRidersParamSchema,
  smokeRidersParamDefaults,
  smokeRidersQualityResolution,
  type SmokeRidersQualityLevel,
} from './shaders/webgpuSmokeRidersShader';
import { WebGPUFluidRidersShader, fluidRidersParamSchema, fluidRidersParamDefaults } from './shaders/webgpuFluidRidersShader';
import { WebGPUWarpLoom, warpLoomParamSchema, warpLoomParamDefaults } from './shaders/webgpuWarpLoom';

const PLANET_DEF: GpuShaderDef = {
  id: 'planet',
  label: 'Planet',
  description: 'Ray-traced procedural planet — Earth, Mars, Jupiter, Saturn. Volumetric clouds, polar aurora, atmosphere, star field, Milky Way, and Saturn rings, all generated in one fragment shader.',
  category: 'Generative',
  paramSchema: planetParamSchema,
  defaultParams: planetParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUPlanet(device, presentFormat),
  prewarm: prewarmWebGPUPlanet,
};

const PIXEL_PARTICLES_DEF: GpuShaderDef = {
  id: 'pixel-particles',
  label: 'Pixel Particles',
  description: 'Source image/video point-cloud shader. Pulls depth from luminance, inverse luma, edges, or saturation while keeping each particle color pinned to its source pixel. Smooth drift, orbit, ripple, swarm, and breathing motion styles make photo/video clouds move cleanly without losing the picture.',
  category: 'Source-driven',
  paramSchema: pixelParticlesParamSchema,
  defaultParams: pixelParticlesParamDefaults,
  needsSource: true,
  create: (device, presentFormat) => new WebGPUPixelParticlesShader(device, presentFormat),
};

// Flythrough — endless point-cloud tunnel of the source. Camera flies
// forward through N replicated slabs continuously; particles inside
// each slab swirl under a curl-noise velocity field. Optional worm-
// stroke topology (quads extruded along velocity) for the volumetric
// brush-stroke look.
const FLYTHROUGH_DEF: GpuShaderDef = {
  id: 'flythrough',
  label: 'Flythrough',
  description: 'Endless tunnel of the source image / video: replicated into N slabs along Z, with the camera continuously flying through them. Particles swirl under curl-noise flow. Toggle between billboard points and worm-stroke topology for two distinct looks.',
  category: 'Source-driven',
  paramSchema: flythroughParamSchema,
  defaultParams: flythroughParamDefaults,
  needsSource: true,
  create: (device, presentFormat) => new WebGPUFlythroughShader(device, presentFormat),
};

// Point Cloud FX — load a .ply or .splat into a living TouchDesigner-
// style instrument. Bass-triggered radial burst, curl-noise wind,
// treble shimmer, a moving "proximity wave" sphere that pushes points
// outward, dissolve radius, hue/sat/brightness, three topologies
// (points / billboards / worm strokes). Source = file picker; the
// runner detects .ply/.splat by extension and dispatches into a
// dedicated ArrayBuffer path instead of the image/video texture path.
const POINTCLOUD_FX_DEF: GpuShaderDef = {
  id: 'point-cloud-fx',
  label: 'Point Cloud FX',
  description: 'Drop a .ply or .splat. Audio-reactive bass bursts, curl-noise wind, orbiting proximity waves, dissolve, hue cycling, and named gesture filters: drift, swarm, scan slice, contours, signal rift, prism split, and fog veil. Worm-stroke topology gives the volumetric brush look as the cloud breathes.',
  category: 'Source-driven',
  paramSchema: pointCloudFXParamSchema,
  defaultParams: pointCloudFXParamDefaults,
  needsSource: true,
  create: (device, presentFormat) => new WebGPUPointCloudFXShader(device, presentFormat),
};

// Particle Field — the everything-bagel particle shader. Six visible
// behavior modes (galaxy / atomic / swarm / lattice / field / gravity),
// five topologies (points / glow / streaks / sphere / soft spheres),
// GPU-side nearest-neighbor edge generation with two-color local +
// bridge connections, depth-fog atmosphere, directional lighting, full
// color palette/mapping system. The user-facing "wow" shader.
const PARTICLE_FIELD_DEF: GpuShaderDef = {
  id: 'particle-field',
  label: 'Particle Field',
  description: 'A particle universe: galaxy arms, atomic orbital shells, boid swarms, vibrating crystalline lattices, curl-noise fields, or gravity-well attractors. Optional cellular scaffold layer with local + long-range connection lines in their own colors. Fog, lighting, and the full palette/mapping system on top. Make it look like outer space, sub-atomic, or anywhere in between.',
  category: 'Generative',
  paramSchema: particleFieldParamSchema,
  defaultParams: particleFieldParamDefaults,
  // Keep this true so older saved projects that still have mode=media
  // and a source continue to render, even though media is no longer a
  // visible picker option.
  needsSource: true,
  create: (device, presentFormat) => new WebGPUParticleFieldShader(device, presentFormat),
  // `maxParams` is the ceiling an authored project may reach at this tier;
  // `tierParams` is where the tier parks a knob the operator never touched
  // (default particleCount 80k, partnerCount 12). Balanced's target is the
  // shader default exactly, so the out-of-the-box cost does not move.
  qualityBudgets: {
    low: {
      maxParams: { particleCount: 100000, partnerCount: 8 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 60000, partnerCount: 8 },
    },
    balanced: {
      maxParams: { particleCount: 250000, partnerCount: 12 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 80000, partnerCount: 12 },
    },
    high: {
      maxParams: { particleCount: 500000, partnerCount: 16 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 180000, partnerCount: 16 },
    },
    ultra: {
      maxParams: { particleCount: 500000, partnerCount: 24 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 320000, partnerCount: 24 },
    },
  },
};

const VOLUMETRIC_BALLS_DEF: GpuShaderDef = {
  id: 'volumetric-balls',
  label: 'Volumetric Nodes',
  description: 'A ray-traced node field in a real lit space. Pick the primitive — sphere, cube, rounded box, octahedron, capsule or torus, each solved analytically or by a bounded sphere trace. Neighbours found through a spatial hash grid connect as thin lines or semi-transparent cylinders that sort correctly through each other. A light-space opacity volume gives the key light genuine volumetric shafts that the nodes cast, land on the ground plane and fall across each other, with Henyey-Greenstein haze, GGX + clear-coat materials, environment reflections, contact AO and AgX.',
  category: 'Generative',
  paramSchema: volumetricSpheresParamSchema,
  defaultParams: volumetricSpheresParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUVolumetricSpheresShader(device, presentFormat),
  // The real levers here are the node population, how deep the K-hit
  // transparency sort goes, how many steps the haze march takes and how
  // fine the light-space opacity volume is. `maxParams` are authored
  // ceilings; `tierParams` is where a tier parks a knob the operator
  // never touched — Balanced sits exactly on the shader defaults, so an
  // untouched project's cost does not move when tiers went live.
  qualityBudgets: {
    low: {
      maxParams: { sphereCount: 320, marchSteps: 28, sphereHits: 2, maxLinks: 4, shadowRes: 64 },
      scaleMaxParams: ['sphereCount', 'marchSteps'],
      tierParams: { sphereCount: 150, marchSteps: 20, sphereHits: 2, maxLinks: 3, shadowRes: '48' },
    },
    balanced: {
      maxParams: { sphereCount: 700, marchSteps: 72, sphereHits: 4, maxLinks: 6, shadowRes: 80 },
      scaleMaxParams: ['sphereCount', 'marchSteps'],
      tierParams: { sphereCount: 260, marchSteps: 40, sphereHits: 3, maxLinks: 4, shadowRes: '64' },
    },
    high: {
      maxParams: { sphereCount: 1000, marchSteps: 104, sphereHits: 5, maxLinks: 8, shadowRes: 80 },
      scaleMaxParams: ['sphereCount', 'marchSteps'],
      tierParams: { sphereCount: 460, marchSteps: 64, sphereHits: 4, maxLinks: 5, shadowRes: '80' },
    },
    ultra: {
      maxParams: { sphereCount: 1200, marchSteps: 128, sphereHits: 6, maxLinks: 8, shadowRes: 80 },
      scaleMaxParams: ['sphereCount', 'marchSteps'],
      tierParams: { sphereCount: 720, marchSteps: 96, sphereHits: 6, maxLinks: 6, shadowRes: '80' },
    },
  },
};

/**
 * Build a riders tier operating point from the EFFECTIVE workload it
 * should produce.
 *
 * The riders instruments do not have a `gridSize` param — the grid, the
 * pressure sweeps, the rider-hit count and multipliers on march / rider /
 * shadow counts are all re-derived by the core from the per-layer
 * `quality` enum. So the tier's real lever here is `quality`, and any
 * numeric target has to be expressed as the value to AUTHOR such that the
 * core's multiplier lands it on the number we actually want.
 *
 * Writing that inverse by hand would be exactly the silent mismatch this
 * whole change is meant to remove, so it is computed from the shared
 * resolution table instead: change a multiplier and these recompute.
 */
function ridersTierParams(
  quality: SmokeRidersQualityLevel,
  effective: { marchSteps?: number; shadowSteps?: number; riderCount?: number; shadowRes?: number } = {},
): Record<string, any> {
  const scales = smokeRidersQualityResolution(quality);
  const out: Record<string, any> = { quality };
  if (effective.marchSteps) out.marchSteps = Math.round(effective.marchSteps / scales.marchScale);
  if (effective.shadowSteps) out.shadowSteps = Math.round(effective.shadowSteps / scales.shadowScale);
  if (effective.riderCount) out.riderCount = Math.round(effective.riderCount / scales.countScale);
  // The light-space opacity volume is authored directly (it is a select,
  // not a scaled count) and separately ceilinged by `shadowDimCap` in
  // both resolvers, so a tier can only ever ask for something the core
  // will honour. Balanced deliberately authors 48 — the shader default —
  // rather than its 64 ceiling, so the stock cost is unchanged.
  const shadowResDefault = quality === 'ultra' ? 64 : quality === 'performance' ? 32 : 48;
  out.shadowRes = String(Math.min(effective.shadowRes ?? shadowResDefault, scales.shadowDimCap));
  return out;
}

const SMOKE_RIDERS_DEF: GpuShaderDef = {
  id: 'smoke-riders',
  label: 'Smoke Riders',
  description: 'Glossy riders genuinely embedded in a 3D fluid. MacCormack advection and surface tension keep the paint stringy enough to neck and pinch into droplets, the riders are carried by the real velocity field through an analytic Stokes-drag solve (τ scales with r², so droplets whip and big spheres lag), and ONE raymarch resolves smoke, spheres, mutual occlusion, volume shadows, clear-coat studio lighting and AgX together.',
  category: 'Generative',
  paramSchema: smokeRidersParamSchema,
  defaultParams: smokeRidersParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUSmokeRidersShader(device, presentFormat),
  // The tier's real lever on this instrument is the `quality` enum, which
  // the core turns into the sim grid (32/48/64), the pressure sweep count,
  // the rider-hit count, MacCormack on/off, and multipliers on the
  // authored march / rider / shadow counts.
  //
  // FIXED: every tier here used to declare a `gridSize` cap, but
  // smoke-riders has no `gridSize` param — those four caps could never
  // match anything and the grid stayed wherever `quality` put it. They are
  // replaced by the `quality` targets below, which move the grid for real.
  //
  // `maxParams` are authored ceilings and stay generous except on Live
  // Saver, whose entire job is to cap. The old balanced ceilings (72 march
  // / 480 riders) would have started clipping ordinary authored projects
  // the moment tiers went live, so they are raised to sit above the
  // instrument's own defaults rather than on top of them.
  qualityBudgets: {
    low: {
      maxParams: { shadowSteps: 6, marchSteps: 72, riderCount: 512, emitterCount: 6 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount', 'emitterCount'],
      tierParams: ridersTierParams('performance'),
      forceParams: { advection: 'semi-lagrangian' },
    },
    balanced: {
      // Targets the shader defaults exactly (48^3, 72 march, 5 shadow,
      // 220 riders) so the stock look and cost are unchanged.
      maxParams: { shadowSteps: 8, marchSteps: 120, riderCount: 1024, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount', 'emitterCount'],
      tierParams: ridersTierParams('balanced'),
    },
    high: {
      // 64^3 grid, 24 pressure sweeps, 4 rider hits, and the core's 1.4x
      // march / 1.35x rider multipliers on the untouched defaults.
      maxParams: { shadowSteps: 12, marchSteps: 160, riderCount: 2048, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount'],
      tierParams: ridersTierParams('ultra'),
    },
    ultra: {
      // Same 64^3 solve as High, but pushed to the instrument's declared
      // render ceiling: the full 160-step march, every shadow step, and a
      // rider population four times the default.
      maxParams: { shadowSteps: 12, marchSteps: 160, riderCount: 2048, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount'],
      tierParams: ridersTierParams('ultra', { marchSteps: 160, shadowSteps: 10, riderCount: 900, shadowRes: 80 }),
    },
  },
};
// The liquid's iso-surface hunt needs a finer march than the smoke
// instrument's scatter integral (default 96 vs 72), so its budgets carry
// proportionally higher marchSteps ceilings.
const FLUID_RIDERS_DEF: GpuShaderDef = {
  id: 'fluid-riders',
  label: 'Fluid Riders',
  description: 'Thick viscous opaque liquid rendered as a lit isosurface, with raytraced riders that drift on the flow and take their colour from the fluid. Accepts an image or video source to colour the pour.',
  category: 'Generative',
  paramSchema: fluidRidersParamSchema,
  defaultParams: fluidRidersParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUFluidRidersShader(device, presentFormat),
  // Same structure as smoke-riders (the core's builder is literally the
  // same function), but the liquid's iso-surface hunt needs a finer march
  // than a scatter integral, so the default is 96 rather than 72 and the
  // ceilings sit proportionally higher.
  //
  // FIXED: the dead `gridSize` caps are gone here too — see SMOKE_RIDERS_DEF.
  qualityBudgets: {
    low: {
      maxParams: { shadowSteps: 6, marchSteps: 96, riderCount: 512, emitterCount: 6 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount', 'emitterCount'],
      tierParams: ridersTierParams('performance'),
      forceParams: { advection: 'semi-lagrangian' },
    },
    balanced: {
      maxParams: { shadowSteps: 8, marchSteps: 140, riderCount: 1024, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount', 'emitterCount'],
      tierParams: ridersTierParams('balanced'),
    },
    high: {
      maxParams: { shadowSteps: 12, marchSteps: 160, riderCount: 2048, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount'],
      tierParams: ridersTierParams('ultra'),
    },
    ultra: {
      maxParams: { shadowSteps: 12, marchSteps: 160, riderCount: 2048, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps', 'marchSteps', 'riderCount'],
      tierParams: ridersTierParams('ultra', { marchSteps: 160, shadowSteps: 10, riderCount: 900, shadowRes: 80 }),
    },
  },
};

export const gravityWellsDefaultParams: Record<string, any> = {
  ...particleFieldParamDefaults,
  mode: 'gravity',
  particleCount: 140000,
  baseSize: 0.010,
  opacity: 0.9,
  topology: 'glow',
  connectEnabled: true,
  partnerCount: 16,
  localRadius: 0.075,
  bridgeRadius: 0.32,
  alphaLocal: 0.18,
  alphaBridge: 0.065,
  fogDensity: 0.55,
  fogOpacity: 0.72,
  fogColor: [2, 3, 10],
  colorMode: 'palette4',
  colorMap: 'radial',
  colorMix: 1,
  colorCycleSpeed: 0.045,
  hueShiftSpeed: 0.018,
  saturation: 1.35,
  brightness: 1.45,
  colorA: [30, 90, 255],
  colorB: [255, 55, 120],
  colorC: [255, 190, 40],
  colorD: [55, 240, 255],
  colorLocal: [70, 230, 255],
  colorBridge: [255, 70, 165],
  lightX: -0.6,
  lightY: 0.8,
  lightZ: 0.35,
  lightStrength: 0.85,
  materialAmbient: 0.32,
  materialDiffuse: 1.05,
  materialSpecular: 0.78,
  materialShininess: 64,
  materialReflection: 0.22,
  fovDeg: 48,
  cameraZ: 2.7,
  autoRotateX: 1.5,
  autoRotateY: 8,
  autoRotateZ: -1,
  burstGain: 1.05,
  burstDecay: 3.0,
  shimmerStrength: 0.032,
  audioSmoothing: 0.84,
  gravityWells: 5,
  gravityStrength: 0.22,
  gravityOrbit: 0.55,
  gravityCoreSize: 0.1,
  gravityVortex: 0.48,
  gravityMaxVelocity: 6.2,
  gravityAudioDrive: 1.6,
  gravityChaos: 0.24,
};

// Gravity Wells — original WGSL implementation inspired by WebGPU
// compute-body demos: GPU-side attractors, softened core repulsion,
// velocity clamp, filament connections, and smoothed audio drive.
const GRAVITY_WELLS_DEF: GpuShaderDef = {
  id: 'gravity-wells',
  label: 'Gravity Wells',
  description: 'A dramatic compute-particle field: swarms fall through orbiting gravity wells, braid into luminous filaments, repel from the cores instead of collapsing, and breathe smoothly with bass/treble. Built on the Particle Field GPU pipeline as a source-free generative shader.',
  category: 'Generative',
  paramSchema: particleFieldParamSchema,
  defaultParams: gravityWellsDefaultParams,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUParticleFieldShader(device, presentFormat),
  // Gravity Wells ships with a much heavier default than Particle Field
  // (140k particles, 16 partners) because the filament braid IS the look.
  // Balanced therefore targets exactly that default — the stock experience
  // must not get cheaper OR more expensive when tiers went live. Ultra
  // targets 500k, which is also the core's hard particle ceiling.
  //
  // The old balanced cap of 12 partners was one of the caps that had never
  // been exercised: it silently thinned the signature braid below the
  // instrument's own default of 16. Raised to 16 so Balanced renders the
  // instrument as designed.
  qualityBudgets: {
    low: {
      maxParams: { particleCount: 90000, partnerCount: 8 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 90000, partnerCount: 8 },
    },
    balanced: {
      maxParams: { particleCount: 180000, partnerCount: 16 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 140000, partnerCount: 16 },
    },
    high: {
      maxParams: { particleCount: 320000, partnerCount: 20 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 260000, partnerCount: 16 },
    },
    ultra: {
      maxParams: { particleCount: 500000, partnerCount: 24 },
      scaleMaxParams: ['particleCount', 'partnerCount'],
      tierParams: { particleCount: 500000, partnerCount: 24 },
    },
  },
};

// Ink Cloud — volumetric smoke / ink-in-water particle simulator.
// Continuous emission from up to 8 colored sources; particles age,
// disperse under multi-octave curl-noise turbulence, and respawn
// at their assigned emitter. Reads as multiple distinct ink streams
// dispersing through invisible currents — the closest we get in
// real-time to actual fluid sim without paying for a 3D Navier-
// Stokes grid or volumetric raymarching.
const INK_CLOUD_DEF: GpuShaderDef = {
  id: 'ink-cloud',
  label: 'Ink Cloud',
  description: 'Volumetric smoke / ink-in-water simulator. Up to 8 colored emitters spawn particles that age, disperse via multi-octave curl-noise turbulence, and respawn — the look of real ink dropped in water. Bass triggers fresh "bursts" of particles, treble adds shimmer, optional vortex pulls the cloud into a tornado.',
  category: 'Generative',
  paramSchema: inkCloudParamSchema,
  defaultParams: inkCloudParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUInkCloudShader(device, presentFormat),
};

// 3D Smoke — true volumetric Stable-Fluids on a 3D voxel grid +
// raymarched volume renderer. The biggest ambition shader in the
// catalog: per-voxel Navier-Stokes (advect → divergence → 20×
// Jacobi pressure → subtract gradient → advect density), then a
// fullscreen raymarch with blue-noise dither for banding-free
// sampling. Same family as the threejs-blocks 3D smoke example.
const SMOKE_3D_DEF: GpuShaderDef = {
  id: 'smoke-3d',
  label: '3D Smoke',
  description: 'True volumetric 3D smoke — voxel-grid Navier-Stokes simulation rendered by GPU raymarching. Real depth, real occlusion, real perspective foreshortening. Auto-orbital colored emitters splat density and velocity into the volume; bass kicks trigger synchronized bursts. Heavier than the 2D Fluid Smoke (try 32³ on integrated GPUs, 48³ as default, 64³ if you have a discrete GPU).',
  category: 'Generative',
  paramSchema: smoke3DParamSchema,
  defaultParams: smoke3DParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPU3DSmokeShader(device, presentFormat),
  // 3D Smoke is the one volumetric instrument whose grid IS a real param,
  // so the tier can move it directly. Note the targets are NUMBERS while
  // the schema default is the string '48' — the funnel coerces
  // select-backed numerics on the way to the core, which reads them as
  // JSON numbers and silently ignores strings.
  //
  // `emitterCount` is left alone by the tier: how many plumes are in the
  // shot is a look decision, not a budget one. It is still capped.
  qualityBudgets: {
    low: {
      maxParams: { gridSize: 32, shadowSteps: 2, emitterCount: 4 },
      scaleMaxParams: ['shadowSteps', 'emitterCount'],
      tierParams: { gridSize: 32, shadowSteps: 2 },
    },
    balanced: {
      maxParams: { gridSize: 48, shadowSteps: 4, emitterCount: 6 },
      scaleMaxParams: ['shadowSteps', 'emitterCount'],
      tierParams: { gridSize: 48, shadowSteps: 4 },
    },
    high: {
      maxParams: { gridSize: 64, shadowSteps: 6, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps'],
      tierParams: { gridSize: 64, shadowSteps: 6 },
    },
    ultra: {
      maxParams: { gridSize: 64, shadowSteps: 8, emitterCount: 8 },
      scaleMaxParams: ['shadowSteps'],
      tierParams: { gridSize: 64, shadowSteps: 8 },
    },
  },
};

// Warp Loom — original horizontal conduit/web instrument from the web
// release line (v1.9.9x). Runs on the in-browser WebGPU runner. Not yet
// ported to the native core's WGSL graph pipeline, so it is intentionally
// NOT listed in NATIVE_READY_GPU_SHADER_IDS below: with the native output
// core enabled the picker hides it, and the sync layer reports
// `gpu-shader:warp-loom:not-native` instead of rendering a broken layer.
// Native support needs a `warp-loom` NativeGraphInstrumentSpec (WGSL graph)
// in native-renderer/src/native_graph_manifest.rs.
const WARP_LOOM_DEF: GpuShaderDef = {
  id: 'warp-loom',
  label: 'Warp Loom',
  description: 'Original horizontal conduit and web instrument. Braided tubes stream through turbulent spatial warps while crosslinks form a luminous elastic membrane between them.',
  category: 'Generative',
  paramSchema: warpLoomParamSchema,
  defaultParams: warpLoomParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUWarpLoom(device, presentFormat),
};

export const GPU_SHADER_CATALOG: GpuShaderDef[] = [
  PLANET_DEF,
  WARP_LOOM_DEF,
  PIXEL_PARTICLES_DEF,
  FLYTHROUGH_DEF,
  POINTCLOUD_FX_DEF,
  PARTICLE_FIELD_DEF,
  VOLUMETRIC_BALLS_DEF,
  SMOKE_RIDERS_DEF,
  FLUID_RIDERS_DEF,
  GRAVITY_WELLS_DEF,
  INK_CLOUD_DEF,
  SMOKE_3D_DEF,
];

// Native v2 picker surface.
export const NATIVE_READY_GPU_SHADER_IDS = new Set<string>([
  'planet',
  'particle-field',
  'gravity-wells',
  'pixel-particles',
  'flythrough',
  'point-cloud-fx',
  'smoke-riders',
  'fluid-riders',
  'ink-cloud',
  'smoke-3d',
  'volumetric-balls',
]);

export const NATIVE_READY_GPU_SHADER_CATALOG: GpuShaderDef[] = GPU_SHADER_CATALOG.filter((shader) =>
  NATIVE_READY_GPU_SHADER_IDS.has(shader.id),
);

export function isNativeReadyGpuShaderId(id: string | undefined | null): boolean {
  return NATIVE_READY_GPU_SHADER_IDS.has(String(id ?? '').trim().toLowerCase());
}

const BY_ID: Map<string, GpuShaderDef> = new Map(GPU_SHADER_CATALOG.map((s) => [s.id, s]));

export function getShaderDef(id: string): GpuShaderDef | undefined {
  return BY_ID.get(id);
}

export function listShaderCategories(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of GPU_SHADER_CATALOG) {
    if (!seen.has(s.category)) {
      seen.add(s.category);
      out.push(s.category);
    }
  }
  return out;
}

const QUALITY_TIER_ORDER: GhostGpuQualityTier[] = ['low', 'balanced', 'high', 'ultra'];

function clampTier(tier: GhostGpuQualityTier | null | undefined): GhostGpuQualityTier {
  return tier && QUALITY_TIER_ORDER.includes(tier) ? tier : 'balanced';
}

function coerceNumericParamValue(original: any, value: number): any {
  if (typeof original === 'string') return String(Math.round(value));
  return value;
}

/** Loose equality used to decide "did the operator touch this knob?".
 *  Select-backed params round-trip as numeric strings ('48' vs 48), so a
 *  strict compare would read every one of them as authored. */
function sameParamValue(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
  return String(a) === String(b);
}

function clampParamValue(original: any, cap: number): { value: any; changed: boolean } {
  const numeric = Number(original);
  if (!Number.isFinite(numeric)) return { value: original, changed: false };
  const capped = Math.min(numeric, cap);
  return {
    value: coerceNumericParamValue(original, capped),
    changed: capped !== numeric,
  };
}

function budgetForTier(def: GpuShaderDef, tier: GhostGpuQualityTier): GpuShaderQualityTierBudget | null {
  if (!def.qualityBudgets) return null;
  const start = QUALITY_TIER_ORDER.indexOf(tier);
  for (let i = start; i >= 0; i--) {
    const budget = def.qualityBudgets[QUALITY_TIER_ORDER[i]];
    if (budget) return budget;
  }
  return null;
}

export function applyGpuShaderQualityBudget(
  def: GpuShaderDef | undefined,
  params: Record<string, any>,
  context?: Partial<GpuShaderQualityContext> | null,
): GpuShaderQualityApplyResult {
  const capsTier = clampTier(context?.capsTier);
  const suggestedTier = clampTier(context?.suggestedTier ?? capsTier);
  const qualityScale = Math.max(0.25, Math.min(1, Number(context?.qualityScale ?? 1)));
  const fullContext: GpuShaderQualityContext = {
    capsTier,
    suggestedTier,
    qualityScale,
    adaptive: !!context?.adaptive,
    governor: context?.governor ?? null,
  };

  if (!def?.qualityBudgets) {
    return { params, applied: {}, context: fullContext };
  }

  const budget = budgetForTier(def, suggestedTier);
  if (!budget) {
    return { params, applied: {}, context: fullContext };
  }

  const out: Record<string, any> = { ...params };
  const applied: GpuShaderQualityApplyResult['applied'] = {};
  const scaleKeys = new Set(budget.scaleMaxParams ?? []);

  // Tier operating point first, caps second — so a tier target can never
  // sneak past the same tier's declared ceiling.
  for (const [key, target] of Object.entries(budget.tierParams ?? {})) {
    // Only params the operator has left alone follow the tier. Anything
    // authored away from the shader default is their call; the caps loop
    // below still clamps it. A param that is absent entirely (older saved
    // projects, or a caller passing a sparse object) IS the default.
    const untouched = out[key] === undefined || sameParamValue(out[key], def.defaultParams?.[key]);
    if (!untouched) continue;
    if (sameParamValue(out[key], target)) continue;
    applied[key] = { from: out[key], to: target };
    out[key] = target;
  }

  for (const [key, rawCap] of Object.entries(budget.maxParams ?? {})) {
    const tierProfileCap = key === 'particleCount'
      ? GHOST_GPU_QUALITY_PROFILES[suggestedTier].particleBudget
      : key === 'gridSize'
        ? GHOST_GPU_QUALITY_PROFILES[suggestedTier].volumeGrid
        : rawCap;
    const scaledCap = scaleKeys.has(key)
      ? Math.max(1, Math.floor(tierProfileCap * qualityScale))
      : tierProfileCap;
    const cap = Math.max(0, Math.min(rawCap, scaledCap));
    const previous = out[key];
    const next = clampParamValue(previous, cap);
    if (next.changed) {
      out[key] = next.value;
      // Keep the operator's original value as `from` when the tier target
      // already moved this key, so the debug readout shows the real delta.
      applied[key] = { from: applied[key]?.from ?? previous, to: next.value, cap };
    }
  }

  for (const [key, value] of Object.entries(budget.forceParams ?? {})) {
    if (out[key] !== value) {
      applied[key] = { from: applied[key]?.from ?? out[key], to: value };
      out[key] = value;
    }
  }

  return { params: out, applied, context: fullContext };
}
