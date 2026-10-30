<script lang="ts">
  /** The step sequencer, with its own play button so the beat can start and stop right here. */
  import { PATTERN_LENGTHS, type PatternLength } from '../../music/drumPattern';
  import { musicStudio } from '../../music/musicStudioStore';
  import { startSequencer, stopSequencer } from '../../music/musicRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StepGrid from './StepGrid.svelte';

  const s = $derived($musicStudio);
</script>

<StudioModule title="BEAT" led={s.sequencerPlaying} class="beat">
  {#snippet head()}
    <button
      class="transport mini"
      class:on={s.sequencerPlaying}
      onclick={() => (s.sequencerPlaying ? stopSequencer() : startSequencer())}
      aria-label={s.sequencerPlaying ? 'Stop the beat' : 'Play the beat'}
      title={s.sequencerPlaying ? 'Stop the beat' : 'Play the beat on the VJ clock'}
    >
      {#if s.sequencerPlaying}
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
      {/if}
    </button>
    <select value={s.pattern.steps} onchange={(e) => musicStudio.setPatternLength(+(e.target as HTMLSelectElement).value as PatternLength)} aria-label="Steps">
      {#each PATTERN_LENGTHS as n}<option value={n}>{n} steps</option>{/each}
    </select>
    <StudioKnob label="Swing" hideLabel value={s.pattern.swing} max={0.5} size={16} format={(v) => `${Math.round(v * 200)}%`} onchange={(v) => musicStudio.setSwing(v)} />
    <button class="text-btn small" onclick={() => musicStudio.clearPattern()}>CLEAR</button>
  {/snippet}
  <div class="grid"><StepGrid rowHeight={0} /></div>
</StudioModule>

<style>
  .grid { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
</style>
