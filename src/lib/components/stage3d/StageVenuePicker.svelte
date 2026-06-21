<script lang="ts">
  import { VENUE_PRESETS } from '../../stage3d/venuePresets';
  import type { Stage3DBasePreset } from '../../stage3d/types';

  export let currentId: Stage3DBasePreset;
  export let onPick: (id: Stage3DBasePreset) => void;
  export let onClose: () => void;
</script>

<div class="picker-bg" onclick={onClose} role="presentation">
  <div class="picker-card" onclick={(e) => e.stopPropagation()} role="presentation">
    <header>
      <h2>Pick a venue</h2>
      <button class="close-x" onclick={onClose}>✕</button>
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
    background: #0c0e16;
    border: 1px solid #2a2c36;
    border-radius: 16px;
    padding: 20px;
    color: #fff;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }
  h2 { margin: 0; font-size: 18px; font-weight: 600; }
  .close-x {
    background: #1c1e28;
    border: none;
    color: #fff;
    width: 30px;
    height: 30px;
    border-radius: 15px;
    cursor: pointer;
  }
  .lead {
    font-size: 13px;
    color: #888;
    line-height: 1.5;
    margin: 0 0 14px 0;
  }
  .picker-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 12px;
  }
  .venue-card {
    background: #14161e;
    border: 1px solid #2a2c36;
    border-radius: 12px;
    padding: 12px;
    text-align: left;
    color: #fff;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: transform 0.1s ease-out, border-color 0.15s ease-out;
  }
  .venue-card:hover { border-color: #BB86FC; transform: translateY(-2px); }
  .venue-card:active { transform: scale(0.98); }
  .venue-card.active { border-color: #BB86FC; box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.18); }
  .thumb {
    width: 100%;
    aspect-ratio: 16 / 10;
    border-radius: 8px;
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
  .venue-name { font-size: 14px; font-weight: 600; }
  .venue-desc { font-size: 12px; color: #999; line-height: 1.4; }
</style>
