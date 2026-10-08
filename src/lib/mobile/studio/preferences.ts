// Choices that belong to this device, not to a set: haptics, how pads launch, and which one-time
// hints have already been shown. Kept apart from sets so opening or importing a set never
// changes how the app feels in the hand.
import { haptic, type HapticType } from './nativeShare';
import { STORAGE_KEY } from './model';

export const PREFERENCES_KEY = 'ga-mobile-studio-preferences-v1';

export type StudioPreferences = {
  /** Taps from the Taptic Engine on launch, stop, blackout and tab changes. */
  haptics: boolean;
  /** Launch a pad the moment the finger lands instead of when it lifts. */
  launchOnTouchDown: boolean;
  /** The first-run coach strip was finished or dismissed. It never comes back. */
  coachDone: boolean;
  /** Sets that were already offered the one-time repair, fixed or not. */
  repairOffered: string[];
};

export const defaultPreferences = (): StudioPreferences => ({ haptics: true, launchOnTouchDown: false, coachDone: false, repairOffered: [] });

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): Store | undefined => (globalThis as { localStorage?: Store }).localStorage;

export function normalizePreferences(raw: unknown): StudioPreferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<StudioPreferences>;
  const base = defaultPreferences();
  return {
    haptics: typeof r.haptics === 'boolean' ? r.haptics : base.haptics,
    launchOnTouchDown: typeof r.launchOnTouchDown === 'boolean' ? r.launchOnTouchDown : base.launchOnTouchDown,
    coachDone: r.coachDone === true,
    repairOffered: Array.isArray(r.repairOffered) ? [...new Set(r.repairOffered.filter((id): id is string => typeof id === 'string'))].slice(-200) : [],
  };
}

/**
 * Reads this device's preferences. On the very first read, a device that already holds a set is
 * an existing install: its owner knows the app, so the coach strip is marked as done for them.
 */
export function loadPreferences(storage: Store | undefined = store()): StudioPreferences {
  try {
    const saved = storage?.getItem(PREFERENCES_KEY);
    if (saved) return normalizePreferences(JSON.parse(saved));
    return { ...defaultPreferences(), coachDone: !!storage?.getItem(STORAGE_KEY) };
  } catch {
    return defaultPreferences();
  }
}

export function savePreferences(preferences: StudioPreferences, storage: Store | undefined = store()): void {
  try {
    storage?.setItem(PREFERENCES_KEY, JSON.stringify(normalizePreferences(preferences)));
  } catch {
    /* A full or private store only costs the preference, never the set. */
  }
}

/** Where each haptic is used, so the feel stays the same across the app. */
export const FEEL = { launch: 'light', stop: 'medium', blackout: 'medium', switch: 'selection' } as const satisfies Record<string, HapticType>;

/** A haptic tap, unless the performer switched haptics off. Silent where the device has none. */
export function feel(preferences: Pick<StudioPreferences, 'haptics'>, kind: keyof typeof FEEL): void {
  if (preferences.haptics) haptic(FEEL[kind]);
}
