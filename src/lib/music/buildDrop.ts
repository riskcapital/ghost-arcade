/**
 * Build-ups and drops: a build runs for a whole number of bars on the launch
 * clock and lands exactly on a bar line, where the drop fires. This module is
 * the plan (when it lands, when the roll hits, how far along it is) and the
 * settings; buildFx.ts is the sound and musicRuntime.ts runs it.
 */

import type { StudioSet } from './studioSets';
import { DROP_FX, DROP_FX_RELEASES, type DropFxId, type DropFxRelease } from './dropFx';

export type BuildRoll = 'snare' | 'clap' | 'hats' | 'none';
export type BuildFilter = 'highpass' | 'lowpass' | 'none';
export type BuildStyle = 'edm' | 'dub' | 'techno' | 'trap';
export const BUILD_LENGTHS = [1, 2, 4, 8] as const;
export type BuildLength = (typeof BUILD_LENGTHS)[number];

export interface BuildSettings {
  style: BuildStyle;
  bars: BuildLength;
  roll: BuildRoll;
  filter: BuildFilter;
  /** The riser and noise sweep, 0-1. */
  riser: number;
  /** How far the echo and reverb sends open, 0-1. */
  sends: number;
  /** The beat thins out in the last bar. */
  kickOut: boolean;
  /** A breath of silence just before the drop. */
  gap: boolean;
  /** The drop's impact (sub boom, crash), 0-1. */
  impact: number;
  /** At the drop, launch this scene and/or switch to this set. */
  dropScene: string | null;
  dropSet: StudioSet | null;
  /** A look that warps the output with the build and drop (dropFx.ts). */
  dropFx: DropFxId;
  /** How hard it hits, 0-1. */
  dropFxAmount: number;
  /** How long it takes to let go after the drop, in beats. */
  dropFxRelease: DropFxRelease;
}

type StyleFields = Omit<BuildSettings, 'bars' | 'dropScene' | 'dropSet' | 'dropFx' | 'dropFxAmount' | 'dropFxRelease'>;

export const BUILD_STYLES: { id: BuildStyle; label: string; settings: StyleFields }[] = [
  { id: 'edm', label: 'Classic EDM', settings: { style: 'edm', roll: 'snare', filter: 'highpass', riser: 0.9, sends: 0.6, kickOut: true, gap: true, impact: 0.9 } },
  { id: 'dub', label: 'Dub', settings: { style: 'dub', roll: 'clap', filter: 'lowpass', riser: 0.6, sends: 1, kickOut: false, gap: false, impact: 0.6 } },
  { id: 'techno', label: 'Techno', settings: { style: 'techno', roll: 'none', filter: 'lowpass', riser: 0.7, sends: 0.4, kickOut: true, gap: false, impact: 0.7 } },
  { id: 'trap', label: 'Trap', settings: { style: 'trap', roll: 'hats', filter: 'highpass', riser: 0.5, sends: 0.3, kickOut: true, gap: true, impact: 1 } },
];

export function defaultBuildSettings(): BuildSettings {
  return { ...BUILD_STYLES[0].settings, bars: 4, dropScene: null, dropSet: null, dropFx: 'none', dropFxAmount: 0.8, dropFxRelease: 4 };
}

export const BUILD_ROLLS: { id: BuildRoll; label: string }[] = [
  { id: 'snare', label: 'Snare roll' },
  { id: 'clap', label: 'Clap roll' },
  { id: 'hats', label: 'Hat roll' },
  { id: 'none', label: 'No roll' },
];

export const BUILD_FILTERS: { id: BuildFilter; label: string }[] = [
  { id: 'highpass', label: 'Thin out (high-pass up)' },
  { id: 'lowpass', label: 'Muffle (low-pass down)' },
  { id: 'none', label: 'No filter' },
];

// ── The plan ────────────────────────────────────────────────────────────

const BEATS_PER_BAR = 4;

/** The bar line a build started at `beat` lands on: the next bar line, then `bars` bars on. */
export function buildLanding(beat: number, bars: number): number {
  const nextBar = Math.ceil(beat / BEATS_PER_BAR - 1e-6) * BEATS_PER_BAR;
  return nextBar + Math.max(1, bars) * BEATS_PER_BAR;
}

/** How far along a build from `start` to `land` is at `beat`, 0-1. */
export function buildProgress(start: number, land: number, beat: number): number {
  if (land <= start) return 1;
  return Math.max(0, Math.min(1, (beat - start) / (land - start)));
}

export interface RollHit {
  beat: number;
  /** 0-1, rising through the build. */
  velocity: number;
  /** Semitones up, rising through the build. */
  pitch: number;
}

/**
 * The roll: the build in four equal parts at quarters, eighths, sixteenths
 * and thirty-seconds, louder and higher as it goes. Hits sit on the grid of
 * their part, counted from the landing bar line, so the last part runs
 * straight into the drop. A gap leaves the last eighth note empty.
 */
export function rollHits(start: number, land: number, gap = false): RollHit[] {
  const out: RollHit[] = [];
  const span = land - start;
  if (span <= 0) return out;
  const steps = [1, 0.5, 0.25, 0.125];
  const end = gap ? land - 0.5 : land;
  for (let part = 0; part < 4; part++) {
    const from = land - span + (span * part) / 4;
    const to = land - span + (span * (part + 1)) / 4;
    const step = steps[part];
    // Grid counted back from the landing, so every part lines up with the drop.
    let b = land - Math.floor((land - from) / step + 1e-6) * step;
    if (b < from - 1e-6) b += step;
    for (; b < to - 1e-6 && b < end - 1e-6; b += step) {
      if (b < start - 1e-6) continue;
      const p = buildProgress(start, land, b);
      out.push({ beat: b, velocity: 0.3 + 0.7 * p, pitch: Math.round(p * 12) });
    }
  }
  return out;
}

const unit = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : d);

export function normalizeBuildSettings(raw: unknown, sets: readonly StudioSet[]): BuildSettings {
  const d = defaultBuildSettings();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Partial<Record<keyof BuildSettings, unknown>>;
  return {
    style: BUILD_STYLES.some((s) => s.id === r.style) ? (r.style as BuildStyle) : d.style,
    bars: BUILD_LENGTHS.includes(r.bars as BuildLength) ? (r.bars as BuildLength) : d.bars,
    roll: BUILD_ROLLS.some((x) => x.id === r.roll) ? (r.roll as BuildRoll) : d.roll,
    filter: BUILD_FILTERS.some((x) => x.id === r.filter) ? (r.filter as BuildFilter) : d.filter,
    riser: unit(r.riser, d.riser),
    sends: unit(r.sends, d.sends),
    kickOut: typeof r.kickOut === 'boolean' ? r.kickOut : d.kickOut,
    gap: typeof r.gap === 'boolean' ? r.gap : d.gap,
    impact: unit(r.impact, d.impact),
    dropScene: typeof r.dropScene === 'string' ? r.dropScene : null,
    dropSet: sets.includes(r.dropSet as StudioSet) ? (r.dropSet as StudioSet) : null,
    dropFx: DROP_FX.some((x) => x.id === r.dropFx) ? (r.dropFx as DropFxId) : d.dropFx,
    dropFxAmount: unit(r.dropFxAmount, d.dropFxAmount),
    dropFxRelease: DROP_FX_RELEASES.includes(r.dropFxRelease as DropFxRelease) ? (r.dropFxRelease as DropFxRelease) : d.dropFxRelease,
  };
}
