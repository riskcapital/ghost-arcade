/**
 * Onboarding store — drives the first-run feature tour.
 *
 * Persists "user has completed the tour" to localStorage so it auto-shows
 * on first launch and stays out of the way thereafter. Versioned key
 * (`ghostarcade.onboarding.v1.completed`) so we can ship a refreshed tour
 * for a future release without re-prompting users who finished v1.
 *
 * Also tracks the current step index across visit/resume cycles, so if a
 * user closes the tour mid-way it picks up where they left off.
 */
import { writable } from 'svelte/store';

const STORAGE_KEY_COMPLETED = 'ghostarcade.onboarding.v1.completed';
const STORAGE_KEY_STEP = 'ghostarcade.onboarding.v1.step';

export interface OnboardingState {
  /** Modal is currently visible. */
  open: boolean;
  /** Zero-based step index. */
  step: number;
  /** True once the user clicked "Done" on the final step. Suppresses
   *  the auto-show on subsequent launches. */
  completed: boolean;
}

function loadCompleted(): boolean {
  try { return localStorage.getItem(STORAGE_KEY_COMPLETED) === '1'; } catch { return false; }
}
function saveCompleted(v: boolean) {
  try {
    if (v) localStorage.setItem(STORAGE_KEY_COMPLETED, '1');
    else localStorage.removeItem(STORAGE_KEY_COMPLETED);
  } catch { /* ignore */ }
}
function loadStep(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_STEP);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  } catch { return 0; }
}
function saveStep(n: number) {
  try { localStorage.setItem(STORAGE_KEY_STEP, String(n)); } catch { /* ignore */ }
}

function createOnboardingStore() {
  const { subscribe, update, set } = writable<OnboardingState>({
    open: false,
    step: loadStep(),
    completed: loadCompleted(),
  });

  return {
    subscribe,
    set,

    /** Auto-trigger on app boot: open the tour if it hasn't been completed.
     *  Safe to call multiple times — only opens once per session. */
    autoStartIfNew() {
      update(s => {
        if (s.completed || s.open) return s;
        return { ...s, open: true };
      });
    },

    /** Manually open from a Help menu — restarts at step 0. */
    open() {
      update(s => ({ ...s, open: true, step: 0 }));
      saveStep(0);
    },

    /** Close the modal but DON'T mark complete — picks up where left off. */
    close() {
      update(s => ({ ...s, open: false }));
    },

    /** Mark complete + close. Triggered by "Done" on the final step. */
    finish() {
      saveCompleted(true);
      update(s => ({ ...s, open: false, completed: true }));
    },

    /** "Skip" treats the tour as completed so it won't auto-show again. */
    skip() {
      this.finish();
    },

    /** Reset (developer / "Show me again from the start" affordance). */
    reset() {
      saveCompleted(false);
      saveStep(0);
      set({ open: false, step: 0, completed: false });
    },

    setStep(n: number) {
      update(s => ({ ...s, step: Math.max(0, n) }));
      saveStep(n);
    },

    next(maxSteps: number) {
      update(s => {
        const next = Math.min(maxSteps - 1, s.step + 1);
        saveStep(next);
        return { ...s, step: next };
      });
    },

    prev() {
      update(s => {
        const prev = Math.max(0, s.step - 1);
        saveStep(prev);
        return { ...s, step: prev };
      });
    },
  };
}

export const onboarding = createOnboardingStore();
