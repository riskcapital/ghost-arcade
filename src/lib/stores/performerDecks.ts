import { writable } from 'svelte/store';

export type PerformerDeckId = 'shader';

export interface PerformerDeckDefinition {
  id: PerformerDeckId;
  label: string;
  description: string;
}

export const PERFORMER_DECKS: PerformerDeckDefinition[] = [
  { id: 'shader', label: 'SHADER MODE', description: 'Legacy shader clip instrument' },
];

interface PerformerDeckState {
  activeDeck: PerformerDeckId;
}

function createPerformerDeckStore() {
  const { subscribe, update, set } = writable<PerformerDeckState>({
    activeDeck: 'shader',
  });

  return {
    subscribe,
    setActiveDeck(deck: PerformerDeckId) {
      update((state) => ({ ...state, activeDeck: deck }));
    },
    reset() {
      set({ activeDeck: 'shader' });
    },
  };
}

export const performerDeckStore = createPerformerDeckStore();
