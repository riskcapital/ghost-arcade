<script lang="ts">
  /**
   * The live looper: six loop tracks. Tracks shows them as rows across the
   * bars with the record bar above and the quick editor below; Live shows
   * them as columns for playing (LoopLive.svelte). With the panel focused
   * the keys drive it (loopControls.ts loopKey).
   */
  import { onDestroy, onMount } from 'svelte';
  import { ensureMusicRuntime } from '../../music/musicRuntime';
  import { loopLatencyMs, loopStationView, measureLoopLatency, onLoopNotice, publish } from '../../music/loopStation';
  import { musicStudio } from '../../music/musicStudioStore';
  import { showToast } from '../../stores/errorToast';
  import LoopRecordBar from './LoopRecordBar.svelte';
  import LoopTrackRows from './LoopTrackRows.svelte';
  import LoopLive from './LoopLive.svelte';
  import { loopKey } from '../../music/loopControls';
  import { selectLoopTrack } from '../../music/loopStation';

  let { initialMode = 'tracks' }: { initialMode?: 'tracks' | 'live' } = $props();
  // svelte-ignore state_referenced_locally
  let mode = $state<'tracks' | 'live'>(initialMode);
  let root = $state<HTMLDivElement | null>(null);

  /** A click in the panel (not in a field) gives it the keys. */
  function focusRoot(e: PointerEvent) {
    if (!(e.target as HTMLElement)?.closest?.('input, select, textarea')) root?.focus({ preventScroll: true });
  }

  function key(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, select, textarea, [contenteditable="true"]')) return;
    if (loopKey(e)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  onMount(() => {
    ensureMusicRuntime();
    publish();
    onLoopNotice((message) => showToast(message === 'Too short' ? 'Too short: a loop needs at least a beat.' : message === 'Nothing was played' ? 'Nothing was played, so no loop was made.' : 'No empty loop track for it. Clear a track first.', 'info'));
  });
  onDestroy(() => onLoopNotice(null));

  const station = $derived($musicStudio.loopStation);
  let latency = $state<number | null>(null);
  let measuring = $state(false);
  $effect(() => {
    void station.latencyMs;
    latency = loopLatencyMs();
  });

  /** Measure on the selected track's input when it is an audio track, else the first audio track's. */
  async function measure() {
    const sel = $loopStationView.selected;
    const i = station.tracks[sel]?.kind === 'audio' ? sel : station.tracks.findIndex((t) => t.kind === 'audio');
    if (i < 0) return;
    measuring = true;
    const rt = await measureLoopLatency(i).catch(() => null);
    measuring = false;
    latency = loopLatencyMs();
    showToast(rt === null ? 'Nothing came back. Loop an output into the input (a cable, or the mic near a speaker) and try again.' : `Round trip ${Math.round(rt)} ms: audio loops now line up with it.`, rt === null ? 'warning' : 'info');
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div class="station" bind:this={root} tabindex="0" role="region" aria-label="Live looper" onkeydown={key} onpointerdown={focusRoot}>
  <div class="modes">
    <div class="ga-segmented small" role="tablist" aria-label="Looper view">
      <button role="tab" aria-selected={mode === 'tracks'} class:active={mode === 'tracks'} onclick={() => (mode = 'tracks')}>Tracks</button>
      <button role="tab" aria-selected={mode === 'live'} class:active={mode === 'live'} onclick={() => (mode = 'live')}>Live</button>
    </div>
  </div>
  {#if mode === 'live'}
    <LoopLive onpicktrack={(i) => { selectLoopTrack(i); mode = 'tracks'; }} />
  {:else}
  <div class="top"><LoopRecordBar /></div>
  <div class="lat">
    <span class="ga-eyebrow">Audio latency</span>
    <span>{latency === null ? '—' : `${Math.round(latency)} ms`}</span>
    <label title="Added to what the system reports; Measure sets it">Offset <input type="number" min="-200" max="500" step="1" value={station.latencyMs} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, latencyMs: Math.max(-200, Math.min(500, Number((e.target as HTMLInputElement).value) || 0)) }))} /> ms</label>
    <button class="text-btn small" onclick={measure} disabled={measuring} title="Play a click and listen for it on the input: loop an output into it first">{measuring ? 'Measuring…' : 'Measure'}</button>
  </div>
  <LoopTrackRows />
  {/if}
</div>

<style>
  .station { display: flex; flex-direction: column; min-height: 0; height: 100%; outline: none; }
  .modes { display: flex; padding: 6px 10px 0; background: var(--studio-panel); }
  .lat { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--studio-edge-soft); font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .lat input { width: 56px; height: 22px; }
  .top { padding: 6px 10px; border-bottom: 1px solid var(--studio-edge); background: var(--studio-panel); overflow-x: auto; }
</style>
