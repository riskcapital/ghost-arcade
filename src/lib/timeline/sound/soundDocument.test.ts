/**
 * Sound rows in the Timeline document: they save with it (an older build
 * still opens the audio), undo with it, stay off the Show (whose audio lanes
 * are as they were), and the Live and build blocks count toward the length.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { derived, get, writable } from 'svelte/store';
import type { ShowAudioTrack } from '../../types';
import type { ShowFrameTick } from '../../stores/showTimeline';

const state = writable({ layers: [], selectedLayerId: null });
vi.mock('../../stores/layers', () => ({
  project: { subscribe: state.subscribe, selectLayer: () => {} },
  layers: derived(state, (s) => s.layers),
  selectedLayerId: derived(state, (s) => s.selectedLayerId),
}));
vi.mock('../../ableton/abletonBridge', () => ({
  abletonBridge: { liveParamValue: () => null, liveLevelValue: () => null, watchLiveSources: () => {} },
}));
const { showTimeline, setShowCompositionLoader, onShowFrame } = await import('../../stores/showTimeline');
const { addFx, addRow, bindLiveTrack, removeRow, setAudioFade, setRowVolume, soundRows, toggleSolo } = await import('./soundCommands');

const audio = (id: string, lane: number, startTime = 0, duration = 20): ShowAudioTrack => ({
  id, name: `${id}.wav`, url: `/media/${id}.wav`, startTime, duration, offset: 0, sourceDuration: 60, volume: 1, muted: false, lane, peaks: [1, 2],
});

beforeEach(() => {
  showTimeline._resetForTest();
  setShowCompositionLoader(() => {});
  showTimeline.openDoc('timeline');
});
afterEach(() => {
  setShowCompositionLoader(null);
  showTimeline._resetForTest();
});

describe('sound rows in the Timeline document', () => {
  it('rows, effects, fades and Live clip blocks save and come back; an old reader still sees the audio', () => {
    showTimeline.setSoundBlocks([audio('song', 0), audio('pad', 1, 4, 8)]);
    setRowVolume('row-0', 0.6);
    const fx = addFx('row-0', 'reverb');
    setAudioFade('pad', 'in', 1.5);
    const live = addRow('live');
    bindLiveTrack(live, 2, 'Bass');
    showTimeline.setSound({ ...get(showTimeline).sound, live: [{ id: 'c1', lane: 2, startTime: 30, duration: 8, slot: 1, clipName: 'Sub', color: 0x3388ff }] });
    expect(get(showTimeline).duration).toBe(38);

    const saved = JSON.parse(JSON.stringify(showTimeline.serialize()));
    // The audio blocks are still plain audio tracks (lane = row) in the file.
    expect(saved.timeline.audioTracks.map((t: ShowAudioTrack) => [t.id, t.lane])).toEqual([['song', 0], ['pad', 1]]);
    expect(saved.timeline.sound.rows.map((r: { id: string }) => r.id)).toEqual(['row-0', 'row-1', live]);

    showTimeline._resetForTest();
    showTimeline.hydrate(saved);
    showTimeline.openDoc('timeline');
    const s = get(showTimeline);
    expect(s.sound.rows[0]).toMatchObject({ id: 'row-0', volume: 0.6 });
    expect(s.sound.rows[0].fx.map((f) => [f.id, f.type])).toEqual([[fx, 'reverb']]);
    expect(s.sound.rows[2]).toMatchObject({ kind: 'live', live: { track: 2, trackName: 'Bass' } });
    expect(s.sound.live).toEqual([{ id: 'c1', lane: 2, startTime: 30, duration: 8, slot: 1, clipName: 'Sub', color: 0x3388ff }]);
    expect(s.audioTracks.find((t) => t.id === 'pad')?.fadeIn).toBe(1.5);
    expect(s.duration).toBe(38);
  });

  it('every row edit is one undo step of the document', () => {
    showTimeline.setSoundBlocks([audio('song', 0)]);
    const before = showTimeline.exportArrangement();
    addFx('row-0', 'delay');
    toggleSolo('row-0');
    expect(soundRows()[0].solo).toBe(true);
    showTimeline.restoreArrangement(before);
    expect(soundRows()[0].fx).toEqual([]);
    expect(soundRows()[0].solo).toBe(false);
  });

  it('removing a row takes its blocks and its lines, and moves the rows below up', () => {
    showTimeline.setSoundBlocks([audio('a', 0), audio('b', 1), audio('c', 2)]);
    showTimeline.editLines((l) => [...l, { id: 'x', target: { scope: 'sound', id: 'row-1' }, key: 'sound:volume', kind: 'continuous', min: 0, max: 1, points: [{ t: 0, v: 1 }] }]);
    removeRow('row-1');
    const s = get(showTimeline);
    expect(s.audioTracks.map((t) => [t.id, t.lane])).toEqual([['a', 0], ['c', 1]]);
    expect(s.lines).toEqual([]);
    expect(soundRows().map((r) => r.id)).toEqual(['row-0', 'row-2']);
  });

  it('the Show keeps its simple audio lanes: no rows there, and its tracks never see the Timeline\'s', () => {
    showTimeline.setSoundBlocks([audio('song', 0)]);
    addFx('row-0', 'filter');
    showTimeline.openDoc('show');
    const show = get(showTimeline);
    expect(show.audioTracks).toEqual([]);
    expect(show.sound.rows).toEqual([]);
    showTimeline.openDoc('timeline');
    expect(get(showTimeline).sound.rows[0].fx).toHaveLength(1);
  });

  it('each evaluation tells the sound engine the time, play state and jumps', () => {
    showTimeline.setSoundBlocks([audio('song', 0)]);
    const ticks: ShowFrameTick[] = [];
    const off = onShowFrame((t) => ticks.push(t));
    showTimeline.seek(3);
    showTimeline.seek(5);
    off();
    expect(ticks.length).toBeGreaterThanOrEqual(2);
    const last = ticks[ticks.length - 1];
    expect(last).toMatchObject({ doc: 'timeline', time: 5, playing: false });
    expect(ticks[ticks.length - 1].seek).toBeGreaterThan(ticks[0].seek);
  });
});
