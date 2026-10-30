/**
 * One-shot effects for the FX pads: dub shots, risers and drops, impacts.
 *
 * Each sound schedules all of its nodes from `time`, plays into `sc.out`,
 * lets everything go when it has finished and hands back a handle whose
 * `duration` is exactly when it ends, so the studio can hold a visual note
 * for that long (a riser drives the visuals as it builds). A pad can choke
 * any of them.
 *
 * The pads' knobs: Size (pitch and scale: small is high and tight, big is low
 * and wide), Tail (how long it rings, 0.3x to 2.5x; for a riser, how many
 * bars it builds over), Tone (dark to bright). Velocity plays louder and
 * brighter. Sounds that are tonal but not played at a pitch sit on the key's
 * root (`sc.keyRoot`); Size moves those by whole octaves so they stay in key.
 *
 * Risers and drops are measured in bars at the studio's tempo and land on a
 * bar line (see `landing`), so a build ends exactly on the one.
 *
 * The first eight are the dub set's original shots, carried over unchanged so
 * saved projects keep their sound.
 */
import {
  beatSeconds,
  envelope,
  fadeableHandle,
  midiToHz,
  noiseSource,
  releaseAfter,
  softCurve,
  velocityGain,
  type SoundContext,
  type SoundDef,
  type SoundHandle,
} from './kit';

type Ctx = BaseAudioContext;

// ── Knobs ───────────────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const unit = (x: number, fallback = 0.5) => (Number.isFinite(x) ? clamp(x, 0, 1) : fallback);

/** Loudness at velocity 0.8, which every level below is set against. */
const REF_GAIN = velocityGain(0.8);

interface Knobs {
  size: number;
  tone: number;
  vel: number;
  /** The old shots' pitch scale: 2 (small, high) to 0.5 (big, low), 1 in the middle. */
  scale: number;
  /** Whole octaves from Size, for sounds tuned to the key: +1, 0 or -1. */
  octave: number;
  /** Tail as a length multiplier: 0.3x to 2.5x, 1 in the middle. */
  tail: number;
  /** A multiplier for cutoffs from Tone and velocity: 1 in the middle at velocity 0.8. */
  bright: number;
  /** Loudness relative to velocity 0.8. */
  level: number;
}

function knobs(sc: SoundContext, velocity: number): Knobs {
  const size = unit(sc.size);
  const tail = unit(sc.tail);
  const tone = unit(sc.tone);
  const vel = unit(velocity, 0.8);
  return {
    size,
    tone,
    vel,
    scale: Math.pow(2, (0.5 - size) * 2),
    octave: size < 0.25 ? 1 : size > 0.75 ? -1 : 0,
    tail: tail < 0.5 ? Math.pow(0.3, 1 - tail * 2) : Math.pow(2.5, tail * 2 - 1),
    bright: Math.pow(2, (tone - 0.5) * 3 + (vel - 0.8) * 1.5),
    level: Math.max(0.01, velocityGain(vel) / REF_GAIN),
  };
}

/** A riser's bar count from its nominal length and the Tail knob: whole bars, at least one. */
const barsFor = (k: Knobs, nominal: number) => Math.max(1, Math.round(nominal * k.tail));

/** A cutoff the filter can actually reach at this sample rate. */
const hz = (sc: SoundContext, f: number) => clamp(f, 20, sc.ctx.sampleRate * 0.45);

/** The key's root in the octave from `lo` Hz up (lo <= f < 2 lo), moved by `octave`. */
function keyHz(sc: SoundContext, lo: number, octave = 0): number {
  let f = midiToHz(Number.isFinite(sc.keyRoot) ? sc.keyRoot : 48);
  while (f < lo) f *= 2;
  while (f >= lo * 2) f /= 2;
  return f * Math.pow(2, octave);
}

/**
 * How long a transition lasts so that it lands on the grid: nominally `beats`
 * long, ending on a line of a `grid` of beats (4: a bar line). When the
 * studio knows where the next bar line is (`sc.toNextBar`), the sound covers
 * what is left until the next grid line plus the whole steps that bring it
 * nearest its nominal length: pressed on the one, a 2-bar riser lasts exactly
 * 2 bars; a beat late, 1¾ bars; a beat early (or just before the one), 2¼,
 * so it still lands on the bar it was meant for. Without a bar line, the
 * nominal length at the tempo.
 */
function landing(sc: SoundContext, beats: number, grid = 4): number {
  const beat = beatSeconds(sc);
  const nominal = beats * beat;
  const step = grid * beat;
  const t = sc.toNextBar;
  if (t === undefined || !Number.isFinite(t) || t < 0) return nominal;
  const r = t - Math.floor(t / step) * step;
  const total = r + Math.max(0, Math.round((nominal - r) / step)) * step;
  return total < beat * 0.5 ? total + step : total;
}

// ── Building blocks ─────────────────────────────────────────────────────

function gainOf(ctx: Ctx, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A filter. For lowpass and highpass, Web Audio reads Q as resonance in dB. */
function filterOf(ctx: Ctx, type: BiquadFilterType, freq: number, q = Math.SQRT1_2): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function oscOf(ctx: Ctx, type: OscillatorType, freq: number, detune = 0): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  return o;
}

function pannerOf(ctx: Ctx, pan: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = pan;
  return p;
}

/** Start and stop a set of sources. */
function run(sources: AudioScheduledSourceNode[], time: number, end: number): void {
  for (const s of sources) {
    s.start(time);
    s.stop(end);
  }
}

/** `n` points of `fn` over 0..1, for setValueCurveAtTime. */
function curve(n: number, fn: (x: number) => number): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = fn(i / (n - 1));
    c[i] = Number.isFinite(v) ? v : 0;
  }
  return c;
}

/** A smooth random wander in -1..1 over 0..1: `points` random values joined by cosine curves. */
function wander(points: number): (x: number) => number {
  const v = Array.from({ length: points + 1 }, () => Math.random() * 2 - 1);
  return (x) => {
    const p = clamp(x, 0, 1) * points;
    const i = Math.min(points - 1, Math.floor(p));
    const w = (1 - Math.cos((p - i) * Math.PI)) / 2;
    return v[i] * (1 - w) + v[i + 1] * w;
  };
}

/**
 * Two unrelated noises panned apart, summed: a stereo noise whose width moves
 * from `from` to `to` (0 is centred, 1 hard left and right) over the sound.
 */
function stereoNoise(sc: SoundContext, time: number, end: number, from: number, to: number): GainNode {
  const ctx = sc.ctx;
  const sum = gainOf(ctx, 1);
  for (const side of [-1, 1]) {
    const n = noiseSource(sc, time);
    const p = pannerOf(ctx, side * from);
    p.pan.setValueAtTime(side * from, time);
    p.pan.linearRampToValueAtTime(side * to, end);
    n.connect(p).connect(sum);
    n.stop(end);
  }
  return sum;
}

interface Stage {
  /** Where the sound plays into. */
  input: GainNode;
  /** The last node, into the bus: the pad chokes it. */
  top: GainNode;
}

interface StageOptions {
  /** How hard the limiter bites (the tanh curve's drive). */
  drive?: number;
  /** Sets the sound's loudest peaks at about 0.9 into the limiter, so it rounds them off without running past the end of its curve. */
  trim?: number;
  oversample?: OverSampleType;
  /**
   * A DC blocker after the limiter, for a lopsided wave driven hard (which
   * leaves an offset). Only for sounds with no low end: on a sub it would
   * shift the phase and push peaks over the ceiling.
   */
  dcBlock?: boolean;
}

/**
 * The end of every new sound: a soft limiter (tanh) into a gain at
 * `ceiling`, so a peak can never pass the ceiling.
 */
function stage(sc: SoundContext, ceiling: number, { drive = 1.2, trim = 1, oversample = 'none', dcBlock = false }: StageOptions = {}): Stage {
  const ctx = sc.ctx;
  const input = gainOf(ctx, trim);
  const shaper = ctx.createWaveShaper();
  shaper.curve = softCurve(drive);
  shaper.oversample = oversample;
  const top = gainOf(ctx, ceiling);
  input.connect(shaper);
  if (dcBlock) shaper.connect(filterOf(ctx, 'highpass', 15, -3)).connect(top);
  else shaper.connect(top);
  top.connect(sc.out);
  return { input, top };
}

/** Let the sound go at `end` and hand back a handle a pad can choke. */
function done(sc: SoundContext, top: GainNode, time: number, end: number): SoundHandle {
  releaseAfter(sc, top, end);
  return fadeableHandle(end - time, top, time);
}

/** A last-moment fade so a riser cuts cleanly on the bar line. */
const LAND_FADE = 0.012;

// ── The dub set's original shots ────────────────────────────────────────

/**
 * A limiter that leaves everything below 0.8 untouched (so the old shots
 * sound exactly as they did) and bends louder peaks softly under 0.98.
 * Played with a gain of 0.5 in front: the curve spans ±2.
 */
const KNEE_CURVE = (() => {
  const n = 2049;
  const knee = 0.8;
  const ceil = 0.98;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(v);
    const y = a <= knee ? a : knee + (ceil - knee) * Math.tanh((a - knee) / (ceil - knee));
    c[i] = Math.sign(v) * y;
  }
  return c;
})();

interface Shot {
  ctx: Ctx;
  /** The shot's envelope, as before: the pad chokes it. */
  amp: GainNode;
  /** Into the bus. */
  top: AudioNode;
  level: number;
  /** Size: pitch scale, 2 (small) to 0.5 (big). */
  scale: number;
  /** Tail: 0.5x to 2x. */
  tail: number;
}

/**
 * The old shots' frame: their envelope, then a tilt for Tone (flat in the
 * middle) and the transparent limiter, into the bus. Size and Tail read
 * exactly as the shots.size and shots.tail knobs did.
 */
function shot(sc: SoundContext, velocity: number): Shot {
  const ctx = sc.ctx;
  const amp = ctx.createGain();
  const tilt = filterOf(ctx, 'highshelf', 2500);
  tilt.gain.value = (unit(sc.tone) - 0.5) * 12;
  const pre = gainOf(ctx, 0.5);
  const limit = ctx.createWaveShaper();
  limit.curve = KNEE_CURVE;
  amp.connect(tilt).connect(pre).connect(limit).connect(sc.out);
  return {
    ctx,
    amp,
    top: limit,
    level: 0.2 + unit(velocity, 0.8) * 0.3,
    scale: Math.pow(2, (0.5 - unit(sc.size)) * 2),
    tail: 0.5 + unit(sc.tail) * 1.5,
  };
}

/** The old shots' envelope: up in `attack`, exponentially down over `decay` (stretched by Tail). Returns its end. */
function shotEnv(s: Shot, time: number, peak: number, attack: number, decay: number): number {
  const end = time + attack + decay * s.tail;
  s.amp.gain.setValueAtTime(0.0001, time);
  s.amp.gain.linearRampToValueAtTime(peak, time + attack);
  s.amp.gain.exponentialRampToValueAtTime(0.0001, end);
  return end;
}

/**
 * The old shots' oscillator, built exactly as before: its frequency set only
 * by automation (in Chrome, a preset value changes the first few ms).
 */
function shotOsc(ctx: Ctx, type: OscillatorType): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  return o;
}

/** The old shots' noise: the shared buffer from its start. */
function shotNoise(sc: SoundContext): AudioBufferSourceNode {
  const n = sc.ctx.createBufferSource();
  n.buffer = sc.noise;
  n.loop = true;
  return n;
}

function shotDone(sc: SoundContext, s: Shot, time: number, end: number): SoundHandle {
  releaseAfter(sc, s.top, end);
  return fadeableHandle(end - time, s.amp, time);
}

const SHOT_PAD = 0.01;

const LASER: SoundDef = {
  id: 'laser',
  name: 'Laser',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A fast falling square-wave zap, the classic sound-system laser.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const o = shotOsc(s.ctx, 'square');
    o.frequency.setValueAtTime(2400 * s.scale, time);
    o.frequency.exponentialRampToValueAtTime(120 * s.scale, time + 0.25 * s.tail);
    const f = filterOf(s.ctx, 'bandpass', 1500 * s.scale, 1);
    o.connect(f).connect(s.amp);
    const end = shotEnv(s, time, s.level * 0.6, 0.003, 0.3) + SHOT_PAD;
    run([o], time, end);
    return shotDone(sc, s, time, end);
  },
};

const ZAP: SoundDef = {
  id: 'zap',
  name: 'Zap',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A long saw dive through a closing filter.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const o = shotOsc(s.ctx, 'sawtooth');
    o.frequency.setValueAtTime(900 * s.scale, time);
    o.frequency.exponentialRampToValueAtTime(40 * s.scale, time + 0.6 * s.tail);
    const f = s.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(6000, time);
    f.frequency.exponentialRampToValueAtTime(200, time + 0.6 * s.tail);
    o.connect(f).connect(s.amp);
    const end = shotEnv(s, time, s.level * 0.6, 0.005, 0.7) + SHOT_PAD;
    run([o], time, end);
    return shotDone(sc, s, time, end);
  },
};

const RISER: SoundDef = {
  id: 'riser',
  name: 'Riser',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'Noise and a tone climbing together, cut at the top.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const ctx = s.ctx;
    const top = time + 2 * s.tail;
    const n = shotNoise(sc);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 4;
    f.frequency.setValueAtTime(200, time);
    f.frequency.exponentialRampToValueAtTime(7000 * s.scale, top);
    const o = shotOsc(ctx, 'sine');
    o.frequency.setValueAtTime(100 * s.scale, time);
    o.frequency.exponentialRampToValueAtTime(900 * s.scale, top);
    const og = gainOf(ctx, 0.4);
    n.connect(f).connect(s.amp);
    o.connect(og).connect(s.amp);
    s.amp.gain.setValueAtTime(0.0001, time);
    s.amp.gain.exponentialRampToValueAtTime(s.level, top);
    s.amp.gain.linearRampToValueAtTime(0, top + 0.03);
    const end = top + 0.03 + SHOT_PAD;
    run([n, o], time, end);
    return shotDone(sc, s, time, end);
  },
};

const BOING: SoundDef = {
  id: 'boing',
  name: 'Boing',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A spring shaken once, its wobble dying away.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const ctx = s.ctx;
    const o = oscOf(ctx, 'sine', 140 * s.scale);
    const wobble = oscOf(ctx, 'sine', 22);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(900, time);
    depth.gain.exponentialRampToValueAtTime(10, time + 1.2 * s.tail);
    wobble.connect(depth).connect(o.detune);
    o.connect(s.amp);
    const end = shotEnv(s, time, s.level * 0.9, 0.004, 1.2) + SHOT_PAD;
    run([o, wobble], time, end);
    return shotDone(sc, s, time, end);
  },
};

const CRACKLE: SoundDef = {
  id: 'crackle',
  name: 'Crackle',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'Sparse clicks, like dust on a record.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const ctx = s.ctx;
    const n = shotNoise(sc);
    const gate = gainOf(ctx, 0);
    const length = 1.5 * s.tail;
    for (let t = 0; t < length; t += 0.02 + Math.random() * 0.08) {
      gate.gain.setValueAtTime(Math.random() * 0.9, time + t);
      gate.gain.setValueAtTime(0, time + t + 0.003);
    }
    const f = filterOf(ctx, 'highpass', 1800, 1);
    n.connect(gate).connect(f).connect(s.amp);
    s.amp.gain.value = s.level;
    const end = time + length + SHOT_PAD;
    run([n], time, end);
    return shotDone(sc, s, time, end);
  },
};

const BOOM: SoundDef = {
  id: 'boom',
  name: 'Boom',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A huge low drop with rumble.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const ctx = s.ctx;
    const o = shotOsc(ctx, 'sine');
    o.frequency.setValueAtTime(70 * s.scale, time);
    o.frequency.exponentialRampToValueAtTime(28 * s.scale, time + 1.8 * s.tail);
    const n = shotNoise(sc);
    const f = filterOf(ctx, 'lowpass', 300, 1);
    const ng = gainOf(ctx, 0.5);
    o.connect(s.amp);
    n.connect(f).connect(ng).connect(s.amp);
    const end = shotEnv(s, time, s.level * 1.4, 0.01, 2) + SHOT_PAD;
    run([o, n], time, end);
    return shotDone(sc, s, time, end);
  },
};

const ALARM: SoundDef = {
  id: 'alarm',
  name: 'Alarm',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'Two square tones swapping fast.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const ctx = s.ctx;
    const o = shotOsc(ctx, 'square');
    for (let i = 0, t = 0; t < 1 * s.tail; i++, t += 0.12) o.frequency.setValueAtTime((i % 2 ? 660 : 880) * s.scale, time + t);
    const f = filterOf(ctx, 'lowpass', 3500, 1);
    o.connect(f).connect(s.amp);
    const level = s.level * 0.35;
    // A 2 ms fade in (the old shot switched straight on, with a click).
    s.amp.gain.setValueAtTime(0, time);
    s.amp.gain.linearRampToValueAtTime(level, time + 0.002);
    s.amp.gain.setValueAtTime(level, time + 1 * s.tail);
    s.amp.gain.linearRampToValueAtTime(0, time + 1 * s.tail + 0.05);
    const end = time + 1 * s.tail + 0.05 + SHOT_PAD;
    run([o], time, end);
    return shotDone(sc, s, time, end);
  },
};

const ECHO_CLAP: SoundDef = {
  id: 'echo-clap',
  name: 'Echo clap',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A hard clap made to be thrown into the echo.',
  play(sc, _note, velocity, time) {
    const s = shot(sc, velocity);
    const ctx = s.ctx;
    const n = shotNoise(sc);
    const f = filterOf(ctx, 'bandpass', 1300 * s.scale, 1.2);
    n.connect(f).connect(s.amp);
    const g = s.amp.gain;
    g.setValueAtTime(0.0001, time);
    for (let i = 0; i < 3; i++) {
      g.setValueAtTime(s.level * 1.2, time + i * 0.011);
      g.exponentialRampToValueAtTime(0.05, time + i * 0.011 + 0.01);
    }
    g.setValueAtTime(s.level, time + 0.034);
    g.exponentialRampToValueAtTime(0.0001, time + 0.034 + 0.25 * s.tail);
    const end = time + 0.034 + 0.25 * s.tail + SHOT_PAD;
    run([n], time, end);
    return shotDone(sc, s, time, end);
  },
};

// ── New dub sounds ──────────────────────────────────────────────────────

const AIR_HORN: SoundDef = {
  id: 'air-horn',
  name: 'Air horn',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'The sound-system horn: two sixteenth-note stutters and a held blast, in time and in key.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const beat = beatSeconds(sc);
    const s16 = beat / 4;
    const f0 = keyHz(sc, 330, k.octave);
    const out = stage(sc, 0.5 * k.level, { drive: 2.2, trim: 0.75, dcBlock: true });
    // Two detuned saws and a square an octave down, bent together by one source.
    const oscs = [oscOf(ctx, 'sawtooth', f0, -9), oscOf(ctx, 'sawtooth', f0, 10), oscOf(ctx, 'square', f0 / 2, 4)];
    const bend = ctx.createConstantSource();
    for (const o of oscs) bend.connect(o.detune);
    const saws = gainOf(ctx, 0.3);
    const square = gainOf(ctx, 0.2);
    oscs[0].connect(saws);
    oscs[1].connect(saws);
    oscs[2].connect(square);
    // The horn's throat: thin, nasal, bright with velocity.
    const hp = filterOf(ctx, 'highpass', 260);
    const nasal = filterOf(ctx, 'peaking', 1350, 2.2);
    nasal.gain.value = 10;
    const lp = filterOf(ctx, 'lowpass', hz(sc, 3800 * k.bright), 0.9);
    const gate = gainOf(ctx, 0);
    saws.connect(hp);
    square.connect(hp);
    hp.connect(nasal).connect(lp).connect(gate).connect(out.input);
    // Bap, bap, baaap: two sixteenth stutters, then the held note falling off at the end.
    const g = gate.gain;
    const b = bend.offset;
    g.setValueAtTime(0, time);
    b.setValueAtTime(0, time);
    const stab = Math.max(0.03, s16 * 0.6);
    for (let i = 0; i < 2; i++) {
      const t = time + i * s16;
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(1, t + 0.005);
      g.linearRampToValueAtTime(0.85, t + stab - 0.012);
      g.linearRampToValueAtTime(0, t + stab);
      b.setValueAtTime(-110, t);
      b.linearRampToValueAtTime(0, t + 0.03);
    }
    const held = time + 2 * s16;
    const hold = clamp(beat * 1.5 * k.tail, 0.12, 4);
    const rel = 0.12;
    g.setValueAtTime(0, held);
    g.linearRampToValueAtTime(1, held + 0.006);
    g.linearRampToValueAtTime(0.75, held + hold);
    g.linearRampToValueAtTime(0, held + hold + rel);
    b.setValueAtTime(-110, held);
    b.linearRampToValueAtTime(0, held + 0.04);
    b.setValueAtTime(0, held + hold - 0.08);
    b.linearRampToValueAtTime(-180, held + hold + rel);
    const end = held + hold + rel + 0.005;
    run([...oscs, bend], time, end);
    return done(sc, out.top, time, end);
  },
};

const REWIND: SoundDef = {
  id: 'rewind',
  name: 'Rewind',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A pull-up: the tape spun back by hand, noise and tone swooping up and down.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const dur = 1.5 * clamp(k.tail, 0.45, 2.5);
    const end = time + dur;
    const out = stage(sc, 0.5 * k.level, { drive: 1.6, trim: 0.55 });
    // The tape's speed: swoops up and down that quicken, a wander, a drift faster and a last zip.
    const phase = Math.random() * Math.PI * 2;
    const drift = wander(10);
    const speed = curve(256, (x) => {
      const swoop = Math.sin(phase + 2 * Math.PI * dur * (1.8 * x + 2.4 * x * x));
      return Math.exp(clamp(1.05 * swoop + 0.8 * x + 0.35 * drift(x) + 1.3 * Math.pow(x, 6), -1.8, 2.3));
    });
    const follow = (fn: (s: number) => number) => speed.map(fn);
    // The music being dragged: root and fifth, through a filter that follows the speed.
    const f0 = keyHz(sc, 110, k.octave);
    const saws = [oscOf(ctx, 'sawtooth', f0), oscOf(ctx, 'sawtooth', f0 * 1.5)];
    saws[0].frequency.setValueCurveAtTime(follow((s) => f0 * s), time, dur);
    saws[1].frequency.setValueCurveAtTime(follow((s) => f0 * 1.5 * s), time, dur);
    const toneBus = gainOf(ctx, 0.28);
    const toneLp = filterOf(ctx, 'lowpass', 1400, 1.2);
    toneLp.frequency.setValueCurveAtTime(follow((s) => hz(sc, 1400 * s * k.bright)), time, dur);
    for (const o of saws) o.connect(toneBus);
    toneBus.connect(toneLp);
    // The tape's whoosh: a band of noise riding the same speed.
    const n = noiseSource(sc, time);
    const band = filterOf(ctx, 'bandpass', 1100, 1.4);
    band.frequency.setValueCurveAtTime(follow((s) => hz(sc, 1100 * s * k.scale * Math.sqrt(k.bright))), time, dur);
    const noiseLevel = gainOf(ctx, 1.6);
    n.connect(band).connect(noiseLevel);
    // The chatter of the spooling tape: an amplitude flutter at a rate set by the speed.
    const chatter = gainOf(ctx, 0.62);
    const lfo = oscOf(ctx, 'sine', 8);
    lfo.frequency.setValueCurveAtTime(follow((s) => 8 * s), time, dur);
    const lfoDepth = gainOf(ctx, 0.38);
    lfo.connect(lfoDepth).connect(chatter.gain);
    toneLp.connect(chatter);
    noiseLevel.connect(chatter);
    const env = gainOf(ctx, 0);
    env.gain.setValueCurveAtTime(curve(256, (x) => Math.min(1, x / 0.03) * Math.min(1, (1 - x) / 0.15)), time, dur);
    chatter.connect(env).connect(out.input);
    run([...saws, lfo], time, end);
    n.stop(end);
    return done(sc, out.top, time, end);
  },
};

/** A drawbar organ wave built on the 16' (a sub-octave), so a chord tone has drawbars below it. */
function organWave(ctx: Ctx, sub: number): PeriodicWave {
  // Harmonics of the 16': 16', 8', 5 1/3', 4', 2 2/3', 2'.
  const bars: [number, number][] = [[1, sub], [2, 1], [3, 0.55], [4, 0.6], [6, 0.3], [8, 0.25]];
  const real = new Float32Array(9);
  const imag = new Float32Array(9);
  for (const [h, a] of bars) imag[h] = a;
  return ctx.createPeriodicWave(real, imag);
}

const DUB_STAB: SoundDef = {
  id: 'dub-stab',
  name: 'Dub stab',
  category: 'dub',
  kind: 'shot',
  pitched: true,
  blurb: 'A short organ skank: a minor chord on the note, chopped off like an offbeat stab.',
  play(sc, note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const beat = beatSeconds(sc);
    const out = stage(sc, 0.48 * k.level, { drive: 1.8 });
    const wave = organWave(ctx, 0.15 + 0.6 * k.size);
    const bus = gainOf(ctx, 0.3);
    const oscs = [0, 3, 7].map((st, i) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = midiToHz(note + st) / 2;
      o.detune.value = (i - 1) * 3;
      o.connect(bus);
      return o;
    });
    const hp = filterOf(ctx, 'highpass', 90 + 160 * (1 - k.size));
    const lp = filterOf(ctx, 'lowpass', hz(sc, 2600 * k.bright), 0.8);
    const len = clamp(beat * 0.42 * k.tail, 0.05, 1.6);
    const env = gainOf(ctx, 0);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + 0.004);
    env.gain.linearRampToValueAtTime(0.6, time + 0.004 + Math.min(0.08, len * 0.5));
    env.gain.linearRampToValueAtTime(0.5, time + len);
    env.gain.linearRampToValueAtTime(0, time + len + 0.035);
    bus.connect(hp).connect(lp).connect(env).connect(out.input);
    // Key click.
    const n = noiseSource(sc, time);
    const nb = filterOf(ctx, 'bandpass', hz(sc, 3000 * Math.sqrt(k.bright)), 0.9);
    const click = envelope(ctx, time, 0.35, 0.001, 0.015);
    n.connect(nb).connect(click).connect(out.input);
    n.stop(time + 0.04);
    const end = time + len + 0.035 + 0.005;
    run(oscs, time, end);
    return done(sc, out.top, time, end);
  },
};

const SPRING_CRASH: SoundDef = {
  id: 'spring-crash',
  name: 'Spring crash',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A kicked spring reverb: a crash into metallic, boinging resonances that die away.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const t60 = clamp(2.4 * k.tail, 0.7, 6);
    const end = time + t60;
    const out = stage(sc, 0.5 * k.level, { drive: 1.5 });
    // The kick: a noise burst and a low thud.
    const n = noiseSource(sc, time);
    const nb = filterOf(ctx, 'bandpass', hz(sc, 2200 * k.bright), 0.6);
    const burst = envelope(ctx, time, 1, 0.001, 0.07);
    n.connect(nb).connect(burst);
    n.stop(time + 0.12);
    const thud = oscOf(ctx, 'sine', 150 * k.scale);
    thud.frequency.setValueAtTime(150 * k.scale, time);
    thud.frequency.exponentialRampToValueAtTime(55 * k.scale, time + 0.12);
    const thudEnv = envelope(ctx, time, 0.7, 0.002, 0.2);
    thud.connect(thudEnv);
    const into = filterOf(ctx, 'highpass', 140);
    burst.connect(into);
    thudEnv.connect(into);
    const dry = gainOf(ctx, 0.35);
    burst.connect(dry).connect(out.input);
    thudEnv.connect(dry);
    // The springs: three feedback delays, each through an allpass (the drip)
    // and a damping lowpass, their lengths wobbled by one slowing LFO (the boing).
    const lfo = oscOf(ctx, 'sine', 5.5);
    lfo.frequency.setValueAtTime(5.5, time);
    lfo.frequency.linearRampToValueAtTime(4, end);
    const wobble = ctx.createGain();
    wobble.gain.setValueAtTime(0.0009, time);
    wobble.gain.exponentialRampToValueAtTime(0.00005, end);
    lfo.connect(wobble);
    const tank = gainOf(ctx, 0.32);
    const stretch = 0.75 + 0.5 * k.size;
    [0.0297, 0.0371, 0.0433].forEach((len, i) => {
      const d = len * stretch;
      const delay = ctx.createDelay(0.1);
      delay.delayTime.value = d;
      const drip = filterOf(ctx, 'allpass', 700 + i * 650, 0.6);
      // No resonant bump in the loop (Q in dB): its gain stays under 1 at every frequency.
      const damp = filterOf(ctx, 'lowpass', hz(sc, 3800 * k.bright), -6);
      const fb = ctx.createGain();
      const g = Math.min(0.94, Math.pow(10, (-3 * d) / t60));
      fb.gain.setValueAtTime(g, time);
      fb.gain.setValueAtTime(g, end - 0.25);
      fb.gain.linearRampToValueAtTime(0, end);
      into.connect(delay);
      delay.connect(drip).connect(damp).connect(fb).connect(delay);
      damp.connect(tank);
      wobble.connect(delay.delayTime);
    });
    const tankHp = filterOf(ctx, 'highpass', 110);
    const tail = ctx.createGain();
    tail.gain.setValueAtTime(1, time);
    tail.gain.setValueAtTime(1, end - 0.25);
    tail.gain.linearRampToValueAtTime(0, end);
    tank.connect(tankHp).connect(tail).connect(out.input);
    run([thud], time, time + 0.3);
    run([lfo], time, end);
    return done(sc, out.top, time, end);
  },
};

const SIREN_RISE: SoundDef = {
  id: 'siren-rise',
  name: 'Siren rise',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'A dub siren that climbs two octaves and wobbles faster, landing on the bar.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const beat = beatSeconds(sc);
    const len = landing(sc, 4 * barsFor(k, 2));
    const end = time + len;
    const out = stage(sc, 0.45 * k.level, { drive: 1.3, trim: 0.92 });
    const f0 = keyHz(sc, 220, k.octave);
    const pitch = curve(96, (x) => f0 * Math.pow(4, Math.pow(x, 1.35)));
    const sine = oscOf(ctx, 'sine', f0);
    const square = oscOf(ctx, 'square', f0);
    sine.frequency.setValueCurveAtTime(pitch, time, len);
    square.frequency.setValueCurveAtTime(pitch, time, len);
    // The wobble: eighths to sixteenths at the tempo, deepening.
    const lfo = oscOf(ctx, 'triangle', 1.5 / beat);
    lfo.frequency.setValueAtTime(1.5 / beat, time);
    lfo.frequency.exponentialRampToValueAtTime(4 / beat, end);
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(250, time);
    depth.gain.linearRampToValueAtTime(450, end);
    lfo.connect(depth);
    depth.connect(sine.detune);
    depth.connect(square.detune);
    const gs = gainOf(ctx, 0.78 - 0.3 * k.tone);
    const gq = gainOf(ctx, 0.08 + 0.3 * k.tone);
    const lp = filterOf(ctx, 'lowpass', hz(sc, 4500 * k.bright));
    const env = gainOf(ctx, 0);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(0.55, time + 0.04);
    env.gain.linearRampToValueAtTime(1, end - LAND_FADE);
    env.gain.linearRampToValueAtTime(0, end);
    sine.connect(gs).connect(lp);
    square.connect(gq).connect(lp);
    lp.connect(env).connect(out.input);
    run([sine, square, lfo], time, end);
    return done(sc, out.top, time, end);
  },
};

/** A free reed: a narrow pulse (no DC), so odd and even harmonics both sound. */
function reedWave(ctx: Ctx): PeriodicWave {
  const n = 28;
  const duty = 0.38;
  const real = new Float32Array(n);
  const imag = new Float32Array(n);
  for (let h = 1; h < n; h++) real[h] = (Math.sin(Math.PI * h * duty) / h) * (h % 2 ? 1 : 0.8);
  return ctx.createPeriodicWave(real, imag);
}

const MELODICA: SoundDef = {
  id: 'melodica',
  name: 'Melodica',
  category: 'dub',
  kind: 'shot',
  pitched: true,
  blurb: 'A breathy, reedy melodica note with a little scoop and vibrato.',
  play(sc, note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const beat = beatSeconds(sc);
    const f = midiToHz(note);
    const len = clamp(beat * k.tail, 0.1, 3);
    const rel = 0.08;
    const end = time + len + rel + 0.005;
    const out = stage(sc, 0.42 * k.level, { drive: 1, trim: 0.5 });
    const wave = reedWave(ctx);
    const a = ctx.createOscillator();
    a.setPeriodicWave(wave);
    a.frequency.value = f;
    const b = ctx.createOscillator();
    b.setPeriodicWave(wave);
    b.frequency.value = f;
    // The reed speaks a little flat and scoops up; the second reed sits a few cents sharp.
    a.detune.setValueAtTime(-45, time);
    a.detune.linearRampToValueAtTime(0, time + 0.06);
    b.detune.setValueAtTime(-38, time);
    b.detune.linearRampToValueAtTime(7, time + 0.06);
    const vib = oscOf(ctx, 'sine', 5.3);
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, time);
    vibDepth.gain.linearRampToValueAtTime(0, time + 0.15);
    vibDepth.gain.linearRampToValueAtTime(12, time + 0.45);
    vib.connect(vibDepth);
    vibDepth.connect(a.detune);
    vibDepth.connect(b.detune);
    const ga = gainOf(ctx, 0.55);
    const gb = gainOf(ctx, 0.3);
    const hp = filterOf(ctx, 'highpass', 180);
    const reed = filterOf(ctx, 'peaking', 1500, 1.2);
    reed.gain.value = 5;
    const lp = filterOf(ctx, 'lowpass', hz(sc, 3200 * k.bright));
    const env = gainOf(ctx, 0);
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + 0.035);
    env.gain.linearRampToValueAtTime(0.82, time + Math.max(0.05, Math.min(0.2, len * 0.7)));
    env.gain.linearRampToValueAtTime(0.78, time + len);
    env.gain.linearRampToValueAtTime(0, time + len + rel);
    a.connect(ga).connect(hp);
    b.connect(gb).connect(hp);
    hp.connect(reed).connect(lp).connect(env).connect(out.input);
    // Breath: a puff on the attack, a little air under the note.
    const n = noiseSource(sc, time);
    const air = filterOf(ctx, 'bandpass', hz(sc, 1700 * Math.sqrt(k.bright)), 0.8);
    const breath = ctx.createGain();
    breath.gain.setValueAtTime(0, time);
    breath.gain.linearRampToValueAtTime(0.3, time + 0.02);
    breath.gain.linearRampToValueAtTime(0.08, time + Math.min(0.15, len * 0.8));
    breath.gain.linearRampToValueAtTime(0.06, time + len);
    breath.gain.linearRampToValueAtTime(0, time + len + rel);
    n.connect(air).connect(breath).connect(out.input);
    n.stop(end);
    run([a, b, vib], time, end);
    return done(sc, out.top, time, end);
  },
};

const VINYL_STOP: SoundDef = {
  id: 'vinyl-stop',
  name: 'Vinyl stop',
  category: 'dub',
  kind: 'shot',
  pitched: false,
  blurb: 'The record slowing to a halt, tone and crackle winding down to the bar line.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const len = landing(sc, 4 * barsFor(k, 1));
    const end = time + len;
    const out = stage(sc, 0.48 * k.level, { drive: 1.4, trim: 0.85 });
    // The platter slows evenly: speed 1 - x, so the record has played t - t²/2L by time t.
    const speed = (x: number) => Math.max(0, 1 - x);
    const f0 = keyHz(sc, 110, k.octave);
    const toneBus = ctx.createGain();
    const saws = [f0, f0 * 1.5, f0 * 2].map((f, i) => {
      const o = oscOf(ctx, 'sawtooth', f, (i - 1) * 4);
      o.frequency.setValueCurveAtTime(curve(256, (x) => Math.max(0.5, f * speed(x))), time, len);
      o.connect(toneBus);
      return o;
    });
    // Quieter as it slows, and gone before it sinks below hearing (where a slow saw only clicks).
    const fadeOut = (x: number) => clamp((speed(x) - 0.05) / 0.15, 0, 1);
    toneBus.gain.setValueCurveAtTime(curve(256, (x) => (x === 0 ? 0 : 0.22 * Math.pow(speed(x), 0.8) * fadeOut(x))), time, len);
    const toneLp = filterOf(ctx, 'lowpass', 3000, 0.9);
    toneLp.frequency.setValueCurveAtTime(curve(128, (x) => hz(sc, 70 + 3200 * k.bright * Math.pow(speed(x), 1.2))), time, len);
    toneBus.connect(toneLp);
    // Crackle at random places on the record, reaching the ear slower and duller as it stops.
    const n = noiseSource(sc, time);
    const gate = gainOf(ctx, 0);
    const crackleHp = filterOf(ctx, 'highpass', 1800);
    crackleHp.frequency.setValueCurveAtTime(curve(64, (x) => 150 + 1800 * speed(x)), time, len);
    const crackle = gainOf(ctx, 0.7);
    n.connect(gate).connect(crackleHp).connect(crackle);
    n.stop(end);
    let next = 0;
    for (let p = Math.random() * 0.03; p < len / 2; p += 0.012 + Math.random() * 0.05) {
      const t = len - Math.sqrt(Math.max(0, len * len - 2 * len * p));
      const s = speed(t / len);
      if (s < 0.06 || t < next) continue;
      const width = Math.min(0.02, 0.002 / s);
      gate.gain.setValueAtTime(Math.random() * 0.9 * Math.sqrt(s), time + t);
      gate.gain.setValueAtTime(0, time + t + width);
      next = t + width + 0.001;
    }
    const sum = filterOf(ctx, 'highpass', 25);
    toneLp.connect(sum);
    crackle.connect(sum);
    sum.connect(out.input);
    run(saws, time, end);
    return done(sc, out.top, time, end);
  },
};

// ── Risers and drops ────────────────────────────────────────────────────

const NOISE_RISER: SoundDef = {
  id: 'noise-riser',
  name: 'Noise riser',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'White noise sweeping up and widening over two bars, landing on the one.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const len = landing(sc, 4 * barsFor(k, 2));
    const end = time + len;
    const out = stage(sc, 0.5 * k.level, { drive: 1.3, trim: 0.32 });
    const noise = stereoNoise(sc, time, end, 0, 0.5 + 0.45 * k.size);
    const hp = filterOf(ctx, 'highpass', 40);
    hp.frequency.setValueCurveAtTime(curve(64, (x) => 40 * Math.pow(18, x * x)), time, len);
    const f0 = 600 * k.scale;
    const f1 = hz(sc, 11000 * k.bright);
    const lp = filterOf(ctx, 'lowpass', f0, 2);
    lp.frequency.setValueCurveAtTime(curve(96, (x) => f0 * Math.pow(f1 / f0, Math.pow(x, 1.3))), time, len);
    lp.Q.setValueAtTime(2, time);
    lp.Q.linearRampToValueAtTime(10, end);
    const env = gainOf(ctx, 0);
    // 12 dB of level on top of the opening filter's own build.
    env.gain.setValueCurveAtTime(curve(96, (x) => (x === 0 ? 0 : Math.pow(10, (-12 + 12 * Math.pow(x, 1.4)) / 20))), time, len - LAND_FADE);
    env.gain.linearRampToValueAtTime(0, end);
    noise.connect(hp).connect(lp).connect(env).connect(out.input);
    return done(sc, out.top, time, end);
  },
};

const LONG_RISER: SoundDef = {
  id: 'long-riser',
  name: 'Long riser',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'An eight-bar build: noise and a chord on the key opening slowly, pulsing faster into the drop.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const beat = beatSeconds(sc);
    const len = landing(sc, 4 * barsFor(k, 8));
    const end = time + len;
    const out = stage(sc, 0.5 * k.level, { drive: 1.3, trim: 0.45 });
    const mix = ctx.createGain();
    // Noise, widening and opening.
    const noise = stereoNoise(sc, time, end, 0.1, 0.4 + 0.5 * k.size);
    const hp = filterOf(ctx, 'highpass', 30);
    hp.frequency.setValueCurveAtTime(curve(64, (x) => 30 * Math.pow(20, x * x * x)), time, len);
    const nf0 = 350 * k.scale;
    const nf1 = hz(sc, 9000 * k.bright);
    const lp = filterOf(ctx, 'lowpass', nf0, 1);
    lp.frequency.setValueCurveAtTime(curve(128, (x) => nf0 * Math.pow(nf1 / nf0, Math.pow(x, 1.8))), time, len);
    lp.Q.setValueAtTime(1, time);
    lp.Q.linearRampToValueAtTime(8, end);
    const noiseLevel = gainOf(ctx, 0.9);
    noise.connect(hp).connect(lp).connect(noiseLevel).connect(mix);
    // A chord on the key (root, root, fifth) fading in, opening, gliding up an octave over the second half.
    const f0 = keyHz(sc, 110, k.octave);
    const glide = ctx.createConstantSource();
    glide.offset.setValueCurveAtTime(curve(128, (x) => (x < 0.5 ? 0 : 1200 * Math.pow((x - 0.5) * 2, 2))), time, len);
    const toneLp = filterOf(ctx, 'lowpass', 150, 1.2);
    toneLp.frequency.setValueCurveAtTime(curve(96, (x) => 150 * Math.pow(hz(sc, 2600 * k.bright) / 150, Math.pow(x, 1.5))), time, len);
    const saws = [oscOf(ctx, 'sawtooth', f0, -8), oscOf(ctx, 'sawtooth', f0, 8), oscOf(ctx, 'sawtooth', f0 * 1.5)];
    for (const o of saws) {
      glide.connect(o.detune);
      o.connect(toneLp);
    }
    const toneLevel = ctx.createGain();
    toneLevel.gain.setValueCurveAtTime(curve(96, (x) => 0.06 + 0.14 * Math.pow(x, 1.5)), time, len);
    toneLp.connect(toneLevel).connect(mix);
    // A pumping gate on the grid, counted back from the landing: quarters
    // two bars out from the bar before last, eighths in the bar before the
    // last, sixteenths in the last, each deeper.
    const gate = gainOf(ctx, 1);
    const hits: number[] = [];
    for (let back = beat / 4; back <= Math.min(len, 16 * beat) + 1e-6; back += back < 4 * beat - 1e-6 ? beat / 4 : back < 8 * beat - 1e-6 ? beat / 2 : beat) {
      hits.unshift(end - back);
    }
    if (hits.length) {
      const g = gate.gain;
      g.setValueAtTime(1, Math.max(time, hits[0]));
      hits.forEach((t, i) => {
        const next = i + 1 < hits.length ? hits[i + 1] : end;
        const depth = 0.25 + 0.4 * ((t - time) / len);
        g.linearRampToValueAtTime(1 - depth, next - 0.005);
        g.linearRampToValueAtTime(1, next);
      });
    }
    const env = gainOf(ctx, 0);
    // Subtle for the first bars, 14 dB of level by the drop on top of the filters opening.
    env.gain.setValueCurveAtTime(curve(128, (x) => (x === 0 ? 0 : Math.pow(10, (-14 + 14 * Math.pow(x, 1.6)) / 20))), time, len - LAND_FADE);
    env.gain.linearRampToValueAtTime(0, end);
    mix.connect(gate).connect(env).connect(out.input);
    run([...saws, glide], time, end);
    return done(sc, out.top, time, end);
  },
};

const PITCH_RISER: SoundDef = {
  id: 'pitch-riser',
  name: 'Pitch riser',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'A stack of detuned saws on the key gliding up two octaves over two bars.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const len = landing(sc, 4 * barsFor(k, 2));
    const end = time + len;
    const out = stage(sc, 0.48 * k.level, { drive: 1.5 });
    const f0 = keyHz(sc, 110, k.octave);
    // One glide for the whole stack, so it lands exactly two octaves up on the bar line.
    const glide = ctx.createConstantSource();
    glide.offset.setValueCurveAtTime(curve(128, (x) => 2400 * Math.pow(x, 1.7)), time, len);
    const width = 0.4 + 0.5 * k.size;
    const left = gainOf(ctx, 0.2);
    const right = gainOf(ctx, 0.2);
    const centre = gainOf(ctx, 0.22);
    const pl = pannerOf(ctx, -0.2);
    const pr = pannerOf(ctx, 0.2);
    pl.pan.setValueAtTime(-0.2, time);
    pl.pan.linearRampToValueAtTime(-width, end);
    pr.pan.setValueAtTime(0.2, time);
    pr.pan.linearRampToValueAtTime(width, end);
    const sum = ctx.createGain();
    left.connect(pl).connect(sum);
    right.connect(pr).connect(sum);
    centre.connect(sum);
    const oscs = ([[-22, left], [-9, right], [0, centre], [9, left], [22, right]] as const).map(([cents, bus]) => {
      const o = oscOf(ctx, 'sawtooth', f0, cents);
      glide.connect(o.detune);
      o.connect(bus);
      return o;
    });
    const hp = filterOf(ctx, 'highpass', 50);
    hp.frequency.setValueCurveAtTime(curve(64, (x) => 50 * Math.pow(6, x)), time, len);
    const c0 = 400;
    const c1 = hz(sc, 9000 * k.bright);
    const lp = filterOf(ctx, 'lowpass', c0, 1.4);
    lp.frequency.setValueCurveAtTime(curve(96, (x) => c0 * Math.pow(c1 / c0, Math.pow(x, 1.4))), time, len);
    const env = gainOf(ctx, 0);
    env.gain.setValueCurveAtTime(curve(96, (x) => (x === 0 ? 0 : 0.08 + 0.92 * Math.pow(x, 1.6))), time, len - LAND_FADE);
    env.gain.linearRampToValueAtTime(0, end);
    sum.connect(hp).connect(lp).connect(env).connect(out.input);
    run([...oscs, glide], time, end);
    return done(sc, out.top, time, end);
  },
};

const DOWNLIFTER: SoundDef = {
  id: 'downlifter',
  name: 'Downlifter',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'Noise and a tone sweeping down and narrowing over the bar after the drop.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const len = landing(sc, 4 * barsFor(k, 1));
    const end = time + len;
    const out = stage(sc, 0.5 * k.level, { drive: 1.3, trim: 0.44 });
    const mix = ctx.createGain();
    const noise = stereoNoise(sc, time, end, 0.5 + 0.4 * k.size, 0.1);
    const c0 = hz(sc, 12000 * k.bright);
    const c1 = 150;
    const lp = filterOf(ctx, 'lowpass', c0, 6);
    lp.frequency.setValueCurveAtTime(curve(96, (x) => c0 * Math.pow(c1 / c0, Math.pow(x, 0.6))), time, len);
    const hp = filterOf(ctx, 'highpass', 35);
    noise.connect(lp).connect(hp).connect(mix);
    const f0 = keyHz(sc, 440, k.octave);
    const sine = oscOf(ctx, 'sine', f0);
    sine.frequency.setValueCurveAtTime(curve(96, (x) => f0 * Math.pow(1 / 8, Math.pow(x, 0.7))), time, len);
    const sineLevel = gainOf(ctx, 0.35);
    sine.connect(sineLevel).connect(mix);
    const env = gainOf(ctx, 0);
    env.gain.setValueCurveAtTime(curve(128, (x) => (x === 0 ? 0 : Math.pow(1 - x, 1.6))), time, len);
    mix.connect(env).connect(out.input);
    run([sine], time, end);
    return done(sc, out.top, time, end);
  },
};

const REVERSE_SWELL: SoundDef = {
  id: 'reverse-swell',
  name: 'Reverse swell',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'A cymbal played backwards, swelling into the next downbeat.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const len = landing(sc, 4 * barsFor(k, 1));
    const end = time + len;
    const out = stage(sc, 0.5 * k.level, { drive: 1.4, trim: 0.75 });
    const mix = ctx.createGain();
    // The cymbal's metal: six square waves at clashing ratios, only their top end kept.
    const metal = gainOf(ctx, 0.1);
    const squares = [205.3, 304.4, 369.6, 522.7, 540, 800].map((f) => {
      const o = oscOf(ctx, 'square', f * k.scale);
      o.connect(metal);
      return o;
    });
    const ring = filterOf(ctx, 'bandpass', hz(sc, 7000), 0.8);
    const metalHp = filterOf(ctx, 'highpass', 4000);
    metal.connect(ring).connect(metalHp).connect(mix);
    // Its wash: a widening noise.
    const noise = stereoNoise(sc, time, end, 0.3, 0.6 + 0.35 * k.size);
    const washHp = filterOf(ctx, 'highpass', 5000 * Math.sqrt(k.scale));
    const wash = gainOf(ctx, 0.7);
    noise.connect(washHp).connect(wash).connect(mix);
    // Played backwards: brightening, and the decay's exponential run in reverse, cut on the line.
    const c0 = 2500;
    const c1 = hz(sc, 16000 * k.bright);
    const lp = filterOf(ctx, 'lowpass', c0);
    lp.frequency.setValueCurveAtTime(curve(64, (x) => c0 * Math.pow(c1 / c0, x)), time, len);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.015, time);
    env.gain.exponentialRampToValueAtTime(1, end - LAND_FADE);
    env.gain.linearRampToValueAtTime(0, end);
    mix.connect(lp).connect(env).connect(out.input);
    run(squares, time, end);
    return done(sc, out.top, time, end);
  },
};

const SNARE_BUILD: SoundDef = {
  id: 'snare-build',
  name: 'Snare build',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'A snare roll on the grid quickening from eighths to sixteenths to thirty-seconds over two bars.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const beat = beatSeconds(sc);
    const len = landing(sc, 4 * barsFor(k, 2));
    const end = time + len;
    const out = stage(sc, 0.5 * k.level, { drive: 1.4, trim: 0.53 });
    // The grid, counted back from the landing: thirty-seconds in the last
    // two beats, sixteenths in the two before, eighths before that.
    const hits: number[] = [];
    for (let back = beat / 8; back <= len + 1e-6; back += back < 2 * beat - 1e-6 ? beat / 8 : back < 4 * beat - 1e-6 ? beat / 4 : beat / 2) {
      hits.unshift(Math.max(time, end - back));
    }
    // One snare, struck again and again: noise and a body tone, each with its envelope re-fired per hit.
    const n = noiseSource(sc, time);
    const hp = filterOf(ctx, 'highpass', 400);
    const lp = filterOf(ctx, 'lowpass', hz(sc, 3000 * k.bright), 0.8);
    lp.frequency.setValueAtTime(hz(sc, 3000 * k.bright), time);
    lp.frequency.exponentialRampToValueAtTime(hz(sc, 7500 * k.bright), end);
    const snares = gainOf(ctx, 0);
    n.connect(hp).connect(lp).connect(snares).connect(out.input);
    n.stop(end);
    const fb = 190 * k.scale;
    const body = oscOf(ctx, 'triangle', fb);
    body.frequency.setValueAtTime(fb, time);
    body.frequency.exponentialRampToValueAtTime(fb * 2, end);
    const bodyEnv = gainOf(ctx, 0);
    body.connect(bodyEnv).connect(out.input);
    const decay = clamp(0.11 * k.tail, 0.02, 0.3);
    const ng = snares.gain;
    const bg = bodyEnv.gain;
    hits.forEach((h, i) => {
      const gap = (i + 1 < hits.length ? hits[i + 1] : end) - h;
      const x = (h - time) / len;
      const a = Math.pow(10, (x - 1) * 0.9);
      const dn = Math.max(0.006, Math.min(decay, gap - 0.004));
      const db = dn * 0.55;
      ng.setValueAtTime(0, h);
      ng.linearRampToValueAtTime(a, h + 0.0008);
      ng.exponentialRampToValueAtTime(a * 0.01, h + dn - 0.0015);
      ng.linearRampToValueAtTime(0, h + dn);
      bg.setValueAtTime(0, h);
      bg.linearRampToValueAtTime(a * 0.8, h + 0.0008);
      bg.exponentialRampToValueAtTime(a * 0.008, h + db - 0.001);
      bg.linearRampToValueAtTime(0, h + db);
      body.detune.setValueAtTime(400, h);
      body.detune.linearRampToValueAtTime(0, h + Math.min(0.02, db));
    });
    run([body], time, end);
    return done(sc, out.top, time, end);
  },
};

const SWEEP_DOWN: SoundDef = {
  id: 'sweep-down',
  name: 'Sweep down',
  category: 'rise',
  kind: 'shot',
  pitched: false,
  blurb: 'A resonant filter falling through noise and a chord on the key over two beats.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const len = landing(sc, Math.max(1, Math.round(2 * k.tail)), 1);
    const end = time + len;
    const out = stage(sc, 0.5 * k.level, { drive: 1.4, trim: 0.45 });
    const mix = ctx.createGain();
    const noise = stereoNoise(sc, time, end, 0.5, 0.5);
    const noiseLevel = gainOf(ctx, 0.7);
    noise.connect(noiseLevel).connect(mix);
    const f0 = keyHz(sc, 110, k.octave);
    const saws = [oscOf(ctx, 'sawtooth', f0), oscOf(ctx, 'sawtooth', f0 * 1.5, 3)];
    const toneLevel = gainOf(ctx, 0.12);
    for (const o of saws) o.connect(toneLevel);
    toneLevel.connect(mix);
    const c0 = hz(sc, 9000 * k.bright);
    const lp = filterOf(ctx, 'lowpass', c0, 12);
    lp.frequency.setValueAtTime(c0, time);
    lp.frequency.exponentialRampToValueAtTime(140, end);
    const hp = filterOf(ctx, 'highpass', 40);
    const env = gainOf(ctx, 0);
    env.gain.setValueCurveAtTime(curve(96, (x) => (x === 0 ? 0 : Math.pow(1 - x, 0.8))), time, len);
    mix.connect(lp).connect(hp).connect(env).connect(out.input);
    run(saws, time, end);
    return done(sc, out.top, time, end);
  },
};

// ── Impacts ─────────────────────────────────────────────────────────────

const IMPACT: SoundDef = {
  id: 'impact',
  name: 'Impact',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A huge hit: a sub thump on the key, a noise blast and a metal clang, held in check.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const dur = clamp(2.2 * k.tail, 0.8, 5.5);
    const end = time + dur;
    const out = stage(sc, 0.66 * k.level, { drive: 1.8, trim: 0.45 });
    // Sub thump: a fast pitch drop onto the key's root, low down.
    const fs = keyHz(sc, 40, Math.max(0, k.octave));
    const sub = oscOf(ctx, 'sine', fs * 4);
    sub.frequency.setValueAtTime(fs * 4, time);
    sub.frequency.exponentialRampToValueAtTime(fs, time + 0.08);
    sub.frequency.exponentialRampToValueAtTime(fs * 0.96, end);
    const subEnv = ctx.createGain();
    subEnv.gain.setValueAtTime(0, time);
    subEnv.gain.linearRampToValueAtTime(0.9, time + 0.003);
    subEnv.gain.exponentialRampToValueAtTime(0.4, time + 0.3);
    subEnv.gain.exponentialRampToValueAtTime(0.0004, end);
    sub.connect(subEnv).connect(out.input);
    // Noise, left and right: a bright blast and a long low rumble.
    const split = ctx.createChannelMerger(2);
    const nl = noiseSource(sc, time);
    const nr = noiseSource(sc, time);
    nl.connect(split, 0, 0);
    nr.connect(split, 0, 1);
    nl.stop(end);
    nr.stop(end);
    const blastLp = filterOf(ctx, 'lowpass', hz(sc, 7000 * k.bright), 0.7);
    const blast = envelope(ctx, time, 0.8, 0.001, clamp(0.35 * Math.sqrt(k.tail), 0.12, 0.6));
    split.connect(blastLp).connect(blast).connect(out.input);
    const rumbleLp = filterOf(ctx, 'lowpass', 260 / Math.sqrt(k.scale), 0.7);
    const rumbleHp = filterOf(ctx, 'highpass', 30);
    const rumble = ctx.createGain();
    rumble.gain.setValueAtTime(0, time);
    rumble.gain.linearRampToValueAtTime(2.2, time + 0.01);
    rumble.gain.exponentialRampToValueAtTime(0.0005, end);
    split.connect(rumbleLp).connect(rumbleHp).connect(rumble).connect(out.input);
    // Metal: three clashing squares through a ringing band.
    const metal = filterOf(ctx, 'bandpass', hz(sc, 2600 * Math.sqrt(k.bright)), 1.4);
    const squares = [540, 800, 1173].map((f) => {
      const o = oscOf(ctx, 'square', f * k.scale);
      o.connect(metal);
      return o;
    });
    const clang = envelope(ctx, time, 0.3, 0.001, clamp(0.7 * k.tail, 0.2, 1.8));
    metal.connect(clang).connect(out.input);
    run([sub, ...squares], time, end);
    return done(sc, out.top, time, end);
  },
};

const SUB_DROP: SoundDef = {
  id: 'sub-drop',
  name: 'Sub drop',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A sine falling from the key root near 110 Hz to the floor at about 30 Hz.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const dur = clamp(1.5 * k.tail, 0.5, 3.75);
    const end = time + dur;
    // Tone adds harmonics (a softer or harder saturation) so it reads on small speakers.
    const out = stage(sc, 0.55 * k.level, { drive: 0.8 + 2.4 * k.tone * Math.min(1.5, k.bright) });
    const f0 = keyHz(sc, 110 / Math.SQRT2, Math.max(0, k.octave));
    const f1 = f0 / 4 >= 27 ? f0 / 4 : f0 / 3;
    const o = oscOf(ctx, 'sine', f0);
    // Eased in and out: it sounds the root before it falls, and settles on the floor by 85%.
    const fall = (x: number) => Math.pow(Math.cos(Math.min(1, x / 0.85) * (Math.PI / 2)), 2);
    o.frequency.setValueCurveAtTime(curve(128, (x) => f1 * Math.pow(f0 / f1, fall(x))), time, dur);
    const env = ctx.createGain();
    env.gain.setValueCurveAtTime(curve(128, (x) => (x === 0 ? 0 : x < 0.5 ? 1 : Math.pow(Math.cos(((x - 0.5) / 0.5) * (Math.PI / 2)), 1.5))), time, dur);
    o.connect(env).connect(out.input);
    run([o], time, end);
    return done(sc, out.top, time, end);
  },
};

const THUNDER: SoundDef = {
  id: 'thunder',
  name: 'Thunder',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A crack of lightning, then a low rumble rolling around for seconds.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const dur = 5 * clamp(k.tail, 0.6, 2.4);
    const end = time + dur;
    const out = stage(sc, 0.6 * k.level, { drive: 1.5, trim: 0.64 });
    // The crack and its crackling aftershocks.
    const n = noiseSource(sc, time);
    const crackHp = filterOf(ctx, 'highpass', hz(sc, 1200 * Math.sqrt(k.bright)));
    const crack = ctx.createGain();
    const c = crack.gain;
    c.setValueAtTime(0, time);
    c.linearRampToValueAtTime(1, time + 0.0015);
    c.exponentialRampToValueAtTime(0.02, time + 0.1);
    let t = time + 0.1;
    for (let i = 0; i < 9; i++) {
      t += 0.003 + Math.random() * 0.05;
      const a = (0.6 - i * 0.05) * (0.4 + Math.random() * 0.6);
      c.setValueAtTime(0.02, t);
      c.linearRampToValueAtTime(a, t + 0.001);
      c.exponentialRampToValueAtTime(0.01, t + 0.013);
      t += 0.013;
    }
    c.linearRampToValueAtTime(0, t + 0.05);
    n.connect(crackHp).connect(crack).connect(out.input);
    n.stop(t + 0.06);
    // The rumble: two noises, left and right, each rolling in its own way under a moving lowpass.
    const rumble = ctx.createChannelMerger(2);
    for (let ch = 0; ch < 2; ch++) {
      const roll = wander(9);
      const r = noiseSource(sc, time);
      const g = ctx.createGain();
      g.gain.setValueCurveAtTime(curve(256, (x) => {
        const shape = Math.min(1, x / 0.06) * Math.exp(-3.2 * Math.max(0, x - 0.06)) * Math.min(1, (1 - x) / 0.1);
        return 6 * shape * (0.6 + 0.4 * roll(x));
      }), time, dur);
      r.connect(g).connect(rumble, 0, ch);
      r.stop(end);
    }
    const sweep = wander(7);
    const lp1 = filterOf(ctx, 'lowpass', 180, 0.7);
    lp1.frequency.setValueCurveAtTime(curve(128, (x) => (110 + 160 * (0.5 + 0.5 * sweep(x))) * Math.sqrt(k.bright) / Math.sqrt(k.scale)), time, dur);
    const lp2 = filterOf(ctx, 'lowpass', 400, 0.7);
    const hp = filterOf(ctx, 'highpass', 28);
    rumble.connect(lp1).connect(lp2).connect(hp).connect(out.input);
    return done(sc, out.top, time, end);
  },
};

const GONG_CRASH: SoundDef = {
  id: 'gong-crash',
  name: 'Gong crash',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A big gong on the key with a crash of noise, blooming and sinking for seconds.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const dur = clamp(7 * k.tail, 2.5, 17.5);
    const end = time + dur;
    const out = stage(sc, 0.55 * k.level, { drive: 1.4, trim: 0.52 });
    const f0 = keyHz(sc, 65, k.octave);
    // The pitch sags a little as it rings.
    const sag = ctx.createConstantSource();
    sag.offset.setValueAtTime(8, time);
    sag.offset.linearRampToValueAtTime(-22, end);
    // Partials in three groups: low ones ring longest, the middle blooms after the strike, the top dies first.
    const low = ctx.createGain();
    low.gain.setValueAtTime(0, time);
    low.gain.linearRampToValueAtTime(0.32, time + 0.006);
    low.gain.exponentialRampToValueAtTime(0.18, time + 0.4);
    low.gain.exponentialRampToValueAtTime(0.0003, end);
    const mid = ctx.createGain();
    mid.gain.setValueAtTime(0, time);
    mid.gain.linearRampToValueAtTime(0.1, time + 0.006);
    mid.gain.linearRampToValueAtTime(0.22, time + 0.5);
    mid.gain.exponentialRampToValueAtTime(0.0003, time + dur * 0.75);
    const high = ctx.createGain();
    high.gain.setValueAtTime(0, time);
    high.gain.linearRampToValueAtTime(0.16, time + 0.004);
    high.gain.exponentialRampToValueAtTime(0.0003, time + dur * 0.4);
    const pm = pannerOf(ctx, -0.35);
    const ph = pannerOf(ctx, 0.35);
    mid.connect(pm);
    high.connect(ph);
    const groups = [low, low, low, mid, mid, mid, high, high];
    const oscs = [1, 1.52, 2.03, 2.47, 2.94, 3.61, 4.24, 5.3].map((r, i) => {
      const o = oscOf(ctx, 'sine', f0 * r, (Math.random() - 0.5) * 10);
      sag.connect(o.detune);
      o.connect(groups[i]);
      return o;
    });
    // The crash: a bright splash, and a darker wash that swells after it.
    const n = noiseSource(sc, time);
    const splashHp = filterOf(ctx, 'highpass', 3000);
    const splash = envelope(ctx, time, 0.45, 0.002, clamp(2.2 * Math.pow(k.tail, 0.7), 0.6, dur * 0.8));
    n.connect(splashHp).connect(splash);
    const washBp = filterOf(ctx, 'bandpass', 1300, 1.5);
    washBp.frequency.setValueAtTime(1300 * k.scale, time);
    washBp.frequency.exponentialRampToValueAtTime(500 * k.scale, end);
    const wash = ctx.createGain();
    wash.gain.setValueAtTime(0, time);
    wash.gain.linearRampToValueAtTime(0.35, time + 0.6);
    wash.gain.exponentialRampToValueAtTime(0.0003, time + dur * 0.8);
    n.connect(washBp).connect(wash);
    n.stop(end);
    const lp = filterOf(ctx, 'lowpass', hz(sc, 6000 * k.bright), 0.7);
    for (const node of [low, pm, ph, splash, wash]) node.connect(lp);
    lp.connect(out.input);
    run([...oscs, sag], time, end);
    return done(sc, out.top, time, end);
  },
};

const GLASS_SMASH: SoundDef = {
  id: 'glass-smash',
  name: 'Glass smash',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A pane breaking: a sharp burst, crunching debris and a shower of tiny high tinkles.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const dur = clamp(1.4 * k.tail, 0.5, 3.5);
    const out = stage(sc, 0.5 * k.level, { drive: 1.4, trim: 0.66 });
    // The break and the debris share one noise.
    const n = noiseSource(sc, time);
    const burstHp = filterOf(ctx, 'highpass', hz(sc, 2200 * Math.sqrt(k.bright)));
    const burst = envelope(ctx, time, 0.9, 0.0015, 0.12 * Math.sqrt(k.tail));
    n.connect(burstHp).connect(burst).connect(out.input);
    const debrisBp = filterOf(ctx, 'bandpass', hz(sc, 5500 * Math.sqrt(k.bright)), 0.9);
    const debris = gainOf(ctx, 0);
    let last = time + 0.2;
    for (let t = 0.01; t < dur * 0.85; t += 0.004 + Math.random() * 0.02 * (1 + 6 * (t / dur))) {
      const w = 0.002 + Math.random() * 0.004;
      debris.gain.setValueAtTime(Math.random() * 0.7 * Math.exp((-3 * t) / dur), time + t);
      debris.gain.setValueAtTime(0, time + t + w);
      last = Math.max(last, time + t + w);
    }
    n.connect(debrisBp).connect(debris).connect(out.input);
    // Tinkles: four voices across the stereo field, each re-tuned and re-struck for every shard.
    const pans = [-0.7, -0.25, 0.25, 0.7];
    const voices = pans.map((pan, v) => {
      const o = oscOf(ctx, v % 2 ? 'triangle' : 'sine', 4000);
      const g = gainOf(ctx, 0);
      o.connect(g).connect(pannerOf(ctx, pan)).connect(out.input);
      let t = time + 0.003 + Math.random() * 0.03 * (v + 1);
      while (t < time + dur * 0.92) {
        const x = (t - time) / dur;
        const f = hz(sc, (2600 + Math.random() * 6000) * Math.pow(k.bright, 0.3) * Math.sqrt(k.scale));
        const d = (0.025 + Math.random() * 0.09) * Math.sqrt(k.tail);
        const a = (0.35 + Math.random() * 0.65) * Math.exp(-2.2 * x) * 0.5;
        o.frequency.setValueAtTime(f, t);
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(a, t + 0.0015);
        g.gain.exponentialRampToValueAtTime(a * 0.001, t + 0.0015 + d);
        g.gain.linearRampToValueAtTime(0, t + 0.0025 + d);
        last = Math.max(last, t + 0.0025 + d);
        t += 0.0035 + d + Math.random() * 0.06 * (1 + 4 * x);
      }
      return o;
    });
    const end = last + 0.005;
    n.stop(end);
    run(voices, time, end);
    return done(sc, out.top, time, end);
  },
};

const BRAAM: SoundDef = {
  id: 'braam',
  name: 'Braam',
  category: 'impact',
  kind: 'shot',
  pitched: false,
  blurb: 'A cinematic low brass blast on the key, its filter opening slowly with a growl.',
  play(sc, _note, velocity, time) {
    const ctx = sc.ctx;
    const k = knobs(sc, velocity);
    const hold = clamp(1.6 * k.tail, 0.5, 4);
    const rel = clamp(0.45 * Math.sqrt(k.tail), 0.2, 0.8);
    const end = time + hold + rel;
    const out = stage(sc, 0.58 * k.level, { drive: 2, oversample: '2x' });
    const f0 = keyHz(sc, 55, k.octave);
    // Saws on the root, its octave and fifth, spread left and right; a sine sub under them.
    const left = gainOf(ctx, 0.2);
    const right = gainOf(ctx, 0.2);
    const centre = gainOf(ctx, 0.16);
    const pl = pannerOf(ctx, -0.5);
    const pr = pannerOf(ctx, 0.5);
    const voices = ([[f0, -12, left], [f0, 12, right], [f0 * 2, -7, right], [f0 * 2, 7, left], [f0 * 1.5, 3, centre]] as const).map(([f, cents, bus]) => {
      const o = oscOf(ctx, 'sawtooth', f, cents);
      o.connect(bus);
      return o;
    });
    // The bell of the horn: a lowpass opening over a second, buzzed by the growl.
    const open = Math.min(1.2, hold * 0.8);
    const c0 = 110;
    const c1 = hz(sc, 1900 * k.bright);
    const lp = filterOf(ctx, 'lowpass', c0, 3);
    const opening = curve(64, (x) => c0 + (c1 - c0) * Math.pow(x, 1.6));
    lp.frequency.setValueCurveAtTime(opening, time, open);
    lp.frequency.setValueAtTime(c1, time + hold);
    lp.frequency.exponentialRampToValueAtTime(c0, end);
    left.connect(pl).connect(lp);
    right.connect(pr).connect(lp);
    centre.connect(lp);
    const growl = oscOf(ctx, 'sine', 31);
    const growlDepth = ctx.createGain();
    growlDepth.gain.setValueCurveAtTime(opening.map((c) => c * 0.45), time, open);
    growlDepth.gain.setValueAtTime(c1 * 0.45, time + hold);
    growlDepth.gain.linearRampToValueAtTime(0, end);
    growl.connect(growlDepth).connect(lp.frequency);
    const buzz = gainOf(ctx, 0.78);
    const buzzDepth = gainOf(ctx, 0.22);
    growl.connect(buzzDepth).connect(buzz.gain);
    const sub = oscOf(ctx, 'sine', f0 / 2);
    const subLevel = gainOf(ctx, 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, time);
    env.gain.linearRampToValueAtTime(1, time + 0.07);
    env.gain.linearRampToValueAtTime(0.85, time + hold);
    env.gain.exponentialRampToValueAtTime(0.0005, end);
    lp.connect(buzz).connect(env);
    sub.connect(subLevel).connect(env);
    env.connect(out.input);
    run([...voices, growl, sub], time, end);
    return done(sc, out.top, time, end);
  },
};

export const ONE_SHOT_SOUNDS: SoundDef[] = [
  // The dub set's original eight, as they were.
  LASER,
  ZAP,
  RISER,
  BOING,
  CRACKLE,
  BOOM,
  ALARM,
  ECHO_CLAP,
  // Dub.
  AIR_HORN,
  REWIND,
  DUB_STAB,
  SPRING_CRASH,
  SIREN_RISE,
  MELODICA,
  VINYL_STOP,
  // Risers and drops.
  NOISE_RISER,
  LONG_RISER,
  PITCH_RISER,
  DOWNLIFTER,
  REVERSE_SWELL,
  SNARE_BUILD,
  SWEEP_DOWN,
  // Impacts.
  IMPACT,
  SUB_DROP,
  THUNDER,
  GONG_CRASH,
  GLASS_SMASH,
  BRAAM,
];
