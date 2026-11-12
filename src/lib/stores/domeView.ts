/**
 * The editor's Inside view of the dome: while it is on (and the dome output
 * is), the render core draws the dome as someone sitting at its center
 * sees it, and the editor preview shows that instead of the dome picture.
 * The output window and every Screen keep the program.
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
}

export const DOME_VIEW_HOME: Omit<DomeViewState, 'inside'> = { azimuth: 0, elevation: 35, fov: 90 };

export const DOME_VIEW_FOV_RANGE = { min: 20, max: 140 } as const;

export const domeView = writable<DomeViewState>({ inside: false, ...DOME_VIEW_HOME });

/** Azimuth kept in -180..180, elevation short of straight up or down, the view within its range. */
export function clampDomeView(view: DomeViewState): DomeViewState {
  const azimuth = ((((view.azimuth + 180) % 360) + 360) % 360) - 180;
  return {
    ...view,
    azimuth,
    elevation: Math.max(-60, Math.min(89, view.elevation)),
    fov: Math.max(DOME_VIEW_FOV_RANGE.min, Math.min(DOME_VIEW_FOV_RANGE.max, view.fov)),
  };
}
