/**
 * How the Studio draws its patch cables, per viewer: shown, faded or hidden.
 * Only the drawing changes; every connection keeps working.
 */

import { writable } from 'svelte/store';

export type CableView = 'show' | 'fade' | 'hide';

const KEY = 'ga.studio.cableView';
const ORDER: CableView[] = ['show', 'fade', 'hide'];

function load(): CableView {
  try {
    const v = localStorage.getItem(KEY);
    return ORDER.includes(v as CableView) ? (v as CableView) : 'show';
  } catch {
    return 'show';
  }
}

export const cableView = writable<CableView>(load());

cableView.subscribe((v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    // Private windows: the setting lasts for this session only.
  }
});

/** Shown, then faded, then hidden, then shown again. */
export function cycleCableView(): void {
  cableView.update((v) => ORDER[(ORDER.indexOf(v) + 1) % ORDER.length]);
}

export const CABLE_VIEW_LABELS: Record<CableView, string> = { show: 'Cables', fade: 'Cables faded', hide: 'Cables hidden' };
