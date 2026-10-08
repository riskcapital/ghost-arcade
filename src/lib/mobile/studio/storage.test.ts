import { describe, expect, it, vi } from 'vitest';
import {
  defaultShow, saveShow, saveCurrentShow, savedSets, upsertSet, removeSet, renameSet, writeSetBank, setBankFull,
  referencedAssetIds, renameBlock, removeBlock, History, MAX_SAVED_SETS, SETS_KEY, STORAGE_KEY, type Show,
} from './model';
import { formatBytes, totalBytes, unusedAssets } from './assets';

function memoryStorage() {
  const data = new Map<string, string>();
  const log = { reads: 0, writes: [] as Array<{ key: string; bytes: number }> };
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => { log.reads++; return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { log.writes.push({ key, bytes: value.length }); data.set(key, value); },
  });
  return { data, log };
}
const named = (name: string): Show => ({ ...defaultShow(), name });

describe('saved sets', () => {
  it('never drops an older set when the device is full', () => {
    let bank: Show[] = [];
    for (let i = 0; i < MAX_SAVED_SETS; i++) bank = upsertSet(bank, named(`Set ${i + 1}`)).bank;
    expect(bank).toHaveLength(MAX_SAVED_SETS);
    const extra = named('One too many');
    const result = upsertSet(bank, extra);
    expect(result.full).toBe(true);
    expect(result.bank).toBe(bank);
    expect(result.bank.map(s => s.name)).toContain('Set 1');
    expect(setBankFull(bank)).toBe(true);
    // A set already in the list can always be saved again.
    const again = upsertSet(bank, { ...bank[5], name: 'Renamed' });
    expect(again.full).toBe(false);
    expect(again.bank).toHaveLength(MAX_SAVED_SETS);
    expect(again.bank[0].name).toBe('Renamed');
  });
  it('the exit-path save keeps all sets too', () => {
    const { data } = memoryStorage();
    try {
      const bank = Array.from({ length: MAX_SAVED_SETS }, (_, i) => named(`Set ${i + 1}`));
      writeSetBank(bank);
      saveShow(named('Twenty-fifth'));
      const names = savedSets().map(s => s.name);
      expect(names).toHaveLength(MAX_SAVED_SETS);
      expect(names).toContain('Set 24');
      expect(names).not.toContain('Twenty-fifth');
      expect(JSON.parse(data.get(STORAGE_KEY)!).name).toBe('Twenty-fifth');
    } finally { vi.unstubAllGlobals(); }
  });
  it('renames and deletes by id', () => {
    const a = named('A'), b = named('B');
    expect(renameSet([a, b], b.id, '  Friday rig  ').map(s => s.name)).toEqual(['A', 'Friday rig']);
    expect(renameSet([a, b], b.id, '   ')).toEqual([a, b]);
    expect(removeSet([a, b], a.id)).toEqual([b]);
  });
  it('autosave writes only the set being played and reads nothing back', () => {
    const { log } = memoryStorage();
    try {
      writeSetBank(Array.from({ length: MAX_SAVED_SETS }, (_, i) => named(`Set ${i + 1}`)));
      const bankBytes = log.writes[0].bytes;
      log.writes.length = 0; log.reads = 0;
      const show = named('Tonight');
      for (let i = 0; i < 20; i++) saveCurrentShow(show);
      expect(log.reads).toBe(0);
      expect(log.writes.every(w => w.key === STORAGE_KEY)).toBe(true);
      expect(log.writes.some(w => w.key === SETS_KEY)).toBe(false);
      expect(log.writes[0].bytes).toBeLessThan(bankBytes / 10);
    } finally { vi.unstubAllGlobals(); }
  });
});

describe('blocks', () => {
  it('can be renamed and deleted, clearing the current-block marker', () => {
    const show = defaultShow();
    show.scenes = [
      { id: 'a', name: 'Block 1', layers: show.layers, crossfade: 0 },
      { id: 'b', name: 'Block 2', layers: show.layers, crossfade: 0 },
    ];
    show.activeBlockId = 'b';
    expect(renameBlock(show, 'a', ' Intro ').map(b => b.name)).toEqual(['Intro', 'Block 2']);
    expect(renameBlock(show, 'a', '')).toBe(show.scenes);
    const afterOther = removeBlock(show, 'a');
    expect(afterOther.scenes.map(b => b.id)).toEqual(['b']);
    expect(afterOther.activeBlockId).toBe('b');
    expect(removeBlock(show, 'b').activeBlockId).toBeUndefined();
  });
});

describe('imported media', () => {
  it('counts a file as unused only when no set, saved set or undo state uses it', () => {
    const current = defaultShow(), saved = defaultShow(), undone = defaultShow();
    current.clips.push({ id: 'c1', assetId: 'in-current', kind: 'video', name: 'a.mp4' });
    saved.clips.push({ id: 'c2', assetId: 'in-saved', kind: 'image', name: 'b.jpg' });
    undone.clips.push({ id: 'c3', assetId: 'in-undo', kind: 'image', name: 'c.jpg' });
    const history = new History();
    history.push(undone);
    const referenced = referencedAssetIds([current, saved, ...history.states]);
    const all = ['in-current', 'in-saved', 'in-undo', 'orphan-1', 'orphan-2'].map((id, i) => ({ id, bytes: (i + 1) * 1_000_000, type: 'video/mp4' }));
    const unused = unusedAssets(all, referenced);
    expect(unused.map(a => a.id)).toEqual(['orphan-1', 'orphan-2']);
    expect(totalBytes(unused)).toBe(9_000_000);
  });
  it('formats sizes for the storage summary', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(830_000)).toBe('830 KB');
    expect(formatBytes(9_000_000)).toBe('9.0 MB');
    expect(formatBytes(124_600_000)).toBe('125 MB');
    expect(formatBytes(2_300_000_000)).toBe('2.3 GB');
  });
});
