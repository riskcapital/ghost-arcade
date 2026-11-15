/**
 * The Timeline's one GO, as a pure rule.
 *
 * There used to be two: the sections' GO (release a hold, leave a loop) and
 * the cue list's GO (fire the next cue). Now there is one, the same from the
 * toolbar, the Perform tab, Enter and MIDI / OSC `show:go`:
 *
 *   1. a section holding at its end (Hold for GO, Hand to VJ decks) or
 *      looping (Loop until GO) is released;
 *   2. otherwise the step on standby goes:
 *      - one put on standby by hand (double-click in the list): a manual
 *        cue or a marker's cue fires, a section is jumped to;
 *      - else the next timed step after the playhead (a section or a
 *        marker): the sections' own GO (arms a hold ahead; stopped, plays).
 *        GO never fires a marker early: markers fire as the playhead
 *        crosses them;
 *      - else, past every timed step, the next manual cue fires;
 *   3. nothing left: stopped, GO plays; playing, it does nothing.
 *
 * Takeover and phrases do not change it (Return is R; phrases are pads).
 */
import type { TimelineSection } from '../sections/sectionModel';
import type { StackItem } from './cueStack';

/** A step put on standby by hand (the list's double-click). */
export type HandStandby =
  | { kind: 'section'; id: string }
  | { kind: 'marker'; id: string; cueId: string | null }
  | { kind: 'cue'; id: string };

export interface GoInput {
  playing: boolean;
  /** Sections run (the Timeline, no outside clock following): holds and loops exist. */
  sectionsRun: boolean;
  sections: readonly TimelineSection[];
  /** The section under the playhead. */
  hereId: string | null;
  /** Section status: the one holding at its end, the loop told to leave. */
  holdId: string | null;
  vampExitId: string | null;
  hand: HandStandby | null;
  /** What stands by without a hand: the next timed step, else the next manual cue. */
  standby: StackItem | null;
}

export type GoDecision =
  /** A holding or looping section lets go (showTimeline.go()). */
  | { kind: 'release'; sectionId: string }
  /** A cue fires now (a manual cue, or a marker's cue on standby by hand). */
  | { kind: 'fireCue'; cueId: string }
  /** A section on standby by hand: the playhead goes to its start (and plays). */
  | { kind: 'jumpTo'; sectionId: string }
  /** The sections' own GO: arm the hold ahead, or play when stopped. */
  | { kind: 'sections' }
  | { kind: 'play' }
  | { kind: 'none' };

/** The section looping now that GO would leave, if any. */
export function looping(i: Pick<GoInput, 'playing' | 'sectionsRun' | 'sections' | 'hereId' | 'vampExitId'>): TimelineSection | null {
  if (!i.playing || !i.sectionsRun) return null;
  const here = i.hereId ? i.sections.find((s) => s.id === i.hereId) ?? null : null;
  return here && here.action === 'vamp' && i.vampExitId !== here.id ? here : null;
}

export function goDecision(i: GoInput): GoDecision {
  if (i.sectionsRun && i.holdId) return { kind: 'release', sectionId: i.holdId };
  const loop = looping(i);
  if (loop) return { kind: 'release', sectionId: loop.id };
  if (i.hand) {
    if (i.hand.kind === 'section') return { kind: 'jumpTo', sectionId: i.hand.id };
    if (i.hand.kind === 'cue') return { kind: 'fireCue', cueId: i.hand.id };
    if (i.hand.cueId) return { kind: 'fireCue', cueId: i.hand.cueId };
  }
  const s = i.standby;
  if (s?.kind === 'cue') return { kind: 'fireCue', cueId: s.cue.id };
  if (s && i.sectionsRun && i.sections.length) return { kind: 'sections' };
  if (!i.playing) return { kind: 'play' };
  return { kind: 'none' };
}

/**
 * The manual cue that stands by: the cue list's own standby when it is a
 * manual cue; with nothing fired yet, the first manual cue; after a manual
 * cue, the next one. Null when none is left.
 */
export function manualStandby(stack: readonly StackItem[], standbyCueId: string | null, currentCueId: string | null): StackItem | null {
  const manual = stack.filter((i) => i.kind === 'cue');
  if (!manual.length) return null;
  const sb = standbyCueId ? manual.find((i) => i.id === standbyCueId) : undefined;
  if (sb) return sb;
  if (!currentCueId) return manual[0];
  const at = manual.findIndex((i) => i.id === currentCueId);
  return at >= 0 ? manual[at + 1] ?? null : manual[0];
}

/**
 * The step on standby without a hand: the first timed step after the
 * playhead (a hair past it counts as passed), else the manual cue standing by.
 */
export function nextStandby(stack: readonly StackItem[], t: number, manual: StackItem | null): StackItem | null {
  for (const item of stack) if (item.time !== null && item.time > t + 1e-4) return item;
  return manual;
}

/** The step the show is in: the last timed step at or before the playhead. */
export function nowItem(stack: readonly StackItem[], t: number): StackItem | null {
  let found: StackItem | null = null;
  for (const item of stack) if (item.time !== null && item.time <= t + 1e-4) found = item;
  return found;
}

/** What GO will do, in words (under the big GO). */
export function goWords(d: GoDecision, sections: readonly TimelineSection[], standbyName: string): string {
  const name = (id: string) => sections.find((s) => s.id === id)?.name ?? 'the section';
  switch (d.kind) {
    case 'release': {
      const s = sections.find((x) => x.id === d.sectionId);
      if (s?.action === 'vamp') return s.exit === 'bar' ? `Leaves the ${s.name} loop at the next bar` : `Leaves the ${s.name} loop at the end of this pass`;
      if (s?.action === 'live') return `Takes the pieces back and goes on from ${name(d.sectionId)}`;
      return `Goes on from ${name(d.sectionId)}`;
    }
    case 'fireCue': return `Fires ${standbyName}`;
    case 'jumpTo': return `Goes to ${name(d.sectionId)}`;
    case 'sections': return standbyName ? `Next: ${standbyName}` : 'Nothing waits yet';
    case 'play': return 'Plays the show';
    case 'none': return 'Nothing waits';
  }
}
