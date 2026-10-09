import { describe, expect, it } from 'vitest';
import { defaultShow, normalizeShow, type Show } from './model';
import { MAX_BLOCKS, addBlock, blockTabs, deleteBlock, duplicateBlock, ensureOpenBlock, switchBlock } from './blocks';

function ids() { let n = 0; return () => `id-${++n}`; }
const apply = (show: Show, next: object | null): Show => (next ? { ...show, ...next } : show);
const clipsOf = (show: Show) => show.launchGrid[0].filter(Boolean);

describe('block tabs', () => {
  it('shows the deck of an older set as one open tab without changing the set', () => {
    const show = defaultShow();
    expect(show.scenes).toHaveLength(0);
    expect(blockTabs(show)).toEqual([{ id: '', name: 'Block 1', active: true }]);
    expect(show.scenes).toHaveLength(0);
  });

  it('adds an empty block and keeps the open one open, saving the deck first', () => {
    const makeId = ids();
    const start = defaultShow();
    const deck = clipsOf(start);
    const show = apply(start, addBlock(start, makeId));
    expect(blockTabs(show).map((t) => [t.name, t.active])).toEqual([['Block 1', true], ['Block 2', false]]);
    expect(clipsOf(show)).toEqual(deck);
    expect(show.scenes[0].launchGrid![0].filter(Boolean)).toEqual(deck);
    expect(show.scenes[1].launchGrid!.flat().filter(Boolean)).toEqual([]);
    expect(show.scenes[1].launchGrid).toHaveLength(start.launchGrid.length);
  });

  it('switches both ways without losing either deck, and leaves playing layers alone', () => {
    const makeId = ids();
    let show = defaultShow();
    const first = clipsOf(show);
    const layers = JSON.stringify(show.layers);
    show = apply(show, addBlock(show, makeId));
    show = apply(show, switchBlock(show, show.scenes[1].id, makeId));
    expect(blockTabs(show).map((t) => t.active)).toEqual([false, true]);
    expect(clipsOf(show)).toEqual([]);
    show.launchGrid[0][0] = first[2] as string; // edit the second block
    show = apply(show, switchBlock(show, show.scenes[0].id, makeId));
    expect(clipsOf(show)).toEqual(first);
    show = apply(show, switchBlock(show, show.scenes[1].id, makeId));
    expect(clipsOf(show)).toEqual([first[2]]);
    expect(JSON.stringify(show.layers)).toBe(layers);
    expect(switchBlock(show, show.scenes[1].id, makeId)).toBeNull(); // already open
  });

  it('keeps the deck of a set whose blocks were saved with none open', () => {
    const makeId = ids();
    let show = defaultShow();
    show = apply(show, addBlock(show, makeId));
    const legacy: Show = { ...show, activeBlockId: undefined, launchGrid: show.launchGrid.map((row) => [...row].reverse()) };
    const onScreen = clipsOf(legacy);
    expect(blockTabs(legacy).map((t) => [t.name, t.active])).toEqual([['Block 1', false], ['Block 2', false], ['Block 3', true]]);
    const next = apply(legacy, switchBlock(legacy, legacy.scenes[0].id, makeId));
    expect(next.scenes).toHaveLength(3);
    expect(next.scenes[2].launchGrid![0].filter(Boolean)).toEqual(onScreen);
  });

  it('duplicates as "<name> (copy)" next to the original with the current clips', () => {
    const makeId = ids();
    let show = defaultShow();
    show = apply(show, ensureOpenBlock(show, makeId));
    show.launchGrid[0][0] = null; // an edit not yet written to the block
    const result = duplicateBlock(show, show.scenes[0].id, makeId)!;
    show = apply(show, result);
    expect(show.scenes.map((b) => b.name)).toEqual(['Block 1', 'Block 1 (copy)']);
    expect(show.scenes[1].launchGrid![0][0]).toBeNull();
    expect(show.scenes[1].id).not.toBe(show.scenes[0].id);
    expect(show.activeBlockId).toBe(show.scenes[0].id);
  });

  it('never deletes the last block, and opens the first one left when the open block goes', () => {
    const makeId = ids();
    let show = defaultShow();
    expect(deleteBlock(show, '', makeId)).toBeNull();
    const first = clipsOf(show);
    show = apply(show, addBlock(show, makeId));
    show = apply(show, switchBlock(show, show.scenes[1].id, makeId));
    const gone = deleteBlock(show, show.scenes[1].id, makeId)!;
    show = apply(show, gone);
    expect(gone.removed.name).toBe('Block 2');
    expect(blockTabs(show)).toEqual([{ id: show.scenes[0].id, name: 'Block 1', active: true }]);
    expect(clipsOf(show)).toEqual(first);
    expect(deleteBlock(show, show.scenes[0].id, makeId)).toBeNull();
  });

  it('stops at the block limit and survives a save and load', () => {
    const makeId = ids();
    let show = defaultShow();
    for (let i = 0; i < MAX_BLOCKS + 3; i++) show = apply(show, addBlock(show, makeId));
    expect(show.scenes).toHaveLength(MAX_BLOCKS);
    expect(addBlock(show, makeId)).toBeNull();
    expect(duplicateBlock(show, show.scenes[0].id, makeId)).toBeNull();
    const loaded = normalizeShow(JSON.parse(JSON.stringify(show)));
    expect(loaded.scenes.map((b) => b.name)).toEqual(show.scenes.map((b) => b.name));
    expect(loaded.activeBlockId).toBe(show.activeBlockId);
  });
});

import { describe as describeDemo, it as itDemo, expect as expectDemo } from 'vitest';
import { defaultShow as demoDefault } from './model';
describeDemo('demo set', () => {
  itDemo('opens with three full blocks of shaders, the first one on the deck', () => {
    const show = demoDefault(true);
    expectDemo(show.scenes.map(b => b.name)).toEqual(['Block 1', 'Block 2', 'Block 3']);
    expectDemo(show.activeBlockId).toBe(show.scenes[0].id);
    expectDemo(show.scenes[0].launchGrid).toEqual(show.launchGrid);
    const known = new Set(show.clips.map(c => c.id));
    for (const block of show.scenes) {
      const visible = block.launchGrid!.slice(0, 4).flat();
      expectDemo(visible.every(id => !!id && known.has(id))).toBe(true);
      // No shader twice on the four visible rows of one block.
      expectDemo(new Set(visible).size).toBe(visible.length);
      // Every slot of every row is filled, on both decks.
      expectDemo(block.launchGrid!.length).toBe(8);
      expectDemo(block.launchGrid!.every(row => row.length === 8 && row.every(Boolean))).toBe(true);
    }
    // Blocks are different pages, not the same deck four times.
    expectDemo(show.scenes[1].launchGrid![0]).not.toEqual(show.scenes[0].launchGrid![0]);
  });
});
