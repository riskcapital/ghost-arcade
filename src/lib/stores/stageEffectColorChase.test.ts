import { describe, expect, it, vi } from 'vitest';
vi.mock('./audio', async () => {
  const { writable } = await import('svelte/store');
  return { audioStore: writable({ isActive: false }) };
});
vi.mock('./launchClock', () => ({ launchClockPosition: () => ({ beat: 0, beatMs: 500 }), launchClockFollowsLink: () => false }));
vi.mock('../audio/visualAudio', () => ({ getVisualAudioSnapshot: () => ({ level: 0 }) }));
import type { StageEffect, StageEffectType } from '../types';
import {
  STAGE_EFFECT_CATALOG, chaseOrderIndices, clearScreenStageEffectState, evaluateStageEffectForScreen,
  evaluateStageEffectOutputForScreen, stageEffectScreenOutput, appendChaseOrder,
} from './stageEffects';

/**
 * Screen FX colour chases and click-to-order. Effects saved before colour
 * chases (no `output`, no `order`) must evaluate exactly as they did.
 */

const DETERMINISTIC: StageEffectType[] = STAGE_EFFECT_CATALOG
  .map((def) => def.type)
  .filter((type) => !['random-hits', 'audio-rms-intensity', 'beat-pulse'].includes(type));

describe('old Screen FX are unchanged', () => {
  it('has the 17 chases', () => expect(STAGE_EFFECT_CATALOG).toHaveLength(17));

  it('gives every deterministic chase the same brightness and no tint', () => {
    for (const type of DETERMINISTIC) {
      const def = STAGE_EFFECT_CATALOG.find((d) => d.type === type)!;
      const effect: StageEffect = { id: `fx-${type}`, type, enabled: true, opacity: 0.8, params: { ...def.defaultParams } };
      for (let i = 0; i < 6; i++) {
        for (const t of [0.1, 0.9, 2.35]) {
          const cx = 0.1 + i * 0.15, cy = 0.3 + (i % 2) * 0.4;
          const old = evaluateStageEffectForScreen(`old-${i}`, type, effect.params, cx, cy, t, { effectId: effect.id, opacity: 0.8, sliceIndex: i, sliceCount: 6 });
          const out = evaluateStageEffectOutputForScreen(`new-${i}`, effect, cx, cy, t, { sliceIndex: i, sliceCount: 6 });
          expect(out.tint, type).toBeNull();
          expect(out.brightness, `${type} @${t}`).toBeCloseTo(Math.max(0, Math.min(1, old)), 6);
          clearScreenStageEffectState(`old-${i}`);
          clearScreenStageEffectState(`new-${i}`);
        }
      }
    }
  });
});

describe('colour chases', () => {
  const base = { output: 'color' as const, color: '#ff0000', color2: '#0000ff', opacity: 1 };

  it('blends from the rest colour to the lit colour and leaves brightness alone', () => {
    expect(stageEffectScreenOutput(base, 1, 0, 4, 0)).toEqual({ brightness: 1, tint: [1, 0, 0] });
    expect(stageEffectScreenOutput(base, 0, 0, 4, 0)).toEqual({ brightness: 1, tint: [0, 0, 1] });
    const both = stageEffectScreenOutput({ ...base, output: 'both' }, 0.25, 0, 4, 0);
    expect(both.brightness).toBeCloseTo(0.25);
    expect(both.tint![0]).toBeCloseTo(0.25);
  });

  it('scales the tint by the effect opacity (wet/dry)', () => {
    const half = stageEffectScreenOutput({ ...base, opacity: 0.5 }, 1, 0, 4, 0);
    expect(half.tint).toEqual([1, 0.5, 0.5]);
  });

  it('walks the hue wheel along the chase order in rainbow style', () => {
    const hue = (i: number) => stageEffectScreenOutput({ ...base, colorStyle: 'rainbow', color2: '#000000' }, 1, i, 3, 0).tint;
    expect(hue(0)).toEqual([1, 0, 0]);
    expect(hue(1)![1]).toBeCloseTo(1);
    expect(hue(2)![2]).toBeCloseTo(1);
  });
});

describe('custom chase order', () => {
  it('puts clicked screens first, in click order, and the rest after', () => {
    const screens = [['a'], ['b'], ['c'], ['d'], ['e']];
    expect(chaseOrderIndices(screens)).toEqual([0, 1, 2, 3, 4]);
    expect(chaseOrderIndices(screens, ['d', 'b', 'e'])).toEqual([3, 1, 4, 0, 2]);
    // Either id of a screen (slice or bound layer) places it.
    expect(chaseOrderIndices([['s1', 'l1'], ['s2', 'l2']], ['l2'])).toEqual([1, 0]);
  });

  it('drives the chase head around the drawn ring', () => {
    const def = STAGE_EFFECT_CATALOG.find((d) => d.type === 'chase')!;
    const effect: StageEffect = { id: 'ring', type: 'chase', enabled: true, opacity: 1, params: { ...def.defaultParams, speed: 1, width: 0.1 }, output: 'color', order: ['e', 'a', 'c', 'b', 'd'] };
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const index = chaseOrderIndices(ids.map((id) => [id]), effect.order);
    // At t = k/5 the head sits on the k-th clicked screen.
    effect.order!.forEach((id, k) => {
      const reds = ids.map((screen, i) => evaluateStageEffectOutputForScreen(`ring-${screen}`, effect, 0.5, 0.5, k / 5 + 0.001, { sliceIndex: index[i], sliceCount: 5 }).tint![0]);
      expect(ids[reds.indexOf(Math.max(...reds))]).toBe(id);
    });
  });

  it('records each screen once, in click order', () => {
    let order: string[] = [];
    for (const id of ['c', 'a', 'c', null, 'b']) order = appendChaseOrder(order, id);
    expect(order).toEqual(['c', 'a', 'b']);
  });
});
