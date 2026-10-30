/**
 * The studio mixer: a channel strip for every instrument of the set and for
 * the live input.
 *
 * Each strip sits between an instrument's volume and the mix:
 *
 *   volume -> low shelf -> mid peak -> high shelf -> pan -> mute/solo -> FX rack or mix
 *
 * The volume fader stays where it was (`volumes` in the studio state), so
 * scenes, the bath morph and the dub drop keep working on it. The strip adds
 * the EQ, pan, mute and solo, and a meter tap after it.
 */

import type { InstrumentId } from './noteEvents';
import { VOICE_SOURCES, type VoiceSourceId } from './visualVoices';

/** The live input's channel sits beside the instruments. */
export type ChannelId = InstrumentId | 'input';

export const CHANNEL_LABELS: Record<ChannelId, string> = {
  synth: 'Synth',
  keys: 'Keys',
  drums: 'Drums',
  drone: 'Drone',
  bowls: 'Bowls',
  acid: 'Acid',
  xy: 'XY',
  dubbass: 'Bass',
  siren: 'Siren',
  shots: 'Shots',
  analog: 'Analog',
  scan: 'Scan',
  input: 'Input',
};

export interface ChannelStrip {
  /** Band gains in dB, -EQ_RANGE_DB to +EQ_RANGE_DB. */
  low: number;
  mid: number;
  high: number;
  /** -1 left to 1 right. */
  pan: number;
  mute: boolean;
  solo: boolean;
}

export type EqBand = 'low' | 'mid' | 'high';

export const EQ_RANGE_DB = 15;

/** Where each band sits. */
export const EQ_BANDS: Record<EqBand, { type: BiquadFilterType; frequency: number; q: number; label: string }> = {
  low: { type: 'lowshelf', frequency: 180, q: 0.7, label: 'Low' },
  mid: { type: 'peaking', frequency: 1100, q: 0.8, label: 'Mid' },
  high: { type: 'highshelf', frequency: 4800, q: 0.7, label: 'High' },
};

export const EQ_BAND_IDS: readonly EqBand[] = ['low', 'mid', 'high'];

export function defaultStrip(): ChannelStrip {
  return { low: 0, mid: 0, high: 0, pan: 0, mute: false, solo: false };
}

function clampNumber(value: unknown, lo: number, hi: number, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
}

export function normalizeStrip(raw: unknown): ChannelStrip {
  const d = defaultStrip();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof ChannelStrip, unknown>>;
  return {
    low: clampNumber(r.low, -EQ_RANGE_DB, EQ_RANGE_DB, d.low),
    mid: clampNumber(r.mid, -EQ_RANGE_DB, EQ_RANGE_DB, d.mid),
    high: clampNumber(r.high, -EQ_RANGE_DB, EQ_RANGE_DB, d.high),
    pan: clampNumber(r.pan, -1, 1, d.pan),
    mute: r.mute === true,
    solo: r.solo === true,
  };
}

export type MixerState = Partial<Record<ChannelId, ChannelStrip>>;

export function normalizeMixer(raw: unknown): MixerState {
  if (!raw || typeof raw !== 'object') return {};
  const out: MixerState = {};
  for (const [id, strip] of Object.entries(raw as Record<string, unknown>)) {
    if (id in CHANNEL_LABELS) out[id as ChannelId] = normalizeStrip(strip);
  }
  return out;
}

export function stripFor(mixer: MixerState, id: ChannelId): ChannelStrip {
  return mixer[id] ?? defaultStrip();
}

/**
 * Whether a channel is heard: muted channels never are, and while any
 * channel is soloed only soloed channels are. `among` is the channels in
 * play, so a solo left on an instrument of another set does not silence this one.
 */
export function channelAudible(mixer: MixerState, id: ChannelId, among: readonly ChannelId[]): boolean {
  const strip = stripFor(mixer, id);
  if (strip.mute) return false;
  const anySolo = among.some((c) => stripFor(mixer, c).solo);
  return !anySolo || strip.solo;
}

/** Peak of a block of samples on a meter scale: 0 at -60 dBFS, 1 at 0 dBFS. */
export function meterLevel(samples: ArrayLike<number>): number {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak <= 0.001) return 0;
  const db = 20 * Math.log10(peak);
  return Math.max(0, Math.min(1, (db + 60) / 60));
}

/** "+3.5 dB", "0 dB". */
export function formatDb(db: number): string {
  const r = Math.round(db * 2) / 2;
  if (r === 0) return '0 dB';
  return `${r > 0 ? '+' : ''}${r} dB`;
}

/** "L 40", "C", "R 25". */
export function formatPan(pan: number): string {
  const r = Math.round(pan * 50);
  if (r === 0) return 'C';
  return r < 0 ? `L ${-r * 2}` : `R ${r * 2}`;
}

/** The live input: what it feeds the visuals as, and how it listens. */
export interface LiveInputSettings {
  /** The sound the visual voices see it as. */
  role: VoiceSourceId;
  /** 0-1: higher hears quieter playing. */
  sensitivity: number;
  /** The input channel's fader, 0-1. */
  volume: number;
  /** Hear it through the mix; off, it only drives the visuals. */
  monitor: boolean;
}

export function defaultLiveInput(): LiveInputSettings {
  return { role: 'lead', sensitivity: 0.5, volume: 0.5, monitor: true };
}

export function normalizeLiveInput(raw: unknown): LiveInputSettings {
  const d = defaultLiveInput();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof LiveInputSettings, unknown>>;
  return {
    role: VOICE_SOURCES.some((v) => v.id === r.role) ? (r.role as VoiceSourceId) : d.role,
    sensitivity: clampNumber(r.sensitivity, 0, 1, d.sensitivity),
    volume: clampNumber(r.volume, 0, 1, d.volume),
    monitor: r.monitor === undefined ? d.monitor : r.monitor === true,
  };
}
