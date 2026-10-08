import { writable } from 'svelte/store';

/** Last rejected screen configuration; the native core keeps the previous outputs. */
export const screenOutputError = writable<string | null>(null);

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
