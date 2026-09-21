<script lang="ts">
  export let rate = 1;
  export let bounce = false;
  export let onselect: (direction: -1 | 1) => void;
</script>

<div data-help-page="clip-launcher" class="direction-options" role="group" aria-label={bounce ? 'Launch direction' : 'Playback direction'}>
  <button class:active={rate < 0} aria-pressed={rate < 0} aria-label={bounce ? 'Launch in reverse' : 'Play in reverse'}
    onclick={() => onselect(-1)} title={bounce ? 'Start toward the trim start, then bounce' : 'Play in reverse'}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M19 12H5m7-7-7 7 7 7"/></svg>
  </button>
  <button class:active={rate >= 0} aria-pressed={rate >= 0} aria-label={bounce ? 'Launch forward' : 'Play forward'}
    onclick={() => onselect(1)} title={bounce ? 'Start toward the trim end, then bounce' : 'Play forward'}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14m-7-7 7 7-7 7"/></svg>
  </button>
</div>

<style>
  .direction-options { display: inline-flex; flex-shrink: 0; gap: 3px; }
  button { display: flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;
    border-radius: var(--ga-r-hard, 5px); color: var(--text-secondary, #a6adba);
    background: var(--ga-card, #16191f); border: 1px solid var(--border-secondary, #303540); cursor: pointer; }
  button:hover { color: var(--text-primary, #eef0f4); border-color: #485064; }
  button.active { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #172a5b); border-color: var(--ga-selection-line, #3d59b8); }
  button:focus-visible { outline: 2px solid var(--ga-focus, #7996ff); outline-offset: 2px; }
</style>
