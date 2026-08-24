/*
 * Which display each output surface opens on.
 *
 * Live Output, Stage Sim and Map Sim each used to resolve their own target with
 * the same line — `allDisplays.find(d => d.id !== primary.id)` — so on a rig
 * with a projector AND an external monitor all three picked whichever display
 * the OS listed first and stacked on top of each other, with the live output on
 * top. There was no way to say "projector runs the show, monitor runs Stage
 * Sim".
 *
 * This module is the one place that answers "where does surface X go", for both
 * the explicit assignment and the auto case.
 */

export type OutputSurface = 'liveOutput' | 'stageSim' | 'mapSim';

export type DisplayInfo = {
  id: number;
  label: string;
  width: number;
  height: number;
  x: number;
  y: number;
  isPrimary: boolean;
  scaleFactor?: number;
};

/**
 * Where a surface goes: a display id, `'windowed'` for a floating window on the
 * primary, or null for auto.
 *
 * `'windowed'` exists because with a single external screen the three surfaces
 * have to share it, and sharing means taking turns. A sim set to windowed opts
 * out of that contest entirely and sits beside the editor, so the show can hold
 * the projector while Stage Sim stays visible.
 */
export type SurfaceTarget = number | 'windowed' | null;

export type DisplayAssignments = Record<OutputSurface, SurfaceTarget>;

/**
 * Priority when handing out displays automatically.
 *
 * Live output first: it is the one the audience sees, and it is the only one
 * that must land on the projector if there is exactly one spare screen.
 */
const AUTO_PRIORITY: OutputSurface[] = ['liveOutput', 'stageSim', 'mapSim'];

export const SURFACE_LABELS: Record<OutputSurface, string> = {
  liveOutput: 'Live Output',
  stageSim: 'Stage Sim',
  mapSim: 'Map Sim',
};

/** True when the surface should float beside the editor rather than own a screen. */
export function isWindowed(
  assignments: Partial<DisplayAssignments> | null | undefined,
  surface: OutputSurface,
): boolean {
  return assignments?.[surface] === 'windowed';
}

/** An explicit assignment only counts if that display is still plugged in. */
export function assignedDisplay(
  displays: DisplayInfo[],
  assignments: Partial<DisplayAssignments> | null | undefined,
  surface: OutputSurface,
): DisplayInfo | null {
  const id = assignments?.[surface];
  if (id == null || id === 'windowed') return null;
  return displays.find((display) => display.id === id) ?? null;
}

/**
 * The display a surface should open on.
 *
 * Explicit assignment wins when the display is present. Otherwise the surface
 * takes the first non-primary display that no OTHER surface has explicitly
 * claimed and that no higher-priority auto surface would take — so opening all
 * three on a two-screen rig spreads them instead of stacking, and the primary
 * is the last resort rather than the first collision.
 */
export function resolveDisplayForSurface(
  displays: DisplayInfo[],
  assignments: Partial<DisplayAssignments> | null | undefined,
  surface: OutputSurface,
): DisplayInfo | null {
  if (!displays.length) return null;
  const primary = displays.find((display) => display.isPrimary) ?? displays[0];
  if (isWindowed(assignments, surface)) return primary;

  const explicit = assignedDisplay(displays, assignments, surface);
  if (explicit) return explicit;

  // Displays another surface has explicitly claimed are off the table for auto.
  const claimed = new Set<number>();
  for (const other of AUTO_PRIORITY) {
    if (other === surface) continue;
    const display = assignedDisplay(displays, assignments, other);
    if (display) claimed.add(display.id);
  }

  const external = displays.filter((display) => !display.isPrimary);
  if (!external.length) return primary;

  /*
   * Prefer a display nobody has explicitly claimed. If they are all claimed,
   * still take an external one rather than the primary: on a laptop with one
   * projector, "Stage Sim is pinned to the projector" must not quietly demote
   * the SHOW to the built-in screen. Sharing is resolved by taking turns --
   * see surfacesDisplacedBy -- not by pushing the loser onto the laptop.
   */
  const spare = external.filter((display) => !claimed.has(display.id));
  if (!spare.length) return external[0];

  // Walk the priority list, handing each auto surface the next spare display.
  // A surface further down the list than there are screens falls back to the
  // primary, windowed, which is visible and movable rather than hidden behind
  // the live output.
  let index = 0;
  for (const candidate of AUTO_PRIORITY) {
    if (assignedDisplay(displays, assignments, candidate)) continue; // explicit, skip
    if (candidate === surface) return spare[Math.min(index, spare.length - 1)] ?? primary;
    index += 1;
  }
  return primary;
}

/** Which display a window at these bounds is sitting on, by centre point. */
export function displayForBounds(
  displays: DisplayInfo[],
  bounds: { x: number; y: number; width: number; height: number },
): DisplayInfo | null {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  const hit = displays.find(
    (d) => cx >= d.x && cx < d.x + d.width && cy >= d.y && cy < d.y + d.height,
  );
  return hit ?? null;
}

/**
 * Surfaces that must yield when `surface` opens.
 *
 * With one external display the three surfaces share it, and the toolbar
 * buttons behave as toggles: opening one takes the screen from whoever holds
 * it. Anything set to windowed is never displaced -- that is the whole point of
 * choosing it.
 */
export function surfacesDisplacedBy(
  displays: DisplayInfo[],
  assignments: Partial<DisplayAssignments> | null | undefined,
  surface: OutputSurface,
  openSurfaces: Iterable<OutputSurface>,
): OutputSurface[] {
  if (isWindowed(assignments, surface)) return [];
  const target = resolveDisplayForSurface(displays, assignments, surface);
  if (!target) return [];
  const displaced: OutputSurface[] = [];
  for (const other of openSurfaces) {
    if (other === surface) continue;
    if (isWindowed(assignments, other)) continue;
    const otherTarget = resolveDisplayForSurface(displays, assignments, other);
    if (otherTarget && otherTarget.id === target.id) displaced.push(other);
  }
  return displaced;
}

/** Surfaces that would end up sharing a screen, for the hint in the menu. */
export function collidingSurfaces(
  displays: DisplayInfo[],
  assignments: Partial<DisplayAssignments> | null | undefined,
): OutputSurface[] {
  const byDisplay = new Map<number, OutputSurface[]>();
  for (const surface of AUTO_PRIORITY) {
    const display = resolveDisplayForSurface(displays, assignments, surface);
    if (!display) continue;
    const list = byDisplay.get(display.id) ?? [];
    list.push(surface);
    byDisplay.set(display.id, list);
  }
  const clashing: OutputSurface[] = [];
  for (const list of byDisplay.values()) {
    if (list.length > 1) clashing.push(...list);
  }
  return clashing;
}
