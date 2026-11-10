/**
 * The evaluation looks up runs, run starts and junction predecessors from
 * an index built once per clip list. Cached answers must be the answers a
 * fresh list gives, an edit (a new clip list) must be seen at once, and a
 * frame must not walk every clip of every track any more.
 */
import { describe, expect, it } from 'vitest';
import type { ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../types';
import { clipRuns, evaluateShowTracks, trackTransitionWindow, cachedClipRuns } from './showTrackEval';
import { findJunctionPredecessor } from '../showJunctions';
import { selectShowPreloads } from './showPreloader';

const video = (file: string): ShowClipMedia => ({ kind: 'video', name: file, src: `ghost-asset://localhost/${file}`, sourceDuration: 1000 });

/** Clips of 4 s: every third continues the one before (a split), every third dissolves in. */
function clips(trackNo: number, count: number): ShowLayerClip[] {
  return Array.from({ length: count }, (_, k) => {
    const split = k % 3 === 1;
    return {
      id: `t${trackNo}c${k}`, startTime: k * 4, duration: 4, inPoint: split ? 4 : 0, ...(split ? { loopStart: 0 } : {}), endBehaviour: 'loop', fadeIn: 0, fadeOut: 0,
      media: k % 5 === 4 ? { kind: 'image', name: 'i', src: `img${k}.png` } : video(`v${trackNo}_${split ? k - 1 : k}.mp4`),
      ...(k % 3 === 2 ? { transitionIn: 'dissolve' as const, transitionDuration: 1 } : {}),
    };
  });
}

function track(n: number, list: ShowLayerClip[]): ShowLayerTrack {
  return { id: `tr${n}`, layerId: `L${n}`, layerName: `L${n}`, template: null, clips: list, lanes: [], gap: 'layer', muted: false, locked: false, collapsed: false };
}

const fresh = (tracks: ShowLayerTrack[]) => tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c })) }));
const opts = { playing: true, seekGeneration: 1 };

/** The preloader as it was: runs worked out on every call, a walk from the first clip. */
function referencePreloads(tracks: ShowLayerTrack[], t: number) {
  const picks: Array<{ trackId: string; clipId: string; runId: string; startsIn: number }> = [];
  for (const tr of tracks) {
    const runs = clipRuns(tr.clips);
    for (const clip of tr.clips) {
      const startsIn = clip.startTime - t;
      if (startsIn <= 0) continue;
      if (startsIn > 4) break;
      if (clip.media.kind !== 'video' && clip.media.kind !== 'image') continue;
      const runId = runs.get(clip.id) ?? clip.id;
      if (runId !== clip.id) continue;
      picks.push({ trackId: tr.id, clipId: clip.id, runId, startsIn });
    }
  }
  return picks.sort((a, b) => a.startsIn - b.startsIn).slice(0, 6);
}

describe('show track clip index', () => {
  it('gives the same frames as freshly built clip lists', () => {
    const tracks = Array.from({ length: 4 }, (_, n) => track(n, clips(n, 60)));
    for (let i = 0; i < 400; i++) {
      const t = (i * 0.613) % 240;
      expect(evaluateShowTracks(tracks, t, opts)).toEqual(evaluateShowTracks(fresh(tracks), t, opts));
    }
  });

  it('finds the same junction predecessor as a full scan', () => {
    const list = clips(0, 90);
    for (const c of list) {
      const w = trackTransitionWindow(list, c);
      if (c.transitionIn === 'dissolve') expect(w?.prev ?? null).toBe(findJunctionPredecessor(list, c));
      else expect(w).toBeNull();
    }
  });

  it('sees an edit at once (a new clip list)', () => {
    const list = clips(0, 6);
    const before = evaluateShowTracks([track(0, list)], 5, opts).tracks[0].clip!;
    expect(before.runId).toBe('t0c0');
    // Move the split half away: it no longer continues the run.
    const edited = list.map((c) => (c.id === 't0c1' ? { ...c, inPoint: 30 } : c));
    const after = evaluateShowTracks([track(0, edited)], 5, opts).tracks[0].clip!;
    expect(after.runId).toBe('t0c1');
    expect(after.runStart).toBe(4);
    expect(cachedClipRuns(edited).get('t0c1')).toBe('t0c1');
    expect(cachedClipRuns(list).get('t0c1')).toBe('t0c0');
  });

  it('reads only a few clips per frame once the index is built', () => {
    let reads = 0;
    const counted = (list: ShowLayerClip[]) => new Proxy(list, {
      get(target, key, receiver) {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver);
      },
    });
    const tracks = Array.from({ length: 20 }, (_, n) => track(n, counted(clips(n, 500))));
    evaluateShowTracks(tracks, 1000.5, opts); // builds the index
    reads = 0;
    const frames = 100;
    for (let i = 0; i < frames; i++) evaluateShowTracks(tracks, 1000 + i * 0.37, opts);
    // Binary searches only: ~3 × log2(500) per track per frame, not a scan.
    expect(reads / frames / 20).toBeLessThan(60);
  });

  it('preloads exactly what the per-call scan picked', () => {
    const tracks = Array.from({ length: 6 }, (_, n) => track(n, clips(n, 80)));
    for (let i = 0; i < 300; i++) {
      const t = (i * 1.37) % 330 - 2;
      const got = selectShowPreloads(tracks, t).map((p) => ({ trackId: p.trackId, clipId: p.clip.id, runId: p.runId, startsIn: p.startsIn }));
      expect(got).toEqual(referencePreloads(tracks, t));
    }
    expect(cachedClipRuns(tracks[0].clips)).toBe(cachedClipRuns(tracks[0].clips));
  });
});
