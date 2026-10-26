<script lang="ts">
  /**
   * How a video file plays: nothing for hardware decoding, an amber "SW" for
   * software decoding (may lag) with "Convert for smooth playback", a red "!"
   * for a file that cannot play, and the progress while it converts.
   */
  import { onDestroy } from 'svelte';
  import { checkVideoDecode, decodeBadge, videoDecodeHealth } from '../video/videoDecodeHealth';
  import { convertForSmoothPlayback } from '../video/playbackConversionFlow';

  /** Absolute path of the video file, or null for one that is not on disk. */
  export let path: string | null = null;
  /** Smaller, for tray tiles and clip cells. */
  export let compact = false;
  /** Replace the built-in popover (the VJ grid opens its own clip menu). */
  export let onopen: ((event: MouseEvent) => void) | null = null;

  let popover: { x: number; y: number } | null = null;

  $: if (path) void checkVideoDecode(path);
  $: badge = path ? decodeBadge($videoDecodeHealth[path]) : null;
  $: health = path ? $videoDecodeHealth[path] : undefined;

  function open(event: MouseEvent) {
    event.stopPropagation();
    event.preventDefault();
    if (onopen) { onopen(event); return; }
    popover = popover ? null : { x: event.clientX, y: event.clientY };
  }

  function convert() {
    popover = null;
    if (path) void convertForSmoothPlayback(path);
  }

  function close() { popover = null; }
  onDestroy(close);
</script>

{#if badge}
  <button
    type="button"
    class="decode-badge {badge.tone}"
    class:compact
    title={badge.title}
    aria-label={badge.title}
    onpointerdown={(e) => e.stopPropagation()}
    onclick={open}
  >{badge.label}</button>
{/if}

{#if popover && badge && health}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="decode-backdrop" onclick={close} onpointerdown={(e) => e.stopPropagation()}></div>
  <div class="decode-popover" style="left:{popover.x}px;top:{popover.y}px" role="dialog" aria-label="Video playback">
    <p class="decode-title">{badge.title}</p>
    {#if health.detail}<p class="decode-detail" translate="no">{health.detail}</p>{/if}
    {#if badge.canConvert}
      <button type="button" class="decode-convert" onclick={convert}>Convert for smooth playback</button>
      <p class="decode-note">Makes an H.264 copy beside the file and switches this media to it.</p>
    {/if}
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
  .decode-badge.compact { min-width: 18px; height: 14px; line-height: 12px; font-size: 8px; padding: 0 3px; }
  .decode-badge.warn { color: #fbbf24; }
  .decode-badge.error { color: #f87171; }
  .decode-badge.busy { color: #93c5fd; cursor: progress; }
  .decode-backdrop { position: fixed; inset: 0; z-index: 9998; }
  .decode-popover {
    position: fixed;
    z-index: 9999;
    width: 260px;
    margin-top: 8px;
    transform: translateX(-50%);
    padding: 10px 12px;
    border: 1px solid var(--ga-line, rgba(255, 255, 255, 0.16));
    border-radius: 4px;
    background: var(--ga-card, #12161c);
    color: var(--ga-ink-0, #eef0f4);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    font: 12px/1.45 var(--ga-font-ui, system-ui, sans-serif);
  }
  .decode-title { margin: 0 0 6px; }
  .decode-detail { margin: 0 0 8px; color: rgba(238, 240, 244, 0.55); font-size: 11px; word-break: break-word; }
  .decode-note { margin: 6px 0 0; color: rgba(238, 240, 244, 0.6); font-size: 11px; }
  .decode-convert {
    width: 100%;
    height: 28px;
    border: 1px solid var(--ga-icon, #5278ff);
    border-radius: 2px;
    background: var(--ga-blue-soft, rgba(82, 120, 255, 0.18));
    color: inherit;
    font: 700 12px/1 var(--ga-font-ui, system-ui, sans-serif);
    cursor: pointer;
  }
</style>
