/**
 * Applies a beat scramble to the VJ decks: the shader params of the clip
 * each visible layer plays and/or the effects on those clips, their layers
 * and the master chain. The scramble maths lives in beatScramble.ts.
 */

import { get } from 'svelte/store';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { parseISF, type ISFInput } from '../isf/parser';
import { EFFECT_PARAM_DEFS } from '../effects/effectParamDefs';
import type { Effect } from '../types';
import { onAirDecks, scrambleEffectParams, scrambleShaderInput, type ScrambleTarget } from './beatScramble';

const inputCache = new Map<string, ISFInput[]>();
function shaderInputs(code: string): ISFInput[] {
  let inputs = inputCache.get(code);
  if (!inputs) {
    try { inputs = (parseISF(code)?.metadata?.INPUTS ?? []) as ISFInput[]; } catch { inputs = []; }
    if (inputCache.size > 64) inputCache.clear();
    inputCache.set(code, inputs);
  }
  return inputs;
}

/** Scramble what is on screen now. */
export function scrambleNow(target: ScrambleTarget, amount: number) {
  const state = get(vjClipLauncher);
  const shaders = target !== 'fx';
  const fx = target !== 'shader';
  for (const deck of onAirDecks(state.crossfaderEnabled, state.crossfaderValue)) {
    const layers = deck === 'B' ? state.bankBLayerStates : state.layerStates;
    layers.forEach((layer, index) => {
      if (layer.mute || layer.opacity <= 0) return;
      const clip = layer.activeClip;
      if (shaders && clip?.type === 'shader' && clip.shaderCode) {
        const values: Record<string, unknown> = {};
        for (const input of shaderInputs(clip.shaderCode)) {
          // Performer's bridge params belong to Performer, as on Tab.
          if (input.NAME.startsWith('sv')) continue;
          const next = scrambleShaderInput(input, clip.shaderValues?.[input.NAME], amount);
          if (next !== null) values[input.NAME] = next;
        }
        if (Object.keys(values).length) vjClipLauncher.updateActiveClipShaderValues(index, values, deck);
      }
      if (!fx) return;
      for (const effect of clip?.effects ?? []) {
        const patch = effectPatch(effect, amount);
        if (patch) vjClipLauncher.updateActiveClipEffectParams(index, effect.id, patch, deck);
      }
      for (const effect of layer.effects ?? []) {
        const patch = effectPatch(effect, amount);
        if (patch) vjClipLauncher.updateLayerEffectParams(index, effect.id, patch, deck);
      }
    });
  }
  if (fx) {
    for (const effect of state.compositionEffects ?? []) {
      const patch = effectPatch(effect, amount);
      if (patch) vjClipLauncher.updateCompositionEffectParams(effect.id, patch);
    }
  }
}

function effectPatch(effect: Effect, amount: number): Record<string, number> | null {
  if (effect.enabled === false) return null;
  const defs = EFFECT_PARAM_DEFS[effect.type];
  if (!defs?.length) return null;
  const patch = scrambleEffectParams(defs, (effect.params ?? {}) as Record<string, unknown>, amount);
  return Object.keys(patch).length ? patch : null;
}
