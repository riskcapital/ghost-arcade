/**
 * First-run guidance: the guided tour and the starter-template picker.
 *
 * Neither ever opens by itself. An earlier tour popped up on first launch and
 * got in the way of people who already know VJ software, so it was removed.
 * Now the welcome screen offers both, and the "?" overlay brings them back.
 */
import { writable } from 'svelte/store';

export interface OnboardingState {
  tourOpen: boolean;
  tourStep: number;
  templatesOpen: boolean;
}

function createOnboardingStore() {
  const { subscribe, update } = writable<OnboardingState>({
    tourOpen: false,
    tourStep: 0,
    templatesOpen: false,
  });

  return {
    subscribe,
    startTour() {
      update((s) => ({ ...s, tourOpen: true, tourStep: 0, templatesOpen: false }));
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
