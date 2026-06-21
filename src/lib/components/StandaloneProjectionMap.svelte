<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { cornersToMatrix3d, identityCorners, type Pt } from '../mobile/standaloneHomography';

  export let corners: Pt[] | undefined = undefined;
  export let onChange: () => void;

  let containerEl: HTMLElement;
  let containerW = 0;
  let containerH = 0;
  let resizeObs: ResizeObserver | null = null;
  let dragging: number | null = null;

  // Initialize corners to the four screen corners on first paint.
  function ensureCorners() {
    if (!corners || corners.length !== 4) {
      corners = identityCorners(containerW || window.innerWidth, containerH || window.innerHeight);
    }
  }

  function measure() {
    if (!containerEl) return;
    const r = containerEl.getBoundingClientRect();
    containerW = r.width;
    containerH = r.height;
    ensureCorners();
  }

  /** Reactive: corners → matrix3d for the parent's warp target. */
  $: matrix = (containerW > 0 && containerH > 0 && corners)
    ? cornersToMatrix3d(containerW, containerH, corners)
    : 'none';

  /** Publish the matrix to a CSS custom property on `<html>` so the
   *  parent's `.warp-target` can pick it up without prop drilling. */
  $: if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--ga-warp-matrix', matrix);
  }

  function onHandlePointerDown(idx: number, e: PointerEvent) {
    e.preventDefault();
    dragging = idx;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
  }
  function onHandlePointerMove(e: PointerEvent) {
    if (dragging === null || !corners) return;
    const rect = containerEl.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
    corners = corners.map((c, i) => i === dragging ? { x, y } : c);
  }
  function onHandlePointerUp(e: PointerEvent) {
    if (dragging === null) return;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    dragging = null;
    onChange();
  }

  function reset() {
    corners = identityCorners(containerW, containerH);
    onChange();
  }

  onMount(() => {
    measure();
    resizeObs = new ResizeObserver(measure);
    resizeObs.observe(containerEl);
  });
  onDestroy(() => {
    resizeObs?.disconnect();
    // Clear the global var so disabling the mapping reverts cleanly.
    if (typeof document !== 'undefined') {
      document.documentElement.style.removeProperty('--ga-warp-matrix');
    }
  });
</script>

<div class="proj-overlay" bind:this={containerEl}>
  {#if corners}
    <!-- Edge lines between handles -->
    <svg class="proj-lines" width="100%" height="100%" pointer-events="none">
      <polygon
        points={corners.map(c => `${c.x},${c.y}`).join(' ')}
        fill="none"
        stroke="rgba(187, 134, 252, 0.6)"
        stroke-width="2"
        stroke-dasharray="6 4"
      />
    </svg>

    {#each corners as c, i (i)}
      <button
        class="handle"
        style="left: {c.x}px; top: {c.y}px;"
        onpointerdown={(e) => onHandlePointerDown(i, e)}
        onpointermove={onHandlePointerMove}
        onpointerup={onHandlePointerUp}
        onpointercancel={onHandlePointerUp}
        aria-label={`Corner ${i + 1}`}
      ></button>
    {/each}

    <button class="reset-btn" onclick={reset}>Reset map</button>
  {/if}
</div>

<style>
  .proj-overlay {
    position: absolute;
    inset: 0;
    z-index: 3;
    pointer-events: none;
    touch-action: none;
  }
  .proj-lines {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .handle {
    position: absolute;
    transform: translate(-50%, -50%);
    width: 44px;
    height: 44px;
    border-radius: 22px;
    border: 2px solid #BB86FC;
    background: rgba(20, 20, 26, 0.85);
    backdrop-filter: blur(6px);
    cursor: grab;
    pointer-events: auto;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
  }
  .handle:active {
    background: #BB86FC;
    cursor: grabbing;
  }

  .reset-btn {
    position: absolute;
    top: max(env(safe-area-inset-top, 0px), 60px);
    right: 12px;
    pointer-events: auto;
    background: rgba(20, 20, 26, 0.85);
    backdrop-filter: blur(6px);
    border: 1px solid #2a2a30;
    color: #fff;
    padding: 6px 12px;
    border-radius: 14px;
    font-size: 13px;
  }
  .reset-btn:active { background: #BB86FC; color: #1a1a1f; }
</style>
