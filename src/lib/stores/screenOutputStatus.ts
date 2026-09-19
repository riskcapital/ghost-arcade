import { writable } from 'svelte/store';

/** Last rejected screen configuration; the native core keeps the previous outputs. */
export const screenOutputError = writable<string | null>(null);
