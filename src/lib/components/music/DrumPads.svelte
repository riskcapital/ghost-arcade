<script lang="ts">
  /** The kit's eight pads, with the letter key each one plays. */
  import { DRUM_LABELS, DRUM_NOTES, DRUM_VOICES, type DrumVoice } from '../../music/noteEvents';
  import { DRUM_PAD_KEYS, PIANO_KEY_LABELS } from '../../music/keyboardLayout';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { hitDrum } from '../../music/musicRuntime';

  let { columns = 4 }: { columns?: number } = $props();

  function hit(e: PointerEvent, voice: DrumVoice) {
    e.preventDefault();
    hitDrum(voice, $musicStudio.velocity);
  }
</script>

<div class="pads" style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
  {#each DRUM_VOICES as voice, i}
    <button class="pad" class:lit={$musicTransport.held.has(`drums:${DRUM_NOTES[voice]}`)} onpointerdown={(e) => hit(e, voice)}>
      <span>{DRUM_LABELS[voice]}</span>
      <kbd>{PIANO_KEY_LABELS[DRUM_PAD_KEYS[i]]}</kbd>
    </button>
  {/each}
</div>

<style>
  .pads { display: grid; gap: 6px; flex: 1; min-height: 110px; }
  .pad {
    border: 1px solid var(--mk-line, var(--ga-line-2, rgba(255,255,255,.12)));
    background: var(--mk-slot, var(--ga-slot, #050607));
    color: var(--mk-ink, var(--ga-ink-0, #eef0f4));
    border-radius: var(--mk-radius, var(--ga-r-hard, 2px));
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    touch-action: none;
  }
  kbd { font-family: inherit; font-size: 10px; color: var(--mk-muted, var(--ga-ink-2, #5e6571)); pointer-events: none; }
  .pad.lit {
    background: var(--mk-accent, var(--ga-coral, #ff6f5e));
    border-color: var(--mk-accent, var(--ga-coral, #ff6f5e));
    color: var(--mk-on-accent, var(--ga-panel, #0b0d11));
  }
  .pad.lit kbd { color: var(--mk-on-accent, var(--ga-panel, #0b0d11)); }
</style>
