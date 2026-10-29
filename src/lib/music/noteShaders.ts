/**
 * The shipped note-reactive shaders, and putting one on the VJ deck.
 */

import { get } from 'svelte/store';
import { vjClipLauncher, type VJDeck } from '../stores/vjClipLauncher';
import { showToast } from '../stores/errorToast';
import { generateUUID } from '../utils/uuid';

export const NOTE_SHADERS = [
  { file: 'NR-NoteBloom.fs', name: 'Note Bloom' },
  { file: 'NR-ChordRings.fs', name: 'Chord Rings' },
  { file: 'NR-NoteInk.fs', name: 'Note Ink' },
  { file: 'NR-BeatGrid.fs', name: 'Beat Grid' },
] as const;

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
    const response = await fetch(`./ISF/${encodeURIComponent(file)}`);
    if (!response.ok) throw new Error(String(response.status));
    const shaderCode = await response.text();
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
