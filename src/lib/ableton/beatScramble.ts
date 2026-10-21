/**
 * Beat scramble — Performer's Tab scramble for the VJ decks, fired by Live:
 * on a beat grid, or by a linked note (a kick drum, say). It randomizes
 * what is on screen right now: the shader params of the clip each layer is
 * playing and/or the effect params on those clips, their layers and the
 * master chain, on the deck(s) the crossfader is showing.
 *
 * `amount` blends from where each value is toward a random one, so a low
 * amount nudges the look on every hit and 1 throws it somewhere new.
 */

import type { ISFInput } from '../isf/parser';
import type { EffectParamDef } from '../effects/effectParamDefs';

export type VJDeckSide = 'A' | 'B';

export type ScrambleTarget = 'shader' | 'fx' | 'both';

export interface BeatScrambleSettings {
  on: boolean;
  /** Beats between scrambles: 1, 2, 4 (a bar in 4/4), 8, 16. */
  every: number;
  target: ScrambleTarget;
  /** 0..1: how far each value moves toward a random one. */
  amount: number;
}

export const DEFAULT_BEAT_SCRAMBLE: BeatScrambleSettings = { on: false, every: 4, target: 'both', amount: 0.6 };
export const SCRAMBLE_EVERY = [1, 2, 4, 8, 16] as const;

type Rand = () => number;

/** A value moved `amount` of the way toward a random point in its range. */
export function scrambleNumber(current: number, min: number, max: number, amount: number, rand: Rand = Math.random): number {
  const target = min + rand() * (max - min);
  const from = Number.isFinite(current) ? current : target;
  return Math.max(Math.min(min, max), Math.min(Math.max(min, max), from + (target - from) * amount));
}

/** A scrambled value for one shader input, or null to leave it alone. */
export function scrambleShaderInput(input: ISFInput, current: unknown, amount: number, rand: Rand = Math.random): number | boolean | number[] | null {
  switch (input.TYPE) {
    case 'float':
      return scrambleNumber(Number(current ?? input.DEFAULT), input.MIN ?? 0, input.MAX ?? 1, amount, rand);
    case 'long':
      if (!input.VALUES?.length || rand() > amount) return null;
      return input.VALUES[Math.floor(rand() * input.VALUES.length)];
    case 'bool':
      return rand() < amount / 2 ? !current : null;
    case 'color': {
      const rgb = Array.isArray(current) ? current : Array.isArray(input.DEFAULT) ? input.DEFAULT : [0.5, 0.5, 0.5, 1];
      return [0, 1, 2].map(i => scrambleNumber(Number(rgb[i]), 0, 1, amount, rand)).concat(Number(rgb[3] ?? 1));
    }
    case 'point2D': {
      const point = Array.isArray(current) ? current : Array.isArray(input.DEFAULT) ? input.DEFAULT : [0.5, 0.5];
      const range = input as unknown as { MIN?: unknown; MAX?: unknown };
      const min = Array.isArray(range.MIN) ? range.MIN : [0, 0];
      const max = Array.isArray(range.MAX) ? range.MAX : [1, 1];
      return [0, 1].map(i => scrambleNumber(Number(point[i]), Number(min[i]), Number(max[i]), amount, rand));
    }
    default:
      return null;
  }
}

/** Scrambled params for one effect. An effect's own amount stays in the top
 *  three quarters of its range so a scramble never switches it off. */
export function scrambleEffectParams(defs: EffectParamDef[], params: Record<string, unknown>, amount: number, rand: Rand = Math.random): Record<string, number> {
  const patch: Record<string, number> = {};
  for (const def of defs) {
    if (def.type === 'color' && def.colorParams) {
      for (const key of [def.colorParams.r, def.colorParams.g, def.colorParams.b]) {
        patch[key] = scrambleNumber(Number(params[key] ?? def.default), 0, 1, amount, rand);
      }
    } else if (def.type === 'select' && def.options?.length) {
      if (rand() < amount / 2) patch[def.param] = def.options[Math.floor(rand() * def.options.length)].value;
    } else {
      const min = def.param === 'amount' ? def.min + (def.max - def.min) * 0.25 : def.min;
      patch[def.param] = scrambleNumber(Number(params[def.param] ?? def.default), min, def.max, amount, rand);
    }
  }
  return patch;
}

/** The decks the room can see: both while the crossfader blends, one at
 *  either end, deck A when the crossfader is off. */
export function onAirDecks(crossfaderEnabled: boolean, value: number): VJDeckSide[] {
  if (!crossfaderEnabled) return ['A'];
  const decks: VJDeckSide[] = [];
  if (value < 0.98) decks.push('A');
  if (value > 0.02) decks.push('B');
  return decks;
}

export function sanitizeBeatScramble(raw: unknown): BeatScrambleSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const every = SCRAMBLE_EVERY.includes(Number(r.every) as typeof SCRAMBLE_EVERY[number]) ? Number(r.every) : DEFAULT_BEAT_SCRAMBLE.every;
  const target: ScrambleTarget = r.target === 'shader' || r.target === 'fx' ? r.target : 'both';
  const amount = Number.isFinite(Number(r.amount)) ? Math.max(0.05, Math.min(1, Number(r.amount))) : DEFAULT_BEAT_SCRAMBLE.amount;
  return { on: !!r.on, every, target, amount };
}
