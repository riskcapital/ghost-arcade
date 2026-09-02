<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { abletonLink } from '../sync/abletonLink';

  /**
   * Ableton Link session readout: peers, tempo, quantum, and a running
   * 1-2-3-4 beat indicator.
   *
   * The point of this is diagnosis. Link carries a phase as well as a tempo,
   * and when the two disagree the symptom — "BPM matches but my clips are off
   * the beat" — is impossible to tell apart from a wrong quantum, an offset
   * downbeat, or the app simply not following the session, because none of
   * those states were visible anywhere. Showing the phase makes the
   * difference obvious at a glance: if the highlighted beat marches in time
   * with the music coming out of the other machine, the phase is good.
   *
   * Driven off requestAnimationFrame rather than the store's own 4 Hz poll:
   * phaseNow() extrapolates from the last poll using the session tempo, so it
   * is smooth between polls. A beat at 128 BPM is ~470ms, so a 4 Hz readout
   * would visibly stutter.
   */

  /** Compact hides the labels, for placing in a toolbar. */
  export let compact = false;

  let phase = 0;
  let raf: number | null = null;

  onMount(() => {
    const tick = () => {
      // Only the extrapolated phase is read per frame; everything else comes
      // off the store, so this stays cheap enough to run continuously.
      phase = abletonLink.phaseNow();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  });

  onDestroy(() => {
    if (raf !== null) cancelAnimationFrame(raf);
  });

  $: quantum = Math.max(1, Math.round($abletonLink.quantum || 4));
  $: inSession = $abletonLink.enabled && $abletonLink.peers > 0;
  // Link phase is 0..quantum, so the integer part is the current beat.
  $: currentBeat = ((Math.floor(phase) % quantum) + quantum) % quantum;
  $: beats = Array.from({ length: quantum }, (_, i) => i);
</script>

<div class="link-monitor" class:compact class:live={inSession}>
  <div class="beats" role="img" aria-label={`Link beat ${currentBeat + 1} of ${quantum}`}>
    {#each beats as beat (beat)}
      <span
        class="beat"
        class:active={inSession && beat === currentBeat}
        class:downbeat={beat === 0}
      >{beat + 1}</span>
    {/each}
  </div>

  {#if !compact}
    <div class="readout">
      <span class="stat"><b>{$abletonLink.tempo.toFixed(2)}</b> BPM</span>
      <span class="sep">/</span>
      <span class="stat">beat <b>{(phase + 1).toFixed(2)}</b></span>
      <span class="sep">/</span>
      <span class="stat">quantum <b>{quantum}</b></span>
      <span class="sep">/</span>
      <span class="stat" class:warn={!inSession}>
        {#if !$abletonLink.enabled}
          off
        {:else if $abletonLink.peers === 0}
          no peers
        {:else}
          {$abletonLink.peers} peer{$abletonLink.peers === 1 ? '' : 's'}
        {/if}
      </span>
    </div>
  {/if}
</div>

<style>
  .link-monitor {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }

  .beats {
    display: flex;
    gap: 4px;
  }

  .beat {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #374151;
    border-radius: 2px;
    background: #111827;
    color: #6b7280;
    font-size: 10px;
    /* No transition on the active state: a fade would smear the very thing
       the indicator exists to show. */
    transition: border-color 120ms ease;
  }

  /* The downbeat is outlined even when idle, so an offset bar is visible
     without having to watch which cell lights first. */
  .beat.downbeat {
    border-color: #4b5563;
    color: #9ca3af;
  }

  .beat.active {
    background: #22d3ee;
    border-color: #67e8f9;
    color: #04140a;
    font-weight: 700;
  }

  .beat.active.downbeat {
    background: #a3e635;
    border-color: #bef264;
  }

  .readout {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 10px;
    color: #6b7280;
    letter-spacing: 0.04em;
  }

  .readout b {
    color: #d1d5db;
    font-weight: 600;
  }

  .sep {
    color: #374151;
  }

  .warn b,
  .warn {
    color: #ffb000;
  }

  .compact .beat {
    width: 14px;
    height: 14px;
    font-size: 8px;
  }
</style>
