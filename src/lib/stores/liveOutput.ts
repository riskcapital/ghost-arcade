/**
 * Live output (the projector picture), shared by the places that can send it:
 * the mapping toolbar and the VJ header. App owns the output window and keeps
 * `liveOutput` current; the controls here only ask App to act, so all of them
 * stay in step whichever one was used.
 */
import { writable } from 'svelte/store';

export type LiveOutputMode = 'embedded' | 'window' | 'fullscreen';

/** `fullscreen`: fullscreen on the projector / external display.
 *  `window`: a floating output window. `embedded`: not sent anywhere. */
export const liveOutput = writable<{ mode: LiveOutputMode }>({ mode: 'embedded' });

export const LIVE_OUTPUT_FULLSCREEN_EVENT = 'ga-toggle-output-fullscreen';

/** Send the output fullscreen to the projector, or take it back. */
export function toggleOutputFullscreen(): void {
  window.dispatchEvent(new CustomEvent(LIVE_OUTPUT_FULLSCREEN_EVENT));
}
