<script lang="ts">
  import { keyframeTimeline } from '../../stores/keyframeTimeline';
  import { project } from '../../stores/layers';

  $: config = $keyframeTimeline.config;
  $: layers = $project.layers;
  $: selectedLayerId = $keyframeTimeline.selectedLayerId;

  function formatTime(t: number): string {
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${ms}`;
  }

  const durations = [10, 15, 30, 60, 120, 300];
</script>

<div data-help-page="show-timeline" class="transport">
  <div class="transport-left">
    <button class="transport-btn" class:active={config.isPlaying}
      onclick={() => config.isPlaying ? keyframeTimeline.pause() : keyframeTimeline.play()}
      title={config.isPlaying ? 'Pause' : 'Play'}>
      {#if config.isPlaying}
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3.5" height="10" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" fill="currentColor"/></svg>
      {:else}
        <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>
      {/if}
    </button>
    <button class="transport-btn" onclick={() => keyframeTimeline.stop()} title="Stop">
      <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="currentColor"/></svg>
    </button>
    <button class="transport-btn" class:active={config.isLooping}
      onclick={() => keyframeTimeline.setLooping(!config.isLooping)} title="Loop">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
        <path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
      </svg>
    </button>
    <span class="time-display">{formatTime(config.currentTime)}</span>
    <span class="time-sep">/</span>
    <select class="duration-select" value={config.duration}
      onchange={(e) => keyframeTimeline.setDuration(Number((e.target as HTMLSelectElement).value))}>
      {#each durations as d}
        <option value={d}>{d < 60 ? `${d}s` : `${d / 60}m`}</option>
      {/each}
    </select>
  </div>
  <div class="transport-right">
    <span class="transport-label">Layer:</span>
    <select class="layer-select" value={selectedLayerId || ''}
      onchange={(e) => keyframeTimeline.selectLayer((e.target as HTMLSelectElement).value || null)}>
      <option value="">Select layer...</option>
      {#each layers as layer}
        <option value={layer.id}>{layer.name}</option>
      {/each}
    </select>
  </div>
</div>

<style>
  .transport {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 38px;
    padding: 4px 12px;
    padding-right: 140px; /* reserve space for Clear all + Close buttons */
    border-bottom: 1px solid var(--ga-line, rgba(255,255,255,0.07));
    background: var(--ga-bar, #0a0a0e);
    gap: 8px;
    flex-shrink: 0;
  }
  .transport-left, .transport-right {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .transport-btn {
    background: none;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    color: var(--ga-ink-1, #888);
    width: var(--ga-control-h, 26px);
    height: var(--ga-control-h, 26px);
    border-radius: var(--ga-r-hard, 4px);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .transport-btn:hover:not(.active) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255,255,255,0.24)); }
  .transport-btn.active { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .time-display {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #ccc);
    min-width: 55px;
    text-align: center;
  }
  .time-sep { color: var(--ga-ink-3, #444); font-size: var(--ga-text-control, 12px); }
  .duration-select, .layer-select {
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, rgba(0,0,0,0.4));
    border: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    color: var(--ga-ink-0, #aaa);
    font-size: var(--ga-text-control, 12px);
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 6px;
    outline: none;
  }
  .layer-select { max-width: 160px; }
  .transport-label {
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-2, #666);
    margin-right: 2px;
  }
</style>
