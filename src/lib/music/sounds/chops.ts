/**
 * Chops: a band loop sliced into eight and put on the FX pads, played as
 * one-shots (stabs, dub-style).
 *
 * The pads hold library sound ids, so each slice is a sound of its own
 * under `chop-1` to `chop-8`, which the library's lookup finds before its
 * own sounds (library.ts: soundById). They are this session's audio and are
 * never saved: the project file and a song keep what the pads held before
 * they were chopped (`unchoppedFxPads`), and closing the studio puts that
 * back. A file from before that has a chop id on a pad gets the set's
 * default there when it opens.
 */

import { chopPlayback, sliceBounds } from '../looperMath';
import { DEFAULT_FX_PADS, type FxPads } from '../soundSlots';
import type { StudioSet } from '../studioSets';
import { fadeableHandle, holdAt, velocityGain, type SoundContext, type SoundDef, type SoundHandle } from './kit';

export const CHOP_COUNT = 8;
const CHOP_ID = /^chop-[1-9][0-9]*$/;
/** Loudness at velocity 0.8, which a chop's level is set against: there it plays as recorded. */
const REF_GAIN = velocityGain(0.8);

export function chopId(index: number): string {
  return `chop-${index + 1}`;
}

export function isChopId(id: string | null | undefined): boolean {
  return typeof id === 'string' && CHOP_ID.test(id);
}

const chops = new Map<string, SoundDef>();
/** Chops sounding now, so the kill switch can cut them. */
const sounding = new Set<{ src: AudioBufferSourceNode; amp: GainNode; ctx: BaseAudioContext }>();

/** Slice a loop into the chops (replacing any before). Returns their ids, pad by pad. */
export function setChops(buffer: AudioBuffer, from = 'the loop'): string[] {
  chops.clear();
  return sliceBounds(buffer.length, CHOP_COUNT).map((slice, i) => {
    const def = chopDef(buffer, i, slice.start, slice.end, from);
    chops.set(def.id, def);
    return def.id;
  });
}

/** Let the chops go (what is sounding rings out). */
export function clearChops(): void {
  chops.clear();
}

export function hasChops(): boolean {
  return chops.size > 0;
}

/** The chop under an id, if there is one this session. */
export function chopSound(id: string | null | undefined): SoundDef | undefined {
  return id ? chops.get(id) : undefined;
}

/** Cut every sounding chop (the kill switch). */
export function stopChops(): void {
  for (const voice of [...sounding]) {
    sounding.delete(voice);
    const t = voice.ctx.currentTime;
    try {
      holdAt(voice.amp.gain, t);
      voice.amp.gain.setTargetAtTime(0, t, 0.005);
      voice.src.stop(t + 0.04);
    } catch { /* already stopped */ }
  }
}

function chopDef(buffer: AudioBuffer, index: number, start: number, end: number, from: string): SoundDef {
  return {
    id: chopId(index),
    name: `Chop ${index + 1}`,
    category: 'dub',
    kind: 'shot',
    pitched: false,
    blurb: `Slice ${index + 1} of ${CHOP_COUNT} of ${from}. It lasts until the studio closes.`,
    play: (sc, _note, velocity, time) => playChop(sc, buffer, start, end, velocity, time),
  };
}

function playChop(sc: SoundContext, buffer: AudioBuffer, start: number, end: number, velocity: number, time: number): SoundHandle {
  const ctx = sc.ctx;
  const p = chopPlayback(start, end, buffer.length, buffer.sampleRate, { size: sc.size, tail: sc.tail, tone: sc.tone });
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = p.rate;
  let last: AudioNode = src;
  for (const [type, frequency] of [['lowpass', p.lowpass], ['highpass', p.highpass]] as const) {
    if (frequency === null) continue;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = frequency;
    f.Q.value = 0.7;
    last.connect(f);
    last = f;
  }
  // A few milliseconds in and out, so a slice cut mid-sound does not click.
  const amp = ctx.createGain();
  const level = Math.max(0.01, velocityGain(velocity) / REF_GAIN);
  const ends = time + p.heard;
  const fade = Math.min(0.006, p.heard / 4);
  amp.gain.value = 0;
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime(level, time + Math.min(0.002, p.heard / 4));
  amp.gain.setValueAtTime(level, ends - fade);
  amp.gain.linearRampToValueAtTime(0, ends);
  last.connect(amp).connect(sc.out);
  const voice = { src, amp, ctx };
  sounding.add(voice);
  src.onended = () => {
    sounding.delete(voice);
    try { amp.disconnect(); } catch { /* gone */ }
  };
  src.start(time, p.offset, p.length);
  src.stop(ends + 0.02);
  return fadeableHandle(p.heard, amp, time);
}

// ── What the pads held before ──

/** What each set's FX pads held before chops went on them. */
const padsBefore = new Map<StudioSet, string[]>();

/** Keep what a set's pads hold now (chops already on them stay as they were before). */
export function rememberPadsBefore(set: StudioSet, pads: readonly string[]): void {
  padsBefore.set(set, unchoppedPads(set, pads));
}

/** Forget what a set's pads held (every set's when none is given): they have been put back. */
export function forgetPadsBefore(set?: StudioSet): void {
  if (set) padsBefore.delete(set);
  else padsBefore.clear();
}

/**
 * A set's pads with each chop replaced by what the pad held before it was
 * chopped, or the set's default when that is not known (`remembered` false:
 * always the default, for a file opened from disk).
 */
export function unchoppedPads(set: StudioSet, pads: readonly string[], remembered = true): string[] {
  const before = remembered ? padsBefore.get(set) : undefined;
  return pads.map((pad, i) => (isChopId(pad) ? (before?.[i] ?? DEFAULT_FX_PADS[set][i] ?? pad) : pad));
}

/** Every set's pads with no chops on them: what a save or a song keeps. */
export function unchoppedFxPads(fxPads: FxPads, remembered = true): FxPads {
  const out = {} as FxPads;
  for (const set of Object.keys(fxPads) as StudioSet[]) out[set] = unchoppedPads(set, fxPads[set], remembered);
  return out;
}
