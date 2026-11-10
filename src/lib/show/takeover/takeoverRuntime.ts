/**
 * The live side of the takeover, installed once by App.svelte:
 *
 * - wires the takeover store to the show (time, tempo map, markers, pause
 *   and resume, chasing) and to the launch clock;
 * - evaluates it whenever the show is evaluated (a release waiting for a bar
 *   on the tempo map starts on the frame the bar falls in) and on animation
 *   frames while a fade or a wall-clock release is running;
 * - publishes `takeoverFrame` for Canvas and keeps the VJ feeds running
 *   (`vjClipLauncher.setTakeoverLive`) while anything samples them;
 * - a test and automation surface (`__ghostArcade.takeover`).
 */
import { get } from 'svelte/store';
import type { ShowLayerTrack } from '../../types';
import { showTimeline, onShowTimelineReset } from '../../stores/showTimeline';
import { vjClipLauncher } from '../../stores/vjClipLauncher';
import { nextLaunchBoundary } from '../../stores/launchClock';
import { takeoverFrame, takeoverMediaSources } from '../../stores/takeoverFrame';
import { cueList } from '../cueList';
import {
  liveTakeover,
  takeoverAnimating,
  takeoverFrameSignature,
  takeoverSummary,
  type ReleaseSpec,
  type TakeoverEvaluation,
  type TakeoverSource,
} from './liveTakeover';

// ── Tracks and sources ──────────────────────────────────────────────────

export function trackAt(index: number): ShowLayerTrack | null {
  return get(showTimeline).layerTracks[index] ?? null;
}

export function trackById(trackId: string): ShowLayerTrack | null {
  return get(showTimeline).layerTracks.find((t) => t.id === trackId) ?? null;
}

/** Take a show track over. */
export function takeOverTrack(track: ShowLayerTrack, source: TakeoverSource | null, opts: { inputId?: string; momentary?: boolean; fadeIn?: number } = {}): boolean {
  return liveTakeover.engage(track.layerId, source, { ...opts, trackId: track.id });
}

/** Hand a show track back (with the takeover's release setting unless given). */
export function returnTrack(track: ShowLayerTrack, spec?: Partial<ReleaseSpec>): number {
  return liveTakeover.release(track.layerId, spec);
}

// ── Install ─────────────────────────────────────────────────────────────

export function installTakeoverRuntime(): () => void {
  const disposers: Array<() => void> = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  liveTakeover.configure({
    now,
    show: () => {
      const s = get(showTimeline);
      return { showTime: s.currentTime, playing: s.isPlaying, tempo: s.tempo, markers: cueList.state.markers.map((m) => m.time) };
    },
    chasing: () => showTimeline.isChasing(),
    pauseShow: () => showTimeline.pause(),
    playShow: () => showTimeline.play(),
    launchBoundary: (gridBeats, nowMs) => nextLaunchBoundary(gridBeats, nowMs),
  });

  // ── Evaluate and publish ─────────────────────────────────────────────
  let lastSignature: string | null = null;
  let busy = false;
  let raf: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const publish = (ev: TakeoverEvaluation) => {
    const frame = ev.frame.surfaces.length || ev.frame.overlay ? ev.frame : null;
    const signature = frame ? takeoverFrameSignature(frame) : null;
    // The feeds first, so the launcher's layers exist when the scene builds.
    vjClipLauncher.setTakeoverLive(!!frame?.needsVjFeeds);
    if (signature === lastSignature) return;
    lastSignature = signature;
    takeoverMediaSources.retain(new Set((frame?.surfaces ?? []).map((s) => s.key)));
    takeoverFrame.set(frame);
  };

  const step = () => {
    if (busy) return;
    busy = true;
    try {
      publish(liveTakeover.tick(now()));
    } catch (err) {
      console.warn('[Takeover] evaluation failed:', err);
    } finally {
      busy = false;
    }
    schedule();
  };

  const schedule = () => {
    if (raf !== null || timer !== null) return;
    if (!takeoverAnimating(liveTakeover.state)) return;
    const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
    if (!hidden && typeof requestAnimationFrame === 'function') {
      raf = requestAnimationFrame(() => { raf = null; step(); });
    } else {
      timer = setTimeout(() => { timer = null; step(); }, 16);
    }
  };

  // Any change to the takeover (engage, release, overlay…).
  disposers.push(liveTakeover.subscribe(() => step()));
  // Every evaluation of the show (inside applyTime: frame-exact boundaries).
  disposers.push(showTimeline.subscribe(() => {
    if (Object.keys(liveTakeover.state.surfaces).length) step();
  }));
  disposers.push(() => {
    if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    raf = null;
    timer = null;
  });

  // A cleared show or another project: the old takeover is over.
  disposers.push(onShowTimelineReset(() => liveTakeover.reset()));

  // ── Automation / test surface ────────────────────────────────────────
  try {
    const w = window as unknown as { __ghostArcade?: Record<string, unknown> };
    w.__ghostArcade = {
      ...(w.__ghostArcade ?? {}),
      takeover: {
        store: liveTakeover,
        summary: () => takeoverSummary(liveTakeover.state),
        frame: () => get(takeoverFrame),
        takeOverTrack: (trackId: string, source: TakeoverSource, opts?: { fadeIn?: number }) => {
          const track = trackById(trackId);
          return track ? takeOverTrack(track, source, opts) : false;
        },
        returnTrack: (trackId: string, spec?: Partial<ReleaseSpec>) => {
          const track = trackById(trackId);
          return track ? returnTrack(track, spec) : 0;
        },
      },
    };
  } catch { /* sealed */ }

  return () => {
    for (const dispose of disposers.splice(0).reverse()) {
      try { dispose(); } catch { /* best effort */ }
    }
    liveTakeover.reset();
    vjClipLauncher.setTakeoverLive(false);
    takeoverFrame.set(null);
  };
}
