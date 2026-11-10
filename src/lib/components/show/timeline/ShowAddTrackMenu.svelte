<script lang="ts">
  /**
   * "+ Track": a track for a layer already on stage, or a new layer made for
   * the show. A new layer also goes into every preset the show uses (on by
   * default), so it stays on stage through the whole show; that is one
   * undo step with the track.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import { addTrackForLayer, addTrackForNewLayer } from '../../../show/tracks/showTrackActions';
  import { focusedTrackId, portal } from './trackLayout';

  interface Props {
    x: number;
    y: number;
    onclose: () => void;
  }

  let { x, y, onclose }: Props = $props();

  const tracked = $derived(new Set($showTimeline.layerTracks.map((t) => t.layerId)));
  const untracked = $derived($liveLayersStore.filter((l) => !tracked.has(l.id)));
  const presetCount = $derived(new Set($showTimeline.presetClips.map((c) => c.compositionId)).size);

  let name = $state(`Track ${$showTimeline.layerTracks.length + 1}`);
  let addToPresets = $state(true);

  function pickLayer(id: string) {
    const trackId = addTrackForLayer(id);
    if (trackId) focusedTrackId.set(trackId);
    onclose();
  }

  function createLayer() {
    const trackId = addTrackForNewLayer(name.trim() || 'Track', { addToPresets: presetCount > 0 && addToPresets });
    if (trackId) focusedTrackId.set(trackId);
    onclose();
  }

  $effect(() => {
    const close = () => onclose();
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onclose(); };
    window.addEventListener('keydown', key);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="atm" use:portal style:left="{x}px" style:top="{y}px" onmousedown={(e) => e.stopPropagation()} data-add-track-menu>
  <div class="atm-head">Track for a layer on stage</div>
  {#if untracked.length === 0}
    <div class="atm-empty">Every layer already has a track.</div>
  {:else}
    <div class="atm-list">
      {#each untracked as layer (layer.id)}
        <button class="atm-item" onclick={() => pickLayer(layer.id)} data-layer-id={layer.id}>
          <span class="layer-name">{layer.name}</span>
        </button>
      {/each}
    </div>
  {/if}
  <div class="atm-sep"></div>
  <div class="atm-head">New layer</div>
  <form class="atm-new" onsubmit={(e) => { e.preventDefault(); createLayer(); }}>
    <input class="atm-input" type="text" bind:value={name} aria-label="New layer name" data-new-layer-name />
    <button class="atm-add" type="submit" data-new-layer-add>Add</button>
  </form>
  {#if presetCount > 0}
    <label class="atm-check">
      <input type="checkbox" bind:checked={addToPresets} data-new-layer-presets />
      <span>Add to the presets this show uses</span>
    </label>
  {/if}
</div>

<style>
  .atm {
    position: fixed;
    z-index: 10000;
    width: 240px;
    padding: 6px;
    transform: translateY(-100%);
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  }
  .atm-head {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 4px 6px;
  }
  .atm-empty { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); padding: 2px 6px 4px; }
  .atm-list { max-height: 180px; overflow-y: auto; }
  .atm-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 4px 6px;
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .atm-item:hover { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .atm-sep { height: 1px; margin: 6px 0; background: var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
  .atm-new { display: flex; gap: 6px; padding: 0 6px; }
  .atm-input {
    flex: 1 1 auto;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    outline: none;
  }
  .atm-add {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 10px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-selection-ink, #e0e8ff);
    background: var(--ga-selection-bg, #1f3170);
    border: 1px solid var(--ga-selection-line, #5278ff);
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .atm-check {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 6px 2px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #aaa);
    cursor: pointer;
  }
</style>
