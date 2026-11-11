<script lang="ts">
  /**
   * In VJ mode: the show is still running underneath (its tray is hidden
   * there), and how many of its tracks are taken over live. The LIVE count
   * is the Return: it hands them all back (Shift: instantly).
   */
  import { showTimeline } from '../../stores/showTimeline';
  import { liveTakeover } from '../../show/takeover/liveTakeover';

  function returnAll(e: MouseEvent) {
    liveTakeover.release('all', e.shiftKey ? { mode: 'instant' } : undefined);
  }

  const playing = $derived($showTimeline.isPlaying);
  const count = $derived(Object.values($liveTakeover.surfaces).filter((o) => o.phase !== 'releasing').length);
</script>

{#if playing || count > 0}
  <div class="su" title="The show timeline carries on while you play; tracks taken over live go back to it with Return" data-show-underneath>
    <!-- The Return first: a crowded header clips the banner's end. -->
    {#if count > 0}<button
      class="su-live"
      onclick={returnAll}
      title="Return to the timeline (Shift: instantly)"
      aria-label="Return to the timeline (Shift: instantly)"
      data-vj-takeover-return
    >LIVE {count} <span aria-hidden="true">↩</span></button>{/if}
    <span class="su-dot" class:paused={!playing}></span>
    <span class="su-text">{#if playing}Show playing underneath{:else}Show paused underneath{/if}</span>
  </div>
{/if}

<style>
  .su {
    /* A grid so that in a crowded header only the words give way (ellipsis,
       the tooltip has them): its narrowest is the Return and the dot, and
       the controls beside the banner keep their room. */
    display: inline-grid;
    grid-auto-flow: column;
    align-items: center;
    gap: 6px;
    height: 22px;
    padding: 0 8px;
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    color: #ffb070;
    border: 1px solid rgba(255, 140, 40, 0.5);
    border-radius: 11px;
    background: rgba(255, 140, 40, 0.08);
    white-space: nowrap;
    flex: 0 1 auto;
  }
  .su-text { overflow: hidden; text-overflow: ellipsis; }
  .su-dot { width: 7px; height: 7px; border-radius: 50%; background: #ff8c28; animation: su-pulse 1.1s ease-in-out infinite; }
  .su-dot.paused { animation: none; opacity: 0.5; }
  @keyframes su-pulse { 50% { opacity: 0.3; } }
  .su-live {
    color: #1a0d02; background: #ff8c28; border: 0; border-radius: 8px; padding: 0 6px;
    font: inherit; font-weight: 800; line-height: 16px; cursor: pointer;
  }
  .su-live:hover { background: #ffa552; }
  .su-live:active { transform: scale(0.95); }
</style>
