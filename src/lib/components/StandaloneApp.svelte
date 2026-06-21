<script lang="ts">
  // Ghost Arcade Mobile — standalone (local-only) VJ surface.
  //
  // Architecture (2026-06-08 rewrite):
  //   - 4 stacked layers, each = (shaderId, opacity, blendMode, effects[])
  //   - One <canvas> + StandaloneRenderer per layer, CSS-composited via
  //     mix-blend-mode + opacity
  //   - Effects are CSS filters applied to each layer's canvas — gives
  //     us blur, hue, contrast, brightness, saturation, invert,
  //     grayscale, sepia without any GPU rewrite
  //   - Tabs: SHADERS (assign per layer) | FX (per-layer filter rack) |
  //     MIX (VJMixerStrip-per-layer opacity + blend)
  //   - Mic audio (Milkdrop-smoothed) feeds every layer's renderer
  //   - MIDI Learn re-targeted to layer controls (opacity per layer,
  //     master record toggle, mic toggle, clean output)
  //   - MediaRecorder captures the live composite
  //
  // What was removed (was here pre-rewrite, no longer relevant):
  //   - Clip-launcher / banks / Resolume-style dual deck crossfader
  //   - Autopilot, per-clip params, projection mapping, onboarding tour,
  //     diagnostic HUD — none of those map to the layer model.

  import { onMount, onDestroy } from 'svelte';
  import { StandaloneAudio, SILENT_AUDIO } from '../mobile/standaloneAudio';
  import { StandaloneRenderer } from '../mobile/standaloneRenderer';
  import { MOBILE_SHADERS, findShader, type MobileShader } from '../mobile/standaloneShaderList';
  import StandaloneShaderPicker from './StandaloneShaderPicker.svelte';
  import VJMixerStrip from './mobile/VJMixerStrip.svelte';
  import {
    StandaloneMidi,
    DEFAULT_MIDI_MAPPINGS,
    isWebMidiAvailable,
    type MidiBinding,
    type MidiMappings,
    type MidiStatus,
    type MidiTarget,
  } from '../mobile/standaloneMidi';
  import {
    StandaloneRecorder,
    isRecordingSupported,
    deliverRecording,
    type LayerSnapshot,
  } from '../mobile/standaloneRecorder';
  import {
    MOBILE_EFFECTS,
    findMobileEffect,
    type MobileEffectInstance,
  } from '../mobile/standaloneEffects';
  import { EFFECT_PARAM_DEFS } from '../effects/effectParamDefs';

  export let onSwitchMode: () => void;

  // ── Layer model ──
  // Default 4 layers. Each layer has its own shader, opacity, blend
  // mode, and a list of CSS-filter effects. Layers are persisted to
  // localStorage as a flat array.
  const N_LAYERS = 4;
  const LAYER_COLORS = ['#FF6E6E', '#FFC857', '#69F0AE', '#BB86FC'];

  type StandaloneEffect = {
    id: string;
    type: string;                          // matches an entry in standaloneEffects.MOBILE_EFFECTS
    enabled: boolean;
    params: Record<string, number>;        // EFFECT_PARAM_DEFS-style param values
  };

  type StandaloneLayer = {
    id: string;
    shaderId: string | null;
    enabled: boolean;
    opacity: number;
    blendMode: string;
    effects: StandaloneEffect[];
  };

  type SavedState = {
    layers: StandaloneLayer[];
    midi?: { enabled: boolean; mappings: MidiMappings };
  };

  const SAVE_KEY = 'ga-mobile-vj-state-v3';

  function defaultLayers(): StandaloneLayer[] {
    const out: StandaloneLayer[] = [];
    for (let i = 0; i < N_LAYERS; i++) {
      out.push({
        id: `layer-${i}`,
        // Pre-fill first 2 layers with shaders so a first-time user sees
        // something move the moment they open the app. Layers 3 + 4 are
        // empty placeholders.
        shaderId: i < 2 ? (MOBILE_SHADERS[i]?.id ?? null) : null,
        enabled: i < 2,
        opacity: i === 0 ? 1 : 0.7,
        blendMode: i === 0 ? 'normal' : 'screen',
        effects: [],
      });
    }
    return out;
  }

  function loadSavedState(): SavedState {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.layers)) {
          // Normalize layer array length to N_LAYERS and validate shader ids.
          const layers: StandaloneLayer[] = [];
          for (let i = 0; i < N_LAYERS; i++) {
            const l = parsed.layers[i] ?? null;
            layers.push({
              id: `layer-${i}`,
              shaderId: l && typeof l.shaderId === 'string' && findShader(l.shaderId) ? l.shaderId : null,
              enabled: !!(l?.enabled),
              opacity: typeof l?.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1,
              blendMode: typeof l?.blendMode === 'string' ? l.blendMode : 'normal',
              effects: Array.isArray(l?.effects)
                ? l.effects
                    .filter((e: any) => e && typeof e.type === 'string' && findMobileEffect(e.type))
                    .map((e: any) => ({
                      id: typeof e.id === 'string' ? e.id : `${e.type}-${Math.random().toString(36).slice(2, 8)}`,
                      type: e.type,
                      enabled: e.enabled !== false,
                      params: (e.params && typeof e.params === 'object') ? { ...e.params } : {},
                    }))
                : [],
            });
          }
          parsed.layers = layers;
        } else {
          parsed.layers = defaultLayers();
        }
        if (!parsed.midi || typeof parsed.midi !== 'object') {
          parsed.midi = { enabled: false, mappings: { ...DEFAULT_MIDI_MAPPINGS } };
        } else {
          parsed.midi.enabled = !!parsed.midi.enabled;
          parsed.midi.mappings = { ...DEFAULT_MIDI_MAPPINGS, ...(parsed.midi.mappings || {}) };
        }
        return parsed;
      }
    } catch { /* corrupt save — fall through */ }
    return {
      layers: defaultLayers(),
      midi: { enabled: false, mappings: { ...DEFAULT_MIDI_MAPPINGS } },
    };
  }

  let state: SavedState = loadSavedState();
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }

  // ── Renderers + canvases ──
  let canvases: (HTMLCanvasElement | null)[] = new Array(N_LAYERS).fill(null);
  let renderers: (StandaloneRenderer | null)[] = new Array(N_LAYERS).fill(null);
  let audio: StandaloneAudio | null = null;
  let micEnabled = false;
  let micRequesting = false;
  let micError: string | null = null;
  let resizeObs: ResizeObserver | null = null;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;

  // ── UI shell ──
  type TabId = 'shaders' | 'fx' | 'mix';
  let tab: TabId = 'shaders';
  let pickerForLayer: number | null = null;
  let showSettings = false;
  let showMidi = false;

  // Clean Output — long-press to hide all UI for HDMI mirror.
  let cleanOutput = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  function onCanvasPointerDown() {
    if (cleanOutput) { cleanOutput = false; return; }
    longPressTimer = setTimeout(() => { cleanOutput = true; longPressTimer = null; }, 650);
  }
  function onCanvasPointerUp() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  // ── Shader load ──
  async function fetchAndLoad(renderer: StandaloneRenderer | null, shaderId: string | null) {
    if (!renderer || !shaderId) return;
    const s = findShader(shaderId);
    if (!s) return;
    try {
      const url = encodeURI(`${import.meta.env.BASE_URL}${s.path}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      await renderer.loadShaderSource(await res.text(), s.audioNative, s.audioInject);
    } catch (e) {
      console.warn('[StandaloneApp] shader load failed', shaderId, e);
    }
  }

  // ── Layer ops ──
  function setLayerShader(i: number, shaderId: string | null): void {
    state.layers[i].shaderId = shaderId;
    state.layers[i].enabled = !!shaderId;
    state = state;
    save();
    if (shaderId) void fetchAndLoad(renderers[i], shaderId);
  }
  function setLayerOpacity(i: number, opacity: number): void {
    state.layers[i].opacity = Math.max(0, Math.min(1, opacity));
    state = state;
    save();
  }
  function setLayerBlendMode(i: number, blendMode: string): void {
    state.layers[i].blendMode = blendMode;
    state = state;
    save();
  }
  function setLayerEnabled(i: number, enabled: boolean): void {
    state.layers[i].enabled = enabled;
    state = state;
    save();
  }
  function stopLayer(i: number): void {
    state.layers[i].shaderId = null;
    state.layers[i].enabled = false;
    state = state;
    save();
  }

  // ── Effects ──
  // Real fragment-shader post-process passes — see standaloneEffects.ts
  // for the registry + GLSL. Effect TYPE strings + PARAM names match
  // the desktop catalog so EFFECT_PARAM_DEFS slider defs are shared.
  function getEffectDefList() {
    return MOBILE_EFFECTS;
  }
  function getEffectParamDefs(type: string) {
    return EFFECT_PARAM_DEFS[type] ?? [];
  }
  function defaultParamsFor(type: string): Record<string, number> {
    const def = findMobileEffect(type);
    if (!def) return {};
    // Start from each EFFECT_PARAM_DEFS entry's default if present; fall
    // back to the mobile def's default. This keeps mobile + desktop in
    // visual sync when both know the param.
    const paramDefs = getEffectParamDefs(type);
    const out: Record<string, number> = { ...def.defaults };
    for (const pd of paramDefs) {
      if (pd.default !== undefined && out[pd.param] === undefined) out[pd.param] = pd.default;
    }
    return out;
  }
  function addLayerEffect(i: number, type: string): void {
    if (!findMobileEffect(type)) return;
    state.layers[i].effects = [
      ...state.layers[i].effects,
      { id: `${type}-${Date.now().toString(36)}`, type, enabled: true, params: defaultParamsFor(type) },
    ];
    state = state;
    save();
    pushLayerEffects(i);
  }
  function removeLayerEffect(i: number, effectId: string): void {
    state.layers[i].effects = state.layers[i].effects.filter(e => e.id !== effectId);
    state = state;
    save();
    pushLayerEffects(i);
  }
  function toggleLayerEffect(i: number, effectId: string): void {
    state.layers[i].effects = state.layers[i].effects.map(e =>
      e.id === effectId ? { ...e, enabled: !e.enabled } : e,
    );
    state = state;
    save();
    pushLayerEffects(i);
  }
  function setLayerEffectParam(i: number, effectId: string, param: string, value: number): void {
    state.layers[i].effects = state.layers[i].effects.map(e =>
      e.id === effectId ? { ...e, params: { ...e.params, [param]: value } } : e,
    );
    state = state;
    save();
    pushLayerEffects(i);
  }
  /** Push the layer's effect chain to its renderer. The renderer
   *  caches compiled effect programs internally, so calling this on
   *  every edit is cheap — only NEW effect types trigger a compile. */
  function pushLayerEffects(i: number): void {
    const r = renderers[i];
    if (!r) return;
    const chain: MobileEffectInstance[] = state.layers[i].effects.map(e => ({
      type: e.type,
      params: e.params,
      enabled: e.enabled,
    }));
    r.setEffectChain(chain);
  }

  // ── Audio pump ──
  function pumpAudio() {
    if (audio?.ready) audio.update();
    const u = audio?.ready ? audio.uniforms : SILENT_AUDIO;
    for (const r of renderers) r?.setAudio(u);
  }
  async function enableMic() {
    if (micEnabled || micRequesting) return;
    micRequesting = true;
    micError = null;
    try {
      audio = new StandaloneAudio();
      await audio.start();
      micEnabled = true;
    } catch (e: any) {
      micError = e?.message || 'Mic permission denied';
      audio = null;
    } finally {
      micRequesting = false;
    }
  }
  function disableMic(): void {
    audio?.stop();
    audio = null;
    micEnabled = false;
  }

  // ── MIDI ──
  let midi: StandaloneMidi | null = null;
  let midiStatus: MidiStatus = isWebMidiAvailable() ? 'idle' : 'unavailable';
  let midiDevices: string[] = [];
  let learnTarget: MidiTarget | null = null;
  let learnTimer: ReturnType<typeof setTimeout> | null = null;

  function handleMidiEvent(target: MidiTarget, ev: { value: number; isTrigger: boolean }): void {
    if (learnTarget === target) return;
    // Re-purposed MIDI targets for layer model. Crossfader-style continuous
    // CC maps to "L1 opacity" by default; the bank/clip slots map to per-
    // layer opacity (4 layers) and per-layer enabled toggle. Everything
    // else carries forward.
    if (target === 'crossfader') {
      setLayerOpacity(0, ev.value);
      return;
    }
    if (target.startsWith('bank:')) {
      // bank:N → toggle layer N enabled
      if (!ev.isTrigger) return;
      const idx = Number(target.slice(5));
      if (idx >= 0 && idx < N_LAYERS) setLayerEnabled(idx, !state.layers[idx].enabled);
      return;
    }
    if (target.startsWith('clip:')) {
      // clip:N → continuous? No — MIDI Learn lets the user pick a knob
      // here too; values 0..1 map to layer-N opacity if N < N_LAYERS.
      const idx = Number(target.slice(5));
      if (idx >= 0 && idx < N_LAYERS) setLayerOpacity(idx, ev.value);
      return;
    }
    if (target === 'micToggle') {
      if (!ev.isTrigger) return;
      if (micEnabled) disableMic(); else void enableMic();
      return;
    }
    if (target === 'cleanOutput') {
      if (!ev.isTrigger) return;
      cleanOutput = !cleanOutput;
      return;
    }
    if (target === 'autopilotToggle') {
      // Re-purposed: toggle recording. (Autopilot is gone in the new shell.)
      if (!ev.isTrigger) return;
      toggleRecording();
      return;
    }
  }
  function handleMidiRaw(msg: { kind: 'cc' | 'note'; channel: number; num: number; value: number }): void {
    if (!learnTarget) return;
    if (msg.value === 0 && msg.kind === 'note') return;
    const binding: MidiBinding = { kind: msg.kind, channel: msg.channel, num: msg.num };
    midi?.setBinding(learnTarget, binding);
    if (state.midi && midi) {
      state.midi = { ...state.midi, mappings: { ...midi.mappings } };
      save();
      state = state;
    }
    cancelLearn();
  }
  function startLearn(target: MidiTarget): void {
    if (!midi || midi.status !== 'connected') return;
    cancelLearn();
    learnTarget = target;
    learnTimer = setTimeout(cancelLearn, 8000);
  }
  function cancelLearn(): void {
    learnTarget = null;
    if (learnTimer) { clearTimeout(learnTimer); learnTimer = null; }
  }
  function clearBinding(target: MidiTarget): void {
    midi?.setBinding(target, null);
    if (state.midi && midi) {
      state.midi = { ...state.midi, mappings: { ...midi.mappings } };
      save();
      state = state;
    }
  }
  function resetMidiMappings(): void {
    midi?.updateMappings({ ...DEFAULT_MIDI_MAPPINGS });
    state.midi = { enabled: state.midi?.enabled ?? false, mappings: { ...DEFAULT_MIDI_MAPPINGS } };
    save();
    state = state;
  }
  async function enableMidi(): Promise<void> {
    if (!isWebMidiAvailable()) { midiStatus = 'unavailable'; return; }
    if (midi) { await midi.start(); return; }
    midi = new StandaloneMidi({
      mappings: state.midi?.mappings ?? { ...DEFAULT_MIDI_MAPPINGS },
      onEvent: handleMidiEvent,
      onRawMessage: handleMidiRaw,
      onStatusChange: (s, d) => { midiStatus = s; midiDevices = d; },
    });
    await midi.start();
    state.midi = { ...(state.midi ?? { mappings: { ...DEFAULT_MIDI_MAPPINGS } }), enabled: true };
    save();
    state = state;
  }
  function disableMidi(): void {
    midi?.stop();
    midi = null;
    midiStatus = isWebMidiAvailable() ? 'idle' : 'unavailable';
    midiDevices = [];
    cancelLearn();
    if (state.midi) { state.midi = { ...state.midi, enabled: false }; save(); state = state; }
  }

  // ── Recording ──
  let recorder: StandaloneRecorder | null = null;
  let recElapsed = 0;
  let recElapsedTimer: ReturnType<typeof setInterval> | null = null;
  let recError: string | null = null;
  let recDeliveringMsg: string | null = null;
  $: recSupported = typeof window !== 'undefined' && isRecordingSupported();
  $: isRecording = !!recorder;

  function buildLayerStack(): LayerSnapshot[] {
    const out: LayerSnapshot[] = [];
    for (let i = 0; i < N_LAYERS; i++) {
      const l = state.layers[i];
      const c = canvases[i];
      if (!l || !c) continue;
      out.push({
        canvas: c,
        enabled: l.enabled && !!l.shaderId,
        opacity: l.opacity,
        blendMode: l.blendMode,
        // Effects now live in the WebGL pipeline — the canvas itself
        // already shows the post-processed result, so no CSS filter
        // chain to apply during recording compositing.
        filter: 'none',
      });
    }
    return out;
  }
  function startRecording(): void {
    if (recorder) return;
    recError = null;
    if (!recSupported) { recError = 'Recording not supported here. Try Chrome on Android.'; return; }
    try {
      recorder = new StandaloneRecorder({ getStack: buildLayerStack });
      recorder.start();
      recElapsed = 0;
      recElapsedTimer = setInterval(() => {
        recElapsed = recorder ? recorder.elapsedSec() : 0;
      }, 250);
    } catch (e: any) {
      recError = e?.message || 'Could not start recorder';
      recorder = null;
    }
  }
  async function stopRecording(): Promise<void> {
    if (!recorder) return;
    const r = recorder;
    recorder = null;
    if (recElapsedTimer) { clearInterval(recElapsedTimer); recElapsedTimer = null; }
    const result = await r.stop();
    recElapsed = 0;
    if (!result) { recError = 'Recording produced no data'; return; }
    recDeliveringMsg = 'Saving…';
    const outcome = await deliverRecording(result);
    if (outcome === 'failed') { recError = 'Could not save the clip'; recDeliveringMsg = null; return; }
    recDeliveringMsg = outcome === 'shared' ? 'Shared' : 'Saved to downloads';
    setTimeout(() => { recDeliveringMsg = null; }, 3500);
  }
  function toggleRecording(): void {
    if (isRecording) void stopRecording();
    else startRecording();
  }

  // ── Lifecycle ──
  onMount(() => {
    // Spin up one renderer per layer. The layer's currently-assigned
    // shader (if any) loads immediately so first paint shows content.
    for (let i = 0; i < N_LAYERS; i++) {
      const c = canvases[i];
      if (!c) continue;
      const r = new StandaloneRenderer(c);
      renderers[i] = r;
      r.start();
      if (state.layers[i].shaderId) void fetchAndLoad(r, state.layers[i].shaderId);
      pushLayerEffects(i);
    }
    pumpTimer = setInterval(pumpAudio, 16);
    resizeObs = new ResizeObserver(() => {
      for (const r of renderers) r?.resize();
    });
    for (const c of canvases) if (c) resizeObs.observe(c);
    if (state.midi?.enabled) void enableMidi();
  });
  onDestroy(() => {
    if (pumpTimer) clearInterval(pumpTimer);
    resizeObs?.disconnect();
    for (const r of renderers) r?.destroy();
    renderers = new Array(N_LAYERS).fill(null);
    audio?.stop(); audio = null;
    midi?.stop(); midi = null;
    cancelLearn();
    if (recElapsedTimer) { clearInterval(recElapsedTimer); recElapsedTimer = null; }
    void recorder?.stop();
    recorder = null;
  });

  // ── Derived: VJMixerStrip's expected layerState shape ──
  // The strip reads {opacity, blendMode, activeClip:{name}}. Build that
  // from our local layer on the fly.
  function strip(l: StandaloneLayer) {
    return {
      opacity: l.opacity,
      blendMode: l.blendMode,
      activeClip: l.shaderId ? { name: findShader(l.shaderId)?.name ?? l.shaderId } : null,
    };
  }
</script>

<div
  class="vj-root"
  class:clean={cleanOutput}
  onpointerdown={onCanvasPointerDown}
  onpointerup={onCanvasPointerUp}
  onpointercancel={onCanvasPointerUp}
  role="presentation"
>
  <!-- Canvas stack (bottom = layer 0, top = layer N-1). Each layer's
       canvas applies its own opacity, mix-blend-mode, and CSS filter
       chain — that's the entire compositor. -->
  <div class="canvas-stack">
    {#each state.layers as l, i (l.id)}
      <canvas
        bind:this={canvases[i]}
        class="layer-canvas"
        style="
          z-index: {i};
          opacity: {l.enabled ? l.opacity : 0};
          mix-blend-mode: {l.blendMode};
        "
      ></canvas>
    {/each}
  </div>

  <!-- Top bar -->
  <div class="top-bar">
    <span class="brand">Ghost Arcade</span>
    <div class="top-actions">
      {#if recSupported}
        <button
          class="top-btn rec"
          class:on={isRecording}
          onclick={(e) => { e.stopPropagation(); toggleRecording(); }}
          aria-label={isRecording ? 'Stop recording' : 'Record'}
        >
          {#if isRecording}● {Math.floor(recElapsed / 60)}:{String(Math.floor(recElapsed % 60)).padStart(2, '0')}
          {:else}● REC{/if}
        </button>
      {/if}
      <button class="top-btn" onclick={(e) => { e.stopPropagation(); showSettings = true; }} aria-label="Settings">⋯</button>
    </div>
  </div>

  <!-- Tab bar -->
  <div class="tab-bar">
    <button class="tab" class:active={tab === 'shaders'} onclick={(e) => { e.stopPropagation(); tab = 'shaders'; }}>Shaders</button>
    <button class="tab" class:active={tab === 'fx'}      onclick={(e) => { e.stopPropagation(); tab = 'fx'; }}>FX</button>
    <button class="tab" class:active={tab === 'mix'}     onclick={(e) => { e.stopPropagation(); tab = 'mix'; }}>Mix</button>
  </div>

  <!-- Panel -->
  <div class="panel" onpointerdown={(e) => e.stopPropagation()}>
    {#if tab === 'shaders'}
      <div class="shader-list">
        {#each state.layers as l, i (l.id)}
          {@const sh = l.shaderId ? findShader(l.shaderId) : null}
          <div class="shader-row" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
            <span class="row-label">L{i + 1}</span>
            <button class="shader-pick" onclick={() => pickerForLayer = i}>
              {#if sh}
                <span class="pick-name">{sh.name}</span>
                <span class="pick-cat">{sh.category}</span>
              {:else}
                <span class="pick-empty">+ pick a shader</span>
              {/if}
            </button>
            <button
              class="row-enable"
              class:on={l.enabled}
              onclick={() => setLayerEnabled(i, !l.enabled)}
              aria-pressed={l.enabled}
              disabled={!l.shaderId}
              aria-label={l.enabled ? 'Mute layer' : 'Unmute layer'}
            >{l.enabled ? '●' : '○'}</button>
            {#if sh}
              <button class="row-stop" onclick={() => stopLayer(i)} aria-label="Remove shader">✕</button>
            {/if}
          </div>
        {/each}
      </div>
    {:else if tab === 'fx'}
      <div class="fx-tab">
        {#each state.layers as l, i (l.id)}
          <div class="fx-layer-block" style="--lc: {LAYER_COLORS[i % LAYER_COLORS.length]}">
            <div class="fx-layer-head">
              <span class="row-label">L{i + 1}</span>
              <span class="fx-layer-name">{l.shaderId ? findShader(l.shaderId)?.name ?? '—' : '— empty —'}</span>
              <details class="fx-add-wrap">
                <summary class="fx-add-btn">+ FX</summary>
                <div class="fx-add-menu">
                  {#each MOBILE_EFFECTS as fx}
                    {@const already = l.effects.some(e => e.type === fx.type)}
                    <button
                      class="fx-add-row"
                      disabled={already}
                      onclick={(e) => { (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; addLayerEffect(i, fx.type); }}
                    >
                      <span class="fx-add-cat">{fx.category}</span>
                      <span class="fx-add-label">{fx.label}</span>
                      {#if already}<span class="fx-add-meta">added</span>{/if}
                    </button>
                  {/each}
                </div>
              </details>
            </div>
            {#if l.effects.length === 0}
              <div class="fx-empty">No effects. Tap + FX to add one.</div>
            {:else}
              {#each l.effects as e (e.id)}
                {@const fx = findMobileEffect(e.type)}
                {#if fx}
                  {@const paramDefs = getEffectParamDefs(e.type)}
                  <div class="fx-row" class:disabled={!e.enabled}>
                    <div class="fx-row-head">
                      <button class="fx-bypass" class:on={e.enabled} onclick={() => toggleLayerEffect(i, e.id)} aria-label="Bypass">{e.enabled ? '●' : '○'}</button>
                      <span class="fx-name">{fx.label}</span>
                      <button class="fx-remove" onclick={() => removeLayerEffect(i, e.id)} aria-label="Remove">✕</button>
                    </div>
                    {#if paramDefs.length === 0}
                      <!-- Parameterless effect (e.g. invert) — bypass button is the whole control. -->
                    {:else}
                      <div class="fx-params">
                        {#each paramDefs as pd}
                          {@const cur = e.params[pd.param] ?? pd.default}
                          <label class="fx-param-row">
                            <span class="fx-param-name">{pd.name}</span>
                            <input
                              type="range"
                              min={pd.min}
                              max={pd.max}
                              step={pd.step}
                              value={cur}
                              oninput={(ev) => setLayerEffectParam(i, e.id, pd.param, Number((ev.target as HTMLInputElement).value))}
                            />
                            <span class="fx-param-value">{Number.isInteger(pd.step) ? cur.toFixed(0) : cur.toFixed(2)}</span>
                          </label>
                        {/each}
                      </div>
                    {/if}
                  </div>
                {/if}
              {/each}
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div class="mix-tab">
        {#each state.layers as l, i (l.id)}
          <VJMixerStrip
            layerIndex={i}
            layerState={strip(l)}
            isTablet={false}
            compact={true}
            onOpacityChange={(idx, v) => setLayerOpacity(idx, v)}
            onBlendModeChange={(idx, v) => setLayerBlendMode(idx, v)}
            onStopLayer={(idx) => stopLayer(idx)}
          />
        {/each}
      </div>
    {/if}
  </div>

  <!-- Mic prompt — bottom-floating until enabled -->
  {#if !micEnabled}
    <button class="mic-prompt" onclick={(e) => { e.stopPropagation(); void enableMic(); }} disabled={micRequesting}>
      {micRequesting ? 'Enabling mic…' : '🎤 Enable mic for audio-reactive shaders'}
    </button>
  {/if}

  {#if micError}<div class="banner banner-error">{micError}</div>{/if}
  {#if recError}<div class="banner banner-error">{recError}</div>{/if}
  {#if recDeliveringMsg}<div class="banner banner-ok">{recDeliveringMsg}</div>{/if}

  <!-- Shader picker (per layer) -->
  {#if pickerForLayer !== null}
    <StandaloneShaderPicker
      shaders={MOBILE_SHADERS}
      onPick={(s) => { setLayerShader(pickerForLayer!, s.id); pickerForLayer = null; }}
      onClose={() => pickerForLayer = null}
    />
  {/if}

  <!-- Settings sheet -->
  {#if showSettings}
    <div class="modal-bg" onclick={() => showSettings = false} role="presentation">
      <div class="modal-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <h2>Settings</h2>
        <button class="row-btn" onclick={() => { showSettings = false; showMidi = true; }}>
          MIDI controller{midiStatus === 'connected' && midiDevices.length ? ` · ${midiDevices[0]}` : ''}
        </button>
        <button class="row-btn" onclick={() => { micEnabled ? disableMic() : void enableMic(); showSettings = false; }}>
          {micEnabled ? 'Disable mic' : 'Enable mic'}
        </button>
        <button class="row-btn" onclick={onSwitchMode}>Switch mode (Standalone / Remote)</button>
        <button class="close-x" onclick={() => showSettings = false} aria-label="Close">✕</button>
      </div>
    </div>
  {/if}

  <!-- MIDI sheet -->
  {#if showMidi}
    <div class="modal-bg" onclick={() => { showMidi = false; cancelLearn(); }} role="presentation">
      <div class="modal-card midi-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <h2>MIDI controller</h2>
        {#if midiStatus === 'unavailable'}
          <p class="midi-hint">Web MIDI isn't available in this browser. Try Chrome on Android, or the iOS Capacitor build.</p>
        {:else}
          <div class="midi-status">
            <span class="midi-dot midi-dot-{midiStatus}"></span>
            <span>
              {#if midiStatus === 'connected'}Connected{midiDevices.length ? ` · ${midiDevices.join(', ')}` : ''}
              {:else if midiStatus === 'requesting'}Requesting permission…
              {:else if midiStatus === 'denied'}Permission denied
              {:else if midiStatus === 'error'}Could not connect
              {:else}Not connected{/if}
            </span>
          </div>
          {#if midiStatus !== 'connected'}
            <button class="row-btn" onclick={() => void enableMidi()}>Enable MIDI</button>
          {:else}
            <button class="row-btn" onclick={disableMidi}>Disable MIDI</button>
          {/if}
          {#if midiStatus === 'connected'}
            {#if learnTarget}
              <div class="midi-learn-banner">
                Move a control on your controller to map <strong>{learnTarget}</strong>…
                <button class="learn-cancel" onclick={cancelLearn}>Cancel</button>
              </div>
            {/if}
            <div class="midi-binding-list">
              {#each [
                { target: 'crossfader' as MidiTarget, label: 'L1 opacity (continuous CC)' },
                { target: 'clip:0' as MidiTarget, label: 'L1 opacity (alt)' },
                { target: 'clip:1' as MidiTarget, label: 'L2 opacity' },
                { target: 'clip:2' as MidiTarget, label: 'L3 opacity' },
                { target: 'clip:3' as MidiTarget, label: 'L4 opacity' },
                { target: 'bank:0' as MidiTarget, label: 'L1 mute toggle' },
                { target: 'bank:1' as MidiTarget, label: 'L2 mute toggle' },
                { target: 'bank:2' as MidiTarget, label: 'L3 mute toggle' },
                { target: 'bank:3' as MidiTarget, label: 'L4 mute toggle' },
                { target: 'micToggle' as MidiTarget, label: 'Toggle mic' },
                { target: 'cleanOutput' as MidiTarget, label: 'Toggle clean output' },
                { target: 'autopilotToggle' as MidiTarget, label: 'Toggle recording' },
              ] as item}
                {@const b = state.midi?.mappings[item.target]}
                <div class="midi-row" class:learning={learnTarget === item.target}>
                  <span class="midi-target">{item.label}</span>
                  <span class="midi-binding">
                    {#if b}{b.kind === 'cc' ? 'CC' : 'Note'} {b.num} · ch{b.channel + 1}{:else}<em>unbound</em>{/if}
                  </span>
                  <button class="midi-btn" onclick={() => startLearn(item.target)}>Learn</button>
                  <button class="midi-btn midi-btn-clear" onclick={() => clearBinding(item.target)} disabled={!b}>Clear</button>
                </div>
              {/each}
            </div>
            <button class="row-btn" onclick={resetMidiMappings}>Reset to defaults</button>
          {/if}
        {/if}
        <button class="close-x" onclick={() => { showMidi = false; cancelLearn(); }} aria-label="Close">✕</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .vj-root {
    position: fixed;
    inset: 0;
    background: #000;
    color: #fff;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
    display: flex;
    flex-direction: column;
  }
  .vj-root.clean > :not(.canvas-stack) { display: none !important; }

  .canvas-stack {
    position: absolute;
    inset: 0;
    /* Display area for layers — top half-ish above the panel.
       The layer canvases are absolutely positioned within. */
  }
  .layer-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
    pointer-events: none;
    transition: opacity 80ms linear;
  }

  /* Top bar */
  .top-bar {
    position: relative;
    z-index: 5;
    padding: env(safe-area-inset-top, 0px) 12px 8px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .brand { font-weight: 700; letter-spacing: 0.5px; font-size: 14px; opacity: 0.9; }
  .top-actions { display: flex; gap: 6px; }
  .top-btn {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #fff;
    border-radius: 14px;
    padding: 6px 12px;
    font-size: 13px;
    font-weight: 600;
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .top-btn.rec { color: #FF6E6E; }
  .top-btn.rec.on {
    background: #FF6E6E;
    color: #1a1a1f;
    border-color: #FF6E6E;
    font-variant-numeric: tabular-nums;
    animation: rec-blink 1.4s ease-in-out infinite;
  }
  @keyframes rec-blink {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 110, 110, 0.5); }
    50%      { box-shadow: 0 0 0 8px rgba(255, 110, 110, 0); }
  }

  /* The panel + tab bar sit at the bottom 45% of screen so the
     canvas stack reads as the visual focus above. */
  .tab-bar {
    position: relative;
    z-index: 4;
    margin-top: auto;
    display: flex;
    gap: 4px;
    padding: 6px 10px 0;
    background: linear-gradient(to top, rgba(0,0,0,0.55), rgba(0,0,0,0));
  }
  .tab {
    flex: 1;
    background: rgba(0, 0, 0, 0.45);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.7);
    padding: 8px 0;
    border-radius: 10px 10px 0 0;
    font-size: 13px;
    font-weight: 600;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }
  .tab.active {
    background: rgba(20, 20, 26, 0.95);
    color: #fff;
    border-color: rgba(187, 134, 252, 0.5);
  }

  .panel {
    position: relative;
    z-index: 4;
    background: rgba(20, 20, 26, 0.95);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    padding: 10px 10px calc(env(safe-area-inset-bottom, 0px) + 14px);
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    max-height: 50vh;
    overflow-y: auto;
  }

  /* SHADERS tab */
  .shader-list { display: grid; gap: 8px; }
  .shader-row {
    display: grid;
    grid-template-columns: 28px 1fr auto auto;
    align-items: center;
    gap: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid var(--lc);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .row-label {
    font-size: 12px;
    font-weight: 700;
    color: var(--lc);
    letter-spacing: 0.5px;
  }
  .shader-pick {
    background: transparent;
    border: none;
    color: #fff;
    text-align: left;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .pick-name { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick-cat { font-size: 11px; color: rgba(255, 255, 255, 0.5); text-transform: uppercase; letter-spacing: 0.5px; }
  .pick-empty { font-size: 14px; color: rgba(255, 255, 255, 0.5); }
  .row-enable {
    width: 30px; height: 30px;
    border-radius: 15px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.45);
    font-size: 15px;
  }
  .row-enable.on { background: var(--lc); color: #1a1a1f; border-color: var(--lc); }
  .row-enable:disabled { opacity: 0.3; }
  .row-stop {
    width: 28px; height: 28px;
    border-radius: 14px;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: rgba(255, 255, 255, 0.6);
    font-size: 13px;
  }

  /* FX tab */
  .fx-tab { display: grid; gap: 10px; }
  .fx-layer-block {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-left: 3px solid var(--lc);
    border-radius: 10px;
    padding: 8px 10px;
  }
  .fx-layer-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .fx-layer-name {
    flex: 1;
    font-size: 13px;
    color: rgba(255, 255, 255, 0.85);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fx-add-wrap { position: relative; }
  .fx-add-btn {
    list-style: none;
    cursor: pointer;
    background: rgba(187, 134, 252, 0.2);
    border: 1px solid rgba(187, 134, 252, 0.4);
    color: #fff;
    padding: 4px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 600;
  }
  .fx-add-btn::-webkit-details-marker { display: none; }
  .fx-add-menu {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 6;
    background: #1c1c24;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    padding: 4px;
    display: grid;
    gap: 2px;
    min-width: 140px;
  }
  .fx-add-row {
    background: transparent;
    border: none;
    color: #fff;
    text-align: left;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
  }
  .fx-add-row:active { background: rgba(255, 255, 255, 0.06); }
  .fx-add-row:disabled { opacity: 0.4; }
  .fx-empty {
    font-size: 12px;
    color: rgba(255, 255, 255, 0.4);
    padding: 4px 0;
  }
  .fx-row {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 8px;
    padding: 6px 8px;
    margin-top: 4px;
  }
  .fx-row.disabled { opacity: 0.5; }
  .fx-row.disabled .fx-name { color: rgba(255, 255, 255, 0.35); }
  .fx-row-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .fx-bypass {
    width: 22px; height: 22px;
    border-radius: 11px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: rgba(255, 255, 255, 0.5);
    font-size: 13px;
    flex: 0 0 auto;
  }
  .fx-bypass.on { background: #69F0AE; color: #1a1a1f; border-color: #69F0AE; }
  .fx-name { font-size: 13px; font-weight: 600; flex: 1; }
  .fx-remove {
    background: transparent;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-size: 12px;
    flex: 0 0 auto;
  }
  .fx-params { display: grid; gap: 4px; margin-top: 6px; }
  .fx-param-row {
    display: grid;
    grid-template-columns: 80px 1fr 38px;
    align-items: center;
    gap: 8px;
    font-size: 12px;
  }
  .fx-param-name { color: rgba(255, 255, 255, 0.65); }
  .fx-param-row input[type="range"] { width: 100%; accent-color: #BB86FC; }
  .fx-param-value {
    text-align: right;
    color: rgba(255, 255, 255, 0.65);
    font-variant-numeric: tabular-nums;
  }
  .fx-add-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .fx-add-cat {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.4);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    width: 48px;
  }
  .fx-add-label { flex: 1; }
  .fx-add-meta { font-size: 11px; color: rgba(255, 255, 255, 0.4); }

  /* MIX tab — stack of horizontal VJMixerStrip components */
  .mix-tab { display: grid; gap: 6px; }

  /* Mic prompt */
  .mic-prompt {
    position: absolute;
    top: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 6;
    background: rgba(187, 134, 252, 0.95);
    color: #1a1a1f;
    border: none;
    padding: 10px 16px;
    border-radius: 22px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(187, 134, 252, 0.4);
  }
  .mic-prompt:active { transform: translateX(-50%) scale(0.97); }
  .mic-prompt:disabled { opacity: 0.6; }

  /* Banner */
  .banner {
    position: absolute;
    top: 64px;
    left: 12px;
    right: 12px;
    background: rgba(180, 50, 50, 0.92);
    color: #fff;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    z-index: 8;
  }
  .banner-error { background: rgba(255, 110, 110, 0.92); }
  .banner-ok    { background: rgba(105, 240, 174, 0.92); color: #1a1a1f; font-weight: 600; }

  /* Modals */
  .modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 20;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .modal-card {
    width: 100%;
    max-width: 460px;
    background: #14141a;
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    padding: 18px 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
    position: relative;
  }
  .modal-card h2 { margin: 0 0 14px 0; font-size: 17px; }
  .row-btn {
    width: 100%;
    background: #1c1c24;
    border: 1px solid #2a2a30;
    color: #fff;
    padding: 14px;
    border-radius: 10px;
    text-align: left;
    margin-bottom: 8px;
    font-size: 15px;
  }
  .row-btn:active { background: #25252e; }
  .close-x {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 30px; height: 30px;
    border-radius: 15px;
    border: none;
    background: #1c1c24;
    color: #fff;
    font-size: 15px;
  }

  /* MIDI sub-sheet */
  .midi-card { max-height: 80vh; overflow-y: auto; }
  .midi-hint { color: rgba(255, 255, 255, 0.55); font-size: 13px; line-height: 1.5; }
  .midi-status {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: #1c1c24;
    border-radius: 10px;
    margin-bottom: 12px;
    font-size: 13px;
  }
  .midi-dot { width: 8px; height: 8px; border-radius: 4px; background: #888; }
  .midi-dot-connected  { background: #69F0AE; }
  .midi-dot-requesting { background: #FFC857; animation: midi-pulse 1.2s infinite; }
  .midi-dot-denied, .midi-dot-error { background: #FF6E6E; }
  @keyframes midi-pulse { 0%, 100% { opacity: 0.4; } 50% { opacity: 1; } }
  .midi-learn-banner {
    background: rgba(187, 134, 252, 0.18);
    border: 1px solid #BB86FC;
    color: #fff;
    padding: 10px 12px;
    border-radius: 10px;
    margin-bottom: 10px;
    font-size: 13px;
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .learn-cancel {
    margin-left: auto;
    background: transparent;
    border: 1px solid #BB86FC;
    color: #BB86FC;
    border-radius: 8px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .midi-binding-list {
    display: grid;
    gap: 4px;
    margin: 10px 0 14px;
    max-height: 40vh;
    overflow-y: auto;
    padding-right: 2px;
  }
  .midi-row {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: #1c1c24;
    border-radius: 8px;
    font-size: 12px;
  }
  .midi-row.learning { background: rgba(187, 134, 252, 0.18); }
  .midi-target { font-weight: 500; }
  .midi-binding { color: rgba(255, 255, 255, 0.55); text-align: right; min-width: 84px; }
  .midi-binding em { color: #555; font-style: normal; }
  .midi-btn {
    background: #2a2a30;
    border: none;
    color: #fff;
    border-radius: 6px;
    padding: 4px 10px;
    font-size: 12px;
  }
  .midi-btn-clear { background: transparent; color: rgba(255, 255, 255, 0.55); }
  .midi-btn:disabled { opacity: 0.4; }
</style>
