import { writable } from 'svelte/store';

/** UI-only mask pen session. Mask rendering remains controlled by MaskConfig.enabled. */
export const maskEditingLayerId = writable<string | null>(null);
