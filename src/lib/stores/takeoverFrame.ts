/**
 * The live takeover at the current instant, as Canvas builds the native scene
 * from it (see show/takeover/takeoverScene.ts). The takeover runtime publishes
 * into it only when something the scene needs has changed; null = nothing is
 * taken over.
 *
 * `takeoverMediaSources` keeps one stable source per engage of dropped media.
 */
import { writable } from 'svelte/store';
import type { TakeoverFrame } from '../show/takeover/liveTakeover';
import { TakeoverMediaSources } from '../show/takeover/takeoverScene';

export const takeoverFrame = writable<TakeoverFrame | null>(null);

export const takeoverMediaSources = new TakeoverMediaSources();
