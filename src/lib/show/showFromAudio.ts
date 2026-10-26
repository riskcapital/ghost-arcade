/**
 * "New show from audio": the requests that open it. The File menu and the
 * welcome screen ask for a song to be picked; a song dropped on the
 * workspace (or onto an empty show) is offered directly. The dialog itself
 * is ShowFromAudioModal.svelte.
 */
import { writable } from 'svelte/store';

export type ShowFromAudioRequest = { kind: 'pick' } | { kind: 'file'; file: File };

export const showFromAudioRequest = writable<ShowFromAudioRequest | null>(null);

/** Ask for a song, then lay a show out over it. */
export function pickSongForShow(): void {
  showFromAudioRequest.set({ kind: 'pick' });
}

/** Lay a show out over this song. */
export function offerShowFromAudio(file: File): void {
  showFromAudioRequest.set({ kind: 'file', file });
}
