import { describe, it, expect } from 'vitest';
import {
  INTERACTIVE_STARTERS,
  starterScene,
  readInteractiveDraft,
  writeInteractiveDraft,
  saveInteractivePreset,
  readInteractivePresets,
  removeInteractivePreset,
  restoreInteractivePreset,
} from './interactiveLibrary';
import { validateScene } from './interactive';
const storage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
};
describe('mobile interactive scenes', () => {
  it.each(INTERACTIVE_STARTERS)('$name has portable effects and valid object targets', ({ id }) => {
    const s = starterScene(id);
    expect(validateScene(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(s.effects!.length).toBeGreaterThan(0);
    for (const e of s.effects!) expect(e.target === 'point' || s.surfaces.some((o) => o.id === e.target)).toBe(true);
  });
  it('creates independent scenes without changing a previously edited starter', () => {
    const a = starterScene('fire'),
      b = starterScene('fire');
    const original = b.effects![0].params.flow;
    a.effects![0].params.flow = 0;
    expect(b.effects![0].params.flow).toBe(original);
    expect(original).toBeGreaterThan(0);
    expect(a.effects![0].id).not.toBe(b.effects![0].id);
  });
  it('roundtrips draft, modulation, Auto and named presets without conflating them', () => {
    const store = storage(),
      s = starterScene('fire');
    s.effects![0].mods.heat = { source: 'lfo-sine', amount: 0.2, speed: 0.1, invert: false };
    writeInteractiveDraft(store, s);
    saveInteractivePreset(store, s);
    s.name = 'Edited draft';
    writeInteractiveDraft(store, s);
    expect(readInteractiveDraft(store)?.name).toBe('Edited draft');
    expect(readInteractivePresets(store)[0].scene.name).toBe('Ignite');
    expect(readInteractiveDraft(store)?.effects![0].mods.heat.source).toBe('lfo-sine');
  });
  it('recovers an older save if the draft is corrupt', () => {
    const store = storage();
    store.setItem('ghost-interactive-draft-v2', 'bad');
    store.setItem('ghost-interactive-scene-v1', JSON.stringify(starterScene('balls')));
    expect(readInteractiveDraft(store)?.name).toBe('Kinetic play');
  });
  it('surfaces a storage failure instead of claiming a save', () => {
    expect(() =>
      writeInteractiveDraft(
        {
          getItem: () => null,
          setItem: () => {
            throw Error('full');
          },
        },
        starterScene('light'),
      ),
    ).toThrow('full');
  });
});

it('removing a saved scene can be undone without changing the live draft', () => {
  const store = storage(),
    s = starterScene('light');
  writeInteractiveDraft(store, s);
  const saved = saveInteractivePreset(store, s)[0];
  expect(removeInteractivePreset(store, saved.id)).toEqual([]);
  expect(readInteractiveDraft(store)?.name).toBe(s.name);
  expect(restoreInteractivePreset(store, saved)[0].id).toBe(saved.id);
  expect(restoreInteractivePreset(store, saved)).toHaveLength(1);
});
