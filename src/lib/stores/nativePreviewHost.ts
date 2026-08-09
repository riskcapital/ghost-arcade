import { writable } from 'svelte/store';

/**
 * Overrides where the native editor presenter (the AppKit/Metal underlay that
 * shows the render core's output) is positioned on screen.
 *
 * Default (null): the presenter tracks the editor Canvas viewport.
 * When a fullscreen workspace (VJ mode, SynthVision performer) wants the
 * native output inside ITS preview box, it registers that element here and
 * clears it on close. Canvas.svelte measures whichever element is registered
 * every UI frame, so the presenter follows layout changes automatically.
 */
export const nativePreviewHostEl = writable<HTMLElement | null>(null);
