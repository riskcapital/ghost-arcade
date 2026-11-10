/**
 * A Music Studio library sound (riser, impact, dub shot …) as a file, so a
 * Timeline block can hold it like any audio file: the same playback,
 * waveform, saving, follow analysis and render mux.
 *
 * The library's sounds are plain Web Audio, so they render offline on an
 * OfflineAudioContext. The noise and any randomness inside a sound are
 * seeded, so the same sound renders the same file every time.
 */
import { soundById } from '../../music/sounds/library';
import type { SoundDef } from '../../music/sounds/kit';
import { encodeWav } from '../../music/wav';

export const RENDER_SAMPLE_RATE = 48000;
/** Longest render (seconds): loops are cut here. */
const MAX_SECONDS = 16;
/** Trailing quiet below this is trimmed. */
const SILENCE = 1e-4;

export interface RenderedSound {
  def: SoundDef;
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  duration: number;
}

function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Render a library sound. `bars` (rises): the length to land on, in bars at `bpm`. */
export async function renderLibrarySound(
  soundId: string,
  opts: { bpm?: number; note?: number; bars?: number; Offline?: typeof OfflineAudioContext } = {},
): Promise<RenderedSound | null> {
  const def = soundById(soundId);
  const Offline = opts.Offline ?? (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext;
  if (!def || !Offline) return null;
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : 120;
  const barSeconds = (60 / bpm) * 4;
  const toNextBar = def.category === 'rise' ? barSeconds * (opts.bars ?? 2) : undefined;
  const length = Math.min(MAX_SECONDS, (toNextBar ?? 0) + 6);
  const ctx = new Offline(2, Math.ceil(length * RENDER_SAMPLE_RATE), RENDER_SAMPLE_RATE);
  const noise = ctx.createBuffer(1, RENDER_SAMPLE_RATE, RENDER_SAMPLE_RATE);
  const rand = seeded(hashId(soundId));
  const data = noise.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = rand() * 2 - 1;
  const out = ctx.createGain();
  out.connect(ctx.destination);
  // Sounds that pick something at random pick the same thing every render.
  const realRandom = Math.random;
  Math.random = seeded(hashId(soundId) ^ 0x5bd1e995);
  let handle;
  try {
    handle = def.play({ ctx, out, noise, tempo: bpm, toNextBar, keyRoot: 48, size: 0.5, tail: 0.5, tone: 0.5 }, opts.note ?? 60, 0.9, 0);
  } finally {
    Math.random = realRandom;
  }
  if (Number.isFinite(handle.duration)) {
    // Cut a little after its own end; a loop plays to the limit.
  } else {
    handle.stop(Math.max(1, length - 1), 0.8);
  }
  const buffer = await ctx.startRendering();
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
  let end = left.length;
  while (end > 1 && Math.abs(left[end - 1]) < SILENCE && Math.abs(right[end - 1]) < SILENCE) end--;
  end = Math.min(left.length, end + Math.round(0.02 * RENDER_SAMPLE_RATE));
  return { def, left: left.slice(0, end), right: right.slice(0, end), sampleRate: RENDER_SAMPLE_RATE, duration: end / RENDER_SAMPLE_RATE };
}

/** The rendered sound as WAV bytes. */
export function renderedWav(sound: RenderedSound): Uint8Array {
  return encodeWav(sound.left, sound.right, sound.sampleRate);
}
