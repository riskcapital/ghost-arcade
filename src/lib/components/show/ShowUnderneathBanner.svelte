<script lang="ts">
  /**
   * In VJ mode (and Audio Lab over it): the Show or the Timeline is still
   * running underneath (its tray is hidden there), with its sound, LEDs,
   * lines and cues, and how many of its tracks are taken over live. It keeps
   * running on purpose (a takeover plays over it and hands back to it); the
   * pill names which document it is and can pause it. The LIVE count is the
   * Return: it hands them all back (Shift: instantly).
   */
  import { showTimeline } from '../../stores/showTimeline';
  import { liveTakeover } from '../../show/takeover/liveTakeover';

  function returnAll(e: MouseEvent) {
    liveTakeover.release('all', e.shiftKey ? { mode: 'instant' } : undefined);
  }

  const playing = $derived($showTimeline.isPlaying);
  const isTimeline = $derived($showTimeline.doc === 'timeline');
  const count = $derived(Object.values($liveTakeover.surfaces).filter((o) => o.phase !== 'releasing').length);
</script>

{#if playing || count > 0}
  <div class="su" title={isTimeline ? 'The Timeline carries on while you play, with its sound, LEDs and cues; tracks taken over live go back to it with Return' : 'The show timeline carries on while you play; tracks taken over live go back to it with Return'} data-show-underneath>
    <!-- The Return first: a crowded header clips the banner's end. -->
    {#if count > 0}<button
      class="su-live"
      onclick={returnAll}
      title="Return to the timeline (Shift: instantly)"
      aria-label="Return to the timeline (Shift: instantly)"
      data-vj-takeover-return
    >LIVE {count} <span aria-hidden="true">↩</span></button>{/if}
    <span class="su-dot" class:paused={!playing}></span>
    <span class="su-text">{#if isTimeline}{#if playing}Timeline playing underneath{:else}Timeline paused underneath{/if}{:else if playing}Show playing underneath{:else}Show paused underneath{/if}</span>
    {#if playing}<button
      class="su-pause"
      onclick={() => showTimeline.pause()}
      title={isTimeline ? 'Pause the Timeline' : 'Pause the show'}
      aria-label={isTimeline ? 'Pause the Timeline' : 'Pause the show'}
      data-show-underneath-pause
    ><svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><rect x="1.5" y="1" width="2.4" height="8" rx="0.6" fill="currentColor" /><rect x="6.1" y="1" width="2.4" height="8" rx="0.6" fill="currentColor" /></svg></button>{/if}
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
  .su-pause {
    display: inline-grid; place-items: center; width: 16px; height: 16px; padding: 0;
    color: #ffb070; background: transparent; border: 1px solid rgba(255, 140, 40, 0.5); border-radius: 50%; cursor: pointer;
  }
  .su-pause:hover { background: rgba(255, 140, 40, 0.18); }
  .su-pause:focus-visible { outline: 2px solid #ffb070; outline-offset: 1px; }
</style>
