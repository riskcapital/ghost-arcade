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
export const MIN_TIME_RATE = 0.5;
export const MAX_TIME_RATE = 2;

/**
 * How fast a shader's time runs: 1 at Amount 0; at full Amount about a third
 * in quiet passages and up to about three times when the music is loud and busy.
 */
/**
 * How fast a shader's time runs: 1 at Amount 0, and with no music. Against
 * the music's own usual level, so ordinary playing runs at about 1x whatever
 * the input gain; busier and louder up to 2x, quiet passages down to 0.5x.
 */
export function musicTimeRate(state: Pick<SmoothSignalState, 'att' | 'usual' | 'pulse'>, amount: number, active = true): number {
  if (!active) return 1;
  const a = Math.max(0, Math.min(1, amount));
  const ratio = (Math.max(0, state.att) + LEVEL_FLOOR) / (Math.max(0, state.usual) + LEVEL_FLOOR);
  const music = Math.pow(Math.max(0.25, Math.min(4, ratio)), 0.8) + 0.45 * (Math.max(0, Math.min(1, state.pulse)) - 0.25);
  const rate = 1 + a * (music - 1);
  return Math.max(MIN_TIME_RATE, Math.min(MAX_TIME_RATE, rate));
}

/** How quickly the clock's speed follows the music, in seconds (up, down): changes of speed glide, never step. */
export const RATE_RISE = 0.25;
export const RATE_FALL = 0.6;

/**
 * The music clock of one shader: the speed it runs at (gliding toward the
 * music's), and how far it has drifted from the renderer's own time. The
 * shader sees TIME + offset, which runs at `rate`; since rate > 0 it only
 * ever moves forward.
 */
export interface MusicClock {
  offset: number;
  rate: number;
}

export function stepMusicClock(clock: MusicClock, targetRate: number, dt: number): void {
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const step = Math.min(dt, 0.25);
  clock.rate = attackRelease(clock.rate, targetRate, step, RATE_RISE, RATE_FALL);
  clock.offset += (Math.max(MIN_TIME_RATE, clock.rate) - 1) * step;
  // Bounded; a whole wrap is an ordinary shader TIME range and happens at most every few hours.
  if (clock.offset < -1e5) clock.offset += 1e5;
  else if (clock.offset > 1e5) clock.offset -= 1e5;
}

/**
 * For a renderer that keeps its own TIME between updates (the native core):
 * the phase that makes TIME * rate + phase equal the music clock at the
 * renderer's time `time`. Between updates the renderer runs the clock at
 * `rate` itself, so it glides rather than holding and catching up.
 */
export function musicTimePhase(time: number, offset: number, rate: number): number {
  return time + offset - time * rate;
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

/** The ISF inputs that carry the music clock to renderers that own TIME: its speed and its phase. */
export const MUSIC_TIME_RATE_INPUT = 'gaMusicTimeRate';
export const MUSIC_TIME_PHASE_INPUT = 'gaMusicTimePhase';

/**
 * A copy of an ISF shader whose time runs on the music clock: it gains a float
 * rate and phase inputs, and TIME in its code reads TIME * rate + phase.
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
  if (inputs.some((i: any) => i?.NAME === MUSIC_TIME_RATE_INPUT)) return shaderCode;
  header = {
    ...header,
    INPUTS: [
      ...inputs,
      { NAME: MUSIC_TIME_RATE_INPUT, TYPE: 'float', DEFAULT: 1, MIN: 0, MAX: 10 },
      { NAME: MUSIC_TIME_PHASE_INPUT, TYPE: 'float', DEFAULT: 0, MIN: -1e7, MAX: 1e7 },
    ],
  };
  const body = shaderCode
    .slice(close + 2)
    .split('\n')
    .map((line) => (/^\s*uniform\s+\w+\s+TIME\b/.test(line) ? line : line.replace(/\bTIME\b/g, `(TIME * ${MUSIC_TIME_RATE_INPUT} + ${MUSIC_TIME_PHASE_INPUT})`)))
    .join('\n');
  return `${shaderCode.slice(0, open)}/*${JSON.stringify(header, null, 2)}*/${body}`;
}

// ── Shaders made for Music motion ───────────────────────────────────────

/**
 * Inputs a shader made for Music motion reads directly, each fed every frame
 * (all smooth, none steps):
 *  - mmFlow: its own time, seconds, running faster and slower with the music;
 *  - mmSwell: the music's energy, 0-1, rising quickly and falling slowly;
 *  - mmPulse: a hit, 0-1, jumping on each beat and dying away;
 *  - mmMorph: a count of hits, gliding from one whole number to the next.
 * A shader with any of them is "ready": it gets these instead of the wrapper
 * (its TIME and sliders are left alone).
 */
export const MUSIC_MOTION_INPUTS = ['mmFlow', 'mmSwell', 'mmPulse', 'mmMorph'] as const;

export function isMusicMotionReady(inputs: ReadonlyArray<{ NAME?: string }> | null | undefined): boolean {
  return !!inputs?.some((i) => (MUSIC_MOTION_INPUTS as readonly string[]).includes(i?.NAME ?? ''));
}

/** Ready-made inputs from shader code (header only), for library badges. */
export function shaderIsMusicMotionReady(code: string | null | undefined): boolean {
  if (!code) return false;
  const close = code.indexOf('*/');
  const header = close > 0 ? code.slice(0, close) : code.slice(0, 4000);
  return MUSIC_MOTION_INPUTS.some((n) => header.includes(`"${n}"`));
}

/**
 * Hits from the audio follower's fast and slow bass and its highs: a rise
 * well above the recent run of rises is a hit. Adaptive, so it finds the
 * beat at any input gain.
 */
export interface OnsetState {
  prevBass: number;
  prevHigh: number;
  mean: number;
  dev: number;
  since: number;
}

export function freshOnsets(): OnsetState {
  return { prevBass: 0, prevHigh: 0, mean: 0, dev: 0.02, since: 1 };
}

/** Returns a hit's strength 0-1 when this frame is a hit, else 0. */
export function detectOnset(o: OnsetState, bassFast: number, high: number, dt: number): number {
  const flux = Math.max(0, bassFast - o.prevBass) + 0.5 * Math.max(0, high - o.prevHigh);
  o.prevBass = bassFast;
  o.prevHigh = high;
  o.since += dt;
  const k = 1 - Math.exp(-dt / 1.2);
  const threshold = o.mean + 2.2 * o.dev + 0.004;
  const hit = flux > threshold && o.since > 0.11;
  o.mean += (flux - o.mean) * k;
  o.dev += (Math.abs(flux - o.mean) - o.dev) * k;
  if (!hit) return 0;
  o.since = 0;
  return Math.max(0.35, Math.min(1, (flux - o.mean) / (6 * o.dev + 1e-4)));
}
