/**
 * Director State Snapshot — Builds a compact JSON summary of current app state
 * for the Director AI to reason about. Kept under ~1500 tokens.
 */

import { get } from 'svelte/store';
import { project } from '$lib/stores/layers';
import { vjClipLauncher } from '$lib/stores/vjClipLauncher';
import { audioStore } from '$lib/stores/audio';
import { settings } from '$lib/stores/settings';

export function buildStateSnapshot(): Record<string, any> {
  const proj = get(project);
  const vj = get(vjClipLauncher);
  const audio = get(audioStore);
  const s = get(settings);

  return {
    mode: vj.isOpen ? 'vj' : 'mapping',
    project: {
      name: proj.name || 'Untitled',
      width: proj.width || 1920,
      height: proj.height || 1080,
    },
    layers: proj.layers.map((l, i) => ({
      index: i,
      id: l.id,
      name: l.name,
      type: l.type,
      visible: l.visible,
      opacity: l.opacity,
      blendMode: l.blendMode,
      source: l.source ? {
        type: l.source.type,
        name: l.source.name,
        shader: l.source.shaderCode ? 'ISF' : undefined,
      } : null,
      shape: l.layerShape?.enabled ? l.layerShape.type : null,
      effectCount: l.effects?.length || 0,
      effects: l.effects?.map(e => e.type) || [],
      hasEdgeEffects: !!l.edgeEffects?.enabled,
      hasMask: !!l.mask?.enabled,
    })),
    vj: vj.isOpen ? {
      isLive: vj.isLive,
      numLayers: vj.numLayers,
      numColumns: vj.numColumns,
      masterOpacity: vj.masterOpacity,
      activeBlockId: vj.activeBlockId,
      layerStates: vj.layerStates.map((ls, i) => ({
        index: i,
        opacity: ls.opacity,
        blendMode: ls.blendMode,
        solo: ls.solo,
        mute: ls.mute,
        activeClip: ls.activeClip ? {
          name: ls.activeClip.name,
          type: ls.activeClip.type,
        } : null,
      })),
    } : null,
    audio: {
      bpm: audio.bpm || 0,
      amplitude: audio.amplitude || 0,
      micActive: audio.isActive || false,
    },
    defaultShader: s.defaultLayerShader || 'grid',
  };
}
