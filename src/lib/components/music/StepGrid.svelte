<script lang="ts">
  /** The drum pattern: a row per kit voice, a cell per step, the playhead on the VJ clock. */
  import { DRUM_LABELS, DRUM_NOTES, DRUM_VOICES, type DrumVoice } from '../../music/noteEvents';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { hitDrum } from '../../music/musicRuntime';

  /** rowHeight 0 stretches the rows to fill the grid's height. */
  let { cell = 0, rowHeight = 18 }: { cell?: number; rowHeight?: number } = $props();

  const pattern = $derived($musicStudio.pattern);
  const steps = $derived(Array.from({ length: pattern.steps }, (_, i) => i));
  // Zero means "fill the width"; otherwise a fixed cell size.
  const columns = $derived(cell > 0 ? `repeat(${pattern.steps}, ${cell}px)` : `repeat(${pattern.steps}, minmax(0, 1fr))`);

  function audition(e: PointerEvent, voice: DrumVoice) {
    e.preventDefault();
    hitDrum(voice, $musicStudio.velocity);
  }
</script>

<div class="steps" class:fill={cell === 0} class:stretch={rowHeight === 0} style="grid-template-columns: 64px {columns}; --row: {rowHeight ? `${rowHeight}px` : 'auto'}">
  {#each DRUM_VOICES as voice}
    <button class="voice" class:lit={$musicTransport.held.has(`drums:${DRUM_NOTES[voice]}`)} onpointerdown={(e) => audition(e, voice)} title="Play {DRUM_LABELS[voice]}">{DRUM_LABELS[voice]}</button>
    {#each steps as step}
      <button
        class="step"
        class:on={pattern.tracks[voice][step] > 0}
        class:bar={step % 4 === 0}
        class:playhead={step === $musicTransport.step}
        onclick={() => musicStudio.toggleStep(voice, step)}
        aria-label="{DRUM_LABELS[voice]} step {step + 1}"
      ></button>
    {/each}
  {/each}
</div>

<style>
  .steps { display: grid; gap: 2px; width: max-content; }
  .steps.fill { width: 100%; }
  .steps.stretch { height: 100%; grid-template-rows: repeat(8, minmax(10px, 1fr)); }
  .steps.stretch .voice, .steps.stretch .step { height: auto; }
  .voice {
    height: var(--row);
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--mk-muted, var(--ga-ink-1, #9aa0ac));
    text-align: left;
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    font-size: var(--ga-text-meta, 11px);
    cursor: pointer;
    white-space: nowrap;
  }
  .voice.lit { color: var(--mk-accent, var(--ga-coral, #ff6f5e)); }
  .step {
    height: var(--row);
    min-width: 0;
    padding: 0;
    border: 1px solid var(--mk-cell-edge, var(--ga-line, rgba(255,255,255,.07)));
    background: var(--mk-cell, var(--ga-card, #13161c));
    border-radius: var(--mk-radius, var(--ga-r-hard, 2px));
    cursor: pointer;
  }
  .step.bar { border-color: var(--mk-line, var(--ga-line-2, rgba(255,255,255,.12))); }
  .step:hover { border-color: var(--mk-accent, var(--ga-coral-line, rgba(255,111,94,.4))); }
  .step.on { background: var(--mk-accent, var(--ga-coral, #ff6f5e)); border-color: var(--mk-accent, var(--ga-coral, #ff6f5e)); }
  .step.playhead { box-shadow: inset 0 0 0 1px var(--mk-ink, var(--ga-ink-0, #eef0f4)); }
</style>
