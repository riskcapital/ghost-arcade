import { writable, get } from 'svelte/store';
import { settings, type OutputStageSnapshot } from './settings';
import { generateUUID } from '../utils/uuid';

/**
 * Saved screen setups — the output stage as a reusable thing.
 *
 * New Project clears the output stage, because a project that inherits the
 * last one's screens and a latched dome is how someone ends up transformed
 * into a mode they never chose. That is right for a laptop moving between
 * gigs and wrong for a permanent install, where the rig is a property of the
 * room: a planetarium should not re-aim its dome every time it starts a new
 * show.
 *
 * So a setup can be marked as the default and New Project restores that
 * instead of the factory settings. Named setups cover the other case — one
 * machine, several venues, or a rig that gets rearranged and put back.
 *
 * Stored separately from both the project and the live settings. It is not
 * project content (that is the whole point), and it must survive the reset it
 * exists to override.
 */

const STORAGE_KEY = 'ghost-arcade_screen_setups';

export interface SavedScreenSetup {
  id: string;
  name: string;
  /** Snapshot of the output stage; see OUTPUT_STAGE_KEYS. */
  setup: OutputStageSnapshot;
  savedAt: number;
  /** Human-readable summary for the list, so a user can tell two apart
   *  without loading them. */
  summary: string;
}

export interface ScreenSetupsState {
  /** Applied by New Project when set. Null means factory defaults. */
  defaultSetup: SavedScreenSetup | null;
  saved: SavedScreenSetup[];
}

const INITIAL: ScreenSetupsState = { defaultSetup: null, saved: [] };

function load(): ScreenSetupsState {
  if (typeof localStorage === 'undefined') return { ...INITIAL };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...INITIAL };
    const parsed = JSON.parse(raw);
    return {
      defaultSetup: parsed?.defaultSetup ?? null,
      saved: Array.isArray(parsed?.saved) ? parsed.saved : [],
    };
  } catch {
    // A corrupt entry must not stop the app starting; worst case the user
    // saves their setup again.
    return { ...INITIAL };
  }
}

function persist(state: ScreenSetupsState) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota or a blocked implementation. The in-memory setup still works for
    // this session.
  }
}

/** Short description of what a setup contains, for the list. */
export function describeSetup(snapshot: OutputStageSnapshot): string {
  const parts: string[] = [];
  const slices = snapshot.slices as unknown[] | undefined;
  const count = Array.isArray(slices) ? slices.length : 0;
  parts.push(count === 1 ? '1 screen' : `${count} screens`);
  if (snapshot.domeEnabled) parts.push('dome');
  if ((snapshot.masterWarp as { enabled?: boolean } | undefined)?.enabled) parts.push('warp');
  const blend = ['edgeBlendLeft', 'edgeBlendRight', 'edgeBlendTop', 'edgeBlendBottom'] as const;
  if (blend.some((k) => Number(snapshot[k] ?? 0) > 0)) parts.push('edge blend');
  return parts.join(' · ');
}

function createScreenSetupsStore() {
  const { subscribe, update, set } = writable<ScreenSetupsState>(load());

  function commit(next: ScreenSetupsState) {
    persist(next);
    return next;
  }

  function snapshotNow(name: string): SavedScreenSetup {
    const setup = settings.captureOutputStage();
    return {
      id: generateUUID(),
      name: name.trim() || 'Screen setup',
      setup,
      savedAt: Date.now(),
      summary: describeSetup(setup),
    };
  }

  return {
    subscribe,

    /** Save the current output stage under a name. */
    save(name: string): SavedScreenSetup {
      const entry = snapshotNow(name);
      update(s => commit({ ...s, saved: [...s.saved, entry] }));
      return entry;
    },

    /** Apply a saved setup to the live output stage. */
    load(id: string): boolean {
      const entry = get({ subscribe }).saved.find(e => e.id === id);
      if (!entry) return false;
      settings.applyOutputStage(entry.setup);
      return true;
    },

    remove(id: string) {
      update(s => commit({
        ...s,
        saved: s.saved.filter(e => e.id !== id),
        // A deleted setup must stop being the default too, or New Project
        // would keep restoring something the user cannot see any more.
        defaultSetup: s.defaultSetup?.id === id ? null : s.defaultSetup,
      }));
    },

    rename(id: string, name: string) {
      const trimmed = name.trim();
      if (!trimmed) return;
      update(s => commit({
        ...s,
        saved: s.saved.map(e => (e.id === id ? { ...e, name: trimmed } : e)),
        defaultSetup: s.defaultSetup?.id === id
          ? { ...s.defaultSetup, name: trimmed }
          : s.defaultSetup,
      }));
    },

    /** Make the CURRENT output stage what new projects start from. */
    setCurrentAsDefault(name = 'Default screen setup'): SavedScreenSetup {
      const entry = snapshotNow(name);
      update(s => commit({ ...s, defaultSetup: entry }));
      return entry;
    },

    /** Make an already-saved setup the default. */
    setDefaultFromSaved(id: string): boolean {
      const state = get({ subscribe });
      const entry = state.saved.find(e => e.id === id);
      if (!entry) return false;
      update(s => commit({ ...s, defaultSetup: { ...entry } }));
      return true;
    },

    /** Back to factory defaults for new projects. */
    clearDefault() {
      update(s => commit({ ...s, defaultSetup: null }));
    },

    /** What New Project should restore, if anything. */
    defaultSnapshot(): OutputStageSnapshot | null {
      return get({ subscribe }).defaultSetup?.setup ?? null;
    },

    reset() {
      set(commit({ ...INITIAL }));
    },
  };
}

export const screenSetups = createScreenSetupsStore();
