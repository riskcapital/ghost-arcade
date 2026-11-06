/**
 * Music motion: the smooth signals visuals move with, and the maths that
 * turns them into a shader's time and params.
 *
 * Pure and shared. The Music Studio's visual voices integrate their notes
 * through `smoothSignals` / `surge`, and the Music motion engine
 * (musicMotionEngine.ts) feeds the same maths from the app's audio input.
 *
 *   swell  the envelope with a soft rise and a long fall
 *   pulse  each hit as a surge that eases in and dies away over ~0.5 s
 *   flow   a clock that runs faster as swell and pulse rise, never backwards
 *   morph  the hit count on a critically damped spring: a glide per hit
 *   level  how loud the part plays now against its own recent average
 */


export interface SmoothSignalState {
  /** The envelope eased: a soft rise and a long, smooth fall. */
  swell: number;
  /** Hits as an impulse that decays; `pulse` follows it with a soft attack. */
  kick: number;
  pulse: number;
  /** A clock that runs faster as the sound swells and surges, never jumping. */
  flow: number;
  /** Hits counted without wrapping, and a spring easing toward them. */
  hits: number;
  morph: number;
  morphVel: number;
  /** The envelope averaged over ~0.3 s: how loud the part is playing now. */
  att: number;
  /** `att` averaged over a few seconds: what "normal" is right now. */
  usual: number;
}

export function freshSmoothSignals(): SmoothSignalState {
  return { swell: 0, kick: 0, pulse: 0, flow: 0, hits: 0, morph: 0, morphVel: 0, att: 0, usual: 0 };
}

export const SWELL_RISE = 0.06;
export const SWELL_FALL = 0.45;
export const KICK_DECAY = 0.45;
export const PULSE_RISE = 0.035;
export const MORPH_OMEGA = 7;
const ATT_SECONDS = 0.3;
const USUAL_SECONDS = 4;
/** `flow` wraps here so it stays precise in a float uniform. */
export const FLOW_WRAP = 1000;
/** A floor so silence reads as "quiet" (below 1), not as a ratio of two zeros. */
const LEVEL_FLOOR = 0.04;

/** One-pole smoothing towards `target` with an attack and a release time, in seconds. */
export function attackRelease(current: number, target: number, dt: number, attack: number, release: number): number {
  if (!(dt > 0)) return current;
  const tau = Math.max(1e-4, target > current ? attack : release);
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/** How fast `flow` runs, per second. */
export function flowRate(swell: number, pulse: number): number {
  return 0.25 + 1.4 * swell + 0.9 * pulse;
}

/** A hit (0-1): stacks on a busy part without running away, and counts towards morph. */
export function surge(state: SmoothSignalState, velocity: number): void {
  const v = Math.max(0, Math.min(1, Number.isFinite(velocity) ? velocity : 0));
  state.kick = Math.min(1.25, state.kick + v * (1 - 0.5 * Math.min(1, state.kick)));
  state.hits += 1;
}

/** Advance every signal by `dt` seconds with the envelope at `env`. */
export function smoothSignals(state: SmoothSignalState, env: number, dt: number): void {
  if (!(dt > 0)) return;
  const k = (tau: number) => 1 - Math.exp(-dt / tau);
  state.swell = attackRelease(state.swell, env, dt, SWELL_RISE, SWELL_FALL);
  state.kick *= Math.exp(-dt / KICK_DECAY);
  state.pulse += (Math.min(1, state.kick) - state.pulse) * k(PULSE_RISE);
  state.flow = (state.flow + dt * flowRate(state.swell, state.pulse)) % FLOW_WRAP;
  state.att += (env - state.att) * k(ATT_SECONDS);
  state.usual += (state.att - state.usual) * k(USUAL_SECONDS);
  // Critically damped spring toward the hit count, in small steps so long frames stay stable.
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, 1 / 120);
    const accel = MORPH_OMEGA * MORPH_OMEGA * (state.hits - state.morph) - 2 * MORPH_OMEGA * state.morphVel;
    state.morphVel += accel * h;
    state.morph += state.morphVel * h;
    left -= h;
  }
  // Keep the pair small without moving the gap between them.
  if (state.hits > 1e6) {
    state.hits -= 1e6;
    state.morph -= 1e6;
  }
}

/** Loudness now relative to the recent average: near 1 whatever the track's loudness. */
export function signalLevel(state: SmoothSignalState): number {
  return Math.min(3, (state.att + LEVEL_FLOOR) / (state.usual + LEVEL_FLOOR));
}

// ─────────────────────────────────────────────────────────────────
// Music motion on a shader
// ─────────────────────────────────────────────────────────────────

/** Saved on a shader layer's source or a shader VJ clip. */
export interface MusicMotionSettings {
  on: boolean;
  /** 0-1: how far the music pushes time and params. */
  amount: number;
  /** The float params it drives; absent means "pick for me". */
  params?: string[];
}

export const MUSIC_MOTION_DEFAULT_AMOUNT = 0.6;

/** A saved setting made safe, or undefined when there is nothing worth keeping. */
export function normalizeMusicMotion(raw: unknown): MusicMotionSettings | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const amountRaw = Number(r.amount);
  const amount = Number.isFinite(amountRaw) ? Math.max(0, Math.min(1, amountRaw)) : MUSIC_MOTION_DEFAULT_AMOUNT;
  const out: MusicMotionSettings = { on: r.on === true, amount };
  if (Array.isArray(r.params)) {
    out.params = [...new Set(r.params.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 128))];
  }
  return out;
}

/** The slowest the music clock runs, as a share of normal time: it never stops. */
export const MIN_TIME_RATE = 0.1;
export const MAX_TIME_RATE = 4;

/**
 * How fast a shader's time runs: 1 at Amount 0; at full Amount about a third
 * in quiet passages and up to about three times when the music is loud and busy.
 */
export function musicTimeRate(swell: number, pulse: number, amount: number): number {
  const a = Math.max(0, Math.min(1, amount));
  const music = 0.35 + 1.6 * Math.max(0, swell) + 1.0 * Math.max(0, Math.min(1, pulse));
  const rate = 1 + a * (music - 1);
  return Math.max(MIN_TIME_RATE, Math.min(MAX_TIME_RATE, rate));
}

/**
 * The flow clock as an offset from the renderer's own time: the shader sees
 * TIME + offset, which then runs at `rate`. Since rate > 0 the shader's time
 * only ever moves forward.
 */
export function advanceFlowOffset(offset: number, rate: number, dt: number): number {
  if (!(dt > 0) || !Number.isFinite(dt)) return offset;
  const next = offset + (Math.max(MIN_TIME_RATE, rate) - 1) * Math.min(dt, 0.25);
  // Keep the offset bounded (a long quiet set would otherwise drift far below
  // zero); the jump of a whole wrap is a shader's ordinary TIME range, and
  // happens at most once every few hours.
  return next < -1e5 ? next + 1e5 : next > 1e5 ? next - 1e5 : next;
}

/** The parts of a shader input Music motion looks at. */
export interface MotionInput {
  NAME: string;
  TYPE: string;
  MIN?: number;
  MAX?: number;
  VALUES?: unknown;
  LABEL?: string;
}

/** Which signal moves a param. */
export type MusicMotionRole = 'swell' | 'pulse' | 'morph';

const DRIVE_HINTS = /speed|rate|scale|zoom|size|intens|amount|bright|glow|hue|color|colour|sat|warp|distort|twist|rot|spin|freq|density|detail|complex|morph|shift|wave|energy|strength|radius|amp|power|contrast|pulse|flow|evol|chaos|noise/i;
const SKIP_HINTS = /^(vx|aud|audio|mix|opacity|alpha|seed|mode|preset|quality|steps|iter|layers?|count|octaves|samples|resolution|res)$|^(vx)|seed|mode|quality|iteration|samples|resolution|aspect|offset[xy]?$|^pos|position|center|centre|^x$|^y$/i;

/** True for a float param Music motion can drive. */
export function isDrivableInput(input: MotionInput): boolean {
  if (input.TYPE !== 'float') return false;
  if (Array.isArray(input.VALUES) && input.VALUES.length > 0) return false;
  if (typeof input.MIN === 'number' && typeof input.MAX === 'number' && !(input.MAX > input.MIN)) return false;
  return true;
}

/**
 * The params to drive when the user has not chosen: float params whose names
 * suggest speed, scale, intensity, colour, zoom and the like, at most four.
 * With no such names it falls back to the first two plain float params.
 */
export function pickMusicMotionParams(inputs: readonly MotionInput[], max = 4): string[] {
  const drivable = inputs.filter((i) => isDrivableInput(i) && !SKIP_HINTS.test(i.NAME));
  const hinted = drivable.filter((i) => DRIVE_HINTS.test(i.NAME)).map((i) => i.NAME);
  if (hinted.length) return hinted.slice(0, max);
  return drivable.slice(0, Math.min(2, max)).map((i) => i.NAME);
}

/** The params actually driven: the saved choice (only ones the shader still has) or the automatic pick. */
export function musicMotionParams(settings: MusicMotionSettings, inputs: readonly MotionInput[]): string[] {
  if (settings.params) {
    const ok = new Set(inputs.filter(isDrivableInput).map((i) => i.NAME));
    return settings.params.filter((p) => ok.has(p));
  }
  return pickMusicMotionParams(inputs);
}

/** Speed-like params ride the swell, sizes and intensities the pulse, colours and shapes the morph. */
export function musicMotionRole(name: string, index: number): MusicMotionRole {
  if (/hue|color|colour|morph|shift|shape|twist|rot|spin|evol|pattern/i.test(name)) return 'morph';
  if (/intens|bright|glow|amount|strength|pulse|amp|power|contrast|zoom|scale|size|radius/i.test(name)) return 'pulse';
  if (/speed|rate|flow|freq|warp|distort|density|detail|wave|energy|chaos|noise/i.test(name)) return 'swell';
  return (['swell', 'pulse', 'morph'] as const)[index % 3];
}

export interface MusicMotionFrame {
  swell: number;
  pulse: number;
  /** The morph spring position (hits so far, eased). */
  morph: number;
}

/**
 * A driven param's value: its own value moved by the music, scaled by Amount
 * and kept inside the param's range. The swell pushes both ways around the
 * value, the pulse pushes up, the morph swings smoothly once every few hits.
 */
export function drivenParamValue(base: number, min: number, max: number, role: MusicMotionRole, frame: MusicMotionFrame, amount: number): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const span = hi - lo;
  const a = Math.max(0, Math.min(1, amount));
  if (!(span > 0) || !Number.isFinite(base)) return base;
  let push: number;
  if (role === 'swell') push = (Math.max(0, Math.min(1.25, frame.swell)) - 0.35) * 0.5;
  else if (role === 'pulse') push = Math.max(0, Math.min(1, frame.pulse)) * 0.35;
  else push = Math.sin(frame.morph * (Math.PI / 4)) * 0.25;
  let value = base + push * a * span;
  // Near the top a push up turns round, so a param at its max still moves.
  if (value > hi) value = Math.max(lo, base - (value - base));
  return Math.max(lo, Math.min(hi, value));
}

/** The ISF input that carries the flow clock offset on renderers that own TIME. */
export const MUSIC_TIME_INPUT = 'gaMusicTimeOffset';

/**
 * A copy of an ISF shader whose time runs on the music clock: it gains a float
 * input `gaMusicTimeOffset`, and TIME in its code reads TIME + that offset.
 * Returns the code unchanged when it cannot be rewritten safely.
 */
export function withMusicTime(shaderCode: string): string {
  const open = shaderCode.indexOf('/*');
  const close = open >= 0 ? shaderCode.indexOf('*/', open + 2) : -1;
  if (open < 0 || close < 0) return shaderCode;
  let header: any;
  try {
    header = JSON.parse(shaderCode.slice(open + 2, close));
  } catch {
    return shaderCode;
  }
  if (!header || typeof header !== 'object') return shaderCode;
  const inputs = Array.isArray(header.INPUTS) ? header.INPUTS : [];
  if (inputs.some((i: any) => i?.NAME === MUSIC_TIME_INPUT)) return shaderCode;
  header = { ...header, INPUTS: [...inputs, { NAME: MUSIC_TIME_INPUT, TYPE: 'float', DEFAULT: 0, MIN: -1e6, MAX: 1e6 }] };
  const body = shaderCode
    .slice(close + 2)
    .split('\n')
    .map((line) => (/^\s*uniform\s+\w+\s+TIME\b/.test(line) ? line : line.replace(/\bTIME\b/g, `(TIME + ${MUSIC_TIME_INPUT})`)))
    .join('\n');
  return `${shaderCode.slice(0, open)}/*${JSON.stringify(header, null, 2)}*/${body}`;
}
