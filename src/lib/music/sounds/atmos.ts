/**
 * Atmospheres: textures that play until they are pressed again.
 *
 * Each one is built from sources that never run out, so it can play for as
 * long as the set does with no timers: long noise loops, slow random control
 * curves (smooth random values baked once and played back very slowly into
 * AudioParams), and buffers with their events (drops, clicks, chirps,
 * bubbles) baked in, looped at unrelated lengths and rates so the layers
 * never line up the same way twice.
 *
 * Knobs: Size is density and intensity, Tone dark to bright, Tail how slowly
 * the texture moves and how gently it comes in.
 */
import { beatSeconds, holdAt, midiToHz, releaseAfter, softCurve, velocityGain, type SoundContext, type SoundDef, type SoundHandle } from './kit';

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0.5);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

// ── Baked material, made once per audio context ─────────────────────────

const bakedByCtx = new WeakMap<BaseAudioContext, Map<string, AudioBuffer>>();

function bake(ctx: BaseAudioContext, key: string, make: () => AudioBuffer): AudioBuffer {
  let store = bakedByCtx.get(ctx);
  if (!store) {
    store = new Map();
    bakedByCtx.set(ctx, store);
  }
  let buffer = store.get(key);
  if (!buffer) {
    buffer = make();
    store.set(key, buffer);
  }
  return buffer;
}

/** Add into a looping buffer, wrapping past the end. */
function put(d: Float32Array, i: number, v: number): void {
  d[((i % d.length) + d.length) % d.length] += v;
}

/** Remove any offset and scale every channel together to `peak`. */
function normalise(buffer: AudioBuffer, peak: number): AudioBuffer {
  let max = 0;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    let mean = 0;
    for (let i = 0; i < d.length; i++) mean += d[i];
    mean /= d.length;
    for (let i = 0; i < d.length; i++) {
      d[i] -= mean;
      max = Math.max(max, Math.abs(d[i]));
    }
  }
  if (max > 0) {
    const k = peak / max;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= k;
    }
  }
  return buffer;
}

function noiseBuffer(ctx: BaseAudioContext, seconds: number, rate: number): AudioBuffer {
  const b = ctx.createBuffer(2, Math.round(seconds * rate), rate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return b;
}

/** Stereo white noise, long enough that the loop is never heard. */
const hiNoise = (ctx: BaseAudioContext) => bake(ctx, 'noise-hi', () => noiseBuffer(ctx, 6.17, ctx.sampleRate));
/** Stereo noise at a low sample rate (content below 4 kHz): a long loop for the low layers. */
const loNoise = (ctx: BaseAudioContext) => bake(ctx, 'noise-lo', () => noiseBuffer(ctx, 23.3, 8000));

// Control curves: 256 random points with smooth steps between them, 64
// samples a step at 8 kHz, played back slowly into AudioParams.
const MOD_RATE = 8000;
const MOD_STEP = 64;
type CurveShape = 'smooth' | 'gust' | 'sparse';

function curveBuffer(ctx: BaseAudioContext, shape: CurveShape): AudioBuffer {
  return bake(ctx, `curve-${shape}`, () => {
    const points = 256;
    const values: number[] = [];
    for (let i = 0; i < points; i++) {
      const u = Math.random();
      // smooth: -1..1 evenly. gust: -1..1, mostly low with a few strong peaks. sparse: 0 most of the time, now and then up to 1.
      values.push(shape === 'smooth' ? u * 2 - 1 : shape === 'gust' ? Math.pow(u, 1.8) * 2 - 1 : Math.pow(Math.max(0, (u - 0.55) / 0.45), 1.3));
    }
    const b = ctx.createBuffer(1, points * MOD_STEP, MOD_RATE);
    const d = b.getChannelData(0);
    for (let p = 0; p < points; p++) {
      const a = values[p];
      const z = values[(p + 1) % points];
      for (let j = 0; j < MOD_STEP; j++) d[p * MOD_STEP + j] = a + (z - a) * (1 - Math.cos((Math.PI * j) / MOD_STEP)) / 2;
    }
    return b;
  });
}

// ── The loop's frame: fade in, play, fade out on stop ───────────────────

const DEFAULT_FADE = 1.5;
/** A fade from 1 to silence that sounds even: quick at first, gentle at the end. */
const FADE_CURVE = (() => {
  const c = new Float32Array(64);
  for (let i = 0; i < c.length; i++) {
    const x = i / (c.length - 1);
    c[i] = (1 - x) * Math.exp(-2.5 * x);
  }
  return c;
})();

interface Knobs {
  size: number;
  tail: number;
  tone: number;
  /** Time stretch for movement: 0.5 (tail 0, restless) to 1.5 (tail 1, slow). */
  slow: number;
}

function knobs(sc: SoundContext): Knobs {
  const tail = clamp01(sc.tail);
  return { size: clamp01(sc.size), tail, tone: clamp01(sc.tone), slow: 0.5 + tail };
}

interface Loop {
  ctx: BaseAudioContext;
  time: number;
  /** Layers mix in here. */
  bus: GainNode;
  /** Remember a started source so stop() ends it. */
  keep<T extends AudioScheduledSourceNode>(source: T): T;
  /** A slow random nudge (±3.5%) for buffer playback rates, so loops never line up the same way twice. */
  wobble?: GainNode;
  handle: SoundHandle;
}

function loop(sc: SoundContext, velocity: number, time: number, level: number, k: Knobs): Loop {
  const ctx = sc.ctx;
  const bus = ctx.createGain();
  const fadeIn = ctx.createGain();
  fadeIn.gain.value = 0;
  fadeIn.gain.setValueAtTime(0, time);
  fadeIn.gain.linearRampToValueAtTime(level * velocityGain(velocity), time + 0.5 + k.tail * 2.5);
  const fader = ctx.createGain();
  bus.connect(fadeIn).connect(fader).connect(sc.out);
  const sources: AudioScheduledSourceNode[] = [];
  let end = Infinity;
  return {
    ctx,
    time,
    bus,
    keep(source) {
      sources.push(source);
      return source;
    },
    handle: {
      duration: Infinity,
      stop(at, fade = DEFAULT_FADE) {
        const seconds = Math.max(0.02, Number.isFinite(fade) ? fade : DEFAULT_FADE);
        if (at + seconds >= end) return;
        if (end === Infinity) {
          fader.gain.setValueCurveAtTime(FADE_CURVE, at, seconds);
        } else {
          holdAt(fader.gain, at);
          fader.gain.linearRampToValueAtTime(0, at + seconds);
        }
        end = at + seconds;
        for (const s of sources) {
          try { s.stop(end + 0.02); } catch { /* already stopped */ }
        }
        releaseAfter(sc, fader, end + 0.1);
      },
    },
  };
}

// ── Small graph helpers ─────────────────────────────────────────────────

function bq(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

function amp(ctx: BaseAudioContext, value: number): GainNode {
  const g = ctx.createGain();
  g.gain.value = value;
  return g;
}

/** A looping buffer started at a random point. */
function play(L: Loop, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = L.ctx.createBufferSource();
  s.buffer = buffer;
  s.loop = true;
  s.playbackRate.value = rate;
  s.start(L.time, Math.random() * buffer.duration);
  return L.keep(s);
}

/**
 * A looping noise or event buffer whose speed drifts a few percent at
 * random: inaudible as pitch, but the loop never repeats exactly.
 */
function drift(L: Loop, buffer: AudioBuffer, rate = 1): AudioBufferSourceNode {
  const s = play(L, buffer, rate);
  if (!L.wobble) L.wobble = modTo(L.ctx, curve(L, 'smooth', 1.3), s.playbackRate, 0.035);
  else L.wobble.connect(s.playbackRate);
  return s;
}

function osc(L: Loop, type: OscillatorType, freq: number, detune = 0): OscillatorNode {
  const o = L.ctx.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  o.detune.value = detune;
  o.start(L.time);
  return L.keep(o);
}

/** A slow random control signal, one new value about every `secondsPerPoint`. */
function curve(L: Loop, shape: CurveShape, secondsPerPoint: number): AudioBufferSourceNode {
  return play(L, curveBuffer(L.ctx, shape), (MOD_STEP / MOD_RATE / secondsPerPoint) * rand(0.9, 1.1));
}

/** Add `source` × `depth` onto `param`. */
function modTo(ctx: BaseAudioContext, source: AudioNode, param: AudioParam, depth: number, output = 0): GainNode {
  const g = amp(ctx, depth);
  source.connect(g, output);
  g.connect(param);
  return g;
}

// ── Baked events ────────────────────────────────────────────────────────

/** Rain drops: taps of noise, some with a tiny bubble ringing upward. */
function dropBuffer(ctx: BaseAudioContext): AudioBuffer {
  return bake(ctx, 'drops', () => {
    const sr = ctx.sampleRate;
    const seconds = 7.31;
    const b = ctx.createBuffer(2, Math.round(seconds * sr), sr);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    for (let e = 0, n = Math.round(seconds * 40); e < n; e++) {
      const at = Math.floor(Math.random() * l.length);
      const a = 0.06 + 0.94 * Math.pow(Math.random(), 3);
      const p = (Math.random() * Math.PI) / 2;
      const gl = Math.cos(p) * a;
      const gr = Math.sin(p) * a;
      const tau = rand(0.0002, 0.001) * sr;
      for (let i = 0; i < tau * 6; i++) {
        const v = (Math.random() * 2 - 1) * Math.exp(-i / tau);
        put(l, at + i, v * gl);
        put(r, at + i, v * gr);
      }
      if (Math.random() < 0.35) {
        const f0 = rand(1300, 4200);
        const rise = rand(0.15, 0.5);
        const ring = rand(0.003, 0.012) * sr;
        const len = ring * 6;
        let ph = 0;
        for (let i = 0; i < len; i++) {
          ph += (2 * Math.PI * f0 * (1 + (rise * i) / len)) / sr;
          const v = Math.sin(ph) * Math.exp(-i / ring) * 0.7 * (1 - Math.exp(-i / (0.0004 * sr)));
          put(l, at + i, v * gl);
          put(r, at + i, v * gr);
        }
      }
    }
    return normalise(b, 0.9);
  });
}

/** A struck two-pole resonance (Hz, decay in seconds), excited by a short noisy tap, added at `at`. */
function ring(l: Float32Array, r: Float32Array, sr: number, at: number, freq: number, tau: number, a: number, pan: number): void {
  const rr = Math.exp(-1 / (tau * sr));
  const w = (2 * Math.PI * Math.min(freq, sr * 0.45)) / sr;
  const c = 2 * rr * Math.cos(w);
  const r2 = rr * rr;
  const tap = Math.max(2, Math.round(0.00015 * sr));
  const norm = Math.sin(w) * a;
  const gl = Math.cos((pan * Math.PI) / 2);
  const gr = Math.sin((pan * Math.PI) / 2);
  let y1 = 0;
  let y2 = 0;
  for (let i = 0, n = Math.ceil(tau * sr * 7); i < n; i++) {
    const x = i < tap ? (Math.random() * 2 - 1) * norm * (1 - i / tap) : 0;
    const y = c * y1 - r2 * y2 + x;
    y2 = y1;
    y1 = y;
    put(l, at + i, y * gl);
    put(r, at + i, y * gr);
  }
}

/** Record surface: many tiny ticks, some pops. */
function crackleBuffer(ctx: BaseAudioContext): AudioBuffer {
  return bake(ctx, 'crackle', () => {
    const sr = ctx.sampleRate;
    const seconds = 5.83;
    const b = ctx.createBuffer(2, Math.round(seconds * sr), sr);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    for (let e = 0, n = Math.round(seconds * 32); e < n; e++) {
      const at = Math.floor(Math.random() * l.length);
      const a = (0.03 + 0.97 * Math.pow(Math.random(), 4)) * (Math.random() < 0.5 ? -1 : 1);
      const tau = rand(0.00004, 0.0003) * sr;
      const sl = rand(0.75, 1);
      const sr2 = rand(0.75, 1);
      for (let i = 0; i < tau * 6 + 1; i++) {
        const v = (i === 0 ? a : a * 0.6 * (Math.random() * 2 - 1)) * Math.exp(-i / tau);
        put(l, at + i, v * sl);
        put(r, at + i, v * sr2);
      }
    }
    for (let e = 0, n = Math.round(seconds * 2.5); e < n; e++) {
      ring(l, r, sr, Math.floor(Math.random() * l.length), rand(500, 2600), rand(0.0004, 0.0016), rand(0.3, 1) * 6, rand(0.35, 0.65));
    }
    return normalise(b, 0.9);
  });
}

/** One turn of a record at 33⅓: a faint scratch that comes round every 1.8 s. */
function turnBuffer(ctx: BaseAudioContext): AudioBuffer {
  return bake(ctx, 'turn', () => {
    const sr = ctx.sampleRate;
    const b = ctx.createBuffer(2, Math.round(1.8 * sr), sr);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    const at = Math.round(0.4 * sr);
    ring(l, r, sr, at, 900, 0.0012, 5, 0.5);
    ring(l, r, sr, at + Math.round(0.003 * sr), 1700, 0.0006, 3, 0.45);
    return normalise(b, 0.7);
  });
}

/** Fire: crackles in little clusters, and now and then a woody snap. */
function fireBuffer(ctx: BaseAudioContext): AudioBuffer {
  return bake(ctx, 'fire', () => {
    const sr = ctx.sampleRate;
    const seconds = 6.73;
    const b = ctx.createBuffer(2, Math.round(seconds * sr), sr);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    for (let c = 0, n = Math.round(seconds * 2.4); c < n; c++) {
      const t0 = Math.floor(Math.random() * l.length);
      const pan = Math.random();
      const big = 0.25 + 0.75 * Math.pow(Math.random(), 1.5);
      const count = 1 + Math.floor(Math.pow(Math.random(), 2) * 9);
      for (let i = 0; i < count; i++) {
        const at = t0 + Math.floor(Math.random() * 0.03 * Math.sqrt(count) * sr);
        ring(l, r, sr, at, rand(1500, 6000), rand(0.0002, 0.0012), big * (0.15 + 0.85 * Math.pow(Math.random(), 2)) * 4, Math.min(1, Math.max(0, pan + rand(-0.15, 0.15))));
      }
    }
    for (let e = 0, n = Math.round(seconds * 0.6); e < n; e++) {
      ring(l, r, sr, Math.floor(Math.random() * l.length), rand(400, 1300), rand(0.002, 0.006), rand(0.6, 1) * 3, Math.random());
    }
    return normalise(b, 0.9);
  });
}

/** Bubbles: little streams of blips rising in pitch, at 22 kHz (they live below 3 kHz). */
function bubbleBuffer(ctx: BaseAudioContext): AudioBuffer {
  return bake(ctx, 'bubbles', () => {
    const sr = 22050;
    const seconds = 8.17;
    const b = ctx.createBuffer(2, Math.round(seconds * sr), sr);
    const l = b.getChannelData(0);
    const r = b.getChannelData(1);
    const bubble = (at: number, f0: number, tau: number, a: number, pan: number) => {
      const n = Math.ceil(tau * 6 * sr);
      const gl = Math.cos((pan * Math.PI) / 2) * a;
      const gr = Math.sin((pan * Math.PI) / 2) * a;
      let ph = 0;
      for (let i = 0; i < n; i++) {
        const t = i / sr;
        ph += (2 * Math.PI * f0 * (1 + (0.5 * i) / n)) / sr;
        const v = Math.sin(ph) * Math.exp(-t / tau) * (1 - Math.exp(-t / 0.0015));
        put(l, at + i, v * gl);
        put(r, at + i, v * gr);
      }
    };
    for (let s = 0, n = Math.round(seconds * 1.1); s < n; s++) {
      let at = Math.floor(Math.random() * l.length);
      let f = rand(200, 900);
      const pan = Math.random();
      const count = 1 + Math.floor(Math.pow(Math.random(), 1.5) * 7);
      const a = rand(0.4, 1);
      for (let i = 0; i < count; i++) {
        bubble(at, f, rand(0.015, 0.05), a * rand(0.5, 1), Math.min(1, Math.max(0, pan + rand(-0.1, 0.1))));
        at += Math.floor(rand(0.04, 0.17) * sr);
        f *= rand(1.04, 1.14);
      }
    }
    for (let s = 0, n = Math.round(seconds * 1.4); s < n; s++) {
      bubble(Math.floor(Math.random() * l.length), rand(300, 1400), rand(0.01, 0.03), rand(0.15, 0.5), Math.random());
    }
    return normalise(b, 0.9);
  });
}

// Ocean: two control channels (the swell of a wave and the wash after it
// breaks), 500 values a second of ocean time, played at 1/16 speed.
const WAVE_PER_SEC = 500;

function waveBuffer(ctx: BaseAudioContext): AudioBuffer {
  return bake(ctx, 'waves', () => {
    const periods: number[] = [];
    let total = 0;
    while (total < 115) {
      const p = rand(6, 12);
      periods.push(p);
      total += p;
    }
    const n = Math.round(total * WAVE_PER_SEC);
    const b = ctx.createBuffer(2, n, MOD_RATE);
    const swell = b.getChannelData(0);
    const wash = b.getChannelData(1);
    let t0 = 0;
    for (const p of periods) {
      const a = rand(0.45, 1);
      const rise = p * rand(0.38, 0.55);
      const fall = p * rand(0.18, 0.28);
      const recede = p * rand(0.28, 0.42);
      const s0 = Math.round(t0 * WAVE_PER_SEC);
      for (let i = 0, len = Math.round((rise + fall * 6) * WAVE_PER_SEC); i < len; i++) {
        const t = i / WAVE_PER_SEC;
        put(swell, s0 + i, a * (t < rise ? Math.pow(Math.sin(((Math.PI / 2) * t) / rise), 2) : Math.exp(-(t - rise) / fall)));
      }
      const w0 = s0 + Math.round((rise - 0.25) * WAVE_PER_SEC);
      const att = 0.6;
      for (let i = 0, len = Math.round((att + recede * 6) * WAVE_PER_SEC); i < len; i++) {
        const t = i / WAVE_PER_SEC;
        put(wash, w0 + i, a * (t < att ? Math.pow(Math.sin(((Math.PI / 2) * t) / att), 2) : Math.exp(-(t - att) / recede)));
      }
      t0 += p;
    }
    for (const d of [swell, wash]) {
      let max = 0;
      for (let i = 0; i < d.length; i++) max = Math.max(max, d[i]);
      for (let i = 0; i < d.length; i++) d[i] /= max || 1;
    }
    return b;
  });
}

// Crickets: each one's chirp pattern as an envelope (0..1), 2000 values a
// second, played at quarter speed into the gain of its tone. Long patterns
// with pauses at random, so no one cricket is heard repeating itself.
const CHIRP_PER_SEC = 2000;

function cricketBuffer(ctx: BaseAudioContext, which: number): AudioBuffer {
  return bake(ctx, `cricket-${which}`, () => {
    const seconds = [23.9, 29.3, 31.7, 37.1][which % 4];
    const b = ctx.createBuffer(1, Math.round(seconds * CHIRP_PER_SEC), MOD_RATE);
    const d = b.getChannelData(0);
    const pulseRate = rand(24, 38);
    const pulses = 2 + Math.floor(Math.random() * 3);
    const every = rand(0.38, 0.95);
    const width = Math.round((0.6 / pulseRate) * CHIRP_PER_SEC);
    let t = Math.random() * every;
    while (t < seconds) {
      if (Math.random() < 0.07) {
        t += rand(1, 3.5);
        continue;
      }
      const a = rand(0.7, 1);
      for (let p = 0; p < pulses; p++) {
        const s = Math.round((t + p / pulseRate) * CHIRP_PER_SEC);
        const pa = a * (p === 0 ? 0.75 : rand(0.85, 1));
        for (let j = 0; j < width; j++) put(d, s + j, pa * Math.pow(Math.sin((Math.PI * j) / width), 2));
      }
      t += every * rand(0.9, 1.1);
    }
    for (let i = 0; i < d.length; i++) d[i] = Math.min(1, d[i]);
    return b;
  });
}

/** Four heartbeats (each a lub and a softer dub), slightly different, one every `period` seconds. */
function heartBuffer(ctx: BaseAudioContext, period: number, tail: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const loopLen = 4 * period * sr;
  const b = ctx.createBuffer(1, Math.ceil(loopLen) + 2, sr);
  const d = b.getChannelData(0);
  const decay = 0.06 + tail * 0.09;
  const gap = Math.min(0.36, Math.max(0.24, 0.17 + period * 0.12));
  const thump = (t0: number, fHi: number, fLo: number, tau: number, a: number) => {
    const n = Math.ceil(tau * 7 * sr);
    let ph = 0;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const f = fLo + (fHi - fLo) * Math.exp(-t / 0.035);
      ph += (2 * Math.PI * f) / sr;
      const env = (1 - Math.exp(-t / 0.005)) * Math.exp(-t / tau);
      lp += 0.2 * ((Math.random() * 2 - 1) - lp);
      const click = lp * Math.exp(-t / 0.012) * 1.2;
      const v = a * (env * (Math.sin(ph) + 0.3 * Math.sin(2 * ph)) + click);
      d[Math.floor((t0 * sr + i) % loopLen)] += v;
    }
  };
  for (let k = 0; k < 4; k++) {
    const a = rand(0.88, 1);
    const p = rand(0.97, 1.03);
    thump(k * period + HEART_LUB, 70 * p, 42 * p, decay, a);
    thump(k * period + HEART_LUB + gap, 90 * p, 54 * p, decay * 0.8, a * 0.62);
  }
  return normalise(b, 0.9);
}
/** Where each lub sits inside its period. */
const HEART_LUB = 0.02;

/** A note's pitch folded by octaves into [lo, lo·2). */
function fold(freq: number, lo: number): number {
  let f = freq;
  while (f >= lo * 2) f /= 2;
  while (f < lo) f *= 2;
  return f;
}

// ── The atmospheres ─────────────────────────────────────────────────────

const atmos = (id: string, name: string, blurb: string, build: (sc: SoundContext, L: Loop, k: Knobs) => void, level: number): SoundDef => ({
  id,
  name,
  category: 'atmos',
  kind: 'loop',
  pitched: false,
  blurb,
  play(sc, _note, velocity, time) {
    const k = knobs(sc);
    const L = loop(sc, velocity, time, level, k);
    build(sc, L, k);
    return L.handle;
  },
});

export const ATMOS_SOUNDS: SoundDef[] = [
  atmos('rain', 'Rain', 'Steady rain with drops pattering close by.', (sc, L, k) => {
    const ctx = sc.ctx;
    // The wash of rain, rising and falling a little.
    const hiss = amp(ctx, 0.5 + 0.3 * k.size);
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'highpass', 350 + k.tone * 500, 0.5)).connect(bq(ctx, 'lowpass', 2200 + k.tone * k.tone * 10000, 0.5)).connect(hiss).connect(L.bus);
    modTo(ctx, curve(L, 'smooth', 2.6 * k.slow), hiss.gain, 0.12 + 0.1 * k.size);
    // Rain on the ground: soft and low.
    const ground = amp(ctx, 0.5 + 0.4 * k.size);
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 260 + k.tone * 400, 0.6)).connect(ground).connect(L.bus);
    modTo(ctx, curve(L, 'smooth', 3.7 * k.slow), ground.gain, 0.15);
    // Drops close by: the baked drops twice over, at unrelated speeds.
    const drops = bq(ctx, 'highpass', 400, 0.6);
    drops.connect(bq(ctx, 'lowpass', 3500 + k.tone * 12000, 0.5)).connect(amp(ctx, 0.3 + 0.3 * k.size)).connect(L.bus);
    drift(L, dropBuffer(ctx), 1).connect(drops);
    drift(L, dropBuffer(ctx), 0.917).connect(amp(ctx, 0.2 + 0.8 * k.size)).connect(drops);
  }, 0.25),

  atmos('wind', 'Wind', 'Gusting wind that whistles as it rises.', (sc, L, k) => {
    const ctx = sc.ctx;
    const gust = curve(L, 'gust', 2.4 * k.slow);
    // The body of the wind: opens up and swells with each gust.
    const bodyLp = bq(ctx, 'lowpass', 380 + k.tone * 900, 0.6);
    const body = amp(ctx, 0.55);
    drift(L, loNoise(ctx)).connect(bodyLp).connect(body).connect(L.bus);
    modTo(ctx, gust, body.gain, 0.33);
    modTo(ctx, gust, bodyLp.frequency, 260 + k.tone * 420);
    // Two whistles: narrow bands sweeping with the gusts and drifting on their own.
    const w1 = bq(ctx, 'bandpass', 650 + k.tone * 650, 10 + k.tone * 8);
    const w1g = amp(ctx, 1.5 + k.size * 0.8);
    drift(L, hiNoise(ctx)).connect(w1).connect(w1g).connect(L.bus);
    modTo(ctx, gust, w1.frequency, 260);
    modTo(ctx, curve(L, 'smooth', 3.1 * k.slow), w1.frequency, 170);
    modTo(ctx, gust, w1g.gain, 1.1 + k.size * 0.5);
    const w2 = bq(ctx, 'bandpass', 1500 + k.tone * 1300, 16 + k.tone * 10);
    const w2g = amp(ctx, 1 + k.size * 0.5);
    drift(L, hiNoise(ctx)).connect(w2).connect(w2g).connect(L.bus);
    modTo(ctx, curve(L, 'smooth', 1.7 * k.slow), w2.frequency, 420);
    modTo(ctx, gust, w2g.gain, 0.75 + k.size * 0.4);
    // Low buffeting under it all, stronger with Size.
    const rumble = amp(ctx, 0.3 + k.size * 0.5);
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 110, 0.7)).connect(rumble).connect(L.bus);
    modTo(ctx, gust, rumble.gain, 0.2 + k.size * 0.25);
  }, 0.28),

  atmos('ocean', 'Ocean', 'Waves breaking and washing back every few seconds.', (sc, L, k) => {
    const ctx = sc.ctx;
    const rate = (1 / 16) * (1.25 - 0.5 * k.tail);
    const waves = ctx.createChannelSplitter(2);
    play(L, waveBuffer(ctx), rate).connect(waves);
    const strength = 0.6 + 0.8 * k.size;
    // The wave itself: low surf that grows, brightens and breaks.
    const surfLp = bq(ctx, 'lowpass', 220 + k.tone * 200, 0.7);
    const surf = amp(ctx, 0.16);
    drift(L, loNoise(ctx)).connect(surfLp).connect(surf).connect(L.bus);
    modTo(ctx, waves, surfLp.frequency, 700 + k.tone * 1700, 0);
    modTo(ctx, waves, surf.gain, 0.75 * strength, 0);
    // The wash running back: bright fizz that fades slowly.
    const wash = amp(ctx, 0);
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'highpass', 900 + k.tone * 900, 0.5)).connect(bq(ctx, 'lowpass', 4500 + k.tone * 9000, 0.5)).connect(wash).connect(L.bus);
    modTo(ctx, waves, wash.gain, 0.32 * strength, 1);
    // Further out, another set of waves on their own clock.
    const far = ctx.createChannelSplitter(2);
    play(L, waveBuffer(ctx), rate * 0.79).connect(far);
    const farLp = bq(ctx, 'lowpass', 300, 0.7);
    const farGain = amp(ctx, 0.05);
    drift(L, loNoise(ctx)).connect(farLp).connect(farGain).connect(L.bus);
    modTo(ctx, far, farLp.frequency, 450 + k.tone * 500, 0);
    modTo(ctx, far, farGain.gain, 0.35 * strength, 0);
    // The undertow: a steady low bed.
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 85, 0.7)).connect(amp(ctx, 0.4 + 0.3 * k.size)).connect(L.bus);
  }, 0.3),

  atmos('crackle-loop', 'Vinyl crackle', 'The dusty surface of an old record going round.', (sc, L, k) => {
    const ctx = sc.ctx;
    // Ticks and pops, the baked surface twice over at unrelated speeds, plus the scratch that comes round each turn.
    const surface = bq(ctx, 'highpass', 150 + k.tone * 250, 0.6);
    surface.connect(bq(ctx, 'lowpass', 2200 + Math.pow(k.tone, 1.5) * 12000, 0.6)).connect(amp(ctx, 0.5)).connect(L.bus);
    drift(L, crackleBuffer(ctx), 1).connect(surface);
    drift(L, crackleBuffer(ctx), 0.877).connect(amp(ctx, k.size)).connect(surface);
    play(L, turnBuffer(ctx), 1).connect(amp(ctx, 0.25 + 0.35 * k.size)).connect(surface);
    // The quiet hiss of the groove.
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'highpass', 3000, 0.6)).connect(bq(ctx, 'lowpass', 5000 + k.tone * 9000, 0.6)).connect(amp(ctx, 0.022)).connect(L.bus);
    // Turntable rumble, wobbling once a turn.
    const rumble = amp(ctx, 0.12);
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 50, 0.7)).connect(rumble).connect(L.bus);
    modTo(ctx, osc(L, 'sine', 60 / 108), rumble.gain, 0.05);
  }, 0.9),

  atmos('night', 'Night', 'Crickets chirping softly in the dark.', (sc, L, k) => {
    const ctx = sc.ctx;
    const crickets = ctx.createGain();
    const pitch = 0.82 + k.tone * 0.32;
    crickets.connect(bq(ctx, 'lowpass', 5200 + k.tone * 9000, 0.5)).connect(L.bus);
    // A little space around them: a soft echo.
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.23;
    const loopBack = amp(ctx, 0.32);
    crickets.connect(echo).connect(bq(ctx, 'lowpass', 3500, 0.5)).connect(loopBack).connect(echo);
    echo.connect(amp(ctx, 0.35)).connect(L.bus);
    // Four crickets, each a tone gated by its own chirp pattern, the further ones quieter.
    const carriers = [4400, 4800, 3900, 5200];
    const levels = [0.3 + 0.2 * k.size, 0.25 + 0.2 * k.size, 0.04 + 0.4 * k.size, 0.02 + 0.32 * k.size];
    const nearer = curve(L, 'smooth', 6 * k.slow);
    carriers.forEach((f, i) => {
      const tone = osc(L, 'triangle', f * pitch * rand(0.97, 1.03));
      const gate = amp(ctx, 0);
      const pan = ctx.createStereoPanner();
      pan.pan.value = [-0.55, 0.5, 0.15, -0.2][i];
      tone.connect(gate).connect(pan).connect(crickets);
      const level = modTo(ctx, play(L, cricketBuffer(ctx, i), (CHIRP_PER_SEC / MOD_RATE) * rand(0.92, 1.08)), gate.gain, levels[i]);
      // The crickets take turns being the nearest one.
      modTo(ctx, nearer, level.gain, levels[i] * 0.4 * (i % 2 ? -1 : 1));
    });
    // A tree insect trilling now and then.
    const trill = amp(ctx, 0.5);
    const trillLevel = amp(ctx, 0);
    osc(L, 'sine', 2900 * pitch).connect(trill).connect(trillLevel).connect(crickets);
    modTo(ctx, osc(L, 'sine', rand(42, 52)), trill.gain, 0.5);
    modTo(ctx, curve(L, 'sparse', 3 * k.slow), trillLevel.gain, 0.02 + 0.18 * k.size);
    // The night air.
    const air = amp(ctx, 0.12);
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 300 + k.tone * 400, 0.5)).connect(air).connect(L.bus);
    modTo(ctx, curve(L, 'smooth', 4 * k.slow), air.gain, 0.05);
  }, 0.7),

  atmos('fire', 'Fire', 'A crackling fire with a low rumble.', (sc, L, k) => {
    const ctx = sc.ctx;
    const flicker = curve(L, 'smooth', 0.22 * k.slow);
    // The low roar of the flames, flickering.
    const rumble = amp(ctx, 0.75 + 0.35 * k.size);
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 130 + k.tone * 120, 0.8)).connect(rumble).connect(L.bus);
    modTo(ctx, flicker, rumble.gain, 0.25);
    modTo(ctx, curve(L, 'smooth', 1.6 * k.slow), rumble.gain, 0.2);
    const roar = amp(ctx, 0.06 + 0.04 * k.size);
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'bandpass', 700 + k.tone * 900, 0.7)).connect(roar).connect(L.bus);
    modTo(ctx, flicker, roar.gain, 0.04);
    // Crackles: the baked fire twice over at unrelated speeds.
    const crackle = bq(ctx, 'highpass', 250, 0.6);
    crackle.connect(bq(ctx, 'lowpass', 2500 + k.tone * 10000, 0.5)).connect(amp(ctx, 0.55)).connect(L.bus);
    drift(L, fireBuffer(ctx), 1).connect(crackle);
    drift(L, fireBuffer(ctx), 0.89).connect(amp(ctx, 0.15 + 0.85 * k.size)).connect(crackle);
    // Hissing sap, now and then.
    const hiss = amp(ctx, 0);
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'highpass', 4500, 0.6)).connect(hiss).connect(L.bus);
    modTo(ctx, curve(L, 'sparse', 0.7 * k.slow), hiss.gain, 0.05 + 0.03 * k.tone);
  }, 0.45),

  atmos('radio', 'Radio static', 'Static between stations, with faint tones drifting through.', (sc, L, k) => {
    const ctx = sc.ctx;
    const mix = ctx.createGain();
    mix.connect(bq(ctx, 'highpass', 180, 0.6)).connect(bq(ctx, 'lowpass', 2600 + Math.pow(k.tone, 1.3) * 9000, 0.6)).connect(L.bus);
    const tuning = curve(L, 'smooth', 4 * k.slow);
    // The static, its band wandering as if someone were turning the dial.
    const band = bq(ctx, 'bandpass', 1600 + k.tone * 900, 0.6);
    const fading = amp(ctx, 0.85);
    drift(L, hiNoise(ctx)).connect(band).connect(fading).connect(mix);
    modTo(ctx, tuning, band.frequency, 650);
    modTo(ctx, curve(L, 'smooth', 1.3 * k.slow), fading.gain, 0.3);
    // Crunchy bursts of interference.
    const bursts = amp(ctx, 0);
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'highpass', 1200, 0.6)).connect(bursts).connect(mix);
    modTo(ctx, curve(L, 'sparse', 0.07), bursts.gain, 0.3 + 0.4 * k.size);
    // Two heterodyne whistles sliding with the dial, fading in and out.
    const tones: Array<[OscillatorType, number, number, number]> = [['sine', 700 + k.tone * 600, 340, 0.09], ['triangle', 1900 + k.tone * 900, -480, 0.05]];
    for (const [type, f, sweep, level] of tones) {
      const o = osc(L, type, f);
      modTo(ctx, tuning, o.frequency, sweep);
      modTo(ctx, curve(L, 'smooth', 0.3), o.frequency, Math.abs(sweep) * 0.08);
      const g = amp(ctx, 0);
      o.connect(g).connect(mix);
      modTo(ctx, curve(L, 'sparse', 2.4 * k.slow), g.gain, level * (0.6 + 0.6 * k.size));
    }
    // A far-off broadcast murmuring under the noise.
    const murmur = amp(ctx, 0);
    const murmurLevel = amp(ctx, 0);
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'bandpass', 650, 1.4)).connect(murmur).connect(murmurLevel).connect(mix);
    modTo(ctx, curve(L, 'sparse', 0.11), murmur.gain, 1);
    modTo(ctx, curve(L, 'sparse', 3.3 * k.slow), murmurLevel.gain, 1.2);
  }, 0.24),

  atmos('underwater', 'Underwater', 'A deep, muffled rumble with bubbles rising.', (sc, L, k) => {
    const ctx = sc.ctx;
    // The deep pressure of the water, slowly moving.
    const rumble = amp(ctx, 0.9);
    drift(L, loNoise(ctx)).connect(bq(ctx, 'lowpass', 75 + k.tone * 60, 1)).connect(rumble).connect(L.bus);
    modTo(ctx, curve(L, 'smooth', 3 * k.slow), rumble.gain, 0.3);
    const midLp = bq(ctx, 'lowpass', 220 + k.tone * 300, 2);
    drift(L, loNoise(ctx)).connect(midLp).connect(amp(ctx, 0.22)).connect(L.bus);
    modTo(ctx, curve(L, 'smooth', 4.4 * k.slow), midLp.frequency, 120);
    // Bubbles, muffled, with a watery echo.
    const bubbles = bq(ctx, 'lowpass', 900 + k.tone * 2500, 0.8);
    const wet = amp(ctx, 0.4);
    bubbles.connect(wet).connect(L.bus);
    const echo = ctx.createDelay(1);
    echo.delayTime.value = 0.11;
    const loopBack = amp(ctx, 0.38);
    wet.connect(echo).connect(bq(ctx, 'lowpass', 1100, 0.6)).connect(loopBack).connect(echo);
    echo.connect(amp(ctx, 0.5)).connect(L.bus);
    drift(L, bubbleBuffer(ctx), 1).connect(bubbles);
    drift(L, bubbleBuffer(ctx), 0.82).connect(amp(ctx, 0.2 + 0.8 * k.size)).connect(bubbles);
  }, 0.5),

  {
    id: 'heartbeat',
    name: 'Heartbeat',
    category: 'atmos',
    kind: 'loop',
    pitched: false,
    blurb: 'A low lub-dub pulse locked to the tempo, felt more than heard.',
    play(sc, _note, velocity, time) {
      const k = knobs(sc);
      const L = loop(sc, velocity, time, 0.36, { ...k, tail: Math.min(k.tail, 0.2) });
      const ctx = sc.ctx;
      // One heartbeat every two beats; Size down low slows it to one a bar.
      const period = beatSeconds(sc) * (k.size < 0.34 ? 4 : 2);
      const s = ctx.createBufferSource();
      s.buffer = heartBuffer(ctx, period, k.tail);
      s.loop = true;
      s.loopStart = 0;
      s.loopEnd = 4 * period;
      // Land a lub on the next bar line when the studio knows where it is.
      const toBar = sc.toNextBar;
      const offset = toBar !== undefined && Number.isFinite(toBar) ? (((HEART_LUB - toBar) % (4 * period)) + 4 * period) % (4 * period) : 0;
      s.start(time, offset);
      L.keep(s);
      const body = bq(ctx, 'lowpass', 90 + k.tone * k.tone * 3000, 0.6);
      s.connect(bq(ctx, 'highpass', 25, 0.7)).connect(body).connect(L.bus);
      return L.handle;
    },
  },

  atmos('choir-breath', 'Choir breath', 'Breathy voices on the key, drifting between vowels.', (sc, L, k) => {
    const ctx = sc.ctx;
    const root = fold(midiToHz(sc.keyRoot), 110);
    const width = 0.6;
    // The voices: tenors on the root, altos an octave up, a quiet fifth between.
    const voices = ctx.createGain();
    const parts: Array<[number, number, number, number]> = [
      [1, -7, -width, 0.5], [1, 6, width, 0.5], [2, -5, width * 0.6, 0.35], [2, 4, -width * 0.6, 0.35], [1.5, 2, 0, 0.12 + 0.18 * k.size],
    ];
    const vibA = osc(L, 'sine', rand(4.4, 4.9));
    const vibB = osc(L, 'sine', rand(5.1, 5.6));
    parts.forEach(([ratio, cents, pan, level], i) => {
      const o = osc(L, 'sawtooth', root * ratio, cents);
      modTo(ctx, i % 2 ? vibB : vibA, o.detune, 9);
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      o.connect(amp(ctx, level)).connect(p).connect(voices);
    });
    // Breath through the same vowels: a choir whispering.
    drift(L, hiNoise(ctx)).connect(amp(ctx, 3 + 3 * k.size)).connect(voices);
    // The vowel: three formants gliding between "aah" and "ooh".
    const vowel = curve(L, 'smooth', 5 * k.slow);
    const breathing = amp(ctx, 1);
    modTo(ctx, curve(L, 'smooth', 3.5 * k.slow), breathing.gain, 0.35);
    voices.connect(breathing);
    const tone = bq(ctx, 'lowpass', 1800 + k.tone * 5000, 0.5);
    tone.connect(L.bus);
    const formants: Array<[number, number, number, number]> = [[500 + k.tone * 80, 190, 6, 1], [950 + k.tone * 120, 170, 8, 0.6], [2600, 0, 12, 0.2 + 0.3 * k.tone]];
    for (const [f, sweep, q, level] of formants) {
      const bp = bq(ctx, 'bandpass', f, q);
      if (sweep) modTo(ctx, vowel, bp.frequency, sweep);
      breathing.connect(bp).connect(amp(ctx, level)).connect(tone);
    }
    // A breath of air on top.
    drift(L, hiNoise(ctx)).connect(bq(ctx, 'highpass', 5000, 0.6)).connect(amp(ctx, 0.012 + 0.012 * k.tone)).connect(L.bus);
  }, 0.22),

  atmos('hum', 'Deep hum', 'A low drone on the key, slowly beating.', (sc, L, k) => {
    const ctx = sc.ctx;
    const f1 = fold(midiToHz(sc.keyRoot - 12), 55);
    const beat = 0.12 + (1 - k.tail) * 0.45;
    const sum = ctx.createGain();
    // The hum: two close sines beating slowly, and the octave below.
    osc(L, 'sine', f1).connect(amp(ctx, 0.3)).connect(sum);
    osc(L, 'sine', f1 + beat).connect(amp(ctx, 0.3)).connect(sum);
    osc(L, 'sine', f1 / 2).connect(amp(ctx, 0.2 + 0.25 * k.size)).connect(sum);
    // Overtones so it carries on small speakers, beating at their own rate on each side.
    const overtones = bq(ctx, 'lowpass', 150 + k.tone * k.tone * 2500, 0.6);
    overtones.connect(amp(ctx, 0.1 + 0.1 * k.tone)).connect(sum);
    for (const [shift, side] of [[1.6, -0.6], [1.1, 0.6]]) {
      const pan = ctx.createStereoPanner();
      pan.pan.value = side;
      osc(L, 'triangle', f1 * 2 + beat * shift).connect(pan).connect(overtones);
    }
    const buzzLp = bq(ctx, 'lowpass', 140 + k.tone * k.tone * 2600, 1.5);
    osc(L, 'sawtooth', f1, 3).connect(buzzLp).connect(amp(ctx, (0.04 + 0.08 * k.size) * (0.6 + 0.8 * k.tone))).connect(sum);
    modTo(ctx, curve(L, 'smooth', 4 * k.slow), buzzLp.frequency, 40 + k.tone * k.tone * 500);
    // Slow swells, then a little warmth from saturation.
    const swell = amp(ctx, 1);
    modTo(ctx, curve(L, 'smooth', 5 * k.slow), swell.gain, 0.15);
    const shaper = ctx.createWaveShaper();
    shaper.curve = softCurve(1.2 + k.size * 1.8);
    sum.connect(swell).connect(shaper).connect(bq(ctx, 'highpass', 20, 0.7)).connect(L.bus);
  }, 0.24),
];
