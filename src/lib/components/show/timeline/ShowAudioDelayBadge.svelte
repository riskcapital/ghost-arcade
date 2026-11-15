<script lang="ts">
  /**
   * The Stage Sim's audio-sync delay is holding the speakers back. Shown in
   * the editor whenever it is on (it lasts only while the Stage Sim window is
   * open), so a real show never runs the house sound late unnoticed.
   */
  import { rehearsalAudioDelayActive } from '../../../show/rehearsal/editorRehearsal';

  const ms = $derived(Math.round($rehearsalAudioDelayActive * 1000));
</script>

{#if ms > 0}
  <span
    class="delay-badge"
    title="The Stage Sim's audio sync is delaying the speakers by {ms} ms. It ends when the Stage Sim window closes; turn it off there."
    data-show-audio-delay
  >Audio +{ms} ms</span>
{/if}

<style>
  .delay-badge {
    flex: 0 0 auto;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
    color: var(--tl-on-ink, #ffd9d2);
    background: var(--tl-on-soft, rgba(255, 114, 95, 0.13));
    border: 1px solid var(--tl-on-line, rgba(255, 114, 95, 0.46));
  }
</style>
