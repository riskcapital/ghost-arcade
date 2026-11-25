import { describe, expect, it, vi } from 'vitest';

vi.mock('./loopStation', () => {
  const calls: string[] = [];
  let selected = 0;
  return {
    calls,
    loopStationView: { subscribe: (fn: (v: unknown) => void) => { fn({ selected, tracks: [] }); return () => {}; } },
    pressLoopTrack: (i: number) => calls.push(`press ${i}`),
    stopLoopTrack: (i: number) => calls.push(`stop ${i}`),
    undoLoopLayer: (i: number) => calls.push(`undo ${i}`),
    redoLoopLayer: (i: number) => calls.push(`redo ${i}`),
    clearLoopTrack: (i: number) => calls.push(`clear ${i}`),
    toggleLoopMute: (i: number) => calls.push(`mute ${i}`),
    saveLoopTrack: async (i: number) => calls.push(`save ${i}`),
    selectLoopTrack: (i: number) => { selected = i; calls.push(`select ${i}`); },
    selectedLoopTrack: () => selected,
    setLoopLevel: () => {},
    startAllLoopTracks: () => calls.push('start all'),
    stopAllLoopTracks: () => calls.push('stop all'),
  };
});

import { holdLoopEditorKeys, loopKey, pedalActions, pedalResolve, stepTrack } from './loopControls';
import * as station from './loopStation';
import { setAddonsStatusForTests } from '../addons/addonAccess';

// Audio Lab is a paid add-on: these tests run it unlocked.
setAddonsStatusForTests({ 'addon.audio-lab': true });

const calls = (station as unknown as { calls: string[] }).calls;
const k = (code: string, extra: Partial<KeyboardEvent> = {}) => ({ key: extra.key ?? '', code, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, ...extra });

describe('looper mapping', () => {
  it('maps the panel keys', () => {
    calls.length = 0;
    expect(loopKey(k('Digit3'))).toBe(true);
    expect(loopKey(k('Space'))).toBe(true);
    expect(loopKey(k('Space', { shiftKey: true }))).toBe(true);
    // Cmd+Z is Audio Lab's undo history, not the looper's own key.
    expect(loopKey(k('KeyZ', { key: 'z', metaKey: true }))).toBe(false);
    expect(loopKey(k('KeyZ', { key: 'z', metaKey: true, shiftKey: true }))).toBe(false);
    expect(loopKey(k('Period', { key: '.', metaKey: true }))).toBe(true);
    expect(loopKey(k('KeyQ'))).toBe(false);
    expect(calls).toEqual(['select 2', 'press 2', 'stop 2', 'stop all']);
  });

  it('gives each pedal preset its tap and hold', () => {
    expect(pedalActions('2-switch', 1)).toEqual(['button', 'undo']);
    // The 2-switch can stop: hold its second switch.
    expect(pedalActions('2-switch', 2)).toEqual(['next', 'stop']);
    expect(pedalActions('3-switch', 3)).toEqual(['stop', 'undo']);
    expect(pedalResolve('3-switch', 1, 100)).toBe('button');
    expect(pedalResolve('3-switch', 1, 800)).toBe('undo');
    expect(pedalResolve('2-switch', 2, 100)).toBe('next');
    expect(pedalResolve('2-switch', 2, 800)).toBe('stop');
    expect(pedalResolve('off', 1, 0)).toBeNull();
  });
});

describe('next and previous track', () => {
  it('wrap round the tracks showing, not all eight', () => {
    expect(stepTrack(5, 1, 6)).toBe(0);
    expect(stepTrack(0, -1, 6)).toBe(5);
    expect(stepTrack(2, 1, 6)).toBe(3);
  });

  it('S plays its note; Shift+S saves the selected loop', () => {
    calls.length = 0;
    expect(loopKey(k('KeyS', { shiftKey: true }))).toBe(true);
    expect(calls).toEqual(['save 2']);
  });
});

describe('looper keys with a note editor open', () => {
  it('Backspace deletes a note in the editor, never the whole track (regression)', () => {
    const release = holdLoopEditorKeys();
    calls.length = 0;
    expect(loopKey(k('Backspace', { key: 'Backspace' }))).toBe(false);
    expect(calls.filter((c) => c.startsWith('clear'))).toEqual([]);
    release();
    release();
    expect(loopKey(k('Backspace', { key: 'Backspace' }))).toBe(true);
    expect(calls.some((c) => c.startsWith('clear'))).toBe(true);
  });
});
