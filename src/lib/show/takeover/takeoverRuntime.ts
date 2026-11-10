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
 * - holds back the VJ and blackout actions of clock-fired cues while a
 *   takeover is live with marker policy 'hold', and runs them at the
 *   hand-back;
 * - carries out `show:live`, `show:release`… control paths and the
 *   takeover cue actions.
 */
import { get } from 'svelte/store';
import type { ShowLayerTrack } from '../../types';
import { showTimeline, onShowTimelineReset } from '../../stores/showTimeline';
import { numberedRows } from '../tracks/showStageRows';
import { vjClipLauncher, type VJTakeoverSample } from '../../stores/vjClipLauncher';
import { nextLaunchBoundary } from '../../stores/launchClock';
import { isVisualAudioManualClock } from '../../audio/visualAudio';
import { takeoverFrame, takeoverMediaSources } from '../../stores/takeoverFrame';
import { cueList, type CueAction, type CueFireSource } from '../cueList';
import type { ShowControlAction, ShowTakeoverSourceSpec } from '../../control/showControlPaths';
import {
  liveTakeover,
  takeoverAnimating,
  takeoverFrameSignature,
  takeoverSummary,
  type ReleaseSpec,
  type TakeoverEvaluation,
  type TakeoverFrame,
  type TakeoverReleaseMode,
  type TakeoverSource,
} from './liveTakeover';

/** Cue sources the clock fired: what marker policy 'hold' holds back. */
const CLOCK_FIRED: ReadonlySet<CueFireSource> = new Set(['marker', 'timecode', 'follow']);
/** Actions that would fight the VJ's live picture. */
const HELD_KINDS: ReadonlySet<CueAction['kind']> = new Set(['vjClip', 'vjColumn', 'vjStopAll', 'blackout']);

let deferred: CueAction[] = [];

/** Should this action of a firing cue wait for the hand-back? Pure. */
export function shouldHoldCueAction(
  action: CueAction,
  source: CueFireSource,
  policy: 'fire' | 'hold',
  takeoverActive: boolean,
): boolean {
  return policy === 'hold' && takeoverActive && CLOCK_FIRED.has(source) && HELD_KINDS.has(action.kind);
}

function takeoverActive(): boolean {
  return Object.keys(liveTakeover.state.surfaces).length > 0;
}

function runDeferred(): void {
  const actions = deferred;
  deferred = [];
  liveTakeover.setDeferredCount(0);
  if (actions.length) cueList.runActions(actions);
}

/** The VJ pictures a takeover frame shows (what leaving VJ mode must keep). Pure. */
export function takeoverVjSamples(frame: TakeoverFrame | null): VJTakeoverSample[] {
  if (!frame) return [];
  const out: VJTakeoverSample[] = [];
  const add = (source: TakeoverSource | null | undefined) => {
    if (source?.kind === 'vjRow') out.push({ kind: 'row', deck: source.deck, row: source.row });
    else if (source?.kind === 'vjMix') out.push({ kind: 'mix' });
    else if (source?.kind === 'vjGroup') out.push({ kind: 'group', groupId: source.groupId });
  };
  for (const surface of frame.surfaces) add(surface.source);
  add(frame.overlay?.source);
  return out;
}

// ── Tracks and sources ──────────────────────────────────────────────────

/** The row `show:live:<n>` names (0-based here): rows count as the show
 *  draws them, without the layers added on a piece (those go with it). */
export function trackAt(index: number): ShowLayerTrack | null {
  return numberedRows(get(showTimeline).layerTracks)[index] ?? null;
}

export function trackById(trackId: string): ShowLayerTrack | null {
  return get(showTimeline).layerTracks.find((t) => t.id === trackId) ?? null;
}

/** A path's source as a takeover source (groups by their 0-based index). */
export function sourceFromSpec(spec: ShowTakeoverSourceSpec): TakeoverSource | null {
  switch (spec.kind) {
    case 'vjRow': return { kind: 'vjRow', deck: spec.deck, row: spec.row };
    case 'vjMix': return { kind: 'vjMix' };
    case 'black': return { kind: 'black' };
    case 'vjGroup': {
      const group = get(vjClipLauncher).groups?.[spec.index];
      return group ? { kind: 'vjGroup', groupId: group.id, name: group.name } : null;
    }
  }
}

/** Take a show track over. */
export function takeOverTrack(track: ShowLayerTrack, source: TakeoverSource | null, opts: { inputId?: string; momentary?: boolean; fadeIn?: number } = {}): boolean {
  return liveTakeover.engage(track.layerId, source, { ...opts, trackId: track.id });
}

/** Hand a show track back (with the takeover's release setting unless given). */
export function returnTrack(track: ShowLayerTrack, spec?: Partial<ReleaseSpec>): number {
  return liveTakeover.release(track.layerId, spec);
}

// ── Inputs on show:live ─────────────────────────────────────────────────

/** Inputs whose last show:live value was on. A controller (MIDI, OSC, DMX…)
 *  sends a position or a release after every press, so only its edges act:
 *  a CC knob turned up takes over once instead of toggling on every step. */
const liveInputsDown = new Set<string>();

/** Does this input get edge detection? A path fired without an input of its
 *  own (a cue's value, MCP, a gesture trigger) may never send a 0, so every
 *  press of it acts. */
export function liveInputHasEdges(inputId: string): boolean {
  return !inputId.startsWith('path') && !inputId.startsWith('show:');
}

/** The momentary takeovers `inputId` holds let go, wherever their tracks are
 *  now (a track can be moved while it is held). */
function releaseHeldBy(inputId: string): void {
  for (const o of Object.values(liveTakeover.state.surfaces)) {
    if (o.momentaryInputs.includes(inputId)) liveTakeover.releaseInput(o.surfaceId, inputId);
  }
}

/** Every input under `prefix` lets go (a controller was unplugged). */
export function releaseTakeoverInputs(prefix: string): void {
  for (const id of [...liveInputsDown]) if (id.startsWith(prefix)) liveInputsDown.delete(id);
  liveTakeover.releaseInputs(prefix);
}

/** The show's `show:live`/`show:release`… paths. */
export function handleTakeoverControl(action: ShowControlAction, value: number, inputId = 'path'): boolean {
  if (typeof action !== 'object') return false;
  if ('live' in action) {
    const on = value > 0;
    if (liveInputHasEdges(inputId)) {
      if (on === liveInputsDown.has(inputId)) return true;
      if (on) liveInputsDown.add(inputId);
      else liveInputsDown.delete(inputId);
    }
    if (!on) {
      releaseHeldBy(inputId);
      return true;
    }
    const track = trackAt(action.live.track);
    if (!track) return true;
    const momentary = action.live.hold || liveTakeover.state.padMode === 'momentary';
    const source = sourceFromSpec(action.live.source);
    if (!source) return true;
    const current = liveTakeover.state.surfaces[track.layerId];
    // A latched pad pressed again on the same source hands back.
    if (!momentary && current && current.phase !== 'releasing' && current.phase !== 'pendingRelease'
      && JSON.stringify(current.source) === JSON.stringify(source)) {
      returnTrack(track);
      return true;
    }
    takeOverTrack(track, source, momentary ? { inputId, momentary: true } : {});
    return true;
  }
  if ('release' in action) {
    if (action.release === null) liveTakeover.release('all');
    else {
      const track = trackAt(action.release);
      if (track) returnTrack(track);
    }
    return true;
  }
  if ('overlay' in action) {
    liveTakeover.setOverlay({ level: Math.max(0, Math.min(1, value)) });
    return true;
  }
  if ('releaseMode' in action) {
    liveTakeover.setDefaultRelease({ mode: action.releaseMode as TakeoverReleaseMode });
    return true;
  }
  if ('underneath' in action) {
    liveTakeover.setUnderneath(action.underneath);
    return true;
  }
  return false;
}

/** The takeover cue actions. */
export function runTakeoverCue(action: Extract<CueAction, { kind: 'takeover' }>): void {
  const track = trackById(action.trackId);
  if (!track) return;
  let source: TakeoverSource | null;
  switch (action.source) {
    case 'vjRow': source = { kind: 'vjRow', deck: action.deck, row: action.row }; break;
    case 'vjMix': source = { kind: 'vjMix' }; break;
    case 'black': source = { kind: 'black' }; break;
    case 'vjGroup': {
      const group = get(vjClipLauncher).groups?.find((g) => g.id === action.groupId);
      source = group ? { kind: 'vjGroup', groupId: group.id, name: group.name } : null;
      break;
    }
  }
  if (source) takeOverTrack(track, source);
}

export function runTakeoverReleaseCue(action: Extract<CueAction, { kind: 'takeoverRelease' }>): void {
  const spec = action.mode === 'default' ? undefined : { mode: action.mode, fadeSeconds: action.fade };
  if (!action.trackId) {
    liveTakeover.release('all', spec);
    return;
  }
  const track = trackById(action.trackId);
  if (track) returnTrack(track, spec);
}

// ── Install ─────────────────────────────────────────────────────────────

export function installTakeoverRuntime(): () => void {
  const disposers: Array<() => void> = [];
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

  // Marker times, kept until the cue list's markers change (the takeover
  // asks on every evaluation while it is live).
  let markerSource: unknown = null;
  let markerTimes: readonly number[] = [];
  liveTakeover.configure({
    now,
    show: () => {
      const s = get(showTimeline);
      const markers = cueList.state.markers;
      if (markers !== markerSource) {
        markerSource = markers;
        markerTimes = markers.map((m) => m.time);
      }
      return { showTime: s.currentTime, playing: s.isPlaying, tempo: s.tempo, markers: markerTimes };
    },
    chasing: () => showTimeline.isChasing(),
    pauseShow: () => showTimeline.pause(),
    playShow: () => showTimeline.play(),
    launchBoundary: (gridBeats, nowMs) => nextLaunchBoundary(gridBeats, nowMs),
    onAllReleased: runDeferred,
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
    vjClipLauncher.setTakeoverLive(!!frame?.needsVjFeeds, takeoverVjSamples(frame));
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
  // Not while an offline render drives the show on its own clock: its
  // playhead is not where the live show is, and the scene leaves the
  // takeover out of the render anyway.
  disposers.push(showTimeline.subscribe(() => {
    if (Object.keys(liveTakeover.state.surfaces).length && !isVisualAudioManualClock()) step();
  }));
  disposers.push(() => {
    if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
    if (timer !== null) clearTimeout(timer);
    raf = null;
    timer = null;
  });

  // A track deleted (or undone) while taken over: its override goes too. A
  // track whose surface changed hands back the old surface.
  let lastTracks: unknown = null;
  disposers.push(showTimeline.subscribe((s) => {
    if (s.layerTracks === lastTracks) return;
    lastTracks = s.layerTracks;
    for (const o of Object.values(liveTakeover.state.surfaces)) {
      if (!o.trackId) continue;
      const track = s.layerTracks.find((t) => t.id === o.trackId);
      if (!track || track.layerId !== o.surfaceId) liveTakeover.release(o.surfaceId, { mode: 'instant' });
    }
  }));

  // A cleared show or another project: the old takeover is over.
  disposers.push(onShowTimelineReset(() => {
    deferred = [];
    liveTakeover.reset();
  }));

  // ── Marker policy ────────────────────────────────────────────────────
  cueList.setActionGate((action, source) => {
    const s = liveTakeover.state;
    if (!shouldHoldCueAction(action, source, s.markerPolicy, takeoverActive())) return false;
    deferred.push(action);
    liveTakeover.setDeferredCount(deferred.length);
    return true;
  });
  disposers.push(() => cueList.setActionGate(null));

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
        deferredCount: () => deferred.length,
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
