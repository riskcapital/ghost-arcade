/**
 * Display assignment: the rig this exists for is a laptop, a projector and an
 * external monitor, where the show goes to the projector and Stage Sim goes to
 * the monitor. Before this, all three surfaces resolved the same
 * `find(d => d.id !== primary.id)` and stacked on one screen.
 */

import { describe, expect, it } from 'vitest';
import {
  collidingSurfaces,
  displayForBounds,
  isWindowed,
  resolveDisplayForSurface,
  surfacesDisplacedBy,
  type DisplayAssignments,
  type DisplayInfo,
} from './displayAssignment';

const LAPTOP: DisplayInfo = { id: 1, label: 'Built-in', width: 1512, height: 982, x: 0, y: 0, isPrimary: true };
const MONITOR: DisplayInfo = { id: 2, label: 'Studio Display', width: 2560, height: 1440, x: 1512, y: 0, isPrimary: false };
const PROJECTOR: DisplayInfo = { id: 3, label: 'EPSON', width: 1920, height: 1080, x: 4072, y: 0, isPrimary: false };

const NONE: DisplayAssignments = { liveOutput: null, stageSim: null, mapSim: null };

describe('resolveDisplayForSurface', () => {
  it('honours an explicit assignment', () => {
    const assignments = { ...NONE, liveOutput: PROJECTOR.id, stageSim: MONITOR.id };
    const displays = [LAPTOP, MONITOR, PROJECTOR];
    expect(resolveDisplayForSurface(displays, assignments, 'liveOutput')?.id).toBe(PROJECTOR.id);
    expect(resolveDisplayForSurface(displays, assignments, 'stageSim')?.id).toBe(MONITOR.id);
  });

  it('spreads auto surfaces across spare displays instead of stacking', () => {
    const displays = [LAPTOP, MONITOR, PROJECTOR];
    const live = resolveDisplayForSurface(displays, NONE, 'liveOutput');
    const stage = resolveDisplayForSurface(displays, NONE, 'stageSim');
    expect(live?.isPrimary).toBe(false);
    expect(stage?.isPrimary).toBe(false);
    expect(live?.id).not.toBe(stage?.id);
  });

  it('gives the single spare screen to live output, not to a sim', () => {
    // One projector and nothing else: the audience-facing surface wins it.
    const displays = [LAPTOP, PROJECTOR];
    expect(resolveDisplayForSurface(displays, NONE, 'liveOutput')?.id).toBe(PROJECTOR.id);
    expect(resolveDisplayForSurface(displays, NONE, 'stageSim')?.id).toBe(PROJECTOR.id);
  });

  it('does not auto-claim a display another surface has explicitly taken', () => {
    // Live output pinned to the monitor; Stage Sim on auto must take the
    // projector rather than landing on top of the show.
    const assignments = { ...NONE, liveOutput: MONITOR.id };
    const displays = [LAPTOP, MONITOR, PROJECTOR];
    expect(resolveDisplayForSurface(displays, assignments, 'stageSim')?.id).toBe(PROJECTOR.id);
  });

  it('falls back to auto when the assigned display has been unplugged', () => {
    // Stored ids do not survive a replug. Opening nothing would look like a bug.
    const assignments = { ...NONE, stageSim: 99 };
    const displays = [LAPTOP, MONITOR];
    expect(resolveDisplayForSurface(displays, assignments, 'stageSim')).toBeTruthy();
  });

  it('uses the primary when it is the only screen', () => {
    expect(resolveDisplayForSurface([LAPTOP], NONE, 'liveOutput')?.id).toBe(LAPTOP.id);
    expect(resolveDisplayForSurface([LAPTOP], NONE, 'mapSim')?.id).toBe(LAPTOP.id);
  });
});

describe('displayForBounds', () => {
  it('identifies the screen a window was dragged onto by its centre', () => {
    const displays = [LAPTOP, MONITOR, PROJECTOR];
    expect(displayForBounds(displays, { x: 4200, y: 100, width: 800, height: 600 })?.id)
      .toBe(PROJECTOR.id);
    expect(displayForBounds(displays, { x: 100, y: 100, width: 800, height: 600 })?.id)
      .toBe(LAPTOP.id);
  });
});

describe('collidingSurfaces', () => {
  it('is quiet when every surface has its own screen', () => {
    const assignments = { ...NONE, liveOutput: PROJECTOR.id, stageSim: MONITOR.id, mapSim: LAPTOP.id };
    expect(collidingSurfaces([LAPTOP, MONITOR, PROJECTOR], assignments)).toEqual([]);
  });

  it('names both surfaces when two are pointed at one screen', () => {
    const assignments = { ...NONE, liveOutput: PROJECTOR.id, stageSim: PROJECTOR.id };
    const clash = collidingSurfaces([LAPTOP, MONITOR, PROJECTOR], assignments);
    expect(clash).toContain('liveOutput');
    expect(clash).toContain('stageSim');
  });
});

describe('single external display — surfaces take turns', () => {
  // The rig this is really about: laptop plus one projector. All three
  // surfaces want the projector, so opening one has to evict whoever holds it.
  const displays = [LAPTOP, PROJECTOR];

  it('evicts the surface currently holding the shared screen', () => {
    const displaced = surfacesDisplacedBy(displays, NONE, 'stageSim', ['liveOutput']);
    expect(displaced).toEqual(['liveOutput']);
  });

  it('leaves a windowed surface alone — that is why you chose windowed', () => {
    const assignments = { ...NONE, stageSim: 'windowed' as const };
    // Live output taking the projector must not close a floating Stage Sim.
    expect(surfacesDisplacedBy(displays, assignments, 'liveOutput', ['stageSim'])).toEqual([]);
    // And a windowed surface opening displaces nothing.
    expect(surfacesDisplacedBy(displays, assignments, 'stageSim', ['liveOutput'])).toEqual([]);
  });

  it('puts a windowed surface on the primary, beside the editor', () => {
    const assignments = { ...NONE, mapSim: 'windowed' as const };
    expect(isWindowed(assignments, 'mapSim')).toBe(true);
    expect(resolveDisplayForSurface(displays, assignments, 'mapSim')?.id).toBe(LAPTOP.id);
    // ...and it stops competing, so live output still gets the projector.
    expect(resolveDisplayForSurface(displays, assignments, 'liveOutput')?.id).toBe(PROJECTOR.id);
  });

  it('does not evict across different screens', () => {
    // Two spare screens: nobody has to yield.
    const three = [LAPTOP, MONITOR, PROJECTOR];
    const assignments = { ...NONE, liveOutput: PROJECTOR.id, stageSim: MONITOR.id };
    expect(surfacesDisplacedBy(three, assignments, 'stageSim', ['liveOutput'])).toEqual([]);
  });
});

describe('one external screen, another surface pinned to it', () => {
  const displays = [LAPTOP, PROJECTOR];

  it('still gives live output the projector rather than the laptop', () => {
    // Stage Sim pinned to the only external. Live Output on auto must NOT get
    // quietly demoted to the built-in screen -- it is the show.
    const assignments = { ...NONE, stageSim: PROJECTOR.id };
    expect(resolveDisplayForSurface(displays, assignments, 'liveOutput')?.id).toBe(PROJECTOR.id);
  });

  it('and they take turns on it', () => {
    const assignments = { ...NONE, stageSim: PROJECTOR.id };
    expect(surfacesDisplacedBy(displays, assignments, 'liveOutput', ['stageSim'])).toEqual(['stageSim']);
  });
});
