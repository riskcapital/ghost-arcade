import { describe, expect, it } from 'vitest';
import { DROP_FX, STROBE_MAX_HZ, dropFxEffects, dropFxEnvelope } from './dropFx';
import { normalizeBuildSettings } from './buildDrop';

describe('drop FX', () => {
  it('creeps in with the build, hits on the drop and lets go over the release', () => {
    expect(dropFxEnvelope({ phase: 'build', progress: 0, sinceDrop: 0 }, 1, 4)).toBe(0);
    expect(dropFxEnvelope({ phase: 'build', progress: 1, sinceDrop: 0 }, 1, 4)).toBeCloseTo(0.4);
    expect(dropFxEnvelope({ phase: 'release', progress: 0, sinceDrop: 0 }, 0.8, 4)).toBeCloseTo(0.8);
    const mid = dropFxEnvelope({ phase: 'release', progress: 0, sinceDrop: 2 }, 1, 4);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(0.5);
    expect(dropFxEnvelope({ phase: 'release', progress: 0, sinceDrop: 4 }, 1, 4)).toBe(0);
  });

  it('never strobes faster than the cap, even at a fast tempo', () => {
    const [fx] = dropFxEffects('strobe', 1, 0, 200 / 60, () => ({}));
    expect(fx.params.strobeRate).toBeLessThanOrEqual(STROBE_MAX_HZ);
  });

  it('builds every look from effects tagged as the drop\'s, with the envelope as the mix', () => {
    for (const def of DROP_FX) {
      for (const e of dropFxEffects(def.id, 0.5, 1, 2, () => ({}))) {
        expect(e.id.startsWith('drop-fx:')).toBe(true);
        expect(e.opacity).toBe(0.5);
      }
    }
    expect(dropFxEffects('none', 1, 0, 2, () => ({}))).toEqual([]);
  });

  it('keeps the drop FX settings, and falls back on bad ones', () => {
    const b = normalizeBuildSettings({ dropFx: 'kaleido', dropFxAmount: 0.5, dropFxRelease: 8 }, []);
    expect([b.dropFx, b.dropFxAmount, b.dropFxRelease]).toEqual(['kaleido', 0.5, 8]);
    const bad = normalizeBuildSettings({ dropFx: 'lasers', dropFxRelease: 3 }, []);
    expect([bad.dropFx, bad.dropFxRelease]).toEqual(['none', 4]);
  });
});
