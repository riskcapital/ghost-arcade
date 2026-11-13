/**
 * The editor's Inside view of the dome: while it is on (and the dome output
 * is), the render core draws the dome as someone in the room under it sees
 * it, and the editor preview shows that instead of the dome picture. The
 * output window and every Screen keep the program.
 *
 * Where the view looks is editor state, not part of the project: it is not
 * saved and never reaches an output.
 */
import { writable } from 'svelte/store';

export interface DomeViewState {
  inside: boolean;
  /** Degrees around from the front, positive to the audience's right. */
  azimuth: number;
  /** Degrees up from the horizon. */
  elevation: number;
  /** Vertical field of view, degrees. */
  fov: number;
  /** Where the eye sits: 0 the dome's center, 1 the back of the room
   *  (behind the way it looks). */
  back: number;
  /** Draw the room under the dome: floor, seats, the wall and its cove. */
  room: boolean;
}

export const DOME_VIEW_HOME: Omit<DomeViewState, 'inside' | 'room'> = { azimuth: 0, elevation: 35, fov: 90, back: 0 };

export const DOME_VIEW_FOV_RANGE = { min: 20, max: 160 } as const;

export const domeView = writable<DomeViewState>({ inside: false, room: true, ...DOME_VIEW_HOME });

/** Azimuth kept in -180..180, elevation short of straight up or down, the view and the seat within their range. */
export function clampDomeView(view: DomeViewState): DomeViewState {
  const azimuth = ((((view.azimuth + 180) % 360) + 360) % 360) - 180;
  return {
    ...view,
    azimuth,
    elevation: Math.max(-60, Math.min(89, view.elevation)),
    fov: Math.max(DOME_VIEW_FOV_RANGE.min, Math.min(DOME_VIEW_FOV_RANGE.max, view.fov)),
    back: Math.max(0, Math.min(1, Number.isFinite(view.back) ? view.back : 0)),
  };
}

/**
 * One scroll step of zoom: `amount` > 0 zooms out. Out widens the view
 * until it is as wide as it goes, then moves the eye back toward the back
 * of the room; in comes forward first, then narrows.
 */
export function zoomDomeView(view: DomeViewState, amount: number): DomeViewState {
  const max = DOME_VIEW_FOV_RANGE.max;
  if (amount > 0) {
    const fov = view.fov * Math.exp(amount);
    if (fov <= max) return clampDomeView({ ...view, fov });
    return clampDomeView({ ...view, fov: max, back: view.back + Math.log(fov / max) * 1.5 });
  }
  if (view.back > 0) {
    const back = view.back + amount * 1.5;
    if (back >= 0) return clampDomeView({ ...view, back });
    return clampDomeView({ ...view, back: 0, fov: view.fov * Math.exp(back / 1.5) });
  }
  return clampDomeView({ ...view, fov: view.fov * Math.exp(amount) });
}
