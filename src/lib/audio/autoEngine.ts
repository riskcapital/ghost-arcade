/**
 * Auto Engine — per-param playhead automation.
 *
 * Separate from the audio modulation engine because:
 *   - Audio modulation is REACTIVE (mic / band amplitude → param).
 *   - Auto is GENERATIVE: free sweeps advance at speedHz; beat-synced
 *     sweeps read the shared performance clock directly.
 *
 * Auto settings live directly on the data being automated:
 *   - `layer.effects[i].paramAuto[paramName]` for mapping effects
 *   - `layer.source.shaderValueAuto[paramName]` for mapping shader params
 *   - `clip.shaderValueAuto[paramName]` for VJ clip shader params
 * If there's an AutoConfig on the thing, the engine animates it.
 *
 * What it works out each frame is a live value (liveParams.ts), never a
 * write into the project or the VJ launcher: the frame sync puts it on over
 * the stored value and the panels read it from there. The stored value is
 * left alone, so nothing that watches the stores wakes up every frame and a
 * saved project keeps its own values. Each Auto's playhead is kept here
 * too, by where it is, rather than written into the AutoConfig: it survives
 * a pause and an edit of the Auto, and reloading at any phase looks the
 * same.
 *
 * Two things still reach the stores, both once rather than every frame:
 *   - pausing an Auto keeps the value it stopped on (written once, as the
 *     stored value), as it did when the engine wrote every frame;
 *   - a keyframe track armed for an effect param still records what Auto
 *     plays into it.
 */

import { engineNowMs, renderClockActive } from '../recording/renderClock';
import { get } from 'svelte/store';
import { launchClockPosition } from '../stores/launchClock';
import { project } from '../stores/layers';
import { vjClipLauncher, vjClipLauncherNow } from '../stores/vjClipLauncher';
import { keyframeTimeline } from '../stores/keyframeTimeline';
import { showToast } from '../stores/errorToast';
import { runAsAutomation } from '../stores/historyHooks';
import { resolveAutoValue as resolveValue, advanceAutoPhase, autoClipPosition } from './autoWave';
import { LiveFrameWriter, clearLiveValues } from './liveParams';
import type { AutoConfig, Layer, Effect } from '../types';
import type { InteractiveScene } from '../mobile/studio/interactive';

// ─────────────────────────────────────────────────────────────────
// Tick loop
// ─────────────────────────────────────────────────────────────────

let rafId: number | null = null;
let lastTime = 0;
const live = new LiveFrameWriter('auto');

/** True while the tick loop is running. */
export function isAutoEngineRunning(): boolean {
  return rafId !== null;
}

/** Targets whose Auto failed, so each is reported once rather than every frame. */
const autoFailures = new Set<string>();
function reportAutoFailure(id: string, name: string, error: unknown) {
  if (autoFailures.has(id)) return;
  if (autoFailures.size > 256) autoFailures.clear();
  autoFailures.add(id);
  console.error(`[AutoEngine] Auto skipped for "${name}":`, error);
  showToast(`Auto is off for "${name}": its settings could not be read.`, 'warning');
}

// ─── Playheads ───────────────────────────────────────────────────
/** Each Auto's playhead by where it is (`map:<layerId>:fx:<effectId>:<param>`, …). */
interface Playhead { phase: number; playing: boolean }
/** Enough for every Auto in a big show; the oldest goes first past it. */
export const AUTO_PLAYHEAD_LIMIT = 4096;
const playheads = new Map<string, Playhead>();

interface FrameClock { dt: number; beat: number; crossfader: number | undefined }

/**
 * This frame's value of one Auto, or null when it is paused. The frame it is
 * paused, `onPause` gets the value it stopped on, once. `hold` keeps the
 * playhead where it is (a paused Interactive scene) and still gives its value.
 */
function autoValue(key: string, auto: AutoConfig, clock: FrameClock, clipPosition?: number, onPause?: (value: number) => void, hold = false): number | null {
  let head = playheads.get(key);
  if (!head) {
    if (playheads.size >= AUTO_PLAYHEAD_LIMIT) playheads.delete(playheads.keys().next().value as string);
    head = { phase: Number.isFinite(auto.phase) ? auto.phase : 0, playing: !!auto.playing };
    playheads.set(key, head);
  }
  if (!auto.playing) {
    if (head.playing) {
      head.playing = false;
      onPause?.(resolveValue(auto, head.phase));
    }
    return null;
  }
  head.playing = true;
  if (!hold) head.phase = advanceAutoPhase(auto, clock.dt, clock.beat, clock.crossfader, clipPosition, head.phase);
  return resolveValue(auto, head.phase);
}

/** An Auto's playhead as the engine has it (tests, panels). */
export function autoPlayhead(key: string): number | undefined {
  return playheads.get(key)?.phase;
}
export function autoPlayheadCount(): number {
  return playheads.size;
}

function tick(now: number) {
  rafId = requestAnimationFrame(tick);
  // Auto performs: nothing it writes is an undo step, except a recording
  // into an armed keyframe track (one step per take).
  runAsAutomation(() => autoStep(renderClockActive() ? engineNowMs() : now));
}

/** Effects of an Interactive scene: each Auto'd param as a live `interactive:` value. */
function driveInteractive(scene: InteractiveScene, keyBase: string, clock: FrameClock, hold: boolean, emit: (key: string, value: number) => void, onPause: (effectId: string, param: string, value: number) => void) {
  if (!Array.isArray(scene?.effects)) return;
  for (const e of scene.effects) {
    if (!e || typeof e.params !== 'object' || !e.params) continue;
    for (const [param, auto] of Object.entries(e.paramAuto ?? {})) {
      if (!auto) continue;
      const value = autoValue(`${keyBase}:interactive:${e.id}:${param}`, auto, clock, undefined, v => onPause(e.id, param, v), hold);
      if (value !== null) emit(`interactive:${e.id}:${param}`, value);
    }
  }
}

/** A scene with these effect params set (a paused Auto keeping its value). */
function sceneWithParams(scene: InteractiveScene, writes: Map<string, Record<string, number>>): InteractiveScene {
  return { ...scene, effects: scene.effects?.map(e => writes.has(e.id) ? { ...e, params: { ...e.params, ...writes.get(e.id) } } : e) };
}

function autoStep(now: number) {
  const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  if (dt <= 0 || !Number.isFinite(dt)) return;
  // One shared phase sample keeps all synced parameters aligned. Free sweeps
  // still skip stalls; beat sweeps catch up to the grid immediately.
  const vj = vjClipLauncherNow();
  const clock: FrameClock = {
    dt,
    beat: launchClockPosition(now).beat,
    crossfader: vj.crossfaderEnabled ? vj.crossfaderValue : undefined,
  };
  // Keyframe tracks armed to record (rare): Auto's effect values go into them.
  const armed = get(keyframeTimeline).armedTracks;
  const recording = Object.keys(armed).length > 0;
  const record = (owner: string, key: string, param: string, value: number) => {
    if (recording && armed[`${owner}:${key}`]) keyframeTimeline.autoRecord(owner, key, value, param, 'number');
  };
  // Pauses: the value each one stopped on, written once at the end.
  const pauses: Array<() => void> = [];

  const p = get(project);

  const advanceLayerAuto = (layer: Layer) => {
    const src = layer.source;
    const sourceId = src?.id;
    const clipPosition = autoClipPosition(src, now);
    const base = `map:${layer.id}`;
    const emit = (key: string, value: number) => live.layer(layer.id, sourceId, key, value);

    const interactive = src?.effectSource?.interactiveScene;
    if (interactive) {
      // A paused scene holds its Auto values where they are.
      const paused: Map<string, Record<string, number>> = new Map();
      driveInteractive(interactive, base, clock, !!src?.effectSource?.interactivePaused, emit,
        (effectId, param, value) => { const w = paused.get(effectId) ?? {}; w[param] = value; paused.set(effectId, w); });
      if (paused.size) pauses.push(() => project.update(q => ({ ...q, layers: q.layers.map(l => l.id === layer.id && l.source?.effectSource?.interactiveScene
        ? { ...l, source: { ...l.source, effectSource: { ...l.source.effectSource, interactiveScene: sceneWithParams(l.source.effectSource.interactiveScene, paused) } } }
        : l) })));
    }

    // Effects — paramAuto sidecar on each Effect
    for (const fx of layer.effects ?? []) {
      if (!fx.paramAuto) continue;
      for (const [paramName, auto] of Object.entries(fx.paramAuto)) {
        if (!auto) continue;
        const key = `fx:${fx.id}:${paramName}`;
        const value = autoValue(`${base}:${key}`, auto, clock, clipPosition,
          v => pauses.push(() => project.updateEffectParams(layer.id, fx.id, { [paramName]: v })));
        if (value === null) continue;
        emit(key, value);
        record(layer.id, key, paramName, value);
      }
    }

    // Edge effects — paramAuto keyed by dotted path (`stroke.width`,
    // `fill.speed`, top-level `opacity`), the keyframe `edge:` keys.
    for (const ee of layer.edgeEffects?.effects ?? []) {
      if (!ee.paramAuto) continue;
      for (const [path, auto] of Object.entries(ee.paramAuto)) {
        if (!auto) continue;
        const key = `edge:${ee.id}:${path}`;
        const value = autoValue(`${base}:${key}`, auto, clock, clipPosition, v => pauses.push(() => {
          const dot = path.indexOf('.');
          if (dot < 0) { project.updateEdgeEffect(layer.id, ee.id, { [path]: v } as any); return; }
          const top = path.slice(0, dot);
          const current = (get(project).layers.find(l => l.id === layer.id)?.edgeEffects?.effects.find(e => e.id === ee.id) as any)?.[top];
          if (current && typeof current === 'object') project.updateEdgeEffect(layer.id, ee.id, { [top]: { ...current, [path.slice(dot + 1)]: v } } as any);
        }));
        if (value !== null) emit(key, value);
      }
    }

    // Mapping shader params — shaderValueAuto on layer.source
    for (const [paramName, auto] of Object.entries(src?.shaderValueAuto ?? {})) {
      if (!auto) continue;
      const key = `shader:${paramName}`;
      const value = autoValue(`${base}:${key}`, auto, clock, clipPosition,
        v => pauses.push(() => project.batchUpdateLayerShaderValues(layer.id, { [paramName]: v })));
      if (value !== null) emit(key, value);
    }

    // GPU shader-layer params — paramAuto sidecar on gpuLayerContent.
    for (const [paramKey, auto] of Object.entries(layer.gpuLayerContent?.paramAuto ?? {})) {
      if (!auto) continue;
      const key = `gpu:${paramKey}`;
      const value = autoValue(`${base}:${key}`, auto, clock, clipPosition,
        v => pauses.push(() => project.updateGPULayerParams(layer.id, { [paramKey]: v })));
      if (value !== null) emit(key, value);
    }
  };
  for (const layer of p.layers) {
    if (!layer) continue;
    // A layer whose Auto data cannot be read is skipped and reported once.
    // It must not stop Auto for every layer after it.
    try {
      advanceLayerAuto(layer);
    } catch (error) {
      reportAutoFailure(layer.id, layer.name, error);
    }
  }

  // The final mix has no single clip playhead: position-driven Autos hold
  // here instead of silently choosing a deck or row.
  if (p.mappingComposition?.enabled) {
    for (const fx of p.mappingComposition.effects) {
      for (const [paramName, auto] of Object.entries(fx.paramAuto ?? {})) {
        if (!auto || auto.timing === 'clip') continue;
        const value = autoValue(`mapmix:${fx.id}:${paramName}`, auto, clock, undefined,
          v => pauses.push(() => project.updateMappingCompositionEffectParams(fx.id, { [paramName]: v })));
        if (value !== null) live.composition('map', fx.id, paramName, value);
      }
    }
  }
  for (const fx of vj.compositionEffects) {
    for (const [paramName, auto] of Object.entries(fx.paramAuto ?? {})) {
      if (!auto || auto.timing === 'clip') continue;
      const value = autoValue(`vjmix:${fx.id}:${paramName}`, auto, clock, undefined,
        v => pauses.push(() => vjClipLauncher.updateCompositionEffectParams(fx.id, { [paramName]: v })));
      if (value !== null) live.composition('vj', fx.id, paramName, value);
    }
  }

  // ──────────────────────────────────────────────────────────
  // VJ deck rows: the active clip's shader params and its own effects,
  // and the row's effects. Both decks are walked because the crossfader
  // can sit anywhere in between and both render. A row's values belong to
  // the clip it shows, so a new clip starts from its own.
  // ──────────────────────────────────────────────────────────
  const decks: Array<{ states: any; bank: 'A' | 'B' }> = [
    { states: vj.layerStates, bank: 'A' },
    { states: vj.bankBLayerStates, bank: 'B' },
  ];
  for (const { states, bank } of decks) {
    if (!states) continue;
    const advanceClipAuto = (i: number, layerState: any) => {
      const clip = layerState.activeClip;
      if (!clip?.id) return;
      const clipPosition = autoClipPosition(clip, now);
      const emit = (key: string, value: number) => live.deck(bank, i, clip.id, key, value);
      const column = layerState.activeColumn;

      const interactive = clip.effectSource?.interactiveScene;
      if (interactive && column !== null && column !== undefined) {
        const paused: Map<string, Record<string, number>> = new Map();
        driveInteractive(interactive, `vj:${clip.id}`, clock, !!clip.effectSource.interactivePaused, emit,
          (effectId, param, value) => { const w = paused.get(effectId) ?? {}; w[param] = value; paused.set(effectId, w); });
        if (paused.size) pauses.push(() => vjClipLauncher.updateClipEffectSource(i, column, { ...clip.effectSource, interactiveScene: sceneWithParams(interactive, paused) }, bank));
      }

      // (1) Shader params on the active clip
      for (const [paramName, auto] of Object.entries(clip.shaderValueAuto ?? {})) {
        const a = auto as AutoConfig;
        if (!a) continue;
        const value = autoValue(`vj:${clip.id}:shader:${paramName}`, a, clock, clipPosition,
          v => pauses.push(() => vjClipLauncher.batchUpdateShaderValues(i, { [paramName]: v }, bank)));
        if (value !== null) emit(`shader:${paramName}`, value);
      }

      // Clip-local effects retain their own automation through re-triggering.
      if (column !== null && column !== undefined) {
        for (const fx of (clip.effects ?? []) as Effect[]) {
          for (const [paramName, auto] of Object.entries(fx.paramAuto ?? {})) {
            if (!auto) continue;
            const value = autoValue(`vj:${clip.id}:fx:${fx.id}:${paramName}`, auto, clock, clipPosition,
              v => pauses.push(() => vjClipLauncher.updateClipEffectParams(i, column, fx.id, { [paramName]: v }, bank)));
            if (value !== null) emit(`fx:${fx.id}:${paramName}`, value);
          }
        }
      }

      // (2) Effect params on the row
      for (const fx of (layerState.effects ?? []) as Effect[]) {
        for (const [paramName, auto] of Object.entries(fx.paramAuto ?? {})) {
          const a = auto as AutoConfig;
          if (!a) continue;
          const key = `fx:${fx.id}:${paramName}`;
          const value = autoValue(`vj:${bank}:${i}:${key}`, a, clock, clipPosition,
            v => pauses.push(() => vjClipLauncher.updateLayerEffectParams(i, fx.id, { [paramName]: v }, bank)));
          if (value === null) continue;
          emit(key, value);
          record(`vj-${clip.id}`, key, paramName, value);
        }
      }
    };
    for (let i = 0; i < states.length; i++) {
      const layerState = states[i];
      if (!layerState) continue;
      try {
        advanceClipAuto(i, layerState);
      } catch (error) {
        const clip = layerState.activeClip;
        reportAutoFailure(`vj-${bank}-${i}-${clip?.id ?? ''}`, clip?.name ?? `VJ layer ${i + 1}`, error);
      }
    }
  }

  live.commit();
  for (const write of pauses) write();
}

/** For tests: run one frame at `now` ms. */
export function stepAutoForTest(now: number): void {
  runAsAutomation(() => autoStep(now));
}

/** For tests: forget the clock and every playhead. */
export function resetAutoForTest(): void {
  lastTime = 0;
  playheads.clear();
  clearLiveValues('auto');
}

/** Start the auto engine. Idempotent. */
export function startAutoEngine() {
  if (rafId !== null) return;
  lastTime = 0;
  rafId = requestAnimationFrame(tick);
}

/** Stop the auto engine. Idempotent. */
export function stopAutoEngine() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  // Its values go with it: the stored ones show again.
  clearLiveValues('auto');
}

// ─────────────────────────────────────────────────────────────────
// Helpers for UI sites
// ─────────────────────────────────────────────────────────────────

/** Create a new AutoConfig for a param. The UI calls this when the
 *  user picks Auto from the source dropdown; it seeds min/max to
 *  the param's natural range so the playhead sweeps the full slider
 *  out of the box. */
export function defaultAutoFor(paramMin: number, paramMax: number): AutoConfig {
  return {
    phase: 0,
    mode: 'loop',
    speedHz: 0.15,
    min: paramMin,
    max: paramMax,
    playing: true,
  };
}
