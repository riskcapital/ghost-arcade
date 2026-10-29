/**
 * Where the crash-recovery snapshot of the project is kept: localStorage,
 * as before, while the project fits, and IndexedDB whole once it does not
 * (a p5.js sketch that carries its sounds, an inline 3D model). See
 * spilloverStorage.
 */
import { SPILLED_TO_INDEXEDDB, spilloverValue } from './spilloverStorage';

const snapshot = spilloverValue('ghostarcade-autosave');

/** What the localStorage key holds when the snapshot is in IndexedDB. */
export const AUTOSAVE_IN_INDEXEDDB = SPILLED_TO_INDEXEDDB;

/** True when an earlier session left a snapshot to recover. */
export function hasAutosave(): boolean {
  return snapshot.has();
}

/** Keeps the snapshot: in localStorage when it fits, otherwise in IndexedDB. */
export function writeAutosave(json: string): Promise<'localStorage' | 'indexedDB' | 'cleared'> {
  return snapshot.write(json);
}

/**
 * True when IndexedDB holds a snapshot. A crash can lose the localStorage
 * marker that points at it, so a launch that finds no marker asks this too.
 */
export function findAutosave(): Promise<boolean> {
  return snapshot.inIndexedDB();
}

/** The snapshot an earlier session left, wherever it is kept. */
export function readAutosave(): Promise<string | null> {
  return snapshot.read();
}

/** Forgets the snapshot, in both places. */
export function clearAutosaveSnapshot(): void {
  snapshot.clear();
}
