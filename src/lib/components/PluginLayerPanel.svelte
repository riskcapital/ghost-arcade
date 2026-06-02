<script lang="ts">
  import { project, selectedLayerId, selectedLayer } from '../stores/layers';
  import { getPluginByEffectType, type PluginManifest, type PluginParamDef } from '../plugins/registry';
  import type { MediaSource, IntegratedEffectSource } from '../types';
  import MilkdropPanel from './MilkdropPanel.svelte';
  import HydraPanel from './HydraPanel.svelte';

  export let source: MediaSource | null = null;

  // Resolve the plugin manifest from the source
  $: effectSource = source?.effectSource ?? null;
  $: pluginManifest = effectSource
    ? getPluginByEffectType(effectSource.effectType)
    : null;

  // Get current value of a param from the effectSource
  function getVal(paramKey: string, defaultVal: any): any {
    if (!effectSource) return defaultVal;
    return (effectSource as any)[paramKey] ?? defaultVal;
  }

  // Update a single param on the layer's effectSource
  function setParam(paramKey: string, value: any) {
    if (!$selectedLayerId || !effectSource) return;
    const layerId = $selectedLayerId;
    const layer = $selectedLayer;
    if (!layer?.source?.effectSource) return;

    const updated: IntegratedEffectSource = {
      ...layer.source.effectSource,
      [paramKey]: value,
    };

    project.setLayerSource(layerId, {
      ...layer.source,
      effectSource: updated,
    });
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
    <p>No plugin controls</p>
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
    {#if effectSource.effectType === 'milkdrop' && $selectedLayerId}
      <MilkdropPanel
        layerId={$selectedLayerId}
        presetPack={(effectSource as any).milkdropPresetPack ?? 'minimal'}
        routingMatrix={(effectSource as any).milkdropRoutingMatrix ?? {}}
      />
    {/if}
    {#if effectSource.effectType === 'hydra' && $selectedLayerId}
      <HydraPanel layerId={$selectedLayerId} />
    {/if}

    <!-- All controls, flat -->
    <div class="controls">
      {#each pluginManifest.paramDefs as def (def.param)}
        {#if !def.showWhen || (def.showWhen.values || []).includes(getVal(def.showWhen.param, undefined))}
        {#if def.type === 'select'}
          {@const optValues = (def.options ?? []).map(o => String(o.value))}
          <div
            class="control-row"
            data-midi-path={`map:plugin:${def.param}`}
            data-midi-label={def.name}
            data-midi-min={0}
            data-midi-max={Math.max(0, optValues.length - 1)}
            data-midi-step={1}
            data-midi-discrete={optValues.join(',')}
          >
            <span class="label">{def.name}</span>
            <div class="select-row">
              {#each (def.options || []) as opt}
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
              data-midi-path={`map:plugin:${def.param}`}
              data-midi-label={def.name}
              data-midi-min={0}
              data-midi-max={1}
              data-midi-step={1}
              data-midi-mode="toggle"
            >
              {getVal(def.param, def.default) ? 'ON' : 'OFF'}
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
              data-midi-path={`map:plugin:${def.param}`}
              data-midi-label={def.name}
              data-midi-min={def.min ?? 0}
              data-midi-max={def.max ?? 1}
              data-midi-step={def.step ?? 0.01}
            />
            <span class="val">{fmt(getVal(def.param, def.default), def.step)}</span>
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
    font-size: 11px;
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
    font-size: 20px;
  }

  .header-text {
    display: flex;
    flex-direction: column;
  }

  .header-title {
    font-weight: 700;
    font-size: 13px;
    color: #eee;
    letter-spacing: 0.3px;
  }

  .header-version {
    font-size: 9px;
    color: #555;
  }

  /* ── Powered-by credit badge ── */
  .powered-by {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 12px;
    background: rgba(255, 107, 107, 0.04);
    border-bottom: 1px solid rgba(255, 107, 107, 0.10);
    font-size: 9px;
    color: #666;
    line-height: 1.3;
    flex-wrap: wrap;
  }
  .pb-label {
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-size: 8px;
  }
  .pb-engine {
    color: var(--accent-secondary, #FF8585);
    font-weight: 600;
    text-decoration: none;
  }
  a.pb-engine:hover {
    color: var(--accent-primary, #FF6B6B);
    text-decoration: underline;
  }
  .pb-authors {
    color: #888;
  }
  .pb-license {
    margin-left: auto;
    padding: 1px 5px;
    background: rgba(255, 107, 107, 0.10);
    border: 1px solid rgba(255, 107, 107, 0.20);
    color: var(--accent-secondary, #FF8585);
    border-radius: 2px;
    font-size: 8px;
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
    font-size: 9px;
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
    background: #1a1a22;
    border: 1px solid #333;
    border-radius: 3px;
    color: #888;
    font-size: 9px;
    cursor: pointer;
    transition: all 0.12s;
  }

  .sel-btn:hover {
    background: #2a2a38;
    color: #ddd;
  }

  .sel-btn.active {
    background: linear-gradient(135deg, #1e1040, #2a1560);
    border-color: #BB86FC;
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
    background: #1a1a22;
    border: 1px solid #333;
    border-radius: 3px;
    color: #666;
    font-size: 10px;
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

  .slider-row input[type="range"] {
    flex: 1;
    height: 3px;
    -webkit-appearance: none;
    background: #2a2a38;
    border-radius: 2px;
    cursor: pointer;
  }

  .slider-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px;
    height: 10px;
    background: #BB86FC;
    border-radius: 50%;
    cursor: pointer;
    box-shadow: 0 0 4px rgba(187, 134, 252, 0.4);
  }

  .val {
    font-size: 9px;
    color: #666;
    min-width: 36px;
    text-align: right;
    font-family: 'JetBrains Mono', monospace;
  }
</style>
