import { describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import type { Effect } from '../types';
import { createEffectChainPresetLibrary, instantiateEffectChain, parseEffectChainPresets } from './effectChainPresets';

const chain = (): Effect[] => [{ id: 'original', type: 'blur', enabled: false, params: { amount: 0.4 }, opacity: 0.6, blendMode: 'normal', paramAuto: { amount: { phase: .3, timing: 'beat', cycleBeats: 8, easing: 'sine', mode: 'pingpong', speedHz: .5, min: 0, max: 1, playing: true } } }];
function storage() {
  let raw: string | null = null;
  return { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
}
describe('user effect-chain library', () => {
  it('persists the complete chain and isolates saved and applied parameters', () => {
    const disk = storage();
    const library = createEffectChainPresetLibrary(disk);
    const source = chain();
    library.save('  Soft texture  ', source);
    source[0].params.amount = 9;
    const reopened = get(createEffectChainPresetLibrary(disk)).presets[0];
    expect(reopened.name).toBe('Soft texture');
    expect(reopened.effects[0]).toMatchObject({ enabled: false, opacity: 0.6, blendMode: 'normal', params: { amount: .4 } });
    const first = instantiateEffectChain(reopened.effects);
    const second = instantiateEffectChain(reopened.effects);
    expect(new Set([source[0].id, reopened.effects[0].id, first[0].id, second[0].id]).size).toBe(4);
    expect(first[0].paramAuto).toEqual(source[0].paramAuto);
    first[0].paramAuto!.amount.phase = .9;
    expect(second[0].paramAuto!.amount.phase).toBe(.3);
    first[0].params.amount = 8;
    expect(second[0].params.amount).toBe(.4);
    expect(reopened.effects[0].params.amount).toBe(.4);
  });
  it('does not publish a save that failed to persist', () => {
    const library = createEffectChainPresetLibrary({ getItem: () => null, setItem: () => { throw new Error('Storage full'); } });
    expect(() => library.save('New', chain())).toThrow('Storage full');
    expect(get(library).presets).toEqual([]);
  });
  it('preserves unreadable libraries and prevents accidental overwrite', () => {
    const disk = storage(); disk.setItem('', '{broken');
    const library = createEffectChainPresetLibrary(disk);
    expect(get(library).error).toContain('preserved');
    expect(() => library.save('New', chain())).toThrow();
    expect(disk.getItem()).toBe('{broken');
  });
  it('rejects empty, duplicate and unknown chains and deletes only the selected preset', () => {
    const library = createEffectChainPresetLibrary(storage());
    expect(() => library.save('Empty', [])).toThrow();
    const id = library.save('One', chain());
    expect(() => library.save(' one ', chain())).toThrow('already saved');
    library.save('Two', chain()); library.remove(id);
    expect(get(library).presets.map(p => p.name)).toEqual(['Two']);
    expect(() => parseEffectChainPresets(JSON.stringify([{ id: 'a', name: 'Bad', effects: [{ ...chain()[0], type: 'unknown-effect' }] }]))).toThrow();
  });
});

describe('portable preset libraries', () => {
  it('round-trips chains and resolves name collisions without replacing existing presets', () => {
    const source = createEffectChainPresetLibrary(storage());
    const originalId = source.save('Texture', chain());
    const target = createEffectChainPresetLibrary(storage());
    target.save('Texture', chain());
    const ids = target.importLibrary(source.exportLibrary());
    const imported = get(target).presets[1];
    expect(get(target).presets.map(p => p.name)).toEqual(['Texture', 'Texture (2)']);
    expect(ids).toEqual([imported.id]);
    expect(imported.id).not.toBe(originalId);
    expect(imported.effects[0].id).not.toBe(get(source).presets[0].effects[0].id);
    expect(imported.effects[0].paramAuto).toEqual(chain()[0].paramAuto);
  });
  it('rejects an entire malformed file before changing the library', () => {
    const library = createEffectChainPresetLibrary(storage());
    library.save('Existing', chain());
    const snapshot = library.exportLibrary();
    const file = JSON.parse(snapshot);
    file.presets.push({ id: 'bad', name: 'Bad', effects: [{ ...chain()[0], paramAuto: { amount: { speedHz: 'fast' } } }] });
    expect(() => library.importLibrary(JSON.stringify(file))).toThrow('automation');
    expect(library.exportLibrary()).toBe(snapshot);
    expect(() => library.importLibrary('{"format":"other","version":1}')).toThrow('Ghost Arcade');
    expect(() => library.importLibrary('x'.repeat(32 * 1024 * 1024 + 1))).toThrow('32 MB');
  });
  it.each(['crossfader', 'clip'] as const)('transfers the %s driver without changing its curve or range', driver => {
    const source = createEffectChainPresetLibrary(storage());
    const effects = chain();
    effects[0].paramAuto!.amount.timing = driver;
    source.save('Fader wash', effects);
    const target = createEffectChainPresetLibrary(storage());
    target.importLibrary(source.exportLibrary());
    expect(get(target).presets[0].effects[0].paramAuto).toEqual(effects[0].paramAuto);
  });
  it('preserves reversed Auto ranges and rejects unknown curves', () => {
    const library = createEffectChainPresetLibrary(storage());
    const effects = chain();
    effects[0].paramAuto!.amount.min = 1;
    effects[0].paramAuto!.amount.max = 0;
    library.save('Reverse', effects);
    const target = createEffectChainPresetLibrary(storage());
    target.importLibrary(library.exportLibrary());
    expect(get(target).presets[0].effects[0].paramAuto!.amount).toMatchObject({ min: 1, max: 0, easing: 'sine' });
    expect(() => target.importLibrary(library.exportLibrary().replace('"sine"', '"unknown"'))).toThrow('automation');
  });
  it('does not publish imports after a storage failure', () => {
    const source = createEffectChainPresetLibrary(storage()); source.save('Texture', chain());
    const target = createEffectChainPresetLibrary({ getItem: () => null, setItem: () => { throw new Error('Full'); } });
    expect(() => target.importLibrary(source.exportLibrary())).toThrow('Full');
    expect(get(target).presets).toEqual([]);
  });
  it('bounds collision names and rejects prototype keys and nonfinite values', () => {
    const library = createEffectChainPresetLibrary(storage());
    library.save('a'.repeat(80), chain());
    library.importLibrary(library.exportLibrary());
    expect(get(library).presets[1].name).toHaveLength(80);
    const raw = library.exportLibrary().replace('"amount": 0.4', '"__proto__": {"polluted":true}');
    expect(() => library.importLibrary(raw)).toThrow('property');
    expect(() => parseEffectChainPresets('[{"id":"x","name":"X","effects":[{"id":"e","type":"blur","enabled":true,"params":{"amount":1e999}}]}]')).toThrow('number');
  });
});


describe('portable LUT presets', () => {
  it('exports and reimports an embedded LUT and rejects damaged tables atomically', async () => {
    const { parseCubeLut } = await import('../color/cubeLut');
    const lut = parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1');
    const library = createEffectChainPresetLibrary(storage());
    library.save('Look', [{ id: 'look', type: 'cubeLut', enabled: true, params: { cubeLut: lut, lutStrength: .75 } }]);
    const second = createEffectChainPresetLibrary(storage());
    second.importLibrary(library.exportLibrary());
    expect(get(second).presets[0].effects[0].params).toEqual({ cubeLut: lut, lutStrength: .75 });
    const broken = get(second).presets.map(p => ({ ...p, effects: p.effects.map(e => ({ ...e, params: { ...e.params, cubeLut: { ...lut, rgba: [0] } } })) }));
    expect(() => parseEffectChainPresets(JSON.stringify(broken))).toThrow('Invalid saved');
  });
});
