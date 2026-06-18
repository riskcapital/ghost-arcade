<script lang="ts">
  export let clipGrid: (any | null)[][] = [];
  export let layerStates: any[] = [];
  export let numColumns: number = 8;
  export let isTablet: boolean = false;
  export let onTriggerClip: (layerIndex: number, columnIndex: number) => void = () => {};
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

  function getTypeIcon(type: string): string {
    switch (type) {
      case 'shader': return '\u2726';
      case 'video': return '\u25B6';
      case 'image': return '\u25A3';
      case 'threejs': return '\u25C6';
      default: return '\u25CF';
    }
  }

  function handleCellTap(layerIndex: number, columnIndex: number) {
    onTriggerClip(layerIndex, columnIndex);
  }
</script>

<div class="clip-grid" class:tablet={isTablet}>
  {#each clipGrid as row, layerIndex}
    <div class="grid-row">
      <!-- Layer label -->
      <div
        class="layer-label"
        style="--layer-color: {layerColors[layerIndex % layerColors.length]}"
      >
        <span class="layer-num">L{layerIndex + 1}</span>
        {#if layerStates[layerIndex]?.activeClip}
          <button class="stop-layer-btn" on:click={() => onStopLayer(layerIndex)}>
            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
          </button>
        {/if}
      </div>

      <!-- Clip cells -->
      <div class="cells-row">
        {#each row as clip, columnIndex}
          <button
            class="clip-cell"
            class:active={layerStates[layerIndex]?.activeColumn === columnIndex}
            class:empty={!clip}
            class:tablet={isTablet}
            style="--layer-color: {layerColors[layerIndex % layerColors.length]}"
            on:click={() => clip && handleCellTap(layerIndex, columnIndex)}
          >
            {#if clip}
              {#if clip.thumbnail}
                <img class="clip-thumb" src={clip.thumbnail} alt={clip.name} />
              {:else}
                <span class="clip-type-icon">{getTypeIcon(clip.type)}</span>
              {/if}
              <span class="clip-name">{clip.name}</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .clip-grid {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px;
  }
  .clip-grid.tablet {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
  }

  .grid-row {
    display: flex;
    gap: 2px;
    align-items: stretch;
  }

  .layer-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    width: 36px;
    min-width: 36px;
    padding: 4px 2px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 4px;
    border-left: 2px solid var(--layer-color);
  }

  .layer-num {
    font-size: 11px;
    font-weight: 700;
    color: var(--layer-color);
    text-shadow: 0 0 6px var(--layer-color);
  }

  .stop-layer-btn {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 3px;
    background: rgba(255, 68, 68, 0.2);
    color: #ff4444;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    transition: all 0.1s;
  }
  .stop-layer-btn:active {
    background: rgba(255, 68, 68, 0.5);
    transform: scale(0.9);
  }

  .cells-row {
    display: flex;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .clip-cell {
    flex: 1;
    min-width: 0;
    aspect-ratio: 16 / 10;
    background: #0e0e12;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 2px;
    overflow: hidden;
    position: relative;
    transition: border-color 0.1s, box-shadow 0.1s, transform 0.08s;
    -webkit-tap-highlight-color: transparent;
  }

  .clip-cell.tablet {
    aspect-ratio: 16 / 9;
    min-height: var(--clip-cell-min-height, 48px);
  }

  .clip-cell.empty {
    cursor: default;
    opacity: 0.4;
  }

  .clip-cell:not(.empty):active {
    transform: scale(0.92);
    border-color: var(--layer-color);
    box-shadow: 0 0 8px var(--layer-color);
  }

  .clip-cell.active {
    border-color: var(--layer-color);
    box-shadow:
      0 0 6px var(--layer-color),
      0 0 16px color-mix(in srgb, var(--layer-color) 20%, transparent),
      inset 0 0 10px color-mix(in srgb, var(--layer-color) 10%, transparent);
    animation: clip-glow 2s ease-in-out infinite;
  }

  @keyframes clip-glow {
    0%, 100% {
      box-shadow:
        0 0 6px var(--layer-color),
        0 0 16px color-mix(in srgb, var(--layer-color) 20%, transparent);
    }
    50% {
      box-shadow:
        0 0 10px var(--layer-color),
        0 0 28px color-mix(in srgb, var(--layer-color) 35%, transparent);
    }
  }

  .clip-thumb {
    width: 100%;
    height: 100%;
    object-fit: cover;
    position: absolute;
    inset: 0;
    border-radius: 3px;
    opacity: 0.8;
  }

  .clip-cell.active .clip-thumb {
    opacity: 1;
  }

  .clip-type-icon {
    font-size: 16px;
    color: rgba(255, 255, 255, 0.4);
    line-height: 1;
  }

  .clip-cell.active .clip-type-icon {
    color: var(--layer-color);
    text-shadow: 0 0 8px var(--layer-color);
  }

  .clip-name {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    padding: 0 1px;
    position: relative;
    z-index: 1;
  }

  .clip-cell.active .clip-name {
    color: #fff;
    text-shadow: 0 1px 4px rgba(0, 0, 0, 0.8);
  }

  .clip-grid.tablet .clip-name {
    font-size: 11px;
  }

  .clip-grid.tablet .clip-type-icon {
    font-size: 20px;
  }

  .clip-grid.tablet .layer-label {
    width: var(--clip-label-width, 44px);
    min-width: var(--clip-label-width, 44px);
  }

  .clip-grid.tablet .layer-num {
    font-size: 13px;
  }
</style>
