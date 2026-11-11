/**
 * The pure side of Music Studio cells (studioCells.ts): which cell plays,
 * what a cell is called, and the setup it keeps.
 */

import type { MusicStudioState } from './musicStudioStore';
import type { SongSetup } from './songs';
import { normalizeBeat, type Beat } from './drumMachine/machineBeat';
import { DEFAULT_MACHINE_KIT } from './drumMachine/machineKits';
import { STUDIO_SETS, keyLabel } from './studioSets';
import { isStudioSource } from './studioPlugin';

type VJDeck = 'A' | 'B';
interface ClipLike {
  id: string;
  type?: string;
  effectSource?: unknown;
}

export const DEFAULT_STUDIO_CELL_NAME = 'Music Studio';

/** What a studio cell keeps. */
export interface StudioCellSetup {
  setup: SongSetup;
  machine: Beat;
  /** A typed or tapped tempo, or null to leave the tempo as it is. */
  bpm: number | null;
  /** The name the cell was given automatically; while the cell still has it, it follows the setup. */
  label: string;
}

export interface PlayingCell {
  deck: VJDeck;
  layer: number;
  clipId: string;
}

interface DeckState {
  layerStates: ReadonlyArray<{ activeClip: ClipLike | null }>;
  bankBLayerStates?: ReadonlyArray<{ activeClip: ClipLike | null }>;
}

/** Every studio cell playing now, deck A first. */
export function playingStudioCells(state: DeckState): PlayingCell[] {
  const out: PlayingCell[] = [];
  const scan = (deck: VJDeck, states: DeckState['layerStates'] | undefined) =>
    (states ?? []).forEach((s, layer) => {
      const c = s.activeClip;
      if (c && c.type === 'effect' && isStudioSource(c.effectSource)) out.push({ deck, layer, clipId: c.id });
    });
  scan('A', state.layerStates);
  scan('B', state.bankBLayerStates);
  return out;
}

/**
 * Which studio cell plays when several are up: the one just launched (not
 * playing before) wins; the others stop. With none new, the one already
 * playing stays.
 */
export function pickStudioCell(playing: PlayingCell[], current: string | null): { keep: PlayingCell | null; stop: PlayingCell[] } {
  if (!playing.length) return { keep: null, stop: [] };
  const fresh = playing.filter((p) => p.clipId !== current);
  const keep = fresh.length ? fresh[fresh.length - 1] : playing.find((p) => p.clipId === current) ?? playing[0];
  return { keep, stop: playing.filter((p) => p !== keep) };
}

/** A cell's name from its setup: its scene's name, else its set and key. */
export function studioCellLabel(s: Pick<MusicStudioState, 'set' | 'key' | 'scenes' | 'sceneId'>): string {
  const scene = s.sceneId ? s.scenes.find((x) => x.id === s.sceneId) : undefined;
  if (scene?.name) return scene.name;
  const set = STUDIO_SETS.find((x) => x.id === s.set)?.label ?? 'Studio';
  return `${set} · ${keyLabel(s.key)}`;
}

/** The setup a cell keeps, read back from a saved project; null when it has none. */
export function cellSetupOf(source: unknown): StudioCellSetup | null {
  const raw = (source as { musicSetup?: unknown } | null)?.musicSetup;
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StudioCellSetup>;
  if (!r.setup || typeof r.setup !== 'object') return null;
  return {
    setup: r.setup as SongSetup,
    machine: normalizeBeat(r.machine, DEFAULT_MACHINE_KIT),
    bpm: Number.isFinite(Number(r.bpm)) && Number(r.bpm) > 0 ? Number(r.bpm) : null,
    label: typeof r.label === 'string' ? r.label : '',
  };
}

