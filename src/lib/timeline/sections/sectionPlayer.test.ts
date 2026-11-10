/**
 * The sections' end actions on a playing Timeline, as pure steps: play
 * through, hold for GO, loop until GO (leaving at the end of the pass or at
 * the next bar), jump after N passes, Live (hand-over events, hold, GO), GO
 * armed ahead, a reset, and how far free-running blocks run ahead.
 */
import { describe, expect, it } from 'vitest';
import { createTempoMap } from '../../show/tempoMap';
import {
  createSectionPlayerState,
  freeRunOffset,
  goSections,
  HOLD_EPSILON,
  nextStop,
  resetSections,
  stepSections,
  type SectionPlayerState,
} from './sectionPlayer';
import { nearestBar, normalizeSections, placeNewSection, tidySections, type TimelineSection } from './sectionModel';

const tempo = createTempoMap(120, 0); // a bar = 2 s
const sec = (id: string, start: number, end: number, extra: Partial<TimelineSection> = {}): TimelineSection =>
  ({ id, name: id, color: '#5b8def', start, end, action: 'through', ...extra });

/** Play from `from` to `to` in `dt` steps; returns the playhead after each step. */
function run(state: SectionPlayerState, sections: TimelineSection[], from: number, to: number, dt = 0.05, now = { t: 0 }) {
  let t = from;
  const times: number[] = [];
  const events: string[] = [];
  for (let i = 0; i < Math.round((to - from) / dt); i++) {
    now.t += dt;
    const r = stepSections(state, sections, tempo, t, t + dt, now.t);
    for (const e of r.events) events.push(e.type === 'jump' ? `jump:${e.from.id}>${e.to.id}` : `${e.type}:${e.section.id}`);
    t = r.time;
    times.push(t);
  }
  return { t, times, events };
}

describe('end actions', () => {
  it('play through: nothing happens at the end', () => {
    const s = createSectionPlayerState();
    const r = run(s, [sec('a', 0, 4), sec('b', 4, 8)], 0, 6);
    expect(r.t).toBeCloseTo(6, 6);
    expect(r.events).toEqual([]);
  });

  it('hold: the playhead stops on the last instant of the section until GO, then plays on', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4, { action: 'hold' }), sec('b', 4, 8)];
    const now = { t: 0 };
    let r = run(s, sections, 3, 6, 0.05, now);
    expect(r.t).toBeCloseTo(4 - HOLD_EPSILON, 9);
    expect(r.events).toEqual(['hold:a']);
    expect(s.hold?.sectionId).toBe('a');
    // Still holding, however long it runs.
    r = run(s, sections, r.t, r.t + 2, 0.05, now);
    expect(r.t).toBeCloseTo(4 - HOLD_EPSILON, 9);
    const go = goSections(s, sections, tempo, r.t, true, now.t);
    expect(go.kind).toBe('resume');
    r = run(s, sections, r.t, r.t + 1, 0.05, now);
    expect(r.t).toBeCloseTo(5 - HOLD_EPSILON, 6);
    expect(s.hold).toBeNull();
    expect(s.armed).toEqual([]);
  });

  it('GO pressed inside a hold section before its end arms it: it plays on', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4, { action: 'hold' })];
    expect(goSections(s, sections, tempo, 2, true, 0).kind).toBe('armed');
    const r = run(s, sections, 2, 5);
    expect(r.t).toBeCloseTo(5, 6);
    expect(r.events).toEqual([]);
  });

  it('GO while stopped asks to play; with nothing waiting it does nothing', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4), sec('b', 4, 8, { action: 'hold' })];
    expect(goSections(s, sections, tempo, 1, false, 0).kind).toBe('play');
    expect(goSections(s, sections, tempo, 1, true, 0).kind).toBe('none');
    expect(nextStop(sections, 1)?.id).toBe('b');
  });

  it('vamp: loops the section by its own length until GO, then leaves at the end of the pass', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4), sec('loop', 4, 8, { action: 'vamp' }), sec('c', 8, 12)];
    const step = stepSections(s, sections, tempo, 7.98, 8.03, 1);
    expect(step.kind).toBe('wrap');
    if (step.kind === 'wrap') {
      expect(step.time).toBeCloseTo(4.03, 9);
      expect(step.shift).toBeCloseTo(4, 9);
    }
    // Three more passes.
    let r = run(s, sections, 4.03, 4.03 + 12);
    expect(r.t).toBeGreaterThanOrEqual(4);
    expect(r.t).toBeLessThan(8);
    expect(r.events.filter((e) => e === 'loop:loop')).toHaveLength(3);
    const go = goSections(s, sections, tempo, r.t, true, 0);
    expect(go).toMatchObject({ kind: 'vampExit', at: null });
    r = run(s, sections, r.t, r.t + 4);
    expect(r.t).toBeGreaterThan(8);
    expect(r.events).toContain('leave:loop');
  });

  it('vamp with "GO: at the next bar": leaves at the next bar line, landing on the section end', () => {
    const s = createSectionPlayerState();
    const sections = [sec('loop', 0, 8, { action: 'vamp', exit: 'bar' })];
    // GO at 2.5 s: the next bar is at 4 s.
    const go = goSections(s, sections, tempo, 2.5, true, 0);
    expect(go).toMatchObject({ kind: 'vampExit', at: 4 });
    const step = stepSections(s, sections, tempo, 3.98, 4.02, 0);
    expect(step.kind).toBe('wrap');
    expect(step.time).toBeCloseTo(8.02, 9);
  });

  it('jump: plays the section N times, then goes to the other section; the count starts over after', () => {
    const s = createSectionPlayerState();
    const sections = [sec('verse', 0, 4, { action: 'jump', jumpTo: 'outro', passes: 3 }), sec('chorus', 4, 8), sec('outro', 8, 12)];
    const r = run(s, sections, 0, 12.5);
    expect(r.events).toEqual(['loop:verse', 'loop:verse', 'jump:verse>outro']);
    // 12.5 s of playing: 3 passes of verse (12 s), then 0.5 s into the outro.
    expect(r.t).toBeCloseTo(8.5, 6);
    expect(s.passes.verse).toBe(0);
  });

  it('jump with one pass jumps at once (backwards too: a loop of the show)', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4), sec('b', 4, 8, { action: 'jump', jumpTo: 'a', passes: 1 })];
    const r = run(s, sections, 6, 9);
    expect(r.events).toEqual(['jump:b>a']);
    expect(r.t).toBeCloseTo(1, 6);
  });

  it('live: entering hands the pieces over, the end holds, GO takes them back and plays on', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4), sec('live', 4, 8, { action: 'live', livePieces: 'all' }), sec('c', 8, 12)];
    const now = { t: 0 };
    let r = run(s, sections, 3, 9, 0.05, now);
    expect(r.events).toEqual(['liveStart:live', 'hold:live']);
    expect(r.t).toBeCloseTo(8 - HOLD_EPSILON, 9);
    const go = goSections(s, sections, tempo, r.t, true, now.t);
    expect(go.kind).toBe('resume');
    if (go.kind === 'resume') expect(go.events.map((e) => e.type)).toEqual(['resume', 'liveEnd']);
    r = run(s, sections, r.t, r.t + 1, 0.05, now);
    expect(r.events).toEqual([]);
    expect(s.live).toBeNull();
  });

  it('live armed by GO before its end: hand-back at the end, no hold', () => {
    const s = createSectionPlayerState();
    const sections = [sec('live', 0, 4, { action: 'live' })];
    let r = run(s, sections, 0, 1);
    expect(r.events).toEqual(['liveStart:live']);
    goSections(s, sections, tempo, 1, true, 0);
    r = run(s, sections, 1, 5);
    expect(r.events).toEqual(['liveEnd:live']);
    expect(r.t).toBeCloseTo(5, 6);
  });

  it('a reset (seek, Stop) forgets the hold and gives Live pieces back', () => {
    const s = createSectionPlayerState();
    const sections = [sec('live', 0, 4, { action: 'live' })];
    run(s, sections, 0, 5);
    expect(s.hold).not.toBeNull();
    const events = resetSections(s, sections);
    expect(events.map((e) => e.type)).toEqual(['liveEnd']);
    expect(s.hold).toBeNull();
    expect(s.live).toBeNull();
  });
});

describe('free-running blocks', () => {
  it('a block spanning the vamp runs on by a section length each pass; one inside the section restarts', () => {
    const s = createSectionPlayerState();
    const sections = [sec('loop', 4, 8, { action: 'vamp' })];
    run(s, sections, 3, 3 + 1 + 4 + 4); // two wraps
    expect(freeRunOffset(s, 0, 20, 0)).toBeCloseTo(8, 9);
    expect(freeRunOffset(s, 4, 8, 0)).toBeCloseTo(8, 9);
    // Starts inside the loop: not on screen at the wrap's landing (4 s), it starts fresh each pass.
    expect(freeRunOffset(s, 6, 8, 0)).toBe(0);
    // Starts after the section: never lived through it.
    expect(freeRunOffset(s, 8, 12, 0)).toBe(0);
  });

  it('a hold adds the time held to the blocks on screen at the hold point', () => {
    const s = createSectionPlayerState();
    const sections = [sec('a', 0, 4, { action: 'hold' })];
    const now = { t: 100 };
    run(s, sections, 3.5, 4.5, 0.05, now);
    const holdStart = s.hold!.since;
    expect(freeRunOffset(s, 0, 4, holdStart + 2.5)).toBeCloseTo(2.5, 9);
    expect(freeRunOffset(s, 4, 8, holdStart + 2.5)).toBe(0);
    goSections(s, sections, tempo, 4 - HOLD_EPSILON, true, holdStart + 3);
    expect(freeRunOffset(s, 0, 4, holdStart + 10)).toBeCloseTo(3, 9);
  });
});

describe('model', () => {
  it('normalizes saved sections: sorted, overlaps trimmed, unknown jumps dropped', () => {
    const list = normalizeSections([
      { id: 'b', name: 'B', start: 8, end: 16, action: 'jump', jumpTo: 'gone', passes: 2 },
      { id: 'a', name: 'A', start: 0, end: 10, action: 'vamp', exit: 'bar' },
      { id: 'x', start: 'bad' },
    ]);
    expect(list.map((s) => [s.id, s.start, s.end])).toEqual([['a', 0, 10], ['b', 10, 16]]);
    expect(list[0].exit).toBe('bar');
    expect(list[1].jumpTo).toBeNull();
    expect(tidySections(list)).toEqual(list);
  });

  it('new sections land on bars, up to the next section', () => {
    expect(nearestBar(tempo, 4.9)).toBe(4);
    const span = placeNewSection([sec('n', 10, 20)], tempo, 4.9, 8);
    expect(span).toEqual({ start: 4, end: 10 });
    expect(placeNewSection([sec('n', 10, 20)], tempo, 12)).toBeNull();
  });
});
