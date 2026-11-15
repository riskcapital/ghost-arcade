import { describe, expect, it } from 'vitest';
import type { Cue, CueMarker } from '../../../../show/cueList';
import type { TimelineSection } from '../../../../timeline/sections/sectionModel';
import { buildCueStack, markerNumber, stackItemName } from './cueStack';

const section = (id: string, start: number, end: number, action: TimelineSection['action'] = 'through'): TimelineSection =>
  ({ id, name: id, color: '#fff', start, end, action });
const cue = (id: string, name = id): Cue =>
  ({ id, number: id, name, actions: [], follow: { mode: 'go', wait: 0, unit: 'seconds', target: 'next', jumpTo: null }, timecode: null });
const marker = (id: string, time: number, cueId: string | null, label = ''): CueMarker => ({ id, time, cueId, label, doc: 'timeline' });

describe('the Timeline\'s one cue list', () => {
  it('puts sections and markers in show order with one numbering, then the cues no marker fires', () => {
    const stack = buildCueStack(
      [section('Drop', 40, 60), section('Intro', 0, 16)],
      [marker('m2', 45, 'c2'), marker('m1', 20, 'c1', 'Lights up')],
      [cue('c1', 'Lights'), cue('c2', 'Strobe'), cue('c3', 'Encore look')],
    );
    expect(stack.map((i) => [i.q, i.kind, stackItemName(i)])).toEqual([
      [1, 'section', 'Intro'],
      [2, 'marker', 'Lights up'],
      [3, 'section', 'Drop'],
      [4, 'marker', 'Strobe'],
      [5, 'cue', 'Encore look'],
    ]);
    expect(markerNumber(stack, 'm2')).toBe(4);
    expect(markerNumber(stack, 'nope')).toBeNull();
  });

  it('a section before a marker at the same time; a marker with no cue is still a step', () => {
    const stack = buildCueStack([section('A', 10, 20)], [marker('m', 10, null)], []);
    expect(stack.map((i) => i.kind)).toEqual(['section', 'marker']);
    expect(stackItemName(stack[1])).toBe('Marker');
  });

  it('is empty for an empty Timeline, and only cues without sections or markers', () => {
    expect(buildCueStack([], [], [])).toEqual([]);
    expect(buildCueStack([], [], [cue('a'), cue('b')]).map((i) => [i.q, i.id])).toEqual([[1, 'a'], [2, 'b']]);
  });
});
