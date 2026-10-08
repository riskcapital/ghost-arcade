import { describe, it, expect } from 'vitest';
import { pickEditorClipRow, pickEditorClipSlot, pickPhoneClipSlot, type InteractiveClipLike } from './studioTargets';

const video = (id: string): InteractiveClipLike => ({ id });
const desk = (id: string): InteractiveClipLike => ({ id, effectSource: { interactiveScene: {} } });
const phone = (id: string, owner: string): InteractiveClipLike => ({
  id,
  effectSource: { interactiveScene: {}, interactiveRemote: owner },
});
const row = (...clips: InteractiveClipLike[]) => [...clips, ...Array(8).fill(null)].slice(0, 8);

describe('Interactive clip for the desktop Studio (VJ mode)', () => {
  it('edits the Interactive clip that is playing', () => {
    expect(pickEditorClipSlot(row(video('v'), desk('i')), 1, 8)).toEqual({ col: 1, create: false, addColumn: false });
  });

  it('reuses an Interactive clip in the row instead of adding one per open', () => {
    // A video is playing; the row already has an Interactive clip.
    expect(pickEditorClipSlot(row(video('v'), desk('i')), 0, 8)).toEqual({ col: 1, create: false, addColumn: false });
  });

  it('creates in the first free slot when the row has none', () => {
    expect(pickEditorClipSlot(row(video('v')), 0, 8)).toEqual({ col: 1, create: true, addColumn: false });
  });

  it('adds a column only for a new clip in a full row, and stops at the limit', () => {
    const full = Array.from({ length: 8 }, (_, i) => video(`v${i}`));
    expect(pickEditorClipSlot(full, 0, 8)).toEqual({ col: 8, create: true, addColumn: true });
    expect(pickEditorClipSlot(full, 0, 8, 8)).toBeNull();
  });

  it('never offers a phone-owned clip to the desktop editor', () => {
    expect(pickEditorClipSlot(row(phone('p', 'a')), 0, 8)).toEqual({ col: 1, create: true, addColumn: false });
  });

  it('picks the row that already holds an Interactive clip when none is selected', () => {
    const grid = [row(video('v')), row(), row(video('w'), desk('i'))];
    expect(pickEditorClipRow(grid, [0, null, 0])).toBe(2);
    expect(pickEditorClipRow([row(video('v')), row()], [0, null])).toBe(0);
  });
});

describe('Interactive clip for a paired phone (VJ mode)', () => {
  it('uses an idle row and launches there, leaving the playing row alone', () => {
    const grid = [row(video('v')), row()];
    expect(pickPhoneClipSlot(grid, [0, null], 'a', 8)).toEqual({ row: 1, col: 0, create: true, launch: true });
  });

  it('does not launch over a playing clip when every row is busy', () => {
    const grid = [row(video('v')), row(video('w'))];
    expect(pickPhoneClipSlot(grid, [0, 0], 'a', 8)).toEqual({ row: 0, col: 1, create: true, launch: false });
  });

  it('reuses the phone clip and never another phone or desktop clip', () => {
    const grid = [row(desk('i'), phone('pb', 'b'), phone('pa', 'a')), row()];
    expect(pickPhoneClipSlot(grid, [null, null], 'a', 8)).toEqual({ row: 0, col: 2, create: false, launch: true });
    // Its row is playing the desktop clip: reuse, but do not take over.
    expect(pickPhoneClipSlot(grid, [0, null], 'a', 8)).toEqual({ row: 0, col: 2, create: false, launch: false });
    // Its own clip is the one playing: keep it live.
    expect(pickPhoneClipSlot(grid, [2, null], 'a', 8)).toEqual({ row: 0, col: 2, create: false, launch: true });
  });

  it('never adds a column', () => {
    const full = [Array.from({ length: 8 }, (_, i) => video(`v${i}`))];
    expect(pickPhoneClipSlot(full, [0], 'a', 8)).toBeNull();
  });
});
