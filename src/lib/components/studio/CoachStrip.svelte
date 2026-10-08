<script lang="ts">
  /**
   * First-run coach: one line above the deck that names the next thing to try. Each step ticks
   * itself when the performer really does it. Closing it, or finishing, hides it for good.
   */
  import Icon from './StudioIcon.svelte';
  import { COACH_STEPS } from '../../mobile/studio/coach';

  /** Index of the step being asked for. */
  export let step = 0;
  export let onclose: () => void = () => {};

  $: current = COACH_STEPS[Math.min(step, COACH_STEPS.length - 1)];
</script>

<aside class="coach" data-coach data-coach-step={current.id} aria-label="Getting started">
  <ol class="progress" aria-hidden="true">
    {#each COACH_STEPS as s, i}<li class:done={i < step} class:now={i === step}>{i < step ? '✓' : i + 1}</li>{/each}
  </ol>
  <!-- Announced when the step changes, so VoiceOver users hear the next thing to try. -->
  <p role="status" aria-live="polite">
    <span class="count">Step {step + 1} of {COACH_STEPS.length}</span>
    <strong>{current.title}</strong>
    <span class="hint">{current.hint}</span>
  </p>
  <button class="close" data-coach-close aria-label="Close getting started tips" onclick={onclose}><Icon name="close" size={18} /></button>
</aside>

<style>
  .coach {
    display: grid; grid-template-columns: auto minmax(0, 1fr) 44px; align-items: center; gap: 10px;
    margin: 0 0 8px; padding: 6px 0 6px 10px;
    border: 1px solid var(--ga-selection-line); border-radius: var(--ga-r-soft); background: var(--ga-blue-800);
    color: var(--ga-ink-0);
  }
  .progress { display: flex; gap: 4px; margin: 0; padding: 0; list-style: none; }
  .progress li {
    display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%;
    border: 1px solid var(--ga-blue-mute-300); font-size: 11px; font-weight: 650; color: var(--ga-ink-1);
  }
  .progress li.now { background: var(--ga-blue-400); border-color: var(--ga-blue-400); color: #fff; }
  .progress li.done { background: var(--ga-blue-700); border-color: var(--ga-blue-500); color: var(--ga-selection-ink); }
  p { position: relative; display: grid; gap: 1px; margin: 0; min-width: 0; }
  .count { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  strong { font-size: 13px; font-weight: 650; line-height: 1.25; }
  .hint { font-size: 12px; line-height: 1.35; color: var(--ga-ink-1); }
  .close {
    display: grid; place-items: center; width: 44px; height: 44px; min-height: 44px; padding: 0;
    background: none; border: 0; color: var(--ga-ink-1); touch-action: manipulation;
  }
  .close:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: -4px; border-radius: 6px; }
</style>
