<script lang="ts">
  /**
   * First-run coach: a strip on the lower edge of the program picture that names the next thing to try. Each step ticks
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
  <span class="progress" aria-hidden="true">{step + 1}/{COACH_STEPS.length}</span>
  <!-- Announced when the step changes, so VoiceOver users hear the next thing to try. -->
  <p role="status" aria-live="polite">
    <span class="count">Step {step + 1} of {COACH_STEPS.length}.</span>
    <strong>{current.title}</strong>
    <span class="hint">{current.hint}</span>
  </p>
  <button class="close" data-coach-close aria-label="Close getting started tips" onclick={onclose}><Icon name="close" size={18} /></button>
</aside>

<style>
  /* Laid over the lower edge of the program picture: the deck below does not move when the
     strip appears or goes away. */
  .coach {
    position: absolute; left: 6px; right: 6px; bottom: 6px; z-index: 5;
    display: grid; grid-template-columns: auto minmax(0, 1fr) 44px; align-items: center; gap: 8px;
    max-width: 460px; margin: 0 auto; padding: 1px 0 1px 8px;
    border: 1px solid var(--ga-blue-500); border-radius: var(--ga-r-soft); background: var(--ga-blue-900);
    box-shadow: 0 4px 18px #000a; color: var(--ga-ink-0);
  }
  .progress {
    display: grid; place-items: center; min-width: 30px; height: 24px; padding: 0 4px; border-radius: 12px;
    background: var(--ga-blue-400); font-size: 12px; font-weight: 650; color: #fff;
  }
  p { position: relative; display: grid; gap: 0; margin: 0; min-width: 0; }
  .count { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  strong { font-size: 13px; font-weight: 650; line-height: 1.25; }
  .hint { font-size: 12px; line-height: 1.3; color: var(--ga-ink-1); }
  .close {
    display: grid; place-items: center; width: 44px; height: 44px; min-height: 44px; padding: 0;
    background: none; border: 0; color: var(--ga-ink-1); touch-action: manipulation;
  }
  .close:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: -4px; border-radius: 6px; }
</style>
