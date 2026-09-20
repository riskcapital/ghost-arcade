/**
 * Auto Engine — per-param playhead automation.
 *
 * Separate from the audio modulation engine because:
 *   - Audio modulation is REACTIVE (mic / band amplitude → param).
 *   - Auto is GENERATIVE: free sweeps advance at speedHz; beat-synced
 *     sweeps read the shared performance clock directly.
 *
 * Auto state lives directly on the data being automated:
 *   - `layer.effects[i].paramAuto[paramName]` for mapping effects
 *   - `layer.source.shaderValueAuto[paramName]` for mapping shader params
 *   - `clip.shaderValueAuto[paramName]` for VJ clip shader params
 *
 * This is the entire architecture. There's no separate routing
 * layer, no per-layer-index keying that breaks on reorder, no
 * "which target am I in" decision per frame. If there's an
 * AutoConfig on the thing, the engine animates it. Period.
 *
 * Phase advancement is mutated in-place on the AutoConfig object
 * because:
 *   1. Per-frame Svelte store rewrites for a counter are pointless
 *      UI churn — the renderer reads `effect.params` (the value we
 *      write to) directly, and the UI slider doesn't show phase.
 *   2. Pause/resume needs `phase` to survive, so it can't be purely
 *      in-memory either.
 *
 * The compromise: we mutate `phase` in place on every tick (cheap,
 * no store update) and rely on the snapshot/save path to pick up
 * whatever value is current when the user saves. Phase isn't
 * meaningful UI state — it's just "where in the sweep is the
 * playhead", and reloading at any phase produces visually
 * indistinguishable output.
 */

import { get } from 'svelte/store';
import { resolveAutoValue as resolveValue, advanceAutoPhase, autoClipPosition } from './autoWave';
import { launchClockPosition } from '../stores/launchClock';
import { project } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import type { AutoConfig, Layer, Effect } from '../types';

// ─────────────────────────────────────────────────────────────────
// Wave shaping
// ─────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────
// Tick loop
// ─────────────────────────────────────────────────────────────────

let rafId: number | null = null;
let lastTime = 0;

/** True while the tick loop is running. */
export function isAutoEngineRunning(): boolean {
  return rafId !== null;
}

function tick(now: number) {
  rafId = requestAnimationFrame(tick);
  const dt = lastTime === 0 ? 0 : (now - lastTime) / 1000;
  lastTime = now;
  if (dt <= 0 || !Number.isFinite(dt)) return;
  // One shared phase sample keeps all synced parameters aligned. Free sweeps
  // still skip stalls; beat sweeps catch up to the grid immediately.
  const beat = launchClockPosition(now).beat;
  const vj = get(vjClipLauncher);
  const crossfader = vj.crossfaderEnabled ? vj.crossfaderValue : undefined;

  const p = get(project);
  const layers = p.layers;

  // Batched writes to the layers store. We collect per-layer-per-effect
  // values, then commit at the end so a single layer with three auto
  // params only triggers one store update instead of three.
  type EffectBatch = Map<string, Record<string, number>>; // effectId → values
  const effectBatches = new Map<string, EffectBatch>();   // layerId → batches
  const shaderBatches = new Map<string, Record<string, number>>(); // layerId → values
  const gpuBatches = new Map<string, Record<string, number>>();    // layerId → gpu param values

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    if (!layer) continue;
    const clipPosition = autoClipPosition(layer.source, now);

    // Effects — paramAuto sidecar on each Effect
    if (layer.effects) {
      for (const fx of layer.effects) {
        if (!fx.paramAuto) continue;
        for (const [paramName, auto] of Object.entries(fx.paramAuto)) {
          if (!auto || !auto.playing) continue;
          auto.phase = advanceAutoPhase(auto, dt, beat, crossfader, clipPosition);
          const value = resolveValue(auto);
          // Bucket the write
          let layerEffectBatch = effectBatches.get(layer.id);
          if (!layerEffectBatch) {
            layerEffectBatch = new Map();
            effectBatches.set(layer.id, layerEffectBatch);
          }
          let fxValues = layerEffectBatch.get(fx.id);
          if (!fxValues) {
            fxValues = {};
            layerEffectBatch.set(fx.id, fxValues);
          }
          fxValues[paramName] = value;
        }
      }
    }

    // Edge effects — paramAuto keyed by dotted path
    // (`stroke.width`, `fill.speed`, `animation.count`, top-level
    // `opacity`). We write through project.updateEdgeEffect with the
    // same deep-merge pattern the audio modulation engine's edge
    // updater uses, so the two paths produce identical writes — the
    // autoEngine just supplies its own time-based signal instead of
    // the audio band amplitude.
    if (layer.edgeEffects?.effects) {
      for (const ee of layer.edgeEffects.effects) {
        if (!ee.paramAuto) continue;
        // Group nested writes by topKey so a single setter call
        // ('stroke': {...all stroke.* in one merge...}) covers every
        // animated param on that subobject. Same shape as the audio
        // engine's edge writes — only the value source differs.
        const topLevelWrites: Record<string, number> = {};
        const subWrites: Record<string, Record<string, number>> = {};
        for (const [path, auto] of Object.entries(ee.paramAuto)) {
          if (!auto || !auto.playing) continue;
          auto.phase = advanceAutoPhase(auto, dt, beat, crossfader, clipPosition);
          const value = resolveValue(auto);
          const dot = path.indexOf('.');
          if (dot < 0) {
            topLevelWrites[path] = value;
          } else {
            const topKey = path.slice(0, dot);
            const nestedKey = path.slice(dot + 1);
            (subWrites[topKey] ||= {})[nestedKey] = value;
          }
        }
        // Commit
        if (Object.keys(topLevelWrites).length > 0) {
          project.updateEdgeEffect(layer.id, ee.id, topLevelWrites as any);
        }
        for (const [topKey, kvs] of Object.entries(subWrites)) {
          const currentTop = (ee as any)[topKey];
          if (!currentTop || typeof currentTop !== 'object') continue;
          project.updateEdgeEffect(layer.id, ee.id, {
            [topKey]: { ...currentTop, ...kvs },
          } as any);
        }
      }
    }

    // Mapping shader params — shaderValueAuto on layer.source
    if (layer.source?.shaderValueAuto) {
      for (const [paramName, auto] of Object.entries(layer.source.shaderValueAuto)) {
        if (!auto || !auto.playing) continue;
        auto.phase = advanceAutoPhase(auto, dt, beat, crossfader, clipPosition);
        const value = resolveValue(auto);
        let batch = shaderBatches.get(layer.id);
        if (!batch) {
          batch = {};
          shaderBatches.set(layer.id, batch);
        }
        batch[paramName] = value;
      }
    }

    // GPU shader-layer params — paramAuto sidecar on gpuLayerContent.
    if (layer.gpuLayerContent?.paramAuto) {
      for (const [paramKey, auto] of Object.entries(layer.gpuLayerContent.paramAuto)) {
        if (!auto || !auto.playing) continue;
        auto.phase = advanceAutoPhase(auto, dt, beat, crossfader, clipPosition);
        const value = resolveValue(auto);
        let batch = gpuBatches.get(layer.id);
        if (!batch) {
          batch = {};
          gpuBatches.set(layer.id, batch);
        }
        batch[paramKey] = value;
      }
    }
  }

  if (p.mappingComposition?.enabled) {
    for (const fx of p.mappingComposition.effects) {
      if (!fx.paramAuto) continue;
      const writes: Record<string, number> = {};
      for (const [paramName, auto] of Object.entries(fx.paramAuto)) {
        if (!auto?.playing || auto.timing === 'clip') continue;
        auto.phase = advanceAutoPhase(auto, dt, beat, crossfader);
        writes[paramName] = resolveValue(auto);
      }
      if (Object.keys(writes).length) project.updateMappingCompositionEffectParams(fx.id, writes);
    }
  }

  // Commit effect writes
  for (const [layerId, effectBatch] of effectBatches) {
    for (const [effectId, values] of effectBatch) {
      project.updateEffectParams(layerId, effectId, values);
    }
  }
  // Commit shader writes
  for (const [layerId, values] of shaderBatches) {
    project.batchUpdateLayerShaderValues(layerId, values);
  }
  // Commit GPU param writes (mapping-only).
  for (const [layerId, values] of gpuBatches) {
    project.updateGPULayerParams(layerId, values);
  }

  // ──────────────────────────────────────────────────────────
  // VJ deck slots — two automation surfaces:
  //   1. Clip shader params: `clip.shaderValueAuto` on each deck's
  //      active clip. Drives ISF inputs through batchUpdateShaderValues.
  //   2. Layer effect params: `effect.paramAuto` on each effect in
  //      the deck slot's effects array. Drives effect uniforms through
  //      updateLayerEffectParams.
  // Both banks (A + B) are walked because the crossfader can sit
  // anywhere in between and both decks render.
  // ──────────────────────────────────────────────────────────
  // The final VJ mix has no single clip playhead. Position-driven presets
  // hold here instead of silently choosing a deck or row.
  for (const fx of vj.compositionEffects) {
    if (!fx.paramAuto) continue;
    const writes: Record<string, number> = {};
    for (const [paramName, auto] of Object.entries(fx.paramAuto)) {
      if (!auto?.playing || auto.timing === 'clip') continue;
      auto.phase = advanceAutoPhase(auto, dt, beat, crossfader);
      writes[paramName] = resolveValue(auto);
    }
    if (Object.keys(writes).length) vjClipLauncher.updateCompositionEffectParams(fx.id, writes);
  }

  const decks: Array<{ states: any; bank: 'A' | 'B' }> = [
    { states: vj.layerStates, bank: 'A' },
    { states: vj.bankBLayerStates, bank: 'B' },
  ];
  for (const { states, bank } of decks) {
    if (!states) continue;
    for (let i = 0; i < states.length; i++) {
      const layerState = states[i];
      if (!layerState) continue;

      // (1) Shader params on the active clip
      const clip = layerState.activeClip;
      const clipPosition = autoClipPosition(clip, now);
      if (clip?.shaderValueAuto) {
        const writes: Record<string, number> = {};
        let any = false;
        for (const [paramName, auto] of Object.entries(clip.shaderValueAuto)) {
          const a = auto as AutoConfig;
          if (!a || !a.playing) continue;
          a.phase = advanceAutoPhase(a, dt, beat, crossfader, clipPosition);
          writes[paramName] = resolveValue(a);
          any = true;
        }
        if (any) {
          vjClipLauncher.batchUpdateShaderValues(i, writes, bank);
        }
      }

      // Clip-local effects retain their own automation through re-triggering.
      if (clip?.effects && layerState.activeColumn !== null) {
        for (const fx of clip.effects as Effect[]) {
          if (!fx.paramAuto) continue;
          const writes: Record<string, number> = {};
          for (const [paramName, auto] of Object.entries(fx.paramAuto)) {
            if (!auto?.playing) continue;
            auto.phase = advanceAutoPhase(auto, dt, beat, crossfader, clipPosition);
            writes[paramName] = resolveValue(auto);
          }
          if (Object.keys(writes).length) {
            vjClipLauncher.updateClipEffectParams(i, layerState.activeColumn, fx.id, writes, bank);
          }
        }
      }

      // (2) Effect params on the layer slot
      if (layerState.effects && layerState.effects.length > 0) {
        for (const fx of layerState.effects) {
          if (!fx.paramAuto) continue;
          const writes: Record<string, number> = {};
          let any = false;
          for (const [paramName, auto] of Object.entries(fx.paramAuto)) {
            const a = auto as AutoConfig;
            if (!a || !a.playing) continue;
            a.phase = advanceAutoPhase(a, dt, beat, crossfader, clipPosition);
            writes[paramName] = resolveValue(a);
            any = true;
          }
          if (any) {
            vjClipLauncher.updateLayerEffectParams(i, fx.id, writes, bank);
          }
        }
      }
    }
  }
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
