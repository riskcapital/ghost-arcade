import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  _resetLiveEditForTest,
  discardHeldEdits,
  heldEdits,
  holdContentEdit,
  holdParamEdit,
  installLiveEditHooks,
  liveEditOn,
  setLiveEdit,
  updateHeldEdits,
} from './liveEdit';
import { slotsFromPieces } from './where/wherePick';
import type { ShowClipMedia } from '../types';

const piece = { layerId: 'a' } as never;
const media = (name: string) => ({ kind: 'shader', name } as unknown as ShowClipMedia);

afterEach(() => _resetLiveEditForTest());

describe('Live edit', () => {
  it('keys nothing while off', () => {
    expect(holdParamEdit(piece, 'opacity', 0.5, 3)).toBe(false);
    expect(get(heldEdits)).toHaveLength(0);
  });

  it('holds parked changes, the latest value of each parameter', () => {
    liveEditOn.set(true);
    expect(holdParamEdit(piece, 'opacity', 0.5, 3)).toBe(true);
    holdParamEdit(piece, 'opacity', 0.25, 3);
    holdParamEdit(piece, 'speed', 2, 3);
    const held = get(heldEdits);
    expect(held).toHaveLength(2);
    expect(held.find((e) => e.kind === 'param' && e.key === 'opacity')).toMatchObject({ value: 0.25, t: 3 });
  });

  it('keeps the content a swap went back from, however often it swaps', () => {
    liveEditOn.set(true);
    holdContentEdit('row', media('second'), 4, media('first'));
    holdContentEdit('row', media('third'), 4, media('second'));
    const [held] = get(heldEdits);
    expect(held).toMatchObject({ kind: 'content', trackId: 'row' });
    expect((held as { before: ShowClipMedia }).before.name).toBe('first');
    expect((held as { media: ShowClipMedia }).media.name).toBe('third');
  });

  it('keys every held change where it was made on Update', () => {
    const keyAt = vi.fn();
    const cutIn = vi.fn();
    installLiveEditHooks({ keyAt, cutIn, undo: () => false, setArmed: () => {} });
    liveEditOn.set(true);
    holdParamEdit(piece, 'opacity', 0.5, 3);
    holdContentEdit('row', media('next'), 7, null);
    expect(updateHeldEdits()).toBe(2);
    expect(keyAt).toHaveBeenCalledWith(piece, 'opacity', 0.5, 3);
    expect(cutIn).toHaveBeenCalledWith('row', expect.objectContaining({ name: 'next' }), 7, null);
    expect(get(heldEdits)).toHaveLength(0);
  });

  it('drops held changes on Discard without keying them', () => {
    const keyAt = vi.fn();
    installLiveEditHooks({ keyAt, cutIn: vi.fn(), undo: () => false, setArmed: () => {} });
    liveEditOn.set(true);
    holdParamEdit(piece, 'opacity', 0.5, 3);
    discardHeldEdits();
    expect(get(heldEdits)).toHaveLength(0);
    expect(keyAt).not.toHaveBeenCalled();
  });

  it('switches through the recorder', () => {
    const setArmed = vi.fn();
    installLiveEditHooks({ keyAt: vi.fn(), cutIn: vi.fn(), undo: () => false, setArmed });
    setLiveEdit(true);
    expect(setArmed).toHaveBeenCalledWith(true);
  });
});

describe('picked pieces', () => {
  const spots = [
    { id: 'right', kind: 'piece' as const, x: 0.8, y: 0.5, label: 'Right' },
    { id: 'left', kind: 'piece' as const, x: 0.2, y: 0.5, label: 'Left' },
    { id: 'mid', kind: 'piece' as const, x: 0.5, y: 0.5, label: 'Middle' },
  ];

  it('become slots left to right, one each, or one that lights together', () => {
    expect(slotsFromPieces(['right', 'left'], spots, false)).toEqual([['left'], ['right']]);
    expect(slotsFromPieces(['right', 'left', 'mid'], spots, true)).toEqual([['left', 'mid', 'right']]);
  });

  it('leave out pieces no longer on the stage', () => {
    expect(slotsFromPieces(['gone', 'mid'], spots, false)).toEqual([['mid']]);
    expect(slotsFromPieces([], spots, false)).toEqual([]);
  });
});
