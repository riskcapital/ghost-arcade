/**
 * The show's layer tracks at the current instant, as the scene builder reads
 * them. The show store publishes into this through its track-frame sink
 * (wired in show/tracks/showTrackRuntime.ts) only when something the scene
 * needs has changed, so a settled show costs nothing per frame.
 *
 * `showClipSources` is the one cache of clip media sources and their native
 * playback anchors; Canvas, the phase follower and the preloader share it.
 */
import { writable } from 'svelte/store';
import type { ShowTrackFrame } from '../show/tracks/showTrackEval';
import { ShowClipSources } from '../show/tracks/showClipSources';

export const showTrackFrame = writable<ShowTrackFrame | null>(null);

export const showClipSources = new ShowClipSources();
