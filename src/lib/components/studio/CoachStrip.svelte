<script lang="ts">
  /**
   * First-run coach: a strip on the lower edge of the program picture that names the next thing to try. Each step ticks
   * itself when the performer really does it. Closing it, or finishing, hides it for good.
   */
  import Icon from './StudioIcon.svelte';
  import { COACH_STEPS, type CoachStep } from '../../mobile/studio/coach';

  /** Index of the step being asked for. */
  export let step = 0;
  /** The track's steps (the deck track unless told otherwise). */
  export let steps: CoachStep[] = COACH_STEPS;
  /** In the page flow under the picture instead of over its lower edge (the Map workspace, where corners live). */
  export let inline = false;
  /** The step's own button, for example "Connect" on the projector step. */
  export let actionLabel = '';
  export let onaction: () => void = () => {};
  /** Shown on a step that can be put off. */
  export let onskip: (() => void) | null = null;
  export let onclose: () => void = () => {};

  $: current = steps[Math.min(step, steps.length - 1)];
</script>

<aside class="coach" class:inline class:has-actions={!!actionLabel || !!onskip} data-coach data-coach-step={current.id} aria-label="Getting started">
  <span class="progress" aria-hidden="true">{step + 1}/{steps.length}</span>
  <!-- Announced when the step changes, so VoiceOver users hear the next thing to try. -->
  <p role="status" aria-live="polite">
    <span class="count">Step {step + 1} of {steps.length}.</span>
    <strong>{current.title}</strong>
    <span class="hint">{current.hint}</span>
  </p>
  <button class="close" data-coach-close aria-label="Close getting started tips" onclick={onclose}><Icon name="close" size={18} /></button>
  {#if actionLabel || onskip}<div class="actions">
    {#if actionLabel}<button class="action" data-coach-action onclick={onaction}>{actionLabel}</button>{/if}
    {#if onskip}<button class="later" data-coach-later onclick={onskip}>Later</button>{/if}
  </div>{/if}
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
  .coach.inline { position: relative; left: auto; right: auto; bottom: auto; z-index: auto; margin: 0 0 12px; max-width: none; box-shadow: none; }
  .actions { grid-column: 2 / -1; display: flex; gap: 8px; padding: 0 8px 8px 0; }
  .actions button {
    min-height: 44px; padding: 0 16px; border-radius: var(--ga-r-soft); font-size: 14px; font-weight: 650;
    touch-action: manipulation;
  }
  .action { background: var(--ga-blue-400); border: 0; color: #fff; }
  .later { background: none; border: 1px solid var(--ga-blue-500); color: var(--ga-ink-0); }
  .actions button:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
</style>
