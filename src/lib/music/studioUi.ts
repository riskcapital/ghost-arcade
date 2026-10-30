/** Studio view panel state that is not part of the project. */

import { writable } from 'svelte/store';

/** The macro whose effects are open for editing, or null. */
export const macroEditorId = writable<string | null>(null);

/** The session clip open in the clip editor, or null. */
export const clipEditorId = writable<string | null>(null);
