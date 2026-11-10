<script lang="ts">
  /**
   * The takeover's place in the show transport: a pulsing "LIVE n" pill while
   * anything is taken over, the countdown of a release waiting for its beat,
   * bar or marker, "Return to timeline" (Shift: instantly), how a return
   * happens, and the Live pads toggle.
   *
   * `fit` (0–4) is how tight the transport is (ShowTimeline steps it up until
   * the transport fits on one line): 1 moves the return mode into a popover
   * and shortens the labels, 3 packs it closer, 4 leaves the Return button its
   * arrow only. The LIVE pill and Return are always there.
   */
  import { onDestroy } from 'svelte';
  import { showSlice } from './timelineSlices';
  import { liveTakeover, takeoverSummary, TAKEOVER_RELEASE_MODES, type TakeoverReleaseMode } from '../../../show/takeover/liveTakeover';
  import { RELEASE_MODE_LABELS, pendingReleaseSeconds, takeoverPadsOpen } from './takeoverUi';

  let { fit = 0 }: { fit?: number } = $props();

  const summary = $derived(takeoverSummary($liveTakeover));
  const release = $derived($liveTakeover.defaultRelease);

  // Wall-clock countdowns tick on their own; show-time ones ride the playhead.
  let nowMs = $state(typeof performance !== 'undefined' ? performance.now() : 0);
  let timer: ReturnType<typeof setInterval> | null = null;
  $effect(() => {
    const ticking = summary.pending > 0;
    if (ticking && !timer) timer = setInterval(() => { nowMs = performance.now(); }, 100);
    if (!ticking && timer) { clearInterval(timer); timer = null; }
  });
  onDestroy(() => { if (timer) clearInterval(timer); });
  const currentTimeStore = showSlice('currentTime');
  const countdown = $derived(pendingReleaseSeconds(summary.surfaces, $currentTimeStore, nowMs));

  function returnAll(e: MouseEvent) {
    liveTakeover.release('all', e.shiftKey ? { mode: 'instant' } : undefined);
  }

  // The return mode's popover (when the transport is tight).
  let modeOpen = $state(false);
  let modeWrap: HTMLElement | null = $state(null);
  $effect(() => {
    if (!modeOpen) return;
    const away = (e: PointerEvent) => { if (modeWrap && !modeWrap.contains(e.target as Node)) modeOpen = false; };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); modeOpen = false; } };
    const close = () => { modeOpen = false; };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', close);
    };
  });
</script>

{#snippet modeControls()}
  <select
    class="tk-select tk-mode"
    value={release.mode}
    onchange={(e) => liveTakeover.setDefaultRelease({ mode: (e.currentTarget as HTMLSelectElement).value as TakeoverReleaseMode })}
    title="How a track goes back to the timeline: a cut, a fade, or on the next beat, bar, phrase (four bars) or marker"
    aria-label="Return"
    data-takeover-release-mode
  >
    {#each TAKEOVER_RELEASE_MODES as mode (mode)}
      <option value={mode}>{RELEASE_MODE_LABELS[mode]}</option>
    {/each}
  </select>
  {#if release.mode !== 'instant'}
    <input
      class="tk-fade"
      type="number"
      min="0"
      max="60"
      step="0.1"
      value={release.fadeSeconds}
      onchange={(e) => liveTakeover.setDefaultRelease({ fadeSeconds: parseFloat((e.currentTarget as HTMLInputElement).value) })}
      title="Fade length when a track goes back, seconds (0: a cut)"
      aria-label="Return fade, seconds"
      data-takeover-release-fade
    />
  {/if}
{/snippet}

<span class="tk-controls" class:fit1={fit >= 1} class:fit3={fit >= 3} class:fit4={fit >= 4} data-takeover-controls>
  {#if summary.active}
    <span class="tk-pill" title="Surfaces taken over live; the show runs on underneath" data-takeover-pill>LIVE {summary.count}</span>
    {#if countdown !== null}
      <span class="tk-count" title="Seconds until the hand-back" data-takeover-countdown>↩ {countdown.toFixed(1)}</span>
    {/if}
    <button
      class="tk-chip tk-return"
      onclick={returnAll}
      title="Hand every taken-over track back to the timeline (Shift: instantly)"
      aria-label="Return to timeline"
      data-takeover-return-all
    ><span class="tk-arrow" aria-hidden="true">↩</span><span class="tk-long">Return to timeline</span><span class="tk-short">Return</span></button>
  {/if}
  {#if fit < 1}
    {@render modeControls()}
  {:else}
    <span class="tk-mode-wrap" bind:this={modeWrap}>
      <button
        class="tk-chip tk-mode-chip"
        class:active={modeOpen}
        onclick={() => (modeOpen = !modeOpen)}
        title="How a track goes back to the timeline: a cut, a fade, or on the next beat, bar, phrase (four bars) or marker"
        aria-haspopup="true"
        aria-expanded={modeOpen}
        data-takeover-release-chip
      ><span>{RELEASE_MODE_LABELS[release.mode]}</span>{#if release.mode !== 'instant'}<span class="tk-num">{release.fadeSeconds}s</span>{/if}<span class="tk-caret" aria-hidden="true">▾</span></button>
      {#if modeOpen}
        <span class="tk-pop" role="group" aria-label="Return" data-fit-ignore data-takeover-release-popover>
          {@render modeControls()}
        </span>
      {/if}
    </span>
  {/if}
  <button
    class="tk-chip tk-pads"
    class:active={$takeoverPadsOpen}
    onclick={() => takeoverPadsOpen.update((v) => !v)}
    title="Live pads: the VJ deck, the overlay and the takeover settings"
    data-takeover-pads-toggle
  ><span class="tk-long">Live pads</span><span class="tk-short">Pads</span></button>
</span>

<style>
  .tk-controls { display: inline-flex; align-items: center; gap: 6px; }
  .tk-chip {
    display: inline-flex;
    align-items: center;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    border-radius: var(--ga-r-hard, 4px);
    padding: 0 10px;
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }
  .tk-chip:hover { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .tk-select {
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, rgba(0, 0, 0, 0.4));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #aaa);
    font-size: var(--ga-text-control, 12px);
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 6px;
    outline: none;
    font-family: inherit;
  }
  .tk-pill {
    font-size: var(--ga-text-meta, 11px);
    font-weight: 800;
    letter-spacing: 0.06em;
    color: #1a0d02;
    background: #ff8c28;
    border-radius: 10px;
    padding: 1px 8px;
    animation: tk-pulse 1.1s ease-in-out infinite;
    white-space: nowrap;
  }
  @keyframes tk-pulse {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255, 140, 40, 0.65); }
    50% { box-shadow: 0 0 0 5px rgba(255, 140, 40, 0); }
  }
  .tk-count {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    color: #ff8c28;
    white-space: nowrap;
  }
  .tk-return { border-color: rgba(255, 140, 40, 0.6); color: #ffb070; }
  .tk-mode { max-width: 110px; }
  .tk-fade {
    width: 44px;
    height: var(--ga-control-h-sm, 22px);
    box-sizing: border-box;
    background: var(--ga-slot, rgba(0, 0, 0, 0.4));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #ddd);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 4px;
  }
  .tk-short, .tk-arrow { display: none; }
  .fit1 .tk-long { display: none; }
  .fit1 .tk-short { display: inline; }
  .fit4 .tk-return .tk-short { display: none; }
  .fit4 .tk-return .tk-arrow { display: inline; }
  .fit4 .tk-return { padding: 0 8px; font-size: 14px; }
  .fit3.tk-controls { gap: 4px; }
  .tk-mode-wrap { position: relative; display: inline-flex; }
  .tk-mode-chip { gap: 5px; padding: 0 8px; }
  .tk-mode-chip.active { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .tk-num { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-meta, 11px); opacity: 0.8; }
  .tk-caret { font-size: 9px; opacity: 0.7; }
  .tk-pop {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 40;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    background: var(--ga-panel, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
  }
  .tk-pads.active { border-color: rgba(255, 140, 40, 0.7); color: #ffb070; background: rgba(255, 140, 40, 0.12); }
</style>
