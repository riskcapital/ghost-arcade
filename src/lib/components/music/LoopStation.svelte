<script lang="ts">
  /**
   * The live looper: six loop tracks. Tracks shows them as rows across the
   * bars with the record bar above and the quick editor below.
   */
  import { onDestroy, onMount } from 'svelte';
  import { ensureMusicRuntime } from '../../music/musicRuntime';
  import { loopLatencyMs, loopStationView, measureLoopLatency, onLoopNotice, publish } from '../../music/loopStation';
  import { musicStudio } from '../../music/musicStudioStore';
  import { showToast } from '../../stores/errorToast';
  import LoopRecordBar from './LoopRecordBar.svelte';
  import LoopTrackRows from './LoopTrackRows.svelte';

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

<div class="station">
  <div class="top"><LoopRecordBar /></div>
  <div class="lat">
    <span class="ga-eyebrow">Audio latency</span>
    <span>{latency === null ? '—' : `${Math.round(latency)} ms`}</span>
    <label title="Added to what the system reports; Measure sets it">Offset <input type="number" min="-200" max="500" step="1" value={station.latencyMs} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, latencyMs: Math.max(-200, Math.min(500, Number((e.target as HTMLInputElement).value) || 0)) }))} /> ms</label>
    <button class="text-btn small" onclick={measure} disabled={measuring} title="Play a click and listen for it on the input: loop an output into it first">{measuring ? 'Measuring…' : 'Measure'}</button>
  </div>
  <LoopTrackRows />
</div>

<style>
  .station { display: flex; flex-direction: column; min-height: 0; height: 100%; }
  .lat { display: flex; align-items: center; gap: 8px; padding: 4px 10px; border-bottom: 1px solid var(--studio-edge-soft); font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .lat input { width: 56px; height: 22px; }
  .top { padding: 6px 10px; border-bottom: 1px solid var(--studio-edge); background: var(--studio-panel); overflow-x: auto; }
</style>
