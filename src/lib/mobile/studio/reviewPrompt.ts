// When to show the system "Rate this app" prompt: after something went well (a recording saved or
// shared, a map made), never in the first session on a device, and at most once per app version.
// iOS adds its own limit (three times a year) and may still decide not to show it.
import { STORAGE_KEY } from './model';

export const REVIEW_KEY = 'ga-mobile-review-v1';

export type ReviewState = {
  /** App starts counted on this device. The first one is never asked. */
  launches: number;
  /** The app version that was last asked, or null. */
  askedVersion: string | null;
};
export type SuccessMoment = 'recording-saved' | 'recording-shared' | 'map-saved';

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | undefined => (globalThis as { localStorage?: Store }).localStorage;

export function normalizeReviewState(raw: unknown): ReviewState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<ReviewState>;
  return {
    launches: Number.isInteger(r.launches) && r.launches! > 0 ? Math.min(r.launches!, 1_000_000) : 0,
    askedVersion: typeof r.askedVersion === 'string' && r.askedVersion ? r.askedVersion : null,
  };
}

export function loadReviewState(storage: Store | undefined = store()): ReviewState {
  try {
    const saved = storage?.getItem(REVIEW_KEY);
    if (saved) return normalizeReviewState(JSON.parse(saved));
    // A device that already holds a set was used before this version: its first start is behind it.
    return { launches: storage?.getItem(STORAGE_KEY) ? 1 : 0, askedVersion: null };
  } catch {
    return { launches: 0, askedVersion: null };
  }
}

export function saveReviewState(state: ReviewState, storage: Store | undefined = store()): void {
  try { storage?.setItem(REVIEW_KEY, JSON.stringify(normalizeReviewState(state))); } catch { /* only costs the prompt */ }
}

/** Counts one app start. Call once when the studio opens. */
export const noteLaunch = (state: ReviewState): ReviewState => ({ ...state, launches: state.launches + 1 });

/** True when a success moment in this session may show the prompt. */
export function mayAskForReview(state: ReviewState, version: string): boolean {
  return !!version && state.launches >= 2 && state.askedVersion !== version;
}

export const markAsked = (state: ReviewState, version: string): ReviewState => ({ ...state, askedVersion: version });

/**
 * Says "a map was made" once: the person leaves Map with mapping on after moving a surface there.
 * Feed it the tab, the mapping switch and the surfaces on every change.
 */
export class MapSaveWatch {
  private entered: string | null = null;
  update(tab: string, mapping: boolean, surfaces: ReadonlyArray<{ points: ReadonlyArray<{ x: number; y: number }> }>): boolean {
    if (tab === 'map') {
      this.entered ??= MapSaveWatch.shape(surfaces);
      return false;
    }
    if (this.entered === null) return false;
    const changed = this.entered !== MapSaveWatch.shape(surfaces);
    this.entered = null;
    return mapping && surfaces.length > 0 && changed;
  }
  private static shape(surfaces: ReadonlyArray<{ points: ReadonlyArray<{ x: number; y: number }> }>): string {
    return surfaces.map((s) => s.points.map((p) => `${p.x.toFixed(4)},${p.y.toFixed(4)}`).join(' ')).join('|');
  }
}

let asking = false;
/**
 * After a success moment: shows the system prompt if this session may ask, and remembers that this
 * version asked. Resolves true when the prompt was requested.
 */
export async function reviewAfterSuccess(_moment: SuccessMoment, deps: { version: () => Promise<string>; request: () => Promise<boolean>; storage?: Store }): Promise<boolean> {
  if (asking) return false;
  asking = true;
  try {
    const version = await deps.version();
    const state = loadReviewState(deps.storage ?? store());
    if (!mayAskForReview(state, version)) return false;
    // Remembered before asking: a prompt iOS chose not to show still uses up this version.
    saveReviewState(markAsked(state, version), deps.storage ?? store());
    await deps.request();
    return true;
  } finally {
    asking = false;
  }
}
