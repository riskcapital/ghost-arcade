/**
 * The band looper: bars of the band recorded in time and played back as
 * loops, so the performer can take part in the music.
 *
 * The band (after its EQ and pan: what its effects hear) goes into an
 * AudioWorklet that records from one bar line to another by the audio
 * clock's sample frames (looperWorklet.ts), so a loop is exactly its bars
 * long and its first frame is the bar line. A loop plays on an
 * AudioBufferSourceNode looping the whole buffer, started on a bar line in
 * the phase of the bars it was recorded on. A new recording plays on from
 * the bar line where it ends: its first half second comes back early and
 * starts on that line, and the loop takes over from it once the rest has
 * arrived.
 *
 * While a loop plays its speed follows the clock (looperMath.ts:
 * followStep): small tempo moves, and the slow drift between the audio
 * clock and the launch clock, are taken up by tiny changes of speed. After
 * a big tempo change a loop keeps its own length.
 *
 * Two loops, A and B, each into a level of its own and on into the studio's
 * mix.
 */

import { holdAt } from './sounds/kit';
import {
  BEATS_PER_BAR,
  FOLLOW_START,
  followStep,
  longestLength,
  loopOffset,
  loopPosition,
  nextBarBeat,
  phaseError,
  recordWindow,
  shortenWindow,
  startRate,
  timeOfBeat,
  type ClockReading,
  type FollowState,
  type RecordWindow,
} from './looperMath';

export type LoopSlotId = 0 | 1;
export const LOOP_SLOT_IDS: readonly LoopSlotId[] = [0, 1];
export const LOOP_SLOT_NAMES = ['A', 'B'] as const;

/** The first half second of a take comes back early, to start the loop on the bar line. */
const HEAD_SECONDS = 0.5;
/** How often a playing loop is checked against the clock. */
const FOLLOW_MS = 100;
/** A recording that has not come back this long after its end is given up. */
const TAKE_TIMEOUT_MS = 2500;
/** Crossfade when one sound of a slot takes over from another. */
const HANDOVER_SECONDS = 0.01;

interface Loop {
  buffer: AudioBuffer;
  bars: number;
  /** The launch-clock beat it was recorded from (a bar line). */
  originBeat: number;
  /** A beat's length when it was recorded. */
  beatMs: number;
}

/** A source behind a gain that rises from 0 to 1 over `rise` from `startAt`. */
interface Faded {
  src: AudioBufferSourceNode;
  env: GainNode;
  startAt: number;
  rise: number;
}

interface Voice extends Faded {
  /** Where it was (seconds of the loop) at `anchorTime`, and its rate since. */
  anchorPos: number;
  anchorTime: number;
  rate: number;
  follow: FollowState;
  started: boolean;
}

interface Slot {
  loop: Loop | null;
  level: GainNode;
  voice: Voice | null;
  ownLength: boolean;
}

interface Recording {
  id: number;
  slot: LoopSlotId;
  window: RecordWindow;
  headBuffer: AudioBuffer | null;
  head: Faded | null;
  watchdog: ReturnType<typeof setTimeout> | null;
  done: (ok: boolean) => void;
}

type CaptureMessage =
  | { type: 'head'; id: number; channels: Float32Array<ArrayBuffer>[] }
  | { type: 'take'; id: number; start: number; end: number; channels: Float32Array<ArrayBuffer>[]; missed: number };

export type LoopSlotState = 'empty' | 'stopped' | 'queued' | 'playing';

export interface LoopSlotInfo {
  bars: number;
  state: LoopSlotState;
  /** Playing at its recorded speed: the tempo has moved too far to follow. */
  ownLength: boolean;
}

export class BandLooper {
  private readonly slots: Slot[];
  private clock: (() => ClockReading) | null = null;
  private capture: AudioWorkletNode | null = null;
  private captureLoading: Promise<AudioWorkletNode | null> | null = null;
  /** Bumped by clear(), so a worklet still loading from before is not wired in. */
  private generation = 0;
  private serial = 0;
  private rec: Recording | null = null;
  private ticker: ReturnType<typeof setInterval> | null = null;
  /** Called when something the panel shows changes on its own (a take came back, a loop started on its bar). */
  onChange: (() => void) | null = null;

  constructor(private readonly ctx: AudioContext, private readonly band: AudioNode, out: AudioNode) {
    this.slots = LOOP_SLOT_IDS.map(() => {
      const level = ctx.createGain();
      level.gain.value = 0.8;
      level.connect(out);
      return { loop: null, level, voice: null, ownLength: false };
    });
  }

  /** Where the launch clock is now. Recordings and loops land on its bar lines. */
  setClock(clock: () => ClockReading): void {
    this.clock = clock;
  }

  /** The audio clock. */
  now(): number {
    return this.ctx.currentTime;
  }

  /** Start listening to the band, so a recording can be asked for. False when it cannot (no audio worklets). */
  async prepare(): Promise<boolean> {
    return (await this.ensureCapture()) !== null;
  }

  get recording(): { slot: LoopSlotId; window: RecordWindow } | null {
    return this.rec ? { slot: this.rec.slot, window: this.rec.window } : null;
  }

  slotInfo(id: LoopSlotId): LoopSlotInfo {
    const slot = this.slots[id];
    const state: LoopSlotState = !slot.loop ? 'empty' : !slot.voice ? 'stopped' : this.ctx.currentTime < slot.voice.startAt ? 'queued' : 'playing';
    return { bars: slot.loop?.bars ?? 0, state, ownLength: slot.voice ? slot.ownLength : false };
  }

  buffer(id: LoopSlotId): AudioBuffer | null {
    return this.slots[id].loop?.buffer ?? null;
  }

  /**
   * Record `bars` bars of the band into a slot from the next bar line (fewer
   * when they would run over MAX_RECORD_SECONDS at this tempo); when it has
   * come back it plays on from the bar line where it ended. `done` hears
   * whether it came back. Null when nothing can be recorded: call prepare()
   * first.
   */
  record(id: LoopSlotId, bars: number, done: (ok: boolean) => void): RecordWindow | null {
    const node = this.capture;
    const clock = this.clock?.();
    if (!node || !clock || !(clock.beatMs > 0) || this.rec) return null;
    const fit = Math.min(bars, longestLength(clock.beatMs));
    if (fit < 1) return null;
    const sr = this.ctx.sampleRate;
    const window = recordWindow(this.ctx.currentTime, clock, fit, sr);
    const length = window.endFrame - window.startFrame;
    const headLength = Math.min(length, Math.round(HEAD_SECONDS * sr));
    // Allocated here, not on the audio thread, and handed over.
    const channels = [new Float32Array(length), new Float32Array(length)];
    const head = [new Float32Array(headLength), new Float32Array(headLength)];
    const rec: Recording = { id: ++this.serial, slot: id, window, headBuffer: null, head: null, watchdog: null, done };
    this.rec = rec;
    node.port.postMessage(
      { type: 'record', id: rec.id, start: window.startFrame, end: window.endFrame, channels, head },
      [...channels, ...head].map((c) => c.buffer),
    );
    this.armWatchdog(rec);
    return window;
  }

  /** End the recording on its next bar line instead (after at least one bar). */
  endRecordingSoon(): RecordWindow | null {
    const rec = this.rec;
    if (!rec || !this.capture) return null;
    const window = shortenWindow(rec.window, this.ctx.currentTime, this.ctx.sampleRate);
    if (window === rec.window) return window;
    rec.window = window;
    this.capture.port.postMessage({ type: 'end', id: rec.id, end: window.endFrame });
    this.armWatchdog(rec);
    this.scheduleHead(rec);
    return window;
  }

  cancelRecording(): void {
    const rec = this.rec;
    if (!rec) return;
    this.rec = null;
    if (rec.watchdog) clearTimeout(rec.watchdog);
    this.capture?.port.postMessage({ type: 'cancel', id: rec.id });
    this.stopHead(rec, 0.01);
  }

  /** Play a loop from the next bar line, in the phase of the bars it was recorded on. */
  play(id: LoopSlotId): void {
    const slot = this.slots[id];
    const loop = slot.loop;
    if (!loop || slot.voice) return;
    // Recording into this slot: the old loop plays until the new one takes over.
    if (this.rec?.slot === id) this.stopHead(this.rec, 0.005);
    const now = this.ctx.currentTime;
    const clock = this.clock?.();
    if (!clock || !(clock.beatMs > 0)) {
      this.startVoice(slot, now + 0.02, 0, 0.004);
    } else {
      const beat = nextBarBeat(clock.beat, clock.beatMs);
      const offset = loopOffset(beat, loop.originBeat, loop.bars * BEATS_PER_BAR, loop.buffer.duration);
      this.startVoice(slot, timeOfBeat(beat, clock, now), offset, 0.002);
    }
    this.ensureTicker();
  }

  /** Stop a loop now, with a short fade. */
  stop(id: LoopSlotId, fade = 0.03): void {
    this.stopVoice(this.slots[id], fade);
    // Recording into this slot: the new take now starts on its bar line by itself.
    if (this.rec?.slot === id) this.scheduleHead(this.rec);
  }

  toggle(id: LoopSlotId): void {
    if (this.slots[id].voice) this.stop(id);
    else this.play(id);
  }

  setLevel(id: LoopSlotId, level: number): void {
    const gain = this.slots[id].level.gain;
    gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.ctx.currentTime, 0.02);
  }

  /** Silence now (the kill switch): the recording is dropped, the loops stop and are kept. */
  kill(): void {
    this.cancelRecording();
    for (const slot of this.slots) this.stopVoice(slot, 0.02);
  }

  /** Stop and let everything go: the loops, the recorder and its worklet (the studio closing). */
  clear(): void {
    this.kill();
    for (const slot of this.slots) slot.loop = null;
    if (this.ticker) clearInterval(this.ticker);
    this.ticker = null;
    this.generation++;
    this.captureLoading = null;
    const node = this.capture;
    this.capture = null;
    if (node) {
      node.port.onmessage = null;
      node.onprocessorerror = null;
      try { node.port.close(); } catch { /* closed */ }
      try { this.band.disconnect(node); } catch { /* not connected */ }
    }
  }

  dispose(): void {
    this.clear();
    this.onChange = null;
    for (const slot of this.slots) {
      try { slot.level.disconnect(); } catch { /* gone */ }
    }
  }

  // ── Playing ──

  private ratio(loop: Loop): number {
    const clock = this.clock?.();
    return clock && clock.beatMs > 0 ? loop.beatMs / clock.beatMs : 1;
  }

  private startVoice(slot: Slot, at: number, offset: number, fadeIn: number): void {
    const loop = slot.loop!;
    const ctx = this.ctx;
    const ratio = this.ratio(loop);
    const rate = startRate(ratio);
    const src = ctx.createBufferSource();
    src.buffer = loop.buffer;
    src.loop = true;
    src.playbackRate.value = rate;
    const rise = Math.max(0.001, fadeIn);
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + rise);
    src.connect(env).connect(slot.level);
    src.onended = () => { try { env.disconnect(); } catch { /* gone */ } };
    src.start(at, offset);
    slot.voice = { src, env, startAt: at, rise, anchorPos: offset, anchorTime: at, rate, follow: FOLLOW_START, started: false };
    slot.ownLength = rate !== ratio;
  }

  private stopVoice(slot: Slot, fade: number, at = this.ctx.currentTime): void {
    const v = slot.voice;
    if (!v) return;
    slot.voice = null;
    slot.ownLength = false;
    this.fadeOut(v, fade, at);
  }

  /**
   * Fade a source out from `at` and stop it. The ramp is anchored at `at`
   * itself: after a ramp that has finished, cancelAndHoldAtTime adds no
   * event, and a new ramp would run from where the old one ended.
   */
  private fadeOut(f: Faded, fade: number, at: number): void {
    const when = Math.max(at, this.ctx.currentTime);
    const level = Math.max(0, Math.min(1, (when - f.startAt) / f.rise));
    try {
      holdAt(f.env.gain, when);
      f.env.gain.setValueAtTime(level, when);
      f.env.gain.linearRampToValueAtTime(0, when + fade);
      f.src.stop(when + fade + 0.01);
    } catch { /* already stopped */ }
  }

  private ensureTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), FOLLOW_MS);
  }

  /** Check each playing loop against the clock, and say when a queued one has started. */
  private tick(): void {
    if (!this.slots.some((s) => s.voice)) {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = null;
      return;
    }
    const now = this.ctx.currentTime;
    const clock = this.clock?.();
    let changed = false;
    for (const slot of this.slots) {
      const v = slot.voice;
      const loop = slot.loop;
      if (!v || !loop || now < v.startAt) continue;
      if (!v.started) {
        v.started = true;
        changed = true;
      }
      if (!clock || !(clock.beatMs > 0)) continue;
      const duration = loop.buffer.duration;
      const expected = loopOffset(clock.beat, loop.originBeat, loop.bars * BEATS_PER_BAR, duration);
      const actual = loopPosition(v.anchorPos, v.anchorTime, v.rate, now, duration);
      const step = followStep(v.follow, loop.beatMs / clock.beatMs, phaseError(expected, actual, duration));
      v.follow = step.state;
      if (step.ownLength !== slot.ownLength) {
        slot.ownLength = step.ownLength;
        changed = true;
      }
      if (step.resync) {
        this.restartInPhase(slot, clock, now);
      } else if (Math.abs(step.rate - v.rate) > 1e-6) {
        v.anchorPos = actual;
        v.anchorTime = now;
        v.rate = step.rate;
        v.src.playbackRate.setValueAtTime(step.rate, now);
      }
    }
    if (changed) this.onChange?.();
  }

  /** The clock jumped: crossfade to the loop where the clock says it should be. */
  private restartInPhase(slot: Slot, clock: ClockReading, now: number): void {
    const loop = slot.loop!;
    const at = now + 0.02;
    const beat = clock.beat + ((at - now) * 1000) / clock.beatMs;
    const offset = loopOffset(beat, loop.originBeat, loop.bars * BEATS_PER_BAR, loop.buffer.duration);
    this.stopVoice(slot, 0.015, at);
    this.startVoice(slot, at, offset, 0.015);
    slot.voice!.started = true;
  }

  // ── Recording ──

  private toBuffer(channels: Float32Array<ArrayBuffer>[], length: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(2, Math.max(1, length), this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) buffer.copyToChannel(channels[c].subarray(0, length), c);
    return buffer;
  }

  private onMessage(data: CaptureMessage | null): void {
    const rec = this.rec;
    if (!rec || !data || data.id !== rec.id) return;
    if (data.type === 'head') {
      rec.headBuffer = this.toBuffer(data.channels, data.channels[0]?.length ?? 0);
      this.scheduleHead(rec);
    } else if (data.type === 'take') {
      this.finish(rec, data.channels, data.end - data.start, data.missed);
    }
  }

  /** The head of the take starts on the bar line where the recording ends, unless a loop is playing in its slot. */
  private scheduleHead(rec: Recording): void {
    this.stopHead(rec, 0.005);
    const slot = this.slots[rec.slot];
    const at = rec.window.endTime;
    if (!rec.headBuffer || slot.voice || at < this.ctx.currentTime + 0.005) return;
    const src = this.ctx.createBufferSource();
    src.buffer = rec.headBuffer;
    const rise = 0.002;
    const env = this.ctx.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + rise);
    src.connect(env).connect(slot.level);
    src.onended = () => { try { env.disconnect(); } catch { /* gone */ } };
    src.start(at);
    rec.head = { src, env, startAt: at, rise };
  }

  private stopHead(rec: Recording, fade: number, at = this.ctx.currentTime): void {
    const head = rec.head;
    if (!head) return;
    rec.head = null;
    this.fadeOut(head, fade, at);
  }

  private finish(rec: Recording, channels: Float32Array<ArrayBuffer>[], length: number, missed: number): void {
    this.rec = null;
    if (rec.watchdog) clearTimeout(rec.watchdog);
    if (missed > 0) console.warn(`[BandLooper] The recording missed its first ${missed} frames.`);
    const buffer = this.toBuffer(channels, length);
    const slot = this.slots[rec.slot];
    const w = rec.window;
    slot.loop = { buffer, bars: w.bars, originBeat: w.startBeat, beatMs: (buffer.duration * 1000) / (w.bars * BEATS_PER_BAR) };
    // It plays on from the bar line where it ended, taking over from its
    // head (already playing from that line) or the loop that was in the slot.
    const at = Math.max(this.ctx.currentTime + HANDOVER_SECONDS, w.endTime);
    const offset = (at - w.endTime) % buffer.duration;
    const handover = rec.head !== null || slot.voice !== null;
    if (slot.voice) this.stopVoice(slot, HANDOVER_SECONDS, at);
    this.startVoice(slot, at, offset, handover ? HANDOVER_SECONDS : 0.004);
    this.stopHead(rec, HANDOVER_SECONDS, at);
    this.ensureTicker();
    rec.done(true);
    this.onChange?.();
  }

  private armWatchdog(rec: Recording): void {
    if (rec.watchdog) clearTimeout(rec.watchdog);
    const wait = Math.max(0, (rec.window.endTime - this.ctx.currentTime) * 1000) + TAKE_TIMEOUT_MS;
    rec.watchdog = setTimeout(() => {
      if (this.rec !== rec) return;
      this.cancelRecording();
      rec.done(false);
      this.onChange?.();
    }, wait);
  }

  private ensureCapture(): Promise<AudioWorkletNode | null> {
    if (this.capture) return Promise.resolve(this.capture);
    if (!this.captureLoading) {
      const loading = this.loadCapture(this.generation).finally(() => {
        if (this.captureLoading === loading) this.captureLoading = null;
      });
      this.captureLoading = loading;
    }
    return this.captureLoading;
  }

  private async loadCapture(generation: number): Promise<AudioWorkletNode | null> {
    try {
      if (!this.ctx.audioWorklet) return null;
      const { default: url } = await import('./looperWorklet.ts?worker&url');
      await this.ctx.audioWorklet.addModule(url);
      if (generation !== this.generation) return null;
      const node = new AudioWorkletNode(this.ctx, 'ghost-looper-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 2,
        channelCountMode: 'explicit',
        channelInterpretation: 'speakers',
      });
      node.port.onmessage = (event: MessageEvent<CaptureMessage>) => this.onMessage(event.data);
      node.onprocessorerror = () => {
        console.warn('[BandLooper] The recorder stopped working.');
        const rec = this.rec;
        this.cancelRecording();
        if (this.capture === node) this.capture = null;
        node.port.onmessage = null;
        try { this.band.disconnect(node); } catch { /* not connected */ }
        rec?.done(false);
        this.onChange?.();
      };
      this.band.connect(node);
      this.capture = node;
      return node;
    } catch (err) {
      console.warn('[BandLooper] Recording is not available:', err);
      return null;
    }
  }
}
