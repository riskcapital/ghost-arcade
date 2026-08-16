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
  setShowTransitionStarter,
  findActiveShowClip,
  computeShowDuration,
  snapShowTime,
  placeOnLane,
  maxDurationAt,
  clampShowTransitionDuration,
  findPrecedingShowClip,
  resolveShowTransition,
  resolveTransitionStyle,
  defaultClipTransition,
  SHOW_SNAP_SECONDS,
} from './showTimeline';
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
 * Install BOTH seams onto one ordered log, so a test can assert not just
 * that the transition fired but that it fired BEFORE the load — the engine
 * has to snapshot the outgoing composite while it is still on screen.
 */
function spyRenderer() {
  const events: Array<
    | { kind: 'transition'; style: string; durationSeconds: number }
    | { kind: 'load'; compositionId: string; restoreTransports: boolean }
  > = [];
  setShowTransitionStarter((durationSeconds, style) => {
    events.push({ kind: 'transition', style, durationSeconds });
  });
  setShowCompositionLoader((compositionId, options) => {
    events.push({ kind: 'load', compositionId, restoreTransports: options.restoreTransports });
  });
  return events;
}

beforeEach(() => {
  showTimeline._resetForTest();
  presetTransition._resetForTest();
});

afterEach(() => {
  setShowCompositionLoader(null);
  setShowTransitionStarter(null);
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

// ── Clip transitions ─────────────────────────────────────────────────────
//
// Semantics under test: START-AT. A clip's transition runs forward over
// [startTime, startTime + effectiveDuration) — it BEGINS at the boundary
// rather than completing there. See the "Clip transitions" block in
// showTimeline.ts for why the mechanism forces that choice.

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

  it('passes an engine style straight through', () => {
    expect(resolveTransitionStyle('wave')).toBe('wave');
    expect(resolveTransitionStyle('pixelMelt')).toBe('pixelMelt');
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
    // A 5s dissolve out of a 0.5s clip would still be running two clips
    // later — this is the clamp that stops transitions stacking.
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

describe('findPrecedingShowClip', () => {
  const a = clip('a', 'compA', 0, 10);
  const b = clip('b', 'compB', 10, 10);
  const c = clip('c', 'compC', 40, 10); // after a gap

  it('finds the clip butted up against this one', () => {
    expect(findPrecedingShowClip([a, b, c], b)?.id).toBe('a');
  });

  it('reaches back across a gap — that composition is still on screen', () => {
    expect(findPrecedingShowClip([a, b, c], c)?.id).toBe('b');
  });

  it('returns null for the first clip in the show', () => {
    expect(findPrecedingShowClip([a, b, c], a)).toBeNull();
  });
});

describe('resolveShowTransition', () => {
  // A: [0,10)  B: [10,20) with a 4s dissolve in.
  const a = clip('a', 'compA', 0, 10);
  const b = fadeClip('b', 'compB', 10, 10, 4);
  const clips = [a, b];

  it('gives the FULL window when the boundary is hit exactly', () => {
    const plan = resolveShowTransition(clips, b, 10);
    expect(plan).toEqual({ style: 'dissolve', durationSeconds: 4 });
  });

  it('gives only the REMAINDER for a cold seek into the middle of one', () => {
    // Landing at 11.5 with a window of [10, 14): 2.5s still to run, so the
    // blend still finishes at show time 14 exactly as it would have live.
    expect(resolveShowTransition(clips, b, 11.5)?.durationSeconds).toBeCloseTo(2.5, 9);
    expect(resolveShowTransition(clips, b, 13.9)?.durationSeconds).toBeCloseTo(0.1, 9);
  });

  it('is a pure function of (clips, clip, time) — two cold seeks agree', () => {
    const first = resolveShowTransition(clips, b, 12.25);
    const second = resolveShowTransition(clips, b, 12.25);
    expect(first).toEqual(second);
    expect(first?.durationSeconds).toBeCloseTo(1.75, 9);
  });

  it('hard-cuts once the window has already closed', () => {
    expect(resolveShowTransition(clips, b, 14)).toBeNull();
    expect(resolveShowTransition(clips, b, 18)).toBeNull();
  });

  it('never exceeds the window when time runs ahead of the clip start', () => {
    // A loop wrap can evaluate a clip at a time before its own start.
    expect(resolveShowTransition(clips, b, 9)?.durationSeconds).toBe(4);
  });

  it('applies the short-neighbour clamp', () => {
    const shortA = clip('a', 'compA', 0, 1);
    const plan = resolveShowTransition([shortA, { ...b, startTime: 1 }], { ...b, startTime: 1 }, 1);
    expect(plan?.durationSeconds).toBe(1);
  });

  it('returns null for a cut clip no matter where the playhead is', () => {
    expect(resolveShowTransition(clips, a, 0)).toBeNull();
    expect(resolveShowTransition(clips, a, 5)).toBeNull();
  });

  it('returns null when the clip asks for a zero-length transition', () => {
    const zero = fadeClip('z', 'compZ', 10, 10, 0);
    expect(resolveShowTransition([a, zero], zero, 10)).toBeNull();
  });
});

describe('transition wiring through seek()', () => {
  /** Two back-to-back clips, B carrying a `secs` dissolve. */
  function twoClips(secs: number, style: ClipTransitionIn = 'dissolve') {
    const aId = showTimeline.addPresetClip('compA', 10);
    const bId = showTimeline.addPresetClip('compB', 10);
    showTimeline.updatePresetClip(bId, { transitionIn: style, transitionDuration: secs });
    showTimeline.updatePresetClip(aId, { transitionIn: 'cut' });
    return { aId, bId };
  }

  it('fires the transition exactly once, immediately BEFORE the load', () => {
    const events = spyRenderer();
    twoClips(4);

    showTimeline.seek(1);   // into A — cut, load only
    showTimeline.seek(10);  // the boundary
    showTimeline.seek(11);  // still inside B, nothing new

    expect(events).toEqual([
      { kind: 'load', compositionId: 'compA', restoreTransports: true },
      { kind: 'transition', style: 'dissolve', durationSeconds: 4 },
      { kind: 'load', compositionId: 'compB', restoreTransports: true },
    ]);
  });

  it('does not fire once per frame across the boundary', () => {
    const events = spyRenderer();
    twoClips(2);
    for (let frame = 0; frame < 60 * 20; frame++) showTimeline.seek(frame / 60);
    expect(events.filter((e) => e.kind === 'transition')).toHaveLength(1);
  });

  it('honours a per-clip style override', () => {
    const events = spyRenderer();
    twoClips(3, 'pixelMelt');
    showTimeline.seek(1);
    showTimeline.seek(10);
    expect(events).toContainEqual({ kind: 'transition', style: 'pixelMelt', durationSeconds: 3 });
  });

  it('cuts — loads with no transition — when the clip says cut', () => {
    const events = spyRenderer();
    twoClips(4, 'cut');
    showTimeline.seek(1);
    showTimeline.seek(10);
    expect(events.some((e) => e.kind === 'transition')).toBe(false);
    expect(events.filter((e) => e.kind === 'load')).toHaveLength(2);
  });

  it('hard-cuts a cold seek that lands PAST the transition window', () => {
    const events = spyRenderer();
    twoClips(2);
    showTimeline.seek(15); // window was [10, 12) — long gone
    expect(events).toEqual([{ kind: 'load', compositionId: 'compB', restoreTransports: true }]);
  });

  it('resolves a cold seek INTO a transition to the same state every time', () => {
    const runs: unknown[][] = [];
    for (let run = 0; run < 2; run++) {
      showTimeline._resetForTest();
      const events = spyRenderer();
      twoClips(4);
      showTimeline.seek(11.5); // straight in, no playback, no prior clip
      runs.push([...events]);
    }
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0][0]).toEqual({ kind: 'transition', style: 'dissolve', durationSeconds: 2.5 });
    expect(runs[0][1]).toEqual({ kind: 'load', compositionId: 'compB', restoreTransports: true });
  });

  it('clamps against a short outgoing clip so transitions cannot stack', () => {
    const events = spyRenderer();
    showTimeline.addPresetClip('compA', 0.5); // [0, 0.5)
    const bId = showTimeline.addPresetClip('compB', 10); // [0.5, 10.5)
    showTimeline.updatePresetClip(bId, { transitionIn: 'dissolve', transitionDuration: 5 });
    showTimeline.seek(0.1);
    showTimeline.seek(0.5);
    // 5s requested, but A only lasts 0.5s — the blend may not outlive it.
    expect(events).toContainEqual({ kind: 'transition', style: 'dissolve', durationSeconds: 0.5 });
  });

  it('hard-cuts under a manual clock, but still loads the composition', () => {
    // The offline renderer owns the clock and calls seek() per virtual frame.
    // engine.startTransition blends off performance.now(), so a transition
    // there would render differently on every run of the same export.
    const manual = vi.spyOn(visualAudio, 'isVisualAudioManualClock').mockReturnValue(true);
    const events = spyRenderer();
    twoClips(4);
    showTimeline.seek(1);
    showTimeline.seek(10);
    expect(events.some((e) => e.kind === 'transition')).toBe(false);
    expect(events).toEqual([
      { kind: 'load', compositionId: 'compA', restoreTransports: false },
      { kind: 'load', compositionId: 'compB', restoreTransports: false },
    ]);
    manual.mockRestore();
  });

  it('still loads when no transition starter is registered (native / headless)', () => {
    const calls = spyLoader(); // loader only — no starter
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
    presetTransition.patch({ enabled: true, style: 'wave', duration: 3 });
    expect(defaultClipTransition()).toEqual({ transitionIn: 'wave', transitionDuration: 3 });

    const id = showTimeline.addPresetClip('compA', 30);
    const added = get(showTimeline).presetClips.find((c) => c.id === id)!;
    expect(added.transitionIn).toBe('wave');
    expect(added.transitionDuration).toBe(3);
  });

  it('gives a DROPPED clip the same inheritance', () => {
    presetTransition.patch({ enabled: true, style: 'iris', duration: 1.5 });
    const id = showTimeline.insertPresetClipAt('compA', 12, 10)!;
    const added = get(showTimeline).presetClips.find((c) => c.id === id)!;
    expect(added.transitionIn).toBe('iris');
    expect(added.transitionDuration).toBe(1.5);
  });

  it('creates cut clips while the tray transition toggle is off', () => {
    presetTransition.patch({ enabled: false, style: 'wave', duration: 3 });
    const id = showTimeline.addPresetClip('compA', 30);
    expect(get(showTimeline).presetClips.find((c) => c.id === id)!.transitionIn).toBe('cut');
  });

  it('round-trips a clip transition through serialize / hydrate', () => {
    const id = showTimeline.addPresetClip('compA', 30);
    showTimeline.updatePresetClip(id, { transitionIn: 'explode', transitionDuration: 1.25 });
    const snapshot = showTimeline.serialize();
    showTimeline._resetForTest();
    showTimeline.hydrate(snapshot);
    const restored = get(showTimeline).presetClips[0];
    expect(restored.transitionIn).toBe('explode');
    expect(restored.transitionDuration).toBe(1.25);
  });

  it('inherits for a clip that predates the feature, and keeps an explicit cut', () => {
    presetTransition.patch({ enabled: true, style: 'warp', duration: 2.5 });
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
    expect(clips.find((c) => c.id === 'old')!.transitionIn).toBe('warp');
    expect(clips.find((c) => c.id === 'old')!.transitionDuration).toBe(2.5);
    expect(clips.find((c) => c.id === 'cut')!.transitionIn).toBe('cut');
    // Junk falls back rather than silently cutting.
    expect(clips.find((c) => c.id === 'junk')!.transitionIn).toBe('warp');
  });
});
