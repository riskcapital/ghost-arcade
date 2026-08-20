<script lang="ts">
  import { project, selectedLayerId, selectedLayer } from '../stores/layers';
  import { getPluginByEffectType } from '../plugins/registry';
  import type { MediaSource, IntegratedEffectSource } from '../types';
  import MilkdropPanel from './MilkdropPanel.svelte';
  import HydraPanel from './HydraPanel.svelte';
  import { t } from '../i18n';

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
  <div class="panel-empty">
    <p>{$t('textTools.plugin.noControls')}</p>
  </div>
{:else}
  <div class="plugin-panel">
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
        <span class="pb-label">{$t('textTools.plugin.poweredBy')}</span>
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

    <!-- All controls, flat -->
    <div class="controls">
      {#each pluginManifest.paramDefs as def (def.param)}
        {#if !def.showWhen || (def.showWhen.values || []).includes(getVal(def.showWhen.param, undefined))}
        {#if def.type === 'select'}
          {@const optValues = (def.options ?? []).map((o) => String(o.value))}
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
            <div class="select-row">
              {#each def.options || [] as opt}
                <button
                  class="sel-btn"
                  class:active={getVal(def.param, def.default) === opt.value}
                  onclick={() => setParam(def.param, opt.value)}
                >{opt.label}</button>
              {/each}
            </div>
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
              {getVal(def.param, def.default) ? $t('textTools.plugin.on') : $t('textTools.plugin.off')}
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
  .panel-empty {
    padding: 20px;
    text-align: center;
    color: #555;
    font-size: 12px;
  }

  .plugin-panel {
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
    background: linear-gradient(90deg, #111118, #16162a);
    border-bottom: 1px solid #2a2a3a;
  }

  .header-icon {
    font-size: 21px;
  }

  .header-text {
    display: flex;
    flex-direction: column;
  }

  .header-title {
    font-weight: 700;
    font-size: 14px;
    color: var(--text-primary, #eee);
    letter-spacing: 0.3px;
  }

  .header-version {
    font-size: 10px;
    color: #555;
  }

  /* ── Powered-by credit badge ── */
  .powered-by {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: rgba(255, 107, 107, 0.04);
    border-bottom: 1px solid rgba(255, 107, 107, 0.1);
    font-size: 10px;
    color: #666;
    line-height: 1.3;
    flex-wrap: wrap;
  }
  .pb-label {
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 9px;
  }
  .pb-engine {
    color: var(--accent-secondary, #ff8585);
    font-weight: 600;
    text-decoration: none;
  }
  a.pb-engine:hover {
    color: var(--accent-primary, #ff6b6b);
    text-decoration: underline;
  }
  .pb-authors {
    color: var(--text-muted, #888);
  }
  .pb-license {
    margin-left: auto;
    padding: 1px 5px;
    background: rgba(255, 107, 107, 0.1);
    border: 1px solid rgba(255, 107, 107, 0.2);
    color: var(--accent-secondary, #ff8585);
    border-radius: 2px;
    font-size: 9px;
    letter-spacing: 0.3px;
  }

  /* ── Controls ── */
  .controls {
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 2px;
  }

  .control-row {
    padding: 5px 8px;
    border-radius: 4px;
  }

  .control-row:hover {
    background: rgba(255, 255, 255, 0.02);
  }

  .label {
    display: block;
    font-size: 10px;
    color: #777;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    margin-bottom: 4px;
  }

  /* ── Select buttons ── */
  .select-row {
    display: flex;
    gap: 3px;
    flex-wrap: wrap;
  }

  .sel-btn {
    flex: 1;
    min-width: 40px;
    padding: 4px 6px;
    background: var(--bg-tertiary, #1a1a22);
    border: 1px solid #333;
    border-radius: 3px;
    color: var(--text-muted, #888);
    font-size: 10px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .sel-btn:hover {
    background: #2a2a38;
    color: var(--text-primary, #ddd);
  }

  .sel-btn.active {
    background: linear-gradient(135deg, #1e1040, #2a1560);
    border-color: #bb86fc;
    color: #d4b8ff;
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
    padding: 3px 14px;
    background: var(--bg-tertiary, #1a1a22);
    border: 1px solid #333;
    border-radius: 3px;
    color: #666;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
    letter-spacing: 0.3px;
  }

  .toggle-btn.active {
    background: #0d3320;
    border-color: #22c55e;
    color: #4ade80;
  }

  /* ── Slider ── */
  .slider-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 6px;
  }

  .slider-row .label {
    width: 100%;
    margin-bottom: 0;
  }

  .slider-row input[type='range'] {
    flex: 1;
    height: 3px;
    -webkit-appearance: none;
    background: #2a2a38;
    border-radius: 2px;
    cursor: pointer;
  }

  .slider-row input[type='range']::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px;
    height: 10px;
    background: #bb86fc;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.4);
  }

  .val {
    font-size: 10px;
    color: #666;
    min-width: 36px;
    text-align: right;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
</style>
