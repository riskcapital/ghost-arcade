<script lang="ts">
  import type { VideoPlaybackMode } from '../types';

  export let mode: VideoPlaybackMode = 'loop';
  export let direction = 1;
  export let onselect: (mode: 'loop' | 'once' | 'bounce') => void;

  const modes = [
    { value: 'loop', label: 'Loop', description: 'Repeat between the trim points' },
    { value: 'once', label: 'Once', description: 'Play once and hold the ending picture' },
    { value: 'bounce', label: 'Bounce', description: 'Play back and forth between the trim points' },
  ] as const;
</script>

<div class="playback-modes" role="group" aria-label="Playback mode">
  {#each modes as choice}
    <button class:active={mode === choice.value} aria-pressed={mode === choice.value}
      title={choice.description} onclick={() => onselect(choice.value)}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {#if choice.value === 'loop'}
          <path d="m17 1 4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 23l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3"/>
        {:else if choice.value === 'once'}
          <path d="m6 4 14 8-14 8z" fill="currentColor" stroke="none"/>
        {:else}
          <path d="M4 8h16M16 4l4 4-4 4M20 16H4M8 12l-4 4 4 4"/>
        {/if}
      </svg>
      {choice.label}
    </button>
  {/each}
  {#if mode === 'bounce'}
    <span class="direction" title="Current travel direction">
      <span aria-hidden="true">{direction < 0 ? '←' : '→'}</span>
      {direction < 0 ? 'Backward' : 'Forward'}
    </span>
  {/if}
</div>

<style>
  .playback-modes {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    align-items: center;
    gap: 4px;
  }
  button {
    min-height: 28px;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 2px;
    border: 1px solid rgba(255, 255, 255, .08);
    border-radius: var(--ga-r-hard, 5px);
    background: rgba(255, 255, 255, .05);
    color: var(--text-secondary, #b7bbc5);
    font: inherit;
    font-size: var(--ga-type-control, 12px);
    white-space: nowrap;
    cursor: pointer;
    transition: background .15s, border-color .15s, color .15s;
  }
  button:hover { background: rgba(255, 255, 255, .1); color: var(--text-primary, #eee); }
  button:focus-visible { outline: 2px solid var(--ga-focus, #7996ff); outline-offset: 2px; }
  button.active {
    background: var(--ga-selection-bg, #172a5b);
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-selection-line, #3d59b8);
  }
  svg { flex-shrink: 0; }
  .direction {
    grid-column: 1 / -1;
    display: inline-flex;
    justify-content: flex-end;
    align-items: center;
    gap: 5px;
    min-width: 76px;
    color: var(--text-secondary, #b7bbc5);
    font-size: var(--ga-type-caption, 11px);
    white-space: nowrap;
  }
</style>
