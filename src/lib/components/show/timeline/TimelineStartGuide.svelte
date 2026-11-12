<script lang="ts">
  /**
   * The first thing an empty Timeline says: three steps to a show (a song,
   * Auto show or your own content on the pieces, play). Each step shows
   * whether it is done; the next one is the one in colour. It goes once
   * there is something on the Timeline, or for good with "Got it".
   */
  import TimelineIcon from './TimelineIcon.svelte';

  interface Props {
    hasSong: boolean;
    hasContent: boolean;
    pieces: number;
    onpicksong: () => void;
    onautoshow: () => void;
    onplay: () => void;
    ondismiss: () => void;
  }
  let { hasSong, hasContent, pieces, onpicksong, onautoshow, onplay, ondismiss }: Props = $props();

  let step = $derived(!hasSong ? 1 : !hasContent ? 2 : 3);
</script>

<div class="guide" role="region" aria-label="Start your show" data-timeline-start>
  <div class="guide-head">
    <span class="guide-title">Start your show</span>
    <button type="button" class="guide-x" onclick={ondismiss} title="Hide this guide" aria-label="Hide this guide">×</button>
  </div>

  <div class="guide-step" class:now={step === 1} class:done={hasSong}>
    <span class="guide-n">{#if hasSong}✓{:else}1{/if}</span>
    <span class="guide-icon"><TimelineIcon name="song" size={18} /></span>
    <span class="guide-text">
      <span class="guide-what">Add a song</span>
      <span class="guide-how">Or drop an audio file on the Song row. The Timeline follows its beat.</span>
    </span>
    <button type="button" class="guide-btn" class:primary={step === 1} onclick={onpicksong} data-start-song>
      {hasSong ? 'Add another' : 'Choose a song'}
    </button>
  </div>

  <div class="guide-step" class:now={step === 2} class:done={hasContent}>
    <span class="guide-n">{#if hasContent}✓{:else}2{/if}</span>
    <span class="guide-icon"><TimelineIcon name="sparkle" size={18} /></span>
    <span class="guide-text">
      <span class="guide-what">Let Auto show build it, or place your own</span>
      <span class="guide-how">
        {pieces > 0
          ? `Auto show lays sections, content and looks over your ${pieces} ${pieces === 1 ? 'piece' : 'pieces'}. Or drag a shader or video from the Media Library onto a piece's row.`
          : 'Map some pieces first (Layers), then Auto show can light them.'}
      </span>
    </span>
    <button type="button" class="guide-btn" class:primary={step === 2} disabled={!hasSong || pieces === 0} onclick={onautoshow}
      title={hasSong ? 'Build a show from the song' : 'Add a song first'} data-start-autoshow>✦ Auto show</button>
  </div>

  <div class="guide-step" class:now={step === 3}>
    <span class="guide-n">3</span>
    <span class="guide-icon"><TimelineIcon name="play" size={16} /></span>
    <span class="guide-text">
      <span class="guide-what">Play it</span>
      <span class="guide-how">Space plays and pauses. Click a block to change it; turn on Live edit to record what you change.</span>
    </span>
    <button type="button" class="guide-btn" class:primary={step === 3} disabled={!hasSong && !hasContent} onclick={onplay} data-start-play>Play</button>
  </div>
</div>

<style>
  .guide {
    width: min(560px, calc(100% - 32px));
    background: color-mix(in srgb, var(--ga-panel, #15151a) 96%, transparent);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 8px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.45);
    pointer-events: auto;
  }
  .guide-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px 6px 16px;
  }
  .guide-title {
    color: var(--ga-ink-0, #f2ede4);
    font-size: 14px;
    font-weight: 700;
  }
  .guide-x {
    width: 24px;
    height: 24px;
    background: transparent;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .guide-x:hover { color: var(--ga-ink-0, #fff); }
  .guide-step {
    display: grid;
    grid-template-columns: 22px 22px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.06));
    color: var(--ga-ink-2, #8a8a96);
  }
  .guide-n {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.16));
    font-size: 11px;
    font-weight: 700;
  }
  .guide-step.now .guide-n { border-color: var(--ga-icon, #5278ff); color: var(--ga-icon, #5278ff); }
  .guide-step.done .guide-n { border-color: transparent; color: var(--ga-ink-1, #b8b2c2); }
  .guide-icon { display: inline-flex; color: var(--ga-ink-2, #8a8a96); }
  .guide-step.now .guide-icon { color: var(--ga-icon, #5278ff); }
  .guide-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .guide-what { color: var(--ga-ink-1, #c8c2d0); font-size: 13px; font-weight: 600; }
  .guide-step.now .guide-what { color: var(--ga-ink-0, #f2ede4); }
  .guide-step.done .guide-what { text-decoration: line-through; text-decoration-color: var(--ga-ink-2, #666); }
  .guide-how { font-size: 11.5px; line-height: 1.4; }
  .guide-btn {
    height: 28px;
    padding: 0 12px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.16));
    border-radius: 5px;
    color: var(--ga-ink-1, #c8c2d0);
    font-family: inherit;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .guide-btn:hover:not(:disabled) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.3)); }
  .guide-btn:disabled { opacity: 0.4; cursor: default; }
  .guide-btn.primary {
    background: var(--ga-icon, #5278ff);
    border-color: var(--ga-icon, #5278ff);
    color: #fff;
  }
</style>
