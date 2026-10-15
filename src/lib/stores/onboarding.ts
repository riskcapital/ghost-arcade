/**
 * First-run guidance: the guided tour and the starter-template picker.
 *
 * Neither ever opens by itself. An earlier tour popped up on first launch and
 * got in the way of people who already know VJ software, so it was removed.
 * Now the welcome screen offers both, and the "?" overlay brings them back.
 */
import { writable } from 'svelte/store';

export type TourPath = 'vj' | 'mapping' | 'music';

export interface OnboardingState {
  tourOpen: boolean;
  /** null while the user is still choosing a path. */
  tourPath: TourPath | null;
  tourStep: number;
  templatesOpen: boolean;
}

function createOnboardingStore() {
  const { subscribe, update } = writable<OnboardingState>({
    tourOpen: false,
    tourPath: null,
    tourStep: 0,
    templatesOpen: false,
  });

  return {
    subscribe,
    /** Open the tour; without a path it starts on the path chooser. */
    startTour(path: TourPath | null = null) {
      update((s) => ({ ...s, tourOpen: true, tourPath: path, tourStep: 0, templatesOpen: false }));
    },
    choosePath(path: TourPath | null) {
      update((s) => ({ ...s, tourPath: path, tourStep: 0 }));
    },
    endTour() {
      update((s) => ({ ...s, tourOpen: false }));
    },
    setTourStep(step: number) {
      update((s) => ({ ...s, tourStep: Math.max(0, step) }));
    },
    openTemplates() {
      update((s) => ({ ...s, templatesOpen: true, tourOpen: false }));
    },
    closeTemplates() {
      update((s) => ({ ...s, templatesOpen: false }));
    },
  };
}

export const onboarding = createOnboardingStore();
