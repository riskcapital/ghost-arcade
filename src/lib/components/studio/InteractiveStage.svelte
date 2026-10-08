<script lang="ts">
  /**
   * The stage: preview canvases, the shape overlay and all pointer handling.
   *
   * Pointer positions are normalised to 0–1 and reported upward as edits
   * (select, move, reshape, draw, move emitter, touch the simulation). The
   * scene itself is owned by InteractiveStudio.
   *
   * The overlay is drawn in screen pixels (its viewBox follows the measured
   * size of the stage), so handles are the same size on a phone and on a
   * large window, and hit-testing uses the same pixels.
   */
  import { onMount } from 'svelte';
  import type { Interaction, InteractiveSurface, Point } from '../../mobile/studio/interactive';
  import {
    DEFAULT_ASPECT,
    MOUSE_TOLERANCE,
    TOUCH_TOLERANCE,
    hitTestSurfaces,
    pixelDistance,
    translatePoints,
  } from '../../mobile/studio/surfaceEditing';
  import type { EditorMode, EmitterMarker, TouchTool } from './interactiveEditorTypes';

  export let surfaces: InteractiveSurface[] = [];
  export let selected = '';
  export let mode: EditorMode = 'edit';
  export let tool: TouchTool = 'attract';
  export let placingEmitter = false;
  export let draft: Point[] = [];
  export let emitter: EmitterMarker | null = null;
  /** Width ÷ height of the composition. */
  export let aspect = DEFAULT_ASPECT;

  /** Camera reference layer. */
  export let camera = false;
  export let cameraOpacity = 0.35;
  /** The preview shows native frames (desktop), so the camera sits underneath them. */
  export let nativePreview = false;
  export let previewLabel = 'Interactive preview';
  /** Shown over the stage while there is nothing to preview. */
  export let previewStatus = '';

  /** Canvases the editor draws into. Bind these from the parent. */
  export let canvas: HTMLCanvasElement | undefined = undefined;
  export let programCanvas: HTMLCanvasElement | undefined = undefined;
  export let cameraCanvas: HTMLCanvasElement | undefined = undefined;

  /** A drag that may change the scene starts now (before anything changes). */
  export let ongesture: () => void = () => {};
  export let onselect: (id: string) => void = () => {};
  export let onpoints: (id: string, points: Point[]) => void = () => {};
  export let onvertex: (id: string, index: number, point: Point) => void = () => {};
  export let onemitter: (point: Point) => void = () => {};
  export let ondraftpoint: (point: Point) => void = () => {};
  /** Close the outline being drawn (click on its first point, or double-click). */
  export let onfinish: () => void = () => {};
  /** `start` is true for the press, false while dragging. */
  export let oninteract: (pointerId: number, interaction: Interaction, start: boolean) => void = () => {};
  export let onrelease: (pointerId: number) => void = () => {};

  /** Two presses this close together, this soon, are a double-click (or double-tap). */
  const DOUBLE_PRESS_MS = 400;
  const doublePressReach = (e: PointerEvent) => (e.pointerType === 'touch' ? 18 : 6);

  type Drag =
    | { kind: 'vertex'; id: string; index: number; offset: Point }
    | { kind: 'body'; id: string; start: Point; points: Point[] }
    | { kind: 'emitter'; offset: Point };

  let stage: HTMLDivElement;
  let width = 960;
  let height = 960 / aspect;
  let drag: Drag | null = null;
  /** Mouse position while drawing, for the rubber-band line. */
  let hover: Point | null = null;
  let lastPress = { at: 0, point: { x: -1, y: -1 } };
  /** Corner handles are drawn bigger where the pointer is a finger. */
  let handleRadius = 6;

  $: drawing = mode === 'draw' && !placingEmitter;
  $: editing = mode === 'edit';
  /** The emitter marker can be dragged directly whenever it shows in Select mode. */
  $: emitterGrabbable = !!emitter && editing;
  /** Close the outline when the pointer is on its first point. */
  $: closable = drawing && draft.length >= 3 && !!hover && near(hover, draft[0], MOUSE_TOLERANCE.handle);
  $: rubber = drawing && hover && draft.length ? [draft[draft.length - 1], hover] : null;

  onMount(() => {
    const measure = () => {
      const box = stage.getBoundingClientRect();
      if (box.width && box.height) {
        width = box.width;
        height = box.height;
      }
    };
    measure();
    if (window.matchMedia?.('(pointer: coarse)').matches) handleRadius = 9;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  });

  /** Stop the drag in progress (called when the mode changes mid-drag). */
  export function cancelDrag() {
    drag = null;
    hover = null;
  }

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  const near = (a: Point, b: Point, radius: number) => pixelDistance(a, b, width, height) <= radius;
  const tolerance = (e: PointerEvent) => (e.pointerType === 'touch' ? TOUCH_TOLERANCE : MOUSE_TOLERANCE);

  function position(e: PointerEvent): Point {
    const box = stage.getBoundingClientRect();
    return { x: clamp((e.clientX - box.left) / box.width), y: clamp((e.clientY - box.top) / box.height) };
  }

  function touch(e: PointerEvent, point: Point): Interaction {
    return { id: 'touch-' + e.pointerId, point, strength: e.pressure > 0 ? Math.max(0.3, e.pressure) : 1, mode: tool };
  }

  function pressDraw(e: PointerEvent, p: Point) {
    const now = performance.now();
    const again = now - lastPress.at < DOUBLE_PRESS_MS && near(p, lastPress.point, doublePressReach(e));
    lastPress = { at: now, point: p };
    // Second press of a double-click, or a press on the first point: close the outline.
    if (draft.length >= 3 && (again || near(p, draft[0], tolerance(e).handle))) return onfinish();
    if (!again) ondraftpoint(p);
  }

  function pressEdit(e: PointerEvent, p: Point) {
    const reach = tolerance(e);
    if (emitter && emitterGrabbable && near(p, emitter, reach.handle + 4)) {
      ongesture();
      drag = { kind: 'emitter', offset: { x: emitter.x - p.x, y: emitter.y - p.y } };
      return;
    }
    const hit = hitTestSurfaces(surfaces, p, width, height, selected, reach);
    if (hit.kind === 'none') return onselect('');
    const surface = surfaces.find((s) => s.id === hit.id)!;
    ongesture();
    onselect(hit.id);
    if (hit.kind === 'vertex') {
      // Keep the handle under the pointer where it was grabbed instead of jumping to it.
      const vertex = surface.points[hit.index];
      drag = { kind: 'vertex', id: hit.id, index: hit.index, offset: { x: vertex.x - p.x, y: vertex.y - p.y } };
    } else {
      drag = { kind: 'body', id: hit.id, start: p, points: structuredClone(surface.points) };
    }
  }

  function down(e: PointerEvent) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(e.pointerId);
    const p = position(e);
    if (placingEmitter) {
      ongesture();
      drag = { kind: 'emitter', offset: { x: 0, y: 0 } };
      onemitter(p);
    } else if (mode === 'perform') oninteract(e.pointerId, touch(e, p), true);
    else if (mode === 'draw') pressDraw(e, p);
    else pressEdit(e, p);
  }

  function move(e: PointerEvent) {
    const p = position(e);
    if (drawing) hover = e.pointerType === 'mouse' ? p : null;
    if (mode === 'perform' && !placingEmitter) return oninteract(e.pointerId, touch(e, p), false);
    if (!drag || !stage.hasPointerCapture(e.pointerId)) return;
    if (drag.kind === 'emitter') onemitter({ x: clamp(p.x + drag.offset.x), y: clamp(p.y + drag.offset.y) });
    else if (drag.kind === 'body')
      onpoints(drag.id, translatePoints(drag.points, p.x - drag.start.x, p.y - drag.start.y));
    else onvertex(drag.id, drag.index, { x: clamp(p.x + drag.offset.x), y: clamp(p.y + drag.offset.y) });
  }

  function up(e: PointerEvent) {
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    onrelease(e.pointerId);
    drag = null;
  }

  const outline = (points: Point[]) => points.map((p) => `${p.x * width},${p.y * height}`).join(' ');
</script>

<div class="viewport">
  <div
    class="stage"
    class:drawing
    class:placing={placingEmitter}
    class:dragging={!!drag}
    bind:this={stage}
    role="application"
    tabindex="0"
    aria-label="Interactive scene canvas"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
    onpointerleave={() => (hover = null)}
  >
    <canvas bind:this={programCanvas} class="program-preview" aria-label="Clean interactive output"></canvas>
    <!-- The optional camera stays an editor reference underneath the native pixels. -->
    {#if camera}
      <canvas
        class="camera-source"
        class:native-reference={nativePreview}
        style:opacity={nativePreview ? cameraOpacity : 0}
        bind:this={cameraCanvas}
        aria-hidden="true"
      ></canvas>
    {/if}
    <canvas bind:this={canvas} class:camera-overlay={nativePreview && camera} aria-label={previewLabel}></canvas>
    {#if previewStatus}<div class="preview-status" role="status">{previewStatus}</div>{/if}
    <svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true">
      {#if mode !== 'perform'}
        {#each surfaces as s}
          <polygon class:selected={editing && s.id === selected} points={outline(s.points)} />
          {#if editing && s.id === selected}
            {#each s.points as p}<circle class="handle" cx={p.x * width} cy={p.y * height} r={handleRadius} />{/each}
          {/if}
        {/each}
      {/if}
      {#if emitter}
        <g class="emitter" class:grabbable={emitterGrabbable || placingEmitter}>
          <circle cx={emitter.x * width} cy={emitter.y * height} r="12" />
          <text x={emitter.x * width + 18} y={emitter.y * height + 4}>{emitter.label}</text>
        </g>
      {/if}
      {#if draft.length}
        <polyline class="draft" points={outline(draft)} />
        {#if rubber}
          <polyline class="rubber" points={outline(rubber)} />
          {#if draft.length >= 2}<polyline class="rubber closing" points={outline([rubber[1], draft[0]])} />{/if}
        {/if}
        {#each draft as p, i}
          <circle
            class="draft-point"
            class:closable={i === 0 && closable}
            cx={p.x * width}
            cy={p.y * height}
            r={i === 0 && closable ? 9 : 5}
          />
        {/each}
      {/if}
    </svg>
  </div>
</div>
