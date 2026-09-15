/**
 * Shared pieces of the particle presentation camera ("Auto Camera").
 *
 * The director itself runs in the native core (native-renderer/src/
 * particle_director.rs), because Flythrough and Pixel Particles are core-owned:
 * they keep animating while the UI is idle, and a camera driven from here would
 * only move when the panel happened to push params. What lives here is what the
 * core needs from the TypeScript side: the WGSL it precompiles, and the panel
 * controls both instruments share.
 */
import type { ParamControl } from './gpuShaderTypes';
import { resolveGhostWgsl } from './wgsl';

export const PARTICLE_DIRECTOR_POI_SHADER_ID = 'particle-director/poi-grid';

/** Cells per side of the contrast grid. Must match PARTICLE_DIRECTOR_POI_GRID
 *  in main.rs. */
export const PARTICLE_DIRECTOR_POI_GRID = 24;

/*
 * Where is the picture interesting? One score per grid cell, from sixteen
 * samples inside it: local contrast (luma spread), edge energy (neighbouring
 * samples that disagree), and a little saturation, so a vivid flat patch can
 * still hold a shot while a flat grey one cannot. Row 0 is the top of the
 * image. The core reads it back asynchronously and picks the peaks.
 */
const POI_GRID_WGSL = /* wgsl */ `
struct PoiU {
  n:  u32,
  _a: u32,
  _b: u32,
  _c: u32,
};

@group(0) @binding(0) var<storage, read_write> scores: array<f32>;
@group(0) @binding(1) var<uniform> pu: PoiU;
@group(0) @binding(2) var src: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;

@compute @workgroup_size(8, 8)
fn cs_poi(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= pu.n || gid.y >= pu.n) { return; }
  let cell = 1.0 / f32(pu.n);
  var lum: array<f32, 16>;
  var sum = 0.0;
  var sum_sq = 0.0;
  var saturation = 0.0;
  for (var j = 0u; j < 4u; j = j + 1u) {
    for (var i = 0u; i < 4u; i = i + 1u) {
      let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + (vec2<f32>(f32(i), f32(j)) + vec2<f32>(0.5)) / 4.0) * cell;
      let c = textureSampleLevel(src, samp, uv, 0.0).rgb;
      let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
      lum[j * 4u + i] = l;
      sum = sum + l;
      sum_sq = sum_sq + l * l;
      saturation = saturation + (max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b));
    }
  }
  var edge = 0.0;
  for (var j = 0u; j < 4u; j = j + 1u) {
    for (var i = 0u; i < 4u; i = i + 1u) {
      let here = lum[j * 4u + i];
      if (i > 0u) { edge = edge + abs(here - lum[j * 4u + i - 1u]); }
      if (j > 0u) { edge = edge + abs(here - lum[(j - 1u) * 4u + i]); }
    }
  }
  let mean = sum / 16.0;
  let spread = sqrt(max(sum_sq / 16.0 - mean * mean, 0.0));
  scores[gid.y * pu.n + gid.x] = spread * 2.0 + edge / 24.0 + (saturation / 16.0) * 0.35;
}
`;

export interface ParticleDirectorShaderSource {
  shaderId: string;
  label: string;
  stage: 'compute';
  entry: string;
  source: string;
}

export function getParticleDirectorShaderSource(): ParticleDirectorShaderSource {
  return {
    shaderId: PARTICLE_DIRECTOR_POI_SHADER_ID,
    label: PARTICLE_DIRECTOR_POI_SHADER_ID,
    stage: 'compute',
    entry: 'cs_poi',
    source: resolveGhostWgsl(POI_GRID_WGSL, PARTICLE_DIRECTOR_POI_SHADER_ID),
  };
}

/**
 * Panel controls for the presentation camera. Shared so both instruments
 * offer it identically; `group` is the section heading.
 */
export function particleDirectorParamControls(group = 'Auto Camera'): ParamControl[] {
  const on = { directorEnabled: true };
  return [
    // A cinematographer rather than an orbit: wide, push in, detail, rack
    // focus across the depth, another detail, pull back. The subjects come
    // from where the live picture has the most going on, and the loop keeps
    // planning new shots against it.
    { kind: 'toggle', key: 'directorEnabled', label: 'Auto Camera', group, default: false },
    { kind: 'select', key: 'directorPace', label: 'Pace', group,
      options: [
        { value: 'slow', label: 'Slow' },
        { value: 'medium', label: 'Medium' },
        { value: 'fast', label: 'Fast' },
      ],
      default: 'medium', showWhen: on },
    { kind: 'slider', key: 'directorCloseness', label: 'Closeness', group, min: 0, max: 1, step: 0.01, default: 0.7, showWhen: on },
    { kind: 'toggle', key: 'directorDepthOfField', label: 'Shallow Focus on Details', group, default: true, showWhen: on },
    // Travel and hold round to whole beats of the audio clock, so moves start
    // and land with the music. Without a tempo it has no effect.
    { kind: 'toggle', key: 'directorBeatSync', label: 'Move on the Beat', group, default: false, showWhen: on },
    { kind: 'slider', key: 'directorSeed', label: 'Variation', group, min: 1, max: 99, step: 1, default: 1, showWhen: on },
  ];
}
