/** Insert effect chains: as many as you like per channel, reordered and bypassed, saved and loaded. */

import { describe, expect, it } from 'vitest';
import { defaultProjectState, normalizeProjectState } from './musicStudioStore';
import { MACRO_FX, createMacroFx } from './macroFx';

describe('insert effects', () => {
  it('keep any number of effects per channel, in order, through a save and load', () => {
    const chain = MACRO_FX.map((def, i) => ({ ...createMacroFx(`fx${i}`, def.type), enabled: i % 2 === 0 }));
    const state = { ...defaultProjectState(), inserts: { synth: chain, master: [createMacroFx('m1', 'compressor')] } };
    const back = normalizeProjectState(JSON.parse(JSON.stringify(state)));
    expect(back.inserts.synth.map((fx) => fx.type)).toEqual(MACRO_FX.map((d) => d.type));
    expect(back.inserts.synth.map((fx) => fx.enabled)).toEqual(chain.map((fx) => fx.enabled));
    expect(back.inserts.master[0].type).toBe('compressor');
  });

  it('offer the dub effects among the rest', () => {
    const types = MACRO_FX.map((d) => d.type);
    for (const t of ['tape', 'spring', 'eq', 'compressor', 'delay', 'reverb', 'filter', 'chorus', 'phaser', 'crush', 'drive'] as const) expect(types).toContain(t);
  });
});
