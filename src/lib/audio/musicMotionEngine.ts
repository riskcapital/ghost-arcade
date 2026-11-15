/**
 * Music motion engine: runs every shader layer and shader VJ clip that has
 * Music motion on.
 *
 * Each frame it turns the show's audio (the shared visual-audio follower) into
 * the smooth signals in musicMotion.ts, then for each target:
 *   - advances its flow clock, published as a time offset the renderers add
 *     to the shader's TIME (getMusicTimeOffset), and
 *   - works out its driven params as its own values moved by the music. A
 *     layer's go into a per-frame override map the frame sync puts on over
 *     the stored values (musicMotionLayerOverrides), as it does keyframes and
 *     Timeline lines: never into the project, so nothing that watches the
 *     project (recorders, undo, panels) wakes up every frame, and a saved
 *     project keeps its own values. A VJ clip's go the same way, as live
 *     values for its deck row (liveParams.ts), never into the launcher.
 *
 * A driven param keeps its own value as the base: when the user (or anything
 * else) sets it, the new value becomes the base. Turning Music motion off puts
 * every base back.
 *
 * Audio modulation on a driven param stands aside (musicMotionOwnsParam), and
 * a param with Auto playing is left to Auto.
 */

import { engineNowMs, renderClockActive } from '../recording/renderClock';
import { get } from 'svelte/store';
import { musicMotionOwned, musicMotionOwnsParam } from './musicMotionOwned';
import { project } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { runAsAutomation } from '../stores/historyHooks';
import { LiveFrameWriter, clearLiveValues } from './liveParams';
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
  detectOnset,
  freshOnsets,
  isMusicMotionReady,
  attackRelease,
  musicSwell,
  MUSIC_SWELL_PEAK_SECONDS,
  type MusicClock,
  type MusicMotionSettings,
} from './musicMotion';

interface ParamState {
  base: number;
  last: number;
}

interface Target {
  clock: MusicClock;
  /** The music inputs a ready shader is fed; when it stops they go back to "not driven". */
  ready?: string[];
  /** A ready shader's pulse, with a gentler attack so a hit blooms rather than jolts. */
  pulse?: number;
  params: Map<string, ParamState>;
  seen: boolean;
}

const signals = freshSmoothSignals();
const targets = new Map<string, Target>();
/** Source ids whose time runs on the music clock this frame: the clock, and when (ms) it was read. */
const clocks = new Map<string, { offset: number; rate: number; at: number }>();
let audioActive = false;
/** The loudest swell of the last ~20 s, falling slowly: what a ready shader's swell is measured against. */
let swellPeak = 0;
const owned = musicMotionOwned;
const inputCache = new Map<string, ISFInputDef[]>();
const onsets = freshOnsets();
let rafId: number | null = null;
let lastTime = 0;
/** This frame's values for the frame sync and the panels (liveParams.ts). */
const live = new LiveFrameWriter('music');
/** This frame's driven values of a mapping layer: the shader source they were worked out for, and `shader:<name>` overrides. */
export type MusicMotionLayerValues = { sourceId: string; values: Record<string, number> };
/** By layer id. */
let layerOverrides = new Map<string, MusicMotionLayerValues>();
/** By shader source id, for sources only one driven layer shows. */
let sourceOverrides = new Map<string, MusicMotionLayerValues>();

/**
 * The music's values for mapping layers this frame, by layer id. Live state
 * only: never saved, never an undo step. Empty when nothing is driven.
 */
export function musicMotionLayerOverrides(): ReadonlyMap<string, MusicMotionLayerValues> {
  return layerOverrides;
}

/**
 * The music's values for a scene layer, keyed `shader:<name>` like the other
 * param overrides: its own, or those of the driven layer whose shader it
 * shows (a Timeline copy of that layer). A layer showing another source (a
 * block's clip on the piece) gets none.
 */
export function musicMotionValuesFor(layer: { id: string; source?: { id?: string } | null }): Record<string, number> | undefined {
  const sourceId = layer.source?.id;
  if (!sourceId) return undefined;
  const own = layerOverrides.get(layer.id);
  if (own) return own.sourceId === sourceId ? own.values : undefined;
  return sourceOverrides.get(sourceId)?.values;
}

/**
 * The music clock's offset (seconds) to add to this shader source's TIME at
 * `now` (ms), or 0. Read between frames it runs on at the clock's speed, so a
 * renderer drawing between the engine's steps never sees it hold or jump.
 */
export function getMusicTimeOffset(sourceId: string | undefined, now = engineNowMs()): number {
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

export { musicMotionOwnsParam };

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

/** The show's audio this frame: hits found in it go into the signals; returns the level. */
function readAudio(dt: number): number {
  const a = getVisualAudioSnapshot();
  audioActive = !!a.isActive;
  if (!a.isActive) return 0;
  const hit = detectOnset(onsets, a.bassFast, a.high, dt);
  if (hit > 0) surge(signals, hit);
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
  if (isMusicMotionReady(inputs)) {
    // Made for Music motion: the shader eases these every frame it draws and
    // runs its own clock from them. With no audio, mmFlow -1 gives it back its
    // normal speed (and no music clock is published, so the renderers leave it).
    const has = (n: string) => inputs.some((i) => i.NAME === n);
    const ready: Record<string, number> = {};
    t.pulse = attackRelease(t.pulse ?? 0, Math.min(1, signals.pulse), dt, 0.04, 0.3);
    if (has('mmFlow')) ready.mmFlow = audioActive ? 0 : -1;
    if (has('mmSwell')) ready.mmSwell = audioActive ? musicSwell(signals.swell, swellPeak) * amount : 0;
    if (has('mmPulse')) ready.mmPulse = audioActive ? Math.max(0, Math.min(1, t.pulse * amount * 1.1)) : 0;
    if (has('mmMorph')) ready.mmMorph = signals.morph % 1000;
    if (audioActive) clocks.set(sourceId, { offset: 0, rate: 1, at: now });
    for (const n of Object.keys(ready)) owned.add(`${ownKey}:${n}`);
    t.ready = Object.keys(ready);
    return ready;
  }
  stepMusicClock(t.clock, musicTimeRate(signals, amount, audioActive), dt);
  // The renderers read this clock for the shader's TIME (getMusicTimeOffset/Rate).
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
    // Not driven any more: mmFlow -1 hands the shader back its own TIME; the signals rest at 0.
    for (const name of t.ready ?? []) values[name] = name === 'mmFlow' ? -1 : 0;
    if (Object.keys(values).length) restore(key, values);
    targets.delete(key);
  }
}

function step(now: number): void {
  const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  if (!(dt > 0) || !Number.isFinite(dt)) return;
  const frameDt = Math.min(dt, 0.25);
  const env = readAudio(frameDt);
  smoothSignals(signals, env, frameDt);
  swellPeak = Math.max(signals.swell, swellPeak * Math.exp(-frameDt / MUSIC_SWELL_PEAK_SECONDS));

  clocks.clear();
  owned.clear();
  for (const t of targets.values()) t.seen = false;

  const p = get(project);
  const overrides = new Map<string, MusicMotionLayerValues>();
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
    if (!src.shaderValues) return;
    // Only what is driven: a param dropped from the set just shows its own
    // (stored) value again.
    const t = targets.get(`map:${layer.id}`);
    let driven: Record<string, number> | null = null;
    for (const name in writes) {
      if (!t?.params.has(name) && !t?.ready?.includes(name)) continue;
      (driven ??= {})[`shader:${name}`] = writes[name];
    }
    if (driven) overrides.set(layer.id, { sourceId: src.id, values: driven });
  });
  layerOverrides = overrides;
  const bySource = new Map<string, MusicMotionLayerValues | null>();
  for (const entry of overrides.values()) bySource.set(entry.sourceId, bySource.has(entry.sourceId) ? null : entry);
  sourceOverrides = new Map([...bySource].filter((e): e is [string, MusicMotionLayerValues] => e[1] !== null));

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
      // Only what is driven, as for a layer above.
      const t = targets.get(`vj:${bank}:${index}:${clip.id}`);
      for (const name in writes) {
        if (!t?.params.has(name) && !t?.ready?.includes(name)) continue;
        live.deck(bank, index, clip.id, `shader:${name}`, writes[name]);
      }
    });
  }
  for (const [layerId, entry] of overrides) {
    for (const key in entry.values) live.layer(layerId, entry.sourceId, key, entry.values[key]);
  }
  live.commit();

  // Neither a layer's nor a clip's own values were ever overwritten:
  // dropping their live values (above) is all it takes to give them back.
  releaseTargets(() => {});
}

function tick(now: number): void {
  rafId = requestAnimationFrame(tick);
  try {
    runAsAutomation(() => step(renderClockActive() ? engineNowMs() : now));
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
  layerOverrides = new Map();
  sourceOverrides = new Map();
  clearLiveValues('music');
}

/** For tests: run one frame at `now` ms. */
export function stepMusicMotionForTest(now: number): void {
  step(now);
}
