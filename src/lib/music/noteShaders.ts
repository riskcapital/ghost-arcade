/**
 * Putting a shipped shader on a VJ deck row.
 */

import { get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { showToast } from '../stores/errorToast';
import { generateUUID } from '../utils/uuid';

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
