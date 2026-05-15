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

import type { GpuShaderDef } from './gpuShaderTypes';
import { WebGPUPlanet, planetParamSchema, planetParamDefaults } from './shaders/webgpuPlanet';
import { WebGPUPixelParticlesShader, pixelParticlesParamSchema, pixelParticlesParamDefaults } from './shaders/webgpuPixelParticlesShader';
import { WebGPUFlythroughShader, flythroughParamSchema, flythroughParamDefaults } from './shaders/webgpuFlythroughShader';
import { WebGPUPointCloudFXShader, pointCloudFXParamSchema, pointCloudFXParamDefaults } from './shaders/webgpuPointCloudFXShader';
import { WebGPUParticleFieldShader, particleFieldParamSchema, particleFieldParamDefaults } from './shaders/webgpuParticleFieldShader';
import { WebGPUInkCloudShader, inkCloudParamSchema, inkCloudParamDefaults } from './shaders/webgpuInkCloudShader';
// Fluid Smoke removed from catalog — overlapped with Ink Cloud.
// The shader file remains on disk for now as dead code; can clean up
// later if we're sure we won't bring it back.
import { WebGPU3DSmokeShader, smoke3DParamSchema, smoke3DParamDefaults } from './shaders/webgpu3DSmokeShader';

const PLANET_DEF: GpuShaderDef = {
  id: 'planet',
  label: 'Planet',
  description: 'Ray-traced procedural planet — Earth, Mars, Jupiter, Saturn. Volumetric clouds, polar aurora, atmosphere, star field, Milky Way, and Saturn rings, all generated in one fragment shader.',
  category: 'Generative',
  paramSchema: planetParamSchema,
  defaultParams: planetParamDefaults,
  needsSource: false,
  create: (device, presentFormat) => new WebGPUPlanet(device, presentFormat),
};

const PIXEL_PARTICLES_DEF: GpuShaderDef = {
  id: 'pixel-particles',
  label: 'Pixel Particles',
  description: '',
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
  description: 'Drop a .ply or .splat. Audio-reactive bass bursts, curl-noise wind, an orbiting proximity-wave field, dissolve, hue cycling — turn any point cloud into a living visual instrument. Worm-stroke topology gives the volumetric brush look as the cloud breathes.',
  category: 'Source-driven',
  paramSchema: pointCloudFXParamSchema,
  defaultParams: pointCloudFXParamDefaults,
  needsSource: true,
  create: (device, presentFormat) => new WebGPUPointCloudFXShader(device, presentFormat),
};

// Particle Field — the everything-bagel particle shader. Six wildly
// different behavior modes (galaxy / atomic / swarm / lattice / field /
// media), four topologies (points / glow / streaks / sphere), GPU-side
// nearest-neighbor edge generation with two-color local + bridge
// connections, depth-fog atmosphere, directional lighting, full color
// palette/mapping system. The user-facing "wow" shader.
const PARTICLE_FIELD_DEF: GpuShaderDef = {
  id: 'particle-field',
  label: 'Particle Field',
  description: 'A particle universe: galaxy arms, atomic orbital shells, boid swarms, vibrating crystalline lattices, curl-noise fields, or image/video-driven Refik-style spawns. Optional cellular scaffold layer with local + long-range connection lines in their own colors. Fog, lighting, and the full palette/mapping system on top. Make it look like outer space, sub-atomic, or anywhere in between.',
  category: 'Source-driven',
  paramSchema: particleFieldParamSchema,
  defaultParams: particleFieldParamDefaults,
  needsSource: true,
  create: (device, presentFormat) => new WebGPUParticleFieldShader(device, presentFormat),
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
};

export const GPU_SHADER_CATALOG: GpuShaderDef[] = [
  PLANET_DEF,
  PIXEL_PARTICLES_DEF,
  FLYTHROUGH_DEF,
  POINTCLOUD_FX_DEF,
  PARTICLE_FIELD_DEF,
  INK_CLOUD_DEF,
  SMOKE_3D_DEF,
];

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
