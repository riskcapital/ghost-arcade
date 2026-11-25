/** Audio Lab's undo history: effects, the drum machine, the looper's notes, and what stays out of it. */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';

const clock = { beat: 0, beatMs: 500 };
vi.mock('../stores/launchClock', () => ({
  launchClockPosition: () => ({ ...clock }),
  launchClockTempo: () => 60000 / clock.beatMs,
  resyncLaunchClock: () => true,
}));

import { musicStudio } from './musicStudioStore';
import { _resetStationForTests, attachLoopStation, clearLoopTrack, publish, setTrackLayers, undoLoopLayer } from './loopStation';
import type { AudioLoopTracks } from './audioLoopTracks';
import {
  _settleAudioLabHistoryForTests as settle,
  audioLabOwnsUndo,
  clearAudioLabHistory,
  redoAudioLab,
  startAudioLabHistory,
  undoAudioLab,
} from './audioLabHistory';
import { outsideHistory } from './historyGate';
import { removeNote } from './quickEdit';
import { setAddonsStatusForTests } from '../addons/addonAccess';

setAddonsStatusForTests({ 'addon.audio-lab': true });

const s = () => get(musicStudio);
const note = (beat: number, n = 60) => ({ beat, note: n, dur: 1, velocity: 0.8 });

beforeEach(() => {
  _resetStationForTests();
  musicStudio.hydrate(null);
  attachLoopStation({ send: () => {}, now: () => 0, click: () => {}, played: () => [], clockBusy: () => false, wake: () => {}, audioTracks: () => null });
  startAudioLabHistory();
  clearAudioLabHistory();
});

describe('Audio Lab undo and redo', () => {
  it('brings back a deleted effect, and redo deletes it again', () => {
    musicStudio.addInsert('synth', 'fx1', 'delay');
    settle();
    musicStudio.addInsert('synth', 'fx2', 'reverb');
    settle();
    musicStudio.removeInsert('synth', 'fx1');
    settle();
    expect(s().inserts.synth.map((fx) => fx.id)).toEqual(['fx2']);
    expect(undoAudioLab()).toBe(true);
    settle();
    expect(s().inserts.synth.map((fx) => fx.id)).toEqual(['fx1', 'fx2']);
    expect(redoAudioLab()).toBe(true);
    settle();
    expect(s().inserts.synth.map((fx) => fx.id)).toEqual(['fx2']);
    // Undo past the first add takes the chain away.
    undoAudioLab();
    undoAudioLab();
    undoAudioLab();
    settle();
    expect(s().inserts.synth ?? []).toEqual([]);
  });

  it('keeps the effect objects it restores (the audio chain sees the same effects)', () => {
    musicStudio.addInsert('keys', 'a', 'delay');
    settle();
    const kept = s().inserts.keys[0];
    musicStudio.moveInsert('keys', 'a', 0);
    musicStudio.addInsert('keys', 'b', 'chorus');
    settle();
    undoAudioLab();
    settle();
    expect(s().inserts.keys[0]).toBe(kept);
  });

  it('a knob turned in one go is one step', () => {
    musicStudio.addInsert('synth', 'fx', 'delay');
    settle();
    const key = Object.keys(s().inserts.synth[0].params)[0];
    const start = s().inserts.synth[0].params[key].value;
    for (const v of [0.1, 0.2, 0.3, 0.9]) musicStudio.setInsertParam('synth', 'fx', key, v);
    settle();
    expect(s().inserts.synth[0].params[key].value).toBe(0.9);
    undoAudioLab();
    settle();
    expect(s().inserts.synth[0].params[key].value).toBe(start);
    expect(s().inserts.synth).toHaveLength(1);
  });

  it('undoes the drum machine and the step pattern', () => {
    const machine = s().machine;
    musicStudio.setMachine({ ...machine, padCount: machine.padCount });
    settle();
    musicStudio.toggleStep('kick', 3);
    settle();
    const before = s().pattern;
    musicStudio.toggleStep('snare', 5);
    settle();
    undoAudioLab();
    settle();
    expect(s().pattern).toBe(before);
    undoAudioLab();
    undoAudioLab();
    settle();
    expect(s().machine).toBe(machine);
  });

  it('brings back a looper note erased in the quick editor, and a cleared track', () => {
    musicStudio.updateLoopTrack(0, { kind: 'midi', beats: 4, layers: [[note(0), note(1, 62)]] });
    clearAudioLabHistory();
    setTrackLayers(0, [removeNote(s().loopStation.tracks[0].layers[0], 1)]);
    settle();
    expect(s().loopStation.tracks[0].layers[0]).toHaveLength(1);
    undoAudioLab();
    settle();
    expect(s().loopStation.tracks[0].layers[0].map((n) => n.note)).toEqual([60, 62]);
    clearLoopTrack(0);
    settle();
    expect(s().loopStation.tracks[0].layers).toEqual([]);
    undoAudioLab();
    settle();
    expect(s().loopStation.tracks[0].layers[0]).toHaveLength(2);
    redoAudioLab();
    settle();
    expect(s().loopStation.tracks[0].layers).toEqual([]);
  });

  it('undoes clip note edits in the session', () => {
    musicStudio.addSessionClip('lead', { kind: 'notes', id: 'c1', name: 'Clip', beats: 4, notes: [note(0)] } as never);
    settle();
    musicStudio.updateSessionClip('c1', (c) => (c.kind === 'notes' ? { ...c, notes: [] } : c));
    settle();
    undoAudioLab();
    settle();
    const clip = s().session.lead.find((c) => c?.id === 'c1');
    expect(clip && clip.kind === 'notes' ? clip.notes : null).toHaveLength(1);
  });

  it('a new edit after an undo clears the redo', () => {
    musicStudio.addInsert('synth', 'x', 'delay');
    settle();
    undoAudioLab();
    settle();
    musicStudio.addInsert('synth', 'y', 'delay');
    settle();
    expect(redoAudioLab()).toBe(false);
  });

  it('playing the show is no step, and an undo never walks it back', () => {
    musicStudio.addInsert('synth', 'mine', 'delay');
    settle();
    outsideHistory(() => musicStudio.setInsertChains({ synth: [] }));
    settle();
    expect(undoAudioLab()).toBe(false);
    expect(s().inserts.synth).toEqual([]);
  });

  it('a project load starts afresh', () => {
    musicStudio.addInsert('synth', 'z', 'delay');
    settle();
    musicStudio.hydrate(null);
    expect(undoAudioLab()).toBe(false);
  });

  it('keeps 100 steps at most', () => {
    for (let k = 0; k < 120; k++) {
      musicStudio.toggleStep('kick', k % 16);
      settle();
    }
    let n = 0;
    while (undoAudioLab()) n++;
    expect(n).toBe(100);
  });
});

/** An audio-track engine with layers in memory, its own undo, redo and Clear as the real one keeps them. */
function fakeEngine() {
  const layers: Array<Array<[Float32Array, Float32Array]>> = Array.from({ length: 8 }, () => []);
  const redo: Array<Array<[Float32Array, Float32Array]>> = Array.from({ length: 8 }, () => []);
  const cleared: Array<Array<[Float32Array, Float32Array]> | null> = Array.from({ length: 8 }, () => null);
  const e = {
    onLayersChanged: null as ((i: number) => void) | null,
    layersOf: () => null,
    layerCount: (i: number) => layers[i].length,
    add(i: number) { layers[i].push([new Float32Array(4), new Float32Array(4)]); redo[i] = []; e.onLayersChanged?.(i); },
    undo: (i: number) => {
      if (!layers[i].length) {
        if (!cleared[i]) return false;
        layers[i] = cleared[i]!;
        cleared[i] = null;
      } else redo[i].push(layers[i].pop()!);
      e.onLayersChanged?.(i);
      return true;
    },
    redo: (i: number) => { const l = redo[i].pop(); if (!l) return false; layers[i].push(l); e.onLayersChanged?.(i); return true; },
    clear: (i: number) => { cleared[i] = layers[i].length ? layers[i] : null; layers[i] = []; redo[i] = []; e.onLayersChanged?.(i); },
    stop: () => {}, cancel: () => {},
    info: (i: number) => ({ bars: 2, originBeat: 0, layers: layers[i].length, redo: redo[i].length }),
    canRecord: () => true, state: () => 'stopped', clearAll: () => {}, peaks: () => [],
    setLevel: () => {}, sampleRate: () => 48000,
  };
  return e;
}

describe('Audio Lab undo on audio loop tracks', () => {
  it('takes an overdub pass off and puts it back, and brings back a cleared track', () => {
    const e = fakeEngine();
    musicStudio.updateLoopTrack(2, { kind: 'audio' });
    attachLoopStation({ send: () => {}, now: () => 0, click: () => {}, played: () => [], clockBusy: () => false, wake: () => {}, audioTracks: () => e as unknown as AudioLoopTracks });
    publish();
    clearAudioLabHistory();
    e.add(2);
    settle();
    e.add(2);
    settle();
    expect(e.layerCount(2)).toBe(2);
    undoAudioLab();
    settle();
    expect(e.layerCount(2)).toBe(1);
    redoAudioLab();
    settle();
    expect(e.layerCount(2)).toBe(2);
    clearLoopTrack(2);
    settle();
    expect(e.layerCount(2)).toBe(0);
    undoAudioLab();
    settle();
    expect(e.layerCount(2)).toBe(2);
    // The track's own Undo button is a step too.
    undoLoopLayer(2);
    settle();
    expect(e.layerCount(2)).toBe(1);
    undoAudioLab();
    settle();
    expect(e.layerCount(2)).toBe(2);
  });
});

describe('the undo keys', () => {
  const key = (extra: Record<string, unknown> = {}) => ({ key: 'z', metaKey: true, target: null, ...extra });

  it('are Audio Lab\'s only while it is open and was last pressed, and never in a text field', () => {
    musicStudio.close();
    expect(audioLabOwnsUndo(key(), true)).toBeNull();
    musicStudio.open();
    expect(audioLabOwnsUndo(key(), false)).toBeNull();
    expect(audioLabOwnsUndo(key(), true)).toBe('undo');
    expect(audioLabOwnsUndo(key({ shiftKey: true }), true)).toBe('redo');
    expect(audioLabOwnsUndo(key({ key: 'y', metaKey: false, ctrlKey: true }), true)).toBe('redo');
    expect(audioLabOwnsUndo(key({ target: { tagName: 'INPUT', type: 'text' } }), true)).toBeNull();
    expect(audioLabOwnsUndo(key({ target: { tagName: 'INPUT', type: 'range' } }), true)).toBe('undo');
  });
});
