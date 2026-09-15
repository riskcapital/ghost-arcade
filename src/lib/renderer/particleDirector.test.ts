import { describe, expect, it } from 'vitest';
import { flythroughParamDefaults, flythroughParamSchema } from './shaders/webgpuFlythroughShader';
import { pixelParticlesParamDefaults, pixelParticlesParamSchema } from './shaders/webgpuPixelParticlesShader';
import { particleDirectorParamControls, PARTICLE_DIRECTOR_POI_SHADER_ID, getParticleDirectorShaderSource } from './particleDirector';
import type { ParamControl } from './gpuShaderTypes';

function assertSchemaIsWired(schema: ParamControl[]) {
  const keys = new Set(schema.map((control) => control.key));
  expect(keys.size, 'no duplicate keys').toBe(schema.length);
  for (const control of schema) {
    for (const key of Object.keys((control as any).showWhen ?? {})) {
      // A showWhen on a key nothing sets would hide the control forever.
      expect(keys.has(key), `${control.key} waits on missing key ${key}`).toBe(true);
    }
  }
}

describe('particle panel controls', () => {
  it('only gate controls on keys that exist', () => {
    assertSchemaIsWired(flythroughParamSchema);
    assertSchemaIsWired(pixelParticlesParamSchema);
  });

  it('leave every new feature off, so existing projects look as they did', () => {
    for (const defaults of [flythroughParamDefaults, pixelParticlesParamDefaults]) {
      expect(defaults.grainShading).toBe('soft');
      expect(defaults.aperture).toBe(0);
      expect(defaults.motionReactive).toBe(0);
      expect(defaults.directorEnabled).toBe(false);
    }
    expect(flythroughParamDefaults.limitWander).toBe(false);
  });

  it('offers the same Auto Camera controls on both instruments', () => {
    const keys = particleDirectorParamControls().map((control) => control.key);
    for (const schema of [flythroughParamSchema, pixelParticlesParamSchema]) {
      const present = new Set(schema.map((control) => control.key));
      for (const key of keys) expect(present.has(key), key).toBe(true);
    }
  });

  it('ships the contrast grid shader the core precompiles', () => {
    const shader = getParticleDirectorShaderSource();
    expect(shader.shaderId).toBe(PARTICLE_DIRECTOR_POI_SHADER_ID);
    expect(shader.source).toContain('fn cs_poi');
  });
});
