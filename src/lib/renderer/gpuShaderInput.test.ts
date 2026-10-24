import { describe, expect, it } from 'vitest';
import {
  carryGpuShaderInput,
  gpuLayerAwaitingInput,
  gpuShaderNeedsInput,
  gpuSourceParamIsBound,
} from './gpuShaderInput';
import { getShaderDef } from './gpuShaderCatalog';

describe('GPU shader input', () => {
  it('covers exactly the image-driven shaders', () => {
    expect(gpuShaderNeedsInput('pixel-particles')).toBe(true);
    expect(gpuShaderNeedsInput('flythrough')).toBe(true);
    expect(gpuShaderNeedsInput('particle-field', { mode: 'media' })).toBe(true);
    // `gravity-wells` is the legacy alias the native route normalises to
    // particle-field; it has to answer the same way.
    expect(gpuShaderNeedsInput('gravity-wells', { mode: 'media' })).toBe(true);
    expect(gpuShaderNeedsInput('particle-field', { mode: 'galaxy' })).toBe(false);
    expect(gpuShaderNeedsInput('particle-field')).toBe(false);
    // Point Cloud FX takes .ply/.splat geometry, not a picture.
    expect(gpuShaderNeedsInput('point-cloud-fx')).toBe(false);
    expect(gpuShaderNeedsInput('planet')).toBe(false);
    expect(gpuShaderNeedsInput(null)).toBe(false);
  });

  it('treats only a genuinely empty picker as unbound', () => {
    expect(gpuSourceParamIsBound(null)).toBe(false);
    expect(gpuSourceParamIsBound(undefined)).toBe(false);
    expect(gpuSourceParamIsBound({})).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'media' })).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'media', mediaId: '' })).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'file' })).toBe(false);
    expect(gpuSourceParamIsBound({ type: 'media', mediaId: 'm1' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'layer', layerId: 'l1' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'file', url: 'blob:x' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'camera', deviceId: '' })).toBe(true);
    expect(gpuSourceParamIsBound({ type: 'spout', senderName: 'Test Sender' })).toBe(true);
  });

  it('asks for an input until one is picked', () => {
    expect(gpuLayerAwaitingInput('flythrough', {})).toBe(true);
    expect(gpuLayerAwaitingInput('flythrough', { source: null })).toBe(true);
    expect(gpuLayerAwaitingInput('flythrough', { source: { type: 'media', mediaId: 'm1' } })).toBe(false);
    expect(gpuLayerAwaitingInput('point-cloud-fx', { source: null })).toBe(false);
    expect(gpuLayerAwaitingInput('planet', {})).toBe(false);
  });

  it('carries the picked input between input-driven shaders', () => {
    const picked = { type: 'media', mediaId: 'clip-1' };
    const pixel = getShaderDef('pixel-particles')!;
    const fly = getShaderDef('flythrough')!;
    const carried = carryGpuShaderInput('flythrough', { source: picked, speed: 2 }, 'pixel-particles',
      { ...pixel.defaultParams }, pixel);
    expect(carried.source).toEqual(picked);
    // A copy, so editing one shader's input never edits the other's.
    expect(carried.source).not.toBe(picked);

    // A shader that already has its own input keeps it.
    const own = { type: 'layer', layerId: 'layer-2' };
    expect(carryGpuShaderInput('flythrough', { source: picked }, 'pixel-particles',
      { ...pixel.defaultParams, source: own }, pixel).source).toEqual(own);

    // Nothing picked: nothing to carry.
    expect(gpuSourceParamIsBound(carryGpuShaderInput('flythrough', { source: null }, 'pixel-particles',
      { ...pixel.defaultParams }, pixel).source)).toBe(false);

    // Not into or out of shaders that do not take a picture.
    expect(gpuSourceParamIsBound(carryGpuShaderInput('flythrough', { source: picked }, 'planet',
      {}, getShaderDef('planet')).source)).toBe(false);
    const cloud = getShaderDef('point-cloud-fx');
    if (cloud) {
      const ply = { type: 'file', url: 'blob:cloud', name: 'scan.ply' };
      expect(gpuSourceParamIsBound(carryGpuShaderInput('point-cloud-fx', { source: ply }, 'flythrough',
        { ...fly.defaultParams }, fly).source)).toBe(false);
    }
  });
});
