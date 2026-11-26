/**
 * Beats and kits saved on this computer: a cap, and at the cap a new name is
 * refused with a message (saving over a name still works, nothing saved is
 * dropped); blocked storage never breaks loading.
 */
import { describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

vi.mock('../musicRuntime', () => ({ auditionMachineSound: () => {}, musicLead: () => 0, musicNow: () => 0, sendMachineHit: () => {}, setMachineHooks: () => {}, setMachineSound: () => {} }));
const { MAX_SAVED_BEATS, MAX_SAVED_KITS, saveBeatAs, saveKitAs, savedBeats, savedKits, withSaved } = await import('./machineRuntime');

describe('withSaved', () => {
  const item = (id: string) => ({ id });
  it('adds while there is room, saves over a match, refuses a new one at the cap', () => {
    expect(withSaved([item('a')], item('b'), (x) => x.id === 'b', 2, 'beat')).toEqual({ list: [item('a'), item('b')], result: { ok: true, id: 'b' } });
    const full = [item('a'), item('b')];
    const over = withSaved(full, { id: 'b', v: 2 } as { id: string }, (x) => x.id === 'b', 2, 'beat');
    expect(over.result.ok).toBe(true);
    expect(over.list).toHaveLength(2);
    const refused = withSaved(full, item('c'), (x) => x.id === 'c', 2, 'beat');
    expect(refused.result).toMatchObject({ ok: false });
    expect((refused.result as { reason: string }).reason).toMatch(/2 saved beats.*delete one/);
    expect(refused.list).toEqual(full);
  });
});

describe('saving beats and kits', () => {
  it('a new beat name at the cap is refused and changes nothing; the same name saves over', () => {
    savedBeats.set([]);
    expect(saveBeatAs('First').ok).toBe(true);
    const first = get(savedBeats)[0];
    savedBeats.set([first, ...Array.from({ length: MAX_SAVED_BEATS - 1 }, (_, i) => ({ ...first, id: `b${i}`, name: `Beat ${i}` }))]);
    const before = get(savedBeats);
    const r = saveBeatAs('One more');
    expect(r).toMatchObject({ ok: false });
    expect(get(savedBeats)).toBe(before);
    expect(saveBeatAs('First')).toEqual({ ok: true, id: first.id });
    expect(get(savedBeats)).toHaveLength(MAX_SAVED_BEATS);
    savedBeats.set([]);
  });

  it('a new kit at the cap is refused', () => {
    savedKits.set([]);
    const first = saveKitAs('Kit A');
    expect(first.ok).toBe(true);
    const kit = get(savedKits)[0];
    savedKits.set([kit, ...Array.from({ length: MAX_SAVED_KITS - 1 }, (_, i) => ({ ...kit, id: `user.k${i}`, name: `Kit ${i}` }))]);
    expect(saveKitAs('Kit Z')).toMatchObject({ ok: false });
    expect(get(savedKits)).toHaveLength(MAX_SAVED_KITS);
    expect(saveKitAs('Kit A').ok).toBe(true);
    expect(get(savedKits)).toHaveLength(MAX_SAVED_KITS);
    savedKits.set([]);
  });

  it('two saves in the same millisecond get their own ids', () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000);
    try {
      savedBeats.set([]);
      savedKits.set([]);
      const a = saveBeatAs('Beat A');
      const b = saveBeatAs('Beat B');
      expect(a.ok && b.ok).toBe(true);
      expect(new Set(get(savedBeats).map((x) => x.id)).size).toBe(2);
      expect(saveKitAs('Kit A').ok).toBe(true);
      expect(saveKitAs('Kit B').ok).toBe(true);
      const kits = get(savedKits);
      expect(kits.map((k) => k.name).sort()).toEqual(['Kit A', 'Kit B']);
      expect(new Set(kits.map((k) => k.id)).size).toBe(2);
      for (const k of kits) expect(k.id.startsWith('user.')).toBe(true);
    } finally {
      clock.mockRestore();
      savedBeats.set([]);
      savedKits.set([]);
    }
  });
});
