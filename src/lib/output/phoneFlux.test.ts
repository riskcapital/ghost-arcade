import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/native-renderer', () => ({ submitNativeRendererCommands: vi.fn(async () => undefined) }));
import { easeFluxGain, fluxModuleBits, fluxRegionsFromLayers, readPhoneFlux, FLUX_MODULE_BITS } from './phoneFlux';

describe('Flux from a paired phone', () => {
  it('uses the same module order as the phone, which is the order the shader reads', () => {
    // The phone's FLUX_MODULES ids, in its order (mobile/studio/flux.ts on the mobile branch).
    expect([...FLUX_MODULE_BITS]).toEqual(['warp', 'fold', 'prism', 'echo', 'solar', 'slice', 'tile', 'tunnel', 'pixel', 'glitch', 'ink', 'throb']);
    expect(fluxModuleBits(['warp', 'prism'])).toBe(0b101);
    expect(fluxModuleBits(['throb'])).toBe(1 << 11);
    expect(fluxModuleBits(['nope'])).toBe(0);
  });
  it('checks everything a phone sends', () => {
    const flux = readPhoneFlux({ x: 7, y: -3, energy: 'lots', mix: 0.4, blend: 99, active: true, beat: 1, modules: ['fold', 'fold', 'evil', 5] });
    expect(flux).toEqual({ x: 1, y: 0, energy: 0, mix: 0.4, blend: 6, active: true, beat: false, modules: ['fold'] });
    // Nothing selected means nothing plays, whatever the phone claims.
    expect(readPhoneFlux({ active: true, modules: [] }).active).toBe(false);
  });
  it('fades the wet amount in and out and settles exactly', () => {
    let gain = 0;
    for (let i = 0; i < 6; i++) gain = easeFluxGain(gain, 0.8, 0.016);
    expect(gain).toBeGreaterThan(0.6);
    expect(gain).toBeLessThan(0.8);
    for (let i = 0; i < 60; i++) gain = easeFluxGain(gain, 0.8, 0.016);
    expect(gain).toBe(0.8);
    for (let i = 0; i < 60; i++) gain = easeFluxGain(gain, 0, 0.016);
    expect(gain).toBe(0);
  });
});

describe('Flux screen boxes', () => {
  const screen = (x0: number, y0: number, x1: number, y1: number, extra: Record<string, unknown> = {}) => ({
    type: 'screen', visible: true,
    corners: { topLeft: { x: x0, y: y1 }, topRight: { x: x1, y: y1 }, bottomLeft: { x: x0, y: y0 }, bottomRight: { x: x1, y: y0 } },
    ...extra,
  });
  it('gives one box per visible screen, clamped to the frame', () => {
    expect(fluxRegionsFromLayers([screen(0, 0, 0.25, 1), screen(0.5, -0.2, 0.75, 1.3), screen(0.8, 0, 1, 1, { visible: false }), { type: 'media' }])).toEqual([[0, 0, 0.25, 1], [0.5, 0, 0.75, 1]]);
  });
  it('is empty without screens, so Flux covers the whole frame', () => {
    expect(fluxRegionsFromLayers([{ type: 'media' }])).toEqual([]);
  });
});
