<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  export let value: number = 0.75;
  export let label: string = '';
  export let color: string = 'var(--accent-primary)';
  export let height: number = 160;
  export let orientation: 'vertical' | 'horizontal' = 'vertical';
  export let onChange: (val: number) => void = () => {};
  export let onDragStart: (() => void) | undefined = undefined;
  export let onDragEnd: (() => void) | undefined = undefined;
  export let showLeds: boolean = true;
  export let ledCount: number = 8;

  let trackEl: HTMLDivElement;
  let touchAreaEl: HTMLDivElement;
  let dragging = false;

  // ── Local value decoupled from prop to prevent bounce-back ──
  // While dragging, we render from localValue and IGNORE incoming prop changes.
  // Once drag ends, we re-sync to the prop.
  let localValue: number = value;
  $: if (!dragging) {
    localValue = value;
  }

  // LED segments lit based on local value
  $: litLeds = Math.round(localValue * ledCount);

  // Percentage display
  $: displayPercent = Math.round(localValue * 100);

  // ── Cached bounding rect (set once on drag start, avoids layout thrash) ──
  let cachedRect: DOMRect | null = null;

  function startDrag() {
    dragging = true;
    cachedRect = trackEl?.getBoundingClientRect() ?? null;
    onDragStart?.();
  }

  function endDrag() {
    dragging = false;
    cachedRect = null;
    onDragEnd?.();
  }

  function computeRatio(clientX: number, clientY: number): number {
    const rect = cachedRect || trackEl?.getBoundingClientRect();
    if (!rect) return localValue;
    let ratio: number;
    if (orientation === 'vertical') {
      ratio = 1 - (clientY - rect.top) / rect.height;
    } else {
      ratio = (clientX - rect.left) / rect.width;
    }
    return Math.max(0, Math.min(1, ratio));
  }

  function applyValue(clientX: number, clientY: number) {
    const clamped = computeRatio(clientX, clientY);
    localValue = clamped;
    onChange(clamped);
  }

  // ── Touch handlers (registered manually with { passive: false } in onMount) ──
  function handleTouchStart(e: TouchEvent) {
    e.preventDefault();
    e.stopPropagation();
    startDrag();
    applyValue(e.touches[0].clientX, e.touches[0].clientY);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    applyValue(e.touches[0].clientX, e.touches[0].clientY);
  }

  function handleTouchEnd(e: TouchEvent) {
    e.stopPropagation();
    endDrag();
  }

  // ── Mouse handlers (for desktop testing) ──
  function handleMouseDown(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    startDrag();
    applyValue(e.clientX, e.clientY);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }

  function handleMouseMove(e: MouseEvent) {
    if (!dragging) return;
    applyValue(e.clientX, e.clientY);
  }

  function handleMouseUp() {
    endDrag();
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  }

  // ── Register touch listeners with { passive: false } for iOS Safari ──
  // Svelte's on:touchmove doesn't allow passive:false, so we register manually.
  onMount(() => {
    if (touchAreaEl) {
      touchAreaEl.addEventListener('touchstart', handleTouchStart, { passive: false });
      touchAreaEl.addEventListener('touchmove', handleTouchMove, { passive: false });
      touchAreaEl.addEventListener('touchend', handleTouchEnd, { passive: false });
    }
  });

  onDestroy(() => {
    if (touchAreaEl) {
      touchAreaEl.removeEventListener('touchstart', handleTouchStart);
      touchAreaEl.removeEventListener('touchmove', handleTouchMove);
      touchAreaEl.removeEventListener('touchend', handleTouchEnd);
    }
    // Clean up any lingering mouse listeners
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  });
</script>

{#if orientation === 'vertical'}
  <div class="vj-fader vertical" style="--fader-color: {color}; --fader-height: {height}px;">
    {#if label}
      <span class="fader-label">{label}</span>
    {/if}
    <div class="fader-body">
      {#if showLeds}
        <div class="led-meter">
          {#each Array(ledCount) as _, i}
            {@const ledIndex = ledCount - 1 - i}
            <div
              class="led-segment"
              class:lit={ledIndex < litLeds}
              class:hot={ledIndex >= ledCount - 2 && ledIndex < litLeds}
            ></div>
          {/each}
        </div>
      {/if}
      <!-- Wide touch capture area wrapping the narrow visual track -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fader-touch-area"
        bind:this={touchAreaEl}
        on:mousedown={handleMouseDown}
        role="slider"
        aria-valuenow={displayPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        tabindex={0}
      >
        <div class="fader-track" bind:this={trackEl}>
          <!-- Tick marks -->
          <div class="tick-marks">
            <div class="tick" style="bottom: 100%;"></div>
            <div class="tick" style="bottom: 75%;"></div>
            <div class="tick" style="bottom: 50%;"></div>
            <div class="tick" style="bottom: 25%;"></div>
            <div class="tick" style="bottom: 0%;"></div>
          </div>
          <!-- Fill -->
          <div class="fader-fill" class:dragging style="height: {localValue * 100}%;"></div>
          <!-- Thumb -->
          <div
            class="fader-thumb"
            class:active={dragging}
            style="bottom: calc({localValue * 100}% - 7px);"
          ></div>
        </div>
      </div>
    </div>
    <span class="fader-value">{displayPercent}%</span>
  </div>
{:else}
  <div class="vj-fader horizontal" style="--fader-color: {color};">
    {#if label}
      <span class="fader-label">{label}</span>
    {/if}
    <div class="fader-body-h">
      <!-- Wide touch capture area wrapping the narrow visual track -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="fader-touch-area-h"
        bind:this={touchAreaEl}
        on:mousedown={handleMouseDown}
        role="slider"
        aria-valuenow={displayPercent}
        aria-valuemin={0}
        aria-valuemax={100}
        tabindex={0}
      >
        <div class="fader-track-h" bind:this={trackEl}>
          <div class="fader-fill-h" class:dragging style="width: {localValue * 100}%;"></div>
          <div
            class="fader-thumb-h"
            class:active={dragging}
            style="left: calc({localValue * 100}% - 8px);"
          ></div>
        </div>
      </div>
      {#if showLeds}
        <div class="led-meter-h">
          {#each Array(ledCount) as _, i}
            <div
              class="led-segment-h"
              class:lit={i < litLeds}
              class:hot={i >= ledCount - 2 && i < litLeds}
            ></div>
          {/each}
        </div>
      {/if}
    </div>
    <span class="fader-value">{displayPercent}%</span>
  </div>
{/if}

<style>
  /* ── Vertical Fader ── */
  .vj-fader.vertical {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
  }

  .fader-label {
    font-size: 10px;
    font-weight: 700;
    color: var(--fader-color);
    text-transform: uppercase;
    letter-spacing: 1px;
    text-shadow: 0 0 8px var(--fader-color);
  }

  .fader-body {
    display: flex;
    gap: 6px;
    align-items: stretch;
    height: var(--fader-height);
  }

  .led-meter {
    display: flex;
    flex-direction: column;
    gap: 3px;
    justify-content: flex-end;
    padding: 4px 0;
  }

  .led-segment {
    width: 5px;
    height: 5px;
    border-radius: 1px;
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.04);
    transition: background 0.08s, box-shadow 0.08s;
  }

  .led-segment.lit {
    background: var(--fader-color);
    box-shadow: 0 0 6px var(--fader-color);
    border-color: transparent;
  }

  .led-segment.hot {
    background: #ff4444;
    box-shadow: 0 0 8px #ff4444;
  }

  /* Touch capture area — much wider than the visual track for easy touch */
  .fader-touch-area {
    position: relative;
    width: 48px;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  .fader-track {
    position: relative;
    width: 8px;
    height: 100%;
    background: #1a1a1e;
    border-radius: 4px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
    overflow: visible;
  }

  .tick-marks {
    position: absolute;
    left: -6px;
    top: 0;
    bottom: 0;
    width: 4px;
    pointer-events: none;
  }

  .tick {
    position: absolute;
    width: 4px;
    height: 1px;
    background: rgba(255, 255, 255, 0.15);
    transform: translateY(50%);
  }

  .fader-fill {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    border-radius: 4px;
    background: linear-gradient(to top, var(--fader-color), color-mix(in srgb, var(--fader-color) 50%, transparent));
    transition: none;
    will-change: height;
  }

  .fader-thumb {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    width: 40px;
    height: 16px;
    border-radius: 5px;
    background: linear-gradient(to bottom,
      color-mix(in srgb, var(--fader-color) 90%, white),
      var(--fader-color)
    );
    box-shadow:
      0 0 8px var(--fader-color),
      0 0 16px color-mix(in srgb, var(--fader-color) 25%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.3),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2);
    transition: box-shadow 0.12s;
    z-index: 2;
    cursor: grab;
    will-change: bottom;
  }

  .fader-thumb.active {
    cursor: grabbing;
    box-shadow:
      0 0 16px var(--fader-color),
      0 0 32px color-mix(in srgb, var(--fader-color) 40%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transform: translateX(-50%) scaleX(1.08);
    /* Kill positional transitions during drag for zero latency */
    transition: none;
  }

  .fader-value {
    font-size: 10px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.5);
    font-variant-numeric: tabular-nums;
    min-width: 32px;
    text-align: center;
  }

  /* ── Horizontal Fader ── */
  .vj-fader.horizontal {
    display: flex;
    align-items: center;
    gap: 8px;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: none;
  }

  .vj-fader.horizontal .fader-label {
    font-size: 10px;
    min-width: 32px;
    text-align: right;
  }

  .fader-body-h {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  /* Touch capture area — taller than the visual track for easy touch */
  .fader-touch-area-h {
    position: relative;
    height: 44px;
    width: 100%;
    display: flex;
    align-items: center;
    cursor: pointer;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
  }

  .fader-track-h {
    position: relative;
    height: 28px;
    width: 100%;
    background: #1a1a1e;
    border-radius: 6px;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.6);
    overflow: visible;
  }

  .fader-fill-h {
    position: absolute;
    top: 0;
    left: 0;
    bottom: 0;
    border-radius: 6px;
    background: linear-gradient(to right, color-mix(in srgb, var(--fader-color) 40%, transparent), var(--fader-color));
    transition: none;
    will-change: width;
  }

  .fader-thumb-h {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 44px;
    border-radius: 6px;
    background: linear-gradient(to right,
      color-mix(in srgb, var(--fader-color) 90%, white),
      var(--fader-color)
    );
    box-shadow:
      0 0 8px var(--fader-color),
      0 0 16px color-mix(in srgb, var(--fader-color) 25%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.3),
      inset 0 -1px 0 rgba(0, 0, 0, 0.2);
    transition: box-shadow 0.12s;
    z-index: 2;
    cursor: grab;
    will-change: left;
  }

  .fader-thumb-h.active {
    cursor: grabbing;
    box-shadow:
      0 0 16px var(--fader-color),
      0 0 32px color-mix(in srgb, var(--fader-color) 40%, transparent),
      inset 0 1px 0 rgba(255, 255, 255, 0.4);
    transform: translateY(-50%) scaleY(1.06);
    transition: none;
  }

  .led-meter-h {
    display: flex;
    gap: 3px;
    padding: 0 2px;
  }

  .led-segment-h {
    flex: 1;
    height: 3px;
    border-radius: 1px;
    background: #1a1a1e;
    transition: background 0.08s, box-shadow 0.08s;
  }

  .led-segment-h.lit {
    background: var(--fader-color);
    box-shadow: 0 0 4px var(--fader-color);
  }

  .led-segment-h.hot {
    background: #ff4444;
    box-shadow: 0 0 6px #ff4444;
  }

  .vj-fader.horizontal .fader-value {
    min-width: 40px;
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.6);
  }
</style>
