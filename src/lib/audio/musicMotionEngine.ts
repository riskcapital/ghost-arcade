/**
 * Music motion engine: runs every shader layer and shader VJ clip that has
 * Music motion on.
 *
 * Each frame it turns the show's audio (the shared visual-audio follower) into
 * the smooth signals in musicMotion.ts, then for each target:
 *   - advances its flow clock, published as a time offset the renderers add
 *     to the shader's TIME (getMusicTimeOffset), and
 *   - writes its driven params as its own values moved by the music, through
 *     the same per-frame paths Auto and audio modulation use.
 *
 * A driven param keeps its own value as the base: when the user (or anything
 * else) sets it, the new value becomes the base. Turning Music motion off puts
 * every base back.
 *
 * Audio modulation on a driven param stands aside (musicMotionOwnsParam), and
 * a param with Auto playing is left to Auto.
 */

import { get } from 'svelte/store';
import { project } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { runAsLiveControl } from '../stores/historyHooks';
import { getVisualAudioSnapshot } from './visualAudio';
import { parseISF } from '../isf/parser';
import type { ISFInputDef } from '../types';
import {
  drivenParamValue,
  freshSmoothSignals,
  musicMotionParams,
  musicMotionRole,
  musicTimeRate,
  smoothSignals,
  stepMusicClock,
  surge,
  type MusicClock,
  type MusicMotionSettings,
} from './musicMotion';

interface ParamState {
  base: number;
  last: number;
}

interface Target {
  clock: MusicClock;
  params: Map<string, ParamState>;
  seen: boolean;
}

const signals = freshSmoothSignals();
const targets = new Map<string, Target>();
/** Source ids whose time runs on the music clock this frame: the clock, and when (ms) it was read. */
const clocks = new Map<string, { offset: number; rate: number; at: number }>();
let audioActive = false;
/** `map:<layer index>:<param>` and `<A|B>:<layer index>:<param>` driven this frame. */
const owned = new Set<string>();
const inputCache = new Map<string, ISFInputDef[]>();
let prevKick = 0;
let prevSnare = 0;
let prevBeat = 0;
let rafId: number | null = null;
let lastTime = 0;

/**
 * The music clock's offset (seconds) to add to this shader source's TIME at
 * `now` (ms), or 0. Read between frames it runs on at the clock's speed, so a
 * renderer drawing between the engine's steps never sees it hold or jump.
 */
export function getMusicTimeOffset(sourceId: string | undefined, now = performance.now()): number {
  const c = sourceId ? clocks.get(sourceId) : undefined;
  if (!c) return 0;
  return c.offset + (c.rate - 1) * Math.max(0, Math.min(0.25, (now - c.at) / 1000));
}

/** How fast this source's music clock runs now (1 = normal time). */
export function getMusicTimeRate(sourceId: string | undefined): number {
  return (sourceId && clocks.get(sourceId)?.rate) || 1;
}

/** True when Music motion is running on this source's time. */
export function hasMusicTime(sourceId: string | undefined): boolean {
  return !!sourceId && clocks.has(sourceId);
}

/** True when Music motion drives this shader param, so audio modulation leaves it alone. */
export function musicMotionOwnsParam(target: 'map' | 'A' | 'B', layerIndex: number, paramName: string): boolean {
  return owned.size > 0 && owned.has(`${target}:${layerIndex}:${paramName}`);
}

function inputsFor(code: string | undefined, known?: ISFInputDef[]): ISFInputDef[] {
  if (known && known.length) return known;
  if (!code) return [];
  let inputs = inputCache.get(code);
  if (!inputs) {
    try {
      inputs = (parseISF(code)?.metadata?.INPUTS ?? []) as ISFInputDef[];
    } catch {
      inputs = [];
    }
    if (inputCache.size > 64) inputCache.clear();
    inputCache.set(code, inputs);
  }
  return inputs;
}

/** Hits from the follower's kick, snare and beat signals: a sharp rise is a hit. */
function readAudio(): number {
  const a = getVisualAudioSnapshot();
  audioActive = !!a.isActive;
  if (!a.isActive) {
    prevKick = prevSnare = prevBeat = 0;
    return 0;
  }
  const rise = Math.max(a.kick - prevKick, a.snare - prevSnare, a.beat - prevBeat);
  prevKick = a.kick;
  prevSnare = a.snare;
  prevBeat = a.beat;
  if (rise > 0.25) surge(signals, Math.min(1, 0.4 + rise));
  return Math.max(0, Math.min(1, Math.max(a.level, a.energy)));
}

/** Drive one target; returns the param writes to commit. */
function driveTarget(
  key: string,
  sourceId: string,
  settings: MusicMotionSettings,
  inputs: ISFInputDef[],
  values: Record<string, unknown> | undefined,
  autoParams: Record<string, { playing?: boolean } | undefined> | undefined,
  dt: number,
  ownKey: string,
  now: number,
): Record<string, number> {
  let t = targets.get(key);
  if (!t) {
    t = { clock: { offset: 0, rate: 1 }, params: new Map(), seen: true };
    targets.set(key, t);
  }
  t.seen = true;
  const amount = settings.amount;
  stepMusicClock(t.clock, musicTimeRate(signals, amount, audioActive), dt);
  clocks.set(sourceId, { offset: t.clock.offset, rate: t.clock.rate, at: now });

  const writes: Record<string, number> = {};
  const names = musicMotionParams(settings, inputs).filter((n) => !autoParams?.[n]?.playing);
  const keep = new Set(names);
  // Params dropped from the set go back to their own value.
  for (const [name, ps] of t.params) {
    if (!keep.has(name)) {
      writes[name] = ps.base;
      t.params.delete(name);
    }
  }
  const frame = { swell: signals.swell, pulse: signals.pulse, morph: signals.morph };
  names.forEach((name, index) => {
    const input = inputs.find((i) => i.NAME === name);
    if (!input) return;
    const current = values?.[name];
    const fallback = typeof input.DEFAULT === 'number' ? input.DEFAULT : 0.5;
    const now = typeof current === 'number' && Number.isFinite(current) ? current : fallback;
    let ps = t!.params.get(name);
    if (!ps) {
      ps = { base: now, last: now };
      t!.params.set(name, ps);
    } else if (Math.abs(now - ps.last) > 1e-6) {
      ps.base = now; // set from elsewhere: that is the new base
    }
    const min = typeof input.MIN === 'number' ? input.MIN : 0;
    const max = typeof input.MAX === 'number' ? input.MAX : 1;
    const value = drivenParamValue(ps.base, min, max, musicMotionRole(name, index), frame, amount);
    ps.last = value;
    writes[name] = value;
    owned.add(`${ownKey}:${name}`);
  });
  return writes;
}

/** A target that stopped (turned off, clip changed, layer gone): its params get their own values back. */
function releaseTargets(restore: (key: string, values: Record<string, number>) => void): void {
  for (const [key, t] of targets) {
    if (t.seen) {
      t.seen = false;
      continue;
    }
    const values: Record<string, number> = {};
    for (const [name, ps] of t.params) values[name] = ps.base;
    if (Object.keys(values).length) restore(key, values);
    targets.delete(key);
  }
}

function step(now: number): void {
  const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const frameDt = Math.min(dt, 0.25);
  const env = readAudio();
  smoothSignals(signals, env, frameDt);

  clocks.clear();
  owned.clear();
  for (const t of targets.values()) t.seen = false;

  const p = get(project);
  p.layers.forEach((layer, index) => {
    const src = layer.source;
    const mm = src?.musicMotion;
    if (!src || !mm?.on || src.type !== 'shader' || !src.shaderCode) return;
    const writes = driveTarget(
      `map:${layer.id}`,
      src.id,
      mm,
      inputsFor(src.shaderCode, src.shaderInputs),
      src.shaderValues as Record<string, unknown> | undefined,
      src.shaderValueAuto,
      frameDt,
      `map:${index}`,
      now,
    );
    if (Object.keys(writes).length && src.shaderValues) project.batchUpdateLayerShaderValues(layer.id, writes);
  });

  const vj = get(vjClipLauncher);
  const decks = [
    { states: vj.layerStates, bank: 'A' as const },
    { states: vj.bankBLayerStates, bank: 'B' as const },
  ];
  for (const { states, bank } of decks) {
    states?.forEach((ls, index) => {
      const clip = ls?.activeClip;
      const mm = clip?.musicMotion;
      if (!clip || !mm?.on || clip.type !== 'shader' || !clip.shaderCode) return;
      const writes = driveTarget(
        `vj:${bank}:${index}:${clip.id}`,
        clip.id,
        mm,
        inputsFor(clip.shaderCode),
        clip.shaderValues,
        clip.shaderValueAuto,
        frameDt,
        `${bank}:${index}`,
        now,
      );
      if (Object.keys(writes).length) vjClipLauncher.batchUpdateShaderValues(index, writes, bank);
    });
  }

  releaseTargets((key, values) => {
    if (key.startsWith('map:')) {
      project.batchUpdateLayerShaderValues(key.slice(4), values);
      return;
    }
    const [, bank, index, clipId] = key.split(':');
    const states = bank === 'B' ? get(vjClipLauncher).bankBLayerStates : get(vjClipLauncher).layerStates;
    if (states?.[Number(index)]?.activeClip?.id === clipId) {
      vjClipLauncher.batchUpdateShaderValues(Number(index), values, bank as 'A' | 'B');
    }
  });
}

function tick(now: number): void {
  rafId = requestAnimationFrame(tick);
  try {
    runAsLiveControl(() => step(now));
  } catch (error) {
    console.error('[MusicMotion] frame skipped:', error);
  }
}

/** Start the engine. Idempotent. */
export function startMusicMotionEngine(): void {
  if (rafId !== null) return;
  lastTime = 0;
  rafId = requestAnimationFrame(tick);
}

/** Stop the engine. Idempotent. */
export function stopMusicMotionEngine(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

/** For tests: run one frame at `now` ms. */
export function stepMusicMotionForTest(now: number): void {
  step(now);
}
