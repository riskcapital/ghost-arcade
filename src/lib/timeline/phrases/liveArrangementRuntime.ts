/**
 * Sections ↔ Live's locators, as the Timeline's buttons and the sync use
 * them (see liveArrangement.ts for the rules).
 *
 * - "Sections from Live locators": one undo step. A Timeline with no tempo
 *   gets Live's (tempo and time signature) so bars line up.
 * - "Keep in sync" (saved with the Ableton connection): whenever Live's
 *   locators change, the sections follow (one undo step each change).
 * - "Send sections to Live": locators by name (script protocol 6; Live has
 *   to be stopped: it only places a locator at its own playhead).
 */
import { get } from 'svelte/store';
import { showTimeline } from '../../stores/showTimeline';
import { abletonBridge, LIVE_PHRASE_PROTOCOL } from '../../ableton/abletonBridge';
import { timecodeChase } from '../../show/timecode/timecodeChase';
import { createTempoMap } from '../../show/tempoMap';
import type { ShowTempoMap } from '../../types';
import { locatorsFromSections, sameSpans, sectionsFromLocators } from './liveArrangement';

export type LocatorOutcome =
  | { ok: true; count: number }
  | { ok: false; reason: 'notConnected' | 'noLocators' | 'needsUpdate' | 'playing' | 'noAnswer' | 'noSections' | 'unchanged' };

function barOffset(): number {
  return timecodeChase.current.barOffset;
}

function liveMap(): ShowTempoMap {
  const b = get(abletonBridge);
  const beatsPerBar = Math.max(1, Math.min(16, Math.round(b.numerator || 4)));
  const unit = b.denominator === 8 || b.denominator === 2 || b.denominator === 16 ? b.denominator : 4;
  return createTempoMap(b.tempo > 0 ? b.tempo : 120, 0, beatsPerBar, unit as 4);
}

/** Lay Live's locators down as sections (one undo step). */
export function sectionsFromLive(opts: { quietIfSame?: boolean } = {}): LocatorOutcome {
  const b = get(abletonBridge);
  if (!b.connected) return { ok: false, reason: 'notConnected' };
  if (!b.cues.length) return { ok: false, reason: 'noLocators' };
  const s = get(showTimeline);
  const map = s.tempo ?? liveMap();
  const next = sectionsFromLocators(b.cues, map, barOffset(), s.sections, s.duration);
  if (opts.quietIfSame && sameSpans(next, s.sections)) return { ok: false, reason: 'unchanged' };
  showTimeline.replaceTimelineParts({ sections: next, ...(s.tempo ? {} : { tempo: map }) });
  return { ok: true, count: next.length };
}

/** Send the sections to Live as locators (by name). */
export async function sendSectionsToLive(): Promise<LocatorOutcome & { added?: number; moved?: number }> {
  const b = get(abletonBridge);
  if (!b.connected) return { ok: false, reason: 'notConnected' };
  if (b.protocol < LIVE_PHRASE_PROTOCOL) return { ok: false, reason: 'needsUpdate' };
  const s = get(showTimeline);
  if (!s.sections.length) return { ok: false, reason: 'noSections' };
  const items = locatorsFromSections(s.sections, s.tempo ?? liveMap(), barOffset());
  const result = await abletonBridge.setLocators(items);
  if (!result) return { ok: false, reason: 'noAnswer' };
  if ('needsUpdate' in result) return { ok: false, reason: 'needsUpdate' };
  if (result.errors.includes('playing')) return { ok: false, reason: 'playing' };
  return { ok: true, count: items.length, added: result.added, moved: result.moved };
}

/** What a refused locator action says to the user. */
export function locatorMessage(reason: Extract<LocatorOutcome, { ok: false }>['reason']): string {
  switch (reason) {
    case 'notConnected': return 'Live is not connected: open the Ableton panel and turn the connection on.';
    case 'noLocators': return 'The Live set has no locators yet.';
    case 'needsUpdate': return 'Update the Ghost Arcade script in Live (Ableton panel → Install, then restart Live) to send locators.';
    case 'playing': return 'Stop Live first: Live only places locators while it is stopped.';
    case 'noAnswer': return 'Live did not answer. Is the Ghost Arcade control surface on in Live?';
    case 'noSections': return 'The Timeline has no sections to send.';
    case 'unchanged': return 'The sections already match Live’s locators.';
  }
}

/** Follow Live's locators while "Keep in sync" is on. */
export function installLocatorSync(): () => void {
  let lastSig = '';
  return abletonBridge.subscribe((b) => {
    if (!b.syncLocators || !b.connected) {
      lastSig = '';
      return;
    }
    const sig = JSON.stringify(b.cues);
    if (sig === lastSig) return;
    lastSig = sig;
    if (!b.cues.length || get(showTimeline).doc !== 'timeline') return;
    queueMicrotask(() => sectionsFromLive({ quietIfSame: true }));
  });
}
