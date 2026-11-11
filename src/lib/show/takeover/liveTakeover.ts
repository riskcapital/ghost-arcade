/**
 * Live takeover: a VJ grabs a surface of a playing show (from a VJ deck row,
 * the deck mix, a VJ group, dropped media or black), plays it live, then
 * hands it back to the timeline.
 *
 * Session only. Nothing here is saved, and nothing is an undo step: every
 * edit runs through `runAsLiveControl`, and the state lives in its own store,
 * never in the project or the show arrangement. The timeline underneath is
 * untouched; a takeover is a layer drawn above the surface in the scene (see
 * takeoverScene.ts), so handing back is just removing that layer.
 *
 * TIME
 * ----
 * Fades in and out run on the wall clock (performance.now), so they work with
 * the show paused. A release can wait for a musical boundary:
 *   'beat' | 'bar' | 'phrase' (four bars)  the next one on the show's tempo
 *       map while the show plays; with no map, or the show paused, the next
 *       one on the launch clock.
 *   'marker'  the next cue-list marker the playing show reaches (paused: the
 *       next bar on the launch clock).
 * A boundary in show time is checked every time the show is evaluated, and
 * the fade is started as if it had begun exactly on the boundary, so the
 * hand-back lands on the frame the boundary falls in.
 *
 * UNDERNEATH
 * ----------
 * 'run' (the default) keeps the show running, so the hand-back lands
 * wherever the show has got to. 'pause' pauses the show on the first engage
 * and resumes it when the last release starts. It is refused while the show
 * follows timecode, Link or MIDI clock.
 *
 * `evaluateTakeover` is pure; the store (`createLiveTakeover`) owns the state
 * and the side effects on the show, through injected dependencies.
 */
import { get, writable, type Readable } from 'svelte/store';
import type { BlendMode, Effect, ShowClipMedia, ShowTempoMap } from '../../types';
import { barBeatAt, secondsAtBar } from '../tempoMap';
import { runAsLiveControl } from '../../stores/historyHooks';

// ─── Types ───────────────────────────────────────────────────────────────

export type TakeoverDeck = 'A' | 'B';
export type TakeoverSource =
  | { kind: 'vjRow'; deck: TakeoverDeck; row: number }
  | { kind: 'vjMix' }
  | { kind: 'vjGroup'; groupId: string; name?: string }
  | { kind: 'media'; media: ShowClipMedia }
  | { kind: 'black' };

export type TakeoverReleaseMode = 'instant' | 'fade' | 'beat' | 'bar' | 'phrase' | 'marker';
export const TAKEOVER_RELEASE_MODES: readonly TakeoverReleaseMode[] = ['instant', 'fade', 'beat', 'bar', 'phrase', 'marker'];

export interface ReleaseSpec {
  mode: TakeoverReleaseMode;
  /** Fade length once the release starts (0 = a cut). 'instant' ignores it. */
  fadeSeconds: number;
}

export type TakeoverPhase = 'in' | 'live' | 'pendingRelease' | 'releasing';

/** Where a pending release lands: a show time (tempo map / marker while the
 *  show plays) or a wall-clock time (launch clock). */
export interface ReleaseTarget {
  showTime?: number;
  wallMs?: number;
}

export interface SurfaceRelease {
  spec: ReleaseSpec;
  requestedAtMs: number;
  requestedShowTime: number;
  at: ReleaseTarget;
  /** Wall time the fade started (set when the release starts). */
  startedAtMs?: number;
  /** Level the fade starts from. */
  fromLevel?: number;
}

export interface SurfaceOverride {
  /** The layer id the surface is (a track's layerId). */
  surfaceId: string;
  /** The show track that drives the surface, when there is one. */
  trackId: string | null;
  /** What the surface shows; null keeps its own picture (effects only). */
  source: TakeoverSource | null;
  /** Temporary effects appended to the surface while it is taken over. */
  effects?: Effect[];
  /** Level once faded in, 0..1. */
  level: number;
  phase: TakeoverPhase;
  /** Wall time of the engage (or re-engage). */
  engagedAtMs: number;
  /** Fade-in length; 0 = a cut. */
  fadeInSeconds: number;
  /** Level the fade-in starts from (a re-engage mid-release continues). */
  fromLevel: number;
  /** Show time at the engage: the masked part of the track starts here. */
  startShowTime: number;
  release?: SurfaceRelease;
  /** Inputs (MIDI notes, keys) holding a momentary takeover. Empty = latched. */
  momentaryInputs: string[];
  /** Bumped on every engage, so a new source gets a new id. */
  seq: number;
}

export interface TakeoverOverlay {
  source: TakeoverSource;
  level: number;
  blend: BlendMode;
}

export type TakeoverUnderneath = 'run' | 'pause';
export type TakeoverMarkerPolicy = 'fire' | 'hold';
export type TakeoverPadMode = 'latch' | 'momentary';

export interface TakeoverState {
  surfaces: Record<string, SurfaceOverride>;
  overlay: TakeoverOverlay | null;
  underneath: TakeoverUnderneath;
  /** Show time the takeover paused the show at ('pause'). */
  pausedAt?: number;
  defaultRelease: ReleaseSpec;
  markerPolicy: TakeoverMarkerPolicy;
  /** How a pad or a mapped note takes over: latch, or only while held. */
  padMode: TakeoverPadMode;
  /** The source the L key and a bare LIVE click use. */
  lastSource: TakeoverSource;
  /** Cue actions held back by markerPolicy 'hold' until the hand-back. */
  deferredCount: number;
}

/** What the scene needs at one instant. */
export interface TakeoverSurfaceFrame {
  surfaceId: string;
  trackId: string | null;
  source: TakeoverSource | null;
  effects?: Effect[];
  level: number;
  /** Changes with each engage: the scene's source key. */
  key: string;
  /** Wall time of the engage (a dropped video starts there). */
  engagedAtMs: number;
}

export interface TakeoverFrame {
  surfaces: TakeoverSurfaceFrame[];
  overlay: TakeoverOverlay | null;
  /** A VJ row, the mix or a group is on screen: the VJ feeds must run. */
  needsVjFeeds: boolean;
}

/** The show as the takeover sees it. */
export interface TakeoverShowContext {
  showTime: number;
  playing: boolean;
  tempo: ShowTempoMap | null;
  /** Marker times, any order. */
  markers: readonly number[];
}

export const DEFAULT_TAKEOVER_RELEASE: ReleaseSpec = { mode: 'fade', fadeSeconds: 1 };
/** A release that waits for a show-time boundary starts this much before the
 *  frame that sees the boundary at most. A frame is late by a few ms; a show
 *  that is further past the boundary was seeked there, and its fade starts
 *  now instead of having (nearly) finished already. */
export const TAKEOVER_RELEASE_MAX_LATE_SECONDS = 0.25;
/** 'pause' resumes the show only while it is still where the takeover paused
 *  it: a Stop, a seek or a Play of the operator's own since then wins. */
const PAUSED_AT_TOLERANCE_SECONDS = 0.05;
/** Bars in a phrase. */
export const TAKEOVER_PHRASE_BARS = 4;

export function createTakeoverState(): TakeoverState {
  return {
    surfaces: {},
    overlay: null,
    underneath: 'run',
    defaultRelease: { ...DEFAULT_TAKEOVER_RELEASE },
    markerPolicy: 'fire',
    padMode: 'latch',
    lastSource: { kind: 'vjMix' },
    deferredCount: 0,
  };
}

// ─── Pure helpers ────────────────────────────────────────────────────────

export function isVjSource(source: TakeoverSource | null | undefined): boolean {
  return !!source && (source.kind === 'vjRow' || source.kind === 'vjMix' || source.kind === 'vjGroup');
}

export function sameTakeoverSource(a: TakeoverSource | null | undefined, b: TakeoverSource | null | undefined): boolean {
  if (!a || !b || a.kind !== b.kind) return !a && !b;
  switch (a.kind) {
    case 'vjRow': return b.kind === 'vjRow' && a.deck === b.deck && a.row === b.row;
    case 'vjGroup': return b.kind === 'vjGroup' && a.groupId === b.groupId;
    case 'media': return b.kind === 'media' && a.media.src === b.media.src && a.media.name === b.media.name;
    default: return true;
  }
}

/** Short label for a source: "VJ A2", "VJ mix", the group or file name, "Black". */
export function takeoverSourceLabel(source: TakeoverSource | null | undefined): string {
  if (!source) return 'FX';
  switch (source.kind) {
    case 'vjRow': return `VJ ${source.deck}${source.row + 1}`;
    case 'vjMix': return 'VJ mix';
    case 'vjGroup': return source.name || 'VJ group';
    case 'media': return source.media.name || 'Media';
    case 'black': return 'Black';
  }
}

export function normalizeReleaseSpec(spec: Partial<ReleaseSpec> | null | undefined, fallback: ReleaseSpec = DEFAULT_TAKEOVER_RELEASE): ReleaseSpec {
  const mode = spec?.mode && TAKEOVER_RELEASE_MODES.includes(spec.mode) ? spec.mode : fallback.mode;
  const raw = Number(spec?.fadeSeconds);
  const fadeSeconds = Number.isFinite(raw) ? Math.max(0, Math.min(60, raw)) : fallback.fadeSeconds;
  return { mode, fadeSeconds };
}

const clamp01 = (v: number) => (v <= 0 ? 0 : v >= 1 ? 1 : v);

/**
 * The next boundary strictly after show time `t` on the tempo map:
 * the next beat, bar, or phrase (bars 1, 5, 9…).
 */
export function nextShowBoundary(map: ShowTempoMap, t: number, grid: 'beat' | 'bar' | 'phrase'): number {
  const bb = barBeatAt(map, t);
  const barStart = secondsAtBar(map, bb.bar);
  const nextBar = secondsAtBar(map, bb.bar + 1);
  const after = (x: number) => x > t + 1e-6;
  if (grid === 'beat') {
    const beatLen = (nextBar - barStart) / Math.max(1, bb.beatsPerBar);
    for (let i = bb.beat; i <= bb.beatsPerBar; i++) {
      const x = barStart + i * beatLen;
      if (after(x)) return Math.min(x, nextBar);
    }
    return nextBar;
  }
  if (grid === 'bar') return after(nextBar) ? nextBar : secondsAtBar(map, bb.bar + 2);
  // Phrase: bars 1, 1 + n, 1 + 2n… (and before bar 1, the same spacing).
  const n = TAKEOVER_PHRASE_BARS;
  let bar = bb.bar + 1;
  while ((((bar - 1) % n) + n) % n !== 0) bar++;
  const x = secondsAtBar(map, bar);
  return after(x) ? x : secondsAtBar(map, bar + n);
}

/** Next marker strictly after `t`, or null. */
export function nextMarkerAfter(markers: readonly number[], t: number): number | null {
  let best: number | null = null;
  for (const m of markers) if (m > t + 1e-6 && (best === null || m < best)) best = m;
  return best;
}

/** Launch-clock grid in beats for the musical release modes. */
export function launchGridBeats(mode: TakeoverReleaseMode): number {
  return mode === 'beat' ? 1 : mode === 'phrase' ? 4 * TAKEOVER_PHRASE_BARS : 4;
}

/**
 * Where a release asked for now lands. `launchBoundary(gridBeats, nowMs)` is
 * the launch clock's next boundary (wall ms). Returns null for a release
 * that starts now ('instant', 'fade').
 */
export function releaseTargetFor(
  spec: ReleaseSpec,
  show: TakeoverShowContext,
  nowMs: number,
  launchBoundary: (gridBeats: number, nowMs: number) => number,
): ReleaseTarget | null {
  switch (spec.mode) {
    case 'instant':
    case 'fade':
      return null;
    case 'marker': {
      if (show.playing) {
        const m = nextMarkerAfter(show.markers, show.showTime);
        if (m !== null) return { showTime: m };
        return null;
      }
      return { wallMs: launchBoundary(4, nowMs) };
    }
    default: {
      if (show.playing && show.tempo) return { showTime: nextShowBoundary(show.tempo, show.showTime, spec.mode) };
      return { wallMs: launchBoundary(launchGridBeats(spec.mode), nowMs) };
    }
  }
}

/** Level of one override at `nowMs` (no state change). */
export function overrideLevel(o: SurfaceOverride, nowMs: number): number {
  const target = clamp01(o.level);
  switch (o.phase) {
    case 'in': {
      if (!(o.fadeInSeconds > 0)) return target;
      const p = clamp01((nowMs - o.engagedAtMs) / (o.fadeInSeconds * 1000));
      return o.fromLevel + (target - o.fromLevel) * p;
    }
    case 'live':
      return target;
    case 'pendingRelease':
      // Released part way into its fade-in: it waits at that level.
      return clamp01(o.release?.fromLevel ?? target);
    case 'releasing': {
      const r = o.release;
      const from = clamp01(r?.fromLevel ?? target);
      const fade = r?.spec.mode === 'instant' ? 0 : r?.spec.fadeSeconds ?? 0;
      if (!r || r.startedAtMs === undefined || !(fade > 0)) return 0;
      return from * (1 - clamp01((nowMs - r.startedAtMs) / (fade * 1000)));
    }
  }
}

export interface TakeoverEvaluation {
  frame: TakeoverFrame;
  /** The state after the instant (phases moved on), or the same object
   *  when nothing changed. */
  next: TakeoverState;
  /** Surfaces whose release started at this instant. */
  releasesStarted: string[];
  /** Surfaces handed back to the timeline at this instant. */
  released: string[];
}

/**
 * The takeover at one instant: levels for the scene, and the phases moved on
 * (a fade-in finished, a pending release reached its boundary, a fade-out
 * finished). Pure: the caller stores `next`.
 */
export function evaluateTakeover(
  state: TakeoverState,
  show: TakeoverShowContext,
  nowMs: number,
  launchBoundary: (gridBeats: number, nowMs: number) => number = (_g, now) => now,
): TakeoverEvaluation {
  let changed = false;
  const surfaces: Record<string, SurfaceOverride> = {};
  const releasesStarted: string[] = [];
  const released: string[] = [];
  for (const [id, o0] of Object.entries(state.surfaces)) {
    let o = o0;
    if (o.phase === 'in' && (!(o.fadeInSeconds > 0) || nowMs - o.engagedAtMs >= o.fadeInSeconds * 1000)) {
      o = { ...o, phase: 'live' };
    }
    if (o.phase === 'pendingRelease' && o.release) {
      const r = o.release;
      let at = r.at;
      let requestedShowTime = r.requestedShowTime;
      // The show jumped back (a seek, a loop wrap) or stopped playing: aim
      // again from where it is now.
      if (at.showTime !== undefined && (!show.playing || show.showTime < r.requestedShowTime - 1e-3)) {
        at = releaseTargetFor(r.spec, show, nowMs, launchBoundary) ?? { wallMs: nowMs };
        requestedShowTime = show.showTime;
      }
      let startAt: number | null = null;
      if (at.showTime !== undefined && show.playing && show.showTime >= at.showTime - 1e-6) {
        // Started exactly on the boundary: as many ms ago as the show is past
        // it (a frame or so). Far past it, the show was seeked: start now.
        const late = Math.max(0, show.showTime - at.showTime);
        startAt = nowMs - (late > TAKEOVER_RELEASE_MAX_LATE_SECONDS ? 0 : late) * 1000;
      } else if (at.wallMs !== undefined && nowMs >= at.wallMs) {
        startAt = at.wallMs;
      }
      if (startAt !== null) {
        o = { ...o, phase: 'releasing', release: { ...r, at, requestedShowTime, startedAtMs: startAt, fromLevel: clamp01(r.fromLevel ?? o.level) } };
        releasesStarted.push(id);
      } else if (at !== r.at) {
        o = { ...o, release: { ...r, at, requestedShowTime } };
      }
    }
    if (o.phase === 'releasing' && overrideLevel(o, nowMs) <= 0) {
      const r = o.release;
      const fade = r?.spec.mode === 'instant' ? 0 : r?.spec.fadeSeconds ?? 0;
      if (!r || r.startedAtMs === undefined || !(fade > 0) || nowMs - r.startedAtMs >= fade * 1000) {
        released.push(id);
        changed = true;
        continue;
      }
    }
    if (o !== o0) changed = true;
    surfaces[id] = o;
  }
  const next = changed ? { ...state, surfaces } : state;
  const frameSurfaces: TakeoverSurfaceFrame[] = Object.values(next.surfaces).map((o) => ({
    surfaceId: o.surfaceId,
    trackId: o.trackId,
    source: o.source,
    effects: o.effects,
    level: overrideLevel(o, nowMs),
    key: `${o.surfaceId}:${o.seq}`,
    engagedAtMs: o.engagedAtMs,
  }));
  const overlay = next.overlay && next.overlay.level > 0 ? next.overlay : null;
  const needsVjFeeds = Object.values(next.surfaces).some((o) => isVjSource(o.source)) || (!!overlay && isVjSource(overlay.source));
  return { frame: { surfaces: frameSurfaces, overlay, needsVjFeeds }, next, releasesStarted, released };
}

/** A frame's identity for the scene: levels rounded so a settled takeover
 *  does not re-publish every tick. */
export function takeoverFrameSignature(frame: TakeoverFrame): string {
  const s = frame.surfaces.map((x) => `${x.key}|${x.source ? x.source.kind : '-'}|${Math.round(x.level * 1000)}|${x.effects?.length ?? 0}`).join(';');
  const o = frame.overlay ? `${takeoverSourceLabel(frame.overlay.source)}|${Math.round(frame.overlay.level * 1000)}|${frame.overlay.blend}` : '';
  return `${s}#${o}#${frame.needsVjFeeds ? 1 : 0}`;
}

/** Is anything moving on the wall clock (so the runtime must keep ticking)? */
export function takeoverAnimating(state: TakeoverState): boolean {
  return Object.values(state.surfaces).some((o) => o.phase === 'in' || o.phase === 'releasing' || (o.phase === 'pendingRelease' && o.release?.at.wallMs !== undefined));
}

export interface TakeoverSummarySurface {
  surfaceId: string;
  trackId: string | null;
  label: string;
  phase: TakeoverPhase;
  /** Show time the masked part starts at. */
  since: number;
  /** A pending release: show time or wall-clock ms it lands at. */
  releaseAtShowTime?: number;
  releaseAtWallMs?: number;
}

export interface TakeoverSummary {
  active: boolean;
  /** Surfaces taken over (the "LIVE n" pill). */
  count: number;
  surfaces: TakeoverSummarySurface[];
  overlay: { label: string; level: number; blend: BlendMode } | null;
  underneath: TakeoverUnderneath;
  defaultRelease: ReleaseSpec;
  markerPolicy: TakeoverMarkerPolicy;
  pending: number;
}

/**
 * A small, serialisable picture of the takeover for other windows (the stage
 * sim's transport) and status displays.
 */
export function takeoverSummary(state: TakeoverState): TakeoverSummary {
  const surfaces = Object.values(state.surfaces).map((o) => ({
    surfaceId: o.surfaceId,
    trackId: o.trackId,
    label: takeoverSourceLabel(o.source),
    phase: o.phase,
    since: o.startShowTime,
    ...(o.phase === 'pendingRelease' && o.release?.at.showTime !== undefined ? { releaseAtShowTime: o.release.at.showTime } : {}),
    ...(o.phase === 'pendingRelease' && o.release?.at.wallMs !== undefined ? { releaseAtWallMs: o.release.at.wallMs } : {}),
  }));
  const overlay = state.overlay && state.overlay.level > 0
    ? { label: takeoverSourceLabel(state.overlay.source), level: state.overlay.level, blend: state.overlay.blend }
    : null;
  return {
    active: surfaces.length > 0 || overlay !== null,
    count: surfaces.length,
    surfaces,
    overlay,
    underneath: state.underneath,
    defaultRelease: { ...state.defaultRelease },
    markerPolicy: state.markerPolicy,
    pending: surfaces.filter((s) => s.phase === 'pendingRelease').length,
  };
}

// ─── Store ───────────────────────────────────────────────────────────────

export interface TakeoverDeps {
  now(): number;
  /** The show at this instant. */
  show(): TakeoverShowContext;
  /** True while timecode, Link or MIDI clock owns the show's playhead. */
  chasing(): boolean;
  pauseShow(): void;
  playShow(): void;
  /** Launch clock: next boundary of `gridBeats` after `nowMs` (wall ms). */
  launchBoundary(gridBeats: number, nowMs: number): number;
  /** The hand-back of the last surface: run what markerPolicy 'hold' kept. */
  onAllReleased?(): void;
}

const inertDeps: TakeoverDeps = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  show: () => ({ showTime: 0, playing: false, tempo: null, markers: [] }),
  chasing: () => false,
  pauseShow: () => {},
  playShow: () => {},
  launchBoundary: (_g, now) => now,
};

export interface EngageOptions {
  trackId?: string | null;
  /** Hold to take over: released when the last holding input lets go. */
  inputId?: string;
  momentary?: boolean;
  fadeIn?: number;
  level?: number;
  effects?: Effect[];
  /** Never pause the show underneath (a Live section hands pieces over
   *  while the Timeline plays on). */
  keepShowPlaying?: boolean;
}

export interface LiveTakeoverStore extends Readable<TakeoverState> {
  configure(deps: Partial<TakeoverDeps>): void;
  readonly state: TakeoverState;
  engage(surfaceId: string, source: TakeoverSource | null, opts?: EngageOptions): boolean;
  /** Release one surface, or 'all' (the overlay too). */
  release(target: string | 'all', spec?: Partial<ReleaseSpec>): number;
  /** A holding input let go; releases when it was the last one. */
  releaseInput(surfaceId: string, inputId: string): boolean;
  /** Every momentary hold whose input starts with `prefix` lets go. */
  releaseInputs(prefix: string): void;
  /** A pending or running release goes back to live. */
  cancelRelease(surfaceId: string): boolean;
  setOverlay(overlay: Partial<TakeoverOverlay> | null): void;
  addTempEffect(surfaceId: string, effect: Effect, trackId?: string | null): void;
  removeTempEffect(surfaceId: string, effectId: string): void;
  setDefaultRelease(spec: Partial<ReleaseSpec>): void;
  /** False when refused ('pause' while the show follows a clock). */
  setUnderneath(mode: TakeoverUnderneath): boolean;
  setMarkerPolicy(policy: TakeoverMarkerPolicy): void;
  setPadMode(mode: TakeoverPadMode): void;
  setDeferredCount(n: number): void;
  isTakenOver(surfaceId: string): boolean;
  /** Move the phases on and return the frame for the scene. */
  tick(nowMs?: number): TakeoverEvaluation;
  /** The frame at `nowMs` without moving anything on. */
  frame(nowMs?: number): TakeoverFrame;
  reset(): void;
}

export function createLiveTakeover(initialDeps: Partial<TakeoverDeps> = {}): LiveTakeoverStore {
  let deps: TakeoverDeps = { ...inertDeps, ...initialDeps };
  const store = writable<TakeoverState>(createTakeoverState());
  const set = (next: TakeoverState) => runAsLiveControl(() => store.set(next));
  const cur = () => get(store);

  function evaluate(nowMs: number): TakeoverEvaluation {
    return evaluateTakeover(cur(), deps.show(), nowMs, deps.launchBoundary);
  }

  /** Resume the show the takeover paused at `pausedAt`, unless the operator
   *  has moved it since (stopped it, seeked, or played it again). */
  function resumePausedShow(pausedAt: number): void {
    const show = deps.show();
    if (show.playing || Math.abs(show.showTime - pausedAt) > PAUSED_AT_TOLERANCE_SECONDS) return;
    deps.playShow();
  }

  /** After phases moved: resume a paused show when the last release starts,
   *  and tell the runtime when everything is handed back. */
  function afterEvaluation(prev: TakeoverState, ev: TakeoverEvaluation): void {
    let next = ev.next;
    const live = Object.values(next.surfaces).filter((o) => o.phase !== 'releasing');
    if (next.pausedAt !== undefined && live.length === 0) {
      const pausedAt = next.pausedAt;
      next = { ...next, pausedAt: undefined };
      if (next !== prev) set(next);
      resumePausedShow(pausedAt);
    } else if (next !== prev) {
      set(next);
    }
    if (ev.released.length && Object.keys(next.surfaces).length === 0) deps.onAllReleased?.();
  }

  function startRelease(state: TakeoverState, id: string, spec: ReleaseSpec, nowMs: number): SurfaceOverride | null {
    const o = state.surfaces[id];
    if (!o) return null;
    const show = deps.show();
    const level = overrideLevel(o, nowMs);
    const base: SurfaceRelease = { spec, requestedAtMs: nowMs, requestedShowTime: show.showTime, at: {} };
    const at = releaseTargetFor(spec, show, nowMs, deps.launchBoundary);
    // The level stays the surface's target (a cancel or re-engage goes back
    // to it); one released mid fade-in waits at the level it had reached.
    if (at) return { ...o, phase: 'pendingRelease', release: { ...base, at, ...(o.phase === 'in' ? { fromLevel: level } : {}) }, momentaryInputs: [] };
    return { ...o, phase: 'releasing', release: { ...base, startedAtMs: nowMs, fromLevel: level }, momentaryInputs: [] };
  }

  const api: LiveTakeoverStore = {
    subscribe: store.subscribe,
    configure(next) {
      deps = { ...deps, ...next };
    },
    get state() {
      return cur();
    },

    engage(surfaceId, source, opts = {}) {
      if (!surfaceId) return false;
      const nowMs = deps.now();
      const s = cur();
      const prev = s.surfaces[surfaceId];
      const show = deps.show();
      const momentary = !!(opts.momentary && opts.inputId);
      const keepMomentary = prev && prev.phase !== 'releasing' && prev.phase !== 'pendingRelease' && momentary && sameTakeoverSource(prev.source, source);
      const inputs = momentary
        ? [...new Set([...(keepMomentary ? prev!.momentaryInputs : []), opts.inputId!])]
        : [];
      const fromLevel = prev ? overrideLevel(prev, nowMs) : 0;
      const fadeIn = Math.max(0, Number(opts.fadeIn) || 0);
      const sameSource = !!prev && sameTakeoverSource(prev.source, source);
      const override: SurfaceOverride = {
        surfaceId,
        trackId: opts.trackId ?? prev?.trackId ?? null,
        source,
        effects: opts.effects ?? prev?.effects,
        level: clamp01(opts.level ?? prev?.level ?? 1),
        phase: fadeIn > 0 ? 'in' : 'live',
        engagedAtMs: nowMs,
        fadeInSeconds: fadeIn,
        // A re-engage mid-fade carries on from where the picture is.
        fromLevel: prev ? fromLevel : 0,
        startShowTime: prev && prev.phase !== 'releasing' ? prev.startShowTime : show.showTime,
        momentaryInputs: inputs,
        // Same source on a live surface: keep the scene's source (no restart).
        seq: prev && sameSource && prev.phase !== 'releasing' ? prev.seq : (prev?.seq ?? 0) + 1,
      };
      let next: TakeoverState = { ...s, surfaces: { ...s.surfaces, [surfaceId]: override } };
      if (source) next.lastSource = source;
      // The first live one: surfaces still fading out do not count (their
      // release already resumed a paused show).
      const first = !Object.values(s.surfaces).some((o) => o.phase !== 'releasing');
      let pause = false;
      if (first && !opts.keepShowPlaying && s.underneath === 'pause' && s.pausedAt === undefined && show.playing && !deps.chasing()) {
        next = { ...next, pausedAt: show.showTime };
        pause = true;
      }
      set(next);
      if (pause) deps.pauseShow();
      return true;
    },

    release(target, spec) {
      const nowMs = deps.now();
      const s = cur();
      const resolved = normalizeReleaseSpec(spec ?? null, s.defaultRelease);
      const ids = target === 'all' ? Object.keys(s.surfaces) : s.surfaces[target] ? [target] : [];
      const surfaces = { ...s.surfaces };
      let count = 0;
      for (const id of ids) {
        const o = surfaces[id];
        // An instant release always wins; otherwise a release in progress stays.
        if (o.phase === 'releasing' && resolved.mode !== 'instant') continue;
        if (o.phase === 'pendingRelease' && resolved.mode !== 'instant' && resolved.mode !== 'fade') continue;
        const next = startRelease(s, id, resolved, nowMs);
        if (next) {
          surfaces[id] = next;
          count++;
        }
      }
      let overlay = s.overlay;
      if (target === 'all' && overlay) overlay = null;
      if (!count && overlay === s.overlay) return 0;
      set({ ...s, surfaces, overlay });
      // Instant releases (and zero-length fades) end right here; a paused
      // show resumes as the last release starts.
      afterEvaluation(cur(), evaluate(nowMs));
      return count;
    },

    releaseInput(surfaceId, inputId) {
      const s = cur();
      const o = s.surfaces[surfaceId];
      if (!o || !o.momentaryInputs.includes(inputId)) return false;
      const rest = o.momentaryInputs.filter((x) => x !== inputId);
      if (rest.length) {
        set({ ...s, surfaces: { ...s.surfaces, [surfaceId]: { ...o, momentaryInputs: rest } } });
        return false;
      }
      return api.release(surfaceId) > 0;
    },

    releaseInputs(prefix) {
      for (const o of Object.values(cur().surfaces)) {
        for (const input of o.momentaryInputs) if (input.startsWith(prefix)) api.releaseInput(o.surfaceId, input);
      }
    },

    cancelRelease(surfaceId) {
      const s = cur();
      const o = s.surfaces[surfaceId];
      if (!o || (o.phase !== 'pendingRelease' && o.phase !== 'releasing')) return false;
      const nowMs = deps.now();
      const level = overrideLevel(o, nowMs);
      const held = o.phase === 'pendingRelease' && o.release?.fromLevel !== undefined && level < clamp01(o.level) - 1e-6;
      const back: SurfaceOverride = o.phase === 'pendingRelease' && !held
        ? { ...o, phase: 'live', release: undefined }
        : held
          ? { ...o, phase: 'in', release: undefined, engagedAtMs: nowMs, fromLevel: level, fadeInSeconds: Math.max(0.05, o.fadeInSeconds * (1 - level)) }
        : { ...o, phase: 'in', release: undefined, engagedAtMs: nowMs, fromLevel: level, fadeInSeconds: Math.max(0.05, o.release?.spec.fadeSeconds ?? 0) * (1 - level) };
      set({ ...s, surfaces: { ...s.surfaces, [surfaceId]: back } });
      return true;
    },

    setOverlay(patch) {
      const s = cur();
      if (patch === null) {
        if (s.overlay) set({ ...s, overlay: null });
        return;
      }
      const base: TakeoverOverlay = s.overlay ?? { source: { kind: 'vjMix' }, level: 0, blend: 'normal' };
      const next: TakeoverOverlay = {
        source: patch.source ?? base.source,
        level: clamp01(patch.level ?? base.level),
        blend: patch.blend ?? base.blend,
      };
      set({ ...s, overlay: next });
    },

    addTempEffect(surfaceId, effect, trackId = null) {
      const s = cur();
      const o = s.surfaces[surfaceId];
      if (o) {
        set({ ...s, surfaces: { ...s.surfaces, [surfaceId]: { ...o, effects: [...(o.effects ?? []), effect] } } });
        return;
      }
      api.engage(surfaceId, null, { trackId, effects: [effect] });
    },

    removeTempEffect(surfaceId, effectId) {
      const s = cur();
      const o = s.surfaces[surfaceId];
      if (!o?.effects) return;
      const effects = o.effects.filter((e) => e.id !== effectId);
      if (!o.source && !effects.length) {
        const surfaces = { ...s.surfaces };
        delete surfaces[surfaceId];
        set({ ...s, surfaces });
        afterEvaluation(cur(), evaluate(deps.now()));
        return;
      }
      set({ ...s, surfaces: { ...s.surfaces, [surfaceId]: { ...o, effects } } });
    },

    setDefaultRelease(spec) {
      const s = cur();
      set({ ...s, defaultRelease: normalizeReleaseSpec(spec, s.defaultRelease) });
    },

    setUnderneath(mode) {
      const s = cur();
      if (mode === 'pause' && deps.chasing()) return false;
      if (s.underneath === mode) return true;
      let next: TakeoverState = { ...s, underneath: mode };
      const show = deps.show();
      const active = Object.values(s.surfaces).some((o) => o.phase !== 'releasing');
      let pause = false;
      let resumeFrom: number | null = null;
      if (mode === 'pause' && active && show.playing) {
        next = { ...next, pausedAt: show.showTime };
        pause = true;
      } else if (mode === 'run' && s.pausedAt !== undefined) {
        next = { ...next, pausedAt: undefined };
        resumeFrom = s.pausedAt;
      }
      set(next);
      if (pause) deps.pauseShow();
      if (resumeFrom !== null) resumePausedShow(resumeFrom);
      return true;
    },

    setMarkerPolicy(policy) {
      const s = cur();
      if (s.markerPolicy !== policy) set({ ...s, markerPolicy: policy });
    },

    setPadMode(mode) {
      const s = cur();
      if (s.padMode !== mode) set({ ...s, padMode: mode });
    },

    setDeferredCount(n) {
      const s = cur();
      if (s.deferredCount !== n) set({ ...s, deferredCount: n });
    },

    isTakenOver(surfaceId) {
      const o = cur().surfaces[surfaceId];
      return !!o && o.phase !== 'releasing';
    },

    tick(nowMs = deps.now()) {
      const prev = cur();
      const ev = evaluate(nowMs);
      afterEvaluation(prev, ev);
      return ev;
    },

    frame(nowMs = deps.now()) {
      return evaluate(nowMs).frame;
    },

    reset() {
      const s = cur();
      const fresh = createTakeoverState();
      // Session preferences survive a reset; overrides do not.
      set({ ...fresh, underneath: s.underneath, defaultRelease: s.defaultRelease, markerPolicy: s.markerPolicy, padMode: s.padMode, lastSource: s.lastSource });
    },
  };
  return api;
}

/** The app's takeover. The runtime (takeoverRuntime.ts) wires its deps. */
export const liveTakeover = createLiveTakeover();
