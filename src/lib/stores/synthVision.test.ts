import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { synthVisionStore, SV_SHADER_DEFS } from './synthVision';
import type { Effect } from '../types';

function makeEffect(id: string): Effect {
  return { id, type: 'invert', enabled: true, params: {} } as Effect;
}

describe('synthVision store', () => {
  beforeEach(() => {
    synthVisionStore.reset();
  });

  describe('performer effect chain', () => {
    // Performer's effects must live here rather than on a VJ layer (shared
    // with grid clips on the same row) or on the active clip (replaced every
    // time Performer launches a new shader/world).
    it('adds, toggles and removes effects', () => {
      synthVisionStore.addPerformerEffect(makeEffect('a'));
      synthVisionStore.addPerformerEffect(makeEffect('b'));
      expect(get(synthVisionStore).performerEffects.map(e => e.id)).toEqual(['a', 'b']);

      synthVisionStore.togglePerformerEffect('a');
      expect(get(synthVisionStore).performerEffects[0].enabled).toBe(false);

      synthVisionStore.removePerformerEffect('a');
      expect(get(synthVisionStore).performerEffects.map(e => e.id)).toEqual(['b']);
    });

    it('merges param patches without dropping existing params', () => {
      const effect = makeEffect('a');
      effect.params = { amount: 0.2 } as any;
      synthVisionStore.addPerformerEffect(effect);

      synthVisionStore.updatePerformerEffectParams('a', { speed: 0.8 });
      expect(get(synthVisionStore).performerEffects[0].params).toEqual({ amount: 0.2, speed: 0.8 });
    });
  });

  describe('doFullRandom', () => {
    it('randomizes the params of the shader it selects', () => {
      // Regression: the Tab scramble changed the shader but left its dials at
      // their defaults, so the SHADER tab never appeared to react.
      const before = get(synthVisionStore);
      const beforeParams = JSON.stringify(before.shaderParams);

      // Run several times — one roll could coincidentally pick a param-less
      // shader, but not repeatedly.
      for (let i = 0; i < 12; i++) synthVisionStore.doFullRandom();

      const after = get(synthVisionStore);
      expect(JSON.stringify(after.shaderParams)).not.toBe(beforeParams);

      // Whatever shader ended up selected must have concrete param values.
      const shaderIdx = after.layers[after.focus].sh;
      const def = SV_SHADER_DEFS[shaderIdx];
      if (def?.params?.length) {
        const params = after.shaderParams[shaderIdx];
        for (const p of def.params) {
          expect(typeof params[p.k]).toBe('number');
          expect(params[p.k]).toBeGreaterThanOrEqual(0);
          expect(params[p.k]).toBeLessThanOrEqual(1);
        }
      }
    });

    it('still randomizes world params for the selected world', () => {
      for (let i = 0; i < 12; i++) synthVisionStore.doFullRandom();
      const s = get(synthVisionStore);
      const worldIdx = s.layers[s.focus].world;
      expect(s.worldParams[worldIdx]).toBeDefined();
    });
  });
});
