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
 */

import { writable, get } from 'svelte/store';
import { LtcDecoder, ltcFrameToTimecode, type LtcFrame } from './ltc';
import { MtcParser } from './mtc';
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

export type TimecodeSource = 'off' | 'ltc' | 'mtc';

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
  /** MIDI input id for MTC; '' listens to every input. */
  mtcInputId: string;
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
  };
}

export function normalizeTimecodeSettings(raw: unknown): TimecodeSettings {
  const d = defaultTimecodeSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const offset = Number(r.offset);
  const freewheel = Number(r.freewheelSeconds);
  return {
    source: r.source === 'ltc' || r.source === 'mtc' ? r.source : 'off',
    rate: isTimecodeRate(r.rate) ? r.rate : 'auto',
    offset: Number.isFinite(offset) ? offset : 0,
    freewheelSeconds: Number.isFinite(freewheel) ? Math.max(0, Math.min(60, freewheel)) : d.freewheelSeconds,
    chaseTimeline: r.chaseTimeline !== false,
    chaseCues: r.chaseCues !== false,
    ltcDeviceId: typeof r.ltcDeviceId === 'string' ? r.ltcDeviceId : '',
    ltcChannel: r.ltcChannel === 1 ? 1 : 0,
    mtcInputId: typeof r.mtcInputId === 'string' ? r.mtcInputId : '',
  };
}

// ─── Chase clock (pure) ──────────────────────────────────────────────────

export type ChaseLock = 'off' | 'searching' | 'locked' | 'freewheel' | 'lost';

export interface ChaseReading {
  lock: ChaseLock;
  /** Timecode seconds (before the offset) at the read instant. */
  seconds: number | null;
  running: boolean;
}

export class ChaseClock {
  private anchor: { seconds: number; atMs: number } | null = null;
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
   */
  onFrame(seconds: number, atMs: number, running = true): void {
    if (this.anchor) {
      const dt = atMs - this.lastFrameAt;
      if (dt > 0 && dt < 1000) this.interval = this.interval ? this.interval * 0.8 + dt * 0.2 : dt;
      const predicted = this.sourceRunning ? this.anchor.seconds + (atMs - this.anchor.atMs) / 1000 : this.anchor.seconds;
      const tolerance = Math.max(0.1, (2.5 * (this.interval || 40)) / 1000);
      const continuous = Math.abs(seconds - predicted) <= tolerance || (!this.sourceRunning && running);
      this.streak = continuous ? this.streak + 1 : 1;
      this.still = running && Math.abs(seconds - this.anchor.seconds) < 1e-6 ? this.still + 1 : 0;
    } else {
      this.streak = 1;
      this.still = 0;
    }
    this.anchor = { seconds, atMs };
    this.lastFrameAt = atMs;
    // A generator paused on one frame keeps repeating it: parked, not rolling.
    this.sourceRunning = running && this.still < 2;
    if (!running) this.streak = Math.max(this.streak, this.lockFrames);
  }

  read(nowMs: number): ChaseReading {
    const a = this.anchor;
    if (!a) return { lock: 'searching', seconds: null, running: false };
    const since = nowMs - this.lastFrameAt;
    const locked = this.streak >= this.lockFrames;
    const runOn = (at: number) => a.seconds + Math.max(0, at - a.atMs) / 1000;
    if (!this.sourceRunning) {
      return { lock: locked ? 'locked' : 'searching', seconds: a.seconds, running: false };
    }
    const dropout = this.dropoutMs();
    if (since <= dropout) {
      return locked
        ? { lock: 'locked', seconds: runOn(nowMs), running: true }
        : { lock: 'searching', seconds: a.seconds, running: false };
    }
    if (!locked) return { lock: 'searching', seconds: a.seconds, running: false };
    if (since <= dropout + this.freewheelMs) return { lock: 'freewheel', seconds: runOn(nowMs), running: true };
    return { lock: 'lost', seconds: runOn(this.lastFrameAt + dropout + this.freewheelMs), running: false };
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
}

export interface ChaseSample extends ChaseReading {
  showTime: number | null;
}

export type ChaseSink = (sample: ChaseSample, settings: TimecodeSettings) => void;

function initialStatus(): ChaseStatus {
  return { lock: 'off', label: null, rate: null, dropFrame: false, showTime: null, running: false, framesReceived: 0, inputPeak: 0, error: null };
}

interface SourceHandle {
  stop(): void;
}

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

  setSink(sink: ChaseSink | null): void {
    this.sink = sink;
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
    if (nowMs - this.lastStatusAt >= 100 || get(this.status).lock !== reading.lock) {
      this.lastStatusAt = nowMs;
      const label = this.lastLabel;
      this.status.update((st) => ({
        ...st,
        lock: s.source === 'off' ? 'off' : reading.lock,
        label: reading.seconds !== null && label
          ? formatTimecode(secondsToTimecode(reading.seconds, label.rate, label.dropFrame))
          : label ? formatTimecode(label) : null,
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
    const key = s.source === 'ltc' ? `ltc:${s.ltcDeviceId}:${s.ltcChannel}` : s.source === 'mtc' ? `mtc:${s.mtcInputId}` : 'off';
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

export const timecodeChase = new TimecodeChaseController();
export type { TimecodeChaseController };
