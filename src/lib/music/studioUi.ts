/** Studio view panel state that is not part of the project. */

import { writable } from 'svelte/store';

/** The macro whose effects are open for editing, or null. */
export const macroEditorId = writable<string | null>(null);
