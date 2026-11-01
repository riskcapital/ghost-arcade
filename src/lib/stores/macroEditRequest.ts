/**
 * Open the macro editor (the same one as VJ mode's macro bar) from somewhere
 * else, such as the Studio's macro knobs. The editor instance mounted there
 * picks the request up and opens at the given point.
 */

import { writable } from 'svelte/store';

export const macroEditRequest = writable<{ id: string; x: number; y: number } | null>(null);
