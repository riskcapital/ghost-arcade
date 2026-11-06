<script lang="ts">
  /**
   * How a video file plays: nothing for hardware decoding, an amber "SW" for
   * software decoding (may lag) with "Convert for smooth playback", a red "!"
   * for a file that cannot play, and the progress while it converts.
   */
  import { onDestroy } from 'svelte';
  import { checkVideoDecode, decodeBadge, videoDecodeHealth } from '../video/videoDecodeHealth';
  import { convertForSmoothPlayback } from '../video/playbackConversionFlow';
  import { portal } from '../utils/portal';

  /** Absolute path of the video file, or null for one that is not on disk. */
  export let path: string | null = null;
  /** Smaller, for tray tiles and clip cells. */
  export let compact = false;
  /** Replace the built-in popover (the VJ grid opens its own clip menu). */
  export let onopen: ((event: MouseEvent) => void) | null = null;

  /** Where the popover sits: centred under the badge, or above it near the
   *  bottom of the window. */
  let popover: { x: number; top: number | null; bottom: number | null } | null = null;
  let badgeEl: HTMLButtonElement | null = null;

  const POPOVER_WIDTH = 260;
  const POPOVER_ROOM = 190;

  $: if (path) void checkVideoDecode(path);
  $: badge = path ? decodeBadge($videoDecodeHealth[path]) : null;
  $: health = path ? $videoDecodeHealth[path] : undefined;

  function open(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (onopen) { onopen(event); return; }
    if (popover) { popover = null; return; }
    // Placed from the badge, not the click: the popover is moved to <body>
    // (a tray tile clips and scales its contents, which hid it), so it
    // cannot lean on the tile for its position.
    const rect = (badgeEl ?? (event.currentTarget as HTMLElement)).getBoundingClientRect();
    const half = POPOVER_WIDTH / 2 + 8;
    const x = Math.min(Math.max(rect.left + rect.width / 2, half), Math.max(half, window.innerWidth - half));
    const above = rect.bottom + POPOVER_ROOM > window.innerHeight && rect.top > POPOVER_ROOM;
    popover = above
      ? { x, top: null, bottom: window.innerHeight - rect.top }
      : { x, top: rect.bottom, bottom: null };
  }

  // The badge sits inside clickable tiles and cells (a tray tile adds its
  // clip to the layer): clicks in the popover stop here.
  function convert(event: MouseEvent) {
    event.stopPropagation();
    popover = null;
    if (path) void convertForSmoothPlayback(path);
  }

  function close(event?: Event) {
    event?.stopPropagation();
    popover = null;
  }
  /** Escape closes the popover; listens only while it is open. */
  function escapeCloses(_node: HTMLElement) {
    const onKeydown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(event); };
    window.addEventListener('keydown', onKeydown);
    return { destroy: () => window.removeEventListener('keydown', onKeydown) };
  }
  onDestroy(() => { popover = null; });
</script>

{#if badge}
  <button
    type="button"
    class="decode-badge {badge.tone}"
    class:compact
    title={badge.title}
    aria-label={badge.title}
    bind:this={badgeEl}
    onpointerdown={(e) => e.stopPropagation()}
    onkeypress={(e) => e.stopPropagation()}
    onclick={open}
  >{badge.label}</button>
{/if}

{#if popover && badge && health}
  <!-- The layer moves to <body> (see utils/portal.ts); this wrapper stays
       here as the block's own node. -->
  <div class="decode-popover-home">
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="decode-layer"
      use:portal
      use:escapeCloses
      onclick={(e) => e.stopPropagation()}
      onpointerdown={(e) => e.stopPropagation()}
      onmousedown={(e) => e.stopPropagation()}
    >
      <div class="decode-backdrop" onclick={close}></div>
      <div
        class="decode-popover"
        class:above={popover.bottom != null}
        style="left:{popover.x}px;{popover.top != null ? `top:${popover.top}px` : `bottom:${popover.bottom}px`}"
        role="dialog"
        aria-label="Video playback"
      >
        <p class="decode-title">{badge.title}</p>
        {#if health.detail}<p class="decode-detail" translate="no">{health.detail}</p>{/if}
        {#if badge.canConvert}
          <button type="button" class="decode-convert" onclick={convert}>Convert for smooth playback</button>
          <p class="decode-note">Makes an H.264 copy beside the file and switches this media to it.</p>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .decode-badge {
    flex: none;
    min-width: 22px;
    height: 16px;
    padding: 0 4px;
    border: 1px solid currentColor;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.72);
    font: 700 9px/14px var(--ga-font-ui, system-ui, sans-serif);
    letter-spacing: 0.04em;
    cursor: pointer;
  }
  .decode-badge.compact { min-width: 18px; height: 14px; line-height: 12px; font-size: 9px; padding: 0 3px; }
  .decode-badge.warn { color: #fbbf24; }
  .decode-badge.error { color: #f87171; }
  .decode-badge.busy { color: #93c5fd; cursor: progress; }
  .decode-popover-home { display: contents; }
  .decode-backdrop { position: fixed; inset: 0; z-index: 9998; }
  .decode-popover {
    position: fixed;
    z-index: 9999;
    width: 260px;
    margin-top: 6px;
    transform: translateX(-50%);
    padding: 10px 12px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.16));
    border-radius: var(--ga-r-soft, 8px);
    background: var(--ga-card, #12161c);
    color: var(--ga-ink-0, #eef0f4);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font: 12px/1.45 var(--ga-font-ui, system-ui, sans-serif);
  }
  .decode-popover.above { margin-top: 0; margin-bottom: 6px; }
  .decode-title { margin: 0 0 6px; }
  .decode-detail { margin: 0 0 8px; color: var(--ga-ink-2); font-size: var(--ga-text-meta); word-break: break-word; }
  .decode-note { margin: 6px 0 0; color: var(--ga-ink-2); font-size: var(--ga-text-meta); }
  .decode-convert {
    width: 100%;
    height: var(--ga-control-h, 26px);
    border: 1px solid transparent;
    border-radius: var(--ga-r-soft, 8px);
    background: var(--ga-accent-gradient, var(--ga-violet, #e7eef5));
    color: var(--ga-blue-800, #0d1530);
    font: 700 12px/1 var(--ga-font-ui, system-ui, sans-serif);
    cursor: pointer;
  }
</style>
