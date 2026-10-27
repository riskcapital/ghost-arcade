// MIDI Router - Routes MIDI messages to correct store update functions
// Uses a prebuilt lookup table for O(1) dispatch with 16ms throttle per path
import { get } from 'svelte/store';
import { midiStore } from './midiStore';
import { project, selectedLayer } from '../stores/layers';
import { vjClipLauncher } from '../stores/vjClipLauncher';
import { synthVisionStore } from '../stores/synthVision';
import type { SVParamKey } from '../stores/synthVision';
import { setBaseValue as setModulationBase } from '../audio/modulation';
import type { MidiMapping, MidiMessageType } from './midiTypes';
import type { BlendMode } from '../types';
import { getPluginByEffectType } from '../plugins/registry';
import { controlPathAsWritten, matchControlKey, normalizeControlPath } from '../control/controlPaths';
import { releaseTempoNudgeInputs, setTempoNudgeInput, resyncLaunchClock } from '../stores/launchClock';
import { clipAudio, clipAudioMaster } from '../audio/clipAudio';
import { runAsLiveControl } from '../stores/historyHooks';

// Controller, OSC, DMX and keyboard writes are performance, not edits: they
// must not become undo steps (a fader would fill the undo history in a
// second and push the real edits out of it).
const LIVE = { history: false } as const;

// Prebuilt lookup: "cc:74" -> [MidiMapping, ...]
// Rebuilt automatically when mappings change
let lookupMap = new Map<string, MidiMapping[]>();
let lastMappingsRef: MidiMapping[] = [];

function rebuildLookup(mappings: MidiMapping[]) {
  lookupMap.clear();
  for (const m of mappings) {
    const key = `${m.type}:${m.number}`;
    const existing = lookupMap.get(key);
    if (existing) {
      existing.push(m);
    } else {
      lookupMap.set(key, [m]);
    }
  }
  lastMappingsRef = mappings;
}

// Subscribe to store changes to rebuild lookup
midiStore.subscribe(state => {
  if (state.mappings !== lastMappingsRef) {
    rebuildLookup(state.mappings);
  }
});

// Throttle: track last update time per path to avoid flooding stores
const lastUpdateTime = new Map<string, number>();
const THROTTLE_MS = 16; // ~60fps max update rate
// The last value to arrive inside a throttle window is delivered when the
// window ends. Dropping it lost the end of a fast move (a crossfader or knob
// slammed to its end stopped a few percent short) and a pad released within
// a frame of being hit stayed pressed.
const trailingUpdates = new Map<string, ReturnType<typeof setTimeout>>();

// User interaction suppression: when user is manually dragging a slider,
// suppress MIDI updates for that path to prevent fighting/jumping
const userInteractingPaths = new Map<string, number>(); // path -> suppress-until timestamp
const USER_INTERACT_SUPPRESS_MS = 250;

/** Call this when user starts interacting with a MIDI-mappable control */
export function markUserInteracting(path: string, durationMs = USER_INTERACT_SUPPRESS_MS) {
  userInteractingPaths.set(path, performance.now() + durationMs);
}

/**
 * Late-bound macro-value setter. macros.ts calls registerMacroValueSetter
 * once on its module load, and the router uses the closure for the
 * `vj:macro:N:value` path. Avoids a circular import (macros.ts imports
 * midiRouter to use its public dispatchPath).
 */
let _macroValueSetter: ((macroId: string, value: number) => void) | null = null;
export function registerMacroValueSetter(setter: (macroId: string, value: number) => void) {
  _macroValueSetter = setter;
}

/**
 * Late-bound snapshot recaller — same pattern as macros. snapshots.ts
 * registers on import so the router can recall a slot via MIDI without
 * a circular dependency. Index is 0-indexed.
 */
let _snapshotRecaller: ((index: number) => void) | null = null;
export function registerSnapshotRecaller(recaller: (index: number) => void) {
  _snapshotRecaller = recaller;
}

/**
 * Late-bound cue list control for `show:go`, `show:back`, `show:stop`,
 * `show:reset` and `show:cue:<index>`. Registered by the show-control
 * runtime so the router does not import the cue engine. Fires on the rising
 * edge only (value > 0), like a pad.
 */
export type ShowControlAction = 'go' | 'back' | 'stop' | 'reset' | { cue: number };
let _showControl: ((action: ShowControlAction) => void) | null = null;
export function registerShowControl(handler: ((action: ShowControlAction) => void) | null) {
  _showControl = handler;
}

class MidiRouter {
  /** Let go of anything an input was holding (a held tempo nudge). */
  public releaseInputs(prefix: string) { releaseTempoNudgeInputs(prefix); }

  private dispatchShow(parts: string[], value: number) {
    if (!(value > 0) || !_showControl) return;
    const action = parts[1];
    if (action === 'go' || action === 'back' || action === 'stop' || action === 'reset') {
      _showControl(action);
    } else if (action === 'cue' && /^\d+$/.test(parts[2] ?? '')) {
      _showControl({ cue: Number(parts[2]) });
    }
  }

  routeMessage(channel: number, type: MidiMessageType, number: number, value: number) {
    const key = `${type}:${number}`;
    const mappings = lookupMap.get(key);
    if (!mappings || mappings.length === 0) return;

    const now = performance.now();

    for (const mapping of mappings) {
      // Channel filter
      if (mapping.channel !== -1 && mapping.channel !== channel) continue;

      // Tempo nudges are held: the press and the release both have to land.
      const isTempoNudge = /^vj:tempo:(nudge-up|nudge-down|resync)$/.test(normalizeControlPath(mapping.path));
      const inputId = `midi:${mapping.id}:${channel}:${number}`;
      if (isTempoNudge) {
        this.dispatch(mapping.path, type === 'note' && value === 0 ? 0 : this.convertValue(value, mapping, type), mapping, inputId);
        continue;
      }

      // Throttle check
      const wait = THROTTLE_MS - (now - (lastUpdateTime.get(mapping.path) || 0));
      clearTimeout(trailingUpdates.get(mapping.path));
      trailingUpdates.delete(mapping.path);
      if (wait > 0) {
        trailingUpdates.set(mapping.path, setTimeout(() => {
          trailingUpdates.delete(mapping.path);
          const at = performance.now();
          lastUpdateTime.set(mapping.path, at);
          if (at < (userInteractingPaths.get(mapping.path) || 0)) return;
          this.dispatch(mapping.path, this.convertValue(value, mapping, type), mapping, inputId);
        }, wait));
        continue;
      }
      lastUpdateTime.set(mapping.path, now);

      // User interaction suppression — skip if user is manually dragging this control
      const suppressUntil = userInteractingPaths.get(mapping.path) || 0;
      if (now < suppressUntil) continue;

      // Convert MIDI value to target range
      const targetValue = this.convertValue(value, mapping, type);

      // Dispatch to correct store
      this.dispatch(mapping.path, targetValue, mapping, inputId);
    }
  }

  private convertValue(rawValue: number, mapping: MidiMapping, type: MidiMessageType): number {
    if (mapping.mode === 'toggle') {
      // For note: on/off. For CC: > 64 = on, <= 64 = off
      if (type === 'note') return rawValue > 0 ? 1 : 0;
      return rawValue > 64 ? 1 : 0;
    }

    if (mapping.mode === 'relative') {
      // Relative encoders: 65-127 = increment, 1-63 = decrement
      return rawValue >= 64 ? rawValue - 128 : rawValue;
    }

    // Absolute mode
    let normalized: number;
    if (type === 'pitchbend') {
      normalized = rawValue / 16383; // 14-bit
    } else {
      normalized = rawValue / 127; // 7-bit CC
    }

    // Map to target range
    let result = mapping.min + normalized * (mapping.max - mapping.min);

    // Quantize to step if specified
    if (mapping.step > 0) {
      result = Math.round(result / mapping.step) * mapping.step;
    }

    // Clamp to range
    result = Math.max(mapping.min, Math.min(mapping.max, result));

    return result;
  }

  /**
   * Public path dispatch — used by the macro engine (and any future
   * automation system) to write a value to any MIDI-routable parameter
   * without going through a real MIDI message. Synthesizes a minimal
   * mapping so the existing per-scope dispatchers can reuse their
   * routing logic verbatim. Caller passes the value already in the
   * target parameter's natural range (e.g. opacity 0..1, transition
   * index 0..9), so we route through `dispatch` with an identity
   * mapping (min=0, max=1, no step, absolute mode).
   *
   * `discreteValues` lets callers target the discrete-cycle params
   * (e.g. crossfader transition, blend mode) with named values.
   */
  /**
   * `layerId` aims a mapping-mode path (map:…) at that layer instead of
   * whichever layer is selected: gesture bindings keep driving the layer
   * they were made on.
   */
  public dispatchPath(path: string, value: number, opts: { discreteValues?: string[]; inputId?: string; layerId?: string } = {}) {
    const mapping: MidiMapping = {
      id: '__macro__',
      channel: -1,
      type: 'cc',
      number: 0,
      path,
      min: 0,
      max: 1,
      step: 0,
      mode: 'absolute',
      label: 'macro',
      discreteValues: opts.discreteValues,
    };
    try {
      this.dispatch(path, value, mapping, opts.inputId ?? `path:${opts.layerId ? `${opts.layerId}:` : ''}${path}`, opts.layerId);
    } catch (err) {
      console.warn(`[MIDI Router] dispatchPath failed for ${path}:`, err);
    }
  }

  private dispatch(path: string, value: number, mapping: MidiMapping, inputId?: string, layerId?: string) {
    // Everything that reaches the router (controllers, OSC, DMX, keyboard,
    // gestures, show control, macro knobs) is performance: nothing it
    // changes becomes an undo step, except a recording into an armed
    // keyframe track, which is one step per take.
    runAsLiveControl(() => this.dispatchLive(path, value, mapping, inputId, layerId));
  }

  private dispatchLive(path: string, value: number, mapping: MidiMapping, inputId?: string, layerId?: string) {
    // Keywords match on the lowercased path; names (params, effects,
    // groups) are read from `names`, which keeps the spelling.
    const names = controlPathAsWritten(path).split(':');
    path = normalizeControlPath(path);
    const parts = path.split(':');
    const scope = parts[0]; // 'map', 'vj', 'vj-b', 'sv'

    try {
      switch (scope) {
        case 'map':
          this.dispatchMapping(parts, value, mapping, layerId, names);
          break;
        case 'show':
          this.dispatchShow(parts, value);
          break;
        case 'vj':
          // Bank A is the canonical deck — most controllers use this scope.
          this.dispatchVJ(parts, value, mapping, 'A', inputId, names);
          break;
        case 'vj-b':
          // Bank B parallels vj: opacity / solo / mute / trigger / column /
          // block all route to bankBLayerStates + bankBClipGrid via the
          // same dispatcher with bank='B'. Same path shape minus the scope.
          this.dispatchVJ(parts, value, mapping, 'B', undefined, names);
          break;
        case 'sv':
          this.dispatchPerformer(parts, value, mapping, names);
          break;
      }
    } catch (err) {
      console.warn(`[MIDI Router] Error dispatching to ${path}:`, err);
    }
  }

  private dispatchMapping(parts: string[], value: number, mapping: MidiMapping, layerId?: string, names: string[] = parts) {
    // parts: ['map', contentType, property]
    // contentType: 'splat', 'model3d', 'layer', 'preset'
    const contentType = parts[1];

    // Mapping preset switching: map:preset:<index>
    if (contentType === 'preset') {
      const presetIdx = parseInt(parts[2], 10);
      if (!isNaN(presetIdx) && value > 0) {
        window.dispatchEvent(new CustomEvent('midi-mapping-preset', { detail: { index: presetIdx } }));
      }
      return;
    }

    // Mapping Composition stage-effect momentary fire: map:stage-effect:<effectId>:hold
    if (contentType === 'stage-effect') {
      const effectId = parts[2];
      const action = parts[3];
      if (effectId && action === 'hold') {
        window.dispatchEvent(new CustomEvent('map-stage-effect-hold', {
          detail: { effectId, pressed: value > 0, value },
        }));
      }
      return;
    }

    const property = parts.slice(2).join('.'); // supports nested like 'echo.count'
    // The property as written, for the content fields it names.
    const exactProperty = names.slice(2).join('.');
    const layer = layerId
      ? get(project).layers.find((candidate) => candidate.id === layerId) ?? null
      : get(selectedLayer);
    if (!layer) return;

    // Mapping media transport: map:media:play|restart|position
    // These actions target the selected layer's live media object so they
    // work outside VJ mode as well as from OSC/MIDI learn.
    if (contentType === 'media') {
      const source = layer.source;
      const video = source?.videoElement;
      if (!source || source.type !== 'video' || !video) return;

      const trimStart = Math.max(0, Math.min(1, source.trimStart ?? 0));
      const trimEnd = Math.max(trimStart, Math.min(1, source.trimEnd ?? 1));
      const startTime = Number.isFinite(video.duration) ? video.duration * trimStart : 0;

      if (property === 'play' && value > 0) {
        const shouldPlay = video.paused || source.isPlaying === false;
        project.setLayerSource(layer.id, { ...source, isPlaying: shouldPlay }, LIVE);
        if (shouldPlay) void video.play().catch(() => undefined);
        else video.pause();
      } else if (property === 'restart' && value > 0) {
        video.currentTime = startTime;
        project.setLayerSource(layer.id, { ...source, isPlaying: true }, LIVE);
        void video.play().catch(() => undefined);
      } else if (property === 'position') {
        const normalized = Math.max(0, Math.min(1, value));
        const sourcePosition = trimStart + normalized * (trimEnd - trimStart);
        if (Number.isFinite(video.duration)) video.currentTime = video.duration * sourcePosition;
      }
      return;
    }

    // Layer-level properties (opacity, etc.)
    if (contentType === 'layer') {
      const layerKey = matchControlKey(exactProperty, layer);
      if (mapping.mode === 'toggle') {
        const current = (layer as any)[layerKey];
        project.updateLayer(layer.id, { [layerKey]: !current }, LIVE);
      } else {
        project.updateLayer(layer.id, { [layerKey]: value }, LIVE);
      }
      return;
    }

    // Handle toggle mode for content properties
    if (mapping.mode === 'toggle') {
      if (contentType === 'splat' && layer.splatContent) {
        const key = matchControlKey(exactProperty, layer.splatContent);
        const current = (layer.splatContent as any)[key];
        project.updateSplatContent(layer.id, { [key]: !current });
      } else if (contentType === 'model3d' && layer.model3dContent) {
        const key = matchControlKey(exactProperty, layer.model3dContent);
        const current = (layer.model3dContent as any)[key];
        project.updateModel3DContent(layer.id, { [key]: !current });
      } else if (contentType === 'plugin') {
        // Handled below so plugin toggles can flip source.effectSource params.
      } else {
        return;
      }
      if (contentType !== 'plugin') return;
    }

    // Handle discrete values (dropdowns/selects)
    if (mapping.discreteValues && mapping.discreteValues.length > 0) {
      const index = Math.round(value);
      const discreteVal = mapping.discreteValues[Math.min(index, mapping.discreteValues.length - 1)];
      if (contentType === 'splat') {
        project.updateSplatContent(layer.id, { [matchControlKey(exactProperty, layer.splatContent)]: discreteVal });
        return;
      } else if (contentType === 'model3d') {
        project.updateModel3DContent(layer.id, { [matchControlKey(exactProperty, layer.model3dContent)]: discreteVal });
        return;
      }
      if (contentType !== 'plugin') return;
    }

    // Effect parameters: map:effect:<effectId>:<paramName>
    if (contentType === 'effect') {
      const writtenId = names[2];
      const effect = (layer.effects ?? []).find((candidate: any) => candidate.id === writtenId)
        ?? (layer.effects ?? []).find((candidate: any) => String(candidate.id).toLowerCase() === parts[2]);
      const paramName = names[3];
      if (effect && paramName) {
        project.updateEffectParams(layer.id, effect.id, { [matchControlKey(paramName, (effect as any).params)]: value });
      }
      return;
    }

    // GPU shader-layer params: map:gpu:<paramKey>
    // Writes through to layer.gpuLayerContent.params[paramKey] — same
    // path GPULayerPanel uses. Handles toggles (mode=toggle), discrete
    // dropdowns (mapping.discreteValues), and continuous values.
    // Special: paramKeys starting with `__` are layer-level GPU content
    // fields (bgOpacity, etc.) rather than per-shader params, so they
    // route through updateGPULayerContent instead.
    if (contentType === 'gpu') {
      const writtenKey = names.slice(2).join(':');
      const paramKey = writtenKey.startsWith('__')
        ? `__${matchControlKey(writtenKey.slice(2), layer.gpuLayerContent)}`
        : matchControlKey(writtenKey, layer.gpuLayerContent?.params);
      if (!paramKey) return;
      if (!layer.gpuLayerContent) return;
      let next: any = value;
      if (mapping.discreteValues && mapping.discreteValues.length > 0) {
        const idx = Math.round(value);
        next = mapping.discreteValues[Math.max(0, Math.min(mapping.discreteValues.length - 1, idx))];
      }
      if (paramKey.startsWith('__')) {
        const fieldName = paramKey.slice(2);
        project.updateGPULayerContent(layer.id, { [fieldName]: next } as any);
      } else {
        project.updateGPULayerParams(layer.id, { [paramKey]: next });
      }
      return;
    }

    // Shader uniforms: map:shader:<paramName>
    // Writes through to layer.source.shaderValues[paramName] — same path
    // MediaTray's slider uses. The shader engine reads shaderValues each
    // frame so changes show up immediately on the rendered output.
    if (contentType === 'shader') {
      if (!layer.source?.shaderValues) return;
      const paramName = matchControlKey(names.slice(2).join(':'), layer.source.shaderValues);
      if (!paramName) return;
      project.setLayerSource(layer.id, {
        ...layer.source,
        shaderValues: { ...layer.source.shaderValues, [paramName]: value },
      }, LIVE);
      return;
    }

    // Plugin params: map:plugin:<paramKey>
    // Updates the selected layer's source.effectSource — same path the
    // PluginLayerPanel uses for its sliders/toggles. By this point the
    // earlier branches have already narrowed mapping.mode away from
    // 'toggle' (that flow returns above), so we only need to handle
    // continuous and discrete-select values here. A MediaPipe binding
    // that wants toggle-style behaviour should use binding mode='latch'
    // which dispatches a flipping 0/1.
    if (contentType === 'plugin') {
      if (!layer.source?.effectSource) return;
      const paramKey = matchControlKey(names.slice(2).join(':'), layer.source.effectSource);
      if (!paramKey) return;
      if (mapping.mode === 'toggle' && value <= 0) return;
      const next = this.resolvePluginParamValue(layer.source.effectSource, paramKey, value, mapping);
      project.setLayerSource(layer.id, {
        ...layer.source,
        effectSource: { ...layer.source.effectSource, [paramKey]: next } as any,
      }, LIVE);
      return;
    }

    // Continuous value
    if (contentType === 'splat') {
      project.updateSplatContent(layer.id, { [matchControlKey(exactProperty, layer.splatContent)]: value });
    } else if (contentType === 'model3d') {
      // Handle nested properties (echo.count, camera.distance, audio.scaleResponse, etc.)
      if (exactProperty.includes('.')) {
        const dotParts = exactProperty.split('.');
        const parent = matchControlKey(dotParts[0], layer.model3dContent);
        const currentParent = (layer.model3dContent as any)?.[parent] || {};
        const child = matchControlKey(dotParts[1], currentParent);
        project.updateModel3DContent(layer.id, { [parent]: { ...currentParent, [child]: value } } as any);
      } else {
        project.updateModel3DContent(layer.id, { [matchControlKey(exactProperty, layer.model3dContent)]: value } as any);
      }
    }
  }

  private dispatchVJ(parts: string[], value: number, mapping: MidiMapping, bank: 'A' | 'B' = 'A', inputId?: string, names: string[] = parts) {
    // parts: ['vj' | 'vj-b', layerIndex|'master'|'crossfader'|..., property, ...]
    const layerPart = parts[1];
    const property = parts[2];

    // Beat clock: hold nudge-up / nudge-down to bend the tempo, resync makes
    // now the downbeat (rising edge).
    if (layerPart === 'tempo' && ['nudge-up', 'nudge-down', 'resync'].includes(property)) {
      if (property === 'resync') { if (value > 0) resyncLaunchClock(); }
      else setTempoNudgeInput(inputId ?? `path:${parts.join(':')}`, value > 0 ? (property === 'nudge-up' ? 1 : -1) : 0);
      return;
    }

    // VJ Mode toggle: vj:mode. Rising edge enters/leaves the full VJ
    // workspace so controller users can return to regular mapping mode
    // without reaching for the UI.
    if (layerPart === 'mode' && bank === 'A') {
      if (value > 0) {
        const state = get(vjClipLauncher);
        const enable = !(state.isOpen || state.isLive);
        if (!enable) vjClipLauncher.stopAll();
        vjClipLauncher.setOpen(enable);
        vjClipLauncher.setLive(enable);
      }
      return;
    }

    if (layerPart === 'master') {
      // Clip audio master (the deck bar's Audio Out).
      const audio = property?.toLowerCase();
      if (audio === 'audiovolume') clipAudio.setMasterVolume(value);
      if (audio === 'audiomute' && value > 0) clipAudio.setMasterMuted(!get(clipAudioMaster).muted);
      if (property === 'opacity') {
        vjClipLauncher.setMasterOpacity(value);
      }
      return;
    }

    // ===== Crossfader controls (always Bank-A scope, ignored under vj-b) =====
    // The fader / transition / cut-A/B are global — they don't belong to one
    // bank. Under vj-b: prefix we silently no-op so users can still route
    // these via the canonical vj:crossfader:* paths.
    if (layerPart === 'crossfader' && bank === 'A') {
      switch (property) {
        case 'enabled':
          // Toggle on rising edge; treat any non-zero as "press"
          if (value > 0) {
            const cur = get(vjClipLauncher).crossfaderEnabled;
            vjClipLauncher.setCrossfaderEnabled(!cur);
          }
          return;
        case 'value':
          // Continuous fader — accepts mapped 0..1
          vjClipLauncher.setCrossfaderValue(value);
          return;
        case 'transition': {
          // Discrete: cycles through transition list using mapping.discreteValues
          // (defined on the data-midi-discrete dropdown). Falls back to numeric
          // index → name lookup if no discreteValues provided.
          const transitions = ['dissolve','wipe','rgb-split','cube','shatter','halftone','glitch','liquid','strobe','slide'] as const;
          if (mapping.discreteValues && mapping.discreteValues.length > 0) {
            const idx = Math.round(value);
            const name = mapping.discreteValues[Math.min(idx, mapping.discreteValues.length - 1)];
            if (typeof name === 'string') vjClipLauncher.setCrossfaderTransition(name as any);
          } else {
            const idx = Math.max(0, Math.min(transitions.length - 1, Math.round(value)));
            vjClipLauncher.setCrossfaderTransition(transitions[idx]);
          }
          return;
        }
        case 'curve': {
          const curves = ['linear','constant-power','sharp-cut'] as const;
          if (mapping.discreteValues && mapping.discreteValues.length > 0) {
            const idx = Math.round(value);
            const name = mapping.discreteValues[Math.min(idx, mapping.discreteValues.length - 1)];
            if (typeof name === 'string') vjClipLauncher.setCrossfaderCurve(name as any);
          } else {
            const idx = Math.max(0, Math.min(curves.length - 1, Math.round(value)));
            vjClipLauncher.setCrossfaderCurve(curves[idx]);
          }
          return;
        }
        case 'blendmode': {
          const modes = ['normal','multiply','screen','add','difference','darken','lighten','overlay','exclusion'] as const;
          if (mapping.discreteValues && mapping.discreteValues.length > 0) {
            const idx = Math.round(value);
            const name = mapping.discreteValues[Math.min(idx, mapping.discreteValues.length - 1)];
            if (typeof name === 'string') vjClipLauncher.setCrossfaderBlendMode(name as any);
          } else {
            const idx = Math.max(0, Math.min(modes.length - 1, Math.round(value)));
            vjClipLauncher.setCrossfaderBlendMode(modes[idx]);
          }
          return;
        }
        case 'cut-a':
          if (value > 0) vjClipLauncher.cutToA();
          return;
        case 'cut-b':
          if (value > 0) vjClipLauncher.cutToB();
          return;
      }
      return;
    }

    // VJ Block switching: vj:block:<index>  (also valid as vj-b:block:<index>)
    if (layerPart === 'block') {
      const blockIdx = parseInt(parts[2], 10);
      if (!isNaN(blockIdx) && value > 0) {
        const state = get(vjClipLauncher);
        if (blockIdx >= 0 && blockIdx < state.blocks.length) {
          vjClipLauncher.setActiveBlock(state.blocks[blockIdx].id);
        }
      }
      return;
    }

    // Layer groups: vj:group:<id>:level and vj:group:<id>:column:<index>
    if (layerPart === 'group') {
      let written: string;
      try { written = decodeURIComponent(names[2] ?? ''); } catch { return; }
      const groups = get(vjClipLauncher).groups ?? [];
      const groupId = (groups.find((group: any) => group.id === written)
        ?? groups.find((group: any) => String(group.id).toLowerCase() === written.toLowerCase()))?.id ?? written;
      if (parts[3] === 'level') vjClipLauncher.updateGroup(groupId, { opacity: Math.max(0, Math.min(1, value)) });
      else if (parts[3] === 'column' && value > 0) {
        const colIdx = parseInt(parts[4], 10);
        if (!isNaN(colIdx)) vjClipLauncher.triggerColumn(colIdx, bank, groupId);
      }
      return;
    }

    // VJ Column triggering: vj:column:<index>  → fires on the chosen bank
    if (layerPart === 'column') {
      const colIdx = parseInt(parts[2], 10);
      if (!isNaN(colIdx) && value > 0) {
        vjClipLauncher.triggerColumn(colIdx, bank);
      }
      return;
    }

    // VJ Stage preset: vj:stage:<index>  (always Bank A — ignored under vj-b)
    if (layerPart === 'stage' && bank === 'A') {
      const presetIdx = parseInt(parts[2], 10);
      if (!isNaN(presetIdx) && value > 0) {
        window.dispatchEvent(new CustomEvent('midi-stage-preset', { detail: { index: presetIdx } }));
      }
      return;
    }

    // VJ Stop all: vj:stopall (sweeps both banks regardless of scope — store-side stopAll handles this)
    if (layerPart === 'stage-effect' && bank === 'A') {
      const effectId = parts[2];
      const action = parts[3];
      if (effectId && action === 'hold') {
        window.dispatchEvent(new CustomEvent('vj-stage-effect-hold', {
          detail: { effectId, pressed: value > 0, value },
        }));
      }
      return;
    }

    if (layerPart === 'led-effect' && bank === 'A') {
      const effectId = parts[2];
      const action = parts[3];
      if (effectId && (action === 'hold' || action === 'toggle')) {
        window.dispatchEvent(new CustomEvent('vj-led-effect-control', {
          detail: { effectId, action, pressed: value > 0, value },
        }));
      }
      return;
    }

    if (layerPart === 'stopall') {
      if (value > 0) vjClipLauncher.stopAll();
      return;
    }

    // VJ launch quantization: vj:quantize  (always Bank-A scope — global)
    if (layerPart === 'quantize' && bank === 'A') {
      const grids = ['off', '1/4', '1/2', '1bar', '2bar', '4bar'] as const;
      if (mapping.discreteValues && mapping.discreteValues.length > 0) {
        const idx = Math.round(value);
        const name = mapping.discreteValues[Math.min(idx, mapping.discreteValues.length - 1)];
        if (typeof name === 'string') vjClipLauncher.setQuantization(name as any);
      } else {
        const idx = Math.max(0, Math.min(grids.length - 1, Math.round(value)));
        vjClipLauncher.setQuantization(grids[idx]);
      }
      return;
    }

    // VJ cancel-all queued triggers: vj:quantize-clear
    if (layerPart === 'quantize-clear' && bank === 'A') {
      if (value > 0) vjClipLauncher.clearPendingTriggers();
      return;
    }

    // VJ Macros — component-local state, dispatch via DOM event (legacy
    // GeoMesh macros macro1/macro2; kept for backward-compat with old
    // saved MIDI mappings).
    if (layerPart === 'macro1' || layerPart === 'macro2') {
      const macroNum = layerPart === 'macro1' ? 1 : 2;
      window.dispatchEvent(new CustomEvent('midi-vj-macro', { detail: { macro: macroNum, value } }));
      return;
    }

    // VJ general-purpose macros — vj:macro:<n>:value where n is 1..8.
    // Routes to the macro store, which then walks destinations and writes
    // through to N parameters at once. Macros are GLOBAL — both vj: and
    // vj-b: scopes route to the same set so users can save mappings on
    // either scope and have them work.
    // Uses a registered callback to avoid an import cycle (macros.ts
    // imports midiRouter, so midiRouter can't import macros directly).
    if (layerPart === 'macro') {
      const macroIdx = parseInt(parts[2], 10);
      const sub = parts[3];
      if (!isNaN(macroIdx) && macroIdx >= 1 && macroIdx <= 8 && sub === 'value' && _macroValueSetter) {
        _macroValueSetter(`macro-${macroIdx}`, value);
      }
      return;
    }

    // VJ snapshot recall — vj:snapshot:<n> where n is 1..16. Note trigger
    // (recalls on rising edge). Uses the registered callback pattern, same
    // as macros. Snapshots are GLOBAL — both scopes work.
    if (layerPart === 'snapshot') {
      const snapIdx = parseInt(parts[2], 10);
      if (!isNaN(snapIdx) && snapIdx >= 1 && snapIdx <= 16 && value > 0 && _snapshotRecaller) {
        _snapshotRecaller(snapIdx - 1); // store is 0-indexed
      }
      return;
    }

    // VJ effect parameters — vj:fx:<effectId>:<paramName>
    // The data-midi-path doesn't encode WHERE the effect lives
    // (composition vs per-layer vs per-clip), so we update everywhere
    // an effect with this id is found. updateCompositionEffectParams
    // and updateLayerEffectParams both no-op when the id doesn't
    // match anything, so the redundant calls are cheap. Clip-level
    // effects need layer + column to address and aren't covered here
    // — bind those via per-clip UI for now.
    if (layerPart === 'fx') {
      const effectId = names[2];
      const paramName = names[3];
      if (!effectId || !paramName) return;
      vjClipLauncher.updateCompositionEffectParams(effectId, { [paramName]: value });
      const state = get(vjClipLauncher);
      const layerStates = bank === 'B' ? state.bankBLayerStates : state.layerStates;
      for (let i = 0; i < layerStates.length; i++) {
        vjClipLauncher.updateLayerEffectParams(i, effectId, { [paramName]: value }, bank);
      }
      return;
    }

    const layerIndex = parseInt(layerPart, 10);
    if (isNaN(layerIndex)) return;

    // Per-layer mutators all take the bank parameter so the same router
    // dispatches Bank A AND Bank B from the parallel paths.
    switch (property) {
      case 'opacity':
        vjClipLauncher.setLayerOpacity(layerIndex, value, bank);
        break;
      case 'blend':
        if (mapping.discreteValues) {
          const idx = Math.round(value);
          const blendVal = mapping.discreteValues[Math.min(idx, mapping.discreteValues.length - 1)];
          vjClipLauncher.setLayerBlendMode(layerIndex, blendVal as BlendMode, bank);
        }
        break;
      case 'solo':
        if (value > 0) vjClipLauncher.toggleLayerSolo(layerIndex, bank);
        break;
      case 'mute':
        if (value > 0) vjClipLauncher.toggleLayerMute(layerIndex, bank);
        break;
      case 'autopilot':
        if (value > 0) vjClipLauncher.toggleLayerAutopilot(layerIndex, bank);
        break;
      case 'shader': {
        // parts: ['vj', '0', 'shader', 'speed']
        const st = get(vjClipLauncher);
        const activeShader = (bank === 'B' ? st.bankBLayerStates : st.layerStates)[layerIndex]?.activeClip;
        const shaderParam = names[3] ? matchControlKey(names[3], activeShader?.shaderValues) : '';
        if (shaderParam) {
          vjClipLauncher.updateActiveClipShaderValue(layerIndex, shaderParam, value, bank);
          // Update the modulation engine's base value too — otherwise
          // a modulated shader param has its slider value overwritten
          // on the next applyModulations() tick (modulation reads from
          // baseValues, not from shaderValues). Mirrors what the UI
          // slider's setShaderParamValue does in VJModePanel.
          setModulationBase(layerIndex, shaderParam, value, bank);
        }
        break;
      }
      case 'splat': {
        const st = get(vjClipLauncher);
        const activeSplat = (bank === 'B' ? st.bankBLayerStates : st.layerStates)[layerIndex]?.activeClip;
        const splatProp = names[3] ? matchControlKey(names[3], (activeSplat as any)?.splatContent) : '';
        if (splatProp) {
          vjClipLauncher.updateActiveClipSplatContent(layerIndex, { [splatProp]: value }, bank);
        }
        break;
      }
      case 'model3d': {
        const st = get(vjClipLauncher);
        const activeModel = (bank === 'B' ? st.bankBLayerStates : st.layerStates)[layerIndex]?.activeClip;
        const modelProp = names[3] ? matchControlKey(names[3], (activeModel as any)?.model3dContent) : '';
        if (modelProp) {
          vjClipLauncher.updateActiveClipModel3DContent(layerIndex, { [modelProp]: value } as any, bank);
        }
        break;
      }
      case 'video': {
        const action = parts[3];
        const state = get(vjClipLauncher);
        const layerStates = bank === 'B' ? state.bankBLayerStates : state.layerStates;
        const clip = layerStates[layerIndex]?.activeClip;
        const video = clip?.type === 'video' ? clip.videoElement : undefined;
        if (!clip || clip.type !== 'video' || !video) break;

        const trimStart = Math.max(0, Math.min(1, clip.trimStart ?? 0));
        const trimEnd = Math.max(trimStart, Math.min(1, clip.trimEnd ?? 1));
        const startTime = Number.isFinite(video.duration) ? video.duration * trimStart : 0;

        if (action === 'cue' || action === 'cue-set' || action === 'cue-clear') {
          if (value <= 0 || !/^[0-7]$/.test(parts[4] ?? '')) break;
          const cueIndex = Number(parts[4]);
          if (action === 'cue') vjClipLauncher.pressCuePoint(layerIndex, cueIndex, bank);
          else vjClipLauncher.setActiveClipCuePoint(layerIndex, cueIndex, action === 'cue-clear' ? null : video.currentTime, bank);
          break;
        }

        if (action === 'play' && value > 0) {
          const shouldPlay = video.paused || clip.isPlaying === false;
          vjClipLauncher.updateActiveClipVideoProps(layerIndex, { isPlaying: shouldPlay }, bank);
          if (shouldPlay) void video.play().catch(() => undefined);
          else video.pause();
        } else if (action === 'restart' && value > 0) {
          video.currentTime = startTime;
          vjClipLauncher.updateActiveClipVideoProps(layerIndex, { isPlaying: true }, bank);
          void video.play().catch(() => undefined);
        } else if (action === 'mirror' && value > 0) {
          vjClipLauncher.updateActiveClipVideoProps(layerIndex, { mirrorX: !clip.mirrorX }, bank);
        } else if (action === 'position') {
          const normalized = Math.max(0, Math.min(1, value));
          const sourcePosition = trimStart + normalized * (trimEnd - trimStart);
          if (Number.isFinite(video.duration)) video.currentTime = video.duration * sourcePosition;
        }
        break;
      }
      case 'plugin': {
        const paramKey = parts.slice(3).join(':');
        if (!paramKey) break;
        if (mapping.mode === 'toggle' && value <= 0) break;
        const state = get(vjClipLauncher);
        const layerStates = bank === 'B' ? state.bankBLayerStates : state.layerStates;
        const grid = bank === 'B' ? state.bankBClipGrid : state.clipGrid;
        const layerState = layerStates[layerIndex];
        const clip = layerState?.activeClip;
        if (!clip?.effectSource) break;
        let columnIndex = layerState.activeColumn;
        if (columnIndex === null || columnIndex === undefined) {
          const found = grid[layerIndex]?.findIndex(candidate => candidate?.id === clip.id) ?? -1;
          columnIndex = found >= 0 ? found : null;
        }
        if (columnIndex === null || columnIndex === undefined) break;
        const next = this.resolvePluginParamValue(clip.effectSource, paramKey, value, mapping);
        vjClipLauncher.updateClipEffectSource(layerIndex, columnIndex, {
          ...clip.effectSource,
          [paramKey]: next,
        }, bank);
        break;
      }
      case 'trigger': {
        const colIdx = parseInt(parts[3], 10);
        if (!isNaN(colIdx) && value > 0) {
          vjClipLauncher.triggerClip(layerIndex, colIdx, bank);
        }
        break;
      }
    }
  }

  private resolvePluginParamValue(effectSource: any, paramKey: string, value: number, mapping: MidiMapping): any {
    const manifest = effectSource?.effectType ? getPluginByEffectType(effectSource.effectType) : undefined;
    const def = manifest?.paramDefs.find(param => param.param === paramKey);

    if (mapping.mode === 'toggle') {
      return !((effectSource ?? {})[paramKey] ?? def?.default ?? false);
    }

    if (mapping.discreteValues && mapping.discreteValues.length > 0) {
      const idx = Math.max(0, Math.min(mapping.discreteValues.length - 1, Math.round(value)));
      const raw = mapping.discreteValues[idx];
      const option = def?.options?.find(opt => String(opt.value) === raw);
      return option ? option.value : raw;
    }

    if (def?.type === 'toggle') {
      return value >= 0.5;
    }

    return value;
  }

  private dispatchPerformer(parts: string[], value: number, mapping: MidiMapping, names: string[] = parts) {
    // parts: ['sv', sub, ...]
    const sub = parts[1];

    switch (sub) {
      case 'xfade':
        synthVisionStore.setXfade(value);
        break;
      case 'param': {
        // parts: ['sv', 'param', 'chaos'] OR ['sv', 'param', 'shader', 'p1'] OR ['sv', 'param', 'world', 'height']
        const paramSub = parts[2];
        if (paramSub === 'shader' && parts[3]) {
          // Route to currently focused shader's param
          const svState = get(synthVisionStore);
          const shIdx = svState.layers[svState.focus].sh;
          synthVisionStore.setShaderParam(shIdx, names[3], value);
        } else if (paramSub === 'world' && parts[3]) {
          // Route to currently focused world's param
          const svState = get(synthVisionStore);
          const wIdx = svState.layers[svState.focus].world;
          synthVisionStore.setWorldParam(wIdx, names[3], value);
        } else {
          synthVisionStore.setParam(names[2] as SVParamKey, value);
        }
        break;
      }
      case 'shader': {
        // parts: ['sv', 'shader', '0', 'tunnelR']
        const shIdx = parseInt(parts[2], 10);
        if (!isNaN(shIdx) && parts[3]) {
          synthVisionStore.setShaderParam(shIdx, names[3], value);
        }
        break;
      }
      case 'world': {
        // parts: ['sv', 'world', '3', 'height']
        const wIdx = parseInt(parts[2], 10);
        if (!isNaN(wIdx) && parts[3]) {
          synthVisionStore.setWorldParam(wIdx, names[3], value);
        }
        break;
      }
      case 'clip':
        // Note trigger: fire clip at index
        if (value > 0) {
          synthVisionStore.fireClip(parseInt(parts[2], 10));
        }
        break;
      case 'bpm':
        synthVisionStore.setBpm(value);
        break;
      case 'camopacity':
        synthVisionStore.setCamOpacity(value);
        break;
      case 'spacefx':
        // Momentary trigger
        if (value > 0) synthVisionStore.triggerSpaceFx();
        break;
      case 'focus':
        // Toggle A/B focus
        if (value > 0) synthVisionStore.toggleFocus();
        break;
      case 'blackout':
        if (value > 0) synthVisionStore.doBlackout();
        break;
      case 'pump':
        if (value > 0) synthVisionStore.doPump();
        break;
      case 'drift':
        if (value > 0) synthVisionStore.toggleDrift();
        break;
      case 'isf': {
        // parts: ['sv', 'isf', 'inputName']
        const svState = get(synthVisionStore);
        const assignedLayer = svState.assignedLayer;
        if (assignedLayer !== null && names[2]) {
          const clip = get(vjClipLauncher).layerStates[assignedLayer]?.activeClip;
          vjClipLauncher.updateActiveClipShaderValue(assignedLayer, matchControlKey(names[2], clip?.shaderValues), value);
        }
        break;
      }
      case 'fx': {
        // parts: ['sv', 'fx', 'effectType', 'paramName']
        const svState = get(synthVisionStore);
        const fxLayer = svState.assignedLayer;
        if (fxLayer !== null && parts[2] && parts[3]) {
          const effects = get(vjClipLauncher).layerStates[fxLayer]?.effects ?? [];
          const effect = effects.find((e: any) => e.type === names[2])
            ?? effects.find((e: any) => String(e.type).toLowerCase() === parts[2]);
          if (effect) {
            vjClipLauncher.updateLayerEffectParams(fxLayer, effect.id, { [matchControlKey(names[3], (effect as any).params)]: value });
          }
        }
        break;
      }
    }
  }
}

export const midiRouter = new MidiRouter();
