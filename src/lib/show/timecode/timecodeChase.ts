/**
 * Timecode chase: the show timeline and the cue list follow an external
 * SMPTE clock, LTC on an audio input or MTC over Web MIDI.
 *
 * CHASE CLOCK
 * -----------
 * Each decoded frame is an anchor: "at this instant the source read this".
 * Between frames the clock runs on from the last anchor at real time, so the
 * timeline moves smoothly at 60 fps from a 25 fps (or 15 Hz MTC) source.
 *
 *   searching  frames are arriving but not yet `lockFrames` in a row that
 *              agree with each other (start-up, or just after a jump)
 *   locked     the source is running and continuous, or parked on a locate
 *   freewheel  frames stopped: keep running on the last anchor for up to
 *              `freewheelSeconds`, riding out a dropout or a bad cable
 *   lost       freewheel ran out: hold where it stopped, pause the show
 *
 * Show time is timecode minus the per-show offset, so a show that starts at
 * 01:00:00:00 on the house clock is programmed from zero.
 *
 * MUSICAL CLOCKS
 * --------------
 * MIDI clock (with Song Position) and Ableton Link carry beats, not
 * timecode. They are turned into show time through the show's tempo map
 * (show/sync/beatChase.ts) and fed to the same chase clock, so a show with a
 * map can follow a DAW or a Link session the way it follows timecode.
 *
 * SWITCHING SOURCES
 * -----------------
 * A new source starts searching from nothing, so the show re-locks to it:
 * the playhead (and the launch clock, LFOs and quantised launches that read
 * the show's beat) jump to wherever the new clock is. That is by design: two
 * clocks have no shared phase to carry over. The settings panel says so.
 */

import { writable, get } from 'svelte/store';
import { LtcDecoder, ltcFrameToTimecode, type LtcFrame } from './ltc';
import { MtcParser } from './mtc';
import { invoke } from '../../bridge';
import { abletonLink } from '../../sync/abletonLink';
import type { ShowTempoMap } from '../../types';
import { formatBarsBeats } from '../tempoMap';
import {
  LinkFollower,
  MidiClockParser,
  showSecondsForSourceQuarters,
  showTempoAt,
  tempoMismatch,
  type LinkFollowMode,
} from '../sync/beatChase';
import {
  actualFps,
  formatTimecode,
  isTimecodeRate,
  secondsToTimecode,
  timecodeToSeconds,
  type Timecode,
  type TimecodeRate,
} from './timecode';

// ─── Settings (saved with the project) ───────────────────────────────────

export type TimecodeSource = 'off' | 'ltc' | 'mtc' | 'midiClock' | 'link';
const TIMECODE_SOURCES: readonly TimecodeSource[] = ['off', 'ltc', 'mtc', 'midiClock', 'link'];

/** Sources that carry beats and need the show's tempo map. */
export function isBeatSource(source: TimecodeSource): source is 'midiClock' | 'link' {
  return source === 'midiClock' || source === 'link';
}

export interface TimecodeSettings {
  source: TimecodeSource;
  /** 'auto' takes the rate the source reports. */
  rate: 'auto' | TimecodeRate;
  /** Seconds of timecode that map to show time zero. */
  offset: number;
  freewheelSeconds: number;
  chaseTimeline: boolean;
  chaseCues: boolean;
  /** Audio input device id for LTC; '' is the system default. */
  ltcDeviceId: string;
  /** 0 = left / mono, 1 = right. */
  ltcChannel: number;
  /** MIDI input id for MTC and MIDI clock; '' listens to every input. */
  mtcInputId: string;
  /** MIDI clock / Link: the source's bar 1 lands on show bar 1 + barOffset. */
  barOffset: number;
  /** Link: follow the session's start/stop, or start on the show's Play at the next Link bar. */
  linkMode: LinkFollowMode;
}

export function defaultTimecodeSettings(): TimecodeSettings {
  return {
    source: 'off',
    rate: 'auto',
    offset: 0,
    freewheelSeconds: 2,
    chaseTimeline: true,
    chaseCues: true,
    ltcDeviceId: '',
    ltcChannel: 0,
    mtcInputId: '',
    barOffset: 0,
    linkMode: 'startStop',
  };
}

export function normalizeTimecodeSettings(raw: unknown): TimecodeSettings {
  const d = defaultTimecodeSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const offset = Number(r.offset);
  const freewheel = Number(r.freewheelSeconds);
  const barOffset = Math.round(Number(r.barOffset));
  return {
    source: TIMECODE_SOURCES.includes(r.source as TimecodeSource) ? (r.source as TimecodeSource) : 'off',
    rate: isTimecodeRate(r.rate) ? r.rate : 'auto',
    offset: Number.isFinite(offset) ? offset : 0,
    freewheelSeconds: Number.isFinite(freewheel) ? Math.max(0, Math.min(60, freewheel)) : d.freewheelSeconds,
    chaseTimeline: r.chaseTimeline !== false,
    chaseCues: r.chaseCues !== false,
    ltcDeviceId: typeof r.ltcDeviceId === 'string' ? r.ltcDeviceId : '',
    ltcChannel: r.ltcChannel === 1 ? 1 : 0,
    mtcInputId: typeof r.mtcInputId === 'string' ? r.mtcInputId : '',
    barOffset: Number.isFinite(barOffset) ? Math.max(-64, Math.min(9999, barOffset)) : 0,
    linkMode: r.linkMode === 'quantisedStart' ? 'quantisedStart' : 'startStop',
  };
}

// ─── Chase clock (pure) ──────────────────────────────────────────────────

export type ChaseLock = 'off' | 'searching' | 'locked' | 'freewheel' | 'lost';

export interface ChaseReading {
  lock: ChaseLock;
  /** Timecode seconds (before the offset) at the read instant. */
  seconds: number | null;
  running: boolean;
  /** Source seconds per real second while running: 1 for timecode, the
   *  source tempo over the map's for a musical clock at another tempo. */
  rate: number;
}

export class ChaseClock {
  private anchor: { seconds: number; atMs: number; rate: number } | null = null;
  private lastFrameAt = 0;
  private streak = 0;
  private still = 0;
  private interval = 0;
  private sourceRunning = false;

  constructor(
    public lockFrames = 3,
    public freewheelMs = 2000,
  ) {}

  reset(): void {
    this.anchor = null;
    this.streak = 0;
    this.still = 0;
    this.interval = 0;
    this.sourceRunning = false;
  }

  /** Ms without a frame before the clock calls it a dropout. */
  dropoutMs(): number {
    return Math.max(120, (this.interval || 40) * 4);
  }

  /**
   * One decoded frame: at `atMs` the source read `seconds`. `running` is
   * false for a locate (MTC full frame): the source is parked there.
   * `rate` is how fast it runs on between frames (source seconds per
   * second): a musical clock at another tempo than the map runs show time
   * faster or slower than real time.
   */
  onFrame(seconds: number, atMs: number, running = true, rate = 1): void {
    const r = Number.isFinite(rate) && rate > 0 ? rate : 1;
    if (this.anchor) {
      const dt = atMs - this.lastFrameAt;
      if (dt > 0 && dt < 1000) this.interval = this.interval ? this.interval * 0.8 + dt * 0.2 : dt;
      const predicted = this.sourceRunning ? this.anchor.seconds + ((atMs - this.anchor.atMs) / 1000) * this.anchor.rate : this.anchor.seconds;
      const tolerance = Math.max(0.1, (2.5 * (this.interval || 40)) / 1000);
      const continuous = Math.abs(seconds - predicted) <= tolerance || (!this.sourceRunning && running);
      this.streak = continuous ? this.streak + 1 : 1;
      this.still = running && Math.abs(seconds - this.anchor.seconds) < 1e-6 ? this.still + 1 : 0;
    } else {
      this.streak = 1;
      this.still = 0;
    }
    this.anchor = { seconds, atMs, rate: r };
    this.lastFrameAt = atMs;
    // A generator paused on one frame keeps repeating it: parked, not rolling.
    this.sourceRunning = running && this.still < 2;
    if (!running) this.streak = Math.max(this.streak, this.lockFrames);
  }

  read(nowMs: number): ChaseReading {
    const a = this.anchor;
    if (!a) return { lock: 'searching', seconds: null, running: false, rate: 1 };
    const since = nowMs - this.lastFrameAt;
    const locked = this.streak >= this.lockFrames;
    const runOn = (at: number) => a.seconds + (Math.max(0, at - a.atMs) / 1000) * a.rate;
    const rate = a.rate;
    if (!this.sourceRunning) {
      return { lock: locked ? 'locked' : 'searching', seconds: a.seconds, running: false, rate };
    }
    const dropout = this.dropoutMs();
    if (since <= dropout) {
      return locked
        ? { lock: 'locked', seconds: runOn(nowMs), running: true, rate }
        : { lock: 'searching', seconds: a.seconds, running: false, rate };
    }
    if (!locked) return { lock: 'searching', seconds: a.seconds, running: false, rate };
    if (since <= dropout + this.freewheelMs) return { lock: 'freewheel', seconds: runOn(nowMs), running: true, rate };
    return { lock: 'lost', seconds: runOn(this.lastFrameAt + dropout + this.freewheelMs), running: false, rate };
  }
}

// ─── Runtime ─────────────────────────────────────────────────────────────

export interface ChaseStatus {
  lock: ChaseLock;
  /** Last timecode label received, formatted. */
  label: string | null;
  rate: TimecodeRate | null;
  dropFrame: boolean;
  /** Chased show time (timecode minus offset), seconds. */
  showTime: number | null;
  running: boolean;
  framesReceived: number;
  /** LTC input peak, 0..1, for the level meter. */
  inputPeak: number;
  error: string | null;
  /** MIDI clock / Link: the source's tempo, quarter-note BPM. */
  sourceBpm: number | null;
  /** The show map's tempo at the chased position. */
  showBpm: number | null;
  /** Rolling at a tempo the map does not have (kept following; audio re-syncs). */
  mismatch: boolean;
  /** Link quantised start: Play pressed, waiting for the next Link bar. */
  waiting: boolean;
  /** Why the show's Play did nothing (Link follows the session's start). */
  notice: ChaseNotice | null;
}

/**
 * linkNoPeers: Play pressed while following the Link session's start, with
 *   no other Link app on the network to start it.
 * linkStartsWithSession: the same with peers: the session has to start.
 */
export type ChaseNotice = 'linkNoPeers' | 'linkStartsWithSession';
/** How long a notice stays up unless the session starts first. */
export const CHASE_NOTICE_MS = 8000;

export interface ChaseSample extends ChaseReading {
  showTime: number | null;
}

export type ChaseSink = (sample: ChaseSample, settings: TimecodeSettings) => void;

function initialStatus(): ChaseStatus {
  return {
    lock: 'off', label: null, rate: null, dropFrame: false, showTime: null, running: false, framesReceived: 0, inputPeak: 0, error: null,
    sourceBpm: null, showBpm: null, mismatch: false, waiting: false, notice: null,
  };
}

interface SourceHandle {
  stop(): void;
  /** Link quantised start: the show's transport. True when handled. */
  transport?(op: 'play' | 'pause' | 'stop'): boolean;
}

/** What a musical clock needs from the show: its map and its playhead. */
export type ShowClockContext = () => { map: ShowTempoMap | null; playhead: number; playing: boolean };

class TimecodeChaseController {
  readonly settings = writable<TimecodeSettings>(defaultTimecodeSettings());
  readonly status = writable<ChaseStatus>(initialStatus());
  readonly clock = new ChaseClock();
  private sink: ChaseSink | null = null;
  private source: SourceHandle | null = null;
  private sourceKey = '';
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private lastStatusAt = 0;
  private lastLabel: Timecode | null = null;
  private frames = 0;
  private peak = 0;
  private startToken = 0;
  private showContext: ShowClockContext | null = null;
  private sourceBpm: number | null = null;
  private waiting = false;
  private notice: { kind: ChaseNotice; until: number } | null = null;

  setSink(sink: ChaseSink | null): void {
    this.sink = sink;
  }

  /** The show's map and playhead, for MIDI clock and Link. */
  setShowContext(context: ShowClockContext | null): void {
    this.showContext = context;
  }

  showClock(): ReturnType<ShowClockContext> {
    return this.showContext?.() ?? { map: null, playhead: 0, playing: false };
  }

  /**
   * The show's own Play / Pause / Stop while it follows a clock. Only Link's
   * quantised start uses it (Play waits for the next Link bar); the other
   * sources own the transport. True when the source handled it.
   */
  transport(op: 'play' | 'pause' | 'stop'): boolean {
    try {
      return this.source?.transport?.(op) ?? false;
    } catch {
      return false;
    }
  }

  /** Feed a position from a musical clock: show seconds at `atMs`. */
  feedBeats(showSeconds: number, atMs: number, running: boolean, sourceBpm: number | null, waiting = false): void {
    // Between positions show time runs at the source's tempo over the
    // map's: a source at 126 BPM plays a 120 BPM map 5% fast.
    const map = this.showClock().map;
    const showBpm = map && Number.isFinite(showSeconds) ? showTempoAt(map, showSeconds) : null;
    const rate = sourceBpm && sourceBpm > 0 && showBpm && showBpm > 0
      ? Math.max(0.25, Math.min(4, sourceBpm / showBpm))
      : 1;
    // The chase clock works in source seconds; beats arrive as show time.
    this.clock.onFrame(showSeconds + this.current.offset, atMs, running, rate);
    this.lastLabel = null;
    this.frames++;
    this.sourceBpm = sourceBpm;
    this.waiting = waiting;
    if (running) this.notice = null;
  }

  /** A musical clock still parked: refresh its tempo and waiting state
   *  without a new position, so the parked show stays where the user puts it. */
  noteBeats(sourceBpm: number | null, waiting = false): void {
    this.sourceBpm = sourceBpm;
    this.waiting = waiting;
  }

  /** Say why the show's Play did nothing (cleared when the source rolls). */
  setNotice(kind: ChaseNotice | null, nowMs = performance.now()): void {
    this.notice = kind ? { kind, until: nowMs + CHASE_NOTICE_MS } : null;
    this.lastStatusAt = -Infinity;
  }

  get current(): TimecodeSettings {
    return get(this.settings);
  }

  configure(patch: Partial<TimecodeSettings>): void {
    this.settings.update((s) => normalizeTimecodeSettings({ ...s, ...patch }));
    this.clock.freewheelMs = this.current.freewheelSeconds * 1000;
    void this.applySource();
  }

  serialize(): TimecodeSettings & { version: number } {
    return { version: 1, ...this.current };
  }

  /** Project load. A saved source is restored but never auto-started with
   *  a device prompt mid-load: it starts on the next tick of the event loop. */
  hydrate(payload: unknown): void {
    this.settings.set(normalizeTimecodeSettings(payload));
    this.clock.freewheelMs = this.current.freewheelSeconds * 1000;
    void this.applySource();
  }

  /** Feed a frame from any source. `seconds` is timecode seconds at `atMs`. */
  feed(seconds: number, atMs: number, running: boolean, label: Timecode): void {
    this.clock.onFrame(seconds, atMs, running);
    this.lastLabel = label;
    this.frames++;
  }

  /** Called by the LTC source for each decoded frame. */
  feedLtc(frame: LtcFrame, atMs: number): void {
    const s = this.current;
    const rate = s.rate === 'auto' ? frame.rate : s.rate;
    const tc = ltcFrameToTimecode(frame, rate);
    // The frame just ENDED at atMs: now is its label plus one frame.
    this.feed(timecodeToSeconds(tc) + 1 / actualFps(rate), atMs, true, tc);
  }

  setInputPeak(peak: number): void {
    this.peak = peak;
  }

  private startLoop(): void {
    if (this.loopTimer) return;
    this.loopTimer = setInterval(() => this.step(), 16);
  }

  private stopLoop(): void {
    if (this.loopTimer) clearInterval(this.loopTimer);
    this.loopTimer = null;
  }

  /** One evaluation: read the clock, drive the sink, refresh the status. */
  step(nowMs = performance.now()): ChaseSample {
    const s = this.current;
    const reading = this.clock.read(nowMs);
    const sample: ChaseSample = {
      ...reading,
      showTime: reading.seconds === null ? null : reading.seconds - s.offset,
    };
    if (s.source !== 'off') {
      try {
        this.sink?.(sample, s);
      } catch (err) {
        console.warn('[Timecode] chase sink failed:', err);
      }
    }
    if (this.notice && nowMs >= this.notice.until) {
      this.notice = null;
      this.lastStatusAt = -Infinity;
    }
    if (nowMs - this.lastStatusAt >= 100 || get(this.status).lock !== reading.lock) {
      this.lastStatusAt = nowMs;
      const label = this.lastLabel;
      const beats = isBeatSource(s.source);
      const map = beats ? this.showClock().map : null;
      const showBpm = map && sample.showTime !== null ? showTempoAt(map, sample.showTime) : null;
      this.status.update((st) => ({
        ...st,
        lock: s.source === 'off' ? 'off' : reading.lock,
        label: beats
          ? (map && sample.showTime !== null ? formatBarsBeats(map, sample.showTime) : null)
          : reading.seconds !== null && label
            ? formatTimecode(secondsToTimecode(reading.seconds, label.rate, label.dropFrame))
            : label ? formatTimecode(label) : null,
        sourceBpm: beats && this.sourceBpm !== null ? Math.round(this.sourceBpm * 10) / 10 : null,
        showBpm,
        // Only while the source rolls: a parked session's tempo is no warning.
        mismatch: beats && reading.running && tempoMismatch(showBpm, this.sourceBpm),
        waiting: beats && this.waiting,
        notice: beats ? this.notice?.kind ?? null : null,
        rate: label?.rate ?? null,
        dropFrame: label?.dropFrame ?? false,
        showTime: sample.showTime,
        running: reading.running,
        framesReceived: this.frames,
        inputPeak: this.peak,
      }));
    }
    return sample;
  }

  private async applySource(): Promise<void> {
    const s = this.current;
    const key = s.source === 'ltc' ? `ltc:${s.ltcDeviceId}:${s.ltcChannel}`
      : s.source === 'mtc' ? `mtc:${s.mtcInputId}`
      : s.source === 'midiClock' ? `midiClock:${s.mtcInputId}`
      : s.source === 'link' ? 'link'
      : 'off';
    if (key === this.sourceKey) return;
    this.stopSource();
    this.sourceKey = key;
    if (s.source === 'off') {
      this.status.set(initialStatus());
      return;
    }
    const token = ++this.startToken;
    this.status.set({ ...initialStatus(), lock: 'searching' });
    this.startLoop();
    try {
      const handle = s.source === 'ltc'
        ? await startLtcInput(this, s.ltcDeviceId, s.ltcChannel)
        : s.source === 'midiClock'
          ? await startMidiClockInput(this, s.mtcInputId)
          : s.source === 'link'
            ? await startLinkFollow(this)
            : await startMtcInput(this, s.mtcInputId);
      if (token !== this.startToken) {
        handle.stop();
        return;
      }
      this.source = handle;
    } catch (err) {
      if (token !== this.startToken) return;
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[Timecode] source failed:', err);
      this.status.update((st) => ({ ...st, error: message }));
    }
  }

  private stopSource(): void {
    this.startToken++;
    this.source?.stop();
    this.source = null;
    this.sourceKey = '';
    this.stopLoop();
    this.clock.reset();
    this.lastLabel = null;
    this.frames = 0;
    this.peak = 0;
    this.sourceBpm = null;
    this.waiting = false;
    this.notice = null;
  }

  /** Stop listening (app teardown). Settings are kept. */
  shutdown(): void {
    this.stopSource();
    this.status.set(initialStatus());
  }

  /**
   * Test and loopback seam: decode LTC from an arbitrary audio node in an
   * existing context (an AudioBufferSourceNode playing a generated signal)
   * through the real worklet.
   */
  async attachLtcNode(ctx: AudioContext, node: AudioNode, channel = 0): Promise<SourceHandle> {
    this.stopSource();
    this.sourceKey = 'ltc:node';
    this.settings.update((s) => ({ ...s, source: 'ltc' }));
    this.status.set({ ...initialStatus(), lock: 'searching' });
    this.startLoop();
    const handle = await connectLtcWorklet(this, ctx, node, channel);
    this.source = handle;
    return handle;
  }
}

// ─── Sources ─────────────────────────────────────────────────────────────

async function connectLtcWorklet(
  chase: TimecodeChaseController,
  ctx: AudioContext,
  node: AudioNode,
  channel: number,
): Promise<SourceHandle> {
  const { default: workletUrl } = await import('./ltcWorklet.ts?worker&url');
  await ctx.audioWorklet.addModule(workletUrl);
  const decoder = new AudioWorkletNode(ctx, 'ghost-ltc-decoder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [1],
    channelCountMode: 'explicit',
    channelCount: 2,
    channelInterpretation: 'discrete',
  });
  decoder.port.postMessage({ type: 'channel', channel });
  decoder.port.onmessage = (e: MessageEvent) => {
    const data = e.data as { type: string; frame?: LtcFrame; lagSamples?: number; sampleRate?: number; peak?: number };
    if (data.type === 'frame' && data.frame) {
      const lagMs = ((data.lagSamples ?? 0) / (data.sampleRate || ctx.sampleRate)) * 1000;
      chase.feedLtc(data.frame, performance.now() - lagMs);
    } else if (data.type === 'level') {
      chase.setInputPeak(data.peak ?? 0);
    }
  };
  // A worklet is only pulled while it leads somewhere; a muted gain keeps it
  // in the graph without making a sound.
  const mute = ctx.createGain();
  mute.gain.value = 0;
  node.connect(decoder);
  decoder.connect(mute);
  mute.connect(ctx.destination);
  return {
    stop() {
      try { node.disconnect(decoder); } catch { /* already */ }
      try { decoder.disconnect(); mute.disconnect(); } catch { /* already */ }
      decoder.port.onmessage = null;
    },
  };
}

async function startLtcInput(chase: TimecodeChaseController, deviceId: string, channel: number): Promise<SourceHandle> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) throw new Error('No audio input available');
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: { ideal: 2 },
    },
  });
  const ctx = new AudioContext({ latencyHint: 'interactive' });
  try {
    const src = ctx.createMediaStreamSource(stream);
    const handle = await connectLtcWorklet(chase, ctx, src, channel);
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
    return {
      stop() {
        handle.stop();
        for (const t of stream.getTracks()) t.stop();
        void ctx.close().catch(() => {});
      },
    };
  } catch (err) {
    for (const t of stream.getTracks()) t.stop();
    void ctx.close().catch(() => {});
    throw err;
  }
}

async function startMtcInput(chase: TimecodeChaseController, inputId: string): Promise<SourceHandle> {
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) throw new Error('Web MIDI is not available');
  // Our own access with SysEx on: full-frame locates are SysEx, and the
  // shared MIDI manager asks without it.
  const access = await navigator.requestMIDIAccess({ sysex: true });
  const parser = new MtcParser();
  const listening = new Set<MIDIInput>();
  const onMessage = (e: Event) => {
    const m = e as MIDIMessageEvent;
    if (!m.data) return;
    for (const ev of parser.feed(m.data, m.timeStamp || performance.now())) {
      const s = chase.current;
      const tc = s.rate === 'auto' || s.rate === ev.timecode.rate ? ev.timecode : { ...ev.timecode, rate: s.rate };
      const seconds = tc === ev.timecode ? ev.seconds : ev.seconds - timecodeToSeconds(ev.timecode) + timecodeToSeconds(tc);
      chase.feed(seconds, ev.atMs, ev.running, tc);
    }
  };
  const attach = () => {
    access.inputs.forEach((input) => {
      if (inputId && input.id !== inputId) return;
      if (listening.has(input)) return;
      input.addEventListener('midimessage', onMessage);
      listening.add(input);
    });
  };
  attach();
  const onState = () => attach();
  access.addEventListener('statechange', onState);
  return {
    stop() {
      access.removeEventListener('statechange', onState);
      for (const input of listening) input.removeEventListener('midimessage', onMessage);
      listening.clear();
    },
  };
}

/** MIDI clock + Song Position on Web MIDI (its own access, like MTC). */
async function startMidiClockInput(chase: TimecodeChaseController, inputId: string): Promise<SourceHandle> {
  if (typeof navigator === 'undefined' || !navigator.requestMIDIAccess) throw new Error('Web MIDI is not available');
  const access = await navigator.requestMIDIAccess({ sysex: false });
  const parser = new MidiClockParser();
  const listening = new Set<MIDIInput>();
  const onMessage = (e: Event) => {
    const m = e as MIDIMessageEvent;
    const data = m.data;
    if (!data || !data.length) return;
    const status = data[0];
    if (status !== 0xf2 && status !== 0xf8 && status !== 0xfa && status !== 0xfb && status !== 0xfc) return;
    const atMs = m.timeStamp || performance.now();
    const ev = parser.feed(data, atMs);
    if (!ev) return;
    const { map } = chase.showClock();
    if (!map) return;
    const s = chase.current;
    const seconds = showSecondsForSourceQuarters(map, ev.quarters, s.barOffset);
    chase.feedBeats(seconds, ev.atMs, ev.kind === 'tick', parser.bpm);
  };
  const attach = () => {
    access.inputs.forEach((input) => {
      if (inputId && input.id !== inputId) return;
      if (listening.has(input)) return;
      input.addEventListener('midimessage', onMessage);
      listening.add(input);
    });
  };
  attach();
  const onState = () => attach();
  access.addEventListener('statechange', onState);
  return {
    stop() {
      access.removeEventListener('statechange', onState);
      for (const input of listening) input.removeEventListener('midimessage', onMessage);
      listening.clear();
    },
  };
}

/** Link polls while following: start detection is at most one poll late. */
export const LINK_FOLLOW_POLL_MS = 60;

/** Ableton Link: start/stop + phase lock, or quantised start (beatChase.ts). */
async function startLinkFollow(chase: TimecodeChaseController): Promise<SourceHandle> {
  if (!get(abletonLink).enabled) {
    const ok = await abletonLink.enable();
    if (!ok) throw new Error(get(abletonLink).error || 'Ableton Link is not available');
  }
  const follower = new LinkFollower();
  let stopped = false;
  let busy = false;
  let peers = 0;
  let sessionPlaying = false;
  // Parked, Link says nothing about where the show is (a parked reading is
  // the show's own playhead), so a park is fed once, not every poll: a
  // stale playhead from a poll would pull back a playhead being dragged.
  let parkedFed = false;
  const poll = async () => {
    if (stopped || busy) return;
    busy = true;
    try {
      // Read Link's beat against the show's bar length, so its bars are the
      // ones peers with that bar length (a 6/8 set in Live: 3) agree on.
      const before = chase.showClock();
      const quantum = before.map
        ? follower.quantum({ map: before.map, playhead: before.playhead, mode: chase.current.linkMode, barOffset: chase.current.barOffset })
        : 4;
      const sentAt = performance.now();
      const st = (await invoke('link_get_state', { quantum })) as { enabled?: boolean; beat?: number; tempo?: number; playing?: boolean; peers?: number; quantum?: number } | null;
      if (stopped || !st?.enabled || !Number.isFinite(st.beat) || !(Number(st.tempo) > 0)) return;
      peers = Number(st.peers) || 0;
      sessionPlaying = !!st.playing;
      const now = performance.now();
      // The state was captured about half way through the round trip.
      const atMs = sentAt + (now - sentAt) / 2;
      const show = chase.showClock();
      if (!show.map) return;
      const s = chase.current;
      // An older main ignores the quantum and reads against 4: use what came back.
      const readQuantum = Number(st.quantum) > 0 ? Number(st.quantum) : quantum;
      const reading = follower.update(
        { beat: Number(st.beat), tempo: Number(st.tempo), playing: sessionPlaying, atMs, quantum: readQuantum },
        { map: show.map, playhead: show.playhead, mode: s.linkMode, barOffset: s.barOffset },
      );
      if (reading.running || !parkedFed) chase.feedBeats(reading.seconds, atMs, reading.running, Number(st.tempo), reading.waiting);
      else chase.noteBeats(Number(st.tempo), reading.waiting);
      parkedFed = !reading.running;
    } catch {
      /* main not ready: the chase clock rides out the gap */
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void poll(), LINK_FOLLOW_POLL_MS);
  void poll();
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    transport(op) {
      if (chase.current.linkMode !== 'quantisedStart') {
        // The session's own start and stop drive the show: say so, rather
        // than doing nothing, when Play is pressed and nothing will start it.
        if (op === 'play' && !sessionPlaying) chase.setNotice(peers > 0 ? 'linkStartsWithSession' : 'linkNoPeers');
        return false;
      }
      if (op === 'play') follower.request(!(follower.requested && !chase.showClock().playing));
      else follower.request(false);
      // Park the chase clock now, where the show is going (Stop: the top), so
      // the last rolling reading cannot restart the show before the next poll.
      if (!follower.requested) {
        const show = chase.showClock();
        chase.feedBeats(op === 'stop' ? 0 : show.playhead, performance.now(), false, null);
        parkedFed = true;
      }
      void poll();
      return true;
    },
  };
}

export const timecodeChase = new TimecodeChaseController();
export type { TimecodeChaseController };
