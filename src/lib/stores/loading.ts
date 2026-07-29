import { writable } from 'svelte/store';

/** Global loading message. When non-null, the LoadingOverlay is shown. */
export const loadingMessage = writable<string | null>(null);
export const loadingProgress = writable<number | null>(null);
export const loadingDetail = writable<string | null>(null);

export type LoadingOwner = number;

let nextLoadingOwner = 1;
let activeLoadingOwner: LoadingOwner | null = null;

function setLoading(msg: string, progress: number | null, detail: string | null) {
  loadingMessage.set(msg);
  loadingProgress.set(progress);
  loadingDetail.set(detail);
}

export function showLoading(msg: string, progress: number | null = null, detail: string | null = null) {
  activeLoadingOwner = null;
  setLoading(msg, progress, detail);
}

export function updateLoading(msg: string, progress: number | null = null, detail: string | null = null) {
  setLoading(msg, progress, detail);
}

export function hideLoading() {
  activeLoadingOwner = null;
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
  activeLoadingOwner = owner;
  setLoading(msg, progress, detail);
  return owner;
}

export function updateOwnedLoading(
  owner: LoadingOwner,
  msg: string,
  progress: number | null = null,
  detail: string | null = null,
) {
  if (activeLoadingOwner !== owner) return;
  setLoading(msg, progress, detail);
}

export function endOwnedLoading(owner: LoadingOwner) {
  if (activeLoadingOwner !== owner) return;
  hideLoading();
}
