<script lang="ts">
  import { VENUE_PRESETS } from '../../stage3d/venuePresets';
  import type { Stage3DBasePreset } from '../../stage3d/types';

  export let currentId: Stage3DBasePreset;
  export let onPick: (id: Stage3DBasePreset) => void;
  export let onClose: () => void;
</script>

<div data-help-page="stage-simulator" class="picker-bg" onclick={onClose} role="presentation">
  <div class="picker-card" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <h2>Pick a venue</h2>
      <button aria-label="Close venue picker" class="close-x" onclick={onClose}>✕</button>
    </header>
    <p class="lead">Sets the stage scenery — truss, ceiling, walls, lighting baseline, floor finish. LED layout still flows from your 2D Stage Designer.</p>

    <div class="picker-grid">
      {#each VENUE_PRESETS as entry (entry.id)}
        <button
          class="venue-card"
          class:active={currentId === entry.id}
          onclick={() => onPick(entry.id)}
        >
          <div class="thumb" style="background: linear-gradient(135deg, {entry.gradient[0]}, {entry.gradient[1]});">
            <span class="thumb-letter">{entry.label.charAt(0)}</span>
          </div>
          <span class="venue-name">{entry.label}</span>
          <span class="venue-desc">{entry.tagline}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .picker-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(8px);
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .picker-card {
    width: 100%;
    max-width: 720px;
    max-height: 85vh;
    overflow-y: auto;
    background: var(--ga-panel);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft, 8px);
    padding: 20px;
    color: var(--ga-ink-0);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close-x {
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0);
    width: 30px;
    height: 30px;
    border-radius: var(--ga-r-hard, 5px);
    cursor: pointer;
  }
  .lead {
    font-size: 13px;
    color: var(--ga-ink-2);
    line-height: 1.5;
    margin: 0 0 14px 0;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .venue-card {
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-tile, 7px);
    padding: 12px;
    text-align: left;
    color: var(--ga-ink-0);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: transform 0.1s ease-out, border-color 0.15s ease-out;
  }
  .venue-card:hover { border-color: var(--ga-selection-line); transform: translateY(-2px); }
  .venue-card:active { transform: scale(0.98); }
  .venue-card.active { border-color: var(--ga-selection-line); box-shadow: 0 0 0 2px color-mix(in srgb, var(--ga-selection-line) 25%, transparent); }
  .thumb {
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: var(--ga-r-hard, 5px);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 4px;
  }
  .thumb-letter {
    font-size: 37px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.9);
    text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
  }
  .venue-name { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); }
  .venue-desc { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2); line-height: 1.4; }
</style>
