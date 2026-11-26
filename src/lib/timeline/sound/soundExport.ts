/**
 * The Timeline's soundtrack, rendered offline for "Render to Video": every
 * sound row as it plays, through the same chain (the studio's effect units,
 * build FX, ducking, fades, levels) and with the control lines' values on
 * the row's level and effects, sampled through the render on the show's
 * clock. Live clips are not in it: they play in Live.
 *
 * It is rendered in pieces (`SOUND_PIECE_SECONDS` at a time), each on its own
 * OfflineAudioContext, so memory stays the same for a 3-minute song and a
 * 3-hour show: a piece goes to the sink (the temp WAV for the mux) and to the
 * analysis, and only the last two are kept. One context for the whole length
 * held every sample of it (2 GB for an hour) plus a mono copy and a WAV copy.
 *
 * Each piece starts a little earlier than the sound it keeps (the pre-roll),
 * so echoes, reverb tails, filters, the compressor and the ducking are where
 * they would be had the render run from the start; the pre-roll is discarded.
 * Audio blocks, fades and ducks are placed from show time, so they land on
 * the same samples in every piece. A piece never starts inside a build (its
 * sweeps and risers are scheduled from the build's start). Effects with a
 * free-running oscillator or their own internal clock (chorus, auto-pan,
 * tape wow, the sample-by-sample units) cannot be carried over exactly: when
 * a row has one, pieces overlap by a few milliseconds and crossfade.
 *
 * Within a piece the render pauses every `step` seconds (OfflineAudioContext
 * suspend) to apply the lines' values at that show time, the same way the
 * live engine applies them each frame.
 */
import { getRawElectronApi } from '$lib/bridge';
import type { ShowTimelineState } from '../../stores/showTimeline';
import { loadStudioFx } from '../../music/macroFxAudio';
import { division } from '../../music/macroFx';
import { songFeaturesFor } from '../lines/songFeatures';
import { createLineEvaluator, SOUND_ROW_TRACK_PREFIX, type PlacedSong } from '../lines/lineEvaluator';
import { cachedShowAudioDecode, decodeShowAudio } from '../../audio/showAudio';
import { nextDuck, type DuckEnvelope } from '../../music/ducking';
import { blockGainAt, effectiveFades, rowAudible, soundRowsFor, type BuildBlock, type SoundRow } from './soundModel';
import { rowValues } from './soundParams';
import { beatHitsBetween, kickHitsInFeatures, rowKickTimes, timesBetween } from './soundDuck';
import { bpmAt, buildHitTimes, buildSettingsFor, RowBus } from './rowBus';
import { encodeWav } from '../../music/wav';
import { hashString, seededRandom } from '../../music/audioRandom';

export const EXPORT_SAMPLE_RATE = 48000;
/** Seconds of sound a piece of the render keeps. */
export const SOUND_PIECE_SECONDS = 30;
/** Pre-roll every piece has: level and effect glides, ducks, filters and the compressor settle well within it. */
export const SOUND_BASE_PREROLL = 2;
/** The longest pre-roll: a near-endless echo beyond this is cut short at a piece's start. */
export const SOUND_MAX_PREROLL = 60;
/** Pieces overlap and crossfade by this much when a row has an effect with its own clock. */
export const SOUND_SEAM_CROSSFADE = 0.02;
/** After a build lands, its echo and reverb ring this long. */
const BUILD_TAIL = 8;
const QUANTUM = 128;

type Doc = Pick<ShowTimelineState, 'audioTracks' | 'sound' | 'lines' | 'tempo' | 'duration'>;
type Block = ShowTimelineState['audioTracks'][number];

/** Effects that run on the audio thread (fxDsp.ts worklet). */
const WORKLET_FX = new Set(['phaser', 'grains', 'shimmer', 'freqshift', 'ring', 'resonator', 'vowel', 'fold', 'reverse', 'glitch', 'tapestop', 'harmony']);
/** Effects whose state is a free-running phase or clock, not a decaying tail. */
const CLOCKED_FX = new Set(['chorus', 'autopan', 'tape', 'stutter', 'phaser', 'grains', 'shimmer', 'freqshift', 'ring', 'resonator', 'vowel', 'fold', 'reverse', 'glitch', 'tapestop', 'harmony']);

/** How long an effect keeps sounding after its input stops (seconds), at its worst over the show. */
export function fxTailSeconds(fx: SoundRow['fx'][number], moved: boolean, minBpm: number): number {
  const p = (k: string) => (moved ? 1 : fx.params[k]?.value ?? 0);
  const repeats = (fb: number) => (fb > 0 ? Math.ceil(Math.log(1e-5) / Math.log(Math.min(0.95, fb))) : 1);
  const beatSeconds = 60 / Math.max(30, minBpm);
  switch (fx.type) {
    case 'delay':
    case 'tape': {
      const time = Math.min(4, (moved ? 4 : division(p('time')).beats) * beatSeconds);
      return time * repeats(Math.min(0.95, p('feedback') * 0.95));
    }
    case 'reverb': return p('predelay') * 0.2 + 0.5 + p('size') * 8;
    case 'spring': return 1.6;
    case 'chorus': return 0.026 * repeats(p('feedback') * 0.7);
    case 'stutter': return 4;
    default: return CLOCKED_FX.has(fx.type) ? 4 : 0;
  }
}

/** The pre-roll a doc needs, and whether a row has an effect that cannot be carried across a seam. */
export function soundPreroll(doc: Pick<Doc, 'sound' | 'lines' | 'tempo' | 'audioTracks'>): { preroll: number; clocked: boolean; capped: boolean } {
  const rows = soundRowsFor(doc.sound, doc.audioTracks);
  const bpms = doc.tempo?.segments?.map((s) => s.bpm).filter((b) => b > 0) ?? [];
  const minBpm = bpms.length ? Math.min(...bpms) : 120;
  let tail = 0;
  let clocked = false;
  for (const row of rows) {
    let rowTail = 0;
    for (const fx of row.fx) {
      if (!fx.enabled) continue;
      const moved = doc.lines.some((l) => l.target?.scope === 'sound' && l.target.id === row.id && typeof l.key === 'string' && l.key.startsWith(`sfx:${fx.id}:`));
      rowTail += fxTailSeconds(fx, moved, minBpm);
      if (CLOCKED_FX.has(fx.type)) clocked = true;
    }
    tail = Math.max(tail, rowTail);
  }
  const want = SOUND_BASE_PREROLL + tail;
  return { preroll: Math.min(SOUND_MAX_PREROLL, want), clocked, capped: want > SOUND_MAX_PREROLL };
}

export interface SoundPiece {
  /** Frames of the soundtrack this piece delivers: [outStart, outEnd). */
  outStart: number;
  outEnd: number;
  /** Frames its context renders: [ctxStart, ctxEnd), ctxStart <= outStart, ctxEnd >= outEnd. */
  ctxStart: number;
  ctxEnd: number;
}

/**
 * Where each piece starts and ends, in frames. A context starts `preroll`
 * before the sound it keeps, on a render-quantum boundary, and never inside
 * a build (or its tail): there it starts at the build's start instead.
 * `overlap` frames more are rendered past each piece's end for the
 * crossfade into the next.
 */
export function soundPieces(
  totalFrames: number,
  opts: { pieceFrames: number; prerollFrames: number; overlapFrames?: number; avoid?: ReadonlyArray<readonly [number, number]> },
): SoundPiece[] {
  const pieces: SoundPiece[] = [];
  const piece = Math.max(QUANTUM, Math.ceil(opts.pieceFrames / QUANTUM) * QUANTUM);
  const overlap = Math.max(0, Math.round(opts.overlapFrames ?? 0));
  for (let outStart = 0; outStart < totalFrames; outStart += piece) {
    const outEnd = Math.min(totalFrames, outStart + piece);
    let ctxStart = outStart === 0 ? 0 : Math.max(0, Math.floor((outStart - opts.prerollFrames) / QUANTUM) * QUANTUM);
    // Back off to a build's start when the context would open inside one.
    for (let moved = true; moved && ctxStart > 0;) {
      moved = false;
      for (const [s, e] of opts.avoid ?? []) {
        if (ctxStart > s && ctxStart < e) {
          ctxStart = Math.max(0, Math.floor(s / QUANTUM) * QUANTUM - QUANTUM);
          moved = true;
        }
      }
    }
    pieces.push({ outStart, outEnd, ctxStart, ctxEnd: outEnd >= totalFrames ? totalFrames : outEnd + overlap });
  }
  return pieces;
}

/** Crossfade `tail` (the end of the last piece) into the head of `next`, in place. */
export function crossfadeInto(next: Float32Array, tail: Float32Array): void {
  const n = Math.min(next.length, tail.length);
  for (let i = 0; i < n; i++) {
    const w = (i + 0.5) / n;
    next[i] = tail[i] * (1 - w) + next[i] * w;
  }
}

/**
 * The step function a block's fade gain follows: setValueAtTime at 100
 * points a second over its fades (flat in between), as [time, value]
 * sorted by time, a later point at the same time replacing an earlier one
 * (how an AudioParam keeps them).
 */
export function blockGainSteps(b: Block, fades: { fadeIn: number; fadeOut: number }, seconds: number): Array<[number, number]> {
  const end = Math.min(seconds, b.startTime + b.duration);
  const points: number[] = [b.startTime];
  for (let t = b.startTime; t < b.startTime + fades.fadeIn; t += 0.01) points.push(t);
  points.push(b.startTime + fades.fadeIn);
  for (let t = b.startTime + b.duration - fades.fadeOut; t < end; t += 0.01) points.push(t);
  const steps = new Map<number, number>([[0, 0]]);
  for (const t of points) if (t < end) steps.set(t, blockGainAt(b, t, fades) * b.volume);
  steps.set(end, 0);
  return [...steps.entries()].sort((x, y) => x[0] - y[0]);
}

/** Run `fn` with Math.random seeded (synchronous code only). */
function withSeed<T>(seed: number, fn: () => T): T {
  const real = Math.random;
  Math.random = seededRandom(seed);
  try { return fn(); } finally { Math.random = real; }
}

/** Songs (offline features) for lines that follow sound, as the live session has them. */
async function placedSongs(doc: Doc): Promise<PlacedSong[]> {
  if (!doc.lines.some((l) => l.follow && (l.follow.source.kind === 'audio' || l.follow.source.kind === 'stem'))) return [];
  const rows = soundRowsFor(doc.sound, doc.audioTracks);
  const out: PlacedSong[] = [];
  for (const t of doc.audioTracks) {
    if (!t.url || t.muted) continue;
    const features = await songFeaturesFor(t.url, async () => cachedShowAudioDecode(t.url) ?? (await decodeShowAudio(t.url)));
    if (!features) continue;
    out.push({ trackId: t.id, startTime: t.startTime, offset: t.offset, length: t.duration, features });
    if (rows[t.lane]) out.push({ trackId: `${SOUND_ROW_TRACK_PREFIX}${rows[t.lane].id}`, startTime: t.startTime, offset: t.offset, length: t.duration, fadeIn: t.fadeIn, fadeOut: t.fadeOut, gain: t.volume, features });
  }
  return out;
}

/** What every piece of one render shares: the doc, decoded files, hits, the lines. */
interface SoundPlan {
  doc: Doc;
  seconds: number;
  sampleRate: number;
  step: number;
  Offline: typeof OfflineAudioContext;
  rows: SoundRow[];
  blocks: Block[];
  steps: Map<string, Array<[number, number]>>;
  decoder: BaseAudioContext;
  buffers: Map<string, AudioBuffer | null>;
  builds: BuildBlock[];
  frameAt: (t: number) => ReturnType<ReturnType<typeof createLineEvaluator>['evaluate']> | null;
  /** Kick times per ducked row (beat rows find theirs per piece). */
  kicks: Map<string, number[]>;
  /** Each ducked row's envelope carried from piece to piece. */
  duck: Map<string, { at: number; env: DuckEnvelope | null }>;
  /** A row has a worklet effect: its module is loaded into each piece. */
  worklets: boolean;
}

/**
 * A file's samples at the render's rate, decoded when the first piece that
 * plays it is rendered and dropped once no later piece does, so a set of
 * songs back to back holds one or two of them, not all. (An AudioBuffer is
 * not tied to the context that decoded it: every piece shares it.)
 */
async function bufferFor(plan: SoundPlan, url: string): Promise<AudioBuffer | null> {
  if (plan.buffers.has(url)) return plan.buffers.get(url)!;
  let buffer: AudioBuffer | null = null;
  try {
    const res = await fetch(url);
    if (res.ok) buffer = await plan.decoder.decodeAudioData(await res.arrayBuffer());
  } catch (err) {
    console.warn('[soundExport] could not decode', url, err);
  }
  plan.buffers.set(url, buffer);
  return buffer;
}

/** Let go of the files no piece from show time `from` on plays. */
function releaseBuffers(plan: SoundPlan, from: number): void {
  for (const url of [...plan.buffers.keys()]) {
    if (!plan.blocks.some((b) => b.url === url && Math.min(plan.seconds, b.startTime + b.duration) > from)) plan.buffers.delete(url);
  }
}

async function planSound(doc: Doc, seconds: number, opts: { sampleRate?: number; step?: number; Offline?: typeof OfflineAudioContext }): Promise<SoundPlan | null> {
  const Offline = opts.Offline ?? (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  const rows = soundRowsFor(doc.sound, doc.audioTracks);
  const blocks = doc.audioTracks.filter((t) => t.url && !t.muted && t.volume > 0 && rows[t.lane]?.kind === 'audio');
  if (!Offline || !blocks.length || !(seconds > 0)) return null;
  const sampleRate = opts.sampleRate ?? EXPORT_SAMPLE_RATE;
  const byLane = new Map<number, Block[]>();
  for (const b of blocks) byLane.set(b.lane, [...(byLane.get(b.lane) ?? []), b]);
  const steps = new Map<string, Array<[number, number]>>();
  for (const b of blocks) steps.set(b.id, blockGainSteps(b, effectiveFades(b, byLane.get(b.lane) ?? []), seconds));
  const evaluator = createLineEvaluator();
  const songs = await placedSongs(doc);
  const frameAt = (t: number) => (doc.lines.length ? evaluator.evaluate(doc.lines, t, { tempo: doc.tempo, songs, liveInputs: false }) : null);
  const kicks = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.duck || row.duck.source === 'beat') continue;
    const lane = rows.findIndex((r) => r.id === row.duck!.source);
    const placements = [];
    for (const b of doc.audioTracks.filter((t) => t.lane === lane && t.url && !t.muted)) {
      const features = await songFeaturesFor(b.url, async () => cachedShowAudioDecode(b.url) ?? (await decodeShowAudio(b.url)));
      if (features) placements.push({ startTime: b.startTime, duration: b.duration, offset: b.offset, hits: kickHitsInFeatures(features) });
    }
    kicks.set(row.id, rowKickTimes(placements).filter((t) => t < seconds));
  }
  return {
    doc, seconds, sampleRate, Offline, rows, blocks, steps, frameAt, kicks,
    // As often as the live engine applies them (once a 60 Hz frame).
    step: opts.step ?? 1 / 60,
    decoder: new Offline(2, QUANTUM, sampleRate),
    buffers: new Map(),
    builds: doc.sound.builds.filter((b) => rows[b.lane] && b.startTime < seconds),
    duck: new Map(),
    worklets: rows.some((r) => r.fx.some((f) => f.enabled && WORKLET_FX.has(f.type))),
  };
}

function duckHits(plan: SoundPlan, row: SoundRow, from: number, to: number): number[] {
  if (!(to > from)) return [];
  if (row.duck?.source !== 'beat') return timesBetween(plan.kicks.get(row.id) ?? [], from, to);
  // beatHitsBetween stops at 512 beats: ask a minute at a time.
  const out: number[] = [];
  for (let a = from; a < to; a += 60) out.push(...beatHitsBetween(plan.doc.tempo, a, Math.min(to, a + 60)));
  return out;
}

/** Render one piece: the context's frames [ctxStart, ctxEnd). */
async function renderPiece(plan: SoundPlan, piece: SoundPiece): Promise<{ left: Float32Array; right: Float32Array }> {
  const { sampleRate: sr, doc, rows, seconds } = plan;
  const c0 = piece.ctxStart / sr;
  const c1 = piece.ctxEnd / sr;
  // Show time → this context's time, on the frame the whole render would use
  // (half a frame early, so rounding can never move it to the next one).
  const at = (t: number) => Math.max(0, (Math.ceil(t * sr - 1e-6) - piece.ctxStart - 0.5) / sr);
  const ctx = new plan.Offline(2, piece.ctxEnd - piece.ctxStart, sr);
  // Only when a row needs it: Chromium never frees a context that loaded a
  // worklet module (it held every piece's samples until a reload).
  if (plan.worklets) await loadStudioFx(ctx);
  const master = ctx.createGain();
  master.connect(ctx.destination);
  const buses = new Map(rows.map((r) => [r.id, new RowBus(ctx as unknown as AudioContext, master)]));
  // A row that has a build has the build FX in its chain for the whole show.
  for (const b of plan.builds) void buses.get(rows[b.lane].id)!.build;
  // Worklet effects splice themselves in a moment after they are made.
  await new Promise((r) => setTimeout(r, 0));

  // Audio blocks: a source each, through its fade gain, into its row.
  for (const b of plan.blocks) {
    const end = Math.min(seconds, b.startTime + b.duration);
    if (b.startTime >= c1 || end <= c0) continue;
    const buffer = await bufferFor(plan, b.url);
    if (!buffer) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    const steps = plan.steps.get(b.id)!;
    let i = 0;
    let v0 = 0;
    for (; i < steps.length && steps[i][0] <= c0; i++) v0 = steps[i][1];
    gain.gain.setValueAtTime(v0, 0);
    for (; i < steps.length && steps[i][0] < c1; i++) gain.gain.setValueAtTime(steps[i][1], at(steps[i][0]));
    src.connect(gain).connect(buses.get(rows[b.lane].id)!.input);
    if (b.startTime >= c0) src.start(b.startTime - c0, b.offset, b.duration);
    else src.start(0, b.offset + (c0 - b.startTime), b.duration - (c0 - b.startTime));
  }

  // Ducks: each row's envelope carried in from before this piece, then its
  // hits scheduled in order, a step ahead as the render goes.
  const duckRows = rows.filter((r) => r.duck);
  const duckDepthAt = (row: SoundRow, t: number) => rowValues(row, plan.frameAt(t)?.sounds?.get(row.id)).duckDepth;
  const shift = (env: DuckEnvelope | null): DuckEnvelope | null => (env ? { ...env, time: env.time - c0 } : null);
  const cursor = new Map<string, number>();
  for (const row of duckRows) {
    let state = plan.duck.get(row.id);
    if (!state || state.at > c0) state = { at: 0, env: null };
    for (const h of duckHits(plan, row, state.at, c0)) state.env = nextDuck(state.env, (Math.ceil(h * sr - 1e-6) - 0.5) / sr, duckDepthAt(row, h), 1, row.duck!.release) ?? state.env;
    state.at = c0;
    plan.duck.set(row.id, state);
    buses.get(row.id)!.ducker.restore(shift(state.env));
    cursor.set(row.id, c0);
  }
  const scheduleDucks = (upTo: number) => {
    for (const row of duckRows) {
      const from = cursor.get(row.id)!;
      const to = Math.min(c1, upTo);
      for (const h of duckHits(plan, row, from, to)) buses.get(row.id)!.ducker.duckInOrder(duckDepthAt(row, h), 1, row.duck!.release, at(h));
      cursor.set(row.id, Math.max(from, to));
    }
  };

  // Builds: started at their start, landing on their end. A piece never
  // opens inside one, so every build it hears starts within it.
  for (const b of plan.builds) {
    if (b.startTime < c0 - 1e-9 || b.startTime >= c1) continue;
    const bus = buses.get(rows[b.lane].id)!;
    const hits = buildHitTimes(b, doc.tempo).map((h) => ({ ...h, time: h.time - c0 }));
    // Its noise bursts start at the same random points in every piece.
    withSeed(hashString(b.id), () => bus.build.start({
      start: b.startTime - c0,
      land: b.startTime + b.duration - c0,
      beatSeconds: 60 / bpmAt(doc.tempo, b.startTime),
      hits,
      settings: buildSettingsFor(b),
    }));
  }

  // Levels and effects with the lines on top, applied on the render's own clock.
  const apply = (t: number, now = false) => {
    const frame = plan.frameAt(t);
    const bpm = bpmAt(doc.tempo, t);
    const values = rows.map((r) => rowValues(r, frame?.sounds?.get(r.id)));
    rows.forEach((row, i) => {
      const bus = buses.get(row.id)!;
      const audible = rowAudible({ muted: values[i].muted, solo: row.solo }, rows);
      bus.setLevel(audible ? values[i].volume : 0, now);
      bus.setFx(row, values[i].fx, bpm);
    });
  };
  // The rows start at their levels: a muted row is silent from the first sample.
  apply(c0, true);
  scheduleDucks(c0 + 2 * plan.step);
  const offline = ctx as OfflineAudioContext;
  const settle = async () => {
    // Let a worklet effect made by apply() splice itself in before the render moves on.
    if (plan.worklets) await loadStudioFx(ctx);
    await Promise.resolve();
  };
  for (let n = Math.floor(c0 / plan.step + 1e-9) + 1; ; n++) {
    const t = n * plan.step;
    if (t >= seconds || t >= c1) break;
    // Pause on the render quantum the whole render would (rounded up), half a frame in.
    const frame = Math.ceil(Math.floor(t * sr + 1e-6) / QUANTUM) * QUANTUM;
    if (frame <= piece.ctxStart || frame >= piece.ctxEnd) continue;
    void offline.suspend((frame - piece.ctxStart + 0.5) / sr).then(async () => {
      apply(t);
      scheduleDucks(t + 2 * plan.step);
      await settle();
      void offline.resume();
    });
  }
  await settle();
  const rendered = await offline.startRendering();
  for (const bus of buses.values()) bus.dispose();
  // Take the samples out of the AudioBuffer (a transfer, not a copy), so
  // they are freed with the piece even if the context is kept.
  const take = (ch: Float32Array) => structuredClone(ch, { transfer: [ch.buffer] });
  const left = take(rendered.getChannelData(0));
  const right = rendered.numberOfChannels > 1 ? take(rendered.getChannelData(1)) : left;
  return { left, right };
}

/** Where a soundtrack's pieces go as they are made (the temp WAV for the mux). */
export interface SoundSink {
  append(left: Float32Array, right: Float32Array): Promise<void>;
}

/**
 * The Timeline's soundtrack as the render goes: `ensure(t)` renders pieces
 * until the sound up to show time `t` exists, each piece goes to the sink,
 * and `mono` reads the last two pieces (what the analysis needs).
 */
export class TimelineSoundStream {
  readonly sampleRate: number;
  readonly frames: number;
  readonly preroll: number;
  readonly crossfades: boolean;
  private next = 0;
  private renderedFrames = 0;
  private kept: Array<{ start: number; mono: Float32Array }> = [];
  private tail: { left: Float32Array; right: Float32Array } | null = null;
  private busy: Promise<void> = Promise.resolve();

  private constructor(private readonly plan: SoundPlan, private readonly pieces: SoundPiece[], private readonly sink: SoundSink | null, info: { preroll: number; crossfades: boolean }) {
    this.sampleRate = plan.sampleRate;
    this.frames = pieces.length ? pieces[pieces.length - 1].outEnd : 0;
    this.preroll = info.preroll;
    this.crossfades = info.crossfades;
  }

  /** Null when there is nothing to hear (no audio blocks, everything muted). */
  static async open(
    doc: Doc,
    seconds: number,
    opts: { sampleRate?: number; step?: number; Offline?: typeof OfflineAudioContext; sink?: SoundSink | null; pieceSeconds?: number } = {},
  ): Promise<TimelineSoundStream | null> {
    const plan = await planSound(doc, seconds, opts);
    if (!plan) return null;
    const sr = plan.sampleRate;
    const { preroll, clocked, capped } = soundPreroll(doc);
    if (capped) console.warn(`[soundExport] an echo rings longer than ${SOUND_MAX_PREROLL} s: pieces start with it shorter`);
    const pieceSeconds = opts.pieceSeconds ?? SOUND_PIECE_SECONDS;
    const totalFrames = Math.ceil(seconds * sr);
    const pieces = soundPieces(totalFrames, {
      pieceFrames: Number.isFinite(pieceSeconds) ? Math.round(pieceSeconds * sr) : totalFrames,
      prerollFrames: Math.round(preroll * sr),
      overlapFrames: clocked ? Math.round(SOUND_SEAM_CROSSFADE * sr) : 0,
      avoid: plan.builds.map((b) => [Math.floor(b.startTime * sr), Math.ceil((b.startTime + b.duration + BUILD_TAIL) * sr)] as const),
    });
    return new TimelineSoundStream(plan, pieces, opts.sink ?? null, { preroll, crossfades: clocked });
  }

  get done(): boolean {
    return this.next >= this.pieces.length;
  }

  /** Render pieces until the sound up to show time `t` exists. */
  ensure(t: number): Promise<void> {
    const want = Math.min(this.frames, Math.ceil(Math.max(0, t) * this.sampleRate));
    this.busy = this.busy.then(async () => {
      while (this.renderedFrames < want && !this.done) await this.renderNext();
    });
    return this.busy;
  }

  /** Render whatever is left. */
  finish(): Promise<void> {
    return this.ensure(this.frames / this.sampleRate);
  }

  /** The soundtrack downmixed to mono (what the live analyser hears), read from the pieces still kept. */
  readonly mono = {
    length: 0,
    sample: (i: number): number => {
      for (let k = this.kept.length - 1; k >= 0; k--) {
        const p = this.kept[k];
        if (i >= p.start) return i - p.start < p.mono.length ? p.mono[i - p.start] : 0;
      }
      return 0;
    },
  };

  private async renderNext(): Promise<void> {
    const piece = this.pieces[this.next++];
    const { left, right } = await renderPiece(this.plan, piece);
    const from = piece.outStart - piece.ctxStart;
    const n = piece.outEnd - piece.outStart;
    const outL = left.subarray(from, from + n);
    const outR = right.subarray(from, from + n);
    if (this.tail) {
      crossfadeInto(outL, this.tail.left);
      crossfadeInto(outR, this.tail.right);
    }
    this.tail = piece.ctxEnd > piece.outEnd
      ? { left: left.slice(from + n, piece.ctxEnd - piece.ctxStart), right: right.slice(from + n, piece.ctxEnd - piece.ctxStart) }
      : null;
    const mono = new Float32Array(n);
    for (let i = 0; i < n; i++) mono[i] = (outL[i] + outR[i]) * 0.5;
    this.kept.push({ start: piece.outStart, mono });
    if (this.kept.length > 2) this.kept.shift();
    this.renderedFrames = piece.outEnd;
    this.mono.length = this.renderedFrames;
    if (this.sink) await this.sink.append(outL, outR);
    const next = this.pieces[this.next];
    releaseBuffers(this.plan, next ? next.ctxStart / this.sampleRate : Infinity);
  }
}

/**
 * Render `seconds` of the Timeline's sound rows from show time 0, whole (for
 * tests and short sounds; a render streams it with TimelineSoundStream).
 * Returns null when there is nothing to hear.
 */
export async function renderTimelineSound(
  doc: Doc,
  seconds: number,
  opts: { sampleRate?: number; step?: number; Offline?: typeof OfflineAudioContext; pieceSeconds?: number } = {},
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number } | null> {
  const parts: Array<[Float32Array, Float32Array]> = [];
  const stream = await TimelineSoundStream.open(doc, seconds, { ...opts, sink: { append: async (l, r) => { parts.push([l, r]); } } });
  if (!stream) return null;
  await stream.finish();
  const left = new Float32Array(stream.frames);
  const right = new Float32Array(stream.frames);
  let o = 0;
  for (const [l, r] of parts) { left.set(l, o); right.set(r, o); o += l.length; }
  return { left, right, sampleRate: stream.sampleRate };
}

type Invoke = (ch: string, args: unknown) => Promise<{ success?: boolean; path?: string; error?: string } | null>;

/**
 * A WAV in a temp folder of the desktop app, written a piece at a time, for
 * the render mux, which deletes it once the sound is in the video (or the
 * render is cancelled: discardSoundtrackWav). Null off the desktop.
 */
export async function openSoundtrackWav(sampleRate: number): Promise<(SoundSink & { path: string; close(): Promise<void> }) | null> {
  const invoke = getRawElectronApi()?.invoke;
  if (!invoke) return null;
  const opened = await invoke('show_audio_soundtrack_open', { sampleRate });
  if (!opened?.success || !opened.path) throw new Error(opened?.error || 'the sound could not be saved for the video');
  const path = opened.path;
  return {
    path,
    async append(left, right) {
      const res = await invoke('show_audio_soundtrack_append', { path, bytes: encodeWav(left, right, sampleRate).subarray(44) });
      if (!res?.success) throw new Error(res?.error || 'the sound could not be saved for the video');
    },
    async close() {
      const res = await invoke('show_audio_soundtrack_close', { path });
      if (!res?.success) throw new Error(res?.error || 'the sound could not be saved for the video');
    },
  };
}

export async function discardSoundtrackWav(path: string | null): Promise<void> {
  const api = getRawElectronApi();
  if (path && api?.invoke) await api.invoke('show_audio_discard', { path }).catch(() => {});
}
