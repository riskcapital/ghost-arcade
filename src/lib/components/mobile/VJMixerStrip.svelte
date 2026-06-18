<script lang="ts">
  import VJFader from './VJFader.svelte';

  export let layerIndex: number = 0;
  export let layerState: any = null;
  export let isTablet: boolean = false;
  export let compact: boolean = false;
  export let faderHeight: number = 180;
  export let onOpacityChange: (layerIndex: number, opacity: number) => void = () => {};
  export let onBlendModeChange: (layerIndex: number, blendMode: string) => void = () => {};
  export let onStopLayer: (layerIndex: number) => void = () => {};

  const layerColors = [
    'var(--accent-primary)',
    '#4FC3F7',
    '#81C784',
    '#FFB74D',
    '#CE93D8',
    '#EF5350',
    '#4DD0E1',
    '#AED581',
  ];

  const blendModes = [
    'normal', 'multiply', 'screen', 'add', 'difference',
    'overlay', 'darken', 'lighten', 'exclusion',
    'hardlight', 'softlight', 'color-dodge', 'color-burn',
  ];

  $: color = layerColors[layerIndex % layerColors.length];
  $: opacity = layerState?.opacity ?? 1;
  $: blendMode = layerState?.blendMode ?? 'normal';
  $: activeClip = layerState?.activeClip;
  $: clipName = activeClip?.name || '--';
  $: isPlaying = !!activeClip;

  function handleOpacityChange(val: number) {
    onOpacityChange(layerIndex, val);
  }

  function handleBlendChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    onBlendModeChange(layerIndex, select.value);
  }
</script>

{#if isTablet}
  <!-- VERTICAL channel strip for iPad -->
  <div class="mixer-strip vertical" class:compact style="--strip-color: {color}">
    <span class="strip-label">L{layerIndex + 1}</span>
    <span class="strip-clip-name" class:active={isPlaying}>{clipName}</span>
    <VJFader
      value={opacity}
      label=""
      color={color}
      height={faderHeight}
      orientation="vertical"
      onChange={handleOpacityChange}
      showLeds={true}
      ledCount={8}
    />
    <select class="blend-select" value={blendMode} on:change={handleBlendChange}>
      {#each blendModes as mode}
        <option value={mode}>{mode}</option>
      {/each}
    </select>
    <button
      class="stop-btn"
      class:playing={isPlaying}
      on:click={() => onStopLayer(layerIndex)}
      disabled={!isPlaying}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
    </button>
  </div>
{:else}
  <!-- HORIZONTAL strip for phone -->
  <div class="mixer-strip horizontal" style="--strip-color: {color}">
    <span class="strip-label">L{layerIndex + 1}</span>
    <div class="strip-fader-area">
      <VJFader
        value={opacity}
        label=""
        color={color}
        height={0}
        orientation="horizontal"
        onChange={handleOpacityChange}
        showLeds={true}
        ledCount={8}
      />
    </div>
    <select class="blend-select-h" value={blendMode} on:change={handleBlendChange}>
      {#each blendModes as mode}
        <option value={mode}>{mode.slice(0, 6)}</option>
      {/each}
    </select>
    <button
      class="stop-btn-h"
      class:playing={isPlaying}
      on:click={() => onStopLayer(layerIndex)}
      disabled={!isPlaying}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
    </button>
  </div>
{/if}

<style>
  /* ── Vertical Strip (iPad) ── */
  .mixer-strip.vertical {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 10px 6px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    width: 80px;
    border-top: 2px solid var(--strip-color);
    box-sizing: border-box;
    flex: 0 0 auto;
  }

  .mixer-strip.vertical.compact {
    gap: 3px;
    padding: 6px 4px;
    width: var(--tablet-mixer-width, 68px);
    border-radius: 6px;
  }

  .strip-label {
    font-size: 13px;
    font-weight: 800;
    color: var(--strip-color);
    text-shadow: 0 0 8px var(--strip-color);
    letter-spacing: 1px;
  }
  .mixer-strip.vertical.compact .strip-label {
    font-size: 12px;
    line-height: 1;
  }

  .strip-clip-name {
    font-size: 10px;
    color: rgba(255, 255, 255, 0.35);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 72px;
    min-height: 14px;
  }
  .mixer-strip.vertical.compact .strip-clip-name {
    font-size: 9.5px;
    max-width: calc(var(--tablet-mixer-width, 68px) - 10px);
    min-height: 10px;
    line-height: 10px;
  }
  .strip-clip-name.active {
    color: rgba(255, 255, 255, 0.7);
  }

  .blend-select {
    width: 68px;
    padding: 4px 2px;
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    cursor: pointer;
    text-align: center;
    -webkit-appearance: none;
  }
  .mixer-strip.vertical.compact .blend-select {
    width: 100%;
    height: 20px;
    padding: 2px;
    font-size: 10px;
  }
  .blend-select:focus {
    border-color: var(--strip-color);
    outline: none;
  }

  .stop-btn {
    width: 32px;
    height: 24px;
    border: 1px solid rgba(255, 68, 68, 0.2);
    border-radius: 4px;
    background: rgba(255, 68, 68, 0.06);
    color: #555;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.12s;
  }
  .mixer-strip.vertical.compact .stop-btn {
    width: 28px;
    height: 20px;
  }
  .stop-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .stop-btn.playing {
    color: #ff4444;
    border-color: rgba(255, 68, 68, 0.4);
    background: rgba(255, 68, 68, 0.12);
    animation: stop-pulse 1.5s ease-in-out infinite;
  }
  .stop-btn:not(:disabled):active {
    transform: scale(0.9);
    background: rgba(255, 68, 68, 0.3);
  }

  @keyframes stop-pulse {
    0%, 100% { box-shadow: none; }
    50% { box-shadow: 0 0 8px rgba(255, 68, 68, 0.3); }
  }

  /* ── Horizontal Strip (Phone) ── */
  .mixer-strip.horizontal {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 8px;
    border-left: 3px solid var(--strip-color);
  }

  .mixer-strip.horizontal .strip-label {
    font-size: 13px;
    font-weight: 800;
    min-width: 24px;
    text-align: center;
  }

  .strip-fader-area {
    flex: 1;
    min-width: 0;
    overflow: visible;
  }

  .blend-select-h {
    width: 56px;
    padding: 6px 2px;
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    cursor: pointer;
    -webkit-appearance: none;
    flex-shrink: 0;
  }

  .stop-btn-h {
    width: 36px;
    height: 36px;
    border: 1px solid rgba(255, 68, 68, 0.2);
    border-radius: 6px;
    background: rgba(255, 68, 68, 0.06);
    color: #555;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.12s;
    flex-shrink: 0;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  .stop-btn-h:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .stop-btn-h.playing {
    color: #ff4444;
    border-color: rgba(255, 68, 68, 0.4);
    background: rgba(255, 68, 68, 0.12);
  }
  .stop-btn-h:not(:disabled):active {
    transform: scale(0.9);
  }
</style>
