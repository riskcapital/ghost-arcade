/**
 * The VJ panel's Flux pad. Flux is the output-stage effect the phone app
 * plays (see output/phoneFlux.ts); this is the same effect played from the
 * desktop. The chosen modules, wet amount, blend and beat lock are kept for
 * next time; Flux itself always starts off.
 */
import { writable } from 'svelte/store';
import { defaultFlux, type FluxState } from '../mobile/studio/flux';
import { setDeskFlux } from '../output/phoneFlux';

const KEY = 'ga.vj.flux';

function load(): FluxState {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && Array.isArray(saved.modules)) {
      return { ...defaultFlux(), ...saved, active: false, latch: false };
    }
  } catch { /* first run, or storage blocked */ }
  return defaultFlux();
}

export const deskFlux = writable<FluxState>(load());

deskFlux.subscribe((state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      x: state.x, y: state.y, mix: state.mix, blend: state.blend ?? 0,
      energy: state.energy ?? 0, beat: state.beat, modules: state.modules,
    }));
  } catch { /* storage blocked */ }
  setDeskFlux({ ...state, active: state.active && state.modules.length > 0 });
});
