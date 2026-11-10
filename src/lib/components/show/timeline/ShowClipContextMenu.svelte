<script lang="ts">
  /**
   * Right-click on a layer-track clip: split, duplicate, delete, ripple
   * delete, what happens at the media's end, colour, and finding its card in
   * the media tray. Acts on the selection when the clip is part of it.
   */
  import type { ShowClipEndBehaviour, ShowLayerClip, ShowLayerTrack } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { clipEnd } from '../../../show/tracks/showTrackEval';
  import { portal } from './trackLayout';
  import { CLIP_SWATCHES, revealClipInMediaTray } from './clipMenuActions';

  interface Props {
    x: number;
    y: number;
    track: ShowLayerTrack;
    clip: ShowLayerClip;
    /** The clips the menu acts on (the selection, or just this clip). */
    ids: string[];
    playhead: number;
    onclose: () => void;
  }

  let { x, y, track, clip, ids, playhead, onclose }: Props = $props();

  const locked = $derived(track.locked);
  const canSplit = $derived(!locked && playhead > clip.startTime + 1e-6 && playhead < clipEnd(clip) - 1e-6);
  const isVideo = $derived(clip.media.kind === 'video');
  const canReveal = $derived(!!clip.media.libraryId);
  const many = $derived(ids.length > 1);

  function run(fn: () => void) {
    fn();
    onclose();
  }

  function setEnd(endBehaviour: ShowClipEndBehaviour) {
    run(() => {
      for (const id of ids) showTimeline.updateLayerClip(id, { endBehaviour }, { discrete: true });
    });
  }

  function setColor(color: string | undefined) {
    run(() => {
      for (const id of ids) showTimeline.updateLayerClip(id, { color }, { discrete: true });
    });
  }

  // Keep the menu on screen.
  let el: HTMLDivElement | undefined = $state();
  let pos = $state({ left: 0, top: 0 });
  $effect(() => {
    const w = el?.offsetWidth ?? 200;
    const h = el?.offsetHeight ?? 260;
    pos = {
      left: Math.max(6, Math.min(x, window.innerWidth - w - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - h - 6)),
    };
  });

  $effect(() => {
    const close = () => onclose();
    const t = setTimeout(() => {
      window.addEventListener('mousedown', close);
      window.addEventListener('blur', close);
    }, 0);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onclose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', key, true);
    };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="ccm"
  bind:this={el}
  use:portal
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  onmousedown={(e) => e.stopPropagation()}
  oncontextmenu={(e) => e.preventDefault()}
  role="menu"
  tabindex="-1"
  data-clip-menu
>
  <div class="ccm-head">{many ? `${ids.length} clips` : clip.label || clip.media.name}</div>
  <button class="ccm-item" role="menuitem" disabled={!canSplit} onclick={() => run(() => showTimeline.splitLayerClips(playhead, [clip.id]))} data-clip-menu="split">
    <span>Split at the playhead</span><kbd>S</kbd>
  </button>
  <button class="ccm-item" role="menuitem" disabled={locked} onclick={() => run(() => showTimeline.duplicateLayerClips(ids))} data-clip-menu="duplicate">
    <span>Duplicate</span><kbd>⌘D</kbd>
  </button>
  <button class="ccm-item" role="menuitem" disabled={locked} onclick={() => run(() => showTimeline.removeLayerClips(ids))} data-clip-menu="delete">
    <span>Delete</span><kbd>⌫</kbd>
  </button>
  <button class="ccm-item" role="menuitem" disabled={locked} onclick={() => run(() => showTimeline.removeLayerClips(ids, { ripple: true }))} data-clip-menu="ripple">
    <span>Delete and close the gap</span><kbd>⇧⌫</kbd>
  </button>
  <div class="ccm-sep"></div>
  <div class="ccm-head">At the end of the media</div>
  <div class="ccm-row" role="group" aria-label="At the end of the media">
    {#each [['stop', 'Stop'], ['loop', 'Loop'], ['hold', 'Hold']] as [value, label] (value)}
      <button
        class="ccm-seg"
        class:on={clip.endBehaviour === value}
        disabled={locked || !isVideo}
        onclick={() => setEnd(value as ShowClipEndBehaviour)}
        title={isVideo ? '' : 'Only video clips have an end'}
        data-clip-menu-end={value}
      >{label}</button>
    {/each}
  </div>
  <div class="ccm-head">Colour</div>
  <div class="ccm-row" role="group" aria-label="Clip colour">
    <button class="ccm-swatch track" class:on={!clip.color} disabled={locked} onclick={() => setColor(undefined)} title="Use the track's colour" aria-label="Use the track's colour"></button>
    {#each CLIP_SWATCHES as sw (sw)}
      <button class="ccm-swatch" class:on={clip.color === sw} style:background={sw} disabled={locked} onclick={() => setColor(sw)} title="Clip colour" aria-label="Clip colour" data-clip-menu-colour={sw}></button>
    {/each}
  </div>
  {#if canReveal}
    <div class="ccm-sep"></div>
    <button class="ccm-item" role="menuitem" onclick={() => run(() => revealClipInMediaTray(clip.media))} data-clip-menu="reveal">
      <span>Show in the media tray</span>
    </button>
  {/if}
</div>

<style>
  .ccm {
    position: fixed;
    z-index: 10000;
    min-width: 210px;
    padding: 4px;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    font-size: var(--ga-text-control, 12px);
    outline: none;
  }
  .ccm-head {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 5px 8px 3px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ccm-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 16px;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    padding: 5px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .ccm-item:hover:not(:disabled) { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .ccm-item:disabled { opacity: 0.4; cursor: default; }
  .ccm-item kbd {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #888);
  }
  .ccm-sep { height: 1px; margin: 4px 0; background: var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
  .ccm-row { display: flex; gap: 3px; padding: 2px 8px 6px; }
  .ccm-seg {
    flex: 1;
    height: 22px;
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #bbb);
    font: inherit;
    cursor: pointer;
  }
  .ccm-seg.on { border-color: #FFD96B; color: #FFD96B; }
  .ccm-seg:disabled { opacity: 0.4; cursor: default; }
  .ccm-swatch {
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 3px;
    border: 1px solid var(--ga-line-3, rgba(255, 255, 255, 0.24));
    cursor: pointer;
  }
  .ccm-swatch.track { background: repeating-linear-gradient(45deg, #555 0 3px, #333 3px 6px); }
  .ccm-swatch.on { box-shadow: 0 0 0 1px #FFD96B; }
  .ccm-swatch:disabled { opacity: 0.4; cursor: default; }
</style>
