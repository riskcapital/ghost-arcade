/**
 * Show timeline tests.
 *
 * Four things have to hold, and every one of them is cheap to regress:
 *
 *  1. `seek()` picks the RIGHT clip, including on an exact boundary and
 *     inside a gap. Off-by-one here means a preset change lands a frame
 *     late for the whole export.
 *  2. `loadComposition` fires ONLY when the active clip changes. The
 *     offline renderer calls `seek()` 60 times a second; firing every frame
 *     would rebuild the entire layer stack 60 times a second.
 *  3. serialize/hydrate round-trips the arrangement and never restores a
 *     playing transport.
 *  4. Audio AssetRefs blank at save and resolve on load, so a saved show
 *     still finds its music on reopen (the projectionSim contract).
 *
 * Runs in vitest's `node` environment — no document, no requestAnimationFrame,
 * no AudioContext. The store is built to be inert in exactly that situation,
 * so this suite is also the regression guard for "nothing happens when the
 * timeline is unused".
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import {
  showTimeline,
  setShowCompositionLoader,
  setShowTransitionSink,
  findActiveShowClip,
  computeShowDuration,
  snapShowTime,
  placeOnLane,
  maxDurationAt,
  clampShowTransitionDuration,
  findJunctionPredecessor,
  maxShowTransitionDuration,
  resolveShowTransition,
  resolveShowTransitionAt,
  resolveTransitionStyle,
  showTransitionWindow,
  defaultClipTransition,
  SHOW_SNAP_SECONDS,
} from './showTimeline';
import type { ActiveCompositionTransition } from '../renderer/compositionTransitionLayers';
import { presetTransition } from './presetTransition';
import * as visualAudio from '../audio/visualAudio';
import type { ClipTransitionIn, ShowPresetClip } from '../types';

function clip(id: string, compositionId: string, startTime: number, duration: number): ShowPresetClip {
  return { id, compositionId, startTime, duration, transitionIn: 'cut', transitionDuration: 0.5 };
}

/** Same, but with a real transition on it. */
function fadeClip(
  id: string,
  compositionId: string,
  startTime: number,
  duration: number,
  transitionDuration: number,
  transitionIn: ClipTransitionIn = 'dissolve',
): ShowPresetClip {
  return { id, compositionId, startTime, duration, transitionIn, transitionDuration };
}

/** Install a spy loader and hand back the call log. */
function spyLoader() {
  const calls: Array<{ compositionId: string; restoreTransports: boolean }> = [];
  setShowCompositionLoader((compositionId, options) => {
    calls.push({ compositionId, restoreTransports: options.restoreTransports });
  });
  return calls;
}

/**
 * Install BOTH seams onto one ordered log.
 *
 * The transition seam is no longer a fire-and-forget "start a 4s animation"
 * call — it publishes the RESOLVED state of the blend at the instant being
 * evaluated, and it only publishes when that state actually changed. So a
 * log entry means "the scene should now look like `progress` of the way
 * from A to B", not "a transition began".
 */
function spyRenderer() {
  const events: Array<
    | { kind: 'transition'; transition: ActiveCompositionTransition | null }
    | { kind: 'load'; compositionId: string; restoreTransports: boolean }
  > = [];
  setShowTransitionSink((transition) => {
    events.push({ kind: 'transition', transition: transition ? { ...transition } : null });
  });
  setShowCompositionLoader((compositionId, options) => {
    events.push({ kind: 'load', compositionId, restoreTransports: options.restoreTransports });
  });
  return events;
}

/** Only the published transition states, in order. */
function transitionsOf(events: ReturnType<typeof spyRenderer>) {
  return events
    .filter((e): e is { kind: 'transition'; transition: ActiveCompositionTransition | null } => e.kind === 'transition')
    .map((e) => e.transition);
}

beforeEach(() => {
  showTimeline._resetForTest();
  presetTransition._resetForTest();
});

afterEach(() => {
  setShowCompositionLoader(null);
  setShowTransitionSink(null);
  showTimeline._resetForTest();
  presetTransition._resetForTest();
  vi.restoreAllMocks();
});

// ── Pure arrangement maths ────────────────────────────────────────────────

describe('findActiveShowClip', () => {
  const clips = [clip('a', 'compA', 0, 30), clip('b', 'compB', 30, 15), clip('c', 'compC', 60, 10)];

  it('resolves the interior of each clip', () => {
    expect(findActiveShowClip(clips, 0)?.id).toBe('a');
    expect(findActiveShowClip(clips, 15)?.id).toBe('a');
    expect(findActiveShowClip(clips, 31)?.id).toBe('b');
    expect(findActiveShowClip(clips, 65)?.id).toBe('c');
  });

  it('uses half-open intervals so an exact boundary belongs to the NEXT clip', () => {
    // t = 30 is the last instant of nothing and the first instant of b.
    expect(findActiveShowClip(clips, 29.999)?.id).toBe('a');
    expect(findActiveShowClip(clips, 30)?.id).toBe('b');
    expect(findActiveShowClip(clips, 44.999)?.id).toBe('b');
    // 45 is b's exclusive end and there is a gap after it.
    expect(findActiveShowClip(clips, 45)).toBeNull();
  });

  it('returns null in a gap and past the end', () => {
    expect(findActiveShowClip(clips, 50)).toBeNull();
    expect(findActiveShowClip(clips, 70)).toBeNull();
    expect(findActiveShowClip([], 0)).toBeNull();
  });
});

describe('computeShowDuration', () => {
  it('is the furthest edge of anything on the timeline', () => {
    expect(computeShowDuration([clip('a', 'x', 0, 30)], [])).toBe(30);
    expect(
      computeShowDuration([clip('a', 'x', 0, 30)], [{ startTime: 10, duration: 90 }]),
    ).toBe(100);
    expect(computeShowDuration([], [])).toBe(0);
  });
});

describe('snapShowTime', () => {
  it('snaps to the grid inside the tolerance and leaves it alone outside', () => {
    expect(snapShowTime(10.03, [], { enabled: true, tolerance: 0.2 })).toBeCloseTo(10, 6);
    // 10.12 is 0.12 from 10.0 and 0.13 from 10.25 — grid wins at 10.
    expect(snapShowTime(10.12, [], { enabled: true, tolerance: 0.05 })).toBeCloseTo(10.12, 6);
  });

  it('prefers a clip edge over the grid when the edge is nearer', () => {
    // 12.02 is 0.02 from the edge at 12.02... use an off-grid edge.
    const snapped = snapShowTime(12.06, [12.07], { enabled: true, tolerance: 0.2 });
    expect(snapped).toBeCloseTo(12.07, 6);
  });

  it('is a pass-through when snapping is off', () => {
    expect(snapShowTime(10.03, [10], { enabled: false, tolerance: 5 })).toBeCloseTo(10.03, 6);
  });

  it('never returns a negative time', () => {
    expect(snapShowTime(-5, [], { enabled: true, tolerance: SHOW_SNAP_SECONDS })).toBe(0);
  });
});

describe('placeOnLane', () => {
  const others = [
    { id: 'a', startTime: 0, duration: 10 },
    { id: 'b', startTime: 30, duration: 10 },
  ];

  it('accepts a start that fits in the gap', () => {
    expect(placeOnLane(others, 15, 5)).toBe(15);
  });

  it('clamps a start that would overrun the next neighbour', () => {
    expect(placeOnLane(others, 28, 10)).toBe(20);
  });

  it('pushes out of an occupied span rather than overlapping', () => {
    const placed = placeOnLane(others, 5, 5);
    expect(placed).not.toBeNull();
    expect(placed! + 5).toBeLessThanOrEqual(30);
    expect(placed).toBeGreaterThanOrEqual(10);
  });

  it('refuses a move into a window narrower than the item', () => {
    // The hole between a and b is 20s wide; a 25s clip cannot go there.
    expect(placeOnLane(others, 15, 25)).toBeNull();
  });

  it('leaves the tail unbounded', () => {
    expect(placeOnLane(others, 100, 600)).toBe(100);
  });
});

describe('maxDurationAt', () => {
  it('measures the room before the next neighbour', () => {
    const others = [{ id: 'b', startTime: 30, duration: 10 }];
    expect(maxDurationAt(others, 10)).toBe(20);
    expect(maxDurationAt([], 10)).toBe(Number.POSITIVE_INFINITY);
  });
});

// ── seek() is the single source of truth ─────────────────────────────────

describe('seek', () => {
  it('fires the composition for the clip under the playhead', () => {
    const calls = spyLoader();
    showTimeline.addPresetClip('compA', 30);
    showTimeline.addPresetClip('compB', 15);

    showTimeline.seek(5);
    expect(calls).toEqual([{ compositionId: 'compA', restoreTransports: true }]);

    showTimeline.seek(35);
    expect(calls).toHaveLength(2);
    expect(calls[1].compositionId).toBe('compB');
  });

  it('fires exactly once per boundary crossing, not once per frame', () => {
    const calls = spyLoader();
    showTimeline.addPresetClip('compA', 1); // [0, 1)
    showTimeline.addPresetClip('compB', 1); // [1, 2)

    // Exactly what offlineRender.ts does: one seek per frame at 60 fps.
    for (let frame = 0; frame < 120; frame++) {
      showTimeline.seek(frame / 60);
    }

    expect(calls.map((c) => c.compositionId)).toEqual(['compA', 'compB']);
  });

  it('holds the last composition through a gap and re-fires on re-entry', () => {
    const calls = spyLoader();
    showTimeline.addPresetClip('compA', 10);          // [0, 10)
    showTimeline.insertPresetClipAt('compB', 20, 10); // [20, 30)

    showTimeline.seek(5);
    showTimeline.seek(15); // gap — nothing new fires, picture is held
    expect(calls).toHaveLength(1);
    expect(get(showTimeline).activeClipId).toBeNull();

    showTimeline.seek(25);
    expect(calls.map((c) => c.compositionId)).toEqual(['compA', 'compB']);

    // Scrubbing back into A re-fires it — the gap reset the active clip.
    showTimeline.seek(5);
    expect(calls.map((c) => c.compositionId)).toEqual(['compA', 'compB', 'compA']);
  });

  it('clamps to the show length when not looping and wraps when it is', () => {
    showTimeline.addPresetClip('compA', 10);
    showTimeline.seek(999);
    expect(get(showTimeline).currentTime).toBe(10);

    showTimeline.setLoop(true);
    showTimeline.seek(25);
    expect(get(showTimeline).currentTime).toBeCloseTo(5, 6);
  });

  it('keeps the last clip live when parked exactly on the end of the show', () => {
    const calls = spyLoader();
    showTimeline.addPresetClip('compA', 10);
    showTimeline.seek(10); // exclusive end — must not drop the picture
    expect(get(showTimeline).activeClipId).not.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('does nothing at all on an empty timeline', () => {
    const calls = spyLoader();
    showTimeline.seek(42);
    expect(calls).toHaveLength(0);
    expect(get(showTimeline).currentTime).toBe(0);
    expect(get(showTimeline).duration).toBe(0);
  });

  it('refuses to start a transport on an empty timeline', () => {
    showTimeline.play();
    expect(get(showTimeline).isPlaying).toBe(false);
  });
});

// ── Arrangement CRUD through the store ───────────────────────────────────

describe('preset clip CRUD', () => {
  it('appends clips back-to-back and tracks total duration', () => {
    showTimeline.addPresetClip('compA', 60);
    showTimeline.addPresetClip('compB', 30);
    const s = get(showTimeline);
    expect(s.presetClips.map((c) => [c.startTime, c.duration])).toEqual([[0, 60], [60, 30]]);
    expect(s.duration).toBe(90);
  });

  it('never lets a move create an overlap', () => {
    showTimeline.addPresetClip('compA', 30);
    showTimeline.addPresetClip('compB', 30);
    const bId = get(showTimeline).presetClips[1].id;
    showTimeline.movePresetClip(bId, 10); // would sit inside A
    const clips = get(showTimeline).presetClips;
    const a = clips.find((c) => c.compositionId === 'compA')!;
    const b = clips.find((c) => c.compositionId === 'compB')!;
    expect(b.startTime).toBeGreaterThanOrEqual(a.startTime + a.duration);
  });

  it('clamps a resize at the next neighbour', () => {
    showTimeline.addPresetClip('compA', 30);
    showTimeline.addPresetClip('compB', 30);
    const aId = get(showTimeline).presetClips[0].id;
    showTimeline.resizePresetClip(aId, 'end', 500);
    expect(get(showTimeline).presetClips[0].duration).toBe(30);
  });

  it('compacts gaps out of the preset lane', () => {
    showTimeline.addPresetClip('compA', 10);
    showTimeline.insertPresetClipAt('compB', 40, 10);
    showTimeline.compactPresetClips();
    expect(get(showTimeline).presetClips.map((c) => c.startTime)).toEqual([0, 10]);
    expect(get(showTimeline).duration).toBe(20);
  });

  it('clears the active clip when the live clip is deleted', () => {
    spyLoader();
    showTimeline.addPresetClip('compA', 10);
    showTimeline.seek(5);
    const id = get(showTimeline).presetClips[0].id;
    expect(get(showTimeline).activeClipId).toBe(id);
    showTimeline.removePresetClip(id);
    expect(get(showTimeline).activeClipId).toBeNull();
    expect(get(showTimeline).duration).toBe(0);
  });
});

// ── Persistence ──────────────────────────────────────────────────────────

describe('serialize / hydrate', () => {
  it('round-trips clips and tracks and never restores a playing transport', async () => {
    showTimeline.addPresetClip('compA', 60, 'Opening');
    showTimeline.addPresetClip('compB', 30, 'Drop');
    showTimeline.addPresetClip('compC', 45, 'Outro');
    await showTimeline.addAudioTrack({
      name: 'bed.wav',
      url: 'blob:http://localhost/bed',
      assetRef: { kind: 'local-file', originalPath: '/Users/x/music/bed.wav', name: 'bed.wav' },
      startTime: 0,
      duration: 90,
    });
    await showTimeline.addAudioTrack({
      name: 'stinger.wav',
      url: 'blob:http://localhost/stinger',
      assetRef: { kind: 'local-file', originalPath: '/Users/x/music/stinger.wav', name: 'stinger.wav' },
      startTime: 60,
      duration: 12,
      lane: 1,
    });
    showTimeline.setLoop(true);
    // Pretend the operator hit play and the transport is mid-show.
    showTimeline.seek(30);

    const saved = showTimeline.serialize();
    expect(saved.presetClips).toHaveLength(3);
    expect(saved.audioTracks).toHaveLength(2);
    // Session state must not travel.
    expect(Object.keys(saved)).not.toContain('isPlaying');
    expect(Object.keys(saved)).not.toContain('currentTime');
    expect(Object.keys(saved)).not.toContain('activeClipId');

    // Simulate a fresh session.
    showTimeline._resetForTest();
    expect(get(showTimeline).presetClips).toHaveLength(0);

    showTimeline.hydrate(JSON.parse(JSON.stringify(saved)), '/Users/x/projects/show1');
    const s = get(showTimeline);

    expect(s.isPlaying).toBe(false);
    expect(s.currentTime).toBe(0);
    expect(s.activeClipId).toBeNull();
    expect(s.loop).toBe(true);
    expect(s.presetClips.map((c) => [c.compositionId, c.startTime, c.duration])).toEqual([
      ['compA', 0, 60],
      ['compB', 60, 30],
      ['compC', 90, 45],
    ]);
    expect(s.presetClips.map((c) => c.label)).toEqual(['Opening', 'Drop', 'Outro']);
    expect(s.audioTracks.map((t) => [t.name, t.startTime, t.duration, t.lane])).toEqual([
      ['bed.wav', 0, 90, 0],
      ['stinger.wav', 60, 12, 1],
    ]);
    expect(s.duration).toBe(135);
  });

  it('blanks runtime audio URLs at save and rebuilds them from the AssetRef on load', async () => {
    await showTimeline.addAudioTrack({
      name: 'venue-set.wav',
      url: 'blob:http://localhost:1420/dead-runtime-url',
      assetRef: { kind: 'local-file', originalPath: '/Users/x/music/venue-set.wav', name: 'venue-set.wav' },
      startTime: 0,
      duration: 300,
    });

    const saved = showTimeline.serialize();
    expect(saved.audioTracks[0].url).toBe('');
    expect(saved.audioTracks[0].assetRef?.originalPath).toBe('/Users/x/music/venue-set.wav');
    // Nothing base64-sized may end up in the project file.
    expect(JSON.stringify(saved).length).toBeLessThan(50_000);

    showTimeline._resetForTest();
    showTimeline.hydrate(saved, '/Users/x/projects/show1');
    const track = get(showTimeline).audioTracks[0];
    expect(track.url).toBeTruthy();
    expect(track.url).not.toContain('blob:');
    expect(track.url).toContain('venue-set.wav');
  });

  it('resolves a project-relative sibling copy against projectDir', () => {
    showTimeline.hydrate(
      {
        version: 1,
        audioTracks: [
          {
            id: 't1',
            name: 'sib.wav',
            url: '',
            assetRef: { kind: 'project-file', projectPath: 'assets/sib.wav', name: 'sib.wav' },
            startTime: 0,
            duration: 10,
            offset: 0,
            sourceDuration: 10,
            volume: 1,
            muted: false,
            lane: 0,
          },
        ],
        presetClips: [],
      },
      '/Users/x/projects/show1',
    );
    const track = get(showTimeline).audioTracks[0];
    expect(track.url).toContain('show1');
    expect(track.url).toContain('assets/sib.wav');
  });

  it('keeps an embedded dataUrl track resolvable without a projectDir', () => {
    showTimeline.hydrate({
      version: 1,
      audioTracks: [
        {
          id: 't1',
          name: 'tiny.wav',
          url: '',
          assetRef: { kind: 'embedded', dataUrl: 'data:audio/wav;base64,AAAA', name: 'tiny.wav' },
          startTime: 0,
          duration: 1,
          offset: 0,
          sourceDuration: 1,
          volume: 1,
          muted: false,
          lane: 0,
        },
      ],
      presetClips: [],
    });
    expect(get(showTimeline).audioTracks[0].url).toBe('data:audio/wav;base64,AAAA');
  });

  it('hydrating null wipes the arrangement so a new project cannot inherit one', () => {
    showTimeline.addPresetClip('compA', 30);
    showTimeline.hydrate(null);
    const s = get(showTimeline);
    expect(s.presetClips).toHaveLength(0);
    expect(s.audioTracks).toHaveLength(0);
    expect(s.duration).toBe(0);
    expect(s.isPlaying).toBe(false);
  });

  it('survives a malformed section without throwing', () => {
    expect(() =>
      showTimeline.hydrate({
        version: 1,
        audioTracks: [null, 'nope', { id: 'ok', name: 'x', url: '', startTime: 'bad', duration: -3 }],
        presetClips: [null, { id: 'no-comp' }, { id: 'good', compositionId: 'c1', startTime: 2, duration: 4 }],
      }),
    ).not.toThrow();
    const s = get(showTimeline);
    expect(s.presetClips).toHaveLength(1);
    expect(s.presetClips[0].compositionId).toBe('c1');
    expect(s.audioTracks).toHaveLength(1);
    expect(s.audioTracks[0].startTime).toBe(0);
    expect(s.audioTracks[0].duration).toBeGreaterThan(0);
  });
});

// ── Junction transitions ─────────────────────────────────────────────────
//
// Semantics under test: CENTRED ON THE JUNCTION. A `D`-second transition at
// the boundary `t0` between two TOUCHING clips runs over
// [t0 - D/2, t0 + D/2) — half reaching back into the outgoing clip and half
// forward into the incoming one, which is where Premiere and CapCut put one.
//
// This replaced START-AT semantics (the blend running forward over
// [startTime, startTime + D)), which existed only because the old WebGL
// mechanism froze the outgoing composite at the swap and could not show
// anything before it. The native implementation keeps both compositions'
// layers in the scene, so it has no such constraint. See the "Clip
// transitions" block in showTimeline.ts.

describe('resolveTransitionStyle', () => {
  it('treats cut and junk as a hard cut', () => {
    expect(resolveTransitionStyle('cut')).toBeNull();
    expect(resolveTransitionStyle(undefined)).toBeNull();
    expect(resolveTransitionStyle('not-a-style' as ClipTransitionIn)).toBeNull();
  });

  it('maps the legacy VJ-timeline values onto dissolve', () => {
    expect(resolveTransitionStyle('fade')).toBe('dissolve');
    expect(resolveTransitionStyle('crossfade')).toBe('dissolve');
  });

  it('maps every legacy WebGL shader style onto dissolve rather than a cut', () => {
    // These named engine.ts shaders that never ran under NATIVE_ENGINE_ONLY.
    // A project saved with one still meant "blend here", so it stays a blend.
    expect(resolveTransitionStyle('wave')).toBe('dissolve');
    expect(resolveTransitionStyle('pixelMelt')).toBe('dissolve');
    expect(resolveTransitionStyle('iris')).toBe('dissolve');
  });

  it('passes a native style straight through', () => {
    expect(resolveTransitionStyle('dissolve')).toBe('dissolve');
    expect(resolveTransitionStyle('dipToBlack')).toBe('dipToBlack');
    expect(resolveTransitionStyle('additive')).toBe('additive');
  });
});

describe('clampShowTransitionDuration', () => {
  it('leaves a transition that fits both neighbours alone', () => {
    expect(clampShowTransitionDuration(2, { duration: 30 }, { duration: 30 })).toBe(2);
  });

  it('clamps to the incoming clip when that is the shorter one', () => {
    expect(clampShowTransitionDuration(5, { duration: 1 }, { duration: 30 })).toBe(1);
  });

  it('clamps to the OUTGOING clip when that is the shorter one', () => {
    // The window is centred, so a 5s transition would reach 2.5s back into a
    // 0.5s clip — past its own start and into the clip before it.
    expect(clampShowTransitionDuration(5, { duration: 30 }, { duration: 0.5 })).toBe(0.5);
  });

  it('only considers the incoming clip when nothing precedes it', () => {
    expect(clampShowTransitionDuration(5, { duration: 3 }, null)).toBe(3);
  });

  it('reads zero / negative / junk as a hard cut', () => {
    expect(clampShowTransitionDuration(0, { duration: 30 }, null)).toBe(0);
    expect(clampShowTransitionDuration(-2, { duration: 30 }, null)).toBe(0);
    expect(clampShowTransitionDuration(undefined, { duration: 30 }, null)).toBe(0);
    expect(clampShowTransitionDuration(Number.NaN, { duration: 30 }, null)).toBe(0);
  });
});

describe('transition duration clamping against BOTH neighbours', () => {
  it('never lets two adjacent junctions overlap, even at their ceilings', () => {
    // A[0,10) B[10,20) C[20,30), both junctions asking for 60s.
    const a = clip('a', 'compA', 0, 10);
    const b = fadeClip('b', 'compB', 10, 10, 60);
    const c = fadeClip('c', 'compC', 20, 10, 60);
    const clips = [a, b, c];
    const first = showTransitionWindow(clips, b)!;
    const second = showTransitionWindow(clips, c)!;
    expect(first.duration).toBe(10);
    expect(second.duration).toBe(10);
    // [5,15) and [15,25) — they touch, they never overlap. That is what
    // makes "one transition in flight" structural instead of policed.
    expect(first.end).toBeLessThanOrEqual(second.start + 1e-9);
    expect(resolveShowTransitionAt(clips, 14.99)?.clipId).toBe('b');
    expect(resolveShowTransitionAt(clips, 15)?.clipId).toBe('c');
  });

  it('a short OUTGOING clip caps the window as hard as a short incoming one', () => {
    const shortPrev = [clip('a', 'compA', 0, 1), fadeClip('b', 'compB', 1, 30, 8)];
    expect(showTransitionWindow(shortPrev, shortPrev[1])!.duration).toBe(1);
    const shortNext = [clip('a', 'compA', 0, 30), fadeClip('b', 'compB', 30, 1, 8)];
    expect(showTransitionWindow(shortNext, shortNext[1])!.duration).toBe(1);
    // …and the ceiling the UI clamps a drag against agrees with it.
    expect(maxShowTransitionDuration(shortPrev, shortPrev[1])).toBe(1);
    expect(maxShowTransitionDuration(shortNext, shortNext[1])).toBe(1);
  });

  it('setTransitionDuration refuses to exceed the shorter neighbour', () => {
    showTimeline.addPresetClip('compA', 4);
    const bId = showTimeline.addPresetClip('compB', 30);
    showTimeline.setSnapEnabled(false);
    showTimeline.addTransitionAt(bId, 'dissolve', 2);
    showTimeline.setTransitionDuration(bId, 99);
    const b = get(showTimeline).presetClips.find((c) => c.id === bId)!;
    expect(b.transitionDuration).toBe(4);
    // …and never below the floor either.
    showTimeline.setTransitionDuration(bId, 0);
    expect(get(showTimeline).presetClips.find((c) => c.id === bId)!.transitionDuration).toBe(0.25);
  });
});

describe('findJunctionPredecessor', () => {
  const a = clip('a', 'compA', 0, 10);
  const b = clip('b', 'compB', 10, 10);
  const c = clip('c', 'compC', 40, 10); // after a gap

  it('finds the clip butted up against this one', () => {
    expect(findJunctionPredecessor([a, b, c], b)?.id).toBe('a');
  });

  it('does NOT reach across a gap — that is not a junction', () => {
    // The previous implementation did, on the reasoning that the last-fired
    // composition is still on screen through a hole. A centred window cannot
    // use that: it would start mid-gap, where nothing is playing.
    expect(findJunctionPredecessor([a, b, c], c)).toBeNull();
  });

  it('returns null for the first clip in the show', () => {
    expect(findJunctionPredecessor([a, b, c], a)).toBeNull();
  });
});

describe('resolveShowTransition', () => {
  // A: [0,10)  B: [10,20) with a 4s dissolve on their junction.
  // Window: [8, 12).
  const a = clip('a', 'compA', 0, 10);
  const b = fadeClip('b', 'compB', 10, 10, 4);
  const clips = [a, b];

  it('straddles the boundary — half in each clip', () => {
    const win = showTransitionWindow(clips, b)!;
    expect(win.start).toBe(8);
    expect(win.end).toBe(12);
    expect(win.duration).toBe(4);
  });

  it('is progress 0 at the open, 0.5 on the boundary and ~1 at the close', () => {
    expect(resolveShowTransition(clips, b, 8)!.progress).toBe(0);
    expect(resolveShowTransition(clips, b, 10)!.progress).toBeCloseTo(0.5, 9);
    expect(resolveShowTransition(clips, b, 11.999)!.progress).toBeCloseTo(0.99975, 5);
  });

  it('names both sides of the blend', () => {
    const plan = resolveShowTransition(clips, b, 10)!;
    expect(plan.fromCompositionId).toBe('compA');
    expect(plan.toCompositionId).toBe('compB');
    expect(plan.style).toBe('dissolve');
    expect(plan.clipId).toBe('b');
  });

  it('is a pure function of (clips, clip, time) — two cold seeks agree', () => {
    expect(resolveShowTransition(clips, b, 9.25)).toEqual(resolveShowTransition(clips, b, 9.25));
    expect(resolveShowTransition(clips, b, 9.25)!.progress).toBeCloseTo(0.3125, 9);
  });

  it('is null outside the window on both sides', () => {
    expect(resolveShowTransition(clips, b, 7.99)).toBeNull();
    expect(resolveShowTransition(clips, b, 12)).toBeNull();
    expect(resolveShowTransition(clips, b, 18)).toBeNull();
  });

  it('applies the short-neighbour clamp', () => {
    const shortA = clip('a', 'compA', 0, 1);
    const nextB = { ...b, startTime: 1 };
    expect(showTransitionWindow([shortA, nextB], nextB)!.duration).toBe(1);
  });

  it('returns null for a cut clip no matter where the playhead is', () => {
    expect(resolveShowTransition(clips, a, 0)).toBeNull();
    expect(resolveShowTransition(clips, a, 5)).toBeNull();
  });

  it('returns null when the clip asks for a zero-length transition', () => {
    const zero = fadeClip('z', 'compZ', 10, 10, 0);
    expect(resolveShowTransition([a, zero], zero, 10)).toBeNull();
  });

  it('returns null when both sides are the SAME composition', () => {
    // Doubling the scene's layer count to crossfade a picture into itself is
    // pure cost with no visual.
    const same = fadeClip('b', 'compA', 10, 10, 4);
    expect(resolveShowTransition([a, same], same, 10)).toBeNull();
  });

  it('resolveShowTransitionAt finds the one in flight, and nothing in a gap', () => {
    expect(resolveShowTransitionAt(clips, 10)?.clipId).toBe('b');
    expect(resolveShowTransitionAt(clips, 5)).toBeNull();
  });
});

describe('creating and removing a transition at a junction', () => {
  function twoTouchingClips() {
    presetTransition.patch({ enabled: false, style: 'dissolve', duration: 2 });
    const aId = showTimeline.addPresetClip('compA', 10);
    const bId = showTimeline.addPresetClip('compB', 10);
    showTimeline.setSnapEnabled(false);
    return { aId, bId };
  }

  it('creates one at a real junction and it lands centred on the boundary', () => {
    const { bId } = twoTouchingClips();
    expect(showTimeline.addTransitionAt(bId, 'dissolve', 3)).toBe(true);
    const s = get(showTimeline);
    const win = showTransitionWindow(s.presetClips, s.presetClips.find((c) => c.id === bId)!)!;
    expect(win.duration).toBe(3);
    expect(win.start).toBe(8.5);
    expect(win.end).toBe(11.5);
    // Creating it also selects it, so the inspector opens on the new object.
    expect(s.selection).toEqual({ kind: 'transition', id: bId });
  });

  it('refuses on the first clip and across a gap — a transition needs two clips', () => {
    const { aId } = twoTouchingClips();
    expect(showTimeline.addTransitionAt(aId)).toBe(false);
    const farId = showTimeline.insertPresetClipAt('compC', 40, 10)!;
    expect(showTimeline.addTransitionAt(farId)).toBe(false);
  });

  it('clamps a requested length to the shorter neighbour at creation time', () => {
    presetTransition.patch({ enabled: false, style: 'dissolve', duration: 2 });
    showTimeline.addPresetClip('compA', 2);
    const bId = showTimeline.addPresetClip('compB', 30);
    expect(showTimeline.addTransitionAt(bId, 'dissolve', 25)).toBe(true);
    expect(get(showTimeline).presetClips.find((c) => c.id === bId)!.transitionDuration).toBe(2);
  });

  it('removing one restores a hard cut without touching the clip', () => {
    const { bId } = twoTouchingClips();
    showTimeline.addTransitionAt(bId, 'dissolve', 3);
    showTimeline.removeTransitionAt(bId);
    const s = get(showTimeline);
    const b = s.presetClips.find((c) => c.id === bId)!;
    expect(b.transitionIn).toBe('cut');
    expect(b.startTime).toBe(10);
    expect(b.duration).toBe(10);
    expect(showTransitionWindow(s.presetClips, b)).toBeNull();
    expect(resolveShowTransitionAt(s.presetClips, 10)).toBeNull();
    expect(s.selection).toBeNull();
  });

  it('setTransitionStyle swaps the type in place', () => {
    const { bId } = twoTouchingClips();
    showTimeline.addTransitionAt(bId, 'dissolve', 3);
    showTimeline.setTransitionStyle(bId, 'dipToBlack');
    const s = get(showTimeline);
    expect(showTransitionWindow(s.presetClips, s.presetClips.find((c) => c.id === bId)!)!.style)
      .toBe('dipToBlack');
  });

  it('a transition evaporates when its junction stops being one', () => {
    const { aId, bId } = twoTouchingClips();
    showTimeline.addTransitionAt(bId, 'dissolve', 3);
    // Shrink A so the two clips no longer touch.
    showTimeline.resizePresetClip(aId, 'end', 6);
    const s = get(showTimeline);
    expect(showTransitionWindow(s.presetClips, s.presetClips.find((c) => c.id === bId)!)).toBeNull();
  });
});

describe('transition wiring through seek()', () => {
  /** Two back-to-back clips with a `secs` transition on their junction. */
  function twoClips(secs: number, style: ClipTransitionIn = 'dissolve') {
    const aId = showTimeline.addPresetClip('compA', 10);
    const bId = showTimeline.addPresetClip('compB', 10);
    showTimeline.updatePresetClip(bId, { transitionIn: style, transitionDuration: secs });
    showTimeline.updatePresetClip(aId, { transitionIn: 'cut' });
    return { aId, bId };
  }

  it('opens the blend BEFORE the boundary and swaps the composition ON it', () => {
    const events = spyRenderer();
    twoClips(4); // window [8, 12), boundary at 10

    showTimeline.seek(1);   // deep inside A — nothing blending
    showTimeline.seek(8);   // the window opens; A is still the live clip
    showTimeline.seek(10);  // the boundary: composition swap
    showTimeline.seek(12);  // the window closes

    expect(events).toEqual([
      { kind: 'load', compositionId: 'compA', restoreTransports: true },
      { kind: 'transition', transition: { style: 'dissolve', progress: 0, fromCompositionId: 'compA', toCompositionId: 'compB' } },
      { kind: 'load', compositionId: 'compB', restoreTransports: true },
      { kind: 'transition', transition: { style: 'dissolve', progress: 0.5, fromCompositionId: 'compA', toCompositionId: 'compB' } },
      { kind: 'transition', transition: null },
    ]);
  });

  it('loads the composition exactly once across the whole window', () => {
    const events = spyRenderer();
    twoClips(2);
    for (let frame = 0; frame < 60 * 20; frame++) showTimeline.seek(frame / 60);
    expect(events.filter((e) => e.kind === 'load')).toHaveLength(2);
  });

  it('publishes a moving progress for every frame inside the window', () => {
    const events = spyRenderer();
    twoClips(4);
    for (let frame = 0; frame < 60 * 15; frame++) showTimeline.seek(frame / 60);
    const inside = transitionsOf(events).filter((t): t is ActiveCompositionTransition => t !== null);
    // 4s at 60fps — every frame of the window is its own resolved state.
    expect(inside.length).toBeGreaterThan(200);
    expect(inside[0].progress).toBeCloseTo(0, 2);
    expect(inside[inside.length - 1].progress).toBeGreaterThan(0.99);
    // Monotonic: never jumps backwards while the playhead runs forwards.
    for (let i = 1; i < inside.length; i++) {
      expect(inside[i].progress).toBeGreaterThanOrEqual(inside[i - 1].progress);
    }
    // …and it ends cleanly rather than sticking at 0.99.
    expect(transitionsOf(events).at(-1)).toBeNull();
  });

  it('honours a per-clip style override', () => {
    const events = spyRenderer();
    twoClips(3, 'additive');
    showTimeline.seek(1);
    showTimeline.seek(10);
    expect(transitionsOf(events).some((t) => t?.style === 'additive')).toBe(true);
  });

  it('cuts — loads with no transition — when the junction says cut', () => {
    const events = spyRenderer();
    twoClips(4, 'cut');
    showTimeline.seek(1);
    showTimeline.seek(10);
    expect(transitionsOf(events).some((t) => t !== null)).toBe(false);
    expect(events.filter((e) => e.kind === 'load')).toHaveLength(2);
  });

  it('hard-cuts a cold seek that lands PAST the transition window', () => {
    const events = spyRenderer();
    twoClips(2); // window [9, 11)
    showTimeline.seek(15);
    expect(events).toEqual([{ kind: 'load', compositionId: 'compB', restoreTransports: true }]);
  });

  it('resolves a cold seek INTO a transition to the same state every time', () => {
    // THE determinism guarantee. A seek straight into the middle of a
    // transition — no playback, no prior state, nothing running — must land
    // fully resolved, and land the same way twice.
    const runs: unknown[][] = [];
    for (let run = 0; run < 2; run++) {
      showTimeline._resetForTest();
      const events = spyRenderer();
      twoClips(4); // window [8, 12)
      showTimeline.seek(9); // 25% in
      runs.push([...events]);
    }
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]).toEqual([
      { kind: 'load', compositionId: 'compA', restoreTransports: true },
      { kind: 'transition', transition: { style: 'dissolve', progress: 0.25, fromCompositionId: 'compA', toCompositionId: 'compB' } },
    ]);
  });

  it('a cold seek matches what playing to the same instant produces', () => {
    // Same time, two completely different routes to it.
    showTimeline._resetForTest();
    const cold = spyRenderer();
    twoClips(4);
    showTimeline.seek(11);
    const coldState = transitionsOf(cold).at(-1);

    showTimeline._resetForTest();
    const played = spyRenderer();
    twoClips(4);
    for (let frame = 0; frame <= 60 * 11; frame++) showTimeline.seek(frame / 60);
    const playedState = transitionsOf(played).at(-1);

    expect(coldState).toEqual(playedState);
    expect(coldState).toEqual({
      style: 'dissolve', progress: 0.75, fromCompositionId: 'compA', toCompositionId: 'compB',
    });
  });

  it('scrubbing BACKWARDS through a window resolves the same states', () => {
    const forward: (number | null)[] = [];
    const backward: (number | null)[] = [];
    const times = [8, 8.5, 9, 9.5, 10, 10.5, 11, 11.5];

    showTimeline._resetForTest();
    let events = spyRenderer();
    twoClips(4);
    for (const t of times) {
      showTimeline.seek(t);
      forward.push(transitionsOf(events).at(-1)?.progress ?? null);
    }

    showTimeline._resetForTest();
    events = spyRenderer();
    twoClips(4);
    for (const t of [...times].reverse()) {
      showTimeline.seek(t);
      backward.push(transitionsOf(events).at(-1)?.progress ?? null);
    }
    expect(backward.reverse()).toEqual(forward);
  });

  it('stopping mid-blend drops the transition instead of leaving it resident', () => {
    const events = spyRenderer();
    twoClips(4);
    showTimeline.seek(10);
    expect(transitionsOf(events).at(-1)).not.toBeNull();
    showTimeline.stop();
    expect(transitionsOf(events).at(-1)).toBeNull();
  });

  it('clamps against a short outgoing clip so transitions cannot stack', () => {
    showTimeline.addPresetClip('compA', 0.5); // [0, 0.5)
    const bId = showTimeline.addPresetClip('compB', 10); // [0.5, 10.5)
    showTimeline.updatePresetClip(bId, { transitionIn: 'dissolve', transitionDuration: 5 });
    const clips = get(showTimeline).presetClips;
    // 5s requested, but A only lasts 0.5s — the window may not reach past it.
    const win = showTransitionWindow(clips, clips.find((c) => c.id === bId)!)!;
    expect(win.duration).toBe(0.5);
    expect(win.start).toBe(0.25);
  });

  it('runs under a manual clock too — the offline render gets the blend', () => {
    // The offline renderer owns the clock and calls seek() per virtual frame.
    // The OLD seam started a wall-clock animation, which could not be
    // reproduced from one export run to the next, so it was skipped entirely
    // and exports hard-cut. Progress is now resolved per evaluation, so the
    // virtual clock gets exactly the same answer as the live one.
    const manual = vi.spyOn(visualAudio, 'isVisualAudioManualClock').mockReturnValue(true);
    const events = spyRenderer();
    twoClips(4);
    showTimeline.seek(1);
    showTimeline.seek(9);
    expect(transitionsOf(events).at(-1)).toEqual({
      style: 'dissolve', progress: 0.25, fromCompositionId: 'compA', toCompositionId: 'compB',
    });
    // Sub-transport restore is still suppressed — the render loop owns them.
    expect(events.filter((e) => e.kind === 'load')).toEqual([
      { kind: 'load', compositionId: 'compA', restoreTransports: false },
    ]);
    manual.mockRestore();
  });

  it('still loads when no transition sink is registered (headless)', () => {
    const calls = spyLoader(); // loader only — no sink
    const aId = showTimeline.addPresetClip('compA', 10);
    const bId = showTimeline.addPresetClip('compB', 10);
    showTimeline.updatePresetClip(aId, { transitionIn: 'cut' });
    showTimeline.updatePresetClip(bId, { transitionIn: 'dissolve', transitionDuration: 4 });
    expect(() => {
      showTimeline.seek(1);
      showTimeline.seek(10);
    }).not.toThrow();
    expect(calls.map((c) => c.compositionId)).toEqual(['compA', 'compB']);
  });
});

describe('preset-player inheritance', () => {
  it('gives a new clip whatever the preset tray is set to', () => {
    presetTransition.patch({ enabled: true, style: 'dipToBlack', duration: 3 });
    expect(defaultClipTransition()).toEqual({ transitionIn: 'dipToBlack', transitionDuration: 3 });

    const id = showTimeline.addPresetClip('compA', 30);
    const added = get(showTimeline).presetClips.find((c) => c.id === id)!;
    expect(added.transitionIn).toBe('dipToBlack');
    expect(added.transitionDuration).toBe(3);
  });

  it('gives a DROPPED clip the same inheritance', () => {
    presetTransition.patch({ enabled: true, style: 'additive', duration: 1.5 });
    const id = showTimeline.insertPresetClipAt('compA', 12, 10)!;
    const added = get(showTimeline).presetClips.find((c) => c.id === id)!;
    expect(added.transitionIn).toBe('additive');
    expect(added.transitionDuration).toBe(1.5);
  });

  it('creates cut clips while the tray transition toggle is off', () => {
    presetTransition.patch({ enabled: false, style: 'dissolve', duration: 3 });
    const id = showTimeline.addPresetClip('compA', 30);
    expect(get(showTimeline).presetClips.find((c) => c.id === id)!.transitionIn).toBe('cut');
  });

  it('round-trips a clip transition through serialize / hydrate', () => {
    const id = showTimeline.addPresetClip('compA', 30);
    showTimeline.updatePresetClip(id, { transitionIn: 'additive', transitionDuration: 1.25 });
    const snapshot = showTimeline.serialize();
    showTimeline._resetForTest();
    showTimeline.hydrate(snapshot);
    const restored = get(showTimeline).presetClips[0];
    expect(restored.transitionIn).toBe('additive');
    expect(restored.transitionDuration).toBe(1.25);
  });

  it('inherits for a clip that predates the feature, and keeps an explicit cut', () => {
    presetTransition.patch({ enabled: true, style: 'dipToBlack', duration: 2.5 });
    showTimeline.hydrate({
      version: 1,
      audioTracks: [],
      presetClips: [
        { id: 'old', compositionId: 'c1', startTime: 0, duration: 10 },              // no field at all
        { id: 'cut', compositionId: 'c2', startTime: 10, duration: 10, transitionIn: 'cut' },
        { id: 'junk', compositionId: 'c3', startTime: 20, duration: 10, transitionIn: 'nonsense' },
      ],
    });
    const clips = get(showTimeline).presetClips;
    expect(clips.find((c) => c.id === 'old')!.transitionIn).toBe('dipToBlack');
    expect(clips.find((c) => c.id === 'old')!.transitionDuration).toBe(2.5);
    expect(clips.find((c) => c.id === 'cut')!.transitionIn).toBe('cut');
    // Junk falls back rather than silently cutting.
    expect(clips.find((c) => c.id === 'junk')!.transitionIn).toBe('dipToBlack');
  });

  it('keeps a legacy WebGL style name as a real blend, normalized to dissolve', () => {
    // A show saved before NATIVE_ENGINE_ONLY could name any of the eleven
    // engine.ts shaders. Those never ran, but the user DID ask for a blend
    // there — so it stays one rather than inheriting or hard-cutting.
    presetTransition.patch({ enabled: true, style: 'additive', duration: 2 });
    showTimeline.hydrate({
      version: 1,
      audioTracks: [],
      presetClips: [
        { id: 'a', compositionId: 'c1', startTime: 0, duration: 10, transitionIn: 'cut' },
        { id: 'b', compositionId: 'c2', startTime: 10, duration: 10, transitionIn: 'pixelMelt', transitionDuration: 3 },
      ],
    });
    const clips = get(showTimeline).presetClips;
    expect(clips.find((c) => c.id === 'b')!.transitionIn).toBe('dissolve');
    expect(showTransitionWindow(clips, clips.find((c) => c.id === 'b')!)).toEqual(
      expect.objectContaining({ style: 'dissolve', duration: 3, start: 8.5, end: 11.5 }),
    );
  });
});
