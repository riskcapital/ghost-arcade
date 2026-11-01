/** Studio view panel state that is not part of the project. */

import { writable } from 'svelte/store';

/** The macro whose effects are open for editing, or null. */
export const macroEditorId = writable<string | null>(null);

/** The session clip open in the clip editor, or null. */
export const clipEditorId = writable<string | null>(null);

/** The channel (an instrument, or "master") whose insert effects are open, or null. */
export const insertEditorChannel = writable<string | null>(null);

/** The loop browser: open on a session slot (a track, and a row or null for its first empty slot), or closed. */
export const loopBrowser = writable<{ track: import('./session').TrackId | null; row: number | null } | null>(null);

const FAVS_KEY = 'ga.studio.loopFavourites';
function loadFavs(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVS_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Starred loops, kept on this computer. */
export const loopFavourites = writable<string[]>(typeof localStorage === 'undefined' ? [] : loadFavs());
loopFavourites.subscribe((ids) => {
  try {
    localStorage.setItem(FAVS_KEY, JSON.stringify(ids));
  } catch {
    // Private windows keep them for the session only.
  }
});
