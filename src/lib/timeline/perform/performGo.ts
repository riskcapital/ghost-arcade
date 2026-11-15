/**
 * The Timeline's one GO at runtime (the rule is goRule.ts), and what the
 * Perform tab shows: the numbered list, the step the show is in (NOW) and
 * the one GO acts on (STANDBY).
 *
 * NOW and STANDBY follow the playhead, so they are derived from it; each is
 * published only when the step changes (an id), never every frame. Nothing
 * here writes a store while the show plays.
 */
import { derived, get, writable, type Readable } from 'svelte/store';
import { showTimeline, showSectionStatus } from '../../stores/showTimeline';
import { cueList, type CueFireSource } from '../../show/cueList';
import { distinct, showSlice } from '../../components/show/timeline/timelineSlices';
import { sectionAt } from '../sections/sectionModel';
import { buildCueStack, stackItemName, type StackItem } from './cueStack';
import { goDecision, goWords, manualStandby, nextStandby, nowItem, type GoDecision, type HandStandby } from './goRule';

/** A step put on standby by hand (double-click in the list); GO uses it once. */
export const handStandby = writable<HandStandby | null>(null);

const cueState = derived(cueList, (s) => s);
const markers = distinct(derived(cueState, (s) => s.markers));
const cues = distinct(derived(cueState, (s) => s.cues));
const cueStandbyId = distinct(derived(cueState, (s) => s.standbyCueId));
const cueCurrentId = distinct(derived(cueState, (s) => s.currentCueId));

/** The Timeline's one cue list: sections, markers and cues, numbered once. */
export const performStack: Readable<StackItem[]> = derived(
  [showSlice('sections'), markers, cues],
  ([sections, ms, cs]) => buildCueStack(sections, ms.filter((m) => (m.doc ?? 'show') === 'timeline'), cs),
);

const manual = derived([performStack, cueStandbyId, cueCurrentId], ([stack, sb, cur]) => manualStandby(stack, sb, cur));

function handId(hand: HandStandby): string {
  return hand.id;
}

/** The id of the step on standby (by hand, else the next one). */
export const standbyId: Readable<string | null> = distinct(derived(
  [performStack, showSlice('currentTime'), manual, handStandby],
  ([stack, t, man, hand]) => (hand ? handId(hand) : nextStandby(stack, t, man)?.id ?? null),
));

/** The id of the step the show is in (the last timed step at the playhead). */
export const nowId: Readable<string | null> = distinct(derived(
  [performStack, showSlice('currentTime')],
  ([stack, t]) => nowItem(stack, t)?.id ?? null,
));

/** What GO would do now, read at the moment (no subscription). */
export function goNow(): { decision: GoDecision; standby: StackItem | null; stack: StackItem[] } {
  const s = get(showTimeline);
  const status = get(showSectionStatus);
  const stack = buildCueStack(s.sections, cueList.state.markers.filter((m) => (m.doc ?? 'show') === 'timeline'), cueList.state.cues);
  const hand = get(handStandby);
  const man = manualStandby(stack, cueList.state.standbyCueId, cueList.state.currentCueId);
  const standby = hand ? stack.find((i) => i.id === hand.id) ?? null : nextStandby(stack, s.currentTime, man);
  const decision = goDecision({
    playing: s.isPlaying,
    sectionsRun: s.doc === 'timeline' && !showTimeline.isChasing(),
    sections: s.sections,
    hereId: sectionAt(s.sections, s.currentTime)?.id ?? null,
    holdId: status.holdId,
    vampExitId: status.vampExitId,
    hand,
    standby,
  });
  return { decision, standby, stack };
}

/** The words under the big GO: what it will do. */
export function goNowWords(): string {
  const { decision, standby } = goNow();
  return goWords(decision, get(showTimeline).sections, standby ? stackItemName(standby) : '');
}

/** GO: the Timeline's one GO (toolbar, Perform, Enter, MIDI / OSC show:go). */
export function performGo(source: CueFireSource = 'go'): GoDecision {
  const { decision } = goNow();
  switch (decision.kind) {
    case 'release':
    case 'sections':
      showTimeline.go();
      break;
    case 'fireCue':
      cueList.fire(decision.cueId, source);
      handStandby.set(null);
      break;
    case 'jumpTo': {
      const s = get(showTimeline);
      const target = s.sections.find((x) => x.id === decision.sectionId);
      handStandby.set(null);
      if (!target) break;
      showTimeline.seek(target.start);
      if (!get(showTimeline).isPlaying) showTimeline.play();
      break;
    }
    case 'play':
      showTimeline.play();
      break;
    case 'none':
      break;
  }
  return decision;
}

/** Back: to the start of the step the show is in (or, near its start, the one before); without timed steps, the cue before. */
export function performBack(): void {
  const s = get(showTimeline);
  const stack = get(performStack);
  const timed: StackItem[] = stack.filter((i) => i.time !== null);
  if (!timed.length) {
    cueList.back();
    return;
  }
  const now = nowItem(stack, s.currentTime);
  const at = now ? timed.indexOf(now) : -1;
  const target = now && s.currentTime - (now.time ?? 0) > 1 ? now : at > 0 ? timed[at - 1] : null;
  showTimeline.seek(target?.time ?? 0);
}

/** Stop: the show pauses, the cue list stops (standby kept). */
export function performStop(): void {
  showTimeline.pause();
  cueList.stop();
}

/** Reset: back to the start, the cue list from its first cue, no hand standby. */
export function performReset(): void {
  showTimeline.stop();
  cueList.reset();
  handStandby.set(null);
}

/** Double-click in the list: stand by on that step (again: let go). */
export function standByOn(item: StackItem): void {
  const cur = get(handStandby);
  if (cur && cur.id === item.id) { handStandby.set(null); return; }
  handStandby.set(item.kind === 'section'
    ? { kind: 'section', id: item.id }
    : item.kind === 'marker'
      ? { kind: 'marker', id: item.id, cueId: item.marker.cueId }
      : { kind: 'cue', id: item.id });
  if (item.kind === 'cue') cueList.setStandby(item.cue.id);
}
