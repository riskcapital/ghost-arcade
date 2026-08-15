/**
 * Clip audio bus — opt-in playback for video clips that carry an audio track.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every persistent media element in the app is constructed `muted = true`
 * (vjClipLauncher, gpuLayerRenderer, SplatRenderer, WebGPUCanvas, LayerPanel),
 * and the native core decodes with ffmpeg `-an`, so audio is discarded before
 * it ever reaches a buffer. Nothing in Ghost Arcade can make a sound today.
 * This module is the *only* place that un-mutes anything, and it does so
 * strictly on a per-clip opt-in (`audioPlayback === true`).
 *
 * DESIGN CONSTRAINTS (all load-bearing — read before editing)
 * ----------------------------------------------------------
 * 1. DEFAULT OFF. Nothing here is constructed until the first `attachClip()`.
 *    A project with no opted-in clip performs zero AudioContext work, makes
 *    zero `createMediaElementSource()` calls, and un-mutes zero elements.
 *
 * 2. SHARED CONTEXT. We build on `audioAnalyzer.getOrCreateAudioContext()` —
 *    the app's single `new AudioContext()`. We never create our own, and we
 *    never route through `audioAnalyzer.startMediaElement()`, which begins
 *    with `await this.stop()` and is therefore strictly single-source: using
 *    it would kill mic input and could only ever hold one clip.
 *
 * 3. ONE WIRING PER ELEMENT, EVER. `createMediaElementSource()` is permanent
 *    and one-shot: it removes the element from the default audio output for
 *    good, and a second call on the same element throws
 *    `InvalidStateError`. The `sourceNodes` WeakMap below is the guard.
 *    Callers must also hand us a *dedicated, non-pooled* element — see the
 *    `audibleVideoElementCache` comment in vjClipLauncher.ts.
 *
 * 4. THE NATIVE CORE OWNS THE CLOCK. An audible element is a *second*
 *    decoder of the same file with its own `currentTime`. It is a slave:
 *    `computeClipAudioDrift()` below chases the authority time the core is
 *    rendering from, nudging `playbackRate` for small drift and hard-seeking
 *    only past the threshold (constant reseeking is audible pitch-warping;
 *    a few ms of drift is not).
 *
 * 5. SURVIVE ANALYZER RECOVERY. `analyzer._recoverAudioPipeline()` does a
 *    full stop + 300 ms + restart on `devicechange` / context statechange
 *    (plugging in headphones). We subscribe to `audioAnalyzer.onGraphChange()`
 *    and re-tap, and `ensureGraph()` re-validates lazily on every mutation,
 *    so the bus cannot silently go dead.
 *
 * 6. NO SOUND DURING AN OFFLINE EXPORT. `isVisualAudioManualClock()` is true
 *    while a render owns the clock; the tick then silences the master gain
 *    and parks the elements rather than chasing a virtual timeline. Exported
 *    audio is a separate concern.
 */

import { writable } from 'svelte/store';
import { audioAnalyzer } from './analyzer';
import { isVisualAudioManualClock } from './visualAudio';

// ============================================================================
// DRIFT POLICY (pure — unit tested without any WebAudio)
// ============================================================================

/** Past this much |drift| we stop nudging and hard-seek the element. 80 ms is
 *  above the ~50 ms lip-sync perception floor for "audio late" but low enough
 *  that a seek is rare in practice. */
export const CLIP_AUDIO_HARD_SEEK_SECONDS = 0.08;

/** Deadband. Inside this the element runs at exactly the authority rate — no
 *  correction at all. Must be comfortably larger than the per-frame slew
 *  (`maxNudge * rate * dt`, ~0.8 ms at 60 fps) or the controller would step
 *  past zero and chatter. */
export const CLIP_AUDIO_NUDGE_SECONDS = 0.012;

/** Maximum proportional speed trim, ±5%. Applied only outside the deadband
 *  and only for the second or two it takes to close the gap. */
export const CLIP_AUDIO_MAX_NUDGE = 0.05;

const MIN_RATE = 0.0625;
const MAX_RATE = 16;

export interface DriftCorrectionInput {
  /** Media time the render authority (native core) is presenting, seconds. */
  authorityTime: number;
  /** The audible element's own `currentTime`, seconds. */
  elementTime: number;
  /** Transport rate the clip is nominally running at. */
  baseRate: number;
  /** Force a hard seek regardless of drift — loop wrap, trim edit, or a
   *  bumped `seek_generation` from the native transport command. */
  forceSeek?: boolean;
  hardSeekSeconds?: number;
  nudgeSeconds?: number;
  maxNudge?: number;
}

export interface DriftCorrection {
  /** elementTime − authorityTime. Positive = element is ahead / early. */
  drift: number;
  /** Absolute `currentTime` to assign, or null to let it run. */
  seekTo: number | null;
  /** `playbackRate` to assign this tick. */
  playbackRate: number;
}

function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return 1;
  return Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
}

/**
 * Decide how to bring an audible element back onto the authority clock.
 *
 * Bang-bang outside a deadband, nothing inside it. A *proportional* law that
 * fades the correction out as drift shrinks would asymptote at the deadband
 * edge and never actually enter it; full-magnitude correction converges into
 * the deadband at a constant `maxNudge * baseRate` seconds-of-drift per
 * second, then stops dead. Because that slew per frame (~0.8 ms at 60 fps and
 * 1x) is an order of magnitude below the 12 ms deadband, the controller
 * cannot overshoot into the opposite sign — it converges monotonically and
 * does not oscillate. See clipAudioBus.test.ts for the numbers.
 */
export function computeClipAudioDrift(input: DriftCorrectionInput): DriftCorrection {
  const hard = input.hardSeekSeconds ?? CLIP_AUDIO_HARD_SEEK_SECONDS;
  const dead = input.nudgeSeconds ?? CLIP_AUDIO_NUDGE_SECONDS;
  const maxNudge = input.maxNudge ?? CLIP_AUDIO_MAX_NUDGE;
  const rate = clampRate(input.baseRate);
  const authority = Number(input.authorityTime);
  const element = Number(input.elementTime);

  if (!Number.isFinite(authority) || !Number.isFinite(element)) {
    return { drift: 0, seekTo: Number.isFinite(authority) ? authority : null, playbackRate: rate };
  }

  const drift = element - authority;

  if (input.forceSeek || Math.abs(drift) > hard) {
    return { drift, seekTo: authority, playbackRate: rate };
  }
  if (Math.abs(drift) <= dead) {
    return { drift, seekTo: null, playbackRate: rate };
  }
  // Element ahead → slow it down; element behind → speed it up.
  const direction = drift > 0 ? 1 : -1;
  return { drift, seekTo: null, playbackRate: clampRate(rate * (1 - direction * maxNudge)) };
}

// ============================================================================
// TRANSPORT CONTRACT
// ============================================================================

/** Snapshot of what the render authority believes the clip's transport is.
 *  `timeSeconds` must already be loop/trim wrapped by the provider — the
 *  launcher and LayerPanel both already compute exactly that value for their
 *  playhead UI (`vjClipPlaybackTime` / `sourcePlaybackTime`). */
export interface ClipAudioTransport {
  timeSeconds: number;
  playbackRate: number;
  paused: boolean;
  loop: boolean;
  trimStartSeconds: number;
  /** <= trimStartSeconds means "no trim end known yet". */
  trimEndSeconds: number;
  /** Bumped by every explicit seek/restart. A change forces a hard seek. */
  seekGeneration: number;
  durationSeconds?: number;
}

export type ClipAudioTransportProvider = () => ClipAudioTransport | null;

export interface ClipAudioAttachOptions {
  volume?: number;
  muted?: boolean;
  provider?: ClipAudioTransportProvider;
}

/** Public master state, for UI binding. */
export interface ClipAudioMasterState {
  volume: number;
  muted: boolean;
  /** Number of clips currently wired into the bus. 0 = bus is inert. */
  activeClips: number;
  /** True while an offline export has forced the bus silent. */
  exportSilenced: boolean;
}

export const clipAudioMaster = writable<ClipAudioMasterState>({
  volume: 1,
  muted: false,
  activeClips: 0,
  exportSilenced: false,
});

const MASTER_STORAGE_KEY = 'ghost-arcade.clipAudioMaster';

function loadPersistedMaster(): { volume: number; muted: boolean } {
  try {
    const raw = globalThis.localStorage?.getItem(MASTER_STORAGE_KEY);
    if (!raw) return { volume: 1, muted: false };
    const parsed = JSON.parse(raw);
    const volume = Number(parsed?.volume);
    return {
      volume: Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 1,
      muted: parsed?.muted === true,
    };
  } catch {
    return { volume: 1, muted: false };
  }
}

// ============================================================================
// THE BUS
// ============================================================================

interface ClipEntry {
  id: string;
  element: HTMLMediaElement;
  gain: GainNode | null;
  source: MediaElementAudioSourceNode | null;
  provider: ClipAudioTransportProvider | null;
  volume: number;
  muted: boolean;
  lastSeekGeneration: number;
  /** True once the element has been un-muted by us. */
  unmuted: boolean;
}

type ContextProvider = () => AudioContext;

export class ClipAudioBus {
  private readonly getContext: ContextProvider;

  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private mixDest: MediaStreamAudioDestinationNode | null = null;

  private readonly clips = new Map<string, ClipEntry>();

  /** One MediaElementAudioSourceNode per element, forever. Weak so a
   *  discarded element (and its source node) can still be collected. */
  private readonly sourceNodes = new WeakMap<HTMLMediaElement, MediaElementAudioSourceNode>();

  private masterVolume = 1;
  private masterMuted = false;
  private suspended = false;
  private exportSilenced = false;

  private rafId: number | null = null;
  private analyzerUnsub: (() => void) | null = null;
  /** The analyser we are currently tapped into, so we disconnect the right
   *  edge when the analyzer rebuilds its graph. */
  private tappedAnalyser: AudioNode | null = null;
  private masterToDestination = false;

  constructor(getContext: ContextProvider = () => audioAnalyzer.getOrCreateAudioContext()) {
    this.getContext = getContext;
    const persisted = loadPersistedMaster();
    this.masterVolume = persisted.volume;
    this.masterMuted = persisted.muted;
    this.publish();
  }

  // ── Graph lifecycle ──────────────────────────────────────────────────────

  /** True once at least one clip is wired. Callers use this to keep the
   *  "nothing opted in → nothing happens" guarantee cheap. */
  hasActiveOutput(): boolean {
    return this.clips.size > 0 && this.masterGain !== null;
  }

  /** The shared context, but only if the bus has actually built its graph.
   *  Never constructs one — asking must not have side effects. */
  contextIfReady(): AudioContext | null {
    return this.ctx;
  }

  /** The summed clip output. Null until the graph exists. */
  masterNode(): AudioNode | null {
    return this.masterGain;
  }

  /**
   * Build (or re-validate) the master graph. Idempotent, and safe to call on
   * every mutation — that lazy re-validation is half of how the bus survives
   * `_recoverAudioPipeline()`; the `onGraphChange` subscription is the other.
   */
  private ensureGraph(): boolean {
    let ctx: AudioContext;
    try {
      ctx = this.getContext();
    } catch (err) {
      console.warn('[ClipAudioBus] No AudioContext available:', err);
      return false;
    }
    if (!ctx) return false;

    // A closed or swapped context invalidates every node we hold.
    if (this.ctx && (this.ctx !== ctx || this.ctx.state === 'closed')) {
      this.teardownGraph();
    }
    this.ctx = ctx;

    if (!this.masterGain) {
      this.masterGain = ctx.createGain();
      this.masterGain.gain.value = this.effectiveMasterGain();
      this.masterToDestination = false;
      this.tappedAnalyser = null;
    }

    this.wireMasterOutputs();

    if (!this.analyzerUnsub) {
      // The analyzer tears its analyser node down and rebuilds it on every
      // start/stop and on hotplug recovery. Re-tap when that happens.
      this.analyzerUnsub = audioAnalyzer.onGraphChange(() => {
        if (!this.masterGain) return;
        try {
          this.ensureGraph();
          this.reconnectAllClips();
        } catch (err) {
          console.warn('[ClipAudioBus] Re-tap after analyzer rebuild failed:', err);
        }
      });
    }
    return true;
  }

  /**
   * Connect masterGain to the speakers and (when possible) into the
   * analyzer so clip audio drives audio-reactive visuals.
   *
   * The analyser is a pass-through node. In the analyzer's media-element
   * branch it is connected straight to `ctx.destination`, so tapping into it
   * AND holding our own direct edge to the destination would play every clip
   * twice at double amplitude. Pick exactly one path to the speakers.
   */
  private wireMasterOutputs(): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const analyser = audioAnalyzer.getAnalyserNode();
    const analyserReachesSpeakers = audioAnalyzer.analyserFeedsDestination();

    if (this.tappedAnalyser && this.tappedAnalyser !== analyser) {
      try { master.disconnect(this.tappedAnalyser); } catch { /* already gone */ }
      this.tappedAnalyser = null;
    }
    if (analyser && this.tappedAnalyser !== analyser) {
      try {
        master.connect(analyser);
        this.tappedAnalyser = analyser;
      } catch (err) {
        console.warn('[ClipAudioBus] Analyzer tap failed:', err);
        this.tappedAnalyser = null;
      }
    }

    const wantDirect = !(analyser && analyserReachesSpeakers && this.tappedAnalyser === analyser);
    if (wantDirect && !this.masterToDestination) {
      try {
        master.connect(ctx.destination);
        this.masterToDestination = true;
      } catch (err) {
        console.warn('[ClipAudioBus] Master output connect failed:', err);
      }
    } else if (!wantDirect && this.masterToDestination) {
      try { master.disconnect(ctx.destination); } catch { /* already gone */ }
      this.masterToDestination = false;
    }
  }

  /**
   * Drop every node we own. Clip ENTRIES survive (so `reconnectAllClips()`
   * can rebuild them), but their nodes do not.
   *
   * Assumes the app has one AudioContext for its lifetime, which it does:
   * `getOrCreateAudioContext()` is the only `new AudioContext()` and it is
   * kept alive across analyzer start/stop, closed only at app teardown. If a
   * genuinely new context ever appeared, the source nodes in `sourceNodes`
   * would belong to the dead one and reconnect would fail per clip (logged,
   * not thrown) — the element could not be re-wired to a second context
   * anyway, since createMediaElementSource is one-shot for the element's
   * whole life regardless of which context asked.
   */
  private teardownGraph(): void {
    for (const entry of this.clips.values()) {
      entry.gain = null;
      entry.source = null;
    }
    if (this.masterGain) {
      try { this.masterGain.disconnect(); } catch { /* ignore */ }
    }
    this.masterGain = null;
    this.mixDest = null;
    this.tappedAnalyser = null;
    this.masterToDestination = false;
    this.ctx = null;
  }

  // ── Clip lifecycle ───────────────────────────────────────────────────────

  /**
   * Wire an element into the bus. The element MUST be dedicated to this clip
   * and never returned to a pooled/re-`src`ed cache (constraint 3 above).
   * Attaching the same element twice is a no-op, not a throw.
   */
  attachClip(id: string, element: HTMLMediaElement, options: ClipAudioAttachOptions = {}): boolean {
    if (!id || !element) return false;
    if (!this.ensureGraph()) return false;
    const ctx = this.ctx!;
    const master = this.masterGain!;

    let entry = this.clips.get(id);
    if (entry && entry.element !== element) {
      // Clip's element was replaced (source swap). Retire the old wiring.
      this.releaseEntry(entry);
      this.clips.delete(id);
      entry = undefined;
    }

    if (!entry) {
      entry = {
        id,
        element,
        gain: null,
        source: null,
        provider: options.provider ?? null,
        volume: clamp01(options.volume ?? 1),
        muted: options.muted === true,
        lastSeekGeneration: Number.NaN,
        unmuted: false,
      };
      this.clips.set(id, entry);
    } else {
      if (options.provider) entry.provider = options.provider;
      if (options.volume !== undefined) entry.volume = clamp01(options.volume);
      if (options.muted !== undefined) entry.muted = options.muted === true;
    }

    // One source node per element, ever. A second createMediaElementSource()
    // on the same element throws InvalidStateError.
    let source = this.sourceNodes.get(element) ?? null;
    if (!source) {
      try {
        source = ctx.createMediaElementSource(element);
        this.sourceNodes.set(element, source);
      } catch (err) {
        console.warn(`[ClipAudioBus] createMediaElementSource failed for "${id}":`, err);
        this.clips.delete(id);
        return false;
      }
    }
    entry.source = source;

    if (!entry.gain) {
      entry.gain = ctx.createGain();
    }
    entry.gain.gain.value = this.effectiveClipGain(entry);

    try {
      source.disconnect();
    } catch { /* first attach */ }
    try {
      source.connect(entry.gain);
      entry.gain.disconnect();
      entry.gain.connect(master);
    } catch (err) {
      console.warn(`[ClipAudioBus] Failed to wire clip "${id}":`, err);
      this.clips.delete(id);
      return false;
    }

    // The ONLY place anything gets un-muted. Once an element is routed into
    // WebAudio its `muted` flag still gates the graph, so it has to come off.
    if (!entry.unmuted) {
      element.muted = false;
      entry.unmuted = true;
    }
    // Element-level volume stays at unity; all level control is in the graph
    // so the analyzer tap sees the same signal the speakers do.
    try { (element as HTMLMediaElement).volume = 1; } catch { /* ignore */ }

    this.publish();
    this.startTick();
    return true;
  }

  /** Unwire a clip. The element is left muted and silent. */
  detachClip(id: string): void {
    const entry = this.clips.get(id);
    if (!entry) return;
    this.releaseEntry(entry);
    this.clips.delete(id);
    this.publish();
    if (this.clips.size === 0) this.stopTick();
  }

  detachElement(element: HTMLMediaElement): void {
    for (const [id, entry] of this.clips) {
      if (entry.element === element) {
        this.releaseEntry(entry);
        this.clips.delete(id);
      }
    }
    this.publish();
    if (this.clips.size === 0) this.stopTick();
  }

  private releaseEntry(entry: ClipEntry): void {
    try { entry.source?.disconnect(); } catch { /* ignore */ }
    try { entry.gain?.disconnect(); } catch { /* ignore */ }
    entry.gain = null;
    // NOTE: we deliberately do NOT drop the WeakMap entry. The element is
    // permanently divorced from the default output the moment
    // createMediaElementSource() ran; if it is ever re-attached we must reuse
    // the same source node rather than construct a second one (which throws).
    //
    // Mute but do NOT pause. For mapping-mode media layers the audible
    // element IS the layer's texture source under the legacy (non-native)
    // engine, so pausing it here would freeze the picture when a user merely
    // turned audio off. Callers that are actually retiring an element
    // (vjClipLauncher.releaseAudibleClipElement) pause and unload it
    // themselves.
    try { entry.element.muted = true; } catch { /* ignore */ }
    entry.unmuted = false;
  }

  hasClip(id: string): boolean {
    return this.clips.has(id);
  }

  attachedClipCount(): number {
    return this.clips.size;
  }

  /** Re-run the connect step for every clip after a graph rebuild. */
  private reconnectAllClips(): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;
    for (const entry of this.clips.values()) {
      const source = this.sourceNodes.get(entry.element);
      if (!source) continue;
      entry.source = source;
      if (!entry.gain) entry.gain = ctx.createGain();
      entry.gain.gain.value = this.effectiveClipGain(entry);
      try {
        source.disconnect();
        source.connect(entry.gain);
        entry.gain.disconnect();
        entry.gain.connect(master);
      } catch (err) {
        console.warn(`[ClipAudioBus] Reconnect failed for "${entry.id}":`, err);
      }
    }
  }

  // ── Levels ───────────────────────────────────────────────────────────────

  setClipVolume(id: string, volume: number): void {
    const entry = this.clips.get(id);
    if (!entry) return;
    entry.volume = clamp01(volume);
    this.ensureGraph();
    if (entry.gain) entry.gain.gain.value = this.effectiveClipGain(entry);
  }

  setClipMuted(id: string, muted: boolean): void {
    const entry = this.clips.get(id);
    if (!entry) return;
    entry.muted = muted === true;
    this.ensureGraph();
    if (entry.gain) entry.gain.gain.value = this.effectiveClipGain(entry);
  }

  setClipTransportProvider(id: string, provider: ClipAudioTransportProvider | null): void {
    const entry = this.clips.get(id);
    if (entry) entry.provider = provider;
  }

  setMasterVolume(volume: number): void {
    this.masterVolume = clamp01(volume);
    this.applyMaster();
    this.persistMaster();
  }

  setMasterMuted(muted: boolean): void {
    this.masterMuted = muted === true;
    this.applyMaster();
    this.persistMaster();
  }

  getMasterVolume(): number { return this.masterVolume; }
  getMasterMuted(): boolean { return this.masterMuted; }

  /** Per-clip gain = clipVolume, zeroed by the clip's own mute. */
  private effectiveClipGain(entry: ClipEntry): number {
    return entry.muted ? 0 : entry.volume;
  }

  /** Master gain = masterVolume, zeroed by master mute, by an explicit
   *  suspend(), or by an offline export owning the clock. */
  private effectiveMasterGain(): number {
    if (this.masterMuted || this.suspended || this.exportSilenced) return 0;
    return this.masterVolume;
  }

  private applyMaster(): void {
    if (this.masterGain) {
      this.masterGain.gain.value = this.effectiveMasterGain();
    }
    this.publish();
  }

  private persistMaster(): void {
    try {
      globalThis.localStorage?.setItem(
        MASTER_STORAGE_KEY,
        JSON.stringify({ volume: this.masterVolume, muted: this.masterMuted }),
      );
    } catch { /* private mode / no storage */ }
  }

  private publish(): void {
    clipAudioMaster.set({
      volume: this.masterVolume,
      muted: this.masterMuted,
      activeClips: this.clips.size,
      exportSilenced: this.exportSilenced,
    });
  }

  // ── Suspend / resume ─────────────────────────────────────────────────────

  /** Silence AND park every clip. Unlike a master mute (gain only), this is
   *  an explicit "stop the decoders" call — use it when the elements really
   *  should stop advancing, not merely stop being heard. */
  suspend(): void {
    if (this.suspended) return;
    this.suspended = true;
    this.applyMaster();
    for (const entry of this.clips.values()) {
      try { entry.element.pause(); } catch { /* ignore */ }
    }
  }

  resume(): void {
    if (!this.suspended) return;
    this.suspended = false;
    this.applyMaster();
    if (this.ctx?.state === 'suspended') {
      this.ctx.resume().catch(() => { /* completes on next gesture */ });
    }
  }

  isSuspended(): boolean { return this.suspended; }

  // ── Recording ────────────────────────────────────────────────────────────

  /**
   * A MediaStream carrying the summed clip output only. Persistent — the
   * destination node is created once and reused, so repeated recordings do
   * not stack nodes on the master.
   */
  getMixStream(): MediaStream | null {
    if (!this.hasActiveOutput()) return null;
    if (!this.ensureGraph()) return null;
    const ctx = this.ctx!;
    if (!this.mixDest) {
      try {
        this.mixDest = ctx.createMediaStreamDestination();
        this.masterGain!.connect(this.mixDest);
      } catch (err) {
        console.warn('[ClipAudioBus] Mix stream unavailable:', err);
        this.mixDest = null;
        return null;
      }
    }
    return this.mixDest.stream;
  }

  // ── Sync tick ────────────────────────────────────────────────────────────

  private startTick(): void {
    if (this.rafId !== null) return;
    if (typeof requestAnimationFrame !== 'function') return;
    const step = () => {
      this.rafId = null;
      this.tick();
      if (this.clips.size > 0) this.startTick();
    };
    this.rafId = requestAnimationFrame(step);
  }

  private stopTick(): void {
    if (this.rafId === null) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /** One sync pass. Exposed for tests; the RAF loop is the only live caller. */
  tick(): void {
    // An offline render owns the clock. Chasing a virtual timeline would make
    // the live element scream through the export, so hard-silence the master
    // and stop syncing for the whole export window.
    //
    // Silence, not pause: under the legacy (non-native) engine this same
    // element can be the layer's texture source, and pausing it would freeze
    // the exported picture. Zero gain is enough — nothing reaches the
    // speakers or the mix stream.
    const manual = safeIsManualClock();
    if (manual !== this.exportSilenced) {
      this.exportSilenced = manual;
      this.applyMaster();
    }
    if (manual) return;

    for (const entry of this.clips.values()) {
      this.syncEntry(entry);
    }
  }

  private syncEntry(entry: ClipEntry): void {
    const provider = entry.provider;
    if (!provider) return;
    let transport: ClipAudioTransport | null = null;
    try {
      transport = provider();
    } catch {
      return;
    }
    if (!transport) return;

    const el = entry.element;
    if (this.suspended || this.masterMuted || entry.muted) {
      // Inaudible: stop chasing (a silent element drifting costs nothing, and
      // the next audible tick hard-seeks it back). Leave `paused` alone —
      // under the legacy engine this element may still be feeding a texture.
      return;
    }

    if (transport.paused) {
      if (!el.paused) { try { el.pause(); } catch { /* ignore */ } }
      return;
    }

    const seekGeneration = Number(transport.seekGeneration);
    const generationChanged =
      Number.isFinite(seekGeneration) && seekGeneration !== entry.lastSeekGeneration;
    if (Number.isFinite(seekGeneration)) entry.lastSeekGeneration = seekGeneration;

    const trimStart = Math.max(0, Number(transport.trimStartSeconds) || 0);
    const trimEnd = Number(transport.trimEndSeconds);
    const hasTrimEnd = Number.isFinite(trimEnd) && trimEnd > trimStart;
    const elementTime = Number(el.currentTime);

    // Trim / loop boundary: the authority has already wrapped, so the element
    // running past the out-point is a wrap we have to mirror explicitly.
    const pastTrimEnd = hasTrimEnd && elementTime >= trimEnd;
    const beforeTrimStart = elementTime < trimStart - CLIP_AUDIO_HARD_SEEK_SECONDS;

    const correction = computeClipAudioDrift({
      authorityTime: transport.timeSeconds,
      elementTime,
      baseRate: transport.playbackRate,
      forceSeek: generationChanged || pastTrimEnd || beforeTrimStart,
    });

    if (correction.seekTo !== null) {
      const duration = Number(transport.durationSeconds ?? el.duration);
      let target = correction.seekTo;
      if (hasTrimEnd) target = Math.min(target, trimEnd - 0.001);
      target = Math.max(trimStart, target);
      if (Number.isFinite(duration) && duration > 0) target = Math.min(target, duration - 0.001);
      if (Number.isFinite(target) && target >= 0) {
        try { el.currentTime = target; } catch { /* still loading */ }
      }
    }

    if (Math.abs(el.playbackRate - correction.playbackRate) > 1e-4) {
      try { el.playbackRate = correction.playbackRate; } catch { /* ignore */ }
    }

    // `loop` on the element would wrap to 0, not to trimStart. The tick owns
    // wrapping, so keep the element's own looping off.
    if (el instanceof Object && 'loop' in el && (el as HTMLMediaElement).loop) {
      try { (el as HTMLMediaElement).loop = false; } catch { /* ignore */ }
    }

    if (el.paused) {
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => { /* autoplay gate; retried next tick */ });
      }
    }
  }

  /** Full teardown. App shutdown / tests only. */
  dispose(): void {
    this.stopTick();
    for (const entry of this.clips.values()) this.releaseEntry(entry);
    this.clips.clear();
    this.analyzerUnsub?.();
    this.analyzerUnsub = null;
    this.teardownGraph();
    this.publish();
  }
}

/**
 * Does this element's media have an audio track?
 *
 *   true  — definitely yes
 *   false — definitely no
 *   null  — can't tell (the common case in Chromium)
 *
 * Chromium exposes no `audioTracks` by default, and its
 * `webkitAudioDecodedByteCount` only climbs once audio has actually been
 * decoded — which a muted element never does. So a 0 byte count on an element
 * that has never played unmuted is INDETERMINATE, not "silent". UI must show
 * the opt-in control on null and only mark a source as trackless on a hard
 * false; guessing wrong in the other direction would hide the feature.
 */
export function probeHasAudioTrack(element: HTMLMediaElement | null | undefined): boolean | null {
  if (!element) return null;
  const el = element as unknown as Record<string, unknown>;

  // Firefox.
  if (typeof el.mozHasAudio === 'boolean') return el.mozHasAudio as boolean;

  // Standard AudioTrackList, when the runtime enables it.
  const tracks = el.audioTracks as { length?: number } | undefined;
  if (tracks && typeof tracks.length === 'number' && element.readyState >= 1) {
    return tracks.length > 0;
  }

  // Chromium: positive evidence only.
  const decoded = el.webkitAudioDecodedByteCount;
  if (typeof decoded === 'number' && decoded > 0) return true;

  return null;
}

function clamp01(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1;
  return Math.max(0, Math.min(1, n));
}

function safeIsManualClock(): boolean {
  try {
    return isVisualAudioManualClock();
  } catch {
    return false;
  }
}

/** App-wide singleton. Inert until something calls `attachClip()`. */
export const clipAudioBus = new ClipAudioBus();

// ============================================================================
// RECORDING
// ============================================================================

/**
 * The stream a recording should capture.
 *
 * `analyzer.getAudioStream()` returns null unless an analyzer INPUT source is
 * running, so a show whose only audio is clip playback used to record silent.
 * When the bus is live we build a mixdown that sums the clip bus with the
 * live analyzer input (if any); otherwise we fall through to the historical
 * path byte-for-byte, so nothing changes for projects that never opt in.
 */
export function getRecordingAudioStream(): { stream: MediaStream; cleanup: () => void } | null {
  if (!clipAudioBus.hasActiveOutput()) {
    return audioAnalyzer.getAudioStream();
  }

  const ctx = clipAudioBus.contextIfReady();
  const master = clipAudioBus.masterNode();
  if (!ctx || !master) return audioAnalyzer.getAudioStream();

  let dest: MediaStreamAudioDestinationNode;
  try {
    dest = ctx.createMediaStreamDestination();
  } catch (err) {
    console.warn('[ClipAudioBus] Mixdown destination failed:', err);
    return audioAnalyzer.getAudioStream();
  }

  let masterConnected = false;
  try {
    master.connect(dest);
    masterConnected = true;
  } catch (err) {
    console.warn('[ClipAudioBus] Mixdown master connect failed:', err);
  }

  // Fan the live input (mic / system / analyzed media element) in alongside.
  // Web Audio ignores a duplicate edge between the same node pair, and we
  // only ever disconnect this one edge, so the analyzer's own graph — and
  // its separate `getAudioStream()` capture edge — are untouched.
  const liveSource = audioAnalyzer.getSourceNode();
  let liveConnected = false;
  if (liveSource) {
    try {
      liveSource.connect(dest);
      liveConnected = true;
    } catch (err) {
      console.warn('[ClipAudioBus] Mixdown live-input connect failed:', err);
    }
  }

  if (!masterConnected && !liveConnected) return audioAnalyzer.getAudioStream();

  return {
    stream: dest.stream,
    cleanup: () => {
      if (masterConnected) { try { master.disconnect(dest); } catch { /* ignore */ } }
      if (liveConnected) { try { liveSource!.disconnect(dest); } catch { /* ignore */ } }
    },
  };
}
