/**
 * What the sections do to the playhead while the Timeline plays. Pure: the
 * transport hands it the step it is about to take (from `prev` to `next`
 * show seconds) and gets back where the playhead really goes; GO, a seek
 * and Stop are calls. The clock (`now`, seconds) is passed in, so a test
 * runs a whole show with a fake one.
 *
 *   hold / live  the playhead stops on the section's last instant (`end` −
 *                HOLD_EPSILON, so the section's own blocks stay up) until GO
 *   vamp         at the end the playhead goes back to the section's start by
 *                the section's length (a loop wrap, so the transport keeps
 *                its clock); GO leaves at the end of the pass, or at the next
 *                bar line for `exit: 'bar'` (then it jumps to the end)
 *   jump         the section plays `passes` times, then goes to `jumpTo`
 *
 * GO also arms a stop ahead: pressed while the playhead is inside a hold,
 * live or vamp section, that section plays on at its end.
 *
 * FREE-RUNNING CONTENT
 * --------------------
 * While the playhead holds, loops or jumps, blocks keep running unless they
 * are marked to stop: a block that is on screen before and after a jump (or
 * at a hold) carries on from where its media was instead of jumping back
 * with the playhead. Each such move is recorded as (from, to, extra): a
 * block spanning both `from` and `to` runs `extra` seconds ahead from then
 * on (`freeRunOffset`). A hold counts the time it has been holding.
 *
 * Export never runs through here: an offline render plays the Timeline
 * straight through (see showTimeline's tick), so a render is the same every
 * time whatever the operator did live.
 */
import type { ShowTempoMap } from '../../types';
import { nextBarAfter, sectionAt, type TimelineSection } from './sectionModel';

/** The hold point sits this far before the section's end. */
export const HOLD_EPSILON = 1e-4;

export interface SectionHold {
  sectionId: string;
  /** Show time the playhead holds at. */
  at: number;
  /** Clock seconds the hold began. */
  since: number;
}

export interface FreeRunEvent {
  from: number;
  to: number;
  /** Seconds a block spanning both runs ahead from then on. */
  extra: number;
}

export interface SectionPlayerState {
  hold: SectionHold | null;
  /** Sections GO armed to play on at their end. */
  armed: string[];
  /** A vamp GO asked to leave: at the end of the pass (at = null) or at a bar line. */
  vampExit: { sectionId: string; at: number | null } | null;
  /** Passes played of each jump section (resets after the jump). */
  passes: Record<string, number>;
  /** The Live section whose pieces are handed over. */
  live: string | null;
  /** That section as it was when it took over: its pieces are still given
   *  back if it is deleted or replaced (undo, Score) while live. */
  liveSection?: TimelineSection | null;
  freeRun: FreeRunEvent[];
}

export type SectionEvent =
  | { type: 'hold'; section: TimelineSection }
  | { type: 'resume'; section: TimelineSection }
  | { type: 'loop'; section: TimelineSection }
  | { type: 'jump'; from: TimelineSection; to: TimelineSection }
  | { type: 'leave'; section: TimelineSection }
  | { type: 'liveStart'; section: TimelineSection }
  | { type: 'liveEnd'; section: TimelineSection };

export type SectionStep =
  /** Carry on to `time` (no section in the way). */
  | { kind: 'play'; time: number; events: SectionEvent[] }
  /** Stay at `time` (a hold). */
  | { kind: 'hold'; time: number; events: SectionEvent[] }
  /** The playhead moved by a loop or a jump: `time` = next − shift. */
  | { kind: 'wrap'; time: number; shift: number; events: SectionEvent[] };

export type GoResult =
  | { kind: 'resume'; section: TimelineSection; events: SectionEvent[] }
  | { kind: 'armed'; section: TimelineSection }
  | { kind: 'vampExit'; section: TimelineSection; at: number | null }
  | { kind: 'play' }
  | { kind: 'none' };

export function createSectionPlayerState(): SectionPlayerState {
  return { hold: null, armed: [], vampExit: null, passes: {}, live: null, liveSection: null, freeRun: [] };
}

const byId = (sections: readonly TimelineSection[], id: string | null | undefined) => (id ? sections.find((s) => s.id === id) ?? null : null);

/** The Live section handed over, even when it is no longer in the list. */
function liveOf(state: SectionPlayerState, sections: readonly TimelineSection[]): TimelineSection | null {
  if (!state.live) return null;
  return byId(sections, state.live) ?? (state.liveSection?.id === state.live ? state.liveSection : null);
}

/**
 * The step from `prev` to `next` (seconds, next ≥ prev) while playing.
 * Mutates `state`; the events say what happened (for the takeover, the UI).
 */
export function stepSections(
  state: SectionPlayerState,
  sections: readonly TimelineSection[],
  tempo: ShowTempoMap | null,
  prev: number,
  next: number,
  now: number,
): SectionStep {
  const events: SectionEvent[] = [];
  if (state.hold) {
    if (!byId(sections, state.hold.sectionId)) {
      // The section went while holding: play on.
      state.hold = null;
    } else {
      return { kind: 'hold', time: state.hold.at, events };
    }
  }
  // A Live section the playhead is inside hands its pieces over (entering
  // it, or starting to play inside it).
  const here = sectionAt(sections, prev);
  if (here && here.action === 'live' && state.live !== here.id && !state.armed.includes(here.id)) {
    if (state.live) {
      const old = liveOf(state, sections);
      if (old) events.push({ type: 'liveEnd', section: old });
    }
    state.live = here.id;
    state.liveSection = here;
    events.push({ type: 'liveStart', section: here });
  } else if (state.live && (!here || here.id !== state.live)) {
    const old = liveOf(state, sections);
    state.live = null;
    state.liveSection = null;
    if (old) events.push({ type: 'liveEnd', section: old });
  }

  // A vamp leaving at a bar line inside the pass: jump to the section's end.
  const vx = state.vampExit;
  if (vx && vx.at !== null) {
    const s = byId(sections, vx.sectionId);
    if (!s) state.vampExit = null;
    else if (prev < vx.at - 1e-9 && next >= vx.at - 1e-9 && vx.at < s.end - 1e-9) {
      state.vampExit = null;
      const time = s.end + (next - vx.at);
      state.freeRun.push({ from: vx.at, to: s.end, extra: vx.at - s.end });
      events.push({ type: 'leave', section: s });
      return { kind: 'wrap', time, shift: next - time, events };
    }
  }

  // The first section end crossed by this step decides.
  const crossed = sections
    .filter((s) => prev < s.end - 1e-9 && next >= s.end - 1e-9)
    .sort((a, b) => a.end - b.end);
  for (const s of crossed) {
    const armedAt = state.armed.indexOf(s.id);
    switch (s.action) {
      case 'through':
        continue;
      case 'hold':
      case 'live': {
        if (armedAt >= 0) {
          state.armed.splice(armedAt, 1);
          if (s.action === 'live' && state.live === s.id) {
            state.live = null;
            state.liveSection = null;
            events.push({ type: 'liveEnd', section: s });
          }
          continue;
        }
        const at = Math.max(s.start, s.end - HOLD_EPSILON);
        state.hold = { sectionId: s.id, at, since: now };
        events.push({ type: 'hold', section: s });
        return { kind: 'hold', time: at, events };
      }
      case 'vamp': {
        if (state.vampExit?.sectionId === s.id || armedAt >= 0) {
          state.vampExit = null;
          if (armedAt >= 0) state.armed.splice(armedAt, 1);
          events.push({ type: 'leave', section: s });
          continue;
        }
        const length = s.end - s.start;
        const time = next - length;
        state.freeRun.push({ from: s.end, to: s.start, extra: length });
        events.push({ type: 'loop', section: s });
        return { kind: 'wrap', time, shift: length, events };
      }
      case 'jump': {
        const target = byId(sections, s.jumpTo);
        if (!target) continue;
        const count = (state.passes[s.id] ?? 0) + 1;
        const passes = Math.max(1, s.passes ?? 1);
        if (count < passes) {
          state.passes[s.id] = count;
          const length = s.end - s.start;
          state.freeRun.push({ from: s.end, to: s.start, extra: length });
          events.push({ type: 'loop', section: s });
          return { kind: 'wrap', time: next - length, shift: length, events };
        }
        state.passes[s.id] = 0;
        const time = target.start + (next - s.end);
        state.freeRun.push({ from: s.end, to: target.start, extra: s.end - target.start });
        events.push({ type: 'jump', from: s, to: target });
        return { kind: 'wrap', time, shift: next - time, events };
      }
    }
  }
  return { kind: 'play', time: next, events };
}

/**
 * GO at show time `t`. A hold resumes (its section plays on from its end);
 * inside a vamp it leaves at the end of the pass (or the next bar line);
 * inside a hold or live section it arms the section to play on; stopped,
 * it asks to play.
 */
export function goSections(
  state: SectionPlayerState,
  sections: readonly TimelineSection[],
  tempo: ShowTempoMap | null,
  t: number,
  playing: boolean,
  now: number,
): GoResult {
  if (state.hold) {
    const s = byId(sections, state.hold.sectionId);
    const hold = state.hold;
    state.hold = null;
    if (!s) return playing ? { kind: 'none' } : { kind: 'play' };
    state.freeRun.push({ from: hold.at, to: hold.at, extra: Math.max(0, now - hold.since) });
    // The step past the end must not stop here again.
    if (!state.armed.includes(s.id)) state.armed.push(s.id);
    const events: SectionEvent[] = [{ type: 'resume', section: s }];
    if (s.action === 'live' && state.live === s.id) {
      state.live = null;
      state.liveSection = null;
      events.push({ type: 'liveEnd', section: s });
    }
    return { kind: 'resume', section: s, events };
  }
  if (!playing) return { kind: 'play' };
  const s = sectionAt(sections, t);
  if (!s) return { kind: 'none' };
  if (s.action === 'vamp') {
    let at: number | null = null;
    if (s.exit === 'bar') {
      const bar = nextBarAfter(tempo, t);
      at = bar < s.end - 1e-6 ? bar : null;
    }
    state.vampExit = { sectionId: s.id, at };
    return { kind: 'vampExit', section: s, at };
  }
  if (s.action === 'hold' || s.action === 'live') {
    if (!state.armed.includes(s.id)) state.armed.push(s.id);
    return { kind: 'armed', section: s };
  }
  return { kind: 'none' };
}

/** A seek, Stop or a new document: everything the playhead was in is forgotten. */
export function resetSections(state: SectionPlayerState, sections: readonly TimelineSection[]): SectionEvent[] {
  const events: SectionEvent[] = [];
  const live = liveOf(state, sections);
  if (live) events.push({ type: 'liveEnd', section: live });
  Object.assign(state, createSectionPlayerState());
  return events;
}

/**
 * How far ahead a block spanning [start, end) runs because of the holds,
 * loops and jumps it lived through (0 for a block that started fresh).
 */
export function freeRunOffset(state: SectionPlayerState, start: number, end: number, now: number): number {
  const spans = (t: number) => start <= t + 1e-9 && end > t + 1e-6;
  const spansEnd = (t: number) => start < t - 1e-6 && end >= t - 1e-6;
  let extra = 0;
  for (const e of state.freeRun) {
    const fromOk = e.from === e.to ? spans(e.from) : spansEnd(e.from);
    if (fromOk && spans(e.to)) extra += e.extra;
  }
  const hold = state.hold;
  if (hold && spans(hold.at)) extra += Math.max(0, now - hold.since);
  return extra;
}

/** The next stop (a section end that waits for GO) at or after `t`. */
export function nextStop(sections: readonly TimelineSection[], t: number): TimelineSection | null {
  for (const s of sections) if (s.end > t + 1e-6 && (s.action === 'hold' || s.action === 'vamp' || s.action === 'live')) return s;
  return null;
}
