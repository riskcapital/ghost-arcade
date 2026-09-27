<script lang="ts">
  /**
   * Painted-mask brush over the Mapping editor. Each drag is one stroke:
   * points are mapped into the layer's content space (inverse corner pin +
   * mesh, utils/paintMask.ts), streamed to the core as a live preview, and
   * committed to the layer on release as one undo step.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { project, selectedLayer } from '../stores/layers';
  import { paintBrush, paintMaskLayerId, PAINT_BRUSH_SIZE_MAX, PAINT_BRUSH_SIZE_MIN } from '../stores/paintMaskTool';
  import { brushRadiusInContent, canvasToLayerContent, encodePaintPoints, nativePaintStroke, paintPointSpacingOk } from '../utils/paintMask';
  import { submitNativeRendererCommands } from '../api/native-renderer';
  import { generateUUID } from '../utils/uuid';
  import type { PaintMaskStroke, Point2D } from '../types';

  export let containerWidth = 800;
  export let containerHeight = 600;

  let el: HTMLDivElement;
  let cursor: { x: number; y: number } | null = null;
  let altHeld = false;
  let drag: { layerId: string; stroke: Omit<PaintMaskStroke, 'points'>; points: Point2D[]; pointerId: number } | null = null;
  let previewRaf: number | null = null;

  $: mode = altHeld ? ($paintBrush.mode === 'erase' ? 'restore' : 'erase') : $paintBrush.mode;
  $: projectWidth = Math.max(1, $project.width || 1920);
  $: projectHeight = Math.max(1, $project.height || 1080);
  $: ringRx = ($paintBrush.size / projectWidth) * containerWidth;
  $: ringRy = ($paintBrush.size / projectHeight) * containerHeight;

  function canvasPoint(e: PointerEvent): Point2D {
    const rect = el.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / Math.max(1, rect.width),
      y: 1 - (e.clientY - rect.top) / Math.max(1, rect.height),
    };
  }

  function trackCursor(e: PointerEvent) {
    const rect = el.getBoundingClientRect();
    cursor = {
      x: ((e.clientX - rect.left) / Math.max(1, rect.width)) * containerWidth,
      y: ((e.clientY - rect.top) / Math.max(1, rect.height)) * containerHeight,
    };
  }

  function currentStroke(): PaintMaskStroke | null {
    if (!drag || drag.points.length === 0) return null;
    return { ...drag.stroke, points: encodePaintPoints(drag.points) };
  }

  function sendPreview(stroke: PaintMaskStroke | null, layerId: string) {
    void submitNativeRendererCommands([{
      type: 'set_layer_paint_preview',
      layer_id: layerId,
      stroke: stroke ? nativePaintStroke(stroke) : null,
    }]).catch(() => {});
  }

  function schedulePreview() {
    if (previewRaf !== null) return;
    previewRaf = requestAnimationFrame(() => {
      previewRaf = null;
      const stroke = currentStroke();
      if (drag && stroke) sendPreview(stroke, drag.layerId);
    });
  }

  function addPoint(canvas: Point2D) {
    if (!drag) return;
    const layer = get(project).layers.find((l) => l.id === drag!.layerId);
    if (!layer) return;
    const content = canvasToLayerContent(layer, canvas);
    if (!content) return;
    if (!paintPointSpacingOk(drag.points[drag.points.length - 1], content, drag.stroke.rx, drag.stroke.ry)) return;
    drag.points.push(content);
    schedulePreview();
  }

  function handlePointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const layer = get(selectedLayer);
    if (!layer || layer.locked || layer.id !== get(paintMaskLayerId)) return;
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasPoint(e);
    const brush = get(paintBrush);
    const radius = brushRadiusInContent(layer, canvas, brush.size, projectWidth, projectHeight);
    if (!radius) return;
    el.setPointerCapture(e.pointerId);
    drag = {
      layerId: layer.id,
      pointerId: e.pointerId,
      stroke: { id: generateUUID(), mode, rx: radius.rx, ry: radius.ry, softness: brush.softness, opacity: brush.opacity },
      points: [],
    };
    addPoint(canvas);
  }

  function handlePointerMove(e: PointerEvent) {
    trackCursor(e);
    altHeld = e.altKey;
    if (drag && e.pointerId === drag.pointerId) {
      // Coalesced events keep fast strokes smooth at low frame rates.
      const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      for (const ev of events.length ? events : [e]) addPoint(canvasPoint(ev));
    }
  }

  function finishStroke(commit: boolean) {
    if (!drag) return;
    if (previewRaf !== null) cancelAnimationFrame(previewRaf);
    previewRaf = null;
    const { layerId } = drag;
    const stroke = commit ? currentStroke() : null;
    drag = null;
    if (stroke) {
      // The committed stroke replaces the preview in the core (same id).
      project.addPaintMaskStroke(layerId, stroke);
    } else {
      sendPreview(null, layerId);
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    addPoint(canvasPoint(e));
    finishStroke(true);
  }

  function handleKey(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    altHeld = e.altKey;
    if (e.type !== 'keydown') return;
    if (e.key === '[' || e.key === ']') {
      const size = get(paintBrush).size;
      const step = Math.max(1, Math.round(size * 0.15));
      paintBrush.update({ size: Math.max(PAINT_BRUSH_SIZE_MIN, Math.min(PAINT_BRUSH_SIZE_MAX, size + (e.key === ']' ? step : -step))) });
      e.preventDefault();
    } else if (e.key === 'x' || e.key === 'X') {
      paintBrush.update({ mode: get(paintBrush).mode === 'erase' ? 'restore' : 'erase' });
    } else if (e.key === 'Escape') {
      finishStroke(false);
      paintMaskLayerId.set(null);
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    window.addEventListener('keyup', handleKey);
  });

  onDestroy(() => {
    window.removeEventListener('keydown', handleKey);
    window.removeEventListener('keyup', handleKey);
    finishStroke(false);
  });
</script>

<div
  bind:this={el}
  class="paint-mask-overlay"
  style="width: {containerWidth}px; height: {containerHeight}px;"
  data-paint-mode={mode}
  onpointerdown={handlePointerDown}
  onpointermove={handlePointerMove}
  onpointerup={handlePointerUp}
  onpointercancel={() => finishStroke(false)}
  onpointerleave={() => { if (!drag) cursor = null; }}
  oncontextmenu={(e) => e.preventDefault()}
  role="presentation"
>
  {#if cursor}
    <svg class="paint-brush-ring" width={containerWidth} height={containerHeight} aria-hidden="true">
      <ellipse cx={cursor.x} cy={cursor.y} rx={ringRx} ry={ringRy} class="ring-shadow" />
      <ellipse cx={cursor.x} cy={cursor.y} rx={ringRx} ry={ringRy} class="ring" class:restore={mode === 'restore'} />
      {#if $paintBrush.softness > 0.05}
        <ellipse cx={cursor.x} cy={cursor.y} rx={ringRx * (1 - $paintBrush.softness)} ry={ringRy * (1 - $paintBrush.softness)} class="ring-inner" />
      {/if}
      <circle cx={cursor.x} cy={cursor.y} r="1.5" class="ring-dot" />
    </svg>
  {/if}
</div>

<style>
  .paint-mask-overlay {
    position: absolute;
    left: 0;
    top: 0;
    cursor: none;
    touch-action: none;
    z-index: 30;
  }
  .paint-brush-ring {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  .ring-shadow { fill: none; stroke: rgba(0, 0, 0, 0.7); stroke-width: 3; }
  .ring { fill: none; stroke: #ff5a7a; stroke-width: 1.5; }
  .ring.restore { stroke: #5affb0; }
  .ring-inner { fill: none; stroke: rgba(255, 255, 255, 0.55); stroke-width: 1; stroke-dasharray: 3 3; }
  .ring-dot { fill: #fff; }
</style>
