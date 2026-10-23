import { writable } from 'svelte/store';

/** Global loading message. When non-null, the LoadingOverlay is shown. */
export const loadingMessage = writable<string | null>(null);
export const loadingProgress = writable<number | null>(null);
export const loadingDetail = writable<string | null>(null);
/** True while the overlay belongs to a file load that can carry on behind
 *  the interface (point clouds, splats, 3D models). */
export const loadingCanBackground = writable(false);

export interface BackgroundLoad {
  message: string;
  progress: number | null;
  detail: string | null;
  /** Other background loads still running besides this one. */
  others?: number;
}
/** A load the user sent to the background: shown as a small chip instead of
 *  the blocking overlay until it finishes. */
export const backgroundLoad = writable<BackgroundLoad | null>(null);

export type LoadingOwner = number;

let nextLoadingOwner = 1;
let activeLoadingOwner: LoadingOwner | null = null;
let activeState: BackgroundLoad = { message: '', progress: null, detail: null };

// Owned loads still running, and the ones the user sent to the background.
const ownedInFlight = new Set<LoadingOwner>();
const backgrounded = new Map<LoadingOwner, BackgroundLoad>();
let chipOwner: LoadingOwner | null = null;

function setLoading(msg: string, progress: number | null, detail: string | null) {
  activeState = { message: msg, progress, detail };
  loadingMessage.set(msg);
  loadingProgress.set(progress);
  loadingDetail.set(detail);
}

function refreshChip() {
  if (chipOwner !== null && !backgrounded.has(chipOwner)) chipOwner = null;
  if (chipOwner === null) {
    const next = backgrounded.keys().next();
    chipOwner = next.done ? null : next.value;
  }
  backgroundLoad.set(chipOwner === null
    ? null
    : { ...backgrounded.get(chipOwner)!, others: backgrounded.size - 1 });
}

export function showLoading(msg: string, progress: number | null = null, detail: string | null = null) {
  activeLoadingOwner = null;
  loadingCanBackground.set(false);
  setLoading(msg, progress, detail);
}

export function updateLoading(msg: string, progress: number | null = null, detail: string | null = null) {
  setLoading(msg, progress, detail);
}

export function hideLoading() {
  activeLoadingOwner = null;
  loadingCanBackground.set(false);
  loadingMessage.set(null);
  loadingProgress.set(null);
  loadingDetail.set(null);
}

export function beginOwnedLoading(
  msg: string,
  progress: number | null = null,
  detail: string | null = null,
): LoadingOwner {
  const owner = nextLoadingOwner++;
  ownedInFlight.add(owner);
  activeLoadingOwner = owner;
  loadingCanBackground.set(true);
  setLoading(msg, progress, detail);
  return owner;
}

export function updateOwnedLoading(
  owner: LoadingOwner,
  msg: string,
  progress: number | null = null,
  detail: string | null = null,
) {
  if (backgrounded.has(owner)) {
    backgrounded.set(owner, { message: msg, progress, detail });
    if (chipOwner === owner) refreshChip();
    return;
  }
  if (activeLoadingOwner !== owner) return;
  setLoading(msg, progress, detail);
}

export function endOwnedLoading(owner: LoadingOwner) {
  ownedInFlight.delete(owner);
  if (backgrounded.delete(owner)) {
    refreshChip();
    return;
  }
  if (activeLoadingOwner !== owner) return;
  hideLoading();
}

/**
 * Close the blocking overlay and let every file load now in flight finish
 * behind the interface. A slow read (a file still downloading from iCloud,
 * a network drive) no longer locks the user out of the project; the layer
 * appears when its data arrives. Loads started later show the overlay again.
 */
export function continueLoadingInBackground() {
  if (activeLoadingOwner === null) return;
  for (const owner of ownedInFlight) {
    if (backgrounded.has(owner)) continue;
    backgrounded.set(owner, owner === activeLoadingOwner
      ? { ...activeState }
      : { message: 'Loading', progress: null, detail: null });
  }
  chipOwner = activeLoadingOwner;
  hideLoading();
  refreshChip();
}
