/**
 * The studio dipping under the band's kick, the way a pad is sidechained to
 * a kick drum: on each kick the drone, the bowls, the FX pads and the synth
 * go down by the duck depth in about five milliseconds and come back over
 * the release.
 *
 * The dip is Web Audio automation scheduled at the hit, so nothing runs per
 * frame. The envelope maths is pure, so a second kick that lands while the
 * first is still down starts from where the gain really is.
 */

import type { InstrumentId } from './noteEvents';
import { holdAt } from './sounds/kit';

/** How fast the studio goes down on a kick. */
export const DUCK_ATTACK_SECONDS = 0.005;

/** The instruments that dip under the band's kick. */
export const DUCKED_INSTRUMENTS: ReadonlySet<InstrumentId> = new Set<InstrumentId>(['drone', 'bowls', 'shots', 'synth']);

/** One dip: from `from` at `time` down to `floor`, then back towards 1 over `release` seconds. */
export interface DuckEnvelope {
  time: number;
  from: number;
  floor: number;
  release: number;
}

const clamp01 = (v: number) => (Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0);

/** How low a kick takes the gain: the full depth for a hard kick, a little less for a soft one. */
export function duckFloor(depth: number, velocity: number): number {
  return 1 - clamp01(depth) * (0.6 + 0.4 * clamp01(velocity));
}

/** The release's time constant: within 2% of full after `release` seconds. */
export function releaseConstant(release: number): number {
  return Math.max(0.01, release) / 4;
}

/** The ducking gain at `time` (1 with no dip). */
export function duckGainAt(env: DuckEnvelope | null, time: number): number {
  if (!env) return 1;
  const dt = time - env.time;
  if (dt <= 0) return env.from;
  if (dt < DUCK_ATTACK_SECONDS) return env.from + (env.floor - env.from) * (dt / DUCK_ATTACK_SECONDS);
  return 1 - (1 - env.floor) * Math.exp(-(dt - DUCK_ATTACK_SECONDS) / releaseConstant(env.release));
}

/**
 * The dip a kick at `time` starts, or null when ducking is off. A soft kick
 * while a hard one is still down never lifts the gain: it holds where it is
 * and releases from there.
 */
export function nextDuck(prev: DuckEnvelope | null, time: number, depth: number, velocity: number, release: number): DuckEnvelope | null {
  if (!(depth > 0)) return null;
  const from = duckGainAt(prev, time);
  return { time, from, floor: Math.min(from, duckFloor(depth, velocity)), release };
}

/** The gains the ducked instruments pass through. */
export class Ducker {
  private readonly gains: GainNode[] = [];
  private env: DuckEnvelope | null = null;

  constructor(private readonly ctx: BaseAudioContext) {}

  /** A ducking gain after `node`: the chain carries on from the returned gain. */
  after(node: AudioNode): GainNode {
    const gain = this.ctx.createGain();
    node.connect(gain);
    this.gains.push(gain);
    return gain;
  }

  /** Dip at `time` (now by default). */
  duck(depth: number, velocity: number, release: number, time = this.ctx.currentTime): void {
    const env = nextDuck(this.env, time, depth, velocity, release);
    if (!env) return;
    this.env = env;
    const bottom = time + DUCK_ATTACK_SECONDS;
    const tau = releaseConstant(release);
    for (const { gain } of this.gains) {
      holdAt(gain, time);
      gain.linearRampToValueAtTime(env.floor, bottom);
      gain.setTargetAtTime(1, bottom, tau);
    }
  }

  /** Back to full at once. */
  reset(): void {
    const t = this.ctx.currentTime;
    this.env = null;
    for (const { gain } of this.gains) {
      gain.cancelScheduledValues(t);
      gain.setValueAtTime(1, t);
    }
  }

  dispose(): void {
    for (const gain of this.gains) {
      try { gain.disconnect(); } catch { /* gone */ }
    }
    this.gains.length = 0;
    this.env = null;
  }
}
