import { writable } from 'svelte/store';

/** Shared Mapping/VJ stage editor. Live output keeps running in either mode. */
export const vjStageEdit = writable(false);
