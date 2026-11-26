import { writable } from 'svelte/store';

/** Last rejected screen configuration; the native core keeps the previous outputs. */
export const screenOutputError = writable<string | null>(null);

/** The render core publishes the Syphon / Spout senders of sender Screens
 *  itself (main reports it when the Screen senders start): the native sync
 *  then sends those Screens to the core with their sender names. */
export const coreSliceSendersActive = writable(false);

/** Alignment aids the render core draws on a Screen's own output instead of
 *  its picture: 'grid' is the numbered composition grid, 'identify' the
 *  Screen's number. Session-only on purpose, so a saved project or an undo
 *  can never bring a test pattern back during a show. */
export type ScreenAlignmentAid = 'grid' | 'identify';
export const screenAlignmentAids = writable<Record<string, ScreenAlignmentAid>>({});
/** Screens whose grid is switched on, whether or not an identify flash is
 *  covering it right now: what a Show / Hide button should reflect. */
export const screenAlignmentGridIds = writable<string[]>([]);

/** Screens whose grid is on, including one hidden behind an identify flash. */
const gridScreens = new Set<string>();
const identifyTimers = new Map<string, ReturnType<typeof setTimeout>>();

function publishAlignmentAids() {
  const next: Record<string, ScreenAlignmentAid> = {};
  for (const id of gridScreens) next[id] = 'grid';
  for (const id of identifyTimers.keys()) next[id] = 'identify';
  screenAlignmentAids.set(next);
  screenAlignmentGridIds.set([...gridScreens]);
}

export function setScreenAlignmentGrid(screenIds: string[], on: boolean) {
  for (const id of screenIds) {
    if (on) gridScreens.add(id);
    else gridScreens.delete(id);
  }
  publishAlignmentAids();
}

/** Flash a Screen's number on its projector, then return to what it showed. */
export function identifyScreen(screenId: string, durationMs = 4000) {
  const pending = identifyTimers.get(screenId);
  if (pending) clearTimeout(pending);
  identifyTimers.set(screenId, setTimeout(() => {
    identifyTimers.delete(screenId);
    publishAlignmentAids();
  }, durationMs));
  publishAlignmentAids();
}

/** Drop every aid, e.g. when the Screens they belonged to are gone. */
export function clearScreenAlignmentAids() {
  for (const timer of identifyTimers.values()) clearTimeout(timer);
  identifyTimers.clear();
  gridScreens.clear();
  publishAlignmentAids();
}

/** Auto-map stripe frames the core draws on a Screen instead of its picture
 *  while a phone photographs them (see structuredLightCodes.ts for the
 *  frame numbers). Session-only, like the aids above, and it wins over them. */
export const screenPatternFrames = writable<Record<string, number>>({});
let patternWatchdog: ReturnType<typeof setTimeout> | undefined;

/** Show `frame` on one Screen and black on the others, or clear with null.
 *  A capture that stops talking is cleared after 15 s so a dropped phone
 *  never leaves stripes on a projector. */
export function setScreenPatternFrames(frames: Record<string, number> | null) {
  clearTimeout(patternWatchdog);
  screenPatternFrames.set(frames ? { ...frames } : {});
  if (frames) patternWatchdog = setTimeout(() => screenPatternFrames.set({}), 15000);
}

/** Where a Screen's picture sits in the output (0..1), from its crop. */
export type ScreenRegion = { x: number; y: number; width: number; height: number };
export type OpenScreenOutput = { id: string; name: string; width: number; height: number; region: ScreenRegion };

/** The part of the output a Screen shows (its crop, kept inside the output). The whole output when the crop is unusable. */
export function screenRegion(slice: { cropX?: unknown; cropY?: unknown; cropW?: unknown; cropH?: unknown } | null | undefined): ScreenRegion {
  const n = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const x = Math.min(1, Math.max(0, n(slice?.cropX, 0))), y = Math.min(1, Math.max(0, n(slice?.cropY, 0)));
  const width = Math.min(1 - x, n(slice?.cropW, 1)), height = Math.min(1 - y, n(slice?.cropH, 1));
  return width > 1e-3 && height > 1e-3 ? { x, y, width, height } : { x: 0, y: 0, width: 1, height: 1 };
}

/** Screens with an output window open, at the pixel size the core renders
 *  them, and the part of the output each shows (a paired phone maps its
 *  stripes through it). Kept current by the renderer sync; an auto-map
 *  capture reads it. */
export const openScreenOutputList = writable<OpenScreenOutput[]>([]);

/** The id a phone uses for the main output when no Screen is open (single projector, no Screens tab). */
export const MAIN_OUTPUT_ID = 'main';
/** The main output's raster while its native window is open, in device pixels; null when closed. */
export const mainOutputRaster = writable<{ width: number; height: number } | null>(null);

/**
 * What a phone's auto map can light: the open Screens, or with none open,
 * the main output itself, so one projector needs no Screens setup.
 */
export function autoMapTargets(screens: OpenScreenOutput[], main: { width: number; height: number } | null, mainOpen: boolean): OpenScreenOutput[] {
  if (screens.length || !mainOpen || !main) return screens;
  const width = Math.round(main.width), height = Math.round(main.height);
  if (!(width >= 2 && height >= 2)) return screens;
  return [{ id: MAIN_OUTPUT_ID, name: 'Main output', width, height, region: { x: 0, y: 0, width: 1, height: 1 } }];
}
