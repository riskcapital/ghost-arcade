/**
 * An instrument's own sound, effects and visual, chosen in its module's
 * header (InstrumentDress.svelte): a tone-library tone to play it with (or
 * its built-in sound), what a pad's Y axis does, and a visual voice that
 * follows it. Its effects are its channel's insert chain. Saved with the
 * set, scenes, sessions and songs.
 */

import type { InstrumentId } from './noteEvents';
import { normalizeClipVisual, type ClipVisual } from './session';

/** What a pad's Y axis does. "space" is the instrument's own (the XY opens the room). */
export type YAxis = 'space' | 'bright' | 'reverb' | 'echo' | 'pan';

export const Y_AXES: { id: YAxis; label: string }[] = [
  { id: 'space', label: 'Space (as built)' },
  { id: 'bright', label: 'Brightness' },
  { id: 'reverb', label: 'Reverb send' },
  { id: 'echo', label: 'Echo send' },
  { id: 'pan', label: 'Pan' },
];

export interface InstrumentDress {
  /** A tone-library tone, or none for the instrument's own sound. */
  tone?: string;
  yAxis?: YAxis;
  visual?: ClipVisual;
}

export type DressMap = Partial<Record<InstrumentId, InstrumentDress>>;

export function normalizeDress(raw: unknown): DressMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: DressMap = {};
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const v = value as Record<string, unknown>;
    const d: InstrumentDress = {};
    if (typeof v.tone === 'string' && v.tone) d.tone = v.tone;
    if (Y_AXES.some((a) => a.id === v.yAxis)) d.yAxis = v.yAxis as YAxis;
    const visual = normalizeClipVisual(v.visual);
    if (visual) d.visual = visual;
    if (Object.keys(d).length) out[id as InstrumentId] = d;
  }
  return out;
}

/** The mixer modulation a Y axis sets (a key for the runtime's live mods), or null when it acts on the note. */
export function yAxisTarget(instrument: InstrumentId, axis: YAxis): string | null {
  if (axis === 'reverb' || axis === 'echo') return `dest:mix.${instrument}.send.${axis}`;
  if (axis === 'pan') return `dest:mix.${instrument}.pan`;
  return null;
}
