/**
 * Layers whose picture could not be loaded, and why.
 *
 * A video or image that failed to load used to leave its layer silently
 * empty, with the reason only in the developer console. Canvas records the
 * reason here; the layer list marks the layer and says what to do, and the
 * user is told once.
 */
import { writable } from 'svelte/store';
import { showToast } from './errorToast';

/** layerId → what went wrong, in words for the user. */
export const mediaLoadErrors = writable<Record<string, string>>({});

const toldAbout = new Set<string>();

/** Mark a layer as failed. Tells the user once per message. */
export function setMediaLoadError(layerId: string, message: string, { notify = true }: { notify?: boolean } = {}): void {
  mediaLoadErrors.update((all) => (all[layerId] === message ? all : { ...all, [layerId]: message }));
  if (notify && !toldAbout.has(message)) {
    toldAbout.add(message);
    showToast(message, 'error');
  }
}

export function clearMediaLoadError(layerId: string): void {
  mediaLoadErrors.update((all) => {
    if (!(layerId in all)) return all;
    const { [layerId]: _gone, ...rest } = all;
    return rest;
  });
}

/** Media was relinked: everything gets another try. */
export function clearAllMediaLoadErrors(): void {
  toldAbout.clear();
  mediaLoadErrors.set({});
}

/** The file name at the end of a URL or path, for messages. */
export function mediaFileName(src: string, fallback = 'This file'): string {
  try {
    const path = decodeURIComponent(String(src).split(/[?#]/)[0]);
    const name = path.split(/[\\/]/).pop();
    if (name && !name.startsWith('blob:')) return name;
  } catch { /* fall through */ }
  return fallback;
}

/**
 * Why a file served by Ghost Arcade's local media protocol did not load,
 * from the protocol's answer (403: not opened through Ghost Arcade, 404:
 * not on disk). Null when the status says nothing more than "it failed".
 */
export function assetStatusMessage(name: string, status: number): string | null {
  if (status === 404) return `${name} is not on disk any more. Find it again with File › Project Media, or replace it on the layer.`;
  if (status === 403) return `Ghost Arcade is not allowed to read ${name}. Drop the file onto the media tray again, or open the project with File › Open.`;
  return null;
}

/** Ask the local media protocol what is wrong with `src`. Null when it cannot tell. */
export async function probeAssetFailure(src: string, name: string): Promise<string | null> {
  if (typeof fetch !== 'function' || !/^ghost-asset:/i.test(src)) return null;
  try {
    const response = await fetch(src, { method: 'HEAD' });
    if (response.ok) return null;
    return assetStatusMessage(name, response.status);
  } catch {
    return null;
  }
}
