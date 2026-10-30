/**
 * The shipped note-reactive shaders, and putting one on the VJ deck.
 */

import { get } from 'svelte/store';
import { vjClipLauncher, type VJDeck } from '../stores/vjClipLauncher';
import { showToast } from '../stores/errorToast';
import { generateUUID } from '../utils/uuid';
import type { StudioSet } from './studioSets';

/** Black and white glitch visuals for the Berlin set. */
export const GLITCH_SHADERS = [
  { file: 'BG-SlitScan.fs', name: 'Slit-scan' },
  { file: 'BG-Threshold.fs', name: 'Threshold' },
  { file: 'BG-Grain.fs', name: 'Grain 35mm' },
  { file: 'BG-Scanlines.fs', name: 'Scanlines' },
  { file: 'BG-KickStrobe.fs', name: 'Kick strobe' },
  { file: 'BG-Datamosh.fs', name: 'Datamosh' },
] as const;

export const NOTE_SHADERS = [
  { file: 'NR-NoteBloom.fs', name: 'Note Bloom' },
  { file: 'NR-ChordRings.fs', name: 'Chord Rings' },
  { file: 'NR-NoteInk.fs', name: 'Note Ink' },
  { file: 'NR-BeatGrid.fs', name: 'Beat Grid' },
] as const;

/** Echo, smoke and speaker visuals for the dub set. */
export const DUB_SHADERS = [
  { file: 'DB-EchoTrails.fs', name: 'Echo Trails' },
  { file: 'DB-Smoke.fs', name: 'Dub Smoke' },
  { file: 'DB-Ripples.fs', name: 'Ripples' },
  { file: 'DB-Speaker.fs', name: 'Speaker' },
] as const;

export interface ShippedShader {
  file: string;
  name: string;
}

/** The visuals each set offers its layers first. */
export const SET_VISUALS: Record<StudioSet, readonly ShippedShader[]> = {
  bath: NOTE_SHADERS,
  berlin: GLITCH_SHADERS,
  dub: DUB_SHADERS,
  analog: [...NOTE_SHADERS, ...GLITCH_SHADERS],
};

async function loadShader(file: string): Promise<string> {
  const response = await fetch(`./ISF/${encodeURIComponent(file)}`);
  if (!response.ok) throw new Error(String(response.status));
  return response.text();
}

/**
 * Play a shipped shader on one deck A layer. A layer that already holds it
 * relaunches that clip; otherwise it goes into the row's first free slot (or
 * the last slot when the row is full).
 */
export async function setLayerVisual(layer: number, file: string, name: string): Promise<void> {
  const launcher = get(vjClipLauncher);
  const row = launcher.clipGrid[layer];
  if (!row) return;
  const existing = row.findIndex((c) => c?.src === `ISF/${file}`);
  if (existing >= 0) {
    vjClipLauncher.triggerClipNow(layer, existing, 'A');
    return;
  }
  const free = row.findIndex((c) => !c);
  const column = free >= 0 ? free : row.length - 1;
  try {
    const shaderCode = await loadShader(file);
    vjClipLauncher.setClip(layer, column, { id: generateUUID(), type: 'shader', name, src: `ISF/${file}`, shaderCode, shaderValues: {} }, 'A');
    vjClipLauncher.triggerClipNow(layer, column, 'A');
  } catch (err) {
    console.warn('[Music] could not load', file, err);
    showToast(`Could not load ${name}.`, 'error');
  }
}

/** Put a note shader in the next free slot of the selected layer and play it. */
export async function addNoteShaderToDeck(file: string, name: string): Promise<void> {
  const launcher = get(vjClipLauncher);
  const deck: VJDeck = launcher.crossfaderEnabled ? launcher.selectedDeck : 'A';
  const grid = deck === 'B' ? launcher.bankBClipGrid : launcher.clipGrid;
  const first = launcher.selectedLayerIndex ?? 0;
  const order = [first, ...grid.map((_, i) => i).filter((i) => i !== first)];
  let target: { layer: number; column: number } | null = null;
  for (const layer of order) {
    const column = grid[layer]?.findIndex((c) => !c) ?? -1;
    if (column >= 0) {
      target = { layer, column };
      break;
    }
  }
  if (!target) {
    showToast('No empty VJ deck slot available.', 'warning');
    return;
  }
  try {
    const shaderCode = await loadShader(file);
    vjClipLauncher.setClip(target.layer, target.column, {
      id: generateUUID(),
      type: 'shader',
      name,
      src: `ISF/${file}`,
      shaderCode,
      shaderValues: {},
    }, deck);
    vjClipLauncher.triggerClipNow(target.layer, target.column, deck);
  } catch (err) {
    console.warn('[Music] could not load', file, err);
    showToast(`Could not load ${name}.`, 'error');
  }
}
