import { writable, get } from 'svelte/store';
import { controllerProfiles, type ControllerProfileId } from './controllerProfiles';
export interface ControllerLightsSettings {
  enabled: boolean; outputId: string | null; profile: ControllerProfileId | 'auto';
  deck: 'selected' | 'A' | 'B'; columnPage: number; rowPage: number; gridInput: boolean;
  status: string;
}
const key = 'ghost-arcade-controller-lights';
const defaults: ControllerLightsSettings = { enabled: false, outputId: null, profile: 'auto', deck: 'selected',
  columnPage: 0, rowPage: 0, gridInput: true, status: 'Off' };
function load(): ControllerLightsSettings {
  try {
    const s = JSON.parse(localStorage.getItem(key) ?? '{}');
    return { ...defaults, outputId: typeof s.outputId === 'string' ? s.outputId : null,
      profile: s.profile in controllerProfiles ? s.profile : 'auto',
      deck: ['A', 'B'].includes(s.deck) ? s.deck : 'selected', gridInput: s.gridInput !== false };
  } catch { return { ...defaults }; }
}
const store = writable(load());
export const controllerLightsStore = { subscribe: store.subscribe,
  configure(patch: Partial<Omit<ControllerLightsSettings, 'status'>>) {
    store.update(s => {
      const next = { ...s, ...patch };
      for (const key of ['columnPage', 'rowPage'] as const) next[key] = Number.isFinite(next[key]) ? Math.max(0, Math.floor(next[key])) : 0;
      try { localStorage.setItem(key, JSON.stringify({ outputId: next.outputId, profile: next.profile, deck: next.deck, gridInput: next.gridInput })); } catch { /* optional storage */ }
      return next;
    });
  },
  status(status: string) { if (get(store).status !== status) store.update(s => ({ ...s, status })); },
};
