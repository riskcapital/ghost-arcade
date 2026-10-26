<script lang="ts">
  /**
   * The show's soundtrack in VJ mode: play/pause, where it is, and a strip
   * of the song to click or drag along. The Show timeline itself is a
   * mapping-mode panel and stays closed here, but its transport keeps
   * running, so this is how a VJ sees and steers it. Hidden when the show
   * has no audio.
   */
  import { showTimeline } from '../stores/showTimeline';
  import { showEnvelope } from '../show/showEnvelope';

  const BUCKETS = 64;

  $: show = $showTimeline;
  $: hasAudio = show.audioTracks.length > 0 && show.duration > 0;
  // Recomputed when the tracks change, not on every frame of playback.
  $: envelope = hasAudio ? showEnvelope(show.audioTracks, show.duration, BUCKETS) : [];
  $: progress = show.duration > 0 ? Math.min(1, Math.max(0, show.currentTime / show.duration)) : 0;

  let strip: HTMLDivElement | undefined;

  function timeAt(clientX: number): number {
    if (!strip) return 0;
    const rect = strip.getBoundingClientRect();
    const f = rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
    return Math.max(0, Math.min(1, f)) * show.duration;
  }

  function startScrub(e: PointerEvent) {
    if (e.button !== 0 || !strip) return;
    e.preventDefault();
    strip.setPointerCapture?.(e.pointerId);
    showTimeline.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => showTimeline.seek(timeAt(ev.clientX));
    const up = () => {
      strip?.removeEventListener('pointermove', move);
      strip?.removeEventListener('pointerup', up);
      strip?.removeEventListener('pointercancel', up);
    };
    strip.addEventListener('pointermove', move);
    strip.addEventListener('pointerup', up);
    strip.addEventListener('pointercancel', up);
  }

  function onStripKey(e: KeyboardEvent) {
    const step = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowLeft') { e.preventDefault(); showTimeline.seek(show.currentTime - step); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); showTimeline.seek(show.currentTime + step); }
    else if (e.key === 'Home') { e.preventDefault(); showTimeline.seek(0); }
  }

  function formatTime(t: number): string {
    const safe = Math.max(0, t);
    return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
  }
</script>

{#if hasAudio}
  <div class="show-sound" role="group" aria-label="Show soundtrack" data-help-page="show-timeline">
    <button
      class="ss-play"
      class:on={show.isPlaying}
      onclick={() => showTimeline.togglePlay()}
      title={show.isPlaying ? 'Pause the show' : 'Play the show'}
      aria-label={show.isPlaying ? 'Pause the show' : 'Play the show'}
    >
      {#if show.isPlaying}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><rect x="1" y="1" width="3.5" height="10" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" fill="currentColor"/></svg>
      {:else}
        <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>
      {/if}
    </button>
    <div
      class="ss-strip"
      bind:this={strip}
      role="slider"
      tabindex="0"
      aria-label="Show position"
      aria-valuemin="0"
      aria-valuemax={Math.round(show.duration)}
      aria-valuenow={Math.round(show.currentTime)}
      aria-valuetext={`${formatTime(show.currentTime)} of ${formatTime(show.duration)}`}
      title="Show soundtrack: click or drag to move through the show"
      onpointerdown={startScrub}
      onkeydown={onStripKey}
    >
      <div class="ss-bars" aria-hidden="true">
        {#each envelope as level, i}
          <i class:played={(i + 0.5) / BUCKETS <= progress} style="height: {Math.max(8, level * 100)}%"></i>
        {/each}
      </div>
      <div class="ss-head" style="left: {progress * 100}%" aria-hidden="true"></div>
    </div>
    <span class="ss-time">{formatTime(show.currentTime)}<span class="ss-total"> / {formatTime(show.duration)}</span></span>
  </div>
{/if}

<style>
  .show-sound {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--vj-control-h, 28px);
    padding: 0 6px 0 3px;
    border: 1px solid #34383f;
    border-radius: 5px;
    background: #121419;
    color: #dce0e7;
    font-size: 11px;
  }
  .ss-play {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid #34383f;
    border-radius: 4px;
    background: #181b21;
    color: inherit;
    cursor: pointer;
    padding: 0;
  }
  .ss-play.on { background: var(--ga-coral, #ff6f5e); border-color: var(--ga-coral, #ff6f5e); color: #14090a; }
  .ss-strip {
    position: relative;
    width: 132px;
    height: 20px;
    cursor: pointer;
    touch-action: none;
    border-radius: 3px;
    outline: none;
  }
  .ss-strip:focus-visible { box-shadow: 0 0 0 1px var(--ga-blue-500, #6ea8fe); }
  .ss-bars {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .ss-bars i {
    flex: 1 1 0;
    min-width: 1px;
    border-radius: 1px;
    background: #4a5260;
  }
  .ss-bars i.played { background: #8fb4ff; }
  .ss-head {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 2px;
    margin-left: -1px;
    background: #fff;
    border-radius: 1px;
    pointer-events: none;
  }
  .ss-time { font-variant-numeric: tabular-nums; white-space: nowrap; min-width: 8.5ch; }
  .ss-total { color: #969eab; }
</style>
