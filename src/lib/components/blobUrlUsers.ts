/**
 * Blob URLs made by the model and splat panels, and whether anything still
 * uses one. A panel edits whichever layer or clip is selected, so the URL it
 * replaces can still be shown by another layer, a VJ clip in any block or
 * deck, a media item, a stored composition or stage preset, or an undo step.
 * Revoking it then would break that user on its next load.
 */
import { get } from 'svelte/store';
import { project } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { mediaLibrary } from '../stores/media';
import { history } from '../stores/history';

/** True when `value` holds `url` anywhere in its plain data: a string that
 *  is or contains it (undo steps are JSON), in any nested plain object or
 *  array. Class instances (DOM elements, textures, files) are not entered. */
export function referencesUrl(value: unknown, url: string): boolean {
  if (!url) return false;
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (v.length >= url.length && v.includes(url)) return true;
      continue;
    }
    if (!v || typeof v !== 'object' || seen.has(v)) continue;
    seen.add(v);
    if (Array.isArray(v)) {
      for (const item of v) stack.push(item);
      continue;
    }
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) continue;
    for (const key in v) stack.push((v as Record<string, unknown>)[key]);
  }
  return false;
}

/** Everything that can still hold a model or splat URL: project layers and
 *  what the project stores (compositions, stage presets, VJ data), every VJ
 *  block, deck and playing clip, the media library and the undo steps. */
export function blobUrlUsers(): unknown[] {
  return [get(project), get(vjClipLauncher), get(mediaLibrary), get(history)];
}

/** Revoke `url` if this panel made it (it is in `owned`) and nothing uses it
 *  any more. Returns whether it was revoked; a URL still in use stays owned
 *  so a later release can free it. */
export function releaseBlobUrl<T>(
  owned: Map<string, T>,
  url: string | null | undefined,
  users: unknown[] = blobUrlUsers(),
): boolean {
  if (!url || !owned.has(url)) return false;
  if (users.some((user) => referencesUrl(user, url))) return false;
  owned.delete(url);
  URL.revokeObjectURL(url);
  return true;
}
