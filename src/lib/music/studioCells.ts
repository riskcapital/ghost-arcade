/**
 * Music Studio cells on the VJ deck: one plays at a time.
 *
 * Each cell keeps its own setup (the sound, the drum machine's beat, the
 * tempo). Launching a cell puts its setup into the studio on the next bar
 * and stops any other studio cell that was playing. The cell that was
 * playing keeps what the studio had when it stopped, so going back to it
 * brings that back. A cell named "Music Studio" (or still carrying the name
 * it was given) is named after its scene or its set and key.
 */

import { get } from 'svelte/store';
import { vjClipLauncher, type VJClip, type VJDeck } from '../stores/vjClipLauncher';
import { nextLaunchBoundary } from '../stores/launchClock';
import { audioStore } from '../stores/audio';
import { runAsLiveControl } from '../stores/historyHooks';
import { musicStudio } from './musicStudioStore';
import { captureSetup } from './songs';
import {
  DEFAULT_STUDIO_CELL_NAME, cellSetupOf, pickStudioCell, playingStudioCells, studioCellLabel,
  type PlayingCell, type StudioCellSetup,
} from './studioCellsCore';

export * from './studioCellsCore';

// ── Running ─────────────────────────────────────────────────────────────

let current: PlayingCell | null = null;
let pending: ReturnType<typeof setTimeout> | null = null;

function findCell(clipId: string): { deck: VJDeck; layer: number; column: number; clip: VJClip } | null {
  const st = get(vjClipLauncher);
  for (const [deck, grid] of [['A', st.clipGrid], ['B', st.bankBClipGrid ?? []]] as const) {
    for (let layer = 0; layer < grid.length; layer++) {
      const column = grid[layer]?.findIndex((c) => c?.id === clipId) ?? -1;
      if (column >= 0) return { deck, layer, column, clip: grid[layer][column]! };
    }
  }
  return null;
}

/** Keep the studio's setup now in a cell (and name it after the setup while it has its automatic name). */
function storeInto(clipId: string): void {
  const cell = findCell(clipId);
  if (!cell) return;
  const s = get(musicStudio);
  const label = studioCellLabel(s);
  const before = cellSetupOf(cell.clip.effectSource);
  const autoNamed = cell.clip.name === DEFAULT_STUDIO_CELL_NAME || (before && cell.clip.name === before.label);
  const musicSetup: StudioCellSetup = {
    setup: JSON.parse(JSON.stringify(captureSetup(s))),
    machine: JSON.parse(JSON.stringify(s.machine)),
    bpm: get(audioStore).manualBPM ?? null,
    label,
  };
  runAsLiveControl(() => {
    vjClipLauncher.setClip(cell.layer, cell.column, {
      ...cell.clip,
      name: autoNamed ? label : cell.clip.name,
      effectSource: { ...(cell.clip.effectSource as object), musicSetup } as unknown as VJClip['effectSource'],
    }, cell.deck);
  });
}

function load(setup: StudioCellSetup): void {
  runAsLiveControl(() => {
    musicStudio.applySetup(setup.setup);
    musicStudio.setMachine(setup.machine);
    if (setup.bpm !== null && get(audioStore).manualBPM !== setup.bpm) audioStore.setManualBPM(setup.bpm);
  });
}

/** Called with the deck's state on every change. */
export function onDeckChange(state: Parameters<typeof playingStudioCells>[0]): void {
  const playing = playingStudioCells(state);
  const { keep, stop } = pickStudioCell(playing, current?.clipId ?? null);
  for (const p of stop) vjClipLauncher.stopLayer(p.layer, p.deck);
  if (keep?.clipId === current?.clipId) return;
  const was = current;
  current = keep;
  if (pending) clearTimeout(pending);
  pending = null;
  // The studio's setup now belongs to the cell that was playing.
  if (was) storeInto(was.clipId);
  if (!keep) return;
  const cell = findCell(keep.clipId);
  const setup = cell ? cellSetupOf(cell.clip.effectSource) : null;
  if (!setup) {
    // A cell with no setup of its own yet takes the studio's as it is.
    storeInto(keep.clipId);
    return;
  }
  // Its setup comes in on the next bar.
  const wait = Math.max(0, nextLaunchBoundary(4) - performance.now());
  const clipId = keep.clipId;
  pending = setTimeout(() => {
    pending = null;
    if (current?.clipId === clipId) load(setup);
  }, wait);
}

let started = false;
export function watchStudioCells(): void {
  if (started) return;
  started = true;
  vjClipLauncher.subscribe(onDeckChange);
}
