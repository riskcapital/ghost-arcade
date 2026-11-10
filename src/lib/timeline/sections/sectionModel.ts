/**
 * Sections on the Timeline: named, coloured spans along the top, each with
 * what happens when the playhead reaches its end.
 *
 *   through  play on into whatever follows
 *   hold     stop the playhead on the section's last instant until GO
 *   vamp     loop the section until GO (the loop is the section's own span,
 *            which snaps to bars, so the vamp is bar-quantised); GO leaves
 *            at the end of the pass, or at the next bar line (`exit: 'bar'`)
 *   jump     play the section `passes` times, then go to section `jumpTo`
 *   live     hand pieces to the VJ decks (the takeover) for the section,
 *            hold at its end until GO, then give them back and play on
 *
 * Sections never overlap and are kept in time order. They are the unit the
 * A/V phrases of VJ mode will launch (a section = a range of the Timeline
 * with a name and a colour), so a section carries nothing that only makes
 * sense on the Timeline's own playhead.
 *
 * Saved as plain JSON in the Timeline (`sections`); see normalizeSections.
 */
import type { ShowTempoMap } from '../../types';
import { beatAtSeconds, secondsAtBeat } from '../../show/tempoMap';
import { generateUUID } from '../../utils/uuid';

export const SECTION_ACTIONS = ['through', 'hold', 'vamp', 'jump', 'live'] as const;
export type SectionAction = (typeof SECTION_ACTIONS)[number];

/** What a Live section shows on the pieces it takes over. */
export type SectionLiveSource =
  | { kind: 'vjMix' }
  | { kind: 'vjRow'; deck: 'A' | 'B'; row: number }
  | { kind: 'vjGroup'; groupId: string; name?: string }
  | { kind: 'black' };

/** What a section is in a song (set by Score the song; drives the draft). */
export const SECTION_KINDS = ['intro', 'verse', 'build', 'drop', 'breakdown', 'bridge', 'outro', 'other'] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export interface TimelineSection {
  id: string;
  name: string;
  /** '#rrggbb' */
  color: string;
  start: number;
  end: number;
  action: SectionAction;
  /** jump: the section to go to. */
  jumpTo?: string | null;
  /** jump: how many times the section plays before the jump (1 = jump at once). */
  passes?: number;
  /** vamp: where GO leaves the loop. */
  exit?: 'end' | 'bar';
  /** live: the pieces handed over (layer ids), or every piece. */
  livePieces?: 'all' | string[];
  liveSource?: SectionLiveSource;
  /** What the section is in the song (Score the song). */
  kind?: SectionKind;
  /** 0..1 how intense the music is here (Score the song). */
  energy?: number;
}

export const SECTION_MIN_SECONDS = 0.25;
export const SECTION_COLORS = ['#5b8def', '#f2994a', '#eb5757', '#27ae60', '#bb6bd9', '#2d9cdb', '#f2c94c', '#9b51e0', '#56ccf2', '#6fcf97'];
export const SECTION_KIND_COLORS: Record<SectionKind, string> = {
  intro: '#56ccf2',
  verse: '#5b8def',
  build: '#f2c94c',
  drop: '#eb5757',
  breakdown: '#9b51e0',
  bridge: '#27ae60',
  outro: '#2d9cdb',
  other: '#828282',
};
export const SECTION_KIND_NAMES: Record<SectionKind, string> = {
  intro: 'Intro',
  verse: 'Verse',
  build: 'Build',
  drop: 'Drop',
  breakdown: 'Breakdown',
  bridge: 'Bridge',
  outro: 'Outro',
  other: 'Section',
};

const HEX = /^#[0-9a-f]{6}$/i;
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

function normalizeLiveSource(raw: unknown): SectionLiveSource {
  const r = raw as Record<string, unknown> | null;
  if (r && r.kind === 'vjRow') return { kind: 'vjRow', deck: r.deck === 'B' ? 'B' : 'A', row: Math.max(0, Math.round(num(r.row, 0))) };
  if (r && r.kind === 'vjGroup' && typeof r.groupId === 'string') return { kind: 'vjGroup', groupId: r.groupId, ...(typeof r.name === 'string' ? { name: r.name } : {}) };
  if (r && r.kind === 'black') return { kind: 'black' };
  return { kind: 'vjMix' };
}

export function normalizeSection(raw: unknown, index = 0): TimelineSection | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const start = Math.max(0, num(r.start, NaN));
  const end = num(r.end, NaN);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start < SECTION_MIN_SECONDS - 1e-9) return null;
  const action = (SECTION_ACTIONS as readonly string[]).includes(r.action as string) ? (r.action as SectionAction) : 'through';
  const kind = (SECTION_KINDS as readonly string[]).includes(r.kind as string) ? (r.kind as SectionKind) : undefined;
  const out: TimelineSection = {
    id: typeof r.id === 'string' && r.id ? r.id : generateUUID(),
    name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 80) : `Section ${index + 1}`,
    color: typeof r.color === 'string' && HEX.test(r.color) ? r.color.toLowerCase() : SECTION_COLORS[index % SECTION_COLORS.length],
    start,
    end,
    action,
  };
  if (action === 'jump') {
    out.jumpTo = typeof r.jumpTo === 'string' ? r.jumpTo : null;
    out.passes = Math.max(1, Math.min(99, Math.round(num(r.passes, 1))));
  }
  if (action === 'vamp') out.exit = r.exit === 'bar' ? 'bar' : 'end';
  if (action === 'live') {
    out.livePieces = Array.isArray(r.livePieces) ? r.livePieces.filter((x): x is string => typeof x === 'string') : 'all';
    out.liveSource = normalizeLiveSource(r.liveSource);
  }
  if (kind) out.kind = kind;
  if (typeof r.energy === 'number' && Number.isFinite(r.energy)) out.energy = Math.max(0, Math.min(1, r.energy));
  return out;
}

/** Sections from a saved file: sorted, overlaps trimmed away, never thrown. */
export function normalizeSections(raw: unknown): TimelineSection[] {
  if (!Array.isArray(raw)) return [];
  const list = raw.map((r, i) => normalizeSection(r, i)).filter((s): s is TimelineSection => s !== null);
  return tidySections(list);
}

/** Sorted by start; a section that overlaps the one before starts where it ends. */
export function tidySections(list: readonly TimelineSection[]): TimelineSection[] {
  const sorted = [...list].sort((a, b) => a.start - b.start || a.end - b.end);
  const out: TimelineSection[] = [];
  const ids = new Set<string>();
  for (const s of sorted) {
    const prev = out[out.length - 1];
    let next = s;
    if (prev && next.start < prev.end - 1e-9) {
      next = { ...next, start: prev.end };
      if (next.end - next.start < SECTION_MIN_SECONDS - 1e-9) continue;
    }
    if (ids.has(next.id)) next = { ...next, id: generateUUID() };
    ids.add(next.id);
    out.push(next);
  }
  // A jump to a section that is gone plays through.
  return out.map((s) => (s.action === 'jump' && s.jumpTo && !ids.has(s.jumpTo) ? { ...s, jumpTo: null } : s));
}

export function sectionAt(sections: readonly TimelineSection[], t: number): TimelineSection | null {
  for (const s of sections) if (t >= s.start - 1e-9 && t < s.end - 1e-9) return s;
  return null;
}

export function sectionsEnd(sections: readonly TimelineSection[]): number {
  let end = 0;
  for (const s of sections) end = Math.max(end, s.end);
  return end;
}

/** The section's end needs GO (or is a jump/loop): it is a stop on the cue list. */
export function sectionStops(s: Pick<TimelineSection, 'action'>): boolean {
  return s.action === 'hold' || s.action === 'vamp' || s.action === 'live';
}

/** One bar's length in seconds at `t` (2 s without a tempo map). */
export function barSecondsAt(tempo: ShowTempoMap | null, t: number): number {
  if (!tempo) return 2;
  const seg = tempo.segments[0];
  const q = beatAtSeconds(tempo, t);
  const perBar = (seg?.beatsPerBar ?? 4) * (4 / (seg?.beatUnit ?? 4));
  return secondsAtBeat(tempo, q + perBar) - secondsAtBeat(tempo, q);
}

/** The bar line nearest `t` (the time itself without a tempo map, on a 0.25 s grid). */
export function nearestBar(tempo: ShowTempoMap | null, t: number): number {
  if (!tempo) return Math.max(0, Math.round(t * 4) / 4);
  const seg = tempo.segments[0];
  const perBar = (seg?.beatsPerBar ?? 4) * (4 / (seg?.beatUnit ?? 4));
  const q = beatAtSeconds(tempo, t);
  const snapped = Math.round(q / perBar) * perBar;
  return Math.max(0, Math.round(secondsAtBeat(tempo, snapped) * 1e6) / 1e6);
}

/** The next bar line strictly after `t` (or `t` + 2 s without a map). */
export function nextBarAfter(tempo: ShowTempoMap | null, t: number): number {
  if (!tempo) return t + 2;
  const seg = tempo.segments[0];
  const perBar = (seg?.beatsPerBar ?? 4) * (4 / (seg?.beatUnit ?? 4));
  const q = beatAtSeconds(tempo, t);
  const next = (Math.floor(q / perBar + 1e-6) + 1) * perBar;
  return secondsAtBeat(tempo, next);
}

/** A new section on [start, end), its name and colour picked from what is there. */
export function makeSection(existing: readonly TimelineSection[], start: number, end: number, patch: Partial<TimelineSection> = {}): TimelineSection {
  const n = existing.length;
  return {
    id: generateUUID(),
    name: `Section ${n + 1}`,
    color: SECTION_COLORS[n % SECTION_COLORS.length],
    start,
    end,
    action: 'through',
    ...patch,
  };
}

/**
 * Where a new section goes when added at `t`: from the bar at (or before)
 * `t` to the next section's start or `bars` bars on, whichever comes first.
 * Null when `t` is inside a section already.
 */
export function placeNewSection(sections: readonly TimelineSection[], tempo: ShowTempoMap | null, t: number, bars = 8): { start: number; end: number } | null {
  if (sectionAt(sections, t)) return null;
  let start = nearestBar(tempo, t);
  if (start > t + 1e-6) start = Math.max(0, start - barSecondsAt(tempo, Math.max(0, start - 0.01)));
  const prev = [...sections].reverse().find((s) => s.end <= t + 1e-9);
  if (prev && start < prev.end) start = prev.end;
  let end = start;
  for (let i = 0; i < bars; i++) end = nextBarAfter(tempo, end + 1e-6);
  const next = sections.find((s) => s.start >= start + 1e-9);
  if (next && end > next.start) end = next.start;
  if (end - start < SECTION_MIN_SECONDS) return null;
  return { start, end };
}

export const SECTION_ACTION_LABELS: Record<SectionAction, string> = {
  through: 'Play through',
  hold: 'Hold for GO',
  vamp: 'Loop until GO',
  jump: 'Jump',
  live: 'Live (VJ decks)',
};

export const SECTION_ACTION_GLYPHS: Record<SectionAction, string> = {
  through: '▸',
  hold: '⏸',
  vamp: '⟲',
  jump: '↷',
  live: '◉',
};
