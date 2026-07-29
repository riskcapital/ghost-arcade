import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import {
  createModel3DWireframeGeometry,
  getModel3DLightingProfile,
  getModel3DMorphReferenceSize,
  getModel3DMorphTypeIndex,
  getModel3DWireframeModeIndex,
  injectModel3DSourceMorphVertexShader,
} from './Model3DRenderer';

describe('model 3D lighting profiles', () => {
  it('keeps every preset visually distinct', () => {
    const presets = ['studio', 'dramatic', 'neon', 'sunrise', 'moonlight', 'disco', 'none'] as const;
    const profiles = presets.map((preset) => JSON.stringify(getModel3DLightingProfile(preset)));

    expect(new Set(profiles).size).toBe(presets.length);
  });

  it('drives meaningful light and shadow differences', () => {
    const studio = getModel3DLightingProfile('studio');
    const dramatic = getModel3DLightingProfile('dramatic');
    const neon = getModel3DLightingProfile('neon');
    const none = getModel3DLightingProfile('none');

    expect(dramatic.keyScale).toBeGreaterThan(studio.keyScale);
    expect(dramatic.ambientScale).toBeLessThan(studio.ambientScale);
    expect(dramatic.selfShadowStrength).toBeGreaterThan(studio.selfShadowStrength);
    expect(neon.rimScale).toBeGreaterThan(studio.rimScale);
    expect(none).toMatchObject({
      keyScale: 0,
      fillScale: 0,
      rimScale: 0,
      environmentScale: 0,
      selfShadowStrength: 0
    });
  });
});

describe('model 3D deformation pipeline', () => {
  it('routes every deformation option to a live shader mode', () => {
    const types = [
      'noise', 'pulse', 'wave', 'twist', 'inflate', 'breathe', 'bulge',
      'jelly', 'explode', 'implode', 'melt', 'spherify', 'taper',
      'tentacle', 'shatter', 'magnetic', 'bend', 'pixelate', 'swirl',
      'fracture',
    ] as const;

    expect(getModel3DMorphTypeIndex('none')).toBe(0);
    for (const type of types) {
      expect(getModel3DMorphTypeIndex(type), type).toBeGreaterThan(0);
    }
  });

  it('injects deformation after Three.js declares stock position and normal variables', () => {
    const source = THREE.ShaderLib.standard.vertexShader;
    const result = injectModel3DSourceMorphVertexShader(source);

    expect(result).toContain('#include <beginnormal_vertex>\nobjectNormal = originalNormal;');
    expect(result).toContain('#include <begin_vertex>\nvMorphIntensity = 0.0;');
    expect(result).toContain('transformed = applyMorph(originalPosition, originalNormal);');
    expect(result).not.toContain('vec3 transformed = applyMorph');
    expect(result).toContain('attribute vec3 originalPosition;');
    expect(result).toContain('uniform int morphType;');
    expect(result).toContain('uniform float morphReferenceSize;');
  });

  it('fails loudly if a future Three.js shader removes a required hook', () => {
    expect(() => injectModel3DSourceMorphVertexShader('void main() {}'))
      .toThrow(/missing Three\.js hook/);
  });

  it('normalizes deformation response across imported model scales', () => {
    expect(getModel3DMorphReferenceSize(128)).toBe(128);
    expect(getModel3DMorphReferenceSize(0)).toBe(0.0001);
    expect(getModel3DMorphReferenceSize(Number.NaN)).toBe(1);
  });
});

describe('model 3D wireframe geometry', () => {
  it('routes every wire style to a distinct shader treatment', () => {
    const modes = [
      'none',
      'classic',
      'animated',
      'glow',
      'neon',
      'pulse',
      'rainbow',
      'dotted',
      'thick',
    ] as const;
    const shaderModes = modes.map((mode) => getModel3DWireframeModeIndex(mode));

    expect(shaderModes[0]).toBe(0);
    expect(new Set(shaderModes).size).toBe(modes.length);
  });

  it('creates triangle-local barycentric coordinates for pixel-width edges', () => {
    const source = new THREE.BufferGeometry();
    source.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, 0,
      1, 0, 0,
      0, 1, 0,
    ], 3));
    source.setIndex([0, 1, 2]);

    const wireframe = createModel3DWireframeGeometry(source);
    const barycentric = wireframe.getAttribute('barycentric');

    expect(wireframe.index).toBeNull();
    expect(barycentric.count).toBe(3);
    expect(Array.from(barycentric.array)).toEqual([
      1, 0, 0,
      0, 1, 0,
      0, 0, 1,
    ]);

    wireframe.dispose();
    source.dispose();
  });
});
