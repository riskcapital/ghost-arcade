/**
 * SMPTE Linear Timecode (LTC) codec.
 *
 * WIRE FORMAT
 * -----------
 * One 80-bit word per frame, bit 0 first. Biphase mark: the level flips at
 * the start of every bit cell, and a 1 flips again in the middle. So a 0 is
 * one long interval between transitions and a 1 is two short ones, which
 * makes the code self-clocking and indifferent to polarity.
 *
 *   0-3 frame units   8-9 frame tens   10 drop-frame   11 colour frame
 *   16-19 sec units   24-26 sec tens   32-35 min units 40-42 min tens
 *   48-51 hour units  56-57 hour tens  64-79 sync word 0011111111111101
 *   user bits in 4-7, 12-15, 20-23, 28-31, 36-39, 44-47, 52-55, 60-63
 *   polarity correction: bit 27 (24/30 fps) or bit 59 (25 fps)
 *
 * DECODER
 * -------
 * Amplitude never enters the bit decision, which is what makes it survive
 * level changes: transitions are ZERO CROSSINGS of a DC-blocked, lightly
 * smoothed signal, and a crossing only counts once the new sign has held for
 * a few samples (a time debounce instead of an amplitude hysteresis, so a
 * 30 dB step between two samples costs nothing). The crossing time is
 * interpolated between samples. A noise spike that does get through shows up
 * as a pair of edges far too close together; both are thrown away and the
 * bit assembly is rolled back to before the first one.
 *
 * Intervals are classed long or short against a running bit-period estimate
 * (the split point is 3/4 of a bit, midway between the half and the whole),
 * so the same decoder follows 24, 25, 29.97 and 30 fps and varispeed without
 * being told the rate. Bits shift into an 80-bit window and a frame is
 * emitted when its last 16 bits are the forward sync word and every BCD
 * field is in range.
 *
 * The emitted `endSample` is the transition that starts the NEXT frame, so
 * "now" at that sample is the decoded label plus exactly one frame.
 */

import {
  actualFps,
  nominalFps,
  timecodeToFrameNumber,
  frameNumberToTimecode,
  type Timecode,
  type TimecodeRate,
} from './timecode';

export const LTC_BITS_PER_FRAME = 80;

const SYNC_WORD = [0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1];

// ─── Encoder ─────────────────────────────────────────────────────────────

function writeBcd(bits: Uint8Array, offset: number, count: number, value: number): void {
  for (let i = 0; i < count; i++) bits[offset + i] = (value >> i) & 1;
}

/** The 80 bits of one frame, bit 0 first. `userBits` is 32 bits, nibble 0
 *  in the low bits. */
export function encodeLtcFrameBits(tc: Timecode, userBits = 0): Uint8Array {
  const bits = new Uint8Array(LTC_BITS_PER_FRAME);
  writeBcd(bits, 0, 4, tc.frames % 10);
  writeBcd(bits, 8, 2, Math.floor(tc.frames / 10));
  bits[10] = tc.dropFrame ? 1 : 0;
  writeBcd(bits, 16, 4, tc.seconds % 10);
  writeBcd(bits, 24, 3, Math.floor(tc.seconds / 10));
  writeBcd(bits, 32, 4, tc.minutes % 10);
  writeBcd(bits, 40, 3, Math.floor(tc.minutes / 10));
  writeBcd(bits, 48, 4, tc.hours % 10);
  writeBcd(bits, 56, 2, Math.floor(tc.hours / 10));
  const ubOffsets = [4, 12, 20, 28, 36, 44, 52, 60];
  for (let n = 0; n < 8; n++) writeBcd(bits, ubOffsets[n], 4, (userBits >>> (n * 4)) & 0xf);
  for (let i = 0; i < 16; i++) bits[64 + i] = SYNC_WORD[i];
  // Polarity correction: make the count of zeros even so every frame starts
  // on the same level.
  const polarityBit = tc.rate === 25 ? 59 : 27;
  bits[polarityBit] = 0;
  let zeros = 0;
  for (let i = 0; i < LTC_BITS_PER_FRAME; i++) if (bits[i] === 0) zeros++;
  if (zeros % 2 === 1) bits[polarityBit] = 1;
  return bits;
}

export interface LtcGenerateOptions {
  start: Timecode;
  frameCount: number;
  sampleRate: number;
  /** Peak level, or a function of time in seconds for level changes. */
  amplitude?: number | ((seconds: number) => number);
  /** Standard deviation of added Gaussian noise, absolute. */
  noise?: number;
  /** Seed for the noise generator, so a failing test reproduces. */
  seed?: number;
  /** One-pole low-pass time constant in samples, to model a real rise time. */
  riseSamples?: number;
  /** Constant offset added after everything else. */
  dcOffset?: number;
  /** Silence before the first frame, samples. */
  leadInSamples?: number;
  /** Bit-rate multiplier, 1 = nominal. Models a slightly fast or slow deck. */
  speed?: number;
}

/** Deterministic PRNG (mulberry32) and a Box-Muller Gaussian on top. */
function makeGaussian(seed: number): () => number {
  let a = seed >>> 0;
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => {
    const u = Math.max(1e-12, uniform());
    const v = uniform();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/**
 * Render consecutive LTC frames to PCM. Bit edges fall on exact fractional
 * sample times (29.97 is not a whole number of samples per frame at any
 * common rate), so the output carries the same one-sample edge jitter a real
 * interface produces.
 */
export function generateLtc(options: LtcGenerateOptions): Float32Array {
  const {
    start,
    frameCount,
    sampleRate,
    amplitude = 0.5,
    noise = 0,
    seed = 1,
    riseSamples = 0,
    dcOffset = 0,
    leadInSamples = 0,
    speed = 1,
  } = options;
  const samplesPerBit = sampleRate / (actualFps(start.rate) * LTC_BITS_PER_FRAME * speed);
  const totalBits = frameCount * LTC_BITS_PER_FRAME;
  const total = Math.ceil(leadInSamples + totalBits * samplesPerBit) + 1;
  const out = new Float32Array(total);
  const gauss = noise > 0 ? makeGaussian(seed) : null;
  const ampAt = typeof amplitude === 'function' ? amplitude : () => amplitude;

  // Half-bit level sequence.
  const startFrame = timecodeToFrameNumber(start);
  let level = 1;
  let bitIndex = -1;
  let halfLevels: [number, number] = [level, level];
  let frameBits: Uint8Array | null = null;
  let smoothed = 0;
  for (let i = 0; i < total; i++) {
    const t = i - leadInSamples;
    let ideal = 0;
    if (t >= 0) {
      const bitPos = t / samplesPerBit;
      const b = Math.floor(bitPos);
      if (b < totalBits) {
        if (b !== bitIndex) {
          // Advance bit by bit so no transition is skipped even if a bit is
          // shorter than a sample (never happens at audio rates, but cheap).
          while (bitIndex < b) {
            bitIndex++;
            const f = Math.floor(bitIndex / LTC_BITS_PER_FRAME);
            const within = bitIndex % LTC_BITS_PER_FRAME;
            if (within === 0 || !frameBits) {
              const tc = frameNumberToTimecode(startFrame + f, start.rate, start.dropFrame);
              frameBits = encodeLtcFrameBits(tc);
            }
            level = -level; // transition at every bit start
            const first = level;
            const second = frameBits[within] === 1 ? -level : level;
            halfLevels = [first, second];
            level = second;
          }
        }
        const half = bitPos - b < 0.5 ? 0 : 1;
        ideal = halfLevels[half];
      }
    }
    let v = ideal * ampAt(i / sampleRate);
    if (riseSamples > 0) {
      smoothed += (v - smoothed) / riseSamples;
      v = smoothed;
    }
    if (gauss) v += gauss() * noise;
    out[i] = v + dcOffset;
  }
  return out;
}

// ─── Decoder ─────────────────────────────────────────────────────────────

export interface LtcFrame {
  hours: number;
  minutes: number;
  seconds: number;
  frames: number;
  dropFrame: boolean;
  colorFrame: boolean;
  userBits: number;
  /** Absolute sample index (fractional) of the transition that ends this
   *  frame, counted from the first sample the decoder ever saw. */
  endSample: number;
  /** Measured length of this frame, samples. */
  frameSamples: number;
  /** Rate inferred from the bit period (29.97 only when the DF flag is set or
   *  the measured rate is closer to it than to 30). */
  rate: TimecodeRate;
}

/** Nearest SMPTE rate to a measured frames-per-second value. */
export function classifyLtcRate(fps: number, dropFrame: boolean): TimecodeRate {
  if (dropFrame) return 29.97;
  if (fps < 24.5) return 24;
  if (fps < 27.5) return 25;
  return fps < 29.985 ? 29.97 : 30;
}

export class LtcDecoder {
  readonly sampleRate: number;
  /** Samples per bit, running estimate. */
  private bitPeriod: number;
  private readonly minBitPeriod: number;
  private readonly maxBitPeriod: number;
  // DC blocker state.
  private hpPrevIn = 0;
  private hpPrevOut = 0;
  private readonly hpCoef: number;
  // Crossing detector state.
  private sign = 0;
  private prevSample = 0;
  private candidateTime: number | null = null;
  private candidateSign = 0;
  private candidateHeld = 0;
  private readonly holdSamples: number;
  // Short moving average ahead of the crossing detector.
  private readonly smooth: Float32Array;
  private smoothIndex = 0;
  private smoothSum = 0;
  private lastTransition: number | null = null;
  /** Assembly state from just before the most recent edge, so a glitch
   *  (two edges far too close together) can be undone as a pair. */
  private undo: {
    lastTransition: number | null;
    halfPending: boolean;
    bitCount: number;
    bitPeriod: number;
    bits: Uint8Array;
  } | null = null;
  // Bit assembly.
  private halfPending = false;
  private readonly bits = new Uint8Array(LTC_BITS_PER_FRAME);
  private bitCount = 0;
  private lastFrameEnd: number | null = null;
  /** Smoothed frame length, for the 29.97 / 30 decision. */
  private frameSamplesAvg = 0;
  private sampleCounter = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.bitPeriod = sampleRate / (25 * LTC_BITS_PER_FRAME);
    // 22 to 33 fps covers every rate plus generous varispeed.
    this.minBitPeriod = sampleRate / (33 * LTC_BITS_PER_FRAME);
    this.maxBitPeriod = sampleRate / (22 * LTC_BITS_PER_FRAME);
    // ~10 Hz high-pass: removes DC and hum-level drift, keeps the square edges.
    this.hpCoef = Math.exp((-2 * Math.PI * 10) / sampleRate);
    const minHalfBit = this.minBitPeriod / 2;
    // A new sign must hold for about a third of the shortest half-bit, and
    // the smoother spans about as much: both stay well inside a half-bit at
    // any rate, so a real edge is only delayed, never lost.
    this.holdSamples = Math.max(1, Math.round(minHalfBit * 0.3));
    this.smooth = new Float32Array(Math.max(1, Math.round(minHalfBit * 0.3)));
  }

  reset(): void {
    this.bitPeriod = this.sampleRate / (25 * LTC_BITS_PER_FRAME);
    this.hpPrevIn = 0;
    this.hpPrevOut = 0;
    this.smooth.fill(0);
    this.smoothIndex = 0;
    this.smoothSum = 0;
    this.undo = null;
    this.sign = 0;
    this.prevSample = 0;
    this.candidateTime = null;
    this.candidateHeld = 0;
    this.lastTransition = null;
    this.halfPending = false;
    this.bitCount = 0;
    this.lastFrameEnd = null;
    this.frameSamplesAvg = 0;
  }

  /** Samples consumed so far. */
  get position(): number {
    return this.sampleCounter;
  }

  /** Current bit-period estimate converted to frames per second. */
  get estimatedFps(): number {
    return this.sampleRate / (this.bitPeriod * LTC_BITS_PER_FRAME);
  }

  process(samples: ArrayLike<number>, onFrame?: (frame: LtcFrame) => void): LtcFrame[] {
    const out: LtcFrame[] = [];
    const emit = (f: LtcFrame) => {
      out.push(f);
      onFrame?.(f);
    };
    const n = samples.length;
    for (let i = 0; i < n; i++) {
      const idx = this.sampleCounter + i;
      const x = samples[i];
      // One-pole DC blocker, then a short moving average.
      const hp = this.hpCoef * (this.hpPrevOut + x - this.hpPrevIn);
      this.hpPrevIn = x;
      this.hpPrevOut = hp;
      this.smoothSum += hp - this.smooth[this.smoothIndex];
      this.smooth[this.smoothIndex] = hp;
      this.smoothIndex = (this.smoothIndex + 1) % this.smooth.length;
      const y = this.smoothSum / this.smooth.length;

      const s = y > 0 ? 1 : y < 0 ? -1 : 0;
      if (s !== 0) {
        if (this.candidateTime !== null) {
          if (s === this.candidateSign) {
            this.candidateHeld++;
            if (this.candidateHeld >= this.holdSamples) {
              this.sign = this.candidateSign;
              this.onTransition(this.candidateTime, emit);
              this.candidateTime = null;
            }
          } else {
            // Flicked back before it settled: noise at the crossing, not an edge.
            this.candidateTime = null;
          }
        } else if (this.sign === 0) {
          this.sign = s;
        } else if (s !== this.sign) {
          const prev = this.prevSample;
          const frac = prev !== y ? prev / (prev - y) : 0.5;
          // Minus the moving average's group delay, so edge times (and the
          // frame ends reported from them) line up with the input.
          this.candidateTime = idx - 1 + Math.max(0, Math.min(1, frac)) - (this.smooth.length - 1) / 2;
          this.candidateSign = s;
          this.candidateHeld = 1;
          if (this.holdSamples <= 1) {
            this.sign = s;
            this.onTransition(this.candidateTime, emit);
            this.candidateTime = null;
          }
        }
      }
      this.prevSample = y;
    }
    this.sampleCounter += n;
    return out;
  }

  private onTransition(time: number, emit: (f: LtcFrame) => void): void {
    const last = this.lastTransition;
    if (last !== null && time - last < this.bitPeriod * 0.3 && this.undo) {
      // Far too short for either half: this edge and the one before it are a
      // noise spike. Roll back to before the first and drop both.
      const u = this.undo;
      this.lastTransition = u.lastTransition;
      this.halfPending = u.halfPending;
      this.bitCount = u.bitCount;
      this.bitPeriod = u.bitPeriod;
      this.bits.set(u.bits);
      this.undo = null;
      return;
    }
    this.undo = {
      lastTransition: last,
      halfPending: this.halfPending,
      bitCount: this.bitCount,
      bitPeriod: this.bitPeriod,
      bits: this.undo?.bits ?? new Uint8Array(LTC_BITS_PER_FRAME),
    };
    this.undo.bits.set(this.bits);
    this.lastTransition = time;
    if (last === null) return;
    const interval = time - last;
    const bp = this.bitPeriod;
    if (interval > bp * 1.6) {
      // Gap or dropout: whatever was being assembled is not trustworthy.
      this.halfPending = false;
      this.bitCount = 0;
      if (interval > this.maxBitPeriod * 4) this.lastFrameEnd = null;
      return;
    }
    if (interval < bp * 0.3) {
      // A short edge with nothing to roll back to (first edge after a reset).
      return;
    }
    if (interval >= bp * 0.75) {
      // Long: a zero. A pending half means we were out of step; resync here.
      this.halfPending = false;
      this.adaptBitPeriod(interval);
      this.pushBit(0, time, emit);
    } else if (this.halfPending) {
      this.halfPending = false;
      this.adaptBitPeriod(interval * 2);
      this.pushBit(1, time, emit);
    } else {
      this.halfPending = true;
      this.adaptBitPeriod(interval * 2);
    }
  }

  private adaptBitPeriod(measured: number): void {
    const next = this.bitPeriod * 0.9 + measured * 0.1;
    this.bitPeriod = Math.max(this.minBitPeriod, Math.min(this.maxBitPeriod, next));
  }

  private pushBit(bit: number, time: number, emit: (f: LtcFrame) => void): void {
    this.bits.copyWithin(0, 1);
    this.bits[LTC_BITS_PER_FRAME - 1] = bit;
    if (this.bitCount < LTC_BITS_PER_FRAME) this.bitCount++;
    if (this.bitCount < LTC_BITS_PER_FRAME) return;
    for (let i = 0; i < 16; i++) {
      if (this.bits[64 + i] !== SYNC_WORD[i]) return;
    }
    const frame = this.parseFrame(time);
    // Whatever happens, the next frame starts assembling from scratch.
    this.bitCount = 0;
    if (frame) emit(frame);
  }

  private parseFrame(endSample: number): LtcFrame | null {
    const b = this.bits;
    const bcd = (offset: number, count: number) => {
      let v = 0;
      for (let i = 0; i < count; i++) v |= b[offset + i] << i;
      return v;
    };
    const frameUnits = bcd(0, 4);
    const frameTens = bcd(8, 2);
    const secUnits = bcd(16, 4);
    const secTens = bcd(24, 3);
    const minUnits = bcd(32, 4);
    const minTens = bcd(40, 3);
    const hourUnits = bcd(48, 4);
    const hourTens = bcd(56, 2);
    if (frameUnits > 9 || secUnits > 9 || minUnits > 9 || hourUnits > 9) return null;
    const frames = frameTens * 10 + frameUnits;
    const seconds = secTens * 10 + secUnits;
    const minutes = minTens * 10 + minUnits;
    const hours = hourTens * 10 + hourUnits;
    if (frames > 29 || seconds > 59 || minutes > 59 || hours > 23) return null;
    const dropFrame = b[10] === 1;

    const frameSamples = this.lastFrameEnd !== null ? endSample - this.lastFrameEnd : this.bitPeriod * LTC_BITS_PER_FRAME;
    this.lastFrameEnd = endSample;
    const plausible = frameSamples > this.minBitPeriod * 70 && frameSamples < this.maxBitPeriod * 90;
    if (plausible) {
      this.frameSamplesAvg = this.frameSamplesAvg > 0
        ? this.frameSamplesAvg * 0.9 + frameSamples * 0.1
        : frameSamples;
    }
    const fps = this.frameSamplesAvg > 0 ? this.sampleRate / this.frameSamplesAvg : this.estimatedFps;
    let rate = classifyLtcRate(fps, dropFrame);
    // A label is the better witness than a varispeed-skewed clock: frame 24
    // cannot be 24 fps, frame 29 cannot be 25.
    if (frames >= nominalFps(rate)) rate = frames >= 25 ? 30 : 25;

    let userBits = 0;
    const ubOffsets = [4, 12, 20, 28, 36, 44, 52, 60];
    for (let n = 0; n < 8; n++) userBits |= bcd(ubOffsets[n], 4) << (n * 4);

    return {
      hours,
      minutes,
      seconds,
      frames,
      dropFrame,
      colorFrame: b[11] === 1,
      userBits: userBits >>> 0,
      endSample,
      frameSamples,
      rate,
    };
  }
}

/** A decoded frame as a Timecode at a given (or its detected) rate. */
export function ltcFrameToTimecode(frame: LtcFrame, rate: TimecodeRate = frame.rate): Timecode {
  return {
    hours: frame.hours,
    minutes: frame.minutes,
    seconds: frame.seconds,
    frames: frame.frames,
    rate,
    dropFrame: frame.dropFrame && nominalFps(rate) === 30,
  };
}
