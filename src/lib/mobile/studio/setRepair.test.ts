import { describe, expect, it } from 'vitest';
import { SET_REV, defaultShow, fullFramePoints, gridPoints, normalizeShow, type Show } from './model';
import { needsRepair, repairSet, repairSummary, setProblems } from './setRepair';
import { moveBlock, addBlock, blockTabs } from './blocks';

/** A set as app 1.0 wrote it: no revision, all rows Normal, and (optionally) the Map tab visited. */
function firstVersionSet(mapVisited = true): Show {
  const show = defaultShow();
  delete show.rev;
  show.layers = show.layers.map((l) => ({ ...l, blend: 'normal' as const }));
  show.mapping = mapVisited;
  show.surfaces[0] = { ...show.surfaces[0], points: gridPoints() };
  // Through the same door a saved or imported set comes in.
  return normalizeShow(JSON.parse(JSON.stringify(show)));
}

describe('one-time repair of sets saved by app 1.0', () => {
  it('a new set carries the revision and is never offered a repair', () => {
    const show = defaultShow();
    expect(show.rev).toBe(SET_REV);
    const allNormal = { ...show, mapping: true, layers: show.layers.map((l) => ({ ...l, blend: 'normal' as const })), surfaces: [{ ...show.surfaces[0], points: gridPoints() }] };
    expect(needsRepair(setProblems(allNormal))).toBe(false);
    expect(normalizeShow(JSON.parse(JSON.stringify(show))).rev).toBe(SET_REV);
  });
  it('loading a 1.0 set changes nothing by itself', () => {
    const show = firstVersionSet();
    expect(show.rev).toBeUndefined();
    expect(show.layers.every((l) => l.blend === 'normal')).toBe(true);
    expect(show.mapping).toBe(true);
    expect(show.surfaces[0].points[0]).toEqual({ x: 0.08, y: 0.08 });
  });
  it('finds hidden lower rows and the 8% inset', () => {
    const problems = setProblems(firstVersionSet());
    expect(problems).toEqual({ hiddenDecks: [0], inset: true });
    expect(repairSummary(problems)).toBe('This set was saved by an older version: clips on the lower rows are hidden behind row 1, and the picture sits inside a black border.');
    expect(setProblems({ ...firstVersionSet(), dualDeck: true }).hiddenDecks).toEqual([0, 1]);
  });
  it('leaves alone what the performer set up', () => {
    const blended = firstVersionSet();
    blended.layers[2] = { ...blended.layers[2], blend: 'add' };
    expect(setProblems(blended).hiddenDecks).toEqual([]);
    const moved = firstVersionSet();
    moved.surfaces[0].points[0] = { x: 0.1, y: 0.08 };
    expect(setProblems(moved).inset).toBe(false);
    const two = firstVersionSet();
    two.surfaces = [two.surfaces[0], { ...two.surfaces[0], id: 'b' }];
    expect(setProblems(two).inset).toBe(false);
    expect(setProblems(firstVersionSet(false)).inset).toBe(false); // mapping off: normalizeShow already starts it full-frame
    expect(repairSummary({ hiddenDecks: [], inset: false })).toBe('');
  });
  it('repairs blends and the inset, keeps everything else, and does not touch the original', () => {
    const before = firstVersionSet();
    const snapshot = JSON.stringify(before);
    const after = repairSet(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(after.layers.slice(0, 4).map((l) => l.blend)).toEqual(['screen', 'screen', 'screen', 'normal']);
    expect(after.layers.slice(4).map((l) => l.blend)).toEqual(['normal', 'normal', 'normal', 'normal']); // deck B is not in use
    expect(after.surfaces[0].points).toEqual(fullFramePoints());
    expect(after.mapping).toBe(false);
    expect(after.rev).toBe(SET_REV);
    expect(needsRepair(setProblems(after))).toBe(false);
    expect({ ...after, layers: 0, surfaces: 0, mapping: 0, rev: 0 }).toEqual({ ...before, layers: 0, surfaces: 0, mapping: 0, rev: 0 });
    expect(after.layers.map((l) => ({ ...l, blend: '' }))).toEqual(before.layers.map((l) => ({ ...l, blend: '' })));
  });
  it('keeps mapping on when the starter surface is in use', () => {
    const show = firstVersionSet();
    show.surfaces[0] = { ...show.surfaces[0], feather: 0.1 };
    const after = repairSet(show);
    expect(after.mapping).toBe(true);
    expect(after.surfaces[0].points).toEqual(fullFramePoints());
    expect(after.surfaces[0].feather).toBe(0.1);
  });
});

describe('moving block tabs', () => {
  const ids = () => { let n = 0; return () => `id-${++n}`; };
  it('moves a block, keeps the open one open and the deck as it is', () => {
    const makeId = ids();
    let show = defaultShow();
    for (let i = 0; i < 3; i++) show = { ...show, ...addBlock(show, makeId)! };
    const deck = JSON.stringify(show.launchGrid);
    expect(blockTabs(show).map((t) => t.name)).toEqual(['Block 1', 'Block 2', 'Block 3', 'Block 4']);
    const moved = { ...show, ...moveBlock(show, 0, 2, makeId)! };
    expect(blockTabs(moved).map((t) => [t.name, t.active])).toEqual([['Block 2', false], ['Block 3', false], ['Block 1', true], ['Block 4', false]]);
    expect(JSON.stringify(moved.launchGrid)).toBe(deck);
    expect(moved.activeBlockId).toBe(show.activeBlockId);
    const back = { ...moved, ...moveBlock(moved, 3, 0, makeId)! };
    expect(blockTabs(back).map((t) => t.name)).toEqual(['Block 4', 'Block 2', 'Block 3', 'Block 1']);
  });
  it('refuses moves that go nowhere, clamps the target, and survives a reload', () => {
    const makeId = ids();
    let show = defaultShow();
    show = { ...show, ...addBlock(show, makeId)! };
    expect(moveBlock(show, 1, 1, makeId)).toBeNull();
    expect(moveBlock(show, 5, 0, makeId)).toBeNull();
    const moved = { ...show, ...moveBlock(show, 0, 99, makeId)! };
    expect(blockTabs(moved).map((t) => t.name)).toEqual(['Block 2', 'Block 1']);
    expect(blockTabs(normalizeShow(JSON.parse(JSON.stringify(moved)))).map((t) => [t.name, t.active])).toEqual([['Block 2', false], ['Block 1', true]]);
  });
  it('turns the deck of an older set into a block before moving', () => {
    const show = defaultShow();
    expect(moveBlock(show, 0, 1, ids())).toBeNull(); // one tab only
    expect(show.scenes).toHaveLength(0);
  });
});
