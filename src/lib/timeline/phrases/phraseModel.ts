/**
 * A/V phrases: a Timeline section published as a pad.
 *
 * In Mapping mode the Timeline plays its sections as a choreographed show.
 * A published section is also a phrase: a pad (VJ mode's Phrases strip, the
 * Timeline's phrase strip, MIDI `show:phrase:<n>`) that plays that stretch of
 * the Timeline from its start: visual blocks on the pieces, looks, where
 * lines, lines, LED blocks, sound rows and its Live clips, quantised to the
 * bar. Nothing is copied: a phrase is the section itself, played by the
 * Timeline's own transport, so editing the Timeline edits the phrase.
 *
 * At its end a phrase does what its section does (hold, loop, jump, play
 * on), or what the phrase says instead (loop / hold / play on), until
 * another phrase is launched; that one takes over on the next bar.
 *
 * A section can also fire a Live scene where it starts (played through on
 * the Timeline, or launched as a phrase).
 *
 * Pure: no stores.
 */
import type { SectionAction, TimelineSection } from '../sections/sectionModel';

export const PHRASE_ENDS = ['section', 'loop', 'hold', 'through'] as const;
export type PhraseEnd = (typeof PHRASE_ENDS)[number];

/** The section is published as a phrase. */
export interface SectionPhrase {
  /** What the phrase does at the section's end while it is the playing phrase. */
  end: PhraseEnd;
}

/** A Live scene the section fires where it starts. */
export interface SectionLiveScene {
  scene: number;
  /** Found again by name when scenes move in Live. */
  name: string;
}

/** A launch hands over with a crossfade this long on the pieces and looks. */
export const PHRASE_XFADE_SECONDS = 0.25;

export const PHRASE_END_LABELS: Record<PhraseEnd, string> = {
  section: 'As the section',
  loop: 'Loops',
  hold: 'Holds',
  through: 'Plays on',
};

export function normalizePhrase(raw: unknown): SectionPhrase | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const end = (raw as { end?: unknown }).end;
  return { end: (PHRASE_ENDS as readonly string[]).includes(end as string) ? (end as PhraseEnd) : 'section' };
}

export function normalizeLiveScene(raw: unknown): SectionLiveScene | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as { scene?: unknown; name?: unknown };
  const scene = Number(r.scene);
  if (!Number.isInteger(scene) || scene < 0) return undefined;
  return { scene, name: typeof r.name === 'string' ? r.name.slice(0, 80) : '' };
}

/** The published sections, in time order: pad 1, 2, 3… */
export function phraseSections(sections: readonly TimelineSection[]): TimelineSection[] {
  return sections.filter((s) => !!s.phrase);
}

/** A phrase's pad number (1-based), 0 when the section is not published. */
export function phraseNumber(sections: readonly TimelineSection[], id: string): number {
  return phraseSections(sections).findIndex((s) => s.id === id) + 1;
}

/** The phrase on pad `n` (1-based). */
export function phraseByNumber(sections: readonly TimelineSection[], n: number): TimelineSection | null {
  return phraseSections(sections)[n - 1] ?? null;
}

/** What the playing phrase's section does at its end. */
export function phraseEndAction(section: TimelineSection): SectionAction {
  switch (section.phrase?.end) {
    case 'loop': return 'vamp';
    case 'hold': return 'hold';
    case 'through': return 'through';
    default: return section.action;
  }
}

/**
 * The sections as the section player sees them while `activeId` is the
 * playing phrase: that section's end action replaced by the phrase's. A loop
 * the phrase asks for leaves at the end of a pass on GO, like any vamp; a
 * new phrase leaves it on the bar.
 */
export function withPhraseEnd(sections: readonly TimelineSection[], activeId: string | null): readonly TimelineSection[] {
  if (!activeId) return sections;
  const i = sections.findIndex((s) => s.id === activeId);
  if (i < 0) return sections;
  const s = sections[i];
  const action = phraseEndAction(s);
  if (action === s.action) return sections;
  const next = sections.slice();
  next[i] = { ...s, action, ...(action === 'vamp' ? { exit: s.exit ?? 'end' } : {}) };
  return next;
}

/**
 * The launch grid in beats for VJ mode's launch quantise. A phrase is a
 * stretch of bars, so it never starts off the bar: Off and beat grids launch
 * on the next bar.
 */
export function phraseGridBeats(quantization: string): number {
  if (quantization === '2bar') return 8;
  if (quantization === '4bar') return 16;
  return 4;
}

/** The colour a pad glows in: the section's. */
export function phraseColor(section: Pick<TimelineSection, 'color'>): string {
  return section.color;
}
