/**
 * "Room to work": the Timeline runs from the top bar to the status bar, over
 * the canvas and the side panels (⤢ in its toolbar, or ` with the pointer
 * over it). The docked height is kept as it was. A view preference of this
 * computer.
 */
import { get, writable } from 'svelte/store';

export const ROOM_KEY = 'ga.timeline.roomToWork';

function load(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(ROOM_KEY) === '1'; } catch { return false; }
}

const state = writable<boolean>(load());

export const roomToWork = { subscribe: state.subscribe };

export function setRoomToWork(on: boolean): void {
  if (get(state) === on) return;
  state.set(on);
  try { localStorage.setItem(ROOM_KEY, on ? '1' : '0'); } catch { /* private window */ }
}

export function toggleRoomToWork(): void {
  setRoomToWork(!get(state));
}
