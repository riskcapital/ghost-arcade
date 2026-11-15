import { describe, expect, it } from 'vitest';
import type { Cue, CueMarker } from '../../show/cueList';
import type { TimelineSection } from '../sections/sectionModel';
import { buildCueStack } from './cueStack';
import { goDecision, goWords, looping, manualStandby, nextStandby, nowItem, type GoInput } from './goRule';

const section = (id: string, start: number, end: number, action: TimelineSection['action'] = 'through', extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id, color: '#fff', start, end, action, ...extra });
const cue = (id: string): Cue =>
  ({ id, number: id, name: id, actions: [], follow: { mode: 'go', wait: 0, unit: 'seconds', target: 'next', jumpTo: null }, timecode: null });
const marker = (id: string, time: number, cueId: string | null): CueMarker => ({ id, time, cueId, label: id, doc: 'timeline' });

const SECTIONS = [section('Intro', 0, 10), section('Build', 10, 14, 'vamp'), section('Drop', 14, 30), section('Outro', 30, 40, 'hold'), section('Break', 40, 50, 'live')];
const STACK = buildCueStack(SECTIONS, [marker('m1', 12, 'c1')], [cue('c1'), cue('encore')]);

const base = (over: Partial<GoInput> = {}): GoInput => ({
  playing: true,
  sectionsRun: true,
  sections: SECTIONS,
  hereId: null,
  holdId: null,
  vampExitId: null,
  hand: null,
  standby: null,
  ...over,
});

describe('the one GO', () => {
  it('releases a section holding at its end (Hold for GO), whatever stands by', () => {
    expect(goDecision(base({ holdId: 'Outro', standby: STACK[0] }))).toEqual({ kind: 'release', sectionId: 'Outro' });
  });

  it('takes the pieces back from a section handed to the VJ decks (holding at its end)', () => {
    expect(goDecision(base({ holdId: 'Break', hand: { kind: 'cue', id: 'encore' } }))).toEqual({ kind: 'release', sectionId: 'Break' });
  });

  it('leaves a section looping now, once: told to leave, GO goes on to the standby', () => {
    expect(goDecision(base({ hereId: 'Build' }))).toEqual({ kind: 'release', sectionId: 'Build' });
    expect(goDecision(base({ hereId: 'Build', vampExitId: 'Build', standby: STACK.find((i) => i.id === 'Drop')! }))).toEqual({ kind: 'sections' });
    // Stopped in a loop section there is nothing looping.
    expect(looping(base({ playing: false, hereId: 'Build' }))).toBeNull();
  });

  it('with an outside clock following (timecode, Link), sections neither hold nor loop: no release', () => {
    expect(goDecision(base({ sectionsRun: false, holdId: 'Outro', hereId: 'Build' }))).toEqual({ kind: 'none' });
    expect(goDecision(base({ sectionsRun: false, playing: false }))).toEqual({ kind: 'play' });
  });

  it('a step on standby by hand: a section is jumped to, a cue fires, a marker fires its cue', () => {
    expect(goDecision(base({ hand: { kind: 'section', id: 'Drop' } }))).toEqual({ kind: 'jumpTo', sectionId: 'Drop' });
    expect(goDecision(base({ hand: { kind: 'cue', id: 'encore' } }))).toEqual({ kind: 'fireCue', cueId: 'encore' });
    expect(goDecision(base({ hand: { kind: 'marker', id: 'm1', cueId: 'c1' } }))).toEqual({ kind: 'fireCue', cueId: 'c1' });
    // A marker with no cue has nothing to fire: GO falls through to the sections.
    expect(goDecision(base({ hand: { kind: 'marker', id: 'm1', cueId: null }, standby: STACK[1] }))).toEqual({ kind: 'sections' });
  });

  it('never fires a marker early: a marker on standby (not by hand) is the sections\' GO', () => {
    const m = STACK.find((i) => i.kind === 'marker')!;
    expect(goDecision(base({ standby: m }))).toEqual({ kind: 'sections' });
  });

  it('a manual cue on standby fires', () => {
    const encore = STACK.find((i) => i.id === 'encore')!;
    expect(goDecision(base({ standby: encore }))).toEqual({ kind: 'fireCue', cueId: 'encore' });
  });

  it('no cues and no sections: stopped GO plays, playing it does nothing', () => {
    const empty = { sections: [], standby: null };
    expect(goDecision(base({ ...empty, playing: false }))).toEqual({ kind: 'play' });
    expect(goDecision(base(empty))).toEqual({ kind: 'none' });
  });

  it('at the end of the list: stopped GO plays, playing it does nothing', () => {
    expect(goDecision(base({ playing: false, standby: null, sections: [] }))).toEqual({ kind: 'play' });
    expect(goDecision(base({ standby: null }))).toEqual({ kind: 'none' });
  });

  it('takeover and phrases are not inputs: GO decides the same with them on (Return is R; phrases are pads)', () => {
    const input = base({ hereId: 'Drop', standby: STACK.find((i) => i.id === 'Outro')! });
    expect(goDecision(input)).toEqual({ kind: 'sections' });
    expect(Object.keys(input)).not.toContain('takeover');
  });
});

describe('standby and now', () => {
  it('the next timed step after the playhead, else the manual cue that stands by', () => {
    const manual = manualStandby(STACK, null, null);
    expect(nextStandby(STACK, 0, manual)?.id).toBe('Build');
    expect(nextStandby(STACK, 10.5, manual)?.id).toBe('m1');
    expect(nextStandby(STACK, 12, manual)?.id).toBe('Drop');
    expect(nextStandby(STACK, 45, manual)?.id).toBe('encore');
  });

  it('the manual cue: the list\'s own standby if manual, else the first, else the one after the current', () => {
    expect(manualStandby(STACK, 'encore', 'c1')?.id).toBe('encore');
    // c1 is a marker's cue, not manual: the first manual cue stands by.
    expect(manualStandby(STACK, 'c1', 'x')?.id).toBe('encore');
    expect(manualStandby(STACK, null, null)?.id).toBe('encore');
    expect(manualStandby(STACK, null, 'encore')).toBeNull();
    expect(manualStandby(buildCueStack([], [], []), null, null)).toBeNull();
  });

  it('now is the last timed step at or before the playhead', () => {
    expect(nowItem(STACK, 0)?.id).toBe('Intro');
    expect(nowItem(STACK, 12.5)?.id).toBe('m1');
    expect(nowItem(STACK, 13.9)?.id).toBe('m1');
    expect(nowItem(STACK, 14)?.id).toBe('Drop');
    expect(nowItem(buildCueStack([section('Late', 5, 9)], [], []), 1)).toBeNull();
  });

  it('says what GO will do', () => {
    expect(goWords({ kind: 'release', sectionId: 'Build' }, SECTIONS, 'Drop')).toBe('Leaves the Build loop at the end of this pass');
    expect(goWords({ kind: 'release', sectionId: 'Build' }, [section('Build', 0, 4, 'vamp', { exit: 'bar' })], '')).toBe('Leaves the Build loop at the next bar');
    expect(goWords({ kind: 'release', sectionId: 'Break' }, SECTIONS, '')).toBe('Takes the pieces back and goes on from Break');
    expect(goWords({ kind: 'release', sectionId: 'Outro' }, SECTIONS, '')).toBe('Goes on from Outro');
    expect(goWords({ kind: 'fireCue', cueId: 'encore' }, SECTIONS, 'encore')).toBe('Fires encore');
    expect(goWords({ kind: 'sections' }, SECTIONS, 'Drop')).toBe('Next: Drop');
    expect(goWords({ kind: 'play' }, SECTIONS, '')).toBe('Plays the show');
  });
});
