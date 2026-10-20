/**
 * Ableton bridge links: what in the Live set fires what in Ghost Arcade.
 *
 * A link remembers both the name and the position of its scene or clip.
 * When the set changes, the name wins (so reordering scenes keeps the
 * links), and the position is the fallback while the number of scenes or
 * tracks is unchanged (so renaming one keeps it, but deleting one doesn't
 * hand its links to its neighbour). After every change the link is
 * rewritten to where it now points.
 */

import type { VJDeck } from '../stores/vjClipLauncher';

/** [pitch, start (beats from the loop start), duration (beats), velocity]. */
export type ScoreNote = [number, number, number, number];
export interface LiveClip {
  name: string;
  color: number;
  /** Loop length, beats. */
  length: number;
  /** Notes, for clips on visual score tracks. */
  notes?: ScoreNote[];
}
export interface LiveTrack {
  name: string;
  color: number;
  midi: boolean;
  /** Which side of Live's crossfader the track is on. */
  side: 'A' | 'B' | null;
  slots: (LiveClip | null)[];
  /** Slot index playing, or -1. */
  playing: number;
  /** Slot index queued to launch, or -1. */
  fired: number;
  /** Song position (beats) when the playing clip started. */
  startedBeat: number;
  /** Song position (beats) when the queued clip was fired. */
  firedBeat: number;
}
export interface LiveScene { name: string; color: number; queued: boolean }
/** An arrangement locator. */
export interface LiveCue { name: string; time: number }

export type AbletonSource =
  | { kind: 'scene'; scene: number; name: string }
  | { kind: 'clip'; track: number; slot: number; trackName: string; name: string }
  | { kind: 'locator'; index: number; name: string };

export type VisualAction =
  | { kind: 'column'; deck: VJDeck; column: number }
  | { kind: 'clip'; deck: VJDeck; layer: number; column: number }
  /** Snapshot slot, 0-based. */
  | { kind: 'snapshot'; slot: number }
  /** A Stage preset, by id; `name` finds it again if it was re-saved. */
  | { kind: 'stage'; presetId: string; scope: 'project' | 'global'; name: string }
  /** Any Ghost Arcade control: set to `value`, then back to `release`
   *  (when the note ends, or straight after a launch). */
  | { kind: 'control'; path: string; label: string; value: number; release: number };

export interface AbletonLink {
  id: string;
  source: AbletonSource;
  action: VisualAction;
}

/** Index of the item named `name`, preferring `index` among duplicates.
 *  When nothing has that name, `index` itself if `byPosition` allows it and
 *  it's in range, otherwise -1. */
export function matchByName(names: string[], name: string, index: number, byPosition = true): number {
  if (name) {
    if (names[index] === name) return index;
    const found = names.indexOf(name);
    if (found >= 0) return found;
    if (!byPosition) return -1;
  }
  return index >= 0 && index < names.length ? index : -1;
}

/** Which lists may fall back to matching by position. */
export interface PositionFallback { scenes: boolean; tracks: boolean }
export const ANY_POSITION: PositionFallback = { scenes: true, tracks: true };

/** Position fallback is safe only where the count didn't change. */
export function positionFallback(
  before: { scenes: number; tracks: number } | null,
  after: { scenes: number; tracks: number },
): PositionFallback {
  if (!before) return ANY_POSITION;
  return { scenes: before.scenes === after.scenes, tracks: before.tracks === after.tracks };
}

/** Re-point a link's source at the current set. Null when it no longer
 *  matches anything (its scene, track, clip or locator is gone). */
export function resolveSource(
  source: AbletonSource,
  scenes: LiveScene[],
  tracks: LiveTrack[],
  fallback: PositionFallback = ANY_POSITION,
  cues: LiveCue[] = [],
): AbletonSource | null {
  if (source.kind === 'locator') {
    // A named locator is matched by name only: its order is its time.
    const index = matchByName(cues.map(c => c.name), source.name, source.index, false);
    return index < 0 ? null : { kind: 'locator', index, name: cues[index].name };
  }
  if (source.kind === 'scene') {
    const scene = matchByName(scenes.map(s => s.name), source.name, source.scene, fallback.scenes);
    return scene < 0 ? null : { kind: 'scene', scene, name: scenes[scene].name };
  }
  const track = matchByName(tracks.map(t => t.name), source.trackName, source.track, fallback.tracks);
  if (track < 0) return null;
  // A track has one slot per scene, so slots follow the scene count.
  const slots = tracks[track].slots;
  const slot = matchByName(slots.map(c => c?.name ?? ''), source.name, source.slot, fallback.scenes);
  if (slot < 0 || !slots[slot]) return null;
  return { kind: 'clip', track, slot, trackName: tracks[track].name, name: slots[slot]!.name };
}

/** Links re-pointed at the current set, plus the ids of links that match
 *  nothing. Those keep their last known place so they come back if the clip
 *  does, but must not fire meanwhile. */
export function relink(
  links: AbletonLink[],
  scenes: LiveScene[],
  tracks: LiveTrack[],
  fallback: PositionFallback = ANY_POSITION,
  cues: LiveCue[] = [],
): { links: AbletonLink[]; missing: string[] } {
  const missing: string[] = [];
  const next = links.map(link => {
    const source = resolveSource(link.source, scenes, tracks, fallback, cues);
    if (!source) {
      missing.push(link.id);
      return link;
    }
    return sameSource(source, link.source) ? link : { ...link, source };
  });
  return { links: next, missing };
}

export function sameSource(a: AbletonSource, b: AbletonSource): boolean {
  return samePlace(a, b) && sourceName(a) === sourceName(b)
    && (a.kind !== 'clip' || b.kind !== 'clip' || a.trackName === b.trackName);
}

function sourceName(source: AbletonSource): string {
  return source.name;
}

/** Same place in the set, ignoring names. */
export function samePlace(a: AbletonSource, b: AbletonSource): boolean {
  if (a.kind === 'scene' && b.kind === 'scene') return a.scene === b.scene;
  if (a.kind === 'clip' && b.kind === 'clip') return a.track === b.track && a.slot === b.slot;
  if (a.kind === 'locator' && b.kind === 'locator') return a.index === b.index;
  return false;
}

export function linksForScene(links: AbletonLink[], scene: number): AbletonLink[] {
  return links.filter(l => l.source.kind === 'scene' && l.source.scene === scene);
}

export function linksForClip(links: AbletonLink[], track: number, slot: number): AbletonLink[] {
  return links.filter(l => l.source.kind === 'clip' && l.source.track === track && l.source.slot === slot);
}

export function linksForLocator(links: AbletonLink[], index: number): AbletonLink[] {
  return links.filter(l => l.source.kind === 'locator' && l.source.index === index);
}

/** Live's colours arrive as 0xRRGGBB integers. */
export function liveColor(color: number): string {
  return `#${(Math.max(0, color | 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Beats in one step of Live's launch quantization (0 for None). */
export function quantizeBeats(index: number, numerator: number, denominator: number): number {
  const bar = numerator * (4 / denominator);
  const steps = [0, 8 * bar, 4 * bar, 2 * bar, bar, 2, 4 / 3, 1, 2 / 3, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];
  return steps[index] ?? 0;
}

/** Song position where something fired at `firedBeat` will launch. */
export function launchBeat(firedBeat: number, step: number): number {
  if (step <= 0) return firedBeat;
  return Math.ceil(firedBeat / step - 1e-6) * step;
}

/** "Bar.beat" for a song position, 1-based like Live's display. */
export function barBeat(beat: number, numerator: number, denominator: number): string {
  const perBar = numerator * (4 / denominator);
  const position = Math.max(0, beat);
  const bar = Math.floor(position / perBar) + 1;
  const inBar = Math.floor((position % perBar) / (4 / denominator)) + 1;
  return `${bar}.${inBar}`;
}

/** Live's global launch quantization, by its enum index. */
const QUANTIZE_LABELS = ['None', '8 bars', '4 bars', '2 bars', '1 bar', '1/2', '1/2T', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
export function quantizeLabel(index: number): string {
  return QUANTIZE_LABELS[index] ?? '';
}

const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);
const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

export function sanitizeAction(a: any): VisualAction | null {
  const deck = (v: unknown): VJDeck => (v === 'B' ? 'B' : 'A');
  if (a?.kind === 'column' && int(a.column) !== null) return { kind: 'column', deck: deck(a.deck), column: a.column };
  if (a?.kind === 'clip' && int(a.layer) !== null && int(a.column) !== null) {
    return { kind: 'clip', deck: deck(a.deck), layer: a.layer, column: a.column };
  }
  if (a?.kind === 'snapshot' && int(a.slot) !== null) return { kind: 'snapshot', slot: a.slot };
  if (a?.kind === 'stage' && typeof a.presetId === 'string' && a.presetId) {
    return { kind: 'stage', presetId: a.presetId, scope: a.scope === 'global' ? 'global' : 'project', name: String(a.name ?? '') };
  }
  if (a?.kind === 'control' && typeof a.path === 'string' && a.path) {
    return { kind: 'control', path: a.path, label: String(a.label ?? a.path), value: num(a.value, 1), release: num(a.release, 0) };
  }
  return null;
}

export function sanitizeLinks(raw: unknown): AbletonLink[] {
  if (!Array.isArray(raw)) return [];
  const out: AbletonLink[] = [];
  for (const item of raw as any[]) {
    if (!item || typeof item.id !== 'string') continue;
    const s = item.source;
    let source: AbletonSource | null = null;
    if (s?.kind === 'scene' && int(s.scene) !== null) {
      source = { kind: 'scene', scene: s.scene, name: String(s.name ?? '') };
    } else if (s?.kind === 'clip' && int(s.track) !== null && int(s.slot) !== null) {
      source = { kind: 'clip', track: s.track, slot: s.slot, trackName: String(s.trackName ?? ''), name: String(s.name ?? '') };
    } else if (s?.kind === 'locator' && int(s.index) !== null) {
      source = { kind: 'locator', index: s.index, name: String(s.name ?? '') };
    }
    const action = sanitizeAction(item.action);
    if (source && action) out.push({ id: item.id, source, action });
  }
  return out;
}
