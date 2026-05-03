<script lang="ts">
  import { project, selectedLayerId, selectedLayer } from '../stores/layers';
  import { getPluginByEffectType, type PluginManifest, type PluginParamDef } from '../plugins/registry';
  import type { MediaSource, IntegratedEffectSource } from '../types';

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
        <span class="header-version">v{pluginManifest.version} by {pluginManifest.author}</span>
      </div>
    </div>

    <!-- All controls, flat -->
    <div class="controls">
      {#each pluginManifest.paramDefs as def (def.param)}
        {#if def.type === 'select'}
          <div class="control-row">
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
            />
            <span class="val">{fmt(getVal(def.param, def.default), def.step)}</span>
          </div>
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
