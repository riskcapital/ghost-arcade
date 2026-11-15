import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get, writable } from 'svelte/store';

vi.mock('../../stores/layers', () => ({
  project: writable({ id: 'p', layers: [], selectedLayerId: null }),
  layers: writable([]),
  compositions: writable([]),
  selectedLayerId: writable(null),
}));

const { showTimeline, setShowCompositionLoader, setShowTrackFrameSink } = await import('../../stores/showTimeline');
const { cueList } = await import('../../show/cueList');
const { handStandby, performGo, performReset, performStack, standByOn, standbyId } = await import('./performGo');

describe('the one GO at runtime', () => {
  beforeEach(() => {
    showTimeline._resetForTest();
    setShowCompositionLoader(() => {});
    setShowTrackFrameSink(() => {});
    showTimeline.openDoc('timeline');
    for (const c of [...cueList.state.cues]) cueList.removeCue(c.id);
    for (const m of [...cueList.state.markers]) cueList.removeMarker(m.id);
    cueList.reset();
    handStandby.set(null);
  });
  afterEach(() => {
    showTimeline.pause();
    setShowTrackFrameSink(null);
    setShowCompositionLoader(null);
    showTimeline._resetForTest();
  });

  it('fires the manual cue on standby, then the next one; the list numbers them', () => {
    const a = cueList.addCue({ number: '1', name: 'A' });
    const b = cueList.addCue({ number: '2', name: 'B' }, a);
    expect(get(performStack).map((i) => i.id)).toEqual([a, b]);
    expect(get(standbyId)).toBe(a);
    expect(performGo()).toEqual({ kind: 'fireCue', cueId: a });
    expect(cueList.state.currentCueId).toBe(a);
    expect(get(standbyId)).toBe(b);
    expect(performGo()).toEqual({ kind: 'fireCue', cueId: b });
    // End of the list, stopped with nothing to play: GO asks to play (an empty show stays put).
    expect(performGo().kind).toBe('play');
  });

  it('a section on standby by hand: GO goes to its start; the hand standby is used once', () => {
    showTimeline.setSections([
      { id: 's1', name: 'One', color: '#fff', start: 0, end: 4, action: 'through' },
      { id: 's2', name: 'Two', color: '#fff', start: 4, end: 8, action: 'through' },
    ]);
    const two = get(performStack).find((i) => i.id === 's2')!;
    standByOn(two);
    expect(get(standbyId)).toBe('s2');
    expect(performGo()).toEqual({ kind: 'jumpTo', sectionId: 's2' });
    expect(get(showTimeline).currentTime).toBe(4);
    expect(get(handStandby)).toBeNull();
    // Double-click again on the same step lets go of it.
    standByOn(two);
    standByOn(two);
    expect(get(handStandby)).toBeNull();
  });

  it('a marker\'s cue on standby by hand fires early; otherwise markers only fire as the playhead crosses them', () => {
    const c = cueList.addCue({ number: '1', name: 'Hit' });
    const m = cueList.addMarker(10, c, 'Hit', 'timeline');
    // Not by hand: the marker is the next step, GO does not fire it (stopped: it plays).
    expect(performGo().kind).toBe('play');
    expect(cueList.state.currentCueId).toBeNull();
    showTimeline.pause();
    standByOn(get(performStack).find((i) => i.id === m)!);
    expect(performGo()).toEqual({ kind: 'fireCue', cueId: c });
    expect(cueList.state.currentCueId).toBe(c);
  });

  it('Reset goes back to the start, the first cue, and no hand standby', () => {
    const a = cueList.addCue({ number: '1', name: 'A' });
    cueList.addCue({ number: '2', name: 'B' }, a);
    performGo();
    standByOn(get(performStack)[1]);
    performReset();
    expect(get(handStandby)).toBeNull();
    expect(cueList.state.currentCueId).toBeNull();
    expect(get(standbyId)).toBe(a);
    expect(get(showTimeline).currentTime).toBe(0);
  });
});
