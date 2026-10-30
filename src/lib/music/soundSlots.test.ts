import { describe, expect, it } from 'vitest';
import {
  BOWL_KITS,
  DEFAULT_FX_PADS,
  bowlSlotNotes,
  defaultFxPads,
  normalizeBandFx,
  normalizeBowlSlots,
  normalizeDronePatch,
  normalizeFxPads,
} from './soundSlots';

describe('sound slots', () => {
  it('keeps the old shots on every set for a project saved before pads could be chosen', () => {
    const pads = normalizeFxPads(undefined);
    for (const set of ['bath', 'berlin', 'dub', 'analog'] as const) expect(pads[set]).toEqual(DEFAULT_FX_PADS.dub);
  });

  it('gives a new project each set its own pads', () => {
    expect(defaultFxPads().bath).toEqual(DEFAULT_FX_PADS.bath);
    expect(defaultFxPads().berlin).not.toEqual(DEFAULT_FX_PADS.dub);
  });

  it('keeps unknown but well-formed sound ids, and replaces broken ones', () => {
    const pads = normalizeFxPads({ dub: ['from-a-later-version', 42, '<script>'] });
    expect(pads.dub[0]).toBe('from-a-later-version');
    expect(pads.dub[1]).toBe(DEFAULT_FX_PADS.dub[1]);
    expect(pads.dub[2]).toBe(DEFAULT_FX_PADS.dub[2]);
    expect(pads.dub).toHaveLength(8);
  });

  it('fills and clamps the bowls', () => {
    const slots = normalizeBowlSlots([{ sound: 'gong', octave: -7 }, { sound: 'kalimba', octave: 1.6 }]);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual({ sound: 'gong', octave: -2 });
    expect(slots[1]).toEqual({ sound: 'kalimba', octave: 2 });
    expect(slots[4].sound).toBe('singing-bowl');
  });

  it("moves a bowl's note by its octave", () => {
    expect(bowlSlotNotes([50, 53, 57, 60, 64], [{ sound: 'a', octave: -1 }, { sound: 'b', octave: 0 }, { sound: 'c', octave: 1 }, { sound: 'd', octave: 0 }, { sound: 'e', octave: 2 }]))
      .toEqual([38, 53, 69, 60, 88]);
  });

  it('every bowl set has five bowls', () => {
    for (const kit of BOWL_KITS) expect(kit.slots).toHaveLength(5);
  });

  it('clamps the band effects and keeps feedback below runaway', () => {
    const fx = normalizeBandFx({ echoSend: 3, feedback: 1, echoTime: 'never', freezePitch: 7 });
    expect(fx.echoSend).toBe(1);
    expect(fx.feedback).toBeLessThanOrEqual(0.92);
    expect(fx.echoTime).toBe('3/16');
    expect(fx.freezePitch).toBe(0);
    expect(normalizeDronePatch(undefined)).toBe('warm');
  });
});
