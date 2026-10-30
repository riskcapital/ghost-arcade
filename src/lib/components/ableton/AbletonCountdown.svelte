<script lang="ts">
  /**
   * Countdown on the Program preview to the next queued Live launch that
   * will change the visuals — for the VJ's eyes only, never the output.
   */
  import { onDestroy } from 'svelte';
  import { abletonBridge, songBeat, upcomingLaunch } from '../../ableton/abletonBridge';

  /** Show the countdown from this many beats out. */
  const SHOW_WITHIN = 16;

  let now = performance.now();
  let frame = 0;

  $: running = $abletonBridge.connected && $abletonBridge.playing;
  $: if (running && !frame) tick();
  $: next = running ? upcomingLaunch($abletonBridge, songBeat($abletonBridge, now)) : null;
  $: visible = !!next && next.beats <= SHOW_WITHIN;

  function tick() {
    now = performance.now();
    frame = running ? requestAnimationFrame(tick) : 0;
  }

  onDestroy(() => cancelAnimationFrame(frame));
</script>

{#if visible && next}
  <div class="countdown" class:last={next.beats <= 1} aria-live="polite">
    <span class="label">{next.label}</span>
    <span class="beats">{next.beats >= 1 ? Math.ceil(next.beats) : 'NOW'}</span>
  </div>
{/if}

<style>
  .countdown {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 4px 4px 10px;
    border-radius: 14px;
    background: rgba(10, 8, 2, 0.78);
    border: 1px solid #e0a33a;
    color: #f6d9a2;
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-size: 11px;
    font-weight: 600;
    pointer-events: none;
  }
  .label { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .beats {
    min-width: 22px;
    height: 20px;
    padding: 0 6px;
    border-radius: 10px;
    background: #e0a33a;
    color: #1a1204;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
  }
  .countdown.last { animation: pulse 0.25s steps(2) infinite; }
  @keyframes pulse { 50% { border-color: #fff; } }
</style>
