/**
 * Bowls and bells: struck, pitched resonances that ring out.
 *
 * Every sound here is a handful of sine partials, each with its own
 * envelope (the upper ones die away sooner, as they do on real metal, glass
 * and wood), plus a short filtered-noise touch for the mallet, pin or hand.
 * A partial can be a slowly beating pair: two sines a fraction of a hertz
 * apart, the shimmer of a bowl or a bell.
 *
 * The knobs, the same on every sound:
 * - Tail: how long it rings, 0.3x (0) to 1x (0.5) to 2.5x (1) its natural length.
 * - Tone: dark to bright (the level of the upper partials and the attack).
 * - Size: one character control per sound, named in each sound's notes.
 * Velocity: louder and brighter the harder it is struck.
 */
import { fadeableHandle, midiToHz, noiseSource, releaseAfter, velocityGain, type SoundContext, type SoundDef, type SoundHandle } from './kit';

// ── Building blocks ─────────────────────────────────────────────────────

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
const unit = (x: number, fallback = 0.5): number => (Number.isFinite(x) ? clamp(x, 0, 1) : fallback);

/** The Tail knob as a ring-length multiplier: 0.3x at 0, 1x at 0.5, 2.5x at 1. */
function tailScale(tail: number): number {
  const t = unit(tail);
  return Math.pow(t < 0.5 ? 0.3 : 2.5, Math.abs(2 * t - 1));
}

/** Low notes ring longer and high notes die sooner: a multiplier around middle C. */
function pitchScale(freq: number, amount: number, lo = 0.3, hi = 2.2): number {
  return clamp(Math.pow(freq / 261.63, -amount), lo, hi);
}

/**
 * How the upper partials lean, from the Tone knob and how hard it was hit:
 * 0 at Tone 0.5 and velocity 0.8, negative darker, positive brighter.
 */
function brightSlope(tone: number, velocity: number): number {
  return (unit(tone) - 0.5) * 1.5 + (unit(velocity, 0.8) - 0.8) * 1.0;
}

/** Level multiplier for a partial at `ratio` times the fundamental (the fundamental itself is left alone). */
function tilt(ratio: number, slope: number): number {
  return clamp(Math.pow(ratio, slope), 0, 2);
}

/** Bring a note into [lo, hi] by octaves (music box and chimes live up high). */
function foldNote(note: number, lo: number, hi: number): number {
  let n = note;
  while (n > hi) n -= 12;
  while (n < lo) n += 12;
  return n;
}

/** One strike being built: everything connects into `amp`, which the studio can fade to choke it. */
interface Strike {
  sc: SoundContext;
  ctx: BaseAudioContext;
  t: number;
  amp: GainNode;
  /** The latest moment anything in this strike still sounds. */
  end: number;
  /** Partials above this are left out (no aliasing, no wasted oscillators). */
  maxHz: number;
  /** The strike's level, and the sum of its partials' levels (how loud it could get if they all lined up). */
  level: number;
  sum: number;
  /** The sum this sound is voiced for: a brighter strike that sums past it is turned down to match (see done). */
  headroom: number;
}

function strike(sc: SoundContext, time: number, level: number, headroom = Infinity): Strike {
  const ctx = sc.ctx;
  const amp = ctx.createGain();
  amp.gain.value = Math.max(0, level);
  amp.connect(sc.out);
  return { sc, ctx, t: time, amp, end: time + 0.05, maxHz: Math.min(16000, ctx.sampleRate * 0.45), level: Math.max(0, level), sum: 0, headroom };
}

interface Shape {
  /** Seconds after the strike this part starts (a chime in a cascade). */
  delay?: number;
  /** Seconds to the peak; a few milliseconds keeps the start click-free. */
  attack?: number;
  /** An S-shaped rise (a rubbed bowl or glass swelling in) instead of a straight one. */
  swell?: boolean;
  /** The gong's bloom: reach `from` x level at the attack, then keep rising to full level by `time`. */
  bloom?: { time: number; from: number };
}

/** A gain that rises to `level`, then dies away exponentially over `decay` seconds. Returns it and its end. */
function envGain(s: Strike, level: number, decay: number, shape: Shape): { gain: GainNode; start: number; end: number } {
  const g = s.ctx.createGain();
  const p = g.gain;
  const start = s.t + (shape.delay ?? 0);
  const attack = Math.max(0.001, shape.attack ?? 0.003);
  const lv = Math.max(0.0002, level);
  p.value = 0;
  if (shape.swell) {
    const n = 48;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = lv * Math.pow(Math.sin((i / (n - 1)) * Math.PI * 0.5), 2);
    p.setValueCurveAtTime(curve, start, attack);
  } else {
    p.setValueAtTime(0, start);
    p.linearRampToValueAtTime(lv * (shape.bloom ? clamp(shape.bloom.from, 0.01, 1) : 1), start + attack);
  }
  let top = start + attack;
  if (shape.bloom && shape.bloom.time > attack + 0.01) {
    top = start + shape.bloom.time;
    p.linearRampToValueAtTime(lv, top);
  }
  // Down 70 dB over the decay, then the last whisper to zero.
  const fall = top + Math.max(0.02, decay);
  p.exponentialRampToValueAtTime(lv * 0.0003, fall);
  p.linearRampToValueAtTime(0, fall + 0.01);
  return { gain: g, start, end: fall + 0.01 };
}

interface PartialOptions extends Shape {
  /** Make it a beating pair: the two sines sit `beat` Hz apart around the frequency. */
  beat?: number;
  /** The second sine of the pair, relative to the first (1: full beats, less: a gentle shimmer). */
  depth?: number;
  /** Start this many cents sharp and settle onto the pitch (a tine or a gong's bend). */
  bend?: number;
  bendTime?: number;
  /** A custom waveform instead of a sine (the glass's few harmonics). */
  wave?: PeriodicWave;
  /** Each sine's detune param, for a shared vibrato. */
  onOsc?: (o: OscillatorNode) => void;
}

/** One partial: a sine (or a beating pair) with its own envelope. Too high or too quiet: left out. */
function partial(s: Strike, freq: number, level: number, decay: number, opt: PartialOptions = {}): void {
  const beat = Math.max(0, opt.beat ?? 0);
  if (!(freq > 20) || freq + beat > s.maxHz || !(level > 0.002)) return;
  const depth = beat > 0 ? clamp(opt.depth ?? 1, 0, 1) : 0;
  const env = envGain(s, level / (1 + depth), decay, opt);
  env.gain.connect(s.amp);
  s.sum += level;
  // The pair straddles the frequency weighted by loudness, so what you hear stays on pitch even when the second sine is quiet.
  const voices: Array<[number, number]> = beat > 0
    ? [[freq - (beat * depth) / (1 + depth), 1], [freq + beat / (1 + depth), depth]]
    : [[freq, 1]];
  const stopAt = env.end + 0.01;
  for (const [hz, amount] of voices) {
    const o = s.ctx.createOscillator();
    if (opt.wave) o.setPeriodicWave(opt.wave);
    o.frequency.value = hz;
    if (opt.bend) {
      o.detune.setValueAtTime(opt.bend, env.start);
      o.detune.setTargetAtTime(0, env.start, Math.max(0.005, opt.bendTime ?? 0.04));
    }
    opt.onOsc?.(o);
    if (amount >= 0.999) {
      o.connect(env.gain);
    } else {
      const g = s.ctx.createGain();
      g.gain.value = amount;
      o.connect(g).connect(env.gain);
    }
    o.start(env.start);
    o.stop(stopAt);
  }
  s.end = Math.max(s.end, stopAt);
}

/** A burst of filtered noise: a mallet's thump, a pin's tick, a rub, a wash. */
function noise(s: Strike, type: BiquadFilterType, freq: number, q: number, level: number, decay: number, shape: Shape = {}): void {
  if (!(level > 0.002)) return;
  const env = envGain(s, level, decay, { attack: 0.0015, ...shape });
  const f = s.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = clamp(freq, 30, s.maxHz);
  f.Q.value = q;
  const src = noiseSource(s.sc, env.start);
  src.connect(f).connect(env.gain).connect(s.amp);
  src.stop(env.end + 0.01);
  s.end = Math.max(s.end, env.end + 0.01);
}

/** Let the strike go once it has rung out, and hand back a handle that can choke it early. */
function done(s: Strike): SoundHandle {
  // A bright, hard strike adds upper partials on top of the body: let it grow a little louder, never into clipping.
  const over = s.sum / s.headroom;
  if (over > 1) s.amp.gain.value = s.level * Math.pow(over, -0.85);
  const end = s.end + 0.03;
  releaseAfter(s.sc, s.amp, end);
  return fadeableHandle(end - s.t, s.amp, s.t);
}

/** Read a note safely (a bad value plays middle C rather than nothing or NaN). */
const safeNote = (note: number): number => (Number.isFinite(note) ? clamp(note, 12, 120) : 60);

// ── The sounds ──────────────────────────────────────────────────────────

const singingBowl: SoundDef = {
  id: 'singing-bowl',
  name: 'Singing bowl',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A metal singing bowl struck with a soft mallet: a warm hum with a slow, wavering shimmer that rings for a long time.',
  // Size: how far apart each beating pair sits (0: still, 1: a fast wobble).
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const ring = clamp(14.6 * tailScale(sc.tail), 2, 32);
    const tone = unit(sc.tone);
    const spread = unit(sc.size) * 3;
    // 1 at velocity 0.8 (the classic bowl), a little brighter when struck harder.
    const lift = 0.75 + unit(velocity, 0.8) * 0.3125;
    const s = strike(sc, time, velocityGain(velocity) * 0.3);
    const partials: Array<[number, number, number]> = [
      [1, 1, 1],
      [2.76, 0.45 + tone * 0.4, 0.7],
      [5.4, 0.15 + tone * 0.4, 0.45],
      [8.93, tone * 0.25, 0.3],
    ];
    partials.forEach(([ratio, level, share], i) => {
      partial(s, f * ratio, level * Math.pow(lift, i), ring * share, { attack: 0.004, beat: spread * ratio });
    });
    // The felt mallet's soft touch.
    noise(s, 'lowpass', clamp(f * 4, 400, 2500), 0.7, 0.12 * lift, 0.035);
    return done(s);
  },
};

const crystalBowl: SoundDef = {
  id: 'crystal-bowl',
  name: 'Crystal bowl',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A quartz bowl that swells in as if rubbed, then sings an almost pure, very long tone with a slow shimmer.',
  // Size: the bowl's size: a slower swell and a slower, deeper shimmer.
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const size = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(22 * tailScale(sc.tail) * pitchScale(f, 0.2, 0.6, 1.5), 3, 50);
    const attack = (0.35 + size * 0.9) * (1.25 - vel * 0.4);
    const s = strike(sc, time, velocityGain(velocity) * 0.5);
    partial(s, f, 1, ring, { attack, swell: true, beat: 1.3 - size * 0.9, depth: 0.12 + size * 0.2 });
    partial(s, f * 2, 0.06 * tilt(2, slope) * (0.6 + vel * 0.5), ring * 0.45, { attack: attack * 0.8, swell: true, beat: 0.7 });
    partial(s, f * 3, 0.012 * tilt(3, slope), ring * 0.25, { attack: attack * 0.7, swell: true });
    // The rub: breath of noise tuned to the bowl, swelling with the tone and fading as it settles.
    noise(s, 'bandpass', f, 6, 2.4 * (0.6 + vel * 0.5), attack * 2.4, { attack: attack * 0.7, swell: true });
    noise(s, 'bandpass', f * 4, 2, 0.35 * tilt(4, slope), attack * 1.6, { attack: attack * 0.6, swell: true });
    return done(s);
  },
};

const gong: SoundDef = {
  id: 'gong',
  name: 'Gong',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A big bronze gong: a deep body under a shimmering wash that blooms after the hit and slowly fades.',
  // Size: the bloom: how much the shimmer swells after the hit, and how slowly.
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const size = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(16 * tailScale(sc.tail) * pitchScale(f, 0.25, 0.5, 1.6), 3, 40);
    const bloomTime = 0.5 + size * 1.8;
    const bloomFrom = clamp(0.5 - size * 0.42 - (vel - 0.5) * 0.2, 0.06, 0.8);
    const s = strike(sc, time, velocityGain(velocity) * 0.28, 3.4);
    // The body: the note itself, slowly beating, settling from a touch sharp.
    partial(s, f, 1, ring, { attack: 0.006, beat: 0.45, bend: 18 * vel, bendTime: 0.12 });
    partial(s, f * 2.0, 0.3 * tilt(2, slope), ring * 0.7, { attack: 0.008 });
    // The bloom: denser inharmonic partials that keep rising after the hit, the higher ones later.
    const upper: Array<[number, number, number]> = [
      [1.52, 0.4, 0.55],
      [2.43, 0.34, 0.45],
      [3.07, 0.3, 0.38],
      [3.71, 0.26, 0.32],
      [4.53, 0.22, 0.26],
      [5.49, 0.18, 0.2],
    ];
    upper.forEach(([ratio, level, share], i) => {
      partial(s, f * ratio, level * tilt(ratio, slope), ring * share, {
        attack: 0.006,
        bloom: i === 0 ? undefined : { time: bloomTime * (0.55 + i * 0.12), from: bloomFrom },
      });
    });
    // The wash: a swell of filtered noise riding the bloom.
    noise(s, 'bandpass', clamp(f * 7, 1200, 9000), 0.9, 0.16 * tilt(4, slope) * (0.6 + size * 0.8), ring * 0.18, {
      attack: 0.01,
      bloom: { time: bloomTime * 1.1, from: 0.25 },
    });
    // The beater's thump.
    noise(s, 'lowpass', clamp(f * 2.5, 180, 1200), 1, 0.5 * (0.5 + vel * 0.6), 0.09);
    return done(s);
  },
};

const templeBell: SoundDef = {
  id: 'temple-bell',
  name: 'Temple bell',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A cast bronze bell: a bright metallic strike, then a deep, slightly sad ring that warbles slowly away.',
  // Size: the bell's size: more hum underneath and a slower, deeper warble.
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const size = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(16 * tailScale(sc.tail) * pitchScale(f, 0.3, 0.45, 1.8), 3, 40);
    const warble = 1.1 - size * 0.75;
    const s = strike(sc, time, velocityGain(velocity) * 0.25, 3.5);
    // Hum, prime, tierce, quint, nominal and the upper partials of a tuned bell.
    partial(s, f * 0.5, 0.22 + size * 0.33, ring, { attack: 0.012, beat: warble * 0.5, depth: 0.5 + size * 0.4 });
    partial(s, f, 0.9, ring * 0.7, { attack: 0.004, beat: warble, depth: 0.6 });
    partial(s, f * 1.19, 0.36 * tilt(1.19, slope), ring * 0.5, { attack: 0.003 });
    partial(s, f * 1.5, 0.2 * tilt(1.5, slope), ring * 0.35, { attack: 0.003 });
    partial(s, f * 2.0, 0.7 * tilt(2, slope), ring * 0.4, { attack: 0.003, beat: warble * 1.6, depth: 0.5 });
    partial(s, f * 2.52, 0.26 * tilt(2.52, slope), ring * 0.22, { attack: 0.002 });
    partial(s, f * 3.0, 0.24 * tilt(3, slope), ring * 0.17, { attack: 0.002 });
    // The clapper's metallic strike.
    noise(s, 'bandpass', clamp(f * 6, 1500, 8000), 1.4, 0.4 * tilt(6, slope) * (0.4 + vel * 0.8), 0.07);
    return done(s);
  },
};

const tubularBell: SoundDef = {
  id: 'tubular-bell',
  name: 'Tubular bell',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'An orchestral chime: a bright, clangy hammer strike on a brass tube that rings clearly for several seconds.',
  // Size: the hammer: soft rawhide (0) to a hard, clangy strike (1).
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const hard = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(9 * tailScale(sc.tail) * pitchScale(f, 0.35, 0.4, 1.8), 1.5, 26);
    const clang = (0.4 + hard * 0.9) * (0.5 + vel * 0.6);
    const s = strike(sc, time, velocityGain(velocity) * 0.17, 4);
    // The tube's modes, heard together as the note an octave below the lowest strong one.
    partial(s, f, 0.18, ring * 0.8, { attack: 0.004 });
    partial(s, f * 2.0, 1, ring, { attack: 0.002, beat: 0.35, depth: 0.4 });
    partial(s, f * 3.0, 0.7 * tilt(3, slope), ring * 0.75, { attack: 0.002 });
    partial(s, f * 4.2, 0.5 * tilt(4.2, slope), ring * 0.5, { attack: 0.0015 });
    partial(s, f * 5.4, 0.36 * tilt(5.4, slope), ring * 0.34, { attack: 0.0015 });
    // The clang: high modes that flare and vanish.
    partial(s, f * 6.9, 0.55 * clang * tilt(6.9, slope), 0.3 + ring * 0.04, { attack: 0.001 });
    partial(s, f * 8.6, 0.4 * clang * tilt(8.6, slope), 0.18 + ring * 0.025, { attack: 0.001 });
    noise(s, 'highpass', clamp(f * 8, 2500, 9000), 0.8, 0.22 * clang * tilt(6, slope), 0.035);
    return done(s);
  },
};

/** Chime pitches above the cascade's lowest note: the note's 1, 2, 4 and 5 (safe in major and minor keys) over two octaves. */
const CHIME_STEPS = [0, 2, 5, 7, 12, 14, 17, 19];

const windChimes: SoundDef = {
  id: 'wind-chimes',
  name: 'Wind chimes',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A breeze through metal chimes: a few bright tings around the note, an octave up, tumbling out over a second or two.',
  // Size: how many chimes (4 to 7) and how far the cascade spreads.
  play(sc, note, velocity, time) {
    const base = foldNote(safeNote(note) + 12, 60, 86);
    const size = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const count = clamp(Math.round(4 + size * 3 + (Math.random() - 0.5) * 1.2), 4, 7);
    const span = 0.6 + size * 1.5;
    const ring = 2.4 * tailScale(sc.tail);
    const s = strike(sc, time, velocityGain(velocity) * 0.2);
    // When each chime sounds: the first at once, the rest scattered, bunching like a gust.
    const times = [0];
    for (let i = 1; i < count; i++) times.push(span * Math.pow(Math.random(), 1.3));
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) times[i] = Math.max(times[i], times[i - 1] + 0.035 + Math.random() * 0.05);
    let last = -1;
    times.forEach((at, i) => {
      let step = 0;
      if (i > 0) {
        do step = CHIME_STEPS[Math.floor(Math.random() * CHIME_STEPS.length)];
        while (step === last);
      }
      last = step;
      const hz = midiToHz(base + step) * (1 + (Math.random() - 0.5) * 0.003);
      const hit = i === 0 ? 1 : 0.4 + Math.random() * 0.6;
      const decay = ring * pitchScale(hz, 0.5, 0.4, 1.6) * (0.8 + Math.random() * 0.4);
      partial(s, hz, hit, decay, { delay: at, attack: 0.0015 });
      partial(s, hz * 2.76, hit * 0.32 * tilt(2.76, slope), decay * 0.35, { delay: at, attack: 0.001 });
    });
    return done(s);
  },
};

const kalimba: SoundDef = {
  id: 'kalimba',
  name: 'Kalimba',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A thumb piano: a plucked metal key with a sweet, glassy ping and a soft woody click.',
  // Size: the box: from a bare board (0) to a big hollow box that knocks and sustains (1).
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const box = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(2.7 * tailScale(sc.tail) * pitchScale(f, 0.5, 0.35, 2) * (0.85 + box * 0.35), 0.3, 10);
    const s = strike(sc, time, velocityGain(velocity) * 0.4, 1.5);
    partial(s, f, 1, ring, { attack: 0.002, bend: 7 * vel, bendTime: 0.025 });
    // The tine's first overtone sits a little sharp of two octaves and a fifth.
    partial(s, f * 6.15, 0.24 * tilt(6.15, slope), ring * 0.1, { attack: 0.0015 });
    partial(s, f * 17.2, 0.08 * tilt(17.2, slope), ring * 0.035, { attack: 0.001 });
    // The thumb's click and the box knocking.
    noise(s, 'bandpass', 3200, 1.2, 0.35 * (0.4 + vel * 0.8) * tilt(4, slope), 0.012);
    noise(s, 'bandpass', 210 + (1 - box) * 120, 3, (0.4 + box * 1.6) * (0.5 + vel * 0.6), 0.05 + box * 0.15);
    return done(s);
  },
};

const handpan: SoundDef = {
  id: 'handpan',
  name: 'Handpan',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A steel handpan played by hand: a warm, round, singing note with a gentle shimmer.',
  // Size: the shimmer: how much the note and its octave beat and sparkle.
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const shimmer = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(5.5 * tailScale(sc.tail) * pitchScale(f, 0.35, 0.4, 1.8), 0.6, 18);
    const s = strike(sc, time, velocityGain(velocity) * 0.34, 2);
    partial(s, f, 1, ring, { attack: 0.007, beat: 0.2 + shimmer * 0.7, depth: 0.15 + shimmer * 0.35 });
    // The octave and the compound fifth, tuned into the note field, bloom in just after the touch.
    partial(s, f * 2, 0.42 * tilt(2, slope), ring * 0.7, { attack: 0.03, beat: 0.4 + shimmer * 1.6, depth: 0.2 + shimmer * 0.5 });
    partial(s, f * 3, 0.2 * tilt(3, slope), ring * 0.45, { attack: 0.02 });
    // The shell's own faint ding.
    partial(s, f * 4.93, (0.03 + shimmer * 0.06) * tilt(4.93, slope), ring * 0.18, { attack: 0.004 });
    // The hand.
    noise(s, 'lowpass', clamp(f * 2, 350, 1400), 0.8, 0.35 * (0.4 + vel * 0.8), 0.03);
    return done(s);
  },
};

const glass: SoundDef = {
  id: 'glass',
  name: 'Glass harmonica',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'Wet fingers on spinning glass: a pure, airy tone that swells in slowly with a gentle waver.',
  // Size: the waver: how deep the vibrato and how breathy the edge.
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const waver = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(7 * tailScale(sc.tail) * pitchScale(f, 0.25, 0.5, 1.6), 1.2, 24);
    const attack = 0.14 + 0.32 * (1 - vel * 0.6);
    const ctx = sc.ctx;
    // A few soft harmonics, as rubbing drives the glass.
    const real = new Float32Array(5);
    const imag = new Float32Array([0, 1, 0.12 * tilt(2, slope * 2), 0.05 * tilt(3, slope * 2), 0.02 * tilt(4, slope * 2)]);
    const wave = ctx.createPeriodicWave(real, imag);
    const s = strike(sc, time, velocityGain(velocity) * 0.36);
    // A vibrato that eases in after the swell.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.6 + Math.random() * 0.8;
    const depth = ctx.createGain();
    const cents = 3 + waver * 11;
    depth.gain.setValueAtTime(0, time);
    depth.gain.linearRampToValueAtTime(cents * 0.3, time + attack);
    depth.gain.linearRampToValueAtTime(cents, time + attack + 0.8);
    lfo.connect(depth);
    partial(s, f, 1, ring, { attack, swell: true, wave, beat: 0.6, depth: 0.25, onOsc: (o) => depth.connect(o.detune) });
    lfo.start(time);
    lfo.stop(s.end);
    // The breathy edge of the rub, fading as the tone takes over.
    noise(s, 'bandpass', f * (1.5 + unit(sc.tone) * 2), 3, (0.45 + waver * 0.7) * tilt(2, slope), ring * 0.3, { attack: attack * 0.8, swell: true });
    return done(s);
  },
};

const musicBox: SoundDef = {
  id: 'music-box',
  name: 'Music box',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A tiny metal comb plucked by a pin: bright, delicate and a little out of tune, played an octave up.',
  // Size: how out of tune the comb is, from clean (0) to a woozy, beating old box (1).
  play(sc, note, velocity, time) {
    const n = foldNote(safeNote(note) + 12, 60, 96);
    const wobble = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    // Each tooth is tuned a hair off, and doubled by a second tooth a few cents away.
    const cents = (Math.random() - 0.5) * (2 + wobble * 8);
    const f = midiToHz(n) * Math.pow(2, cents / 1200);
    const pair = f * (Math.pow(2, (2 + wobble * 14) / 1200) - 1);
    const ring = clamp(1.7 * tailScale(sc.tail) * pitchScale(f / 2, 0.45, 0.35, 1.8), 0.25, 7);
    const s = strike(sc, time, velocityGain(velocity) * 0.32, 1.7);
    partial(s, f, 1, ring, { attack: 0.0012, beat: pair, depth: 0.55 });
    partial(s, f * 2, 0.06 * tilt(2, slope), ring * 0.4, { attack: 0.001 });
    partial(s, f * 6.27, 0.3 * tilt(6.27, slope), ring * 0.14, { attack: 0.001 });
    partial(s, f * 17.55, 0.1 * tilt(17.55, slope), ring * 0.05, { attack: 0.001 });
    // The pin's tick.
    noise(s, 'highpass', 6000, 0.7, 0.12 * (0.4 + vel * 0.8) * tilt(6, slope), 0.007);
    return done(s);
  },
};

const tongueDrum: SoundDef = {
  id: 'tongue-drum',
  name: 'Tongue drum',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A steel tongue drum played with a rubber mallet: a round, dark, gentle note with a soft thump.',
  // Size: the drum's body: from a small drum (0) to a big hollow one with more boom and ring (1).
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const body = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel) * 1.3 - 0.3;
    const ring = clamp(2.3 * tailScale(sc.tail) * pitchScale(f, 0.4, 0.4, 1.9) * (0.75 + body * 0.5), 0.3, 10);
    const s = strike(sc, time, velocityGain(velocity) * 0.38);
    partial(s, f, 1, ring, { attack: 0.005, beat: 0.25 + body * 0.2, depth: 0.25 });
    partial(s, f * 2, 0.16 * tilt(2, slope), ring * 0.5, { attack: 0.008 });
    partial(s, f * 2.92, 0.05 * tilt(2.92, slope), ring * 0.2, { attack: 0.004 });
    partial(s, f * 4.2, 0.025 * tilt(4.2, slope), ring * 0.1, { attack: 0.003 });
    // The mallet and the drum's hollow body.
    noise(s, 'lowpass', clamp(f * 1.5, 250, 900) * (0.7 + unit(sc.tone) * 0.8), 0.9, 0.4 * (0.4 + vel * 0.8), 0.03);
    noise(s, 'bandpass', 120 + (1 - body) * 60, 3, (0.5 + body * 1.5) * (0.5 + vel * 0.6), 0.08 + body * 0.2);
    return done(s);
  },
};

const marimba: SoundDef = {
  id: 'marimba',
  name: 'Marimba',
  category: 'resonant',
  kind: 'strike',
  pitched: true,
  blurb: 'A rosewood bar over a tuned tube: a warm, woody note that speaks quickly and fades fast, good for melodies.',
  // Size: the mallet: soft yarn (0) to hard rubber (1), from a round thud to a crisp knock.
  play(sc, note, velocity, time) {
    const f = midiToHz(safeNote(note));
    const hard = unit(sc.size);
    const vel = unit(velocity, 0.8);
    const slope = brightSlope(sc.tone, vel);
    const ring = clamp(1.1 * tailScale(sc.tail) * pitchScale(f, 0.6, 0.3, 2.4), 0.12, 6);
    const s = strike(sc, time, velocityGain(velocity) * 0.42, 1.6);
    const attack = 0.006 - hard * 0.0045;
    partial(s, f, 1, ring, { attack });
    // The bar's tuned overtone two octaves up, and the next one near ten times.
    partial(s, f * 4, (0.12 + hard * 0.35) * tilt(4, slope), ring * 0.22, { attack: attack * 0.6 });
    partial(s, f * 9.9, (0.03 + hard * 0.12) * tilt(9.9, slope), ring * 0.07, { attack: 0.001 });
    noise(s, 'bandpass', clamp(f * 3, 600, 5000), 0.8, (0.06 + hard * 0.2) * (0.4 + vel * 0.8) * tilt(3, slope), 0.006 + (1 - hard) * 0.012);
    return done(s);
  },
};

export const RESONANT_SOUNDS: SoundDef[] = [
  singingBowl,
  crystalBowl,
  gong,
  templeBell,
  tubularBell,
  windChimes,
  kalimba,
  handpan,
  glass,
  musicBox,
  tongueDrum,
  marimba,
];
