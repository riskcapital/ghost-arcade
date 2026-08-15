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

<div class="transport">
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
    padding: 4px 8px;
    padding-right: 140px; /* reserve space for Clear All + Close buttons */
    border-bottom: 1px solid rgba(255,255,255,0.06);
    background: rgba(10, 10, 14, 0.95);
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
    border: 1px solid rgba(255,255,255,0.1);
    color: var(--text-muted, #888);
    width: 26px;
    height: 26px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .transport-btn:hover { color: #fff; border-color: rgba(255,255,255,0.2); }
  .transport-btn.active { color: var(--ga-coral, #ff6f5e); border-color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 40%, transparent); }
  .time-display {
    font-family: var(--font-jetbrains), monospace;
    font-size: 13px;
    color: var(--text-primary, #ccc);
    min-width: 55px;
    text-align: center;
  }
  .time-sep { color: #444; font-size: 12px; }
  .duration-select, .layer-select {
    background: rgba(0,0,0,0.4);
    border: 1px solid rgba(255,255,255,0.1);
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    border-radius: 3px;
    padding: 2px 4px;
    outline: none;
  }
  .layer-select { max-width: 160px; }
  .transport-label {
    font-size: 11px;
    color: #666;
    text-transform: uppercase;
  }
</style>
