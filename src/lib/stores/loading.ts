import { writable } from 'svelte/store';

/** Global loading message. When non-null, the LoadingOverlay is shown. */
export const loadingMessage = writable<string | null>(null);

export function showLoading(msg: string) {
  loadingMessage.set(msg);
}

export function hideLoading() {
  loadingMessage.set(null);
}
