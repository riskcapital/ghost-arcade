/**
 * Control lines: the one kind of line on the Timeline.
 *
 * A line drives one parameter (target + registry key). It is drawn (points
 * with a curve to the next point) and/or it follows a source: the song's
 * audio features or stems, the beat/bar grid, a Live knob or track level, or
 * a MIDI CC.
 *
 * Combine rule (one formula for every line):
 *
 *     value = clamp( base(t) + depth(t) × (max − min) × s(t) )
 *
 *   base(t)   the drawn line; without points, `follow.base`, else the
 *             parameter's default
 *   depth(t)  how much the source moves it, as a fraction of the range:
 *             `follow.depthPoints` when drawn (the artist draws "how much
 *             the music moves it", e.g. none in the verse, full in the drop),
 *             else the constant `follow.depth`. Negative depth pushes down.
 *   s(t)      the source, 0..1 (−1..1 when `bipolar`), shaped by `curve`
 *             and averaged over `smooth` seconds
 *
 * The drawn line is the resting value and the music moves it from there,
 * which keeps a drawn line readable on its own and makes depth mean the same
 * thing on every parameter. Stepped values round to the step, bools switch
 * at the middle of the range, colours mix per channel toward `follow.color`.
 *
 * Saved as plain JSON (`ControlLine[]`); see normalizeLines.
 */
import type { KeyframeEasing } from '../../types';
import type { ParamKind, ParamTarget } from './paramRegistry';
import { AUDIO_FEATURES, STEMS, type AudioFeature, type Stem } from './songFeatures';

/** Curve from a point to the next one. The easings are the keyframe ones. */
export type LineCurve = 'hold' | 'linear' | 'smooth' | Exclude<KeyframeEasing, 'linear' | 'step'>;
export const LINE_CURVES: readonly LineCurve[] = ['hold', 'linear', 'smooth', 'ease-in', 'ease-out', 'ease-in-out', 'sine', 'exponential', 'bounce', 'elastic'];

export interface LinePoint {
  /** Show seconds. */
  t: number;
  /** Value in the parameter's units (a colour is packed 0xRRGGBB). */
  v: number;
  /** Curve to the next point (default 'linear'; 'hold' for bools). */
  c?: LineCurve;
}

export type BeatShape = 'sine' | 'triangle' | 'saw' | 'ramp' | 'square' | 'pulse';
export const BEAT_SHAPES: readonly BeatShape[] = ['sine', 'triangle', 'saw', 'ramp', 'square', 'pulse'];

export type FollowSource =
  /** The show's song (offline analysis), or one audio track by id. */
  | { kind: 'audio'; feature: AudioFeature; track?: string }
  /** A stem; bands stand in until stems are split. */
  | { kind: 'stem'; stem: Stem; track?: string }
  /** An LFO locked to the beat grid: one cycle every `beats` quarter notes
   *  (4 = a 4/4 bar), offset by `phase` cycles. */
  | { kind: 'beat'; shape: BeatShape; beats: number; phase?: number }
  /** A Live device parameter (knob). Live-only. */
  | { kind: 'live-param'; track: number; device: number; param: number; deviceName?: string; paramName?: string }
  /** A Live track's level. Live-only. */
  | { kind: 'live-level'; track: number }
  /** A MIDI CC (channel 0..15, −1 any; `input` a device name). Live-only. */
  | { kind: 'midi'; cc: number; channel: number; input?: string };

export interface LineFollow {
  source: FollowSource;
  /** Fraction of the range, −1..1. */
  depth: number;
  /** Drawn depth over time, 0..1 (× sign of `depth` when set, else +). */
  depthPoints?: LinePoint[];
  /** Base for a line with no points (parameter units). */
  base?: number;
  /** Centre the source: s in −1..1. */
  bipolar?: boolean;
  /** Seconds the source is averaged over (smooths a jumpy source). */
  smooth?: number;
  /** Response exponent: 1 straight, above 1 punchier peaks. */
  curve?: number;
  /** Colour lines: the colour the source mixes toward (0xRRGGBB). */
  color?: number;
}

export interface ControlLine {
  id: string;
  target: ParamTarget;
  key: string;
  kind: ParamKind;
  min: number;
  max: number;
  step?: number;
  /** Value when nothing is drawn and nothing follows (the param's default). */
  default?: number;
  points: LinePoint[];
  follow?: LineFollow | null;
  /** Off: the line is kept but drives nothing. */
  enabled?: boolean;
  /** The name shown on the Timeline (the parameter's label when it was added). */
  label?: string;
  /** The curve's colour on the Timeline (#rrggbb); unset: one picked from the key. */
  color?: string;
}

export function isLiveOnlySource(source: FollowSource): boolean {
  return source.kind === 'live-param' || source.kind === 'live-level' || source.kind === 'midi';
}

// ── Save format ──────────────────────────────────────────────────────────

const finite = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

function normalizePoints(raw: unknown): LinePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: LinePoint[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const t = Number((p as any).t);
    const v = Number((p as any).v);
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    const c = (p as any).c;
    out.push(LINE_CURVES.includes(c) ? { t: Math.max(0, t), v, c } : { t: Math.max(0, t), v });
  }
  return out.sort((a, b) => a.t - b.t);
}

function normalizeSource(raw: any): FollowSource | null {
  if (!raw || typeof raw !== 'object') return null;
  switch (raw.kind) {
    case 'audio': return AUDIO_FEATURES.includes(raw.feature) ? { kind: 'audio', feature: raw.feature, ...(typeof raw.track === 'string' ? { track: raw.track } : {}) } : null;
    case 'stem': return STEMS.includes(raw.stem) ? { kind: 'stem', stem: raw.stem, ...(typeof raw.track === 'string' ? { track: raw.track } : {}) } : null;
    case 'beat': return { kind: 'beat', shape: BEAT_SHAPES.includes(raw.shape) ? raw.shape : 'sine', beats: Math.max(1 / 16, finite(raw.beats, 4)), phase: finite(raw.phase, 0) };
    case 'live-param': return { kind: 'live-param', track: finite(raw.track, 0), device: finite(raw.device, 0), param: finite(raw.param, 0), ...(raw.deviceName ? { deviceName: String(raw.deviceName) } : {}), ...(raw.paramName ? { paramName: String(raw.paramName) } : {}) };
    case 'live-level': return { kind: 'live-level', track: finite(raw.track, 0) };
    case 'midi': return { kind: 'midi', cc: Math.max(0, Math.min(127, Math.round(finite(raw.cc, 0)))), channel: Math.max(-1, Math.min(15, Math.round(finite(raw.channel, -1)))), ...(raw.input ? { input: String(raw.input) } : {}) };
  }
  return null;
}

/** Lines from a saved file: anything unreadable is dropped, never thrown. */
export function normalizeLines(raw: unknown): ControlLine[] {
  if (!Array.isArray(raw)) return [];
  const out: ControlLine[] = [];
  for (const r of raw as any[]) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || typeof r.key !== 'string') continue;
    const t = r.target;
    const target: ParamTarget | null = t?.scope === 'layer' && typeof t.id === 'string' ? { scope: 'layer', id: t.id }
      : t?.scope === 'block' && typeof t.id === 'string' ? { scope: 'block', id: t.id }
      : t?.scope === 'look' && typeof t.id === 'string' ? { scope: 'look', id: t.id }
      : t?.scope === 'sound' && typeof t.id === 'string' ? { scope: 'sound', id: t.id }
      : t?.scope === 'stage' ? { scope: 'stage' } : t?.scope === 'led' ? { scope: 'led' } : null;
    if (!target) continue;
    const kind: ParamKind = ['continuous', 'stepped', 'bool', 'colour'].includes(r.kind) ? r.kind : 'continuous';
    const min = finite(r.min, 0);
    const max = finite(r.max, kind === 'colour' ? 0xffffff : 1);
    const source = normalizeSource(r.follow?.source);
    out.push({
      id: r.id,
      target,
      key: r.key,
      kind,
      min: Math.min(min, max),
      max: Math.max(min, max),
      ...(Number.isFinite(r.step) && r.step > 0 ? { step: r.step } : {}),
      ...(Number.isFinite(r.default) ? { default: r.default } : {}),
      points: normalizePoints(r.points),
      follow: source ? {
        source,
        depth: Math.max(-1, Math.min(1, finite(r.follow.depth, 1))),
        ...(Array.isArray(r.follow.depthPoints) ? { depthPoints: normalizePoints(r.follow.depthPoints) } : {}),
        ...(Number.isFinite(r.follow.base) ? { base: r.follow.base } : {}),
        ...(r.follow.bipolar ? { bipolar: true } : {}),
        ...(Number.isFinite(r.follow.smooth) && r.follow.smooth > 0 ? { smooth: r.follow.smooth } : {}),
        ...(Number.isFinite(r.follow.curve) && r.follow.curve > 0 ? { curve: r.follow.curve } : {}),
        ...(Number.isFinite(r.follow.color) ? { color: r.follow.color } : {}),
      } : null,
      ...(r.enabled === false ? { enabled: false } : {}),
      ...(typeof r.label === 'string' && r.label ? { label: r.label } : {}),
      ...(typeof r.color === 'string' && /^#[0-9a-f]{6}$/i.test(r.color) ? { color: r.color } : {}),
    });
  }
  return out;
}
