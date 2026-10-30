<script lang="ts">
  import { onMount } from 'svelte';
  import { mediaPipeSource } from '../mediapipe/mediaPipeSource';
  import { HAND_FX_BODY_MODES, HAND_FX_FACE_MODES } from '../renderer/nativeHandFxField';
  let handStatus = '';
  onMount(() => {
    const refresh = () => {
      if (effectSource?.effectType !== 'handfx') return;
      const mode = getVal('handfxMode', 'bridge');
      const wantsBody = HAND_FX_BODY_MODES.includes(mode), wantsFace = HAND_FX_FACE_MODES.includes(mode);
      if (getVal('handfxInput', 'live') === 'demo') { handStatus = wantsBody ? 'Rehearsal · virtual dancer' : wantsFace ? 'Rehearsal · virtual face' : 'Rehearsal · virtual hands'; return; }
      const error = mediaPipeSource.getError();
      if (error) { handStatus = `Camera error: ${error}`; return; }
      if (mediaPipeSource.isStarting()) { handStatus = wantsBody ? 'Starting camera and loading body tracker…' : wantsFace ? 'Starting camera and loading face tracker…' : 'Starting camera and loading hand tracker…'; return; }
      if (wantsBody || wantsFace) {
        const frame = mediaPipeSource.getLastFrame();
        const seen = wantsBody ? !!frame.pose?.length : !!frame.face?.length;
        handStatus = !mediaPipeSource.isRunning() ? 'Waiting for camera'
          : seen ? (wantsBody ? 'Body tracked' : 'Face tracked')
          : wantsBody ? 'Camera ready · step back until your whole body is in view' : 'Camera ready · bring your face into view';
        return;
      }
      const count = mediaPipeSource.getLastFrame().hands.length;
      handStatus = mediaPipeSource.isRunning()
        ? count ? `${count} hand${count === 1 ? '' : 's'} tracked${getVal('handfxMode', 'bridge') === 'bridge' && count < 2 ? ' · Energy Bridge needs two hands' : ''}` : 'Camera ready · bring your hands into view'
        : 'Waiting for camera';
    };
    refresh();
    const timer = setInterval(refresh, 300);
    return () => clearInterval(timer);
  });
  import { project, selectedLayerId, selectedLayer } from '../stores/layers';
  import { getPluginByEffectType } from '../plugins/registry';
  import type { MediaSource, IntegratedEffectSource } from '../types';
  import MilkdropPanel from './MilkdropPanel.svelte';
  import HydraPanel from './HydraPanel.svelte';

  export let source: MediaSource | null = null;
  export let onUpdateEffectSource: ((next: IntegratedEffectSource) => void) | null = null;
  export let controlLayerId: string | null = null;
  export let midiPrefix = 'map:plugin';

  // Resolve the plugin manifest from the source
  $: effectSource = source?.effectSource ?? null;
  $: pluginManifest = effectSource
    ? getPluginByEffectType(effectSource.effectType)
    : null;
  $: panelLayerId = controlLayerId ?? $selectedLayerId ?? '';

  // Get current value of a param from the effectSource
  function getVal(paramKey: string, defaultVal: any): any {
    if (!effectSource) return defaultVal;
    return (effectSource as any)[paramKey] ?? defaultVal;
  }

  function commitEffectSource(updated: IntegratedEffectSource) {
    if (onUpdateEffectSource) {
      onUpdateEffectSource(updated);
      return;
    }

    if (!$selectedLayerId) return;
    const layerId = $selectedLayerId;
    const layer = $selectedLayer;
    if (!layer?.source?.effectSource) return;
    project.setLayerSource(layerId, {
      ...layer.source,
      effectSource: updated,
    });
  }

  // Update a single param on the current effectSource. Mapping mode writes
  // through project.setLayerSource; VJ mode supplies onUpdateEffectSource.
  function setParam(paramKey: string, value: any) {
    if (!effectSource) return;

    const base = onUpdateEffectSource
      ? effectSource
      : ($selectedLayer?.source?.effectSource ?? effectSource);
    const updated: IntegratedEffectSource = {
      ...base,
      [paramKey]: value,
    };

    commitEffectSource(updated);
  }

  function changeMovement(direction: -1 | 1 | 'random') {
    const key = effectSource?.effectType === 'ghostfx' ? 'ghostfxScenePreset' : 'handfxMode';
    const def = pluginManifest?.paramDefs.find(def => def.param === key);
    const options = def?.options ?? [];
    if (options.length < 2) return;
    const current = Math.max(0, options.findIndex(option => option.value === getVal(key, def?.default)));
    const step = direction === 'random' ? 1 + Math.floor(Math.random() * (options.length - 1)) : direction;
    setParam(key, options[(current + step + options.length) % options.length].value);
  }

  const gestureGuides: Record<string, string> = {
    bridge: 'Two hands stretch the bridge. Move them together to compress its energy.',
    orbit: 'Each palm carries an orbital field. Pinch to contract it; open your hand to expand.',
    lasers: 'Spread your fingers to fan the beams. Rotate your hands to aim them.',
    portal: 'Carry a star tunnel in each palm. Pinch to narrow it; open to expand the gates.',
    web: 'Spread your fingers to stretch an electric web. Curl and rotate your hands to reshape it.',
    silk: 'Open your hands to unfurl flowing silk. Aim with your wrist; pinch to gather the strands.',
    bursts: 'Pinch thumb and index to spray. Release to let the particles drift away.',
    bodyswarm: 'Your body is made of sparks. Stand still to hold your shape; move fast to throw it off.',
    bodyflow: 'The frame is a fluid and your body stirs it. Sweep an arm to send a wave across the screen.',
    bodyaura: 'A burning outline follows you. Wrists and ankles draw ribbons of light as they move.',
    facemask: 'Your face is a mask of light. Change expression fast to shatter it; hold still and it reforms.',
    facestream: 'Open your mouth to breathe out light. Turn your head to aim it; raise your brows to lift it.',
  };

  function colorToHex(value: any, fallback: any): string {
    const color = Array.isArray(value) ? value : fallback;
    if (typeof color === 'string') return color.startsWith('#') ? color : `#${color}`;
    const parts = [0, 1, 2].map((i) => {
      const n = Math.max(0, Math.min(1, Number(color?.[i] ?? 0)));
      return Math.round(n * 255).toString(16).padStart(2, '0');
    });
    return `#${parts.join('')}`;
  }

  function hexToRgbArray(hex: string): [number, number, number] {
    return [
      parseInt(hex.slice(1, 3), 16) / 255,
      parseInt(hex.slice(3, 5), 16) / 255,
      parseInt(hex.slice(5, 7), 16) / 255,
    ];
  }

  function handleHydraPresetSelect(preset: { name: string; code: string }) {
    if (!effectSource || !onUpdateEffectSource) return;
    commitEffectSource({
      ...effectSource,
      hydraSketchName: preset.name,
      hydraSketchCode: preset.code,
    } as IntegratedEffectSource);
  }

  // Format a number for display based on step size
  function fmt(val: any, step?: number): string {
    if (typeof val !== 'number') return String(val);
    if (step && step < 0.001) return val.toFixed(5);
    if (step && step < 0.01) return val.toFixed(3);
    if (step && step < 0.1) return val.toFixed(2);
    return val.toFixed(1);
  }
</script>

{#if !pluginManifest || !effectSource}
  <div data-help-page="custom-effects" class="panel-empty">
    <p>No plugin controls</p>
  </div>
{:else}
  <div data-help-page="custom-effects" class="plugin-panel">
    <!-- Header -->
    <div class="panel-header">
      <span class="header-icon">{pluginManifest.icon}</span>
      <div class="header-text">
        <span class="header-title">{pluginManifest.name}</span>
        <span class="header-version">v{pluginManifest.version} · {pluginManifest.author}</span>
      </div>
    </div>

    <!-- Powered-by credit for plugins wrapping third-party engines.
         Originals (FluidGen, Particles3D) omit poweredBy and skip this. -->
    {#if pluginManifest.poweredBy}
      <div class="powered-by">
        <span class="pb-label">powered by</span>
        {#if pluginManifest.poweredBy.url}
          <a
            href={pluginManifest.poweredBy.url}
            target="_blank"
            rel="noopener noreferrer"
            class="pb-engine"
            title={pluginManifest.poweredBy.url}
          >{pluginManifest.poweredBy.engine}</a>
        {:else}
          <span class="pb-engine">{pluginManifest.poweredBy.engine}</span>
        {/if}
        {#if pluginManifest.poweredBy.authors}
          <span class="pb-authors">— {pluginManifest.poweredBy.authors}</span>
        {/if}
        {#if pluginManifest.poweredBy.license}
          <span class="pb-license">{pluginManifest.poweredBy.license}</span>
        {/if}
      </div>
    {/if}

    <!-- Plugin-specific custom panel (rendered above the generic controls) -->
    {#if effectSource.effectType === 'milkdrop' && panelLayerId}
      <MilkdropPanel
        layerId={panelLayerId}
        presetPack={(effectSource as any).milkdropPresetPack ?? 'minimal'}
      />
    {/if}
    {#if effectSource.effectType === 'hydra' && panelLayerId}
      <HydraPanel
        layerId={panelLayerId}
        onPresetSelect={onUpdateEffectSource ? handleHydraPresetSelect : null}
      />
    {/if}

    {#if effectSource.effectType === 'ghostfx' || effectSource.effectType === 'handfx'}
      <div class="movement-nav" aria-label="Visual movements">
        <button title="Previous movement" onclick={() => changeMovement(-1)}>← Previous</button>
        <button title="Choose a different random movement" onclick={() => changeMovement('random')}>Shuffle</button>
        <button title="Next movement" onclick={() => changeMovement(1)}>Next →</button>
      </div>
    {/if}
    {#if effectSource.effectType === 'ghostfx'}
      <div class="handfx-guide">
        <span class="handfx-eyebrow">Audio / motion / light</span>
        <p>Choose a movement, then shape its motion and light. Audio follows the app’s connected input; visuals keep moving in silence.</p>
      </div>
    {/if}
    {#if effectSource.effectType === 'handfx'}
      <div class="handfx-guide">
        <span class="handfx-eyebrow">{HAND_FX_BODY_MODES.includes(getVal('handfxMode', 'bridge')) ? 'Body performance' : HAND_FX_FACE_MODES.includes(getVal('handfxMode', 'bridge')) ? 'Face performance' : 'Hand performance'}</span>
        <p role="status">{handStatus}</p>
        <p>{getVal('handfxInput', 'live') === 'demo' ? 'Rehearsal plays a virtual performer. Switch to Live camera to perform.' : HAND_FX_BODY_MODES.includes(getVal('handfxMode', 'bridge')) ? 'Step back so the camera sees your whole body. Show Camera and Camera Opacity control the camera background; tracking stays on.' : HAND_FX_FACE_MODES.includes(getVal('handfxMode', 'bridge')) ? 'Face the camera. Show Camera and Camera Opacity control the camera background; tracking stays on.' : 'Bring your hands into view. Show Camera and Camera Opacity control the selfie background; tracking stays on.'}</p>
        <p class="handfx-gesture">{gestureGuides[getVal('handfxMode', 'bridge')] ?? 'Move your hands to shape the visual. Layer it over video using Add or Screen blend.'}</p>
      </div>
    {/if}

    <!-- All controls, flat -->
    <div class="controls">
      {#each pluginManifest.paramDefs as def (def.param)}
        {#if (!def.showWhen || (def.showWhen.values || []).includes(getVal(def.showWhen.param, undefined))) && !(effectSource.effectType === 'handfx' && ['handfxTrailColorMode', 'handfxInkColorMode', 'handfxSprayColorMode'].includes(def.param) && getVal('handfxPalette', 'legacy') !== 'legacy')}
        {#if def.type === 'select'}
          {@const optValues = (def.options ?? []).map(o => String(o.value))}
          <div
            class="control-row"
            data-midi-path={`${midiPrefix}:${def.param}`}
            data-midi-label={def.name}
            data-midi-min={0}
            data-midi-max={Math.max(0, optValues.length - 1)}
            data-midi-step={1}
            data-midi-discrete={optValues.join(',')}
          >
            <span class="label">{def.name}</span>
            {#if effectSource.effectType === 'handfx' || effectSource.effectType === 'ghostfx'}
              <select aria-label={def.name} value={getVal(def.param, def.default)} onchange={(e) => setParam(def.param, def.options?.find(opt => String(opt.value) === e.currentTarget.value)?.value ?? e.currentTarget.value)}>
                {#each (def.options || []) as opt}<option value={opt.value}>{opt.label}</option>{/each}
              </select>
            {:else}
            <div class="select-row">
              {#each (def.options || []) as opt}
                <button
                  class="sel-btn"
                  class:active={getVal(def.param, def.default) === opt.value}
                  onclick={() => setParam(def.param, opt.value)}
                >{opt.label}</button>
              {/each}
            </div>
            {/if}
          </div>

        {:else if def.type === 'toggle'}
          <div class="control-row toggle-row">
            <span class="label">{def.name}</span>
            <button
              class="toggle-btn"
              class:active={!!getVal(def.param, def.default)}
              onclick={() => setParam(def.param, !getVal(def.param, def.default))}
              data-midi-path={`${midiPrefix}:${def.param}`}
              data-midi-label={def.name}
              data-midi-min={0}
              data-midi-max={1}
              data-midi-step={1}
              data-midi-mode="toggle"
            >
              {getVal(def.param, def.default) ? 'On' : 'Off'}
            </button>
          </div>

        {:else if def.type === 'slider'}
          <div class="control-row slider-row">
            <span class="label">{def.name}</span>
            <input
              type="range"
              min={def.min}
              max={def.max}
              step={def.step}
              value={getVal(def.param, def.default)}
              oninput={(e) => setParam(def.param, parseFloat((e.target as HTMLInputElement).value))}
              data-midi-path={`${midiPrefix}:${def.param}`}
              data-midi-label={def.name}
              data-midi-min={def.min ?? 0}
              data-midi-max={def.max ?? 1}
              data-midi-step={def.step ?? 0.01}
            />
            <span class="val">{fmt(getVal(def.param, def.default), def.step)}</span>
          </div>
        {:else if def.type === 'color'}
          <div class="control-row color-row">
            <span class="label">{def.name}</span>
            <input
              type="color"
              value={colorToHex(getVal(def.param, def.default), def.default)}
              oninput={(e) => setParam(def.param, hexToRgbArray((e.target as HTMLInputElement).value))}
              data-midi-path={`${midiPrefix}:${def.param}`}
              data-midi-label={def.name}
            />
          </div>
        {/if}
        {/if}
      {/each}
    </div>
  </div>
{/if}

<style>
  .movement-nav { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; margin: 12px 12px 0; }
  .movement-nav button { height: var(--ga-control-h); min-width: 0; padding: 0 6px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); background: var(--ga-sub); color: var(--ga-ink-1); font: inherit; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); cursor: pointer; white-space: nowrap; }
  .movement-nav button:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .movement-nav button:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  .handfx-guide { padding: 10px 12px; margin: 12px 12px 4px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-soft); background: var(--ga-card); }
  /* Eyebrow section label, same as every layer editor. */
  .handfx-eyebrow { color: var(--ga-ink-2); font-size: var(--ga-text-eyebrow); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking); text-transform: uppercase; }
  .handfx-guide p { color: var(--ga-ink-1); font-size: var(--ga-text-control); line-height: 1.5; margin: 6px 0 0; }
  .handfx-guide .handfx-gesture { color: var(--ga-ink-0); }
  .control-row select { box-sizing: border-box; min-width: 0; max-width: 100%; text-overflow: ellipsis; width: 100%; height: var(--ga-control-h); padding: 0 8px; color: var(--ga-ink-0); background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); font: inherit; font-size: var(--ga-text-control); }

  .panel-empty {
    padding: 20px;
    text-align: center;
    color: var(--ga-ink-2);
    font-size: var(--ga-text-control);
  }

  .plugin-panel {
    min-width: 0;
    width: 100%;
    box-sizing: border-box;
    overflow-wrap: anywhere;
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  /* ── Header ── */
  .panel-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: var(--ga-panel);
    border-bottom: 1px solid var(--ga-line-1);
  }

  .header-icon {
    font-size: 20px;
    color: var(--ga-icon);
  }

  .header-text {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .header-title {
    font-weight: var(--ga-weight-title);
    font-size: var(--ga-text-title);
    color: var(--ga-ink-0);
  }

  .header-version {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
  }

  /* ── Powered-by credit badge ── */
  .powered-by {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--ga-line-1);
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    line-height: 1.3;
    flex-wrap: wrap;
  }
  .pb-label {
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    font-size: var(--ga-text-micro);
    font-weight: 700;
  }
  .pb-engine {
    color: var(--ga-ink-0);
    font-weight: var(--ga-weight-control);
    text-decoration: none;
  }
  a.pb-engine:hover {
    color: var(--ga-ink-0);
    text-decoration: underline;
  }
  .pb-authors {
    color: var(--ga-ink-2);
  }
  .pb-license {
    margin-left: auto;
    padding: 1px 5px;
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-micro);
  }

  /* ── Controls ── */
  .controls {
    display: flex;
    flex-direction: column;
    padding: 8px 12px 12px;
    gap: 8px;
  }

  .control-row {
    min-width: 0;
    box-sizing: border-box;
  }

  .label {
    display: block;
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1);
    margin-bottom: 4px;
  }

  /* ── Select buttons ── */
  .select-row {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }

  .sel-btn {
    flex: 1;
    min-width: 0;
    min-height: var(--ga-control-h-sm);
    overflow-wrap: anywhere;
    white-space: normal;
    padding: 2px 6px;
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    color: var(--ga-ink-1);
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: all 0.12s;
  }

  .sel-btn:hover:not(.active) {
    border-color: var(--ga-line-3);
    color: var(--ga-ink-0);
  }

  .sel-btn.active {
    background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line);
    color: var(--ga-selection-ink);
  }

  /* ── Toggle button ── */
  .toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .toggle-row .label {
    margin-bottom: 0;
  }

  .toggle-btn {
    min-width: 44px;
    height: var(--ga-control-h-sm);
    padding: 0 10px;
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    color: var(--ga-ink-2);
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: all 0.12s;
  }

  .toggle-btn:hover:not(.active) {
    border-color: var(--ga-line-3);
    color: var(--ga-ink-0);
  }

  .toggle-btn.active {
    background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line);
    color: var(--ga-selection-ink);
  }

  /* ── Slider ── */
  .slider-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .slider-row .label {
    width: 100%;
    margin-bottom: 0;
  }

  .slider-row input[type="range"] {
    flex: 1;
    min-width: 0;
    width: 0;
    height: 18px;
    -webkit-appearance: none;
    background: var(--ga-slot);
    border-radius: 2px;
    cursor: pointer;
  }

  .slider-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px;
    height: 10px;
    background: var(--ga-selection-line);
    border-radius: 50%;
    cursor: pointer;
  }

  .val {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1);
    min-width: 36px;
    text-align: right;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-variant-numeric: tabular-nums;
  }

  .color-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .color-row .label { margin-bottom: 0; }
  .color-row input[type="color"] {
    width: 36px;
    height: var(--ga-control-h-sm);
    padding: 0;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    background: transparent;
    cursor: pointer;
  }
</style>
