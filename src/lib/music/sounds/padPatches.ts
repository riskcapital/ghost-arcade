/**
 * The drone's sounds: pads and ethereal textures held under the music.
 *
 * Every patch reads all eight drone knobs in its own way: Tone (dark to
 * bright), Motion (slow movement), Shimmer (upper sparkle), Width (stereo
 * spread), Detune, Swell (attack and release), Air (breath and noise) and
 * Depth (sub and body). Each voice owns its LFOs, so held notes drift on
 * their own, and follows knob moves while it is held.
 */
import { holdAt, midiToHz, releaseAfter, softCurve, velocityGain, type PadContext, type PadPatchDef, type PadVoice, type SoundContext } from './kit';

type Params = Record<string, number>;

interface Knobs {
  tone: number;
  motion: number;
  shimmer: number;
  width: number;
  detune: number;
  swell: number;
  air: number;
  depth: number;
}

/** The drone knobs' defaults (as in the studio's knob list). */
const DEFAULTS: Knobs = { tone: 0.35, motion: 0.6, shimmer: 0.5, width: 0.8, detune: 0.25, swell: 0.55, air: 0.25, depth: 0.6 };

function knobs(params: Params): Knobs {
  const k = { ...DEFAULTS };
  for (const name of Object.keys(DEFAULTS) as Array<keyof Knobs>) {
    const v = params[`drone.${name}`];
    if (typeof v === 'number' && Number.isFinite(v)) k[name] = Math.max(0, Math.min(1, v));
  }
  return k;
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

/** Glide a param to a knob's new value. */
function glide(param: AudioParam, value: number, at: number, tau = 0.2): void {
  param.setTargetAtTime(value, at, tau);
}

/** Glide a param that has its own envelope scheduled: hold it where it is first. */
function reglide(param: AudioParam, value: number, at: number, tau = 0.2): void {
  holdAt(param, at);
  param.setTargetAtTime(value, at, tau);
}

/** An octave down for the sub, unless that would be below hearing. */
const subOf = (f: number) => (f / 2 >= 30 ? f / 2 : f);

// ── The voice's frame: envelope, release, kill ──────────────────────────

interface Shell {
  ctx: BaseAudioContext;
  time: number;
  /** The voice's sound goes in here: it is the envelope. */
  input: GainNode;
  /** Remember a started source so it is stopped when the voice ends. */
  keep<T extends AudioScheduledSourceNode>(source: T): T;
  /** Fade out from `at`: exponential, time constant `seconds × tauShare`, sources stopped after `seconds × tailShare`. */
  release(at: number, seconds: number, tauShare?: number, tailShare?: number): void;
  /** Silent within 40 ms. */
  kill(at: number): void;
}

function shell(pc: PadContext, time: number, peak: number, attack: number): Shell {
  const ctx = pc.ctx;
  const env = ctx.createGain();
  // Silent until the note starts, even if it is let go before then.
  env.gain.value = 0;
  env.gain.setValueAtTime(0, time);
  env.gain.linearRampToValueAtTime(peak, time + Math.max(0.02, attack));
  const gate = ctx.createGain();
  env.connect(gate).connect(pc.out);
  const sources: AudioScheduledSourceNode[] = [];
  let end = Infinity;
  let released = false;
  let killed = false;
  const finish = (at: number) => {
    if (at >= end) return;
    end = at;
    for (const s of sources) {
      try { s.stop(at); } catch { /* not started */ }
    }
    // releaseAfter only needs the context's clock.
    const sc: SoundContext = { ctx, out: pc.out, noise: pc.noise, tempo: 120, keyRoot: 48, size: 0.5, tail: 0.5, tone: 0.5 };
    releaseAfter(sc, gate, at + 0.05);
  };
  return {
    ctx,
    time,
    input: env,
    keep(source) {
      sources.push(source);
      return source;
    },
    release(at, seconds, tauShare = 0.2, tailShare = 1.3) {
      if (released || killed) return;
      released = true;
      holdAt(env.gain, at);
      env.gain.setTargetAtTime(0, at, Math.max(0.01, seconds * tauShare));
      finish(at + seconds * tailShare + 0.05);
    },
    kill(at) {
      if (killed) return;
      killed = true;
      gate.gain.setValueAtTime(1, at);
      gate.gain.linearRampToValueAtTime(0, at + 0.04);
      finish(at + 0.06);
    },
  };
}

// ── Small graph helpers ─────────────────────────────────────────────────

function amp(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

function bq(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function panner(ctx: BaseAudioContext, value: number): StereoPannerNode {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, value));
  return p;
}

function osc(sh: Shell, type: OscillatorType | PeriodicWave, freq: number, detune = 0): OscillatorNode {
  const o = sh.ctx.createOscillator();
  if (typeof type === 'object') o.setPeriodicWave(type);
  else o.type = type as OscillatorType;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(sh.time);
  return sh.keep(o);
}

/** Add `source` × `depth` onto `param`; returns the depth gain. */
function modTo(ctx: BaseAudioContext, source: AudioNode, param: AudioParam, depth: number): GainNode {
  const g = amp(ctx, depth);
  source.connect(g).connect(param);
  return g;
}

const cache = new WeakMap<BaseAudioContext, Map<string, AudioBuffer | PeriodicWave>>();

function cached<T extends AudioBuffer | PeriodicWave>(ctx: BaseAudioContext, key: string, make: () => T): T {
  let store = cache.get(ctx);
  if (!store) {
    store = new Map();
    cache.set(ctx, store);
  }
  let v = store.get(key);
  if (!v) {
    v = make();
    store.set(key, v);
  }
  return v as T;
}

/** A sine LFO starting at a random point in its cycle, so notes do not move in step. */
function lfo(sh: Shell, rate: number): OscillatorNode {
  const phase = Math.floor(Math.random() * 8);
  const wave = cached(sh.ctx, `lfo-${phase}`, () => {
    const a = (phase / 8) * 2 * Math.PI;
    return sh.ctx.createPeriodicWave([0, Math.sin(a)], [0, Math.cos(a)], { disableNormalization: true });
  });
  return osc(sh, wave, rate);
}

/** Noise a few seconds long (the shared one-second loop flutters audibly through narrow filters). */
function noise(sh: Shell): AudioBufferSourceNode {
  const buffer = cached(sh.ctx, 'noise', () => {
    const b = sh.ctx.createBuffer(1, Math.round(4.73 * sh.ctx.sampleRate), sh.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  });
  const s = sh.ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.start(sh.time, Math.random() * buffer.duration);
  return sh.keep(s);
}

/**
 * A wave from harmonic amplitudes, each harmonic at its own fixed phase:
 * the same tone as all-sine phases but without the tall peak, so stacked
 * notes do not spike.
 */
function harmonicWave(ctx: BaseAudioContext, amps: number[]): PeriodicWave {
  const real = new Float32Array(amps.length);
  const imag = new Float32Array(amps.length);
  for (let n = 1; n < amps.length; n++) {
    const phase = n === 1 ? 0 : (n * n * 2.39996) % (2 * Math.PI);
    real[n] = amps[n] * Math.sin(phase);
    imag[n] = amps[n] * Math.cos(phase);
  }
  return ctx.createPeriodicWave(real, imag);
}

/** A free-reed wave: every harmonic, falling slowly, with a nasal lift around the 4th to 6th. */
function reedWave(ctx: BaseAudioContext): PeriodicWave {
  return cached(ctx, 'reed', () => harmonicWave(ctx, Array.from({ length: 33 }, (_, n) => (n ? Math.pow(n, -0.6) * (1 + 0.6 * Math.exp(-(((n - 5) / 2) ** 2))) : 0))));
}

/** Octaves stacked: the fundamental and three octaves above it, each fainter. */
function octaveWave(ctx: BaseAudioContext): PeriodicWave {
  return cached(ctx, 'octaves', () => harmonicWave(ctx, [0, 1, 0.6, 0, 0.42, 0, 0, 0, 0.28]));
}

/** The voice API from a shell, a release time read from the knobs, and an update. */
function voiceOf(sh: Shell, releaseSeconds: () => number, update: (k: Knobs, at: number) => void, setK: (k: Knobs) => void): PadVoice {
  return {
    release: (at) => sh.release(at, releaseSeconds()),
    kill: (at) => sh.kill(at),
    update(params, at) {
      const k = knobs(params);
      setK(k);
      update(k, at);
    },
  };
}

// ── The patches ─────────────────────────────────────────────────────────

/** The studio's original drone: detuned saws through a slowly swept lowpass, a sub, shimmer an octave and a twelfth up, a touch of air. */
const warm: PadPatchDef = {
  id: 'warm',
  name: 'Warm pad',
  blurb: 'Detuned saws under a slowly moving filter, with a sub and a soft shimmer.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const freq = midiToHz(note);
    const cutoff = (kk: Knobs) => Math.min(12000, 180 + kk.tone * kk.tone * 5000 + freq * 0.5);
    const sh = shell(pc, time, velocityGain(velocity) * 0.32, 0.4 + k.swell * 6);
    const side = Math.random() * 2 - 1;
    const out = panner(ctx, side * k.width * 0.8);
    out.connect(sh.input);
    // The filter's slow sweep, this voice's own.
    const sweep = osc(sh, 'sine', 0.03 + k.motion * 0.35);
    const sweepDepth = amp(ctx, k.motion * 900);
    sweep.connect(sweepDepth);
    const filter = bq(ctx, 'lowpass', cutoff(k), 0.7);
    sweepDepth.connect(filter.frequency);
    filter.connect(out);
    const saws = [-1, 0, 1].map((dir) => {
      const o = osc(sh, 'sawtooth', freq, dir * k.detune * 22);
      o.connect(amp(ctx, 0.22)).connect(filter);
      return { o, dir };
    });
    const sub = amp(ctx, k.depth * 0.5);
    osc(sh, 'sine', freq / 2).connect(sub).connect(out);
    const shimmer = amp(ctx, k.shimmer * 0.35);
    osc(sh, 'sine', freq * 2, -3).connect(shimmer);
    osc(sh, 'sine', freq * 3, 4).connect(shimmer);
    shimmer.connect(out);
    const air = amp(ctx, k.air * 0.05);
    const hiss = ctx.createBufferSource();
    hiss.buffer = pc.noise;
    hiss.loop = true;
    hiss.start(time);
    sh.keep(hiss).connect(bq(ctx, 'bandpass', 6000, 0.6)).connect(air).connect(out);
    return {
      release: (at) => sh.release(at, 1.5 + k.swell * 5, 0.25, 1.5),
      kill: (at) => sh.kill(at),
      update(params, at) {
        k = knobs(params);
        glide(filter.frequency, cutoff(k), at, 0.15);
        glide(shimmer.gain, k.shimmer * 0.35, at);
        glide(air.gain, k.air * 0.05, at);
        glide(sweep.frequency, 0.03 + k.motion * 0.35, at);
        glide(sweepDepth.gain, k.motion * 900, at);
        glide(out.pan, side * k.width * 0.8, at);
        glide(sub.gain, k.depth * 0.5, at);
        for (const { o, dir } of saws) glide(o.detune, dir * k.detune * 22, at);
      },
    };
  },
};

const choir: PadPatchDef = {
  id: 'choir',
  name: 'Choir',
  blurb: 'A slow choir singing "aah" and drifting toward "ooh".',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const attack = 0.5 + k.swell * 6;
    // High notes sit right on the first formant and would ring out loud: ease them back.
    const sh = shell(pc, time, velocityGain(velocity) * 0.5 * Math.min(1, Math.sqrt(350 / f)), attack);
    const side = rand(-1, 1);
    const out = panner(ctx, side * k.width * 0.85);
    out.connect(sh.input);
    // The vowel: three formants; tone leans it toward a bright "aah", motion sways it toward "ooh".
    const vowel = lfo(sh, 0.03 + k.motion * 0.12);
    const formantSpec = (kk: Knobs): Array<[number, number, number]> => [
      [450 + kk.tone * 220, 180 * (0.15 + 0.85 * kk.motion), 1],
      [880 + kk.tone * 300, 170 * (0.15 + 0.85 * kk.motion), 0.55],
      [2500 + kk.tone * 300, 0, 0.12 + 0.4 * kk.tone],
    ];
    const lpCut = (kk: Knobs) => Math.min(16000, 1500 + Math.pow(kk.tone, 1.5) * 6000 + f);
    const lp = bq(ctx, 'lowpass', lpCut(k), 0.5);
    lp.connect(out);
    const formants = formantSpec(k).map(([fc, sweep, level], i) => {
      const bp = bq(ctx, 'bandpass', fc, [7, 9, 12][i]);
      const depth = modTo(ctx, vowel, bp.frequency, -sweep);
      const g = amp(ctx, level);
      bp.connect(g).connect(lp);
      return { bp, depth, g };
    });
    // Three singers on the note, a little apart, two with vibrato that comes in as the note settles.
    const cents = (kk: Knobs) => 3 + kk.detune * 18;
    const vib = lfo(sh, rand(4.7, 5.4));
    const vibDepth = amp(ctx, 0);
    vibDepth.gain.setValueAtTime(0, time);
    vibDepth.gain.linearRampToValueAtTime(3 + k.motion * 9, time + 0.3 + attack * 0.5);
    vib.connect(vibDepth);
    const singers = [-1, 0.4, 1].map((dir, i) => {
      const o = osc(sh, 'sawtooth', f, dir * cents(k));
      if (i !== 1) vibDepth.connect(o.detune);
      for (const { bp } of formants) o.connect(bp);
      return { o, dir };
    });
    // Breath sung through the same vowel.
    const breath = amp(ctx, k.air * 2.4);
    noise(sh).connect(breath);
    for (const { bp } of formants) breath.connect(bp);
    // A low voice an octave down, and a pure soprano an octave up.
    const sub = amp(ctx, k.depth * 0.25);
    osc(sh, 'sine', subOf(f)).connect(sub).connect(out);
    const high = amp(ctx, k.shimmer * 0.25);
    osc(sh, 'sine', f * 2, 4).connect(high).connect(out);
    return voiceOf(sh, () => 1.5 + k.swell * 6, (kk, at) => {
      glide(lp.frequency, lpCut(kk), at);
      formantSpec(kk).forEach(([fc, sweep, level], i) => {
        glide(formants[i].bp.frequency, fc, at);
        glide(formants[i].depth.gain, -sweep, at);
        glide(formants[i].g.gain, level, at);
      });
      glide(vowel.frequency, 0.03 + kk.motion * 0.12, at);
      reglide(vibDepth.gain, 3 + kk.motion * 9, at);
      glide(breath.gain, kk.air * 2.4, at);
      glide(sub.gain, kk.depth * 0.25, at);
      glide(high.gain, kk.shimmer * 0.25, at);
      glide(out.pan, side * kk.width * 0.85, at);
      for (const { o, dir } of singers) glide(o.detune, dir * cents(kk), at);
    }, (kk) => { k = kk; });
  },
};

const strings: PadPatchDef = {
  id: 'strings',
  name: 'Strings',
  blurb: 'A bowed string section: slow to speak, wide, with gentle vibrato.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const attack = 0.35 + k.swell * 5;
    const sh = shell(pc, time, velocityGain(velocity) * 0.62, attack);
    const cut = (kk: Knobs) => Math.min(16000, 700 + Math.pow(kk.tone, 1.6) * 7000 + f * 1.5);
    const lp = bq(ctx, 'lowpass', cut(k), 0.9);
    const body = amp(ctx, 0.2);
    lp.connect(body).connect(sh.input);
    // The filter breathes slowly with Motion.
    const breathe = lfo(sh, 0.05 + k.motion * 0.2);
    const breatheDepth = modTo(ctx, breathe, lp.frequency, k.motion * 0.25 * cut(k));
    // Two desks a side, each player a little off pitch, each side with its own vibrato that comes in after the bow settles.
    const left = panner(ctx, -k.width * 0.75);
    const right = panner(ctx, k.width * 0.75);
    left.connect(lp);
    right.connect(lp);
    const vibCents = (kk: Knobs) => 2 + kk.motion * 8;
    const vibs = [lfo(sh, rand(5, 5.5)), lfo(sh, rand(5.6, 6.2))].map((v) => {
      const d = amp(ctx, 0);
      d.gain.setValueAtTime(0, time);
      d.gain.linearRampToValueAtTime(vibCents(k), time + 0.4 + attack * 0.6);
      v.connect(d);
      return d;
    });
    const spread = (kk: Knobs) => 4 + kk.detune * 18;
    const players = ([[-1, left, 0], [0.35, left, 1], [1, right, 0], [-0.45, right, 1]] as const).map(([dir, side, v]) => {
      const o = osc(sh, 'sawtooth', f, dir * spread(k));
      vibs[v].connect(o.detune);
      o.connect(side);
      return { o, dir };
    });
    // The violins an octave up (Shimmer) and the cellos an octave down (Depth).
    const octave = amp(ctx, k.shimmer * 0.6);
    const high = osc(sh, 'sawtooth', f * 2, spread(k) * 0.5);
    vibs[1].connect(high.detune);
    high.connect(octave).connect(lp);
    const low = amp(ctx, k.depth * 0.7);
    osc(sh, 'triangle', subOf(f)).connect(low).connect(lp);
    // Bow noise.
    const bowBp = bq(ctx, 'bandpass', 2400 + k.tone * 2000, 1.2);
    const bow = amp(ctx, k.air * 0.12);
    noise(sh).connect(bowBp).connect(bow).connect(sh.input);
    return voiceOf(sh, () => 1.2 + k.swell * 5, (kk, at) => {
      glide(lp.frequency, cut(kk), at, 0.15);
      glide(breathe.frequency, 0.05 + kk.motion * 0.2, at);
      glide(breatheDepth.gain, kk.motion * 0.25 * cut(kk), at);
      for (const d of vibs) reglide(d.gain, vibCents(kk), at);
      glide(left.pan, -kk.width * 0.75, at);
      glide(right.pan, kk.width * 0.75, at);
      for (const { o, dir } of players) glide(o.detune, dir * spread(kk), at);
      glide(octave.gain, kk.shimmer * 0.6, at);
      glide(low.gain, kk.depth * 0.7, at);
      glide(bowBp.frequency, 2400 + kk.tone * 2000, at);
      glide(bow.gain, kk.air * 0.12, at);
    }, (kk) => { k = kk; });
  },
};

const glass: PadPatchDef = {
  id: 'glass-pad',
  name: 'Glass',
  blurb: 'A crystalline, bell-like pad that sparkles as it holds.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const sh = shell(pc, time, velocityGain(velocity) * 0.15, 0.08 + k.swell * 4.5);
    const lpCut = (kk: Knobs) => Math.min(16000, 2500 + kk.tone * 9000 + f * 2);
    const lp = bq(ctx, 'lowpass', lpCut(k), 0.5);
    lp.connect(sh.input);
    // Two sine carriers a few cents apart, one each side, frequency-modulated an octave up: Tone is the FM index.
    const index = (kk: Knobs) => (0.35 + kk.tone * 1.6) * f * 2;
    const cents = (kk: Knobs) => 0.8 + kk.detune * 9;
    const fm = amp(ctx, 0);
    fm.gain.setValueAtTime(index(k) * 2.5, time);
    fm.gain.setTargetAtTime(index(k), time + 0.01, 0.35 + k.swell * 1.2);
    osc(sh, 'sine', f * 2).connect(fm);
    // Unequal, so that summed to mono they sway rather than cancel.
    const louder = Math.random() < 0.5 ? -1 : 1;
    const sides = [-1, 1].map((dir) => {
      const c = osc(sh, 'sine', f, dir * cents(k));
      fm.connect(c.frequency);
      const p = panner(ctx, dir * k.width * 0.75);
      c.connect(amp(ctx, dir === louder ? 1 : 0.55)).connect(p).connect(lp);
      return { c, p, dir };
    });
    // Motion slowly breathes the index.
    const sway = lfo(sh, 0.06 + k.motion * 0.3);
    const swayDepth = modTo(ctx, sway, fm.gain, index(k) * 0.6 * k.motion);
    // The bell: an inharmonic FM pair high up, twinkling (Shimmer).
    const bellIndex = (kk: Knobs) => f * 3 * 0.6 * (0.3 + kk.tone);
    const bellFm = amp(ctx, bellIndex(k));
    osc(sh, 'sine', f * 3 * Math.SQRT2).connect(bellFm);
    const bell = osc(sh, 'sine', f * 3, -2);
    bellFm.connect(bell.frequency);
    const sparkle = amp(ctx, k.shimmer * 0.4);
    bell.connect(sparkle).connect(lp);
    const twinkle = lfo(sh, 2 + k.motion * 5);
    const twinkleDepth = modTo(ctx, twinkle, sparkle.gain, k.shimmer * 0.28);
    // Body below, a breath of air above.
    const sub = amp(ctx, k.depth * 0.3);
    osc(sh, 'sine', subOf(f)).connect(sub).connect(sh.input);
    const air = amp(ctx, k.air * 0.05);
    noise(sh).connect(bq(ctx, 'highpass', 7000, 0.6)).connect(air).connect(sh.input);
    return voiceOf(sh, () => 2 + k.swell * 6, (kk, at) => {
      glide(lp.frequency, lpCut(kk), at);
      reglide(fm.gain, index(kk), at);
      glide(swayDepth.gain, index(kk) * 0.6 * kk.motion, at);
      glide(sway.frequency, 0.06 + kk.motion * 0.3, at);
      glide(bellFm.gain, bellIndex(kk), at);
      glide(sparkle.gain, kk.shimmer * 0.4, at);
      glide(twinkleDepth.gain, kk.shimmer * 0.28, at);
      glide(twinkle.frequency, 2 + kk.motion * 5, at);
      for (const { c, p, dir } of sides) {
        glide(c.detune, dir * cents(kk), at);
        glide(p.pan, dir * kk.width * 0.75, at);
      }
      glide(sub.gain, kk.depth * 0.3, at);
      glide(air.gain, kk.air * 0.05, at);
    }, (kk) => { k = kk; });
  },
};

const shimmer: PadPatchDef = {
  id: 'shimmer',
  name: 'Shimmer',
  blurb: 'An ethereal halo of octaves above the note, with an airy wash.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const sh = shell(pc, time, velocityGain(velocity) * 0.3, 0.6 + k.swell * 6);
    const lpCut = (kk: Knobs) => Math.min(18000, 250 + Math.pow(kk.tone, 1.2) * 5000 + f * 2);
    const lp = bq(ctx, 'lowpass', lpCut(k), 0.7);
    lp.connect(sh.input);
    const sway = lfo(sh, 0.04 + k.motion * 0.2);
    const swayDepth = modTo(ctx, sway, lp.frequency, lpCut(k) * 0.35 * k.motion);
    // The halo: stacked octaves twice over, a fraction of a hertz apart so they shimmer, spread across the field; and the fifth above the octave.
    const beat = (kk: Knobs) => 0.12 + kk.motion * 1.1;
    const cents = (kk: Knobs) => 2 + kk.detune * 14;
    const upper = (kk: Knobs) => 0.14 + kk.shimmer * 0.4;
    const halo = [-1, 1].map((dir) => {
      const g = amp(ctx, upper(k));
      const p = panner(ctx, dir * k.width * 0.7);
      g.connect(p).connect(lp);
      const oct = osc(sh, octaveWave(ctx), f * 2 + (dir * beat(k)) / 2, dir * cents(k));
      const fifth = osc(sh, 'sine', f * 3 - (dir * beat(k)) / 3, -dir * cents(k) * 0.7);
      oct.connect(g);
      fifth.connect(amp(ctx, 0.35)).connect(g);
      return { g, p, oct, fifth, dir };
    });
    // The note itself, soft, and the sub.
    osc(sh, 'triangle', f).connect(amp(ctx, 0.3)).connect(sh.input);
    const sub = amp(ctx, k.depth * 0.3);
    osc(sh, 'sine', subOf(f)).connect(sub).connect(sh.input);
    // The airy wash, pitched up high around the halo.
    const washBp = bq(ctx, 'bandpass', Math.min(9000, Math.max(2500, f * 8)), 1.2);
    const wash = amp(ctx, k.air * 0.3);
    noise(sh).connect(washBp).connect(wash).connect(sh.input);
    return voiceOf(sh, () => 2.5 + k.swell * 7, (kk, at) => {
      glide(lp.frequency, lpCut(kk), at);
      glide(sway.frequency, 0.04 + kk.motion * 0.2, at);
      glide(swayDepth.gain, lpCut(kk) * 0.35 * kk.motion, at);
      for (const h of halo) {
        glide(h.g.gain, upper(kk), at);
        glide(h.p.pan, h.dir * kk.width * 0.7, at);
        glide(h.oct.frequency, f * 2 + (h.dir * beat(kk)) / 2, at);
        glide(h.oct.detune, h.dir * cents(kk), at);
        glide(h.fifth.frequency, f * 3 - (h.dir * beat(kk)) / 3, at);
        glide(h.fifth.detune, -h.dir * cents(kk) * 0.7, at);
      }
      glide(sub.gain, kk.depth * 0.3, at);
      glide(wash.gain, kk.air * 0.3, at);
    }, (kk) => { k = kk; });
  },
};

const breath: PadPatchDef = {
  id: 'breath',
  name: 'Breath',
  blurb: 'Pitched wind: breath blown through the note and its harmonics.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const nyq = ctx.sampleRate * 0.45;
    const sh = shell(pc, time, velocityGain(velocity) * 0.5, 0.3 + k.swell * 5);
    // Each band is the same width in hertz, so every harmonic carries the same energy; Air widens them (breathier, less pitched).
    const width = (kk: Knobs) => 1.5 + kk.air * 10;
    const makeup = (kk: Knobs) => 16 / Math.sqrt(width(kk));
    const cut = (kk: Knobs) => Math.min(16000, 120 + Math.pow(kk.tone, 1.3) * 3000 + f * 0.8);
    const lp = bq(ctx, 'lowpass', cut(k), 0.9);
    const level = amp(ctx, makeup(k));
    lp.connect(level).connect(sh.input);
    // Flutter: the breath wavers.
    const flutter = lfo(sh, 0.15 + k.motion * 0.6);
    const flutterDepth = modTo(ctx, flutter, level.gain, makeup(k) * k.motion * 0.35);
    // Left and right breathe through harmonics 1-3, detuned apart; the 4th and 6th sparkle on top.
    const ratio = (kk: Knobs, dir: number) => Math.pow(2, (dir * kk.detune * 14) / 1200);
    const bands: Array<{ bp: BiquadFilterNode; h: number; dir: number }> = [];
    const band = (src: AudioNode, h: number, dir: number, to: AudioNode) => {
      const fc = Math.min(nyq, f * h * ratio(k, dir));
      const bp = bq(ctx, 'bandpass', fc, Math.max(1, Math.min(400, fc / width(k))));
      src.connect(bp).connect(to);
      bands.push({ bp, h, dir });
    };
    const sparkle = amp(ctx, k.shimmer * 0.9);
    sparkle.connect(lp);
    const sides = [-1, 1].map((dir) => {
      const p = panner(ctx, dir * k.width * 0.8);
      p.connect(lp);
      const n = noise(sh);
      for (const h of [1, 2, 3]) band(n, h, dir, p);
      band(n, dir < 0 ? 4 : 6, dir, sparkle);
      return { p, dir };
    });
    // Unpitched breath, and a soft sub under it all.
    const airBp = bq(ctx, 'bandpass', Math.min(6000, f * 2.5), 0.8);
    const air = amp(ctx, k.air * 0.5);
    noise(sh).connect(airBp).connect(air).connect(sh.input);
    const sub = amp(ctx, k.depth * 0.12);
    osc(sh, 'sine', subOf(f)).connect(sub).connect(sh.input);
    return voiceOf(sh, () => 1 + k.swell * 5, (kk, at) => {
      glide(lp.frequency, cut(kk), at);
      reglide(level.gain, makeup(kk), at);
      glide(flutterDepth.gain, makeup(kk) * kk.motion * 0.35, at);
      glide(flutter.frequency, 0.15 + kk.motion * 0.6, at);
      for (const { bp, h, dir } of bands) {
        const fc = Math.min(nyq, f * h * ratio(kk, dir));
        glide(bp.frequency, fc, at);
        glide(bp.Q, Math.max(1, Math.min(400, fc / width(kk))), at);
      }
      for (const { p, dir } of sides) glide(p.pan, dir * kk.width * 0.8, at);
      glide(sparkle.gain, kk.shimmer * 0.9, at);
      glide(air.gain, kk.air * 0.5, at);
      glide(sub.gain, kk.depth * 0.12, at);
    }, (kk) => { k = kk; });
  },
};

const organ: PadPatchDef = {
  id: 'organ',
  name: 'Harmonium',
  blurb: 'A warm reed organ, its two ranks gently beating against each other.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const reed = reedWave(ctx);
    const sh = shell(pc, time, velocityGain(velocity) * 0.17, 0.05 + k.swell * 3.5);
    const cut = (kk: Knobs) => Math.min(16000, 500 + Math.pow(kk.tone, 1.5) * 7000 + f * 2);
    const lp = bq(ctx, 'lowpass', cut(k), 0.7);
    // The bellows: the level sways with Motion.
    const bellows = amp(ctx, 1);
    lp.connect(bellows).connect(sh.input);
    const pump = lfo(sh, 0.15 + k.motion * 0.45);
    const pumpDepth = modTo(ctx, pump, bellows.gain, k.motion * 0.12);
    // Two ranks a few cents apart (the beating), one each side.
    const celeste = (kk: Knobs) => 2 + kk.detune * 14;
    const ranks = [-1, 1].map((dir) => {
      const o = osc(sh, reed, f, (dir * celeste(k)) / 2);
      const p = panner(ctx, dir * k.width * 0.6);
      o.connect(p).connect(lp);
      return { o, p, dir };
    });
    // The 4' stop an octave up (Shimmer) and the 16' an octave down (Depth).
    const octave = amp(ctx, k.shimmer * 0.5);
    osc(sh, reed, f * 2, 1).connect(octave).connect(lp);
    const bass = amp(ctx, k.depth * 0.8);
    osc(sh, reed, subOf(f)).connect(bass).connect(lp);
    // Wind in the reeds.
    const windBp = bq(ctx, 'bandpass', 1500 + k.tone * 1500, 0.8);
    const wind = amp(ctx, k.air * 0.5);
    noise(sh).connect(windBp).connect(wind).connect(bellows);
    return voiceOf(sh, () => 0.4 + k.swell * 4, (kk, at) => {
      glide(lp.frequency, cut(kk), at, 0.15);
      glide(pump.frequency, 0.15 + kk.motion * 0.45, at);
      glide(pumpDepth.gain, kk.motion * 0.12, at);
      for (const { o, p, dir } of ranks) {
        glide(o.detune, (dir * celeste(kk)) / 2, at);
        glide(p.pan, dir * kk.width * 0.6, at);
      }
      glide(octave.gain, kk.shimmer * 0.5, at);
      glide(bass.gain, kk.depth * 0.8, at);
      glide(windBp.frequency, 1500 + kk.tone * 1500, at);
      glide(wind.gain, kk.air * 0.5, at);
    }, (kk) => { k = kk; });
  },
};

const dark: PadPatchDef = {
  id: 'dark',
  name: 'Dark matter',
  blurb: 'A deep sub and a slow, growling rumble, made for the big screen.',
  voice(pc, note, velocity, time) {
    const ctx = pc.ctx;
    let k = knobs(pc.params);
    const f = midiToHz(note);
    const sh = shell(pc, time, velocityGain(velocity) * 0.27, 0.6 + k.swell * 7);
    // The sub.
    const sub = amp(ctx, 0.08 + k.depth * 0.4);
    osc(sh, 'sine', subOf(f)).connect(sub).connect(sh.input);
    // The growl: two saws through a resonant lowpass that crawls open and shut, gently overdriven.
    const cut = (kk: Knobs) => 80 + Math.pow(kk.tone, 1.5) * 1400 + f * 0.5;
    const lp = bq(ctx, 'lowpass', cut(k), 3);
    const drive = amp(ctx, 0.5);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softCurve(2.5);
    shaper.oversample = '2x';
    const body = amp(ctx, 0.5);
    lp.connect(drive).connect(shaper).connect(bq(ctx, 'highpass', 22, 0.7)).connect(body).connect(sh.input);
    const crawl = lfo(sh, 0.02 + k.motion * 0.1);
    const crawlDepth = modTo(ctx, crawl, lp.frequency, k.motion * cut(k) * 0.7);
    const cents = (kk: Knobs) => 4 + kk.detune * 20;
    const saws = [-1, 1].map((dir) => {
      const o = osc(sh, 'sawtooth', f, dir * cents(k));
      const p = panner(ctx, dir * k.width * 0.8);
      o.connect(p).connect(lp);
      return { o, p, dir };
    });
    // Rumble (Air): filtered noise, swelling with the crawl.
    const rumbleLp = bq(ctx, 'bandpass', 60 + k.tone * 250, 0.6);
    const rumble = amp(ctx, k.air * 1.2);
    noise(sh).connect(rumbleLp).connect(rumble).connect(sh.input);
    const rumbleSway = modTo(ctx, crawl, rumble.gain, k.air * 0.6 * k.motion);
    // A ghostly glint high above (Shimmer).
    const glint = amp(ctx, k.shimmer * 0.045);
    osc(sh, 'sine', f * 4, -7).connect(glint);
    osc(sh, 'sine', f * 6, 5).connect(glint);
    glint.connect(sh.input);
    return voiceOf(sh, () => 2 + k.swell * 7, (kk, at) => {
      glide(sub.gain, 0.08 + kk.depth * 0.4, at);
      glide(lp.frequency, cut(kk), at, 0.15);
      glide(crawl.frequency, 0.02 + kk.motion * 0.1, at);
      glide(crawlDepth.gain, kk.motion * cut(kk) * 0.7, at);
      for (const { o, p, dir } of saws) {
        glide(o.detune, dir * cents(kk), at);
        glide(p.pan, dir * kk.width * 0.8, at);
      }
      glide(rumbleLp.frequency, 60 + kk.tone * 250, at);
      glide(rumble.gain, kk.air * 1.2, at);
      glide(rumbleSway.gain, kk.air * 0.6 * kk.motion, at);
      glide(glint.gain, kk.shimmer * 0.045, at);
    }, (kk) => { k = kk; });
  },
};

export const PAD_PATCHES: PadPatchDef[] = [warm, choir, strings, glass, shimmer, breath, organ, dark];
