import { writable } from 'svelte/store';

/** Global FPS counter — updated every 500ms from the Canvas render loop */
export const fpsStore = writable(0);
