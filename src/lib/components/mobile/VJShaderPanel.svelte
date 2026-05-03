<script lang="ts">
  import VJFader from './VJFader.svelte';

  export let layerStates: any[] = [];
  export let onUpdateShaderValue: (layerIndex: number, paramName: string, value: any) => void = () => {};

  const layerColors = [
    'var(--accent-primary)', '#4FC3F7', '#81C784', '#FFB74D',
    '#CE93D8', '#EF5350', '#4DD0E1', '#AED581',
  ];

  let selectedLayerIndex: number | null = 0;

  interface ISFInput {
    NAME: string;
    TYPE: string;
    DEFAULT?: number | boolean;
    MIN?: number;
    MAX?: number;
    LABEL?: string;
  }

  function parseShaderInputs(shaderCode: string): ISFInput[] {
    if (!shaderCode) return [];
    try {
      const metadataMatch = shaderCode.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//);
      if (!metadataMatch) return [];
      const metadata = JSON.parse(metadataMatch[1]);
      return (metadata.INPUTS || []).filter((input: ISFInput) =>
        input.TYPE === 'float' || input.TYPE === 'bool'
      );
    } catch {
      return [];
    }
  }

  $: activeShader = (() => {
    if (selectedLayerIndex === null) return null;
    const ls = layerStates[selectedLayerIndex];
    if (!ls?.activeClip || ls.activeClip.type !== 'shader') return null;
    return {
      layerIndex: selectedLayerIndex,
      name: ls.activeClip.name,
      inputs: parseShaderInputs(ls.activeClip.shaderCode || ''),
      values: ls.activeClip.shaderValues || {},
    };
  })();

  // Auto-select first layer that has an active shader (on mount / when layerStates change)
  $: if (layerStates.length > 0) {
    // Only auto-select if current selection has no shader
    const currentLs = selectedLayerIndex !== null ? layerStates[selectedLayerIndex] : null;
    const currentHasShader = currentLs?.activeClip?.type === 'shader' && currentLs.activeClip.shaderCode;
    if (!currentHasShader) {
      const shaderLayer = layerStates.findIndex(ls =>
        ls?.activeClip?.type === 'shader' && ls.activeClip.shaderCode
      );
      if (shaderLayer >= 0 && shaderLayer !== selectedLayerIndex) {
        selectedLayerIndex = shaderLayer;
      }
    }
  }

  function normalize(val: number, min: number, max: number): number {
    if (max === min) return 0;
    return Math.max(0, Math.min(1, (val - min) / (max - min)));
  }
</script>

<div class="shader-panel">
  <!-- Layer selector -->
  <div class="layer-selector">
    {#each layerStates as ls, i}
      <button
        class="layer-btn"
        class:active={selectedLayerIndex === i}
        class:has-shader={ls?.activeClip?.type === 'shader'}
        style="--lc: {layerColors[i % layerColors.length]}"
        on:click={() => selectedLayerIndex = i}
      >
        <span class="layer-dot"></span>
        <span class="layer-num">L{i + 1}</span>
      </button>
    {/each}
  </div>

  <!-- Shader params -->
  <div class="shader-content">
    {#if activeShader && activeShader.inputs.length > 0}
      <div class="shader-header">
        <span class="shader-icon">✦</span>
        <span class="shader-name">{activeShader.name}</span>
      </div>
      <div class="shader-params">
        {#each activeShader.inputs as input}
          {#if input.TYPE === 'float'}
            {@const min = input.MIN ?? 0}
            {@const max = input.MAX ?? 1}
            {@const currentVal = activeShader.values[input.NAME] ?? input.DEFAULT ?? ((min + max) / 2)}
            <div class="param-row">
              <span class="param-label">{input.LABEL || input.NAME}</span>
              <div class="param-slider">
                <VJFader
                  value={normalize(currentVal, min, max)}
                  label=""
                  color={layerColors[activeShader.layerIndex % layerColors.length]}
                  orientation="horizontal"
                  onChange={(norm) => {
                    const mapped = min + norm * (max - min);
                    onUpdateShaderValue(activeShader.layerIndex, input.NAME, mapped);
                  }}
                  showLeds={false}
                  height={0}
                />
              </div>
              <span class="param-val">{currentVal.toFixed(2)}</span>
            </div>
          {:else if input.TYPE === 'bool'}
            <div class="param-row bool-row">
              <span class="param-label">{input.LABEL || input.NAME}</span>
              <button
                class="bool-toggle"
                class:on={!!activeShader.values[input.NAME]}
                on:click={() => onUpdateShaderValue(activeShader.layerIndex, input.NAME, !activeShader.values[input.NAME])}
              >{activeShader.values[input.NAME] ? 'ON' : 'OFF'}</button>
            </div>
          {/if}
        {/each}
      </div>
    {:else if selectedLayerIndex !== null}
      <div class="empty-state">
        <span class="empty-icon">✦</span>
        <span class="empty-text">
          {#if layerStates[selectedLayerIndex]?.activeClip}
            L{selectedLayerIndex + 1}: {layerStates[selectedLayerIndex].activeClip.name}
            {#if layerStates[selectedLayerIndex].activeClip.type !== 'shader'}
              <br/><span class="empty-sub">Not a shader clip</span>
            {:else}
              <br/><span class="empty-sub">No adjustable parameters</span>
            {/if}
          {:else}
            No active clip on L{selectedLayerIndex + 1}
          {/if}
        </span>
      </div>
    {:else}
      <div class="empty-state">
        <span class="empty-icon">✦</span>
        <span class="empty-text">Select a layer</span>
      </div>
    {/if}
  </div>
</div>

<style>
  .shader-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    gap: 2px;
  }

  /* ── Layer Selector ── */
  .layer-selector {
    display: flex;
    gap: 3px;
    padding: 4px;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .layer-btn {
    display: flex;
    align-items: center;
    gap: 3px;
    padding: 4px 8px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
    color: rgba(255, 255, 255, 0.4);
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }

  .layer-btn.active {
    border-color: var(--lc);
    color: var(--lc);
    background: rgba(255, 255, 255, 0.06);
    box-shadow: 0 0 6px color-mix(in srgb, var(--lc) 20%, transparent);
  }

  .layer-btn.has-shader .layer-dot {
    box-shadow: 0 0 4px var(--lc);
  }

  .layer-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--lc);
    opacity: 0.5;
  }

  .layer-btn.active .layer-dot {
    opacity: 1;
  }

  .layer-num {
    font-size: 10px;
  }

  /* ── Shader Content ── */
  .shader-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    touch-action: pan-y;
    -webkit-overflow-scrolling: touch;
    padding: 4px;
  }

  .shader-header {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 6px;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .shader-icon { color: #BB86FC; font-size: 11px; }
  .shader-name {
    font-size: 10px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .shader-params {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .param-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .param-label {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.45);
    min-width: 55px;
    max-width: 55px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .param-slider {
    flex: 1;
    min-width: 0;
  }

  .param-val {
    font-size: 8px;
    color: rgba(255, 255, 255, 0.35);
    min-width: 30px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .bool-row { justify-content: space-between; }
  .bool-toggle {
    padding: 3px 10px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.5);
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .bool-toggle.on {
    background: rgba(187, 134, 252, 0.15);
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* ── Empty State ── */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 20px 10px;
    text-align: center;
  }

  .empty-icon {
    font-size: 20px;
    color: rgba(187, 134, 252, 0.25);
  }

  .empty-text {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.3);
    line-height: 1.4;
  }

  .empty-sub {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.2);
  }
</style>
