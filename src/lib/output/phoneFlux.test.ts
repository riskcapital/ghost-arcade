import { describe, expect, it, vi } from 'vitest';
vi.mock('../api/native-renderer', () => ({ submitNativeRendererCommands: vi.fn(async () => undefined) }));
import { easeFluxGain, fluxModuleBits, readPhoneFlux, FLUX_MODULE_BITS } from './phoneFlux';

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
