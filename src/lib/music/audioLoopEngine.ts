/**
 * Audio loop tracks: a band input recorded into loops, overdubbed in layers.
 *
 * Recording is by the audio clock's sample frames, on the audio thread
 * (looperWorklet.ts): a take covers exactly the frames from one bar line to
 * another, shifted later by the input latency (what is played reaches the
 * recorder that much after it was heard), so a loop's first frame is its bar
 * line as the player heard it. A loop plays on an AudioBufferSourceNode
 * looping the whole buffer, its speed following the launch clock as the band
 * looper's do (looperMath.ts followStep).
 *
 * Overdub records pass after pass, each the frames of one pass of the loop
 * as it plays (from the punch-in bar to the loop end, then whole passes),
 * and sums the pass into the loop as a layer. Layers are kept apart for
 * undo: the mix is their sum. Eight are kept per track, and across tracks
 * the oldest fold together past AUDIO_MEMORY_BUDGET_BYTES, so a four-hour set
 * holds what it plays and a bounded undo, never more.
 *
 * One recording at a time (one capture node): starting another closes the
 * overdub that was running.
 */

import { get } from 'svelte/store';
import type { MusicAudioEngine } from './audioEngine';
import type { AudioLoopTracks, AudioTrackInfo, AudioTrackState } from './audioLoopTracks';
import { holdAt } from './sounds/kit';
import { FOLLOW_START, followStep, loopOffset, loopPosition, phaseError, startRate, type FollowState } from './looperMath';
import {
  LOOP_TRACK_COUNT,
  MAX_AUDIO_LOOP_SECONDS,
  MAX_LAYERS,
  audioBytes,
  findClickOnset,
  foldsForBudget,
  freeRecordEnd,
  inferTempo,
  inputLatencySeconds,
  latencyFrames,
  maxAudioBars,
  nextBarAt,
} from './loopTrack';
import { BEATS_PER_BAR } from './loopRecorder';
import { musicStudio } from './musicStudioStore';
import { encodeWav } from './wav';
import { launchClockPosition, resyncLaunchClock } from '../stores/launchClock';
import { audioStore } from '../stores/audio';

const HEAD_SECONDS = 0.5;
const FOLLOW_MS = 100;
const TAKE_TIMEOUT_MS = 2500;
const HANDOVER = 0.01;
const LEAD = 0.03;

type Stereo = [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];

interface Faded {
  src: AudioBufferSourceNode;
  env: GainNode;
  startAt: number;
  rise: number;
}

interface Voice extends Faded {
  anchorPos: number;
  anchorTime: number;
  rate: number;
  follow: FollowState;
}

interface Track {
  meter: AnalyserNode;
  state: AudioTrackState;
  level: GainNode;
  /** The loop: its layers (each the loop's length) and their sum. */
  layers: Stereo[];
  redo: Stereo[];
  cleared: { layers: Stereo[]; bars: number; originBeat: number; beatMs: number } | null;
  mix: Stereo | null;
  buffer: AudioBuffer | null;
  bars: number;
  originBeat: number;
  beatMs: number;
  voice: Voice | null;
  /** Overdub wanted: passes keep being recorded while on. */
  dubbing: boolean;
}

/** What is being recorded now. */
interface Capture {
  id: number;
  track: number;
  kind: 'first' | 'pass';
  startFrame: number;
  endFrame: number;
  /** First recording: its bar span (startBeat; free = open-ended). */
  startBeat: number;
  free: boolean;
  setsTempo: boolean;
  bars: number;
  /** Pass: the frame of the loop the first recorded frame lands on. */
  loopOffset: number;
  latency: number;
  head: Faded | null;
  headBuffer: AudioBuffer | null;
  watchdog: ReturnType<typeof setTimeout> | null;
}

type CaptureMessage =
  | { type: 'head'; id: number; channels: Float32Array<ArrayBuffer>[] }
  | { type: 'take'; id: number; start: number; end: number; channels: Float32Array<ArrayBuffer>[]; missed: number };

export class AudioLoopEngine implements AudioLoopTracks {
  private readonly tracks: Track[];
  private capture: AudioWorkletNode | null = null;
  private loading: Promise<AudioWorkletNode | null> | null = null;
  private connected: AudioNode | null = null;
  private rec: Capture | null = null;
  private serial = 0;
  private ticker: ReturnType<typeof setInterval> | null = null;
  private failed = false;
  /** Told when a track's layers change (to keep them with the project). */
  onLayersChanged: ((i: number) => void) | null = null;

  readonly ctx: AudioContext;
  private readonly out: AudioNode;

  constructor(private readonly engine: MusicAudioEngine) {
    const { ctx, out } = engine.loopGraph();
    this.ctx = ctx;
    this.out = out;
    this.tracks = Array.from({ length: LOOP_TRACK_COUNT }, () => {
      const level = ctx.createGain();
      level.gain.value = 0.8;
      level.connect(out);
      const meter = ctx.createAnalyser();
      meter.fftSize = 512;
      level.connect(meter);
      return { meter, state: 'empty', level, layers: [], redo: [], cleared: null, mix: null, buffer: null, bars: 0, originBeat: 0, beatMs: 500, voice: null, dubbing: false };
    });
    void this.ensureCapture();
  }

  private clock() {
    return launchClockPosition();
  }

  private timeOfBeat(beat: number): number {
    const now = this.ctx.currentTime;
    const c = this.clock();
    return now + ((beat - c.beat) * c.beatMs) / 1000;
  }

  private settings(i: number) {
    return get(musicStudio).loopStation.tracks[i];
  }

  /** Frames the input runs late by: what the system reports plus the manual offset. */
  latencyFrames(): number {
    const ctx = this.ctx as AudioContext & { outputLatency?: number };
    return latencyFrames(inputLatencySeconds({ baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency }, get(musicStudio).loopStation.latencyMs), ctx.sampleRate);
  }

  // ── AudioLoopTracks ──

  private meterBuf = new Float32Array(512);

  /** How loud a playing audio track is now, 0–1 (for the visuals following it); null when silent. */
  levelOf(i: number): number | null {
    const t = this.tracks[i];
    if (!t?.voice) return null;
    t.meter.getFloatTimeDomainData(this.meterBuf);
    let sum = 0;
    for (let k = 0; k < this.meterBuf.length; k++) sum += this.meterBuf[k] * this.meterBuf[k];
    return Math.min(1, Math.sqrt(sum / this.meterBuf.length) * 3);
  }

  latencyMs(): number {
    return (this.latencyFrames() / this.ctx.sampleRate) * 1000;
  }

  /** What the system reports alone, in ms. */
  reportedLatencyMs(): number {
    const ctx = this.ctx as AudioContext & { outputLatency?: number };
    return inputLatencySeconds({ baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency }, 0) * 1000;
  }

  canRecord(i: number): boolean {
    const s = get(musicStudio);
    const input = this.settings(i)?.input ?? 0;
    return !this.failed && s.inputOn && input < s.liveInputs.length && this.engine.inputTap(input) !== null;
  }

  record(i: number, opts: { startBeat: number; bars: number; free: boolean }): boolean {
    const node = this.capture;
    if (!node || !this.canRecord(i)) return false;
    this.endCapture();
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const c = this.clock();
    const L = this.latencyFrames();
    const setsTempo = opts.free && opts.startBeat <= c.beat + 0.01;
    const startTime = setsTempo ? ctx.currentTime + LEAD : this.timeOfBeat(opts.startBeat);
    const maxBars = maxAudioBars(c.beatMs);
    const bars = opts.bars ? Math.min(opts.bars, maxBars) : 0;
    const frames = bars ? Math.round(((bars * BEATS_PER_BAR * c.beatMs) / 1000) * sr) : Math.round(Math.min(MAX_AUDIO_LOOP_SECONDS, (maxBars * BEATS_PER_BAR * c.beatMs) / 1000) * sr);
    const startFrame = Math.round(startTime * sr) + L;
    const rec: Capture = {
      id: ++this.serial,
      track: i,
      kind: 'first',
      startFrame,
      endFrame: startFrame + frames,
      startBeat: setsTempo ? c.beat : opts.startBeat,
      free: !bars,
      setsTempo,
      bars,
      loopOffset: 0,
      latency: L,
      head: null,
      headBuffer: null,
      watchdog: null,
    };
    this.connectInput(i);
    this.rec = rec;
    this.send(rec, frames, Math.min(frames, Math.round(HEAD_SECONDS * sr)));
    this.tracks[i].state = 'armed';
    return true;
  }

  closeRecording(i: number): number | null {
    const rec = this.rec;
    if (!rec || rec.track !== i || rec.kind !== 'first' || !this.capture) return null;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const c = this.clock();
    let endBeat: number;
    let endFrame: number;
    if (rec.setsTempo) {
      // The press is the loop's end: its length sets the tempo, and now becomes a downbeat.
      endFrame = Math.round((ctx.currentTime + LEAD) * sr) + rec.latency;
      const seconds = (endFrame - rec.startFrame) / sr;
      const tempo = inferTempo(seconds);
      if (!tempo) {
        this.cancel(i);
        return null;
      }
      rec.bars = tempo.bars;
      audioStore.setManualBPM(tempo.bpm);
      resyncLaunchClock();
      endBeat = this.clock().beat + (LEAD * 1000) / (60000 / tempo.bpm);
      rec.startBeat = endBeat - tempo.bars * BEATS_PER_BAR;
    } else {
      const bar = rec.free ? freeRecordEnd(rec.startBeat, c.beat) : Math.min(rec.startBeat + rec.bars * BEATS_PER_BAR, Math.max(rec.startBeat + BEATS_PER_BAR, nextBarAt(c.beat + (LEAD * 1000) / c.beatMs)));
      endBeat = bar;
      rec.bars = Math.round((bar - rec.startBeat) / BEATS_PER_BAR);
      endFrame = Math.round(this.timeOfBeat(bar) * sr) + rec.latency;
    }
    endFrame = Math.min(rec.endFrame, Math.max(rec.startFrame + 1, endFrame));
    rec.endFrame = endFrame;
    this.capture.port.postMessage({ type: 'end', id: rec.id, end: endFrame });
    this.armWatchdog(rec);
    this.scheduleHead(rec);
    return endBeat;
  }

  cancel(i: number): void {
    const rec = this.rec;
    if (rec && rec.track === i) {
      this.rec = null;
      if (rec.watchdog) clearTimeout(rec.watchdog);
      this.capture?.port.postMessage({ type: 'cancel', id: rec.id });
      this.stopFaded(rec.head, 0.01);
    }
    const t = this.tracks[i];
    t.dubbing = false;
    t.state = t.layers.length ? (t.voice ? 'play' : 'stopped') : 'empty';
  }

  overdub(i: number, on: boolean): boolean {
    const t = this.tracks[i];
    if (!t.buffer) return false;
    if (!on) {
      t.dubbing = false;
      if (this.rec?.track === i && this.rec.kind === 'pass') this.punchOut(this.rec);
      if (t.state === 'overdub') t.state = 'play';
      return true;
    }
    if (!this.capture || !this.canRecord(i)) return false;
    if (!t.voice) this.play(i);
    t.dubbing = true;
    t.state = 'overdub';
    // From the next bar line to the end of the pass it falls in.
    const c = this.clock();
    this.startPass(i, this.timeOfBeat(nextBarAt(c.beat + (LEAD * 1000) / c.beatMs)));
    return true;
  }

  play(i: number): void {
    const t = this.tracks[i];
    if (!t.buffer || t.voice) return;
    const c = this.clock();
    const beat = nextBarAt(c.beat + (LEAD * 1000) / c.beatMs);
    const offset = loopOffset(beat, t.originBeat, t.bars * BEATS_PER_BAR, t.buffer.duration);
    this.startVoice(t, this.timeOfBeat(beat), offset, 0.003);
    t.state = 'play';
    this.ensureTicker();
  }

  stop(i: number, fadeBars: number, now: boolean): void {
    const t = this.tracks[i];
    if (this.rec?.track === i) this.endCapture();
    t.dubbing = false;
    const c = this.clock();
    const at = now ? this.ctx.currentTime : this.timeOfBeat(nextBarAt(c.beat + (LEAD * 1000) / c.beatMs));
    const fade = fadeBars > 0 ? (fadeBars * BEATS_PER_BAR * c.beatMs) / 1000 : 0.02;
    const v = t.voice;
    t.voice = null;
    if (v) this.stopFaded(v, fade, at);
    t.state = t.layers.length ? 'stopped' : 'empty';
  }

  setLevel(i: number, level: number): void {
    this.tracks[i].level.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), this.ctx.currentTime, 0.02);
  }

  undo(i: number): boolean {
    const t = this.tracks[i];
    if (!t.layers.length) {
      if (!t.cleared) return false;
      Object.assign(t, { layers: t.cleared.layers, bars: t.cleared.bars, originBeat: t.cleared.originBeat, beatMs: t.cleared.beatMs, cleared: null });
      this.rebuild(i, false);
      t.state = 'stopped';
      return true;
    }
    t.redo.push(t.layers.pop()!);
    if (!t.layers.length) {
      this.stop(i, 0, true);
      t.mix = null;
      t.buffer = null;
      t.state = 'empty';
      this.onLayersChanged?.(i);
      return true;
    }
    this.rebuild(i, true);
    return true;
  }

  redo(i: number): boolean {
    const t = this.tracks[i];
    const layer = t.redo.pop();
    if (!layer) return false;
    t.layers.push(layer);
    this.rebuild(i, true);
    if (t.state === 'empty') t.state = 'stopped';
    return true;
  }

  clear(i: number): void {
    const t = this.tracks[i];
    this.stop(i, 0, true);
    t.cleared = t.layers.length ? { layers: t.layers, bars: t.bars, originBeat: t.originBeat, beatMs: t.beatMs } : null;
    t.layers = [];
    t.redo = [];
    t.mix = null;
    t.buffer = null;
    t.state = 'empty';
    this.onLayersChanged?.(i);
  }

  kill(): void {
    this.endCapture(true);
    for (let i = 0; i < this.tracks.length; i++) this.stop(i, 0, true);
  }

  clearAll(): void {
    this.kill();
    for (let i = 0; i < this.tracks.length; i++) {
      this.clear(i);
      this.tracks[i].cleared = null;
    }
  }

  state(i: number): AudioTrackState {
    const t = this.tracks[i];
    if (t.state === 'armed' && this.rec?.track === i && this.ctx.currentTime >= this.rec.startFrame / this.ctx.sampleRate) return 'record';
    return t.state;
  }

  info(i: number): AudioTrackInfo | null {
    const t = this.tracks[i];
    return { bars: t.bars, originBeat: t.originBeat, layers: t.layers.length, redo: t.redo.length };
  }

  layerCount(i: number): number {
    return this.tracks[i].layers.length;
  }

  bars(i: number): number {
    return this.tracks[i].bars;
  }

  bpm(i: number): number {
    return 60000 / this.tracks[i].beatMs;
  }

  peaks(i: number, n: number): number[] {
    const mix = this.tracks[i].mix;
    if (!mix || !mix[0].length) return [];
    const out: number[] = [];
    const step = mix[0].length / n;
    for (let k = 0; k < n; k++) {
      let peak = 0;
      const from = Math.floor(k * step);
      const to = Math.min(mix[0].length, Math.floor((k + 1) * step));
      // Every 8th frame is plenty for a drawing.
      for (let f = from; f < to; f += 8) peak = Math.max(peak, Math.abs(mix[0][f]), Math.abs(mix[1][f]));
      out.push(Math.min(1, peak));
    }
    return out;
  }

  private peakCache = new WeakMap<Float32Array, Float32Array>();

  /** Each layer's shape: `n` peak levels 0-1, worked out once per layer and kept with it (gone with it). */
  layerPeaks(i: number, n = 512): Float32Array[] {
    return this.tracks[i].layers.map((l) => {
      let peaks = this.peakCache.get(l[0]);
      if (!peaks || peaks.length !== n) {
        peaks = new Float32Array(n);
        const step = l[0].length / n;
        for (let k = 0; k < n; k++) {
          let p = 0;
          const to = Math.min(l[0].length, Math.floor((k + 1) * step));
          for (let f = Math.floor(k * step); f < to; f += 4) p = Math.max(p, Math.abs(l[0][f]), Math.abs(l[1][f]));
          peaks[k] = Math.min(1, p);
        }
        this.peakCache.set(l[0], peaks);
      }
      return peaks;
    });
  }

  wav(i: number): Uint8Array | null {
    const mix = this.tracks[i].mix;
    return mix ? encodeWav(mix[0], mix[1], this.ctx.sampleRate) : null;
  }

  async load(i: number, wav: Uint8Array, bars: number): Promise<boolean> {
    try {
      const ctx = this.ctx;
      const copy = wav.slice().buffer;
      const decoded = await ctx.decodeAudioData(copy);
      const left = new Float32Array(decoded.getChannelData(0));
      const right = new Float32Array(decoded.numberOfChannels > 1 ? decoded.getChannelData(1) : decoded.getChannelData(0));
      this.clear(i);
      const t = this.tracks[i];
      t.cleared = null;
      t.layers = [[left, right]];
      t.bars = Math.max(1, Math.round(bars));
      t.beatMs = (decoded.duration * 1000) / (t.bars * BEATS_PER_BAR);
      const c = this.clock();
      t.originBeat = nextBarAt(c.beat);
      this.rebuild(i, false);
      t.state = 'stopped';
      return true;
    } catch (err) {
      console.warn('[LoopTracks] Could not load the audio loop:', err);
      return false;
    }
  }

  /** A track's layers (each the loop's length, stereo) and its timing, for saving with the project. */
  layersOf(i: number): { layers: Array<[Float32Array, Float32Array]>; bars: number; beatMs: number; originBeat: number; sampleRate: number } | null {
    const t = this.tracks[i];
    return t.layers.length ? { layers: t.layers, bars: t.bars, beatMs: t.beatMs, originBeat: t.originBeat, sampleRate: this.ctx.sampleRate } : null;
  }

  sampleRate(): number {
    return this.ctx.sampleRate;
  }

  /** Put saved layers back on a track (stopped), as a project opens. */
  restoreLayers(i: number, layers: Array<[Float32Array, Float32Array]>, bars: number, beatMs: number, originBeat: number): void {
    if (!layers.length) return;
    const frames = Math.min(...layers.map((l) => l[0].length));
    const t = this.tracks[i];
    this.clear(i);
    t.cleared = null;
    t.layers = layers.map((l) => [l[0].slice(0, frames), l[1].slice(0, frames)] as Stereo);
    t.bars = bars;
    t.beatMs = beatMs;
    t.originBeat = originBeat;
    this.rebuild(i, false);
    t.state = 'stopped';
    this.budget();
  }

  /** The loopback Measure: a click out, listen on track `i`'s input; the round trip in ms, or null. */
  async measureLatency(i: number): Promise<number | null> {
    const node = await this.ensureCapture();
    if (!node || !this.canRecord(i) || this.rec) return null;
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const at = ctx.currentTime + 0.1;
    const frames = Math.round(0.6 * sr);
    const startFrame = Math.round(at * sr);
    this.connectInput(i);
    const click = ctx.createOscillator();
    const env = ctx.createGain();
    click.frequency.value = 1000;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.8, at + 0.001);
    env.gain.linearRampToValueAtTime(0, at + 0.01);
    click.connect(env).connect(this.out);
    click.start(at);
    click.stop(at + 0.02);
    const id = ++this.serial;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        node.port.removeEventListener('message', onMessage);
        resolve(null);
      }, 3000);
      const onMessage = (e: MessageEvent<CaptureMessage>) => {
        if (e.data?.id !== id || e.data.type !== 'take') return;
        clearTimeout(timer);
        node.port.removeEventListener('message', onMessage);
        const onset = findClickOnset(e.data.channels[0]);
        resolve(onset === null ? null : (onset / sr) * 1000);
      };
      node.port.addEventListener('message', onMessage);
      node.port.postMessage({ type: 'record', id, start: startFrame, end: startFrame + frames, channels: [new Float32Array(frames), new Float32Array(frames)], head: null });
    });
  }

  // ── Recording ──

  private send(rec: Capture, frames: number, headFrames: number): void {
    const channels = [new Float32Array(frames), new Float32Array(frames)];
    const head = headFrames > 0 ? [new Float32Array(headFrames), new Float32Array(headFrames)] : null;
    this.capture!.port.postMessage(
      { type: 'record', id: rec.id, start: rec.startFrame, end: rec.endFrame, channels, head },
      [...channels, ...(head ?? [])].map((c) => c.buffer),
    );
    this.armWatchdog(rec);
  }

  /** Record one overdub pass of track `i` from audio time `from` to the end of the pass it is in. */
  private startPass(i: number, from: number): void {
    const t = this.tracks[i];
    const v = t.voice;
    if (!v || !t.buffer || !this.capture) return;
    if (this.rec && this.rec.track !== i) this.endCapture();
    if (this.rec) return;
    const sr = this.ctx.sampleRate;
    const length = t.buffer.length;
    // Where the loop is at `from`, in frames, from how the voice is playing.
    const pos = Math.round(loopPosition(v.anchorPos, v.anchorTime, v.rate, Math.max(from, v.startAt), t.buffer.duration) * sr) % length;
    const frames = length - pos;
    const L = this.latencyFrames();
    const startFrame = Math.round(Math.max(from, v.startAt) * sr) + L;
    const rec: Capture = { id: ++this.serial, track: i, kind: 'pass', startFrame, endFrame: startFrame + frames, startBeat: 0, free: false, setsTempo: false, bars: t.bars, loopOffset: pos, latency: L, head: null, headBuffer: null, watchdog: null };
    this.connectInput(i);
    this.rec = rec;
    this.send(rec, frames, 0);
  }

  /** Punch out on the next bar line: the pass being recorded ends there. */
  private punchOut(rec: Capture): void {
    const c = this.clock();
    const at = this.timeOfBeat(nextBarAt(c.beat + (LEAD * 1000) / c.beatMs));
    const end = Math.round(at * this.ctx.sampleRate) + rec.latency;
    if (end >= rec.endFrame) return;
    rec.endFrame = Math.max(rec.startFrame + 1, end);
    this.capture?.port.postMessage({ type: 'end', id: rec.id, end: rec.endFrame });
  }

  /** Stop recording now; a pass keeps what it has (or nothing when `drop`). */
  private endCapture(drop = false): void {
    const rec = this.rec;
    if (!rec) return;
    if (rec.kind === 'first' || drop) {
      this.cancel(rec.track);
      return;
    }
    this.tracks[rec.track].dubbing = false;
    const end = Math.round(this.ctx.currentTime * this.ctx.sampleRate) + rec.latency;
    if (end < rec.endFrame) {
      rec.endFrame = Math.max(rec.startFrame + 1, end);
      this.capture?.port.postMessage({ type: 'end', id: rec.id, end: rec.endFrame });
    }
  }

  private onMessage(data: CaptureMessage | null): void {
    const rec = this.rec;
    if (!rec || !data || data.id !== rec.id) return;
    if (data.type === 'head') {
      rec.headBuffer = this.toBuffer([data.channels[0], data.channels[1]], data.channels[0].length);
      this.scheduleHead(rec);
      return;
    }
    if (rec.watchdog) clearTimeout(rec.watchdog);
    this.rec = null;
    if (data.missed > 0) console.warn(`[LoopTracks] The recording missed its first ${data.missed} frames.`);
    const length = data.end - data.start;
    const channels: Stereo = [data.channels[0], data.channels[1]];
    if (rec.kind === 'first') this.finishFirst(rec, channels, length);
    else this.finishPass(rec, channels, length);
  }

  private finishFirst(rec: Capture, channels: Stereo, length: number): void {
    const t = this.tracks[rec.track];
    const sr = this.ctx.sampleRate;
    const layer: Stereo = [channels[0].slice(0, length), channels[1].slice(0, length)];
    const bars = Math.max(1, rec.bars || Math.round(length / sr / ((4 * this.clock().beatMs) / 1000)));
    if (t.voice) this.stopFaded(t.voice, HANDOVER);
    t.voice = null;
    t.layers = [layer];
    t.redo = [];
    t.cleared = null;
    t.bars = bars;
    t.originBeat = rec.startBeat;
    t.beatMs = (length / sr) * 1000 / (bars * BEATS_PER_BAR);
    this.rebuild(rec.track, false);
    // It plays on from where it ended, taking over from its head.
    const endTime = (rec.endFrame - rec.latency) / sr;
    const at = Math.max(this.ctx.currentTime + HANDOVER, endTime);
    const offset = (at - endTime) % t.buffer!.duration;
    this.startVoice(t, at, offset, rec.head ? HANDOVER : 0.004);
    this.stopFaded(rec.head, HANDOVER, at);
    t.state = this.settings(rec.track).afterRecord === 'overdub' ? 'overdub' : 'play';
    this.ensureTicker();
    this.budget();
    if (t.state === 'overdub') {
      t.dubbing = true;
      this.startPass(rec.track, at);
    }
  }

  private finishPass(rec: Capture, channels: Stereo, length: number): void {
    const i = rec.track;
    const t = this.tracks[i];
    const total = t.mix?.[0].length ?? 0;
    if (total && length > 0) {
      // Only a pass that heard something becomes a layer.
      let loud = false;
      for (let f = 0; f < length && !loud; f += 16) loud = Math.abs(channels[0][f]) > 1e-3 || Math.abs(channels[1][f]) > 1e-3;
      if (loud) {
        const layer: Stereo = [new Float32Array(total), new Float32Array(total)];
        for (let c = 0; c < 2; c++) {
          for (let f = 0; f < length; f++) layer[c][(rec.loopOffset + f) % total] = channels[c][f];
        }
        t.layers.push(layer);
        t.redo = [];
        while (t.layers.length > MAX_LAYERS) t.layers.splice(0, 2, sum(t.layers[0], t.layers[1]));
        this.rebuild(i, true);
        this.budget();
      }
    }
    // The next pass starts where this one ended.
    if (t.dubbing && t.voice && t.buffer) this.startPass(i, rec.endFrame / this.ctx.sampleRate - rec.latency / this.ctx.sampleRate);
    else if (t.state === 'overdub') t.state = 'play';
  }

  /** Fold the oldest layers of the tracks holding most until all of them fit the memory budget. */
  private budget(): void {
    const folds = foldsForBudget(this.tracks.map((t) => t.layers.map((l) => audioBytes(l[0].length))));
    for (const i of folds) {
      const t = this.tracks[i];
      if (t.layers.length >= 2) t.layers.splice(0, 2, sum(t.layers[0], t.layers[1]));
    }
    // Redo stacks and cleared loops are the first to go when memory is tight.
    if (folds.length) for (const t of this.tracks) { t.redo = []; t.cleared = null; }
  }

  /** The mix from the layers; a playing loop swaps to it in place, in phase. */
  private rebuild(i: number, swap: boolean): void {
    const t = this.tracks[i];
    this.onLayersChanged?.(i);
    if (!t.layers.length) return;
    const frames = t.layers[0][0].length;
    const mix: Stereo = [new Float32Array(frames), new Float32Array(frames)];
    for (const layer of t.layers) for (let c = 0; c < 2; c++) {
      const src = layer[c];
      const dst = mix[c];
      for (let f = 0; f < frames; f++) dst[f] += src[f];
    }
    t.mix = mix;
    t.buffer = this.toBuffer(mix, frames);
    const v = t.voice;
    if (swap && v) {
      const at = this.ctx.currentTime + HANDOVER;
      const pos = loopPosition(v.anchorPos, v.anchorTime, v.rate, Math.max(at, v.startAt), t.buffer.duration);
      this.stopFaded(v, HANDOVER, Math.max(at, v.startAt));
      t.voice = null;
      this.startVoice(t, Math.max(at, v.startAt), pos, HANDOVER, v.rate);
    }
  }

  // ── Playing ──

  private startVoice(t: Track, at: number, offset: number, fadeIn: number, rate?: number): void {
    const ctx = this.ctx;
    const c = this.clock();
    const ratio = c.beatMs > 0 ? t.beatMs / c.beatMs : 1;
    const r = rate ?? startRate(ratio);
    const src = ctx.createBufferSource();
    src.buffer = t.buffer;
    src.loop = true;
    src.playbackRate.value = r;
    const env = ctx.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + Math.max(0.001, fadeIn));
    src.connect(env).connect(t.level);
    src.onended = () => { try { env.disconnect(); } catch { /* gone */ } };
    src.start(at, offset);
    t.voice = { src, env, startAt: at, rise: Math.max(0.001, fadeIn), anchorPos: offset, anchorTime: at, rate: r, follow: FOLLOW_START };
  }

  private stopFaded(f: Faded | null, fade: number, at = this.ctx.currentTime): void {
    if (!f) return;
    const when = Math.max(at, this.ctx.currentTime);
    const level = Math.max(0, Math.min(1, (when - f.startAt) / f.rise));
    try {
      holdAt(f.env.gain, when);
      f.env.gain.setValueAtTime(level, when);
      f.env.gain.linearRampToValueAtTime(0, when + fade);
      f.src.stop(when + fade + 0.01);
    } catch { /* already stopped */ }
  }

  private scheduleHead(rec: Capture): void {
    this.stopFaded(rec.head, 0.005);
    rec.head = null;
    const t = this.tracks[rec.track];
    const sr = this.ctx.sampleRate;
    const at = (rec.endFrame - rec.latency) / sr;
    if (!rec.headBuffer || t.voice || rec.free && rec.endFrame - rec.startFrame >= Math.round(MAX_AUDIO_LOOP_SECONDS * sr) - 1 || at < this.ctx.currentTime + 0.005) return;
    const src = this.ctx.createBufferSource();
    src.buffer = rec.headBuffer;
    const env = this.ctx.createGain();
    env.gain.value = 0;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(1, at + 0.002);
    src.connect(env).connect(t.level);
    src.onended = () => { try { env.disconnect(); } catch { /* gone */ } };
    src.start(at);
    rec.head = { src, env, startAt: at, rise: 0.002 };
  }

  private ensureTicker(): void {
    if (this.ticker) return;
    this.ticker = setInterval(() => this.tick(), FOLLOW_MS);
  }

  /** Keep each playing loop with the clock (small tempo moves, and drift). */
  private tick(): void {
    if (!this.tracks.some((t) => t.voice)) {
      if (this.ticker) clearInterval(this.ticker);
      this.ticker = null;
      return;
    }
    const now = this.ctx.currentTime;
    const c = this.clock();
    if (!(c.beatMs > 0)) return;
    for (const t of this.tracks) {
      const v = t.voice;
      if (!v || !t.buffer || now < v.startAt) continue;
      // While a pass records, the speed stays put so the pass lines up with the loop frame for frame.
      if (this.rec?.kind === 'pass' && this.tracks[this.rec.track] === t) continue;
      const duration = t.buffer.duration;
      const expected = loopOffset(c.beat, t.originBeat, t.bars * BEATS_PER_BAR, duration);
      const actual = loopPosition(v.anchorPos, v.anchorTime, v.rate, now, duration);
      const step = followStep(v.follow, t.beatMs / c.beatMs, phaseError(expected, actual, duration));
      v.follow = step.state;
      if (step.resync) {
        const at = now + 0.02;
        const beat = c.beat + ((at - now) * 1000) / c.beatMs;
        this.stopFaded(v, 0.015, at);
        t.voice = null;
        this.startVoice(t, at, loopOffset(beat, t.originBeat, t.bars * BEATS_PER_BAR, duration), 0.015);
      } else if (Math.abs(step.rate - v.rate) > 1e-6) {
        v.anchorPos = actual;
        v.anchorTime = now;
        v.rate = step.rate;
        v.src.playbackRate.setValueAtTime(step.rate, now);
      }
    }
  }

  private toBuffer(channels: Stereo, length: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(2, Math.max(1, length), this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) buffer.copyToChannel(channels[c].subarray(0, length), c);
    return buffer;
  }

  private armWatchdog(rec: Capture): void {
    if (rec.watchdog) clearTimeout(rec.watchdog);
    const wait = Math.max(0, (rec.endFrame / this.ctx.sampleRate - this.ctx.currentTime) * 1000) + TAKE_TIMEOUT_MS;
    rec.watchdog = setTimeout(() => {
      if (this.rec !== rec) return;
      console.warn('[LoopTracks] A recording did not come back.');
      this.endCapture(true);
    }, wait);
  }

  private connectInput(i: number): void {
    const node = this.capture;
    if (!node) return;
    const tap = this.engine.inputTap(this.settings(i)?.input ?? 0);
    if (tap === this.connected) return;
    if (this.connected) { try { this.connected.disconnect(node); } catch { /* gone */ } }
    this.connected = tap;
    tap?.connect(node);
  }

  private ensureCapture(): Promise<AudioWorkletNode | null> {
    if (this.capture) return Promise.resolve(this.capture);
    if (!this.loading) this.loading = this.loadCapture();
    return this.loading;
  }

  private async loadCapture(): Promise<AudioWorkletNode | null> {
    try {
      const ctx = this.ctx;
      if (!ctx.audioWorklet) throw new Error('no audio worklets');
      const { default: url } = await import('./looperWorklet.ts?worker&url');
      await ctx.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(ctx, 'ghost-looper-capture', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 2, channelCountMode: 'explicit', channelInterpretation: 'speakers' });
      node.port.onmessage = (e: MessageEvent<CaptureMessage>) => this.onMessage(e.data);
      node.port.start();
      node.onprocessorerror = () => {
        console.warn('[LoopTracks] The recorder stopped working.');
        this.failed = true;
        this.endCapture(true);
      };
      this.capture = node;
      return node;
    } catch (err) {
      console.warn('[LoopTracks] Audio loop recording is not available:', err);
      this.failed = true;
      return null;
    }
  }
}

function sum(a: Stereo, b: Stereo): Stereo {
  const out: Stereo = [new Float32Array(a[0]), new Float32Array(a[1])];
  for (let c = 0; c < 2; c++) for (let f = 0; f < out[c].length; f++) out[c][f] += b[c][f] ?? 0;
  return out;
}

/** The audio loop tracks if they were made already (the frame loop never makes them). */
export function existingAudioLoopTracks(audio: MusicAudioEngine): AudioLoopEngine | null {
  return engines.get(audio) ?? null;
}

const engines = new WeakMap<MusicAudioEngine, AudioLoopEngine>();

/** The audio loop tracks of a studio's audio engine, created on first use. */
export function audioLoopTracksFor(audio: MusicAudioEngine): AudioLoopEngine | null {
  let engine = engines.get(audio);
  // The studio closed and opened again: a new audio context, new tracks.
  if (engine && engine.ctx !== audio.loopGraph().ctx) {
    engine.kill();
    engine = undefined;
  }
  if (!engine) {
    try {
      engine = new AudioLoopEngine(audio);
    } catch (err) {
      console.warn('[LoopTracks] No audio loop tracks:', err);
      return null;
    }
    engines.set(audio, engine);
  }
  return engine;
}
