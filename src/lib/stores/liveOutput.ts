/**
 * Live output (the projector picture), shared by every place that can send
 * it: the mapping toolbar, the VJ header and Settings → Display. App owns the
 * output window and keeps `liveOutput` current; the controls here only ask
 * App to act, so all of them stay in step whichever one was used.
 */
import { writable } from 'svelte/store';

export type LiveOutputMode = 'embedded' | 'window' | 'fullscreen';

/** `fullscreen`: fullscreen on the projector / external display.
 *  `window`: a floating output window. `embedded`: not sent anywhere. */
export const liveOutput = writable<{ mode: LiveOutputMode }>({ mode: 'embedded' });

export const LIVE_OUTPUT_FULLSCREEN_EVENT = 'ga-toggle-output-fullscreen';
export const LIVE_OUTPUT_WINDOW_EVENT = 'ga-toggle-output-window';
export const LIVE_OUTPUT_DISPLAY_MENU_EVENT = 'ga-output-display-menu';

/** Send the output fullscreen to the projector, or take it back. */
export function toggleOutputFullscreen(): void {
  window.dispatchEvent(new CustomEvent(LIVE_OUTPUT_FULLSCREEN_EVENT));
}

/** Open or close the floating output window. */
export function toggleOutputWindow(): void {
  window.dispatchEvent(new CustomEvent(LIVE_OUTPUT_WINDOW_EVENT));
}

/** Choose which display the output goes to, from a menu at the pointer. */
export function openOutputDisplayMenu(event: MouseEvent): void {
  event.preventDefault();
  window.dispatchEvent(new CustomEvent(LIVE_OUTPUT_DISPLAY_MENU_EVENT, {
    detail: { x: event.clientX, y: event.clientY },
  }));
}
