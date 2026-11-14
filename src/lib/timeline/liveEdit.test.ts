import { afterEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  _resetLiveEditForTest,
  discardHeldEdits,
  heldEdits,
  holdContentEdit,
  holdParamEdit,
  installLiveEditHooks,
  liveEdit,
  liveEditOn,
  liveEditState,
  liveEditStep,
  resetLiveEdit,
  setLiveEdit,
  setLiveEditArmed,
  updateHeldEdits,
  type HeldEdit,
  type LiveEditEvent,
  type LiveEditState,
} from './liveEdit';
import { slotsFromPieces } from './where/wherePick';
import type { ShowClipMedia } from '../types';

const piece = { layerId: 'a' } as never;
const media = (name: string) => ({ kind: 'shader', name } as unknown as ShowClipMedia);
const hooks = (over: Record<string, unknown> = {}) => ({ keyAt: vi.fn(), cutIn: vi.fn(), revert: vi.fn(() => ({ ok: true as const })), setArmed: vi.fn(), ...over });

afterEach(() => _resetLiveEditForTest());

describe('Live edit transitions', () => {
  const edit = (id: string, value = 1): HeldEdit => ({ kind: 'param', id, target: piece, key: id, value, t: 2 });
  const off: LiveEditState = { kind: 'off' };
  const on: LiveEditState = { kind: 'on' };
  const holding: LiveEditState = { kind: 'holding', edits: [edit('x')], notice: null };
  const refused: LiveEditState = { kind: 'holding', edits: [edit('x')], notice: 'no' };
  const events: Record<string, LiveEditEvent> = {
    arm: { type: 'arm' },
    disarm: { type: 'disarm' },
    hold: { type: 'hold', edit: edit('y') },
    settle: { type: 'settle' },
    refuse: { type: 'refuse', notice: 'no' },
    reset: { type: 'reset' },
  };
  const table: Array<[string, LiveEditState, string, LiveEditState]> = [
    ['off', off, 'arm', on],
    ['off', off, 'disarm', off],
    ['off', off, 'hold', off],
    ['off', off, 'settle', off],
    ['off', off, 'refuse', off],
    ['off', off, 'reset', off],
    ['on', on, 'arm', on],
    ['on', on, 'disarm', off],
    ['on', on, 'hold', { kind: 'holding', edits: [edit('y')], notice: null }],
    ['on', on, 'settle', on],
    ['on', on, 'refuse', on],
    ['on', on, 'reset', on],
    ['holding', holding, 'arm', holding],
    ['holding', holding, 'disarm', off],
    ['holding', holding, 'hold', { kind: 'holding', edits: [edit('x'), edit('y')], notice: null }],
    ['holding', holding, 'settle', on],
    ['holding', holding, 'refuse', refused],
    ['holding', holding, 'reset', on],
    ['refused', refused, 'hold', { kind: 'holding', edits: [edit('x'), edit('y')], notice: null }],
    ['refused', refused, 'settle', on],
    ['refused', refused, 'disarm', off],
  ];
  for (const [name, from, event, to] of table) {
    it(`${name} + ${event}`, () => {
      expect(liveEditStep(from, events[event])).toEqual(to);
    });
  }

  it('leaves the state object as it is when nothing changes', () => {
    expect(liveEditStep(off, events.hold)).toBe(off);
    expect(liveEditStep(on, events.arm)).toBe(on);
    expect(liveEditStep(holding, events.arm)).toBe(holding);
  });
});

describe('Live edit', () => {
  it('keys nothing while off', () => {
    expect(holdParamEdit(piece, 'opacity', 0.5, 3)).toBe(false);
    expect(holdContentEdit('row', media('x'), 3, null)).toBe(false);
    expect(get(heldEdits)).toHaveLength(0);
  });

  it('is on while the recorder is armed with Follow edits, and switches through the recorder', () => {
    const h = hooks();
    installLiveEditHooks(h);
    setLiveEdit(true);
    expect(h.setArmed).toHaveBeenCalledWith(true);
    setLiveEditArmed(true);
    expect(get(liveEditOn)).toBe(true);
    setLiveEditArmed(false);
    expect(get(liveEditOn)).toBe(false);
  });

  it('holds parked changes, the latest value of each parameter', () => {
    setLiveEditArmed(true);
    expect(holdParamEdit(piece, 'opacity', 0.5, 3)).toBe(true);
    holdParamEdit(piece, 'opacity', 0.25, 3);
    holdParamEdit(piece, 'speed', 2, 3);
    const held = get(heldEdits);
    expect(held).toHaveLength(2);
    expect(held.find((e) => e.kind === 'param' && e.key === 'opacity')).toMatchObject({ value: 0.25, t: 3 });
  });

  it('keeps the content a swap went back from, and what the piece showed first, however often it swaps', () => {
    setLiveEditArmed(true);
    const first = { id: 's1', type: 'shader', name: 'first' } as never;
    holdContentEdit(null, media('second'), 4, media('first'), { layerId: 'a', previous: first });
    holdContentEdit('row', media('third'), 4, media('second'), { layerId: 'a', previous: { id: 's2' } as never });
    const [held] = get(heldEdits);
    expect(held).toMatchObject({ kind: 'content', trackId: 'row', piece: { layerId: 'a', previous: first } });
    expect((held as { before: ShowClipMedia }).before.name).toBe('first');
    expect((held as { media: ShowClipMedia }).media.name).toBe('third');
  });

  it('keys every held change where it was made on Update', () => {
    const h = hooks();
    installLiveEditHooks(h);
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3);
    holdContentEdit('row', media('next'), 7, null);
    expect(updateHeldEdits()).toBe(2);
    expect(h.keyAt).toHaveBeenCalledWith(piece, 'opacity', 0.5, 3, undefined);
    expect(h.cutIn).toHaveBeenCalledWith(expect.objectContaining({ trackId: 'row', t: 7, media: expect.objectContaining({ name: 'next' }) }));
    expect(get(heldEdits)).toHaveLength(0);
    expect(get(liveEditState).kind).toBe('on');
  });

  it('keys what a setting was before the first held change, so a new line keeps it up to there', () => {
    const h = hooks();
    installLiveEditHooks(h);
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    holdParamEdit(piece, 'opacity', 0.2, 3, 0.5);
    updateHeldEdits();
    expect(h.keyAt).toHaveBeenCalledWith(piece, 'opacity', 0.2, 3, 1);
  });

  it('Discard puts back the held changes themselves, without keying them or stepping back through the undo history', () => {
    const h = hooks();
    installLiveEditHooks(h);
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    expect(discardHeldEdits()).toBe(true);
    expect(h.revert).toHaveBeenCalledWith([expect.objectContaining({ key: 'opacity', was: 1 })]);
    expect(get(heldEdits)).toHaveLength(0);
    expect(get(liveEditState).kind).toBe('on');
    expect(h.keyAt).not.toHaveBeenCalled();
  });

  it('Discard that cannot put them back changes nothing and says why', () => {
    installLiveEditHooks(hooks({ revert: () => ({ ok: false, reason: 'Gone' }) }));
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    expect(discardHeldEdits()).toBe(false);
    expect(get(heldEdits)).toHaveLength(1);
    expect(get(liveEdit).notice).toBe('Gone');
    // A new held change clears the message.
    holdParamEdit(piece, 'speed', 2, 3, 1);
    expect(get(liveEdit).notice).toBeNull();
  });

  it('Discard without a way to put changes back refuses', () => {
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    expect(discardHeldEdits()).toBe(false);
    expect(get(heldEdits)).toHaveLength(1);
    expect(get(liveEdit).notice).toMatch(/can't/);
  });

  it('what Discard writes is not held again', () => {
    installLiveEditHooks(hooks({ revert: () => { holdParamEdit(piece, 'opacity', 1, 3, 0.5); return { ok: true }; } }));
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    discardHeldEdits();
    expect(get(heldEdits)).toHaveLength(0);
  });

  it('stopping Live edit, another document or another project drops what is held', () => {
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    setLiveEditArmed(false);
    expect(get(heldEdits)).toHaveLength(0);
    setLiveEditArmed(true);
    holdParamEdit(piece, 'opacity', 0.5, 3, 1);
    resetLiveEdit();
    expect(get(heldEdits)).toHaveLength(0);
    expect(get(liveEditOn)).toBe(true);
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
