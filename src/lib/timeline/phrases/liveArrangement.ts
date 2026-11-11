/**
 * Live's arrangement and the Timeline's sections, both ways.
 *
 * - Live leads: each arrangement locator starts a section that runs to the
 *   next locator (the last one to the end of the Timeline, or 8 bars). A
 *   section that already has the locator's name keeps everything it is (end
 *   action, colour, phrase, Live scene) and only moves; new ones are named
 *   and coloured after the locator ("Drop 1" is a drop).
 * - Timeline leads: each section becomes a locator with its name at its
 *   start (the Ghost Arcade script creates or moves locators by name, and
 *   never deletes one).
 *
 * Song positions are quarter notes from Live's bar 1; the follow settings'
 * bar offset says which Timeline bar that is (the same as following Live's
 * song position or Link). Pure.
 */
import type { ShowTempoMap } from '../../types';
import { beatAtSeconds } from '../../show/tempoMap';
import { showSecondsForSourceQuarters, sourceOriginQuarters } from '../../show/sync/beatChase';
import {
  makeSection,
  nextBarAfter,
  SECTION_KIND_COLORS,
  SECTION_MIN_SECONDS,
  tidySections,
  type SectionKind,
  type TimelineSection,
} from '../sections/sectionModel';

export interface LiveLocator { name: string; time: number }

/** Timeline seconds of a Live song position (quarters). */
export function liveToShowSeconds(map: ShowTempoMap, quarters: number, barOffset: number): number {
  return showSecondsForSourceQuarters(map, quarters, barOffset);
}

/** Live song position (quarters) of a Timeline time. */
export function showToLiveQuarters(map: ShowTempoMap, seconds: number, barOffset: number): number {
  return beatAtSeconds(map, seconds) - sourceOriginQuarters(map, barOffset);
}

const KIND_WORDS: Array<[RegExp, SectionKind]> = [
  [/intro/i, 'intro'],
  [/outro|ending|\bend\b/i, 'outro'],
  [/break ?down|\bbreak\b/i, 'breakdown'],
  [/build|rise|riser|pre-?chorus/i, 'build'],
  [/drop|chorus|hook/i, 'drop'],
  [/verse/i, 'verse'],
  [/bridge/i, 'bridge'],
];

/** What a section is, from a locator's name (none when it does not say). */
export function kindFromName(name: string): SectionKind | undefined {
  for (const [re, kind] of KIND_WORDS) if (re.test(name)) return kind;
  return undefined;
}

/**
 * Sections from Live's locators. `existing` sections with a locator's name
 * keep their settings; existing sections no locator section overlaps stay.
 * `end`: the Timeline's length (the last locator's section runs to it, or 8
 * bars when that is sooner than a bar on).
 */
export function sectionsFromLocators(
  locators: readonly LiveLocator[],
  map: ShowTempoMap,
  barOffset: number,
  existing: readonly TimelineSection[],
  end: number,
): TimelineSection[] {
  const named = new Map<string, TimelineSection>();
  for (const s of existing) if (!named.has(s.name)) named.set(s.name, s);
  const points = locators
    .map((l, i) => ({ name: l.name.trim() || `Locator ${i + 1}`, t: Math.round(liveToShowSeconds(map, l.time, barOffset) * 1e6) / 1e6 }))
    .filter((p) => p.t >= 0)
    .sort((a, b) => a.t - b.t);
  const made: TimelineSection[] = [];
  points.forEach((p, i) => {
    let stop = points[i + 1]?.t;
    if (stop === undefined) {
      let eight = p.t;
      for (let b = 0; b < 8; b++) eight = nextBarAfter(map, eight + 1e-6);
      stop = end > p.t + SECTION_MIN_SECONDS ? Math.max(end, nextBarAfter(map, p.t + 1e-6)) : eight;
    }
    if (stop - p.t < SECTION_MIN_SECONDS) return;
    const keep = named.get(p.name);
    if (keep) {
      named.delete(p.name);
      made.push({ ...keep, start: p.t, end: stop });
      return;
    }
    const kind = kindFromName(p.name);
    const section = makeSection([...existing, ...made], p.t, stop, { name: p.name.slice(0, 80) });
    if (kind) {
      section.kind = kind;
      section.color = SECTION_KIND_COLORS[kind];
    }
    made.push(section);
  });
  const overlaps = (s: TimelineSection) => made.some((m) => s.start < m.end - 1e-9 && s.end > m.start + 1e-9);
  const kept = existing.filter((s) => !made.some((m) => m.id === s.id) && !overlaps(s));
  return tidySections([...kept, ...made]);
}

/** Locators for Live: each section's name at its start (positions before Live's bar 1 are left out). */
export function locatorsFromSections(sections: readonly TimelineSection[], map: ShowTempoMap, barOffset: number): Array<{ name: string; beat: number }> {
  return sections
    .map((s) => ({ name: s.name, beat: Math.round(showToLiveQuarters(map, s.start, barOffset) * 1000) / 1000 }))
    .filter((l) => l.beat >= -1e-6)
    .map((l) => ({ name: l.name, beat: Math.max(0, l.beat) }));
}

/** The same names on the same spans (nothing to change). */
export function sameSpans(a: readonly TimelineSection[], b: readonly TimelineSection[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.name === b[i].name && Math.abs(s.start - b[i].start) < 1e-4 && Math.abs(s.end - b[i].end) < 1e-4);
}
