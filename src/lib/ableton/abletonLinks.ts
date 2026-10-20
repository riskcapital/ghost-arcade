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

export interface LiveClip { name: string; color: number }
export interface LiveTrack {
  name: string;
  color: number;
  slots: (LiveClip | null)[];
  /** Slot index playing, or -1. */
  playing: number;
  /** Slot index queued to launch, or -1. */
  fired: number;
}
export interface LiveScene { name: string; color: number; queued: boolean }

export type AbletonSource =
  | { kind: 'scene'; scene: number; name: string }
  | { kind: 'clip'; track: number; slot: number; trackName: string; name: string };

export type VisualAction =
  | { kind: 'column'; deck: VJDeck; column: number }
  | { kind: 'clip'; deck: VJDeck; layer: number; column: number }
  /** Snapshot slot, 0-based. */
  | { kind: 'snapshot'; slot: number };

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
const ANY_POSITION: PositionFallback = { scenes: true, tracks: true };

/** Position fallback is safe only where the count didn't change. */
export function positionFallback(
  before: { scenes: number; tracks: number } | null,
  after: { scenes: number; tracks: number },
): PositionFallback {
  if (!before) return ANY_POSITION;
  return { scenes: before.scenes === after.scenes, tracks: before.tracks === after.tracks };
}

/** Re-point a link's source at the current set. Null when it no longer
 *  matches anything (its scene, track or clip is gone). */
export function resolveSource(
  source: AbletonSource,
  scenes: LiveScene[],
  tracks: LiveTrack[],
  fallback: PositionFallback = ANY_POSITION,
): AbletonSource | null {
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
 *  nothing (their scene, track or clip is gone). Those keep their last known
 *  place so they come back if the clip does, but must not fire meanwhile. */
export function relink(
  links: AbletonLink[],
  scenes: LiveScene[],
  tracks: LiveTrack[],
  fallback: PositionFallback = ANY_POSITION,
): { links: AbletonLink[]; missing: string[] } {
  const missing: string[] = [];
  const next = links.map(link => {
    const source = resolveSource(link.source, scenes, tracks, fallback);
    if (!source) {
      missing.push(link.id);
      return link;
    }
    return sameSource(source, link.source) ? link : { ...link, source };
  });
  return { links: next, missing };
}

export function sameSource(a: AbletonSource, b: AbletonSource): boolean {
  if (a.kind === 'scene' && b.kind === 'scene') return a.scene === b.scene && a.name === b.name;
  if (a.kind === 'clip' && b.kind === 'clip') {
    return a.track === b.track && a.slot === b.slot && a.trackName === b.trackName && a.name === b.name;
  }
  return false;
}

/** Same place in the set, ignoring names. */
export function samePlace(a: AbletonSource, b: AbletonSource): boolean {
  if (a.kind === 'scene' && b.kind === 'scene') return a.scene === b.scene;
  if (a.kind === 'clip' && b.kind === 'clip') return a.track === b.track && a.slot === b.slot;
  return false;
}

export function linksForScene(links: AbletonLink[], scene: number): AbletonLink[] {
  return links.filter(l => l.source.kind === 'scene' && l.source.scene === scene);
}

export function linksForClip(links: AbletonLink[], track: number, slot: number): AbletonLink[] {
  return links.filter(l => l.source.kind === 'clip' && l.source.track === track && l.source.slot === slot);
}

/** Live's colours arrive as 0xRRGGBB integers. */
export function liveColor(color: number): string {
  return `#${(Math.max(0, color | 0) & 0xffffff).toString(16).padStart(6, '0')}`;
}

/** Live's global launch quantization, by its enum index. */
const QUANTIZE_LABELS = ['None', '8 bars', '4 bars', '2 bars', '1 bar', '1/2', '1/2T', '1/4', '1/4T', '1/8', '1/8T', '1/16', '1/16T', '1/32'];
export function quantizeLabel(index: number): string {
  return QUANTIZE_LABELS[index] ?? '';
}

export function sanitizeLinks(raw: unknown): AbletonLink[] {
  if (!Array.isArray(raw)) return [];
  const int = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : null);
  const deck = (v: unknown): VJDeck => (v === 'B' ? 'B' : 'A');
  const out: AbletonLink[] = [];
  for (const item of raw as any[]) {
    if (!item || typeof item.id !== 'string') continue;
    const s = item.source;
    const a = item.action;
    let source: AbletonSource | null = null;
    if (s?.kind === 'scene' && int(s.scene) !== null) {
      source = { kind: 'scene', scene: s.scene, name: String(s.name ?? '') };
    } else if (s?.kind === 'clip' && int(s.track) !== null && int(s.slot) !== null) {
      source = { kind: 'clip', track: s.track, slot: s.slot, trackName: String(s.trackName ?? ''), name: String(s.name ?? '') };
    }
    let action: VisualAction | null = null;
    if (a?.kind === 'column' && int(a.column) !== null) {
      action = { kind: 'column', deck: deck(a.deck), column: a.column };
    } else if (a?.kind === 'clip' && int(a.layer) !== null && int(a.column) !== null) {
      action = { kind: 'clip', deck: deck(a.deck), layer: a.layer, column: a.column };
    } else if (a?.kind === 'snapshot' && int(a.slot) !== null) {
      action = { kind: 'snapshot', slot: a.slot };
    }
    if (source && action) out.push({ id: item.id, source, action });
  }
  return out;
}
