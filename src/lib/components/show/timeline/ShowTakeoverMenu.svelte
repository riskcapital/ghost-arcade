<script lang="ts">
  /**
   * A track's LIVE menu: what takes the track's surface over. The VJ deck
   * rows (with what each is playing), the deck mix, VJ groups and black.
   * Media dropped on the LIVE button plays there too.
   */
  import type { ShowLayerTrack } from '../../../types';
  import { vjClipLauncher } from '../../../stores/vjClipLauncher';
  import { liveTakeover, sameTakeoverSource, type TakeoverSource } from '../../../show/takeover/liveTakeover';
  import { takeOverTrack } from '../../../show/takeover/takeoverRuntime';
  import { portal } from './trackLayout';
  import { takeoverSourceOptions } from './takeoverUi';

  interface Props {
    x: number;
    y: number;
    track: ShowLayerTrack;
    onclose: () => void;
  }

  let { x, y, track, onclose }: Props = $props();

  const options = $derived(takeoverSourceOptions($vjClipLauncher));
  const current = $derived($liveTakeover.surfaces[track.layerId]?.source ?? null);

  function pick(source: TakeoverSource) {
    takeOverTrack(track, source);
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
<div class="tk-menu" use:portal style:left="{x}px" style:top="{y}px" onmousedown={(e) => e.stopPropagation()} data-takeover-menu>
  <div class="tk-head">Take over “{track.layerName}”</div>
  <div class="tk-group">VJ rows</div>
  <div class="tk-rows">
    {#each options.rows as o (o.key)}
      <button class="tk-item" class:on={sameTakeoverSource(current, o.source)} class:empty={!o.detail} onclick={() => pick(o.source)} data-takeover-source={o.key} title={o.detail ? `${o.label}: ${o.detail}` : `${o.label}: nothing playing yet`}>
        <span class="tk-label">{o.label}</span><span class="tk-detail">{o.detail || '—'}</span>
      </button>
    {/each}
  </div>
  {#if options.groups.length}
    <div class="tk-group">VJ groups</div>
    {#each options.groups as o (o.key)}
      <button class="tk-item" class:on={sameTakeoverSource(current, o.source)} onclick={() => pick(o.source)} data-takeover-source={o.key}>
        <span class="tk-label">{o.label}</span><span class="tk-detail">{o.detail}</span>
      </button>
    {/each}
  {/if}
  <div class="tk-group">Other</div>
  <button class="tk-item" class:on={sameTakeoverSource(current, options.other[0].source)} onclick={() => pick(options.other[0].source)} data-takeover-source="mix" title="Everything the VJ decks play, mixed">
    <span class="tk-label">VJ mix</span>
  </button>
  <button class="tk-item" class:on={sameTakeoverSource(current, options.other[1].source)} onclick={() => pick(options.other[1].source)} data-takeover-source="black">
    <span class="tk-label">Black</span>
  </button>
  <div class="tk-hint">Or drop media on LIVE to play it on this track.</div>
</div>

<style>
  .tk-menu {
    position: fixed;
    z-index: 10000;
    min-width: 220px;
    max-width: 300px;
    max-height: 360px;
    overflow-y: auto;
    padding: 4px;
    transform: translateY(-100%);
    background: var(--ga-raise, #14141a);
    border: 1px solid rgba(255, 140, 40, 0.55);
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  }
  .tk-head, .tk-group {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 6px 8px 2px;
  }
  .tk-head { color: #ff8c28; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tk-rows { display: grid; grid-template-columns: 1fr 1fr; gap: 1px; }
  .tk-item {
    display: flex;
    align-items: baseline;
    gap: 6px;
    width: 100%;
    min-width: 0;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .tk-item:hover { background: rgba(255, 140, 40, 0.18); color: #fff; }
  .tk-item.on { background: rgba(255, 140, 40, 0.3); color: #fff; }
  .tk-item.empty .tk-detail { opacity: 0.45; }
  .tk-label { flex: 0 0 auto; font-weight: 700; }
  .tk-detail {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #aaa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tk-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); padding: 6px 8px 4px; }
</style>
