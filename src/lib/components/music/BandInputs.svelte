<script lang="ts">
  /**
   * The band's inputs: listening on or off, and what the studio hears.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { startLiveInput, stopLiveInput } from '../../music/musicRuntime';

  const s = $derived($musicStudio);
</script>

<section class="input">
  <span class="ga-eyebrow">Band input</span>
  <button class="power" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={() => (s.inputOn ? stopLiveInput() : void startLiveInput())} title={s.inputOn ? 'Stop listening to the band' : 'Listen to the band (choose the input in Mixer)'}>
    <span class="led" class:on={s.inputOn}></span>{s.inputOn ? 'Listening' : 'Off'}
  </button>
  {#if s.inputError}<span class="error" role="alert">{s.inputError}</span>{:else}<span class="hint">Feed it the desk's aux send. Only the effects come back here.</span>{/if}
</section>

<style>
  section { display: flex; flex-direction: column; gap: 6px; min-width: 0; max-width: 190px; }
  .power { display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border: 1px solid var(--studio-edge); background: var(--studio-cell); color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; font-size: var(--ga-text-control, 12px); cursor: pointer; align-self: flex-start; }
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.35; }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-danger, #ff6b6b); }
</style>
