/**
 * Project persistence for show control: the cue list and markers, timecode
 * settings, the schedule and the projectors, as one `project.showControl`
 * section.
 *
 * Save-only, like the show timeline: layers.ts writes it from the save and
 * autosave exports and never from the live state-sync relay, so a sync tick
 * cannot reset a running cue list. Imports none of the project store, so
 * layers.ts can import it without a cycle.
 */

import { get } from 'svelte/store';
import { cueList, type CueListSnapshot } from './cueList';
import { timecodeChase, type TimecodeSettings } from './timecode/timecodeChase';
import { projectors, type Projector } from './projectors';
import { normalizeSchedule, showSchedule, defaultSchedule, type ShowSchedule } from './scheduler';

export interface ShowControlSnapshot {
  version: number;
  cues: CueListSnapshot;
  timecode: TimecodeSettings & { version: number };
  schedule: ShowSchedule;
  projectors: { version: number; projectors: Projector[]; pollSeconds: number };
}

type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();

/** Runtime pieces (the schedule runner) that must forget what they did for
 *  the previous project. */
export function onShowControlHydrate(listener: ResetListener): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

export function serializeShowControl(): ShowControlSnapshot {
  return {
    version: 1,
    cues: cueList.serialize(),
    timecode: timecodeChase.serialize(),
    schedule: JSON.parse(JSON.stringify(get(showSchedule))),
    projectors: projectors.serialize(),
  };
}

/** Project open. `null` resets everything to empty (a project without the
 *  section). Never fires a cue. */
export function hydrateShowControl(payload: unknown): void {
  const p = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  cueList.hydrate(p?.cues ?? null);
  timecodeChase.hydrate(p?.timecode ?? null);
  showSchedule.set(p?.schedule ? normalizeSchedule(p.schedule) : defaultSchedule());
  projectors.hydrate(p?.projectors ?? null);
  for (const listener of resetListeners) {
    try {
      listener();
    } catch (err) {
      console.warn('[ShowControl] reset listener failed:', err);
    }
  }
}
