<script lang="ts">
  /**
   * The stage: preview canvases, the shape overlay and all pointer handling.
   *
   * Pointer positions are normalised to 0–1 and reported upward as edits
   * (select, move, reshape, draw, place emitter, touch the simulation). The
   * scene itself is owned by InteractiveStudio.
   */
  import type { Interaction, InteractiveSurface, Point } from '../../mobile/studio/interactive';
  import { hitTestSurfaces, translatePoints } from '../../mobile/studio/surfaceEditing';
  import type { EditorMode, EmitterMarker, TouchTool } from './interactiveEditorTypes';

  export let surfaces: InteractiveSurface[] = [];
  export let selected = '';
  export let mode: EditorMode = 'edit';
  export let tool: TouchTool = 'attract';
  export let placingEmitter = false;
  export let draft: Point[] = [];
  export let emitter: EmitterMarker | null = null;

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

  /** A press landed on the stage in Select mode (before anything changes). */
  export let onedit: () => void = () => {};
  export let onselect: (id: string) => void = () => {};
  export let onpoints: (id: string, points: Point[]) => void = () => {};
  export let onvertex: (id: string, index: number, point: Point) => void = () => {};
  export let ondraftpoint: (point: Point) => void = () => {};
  /** `start` is true for the press, false while dragging. */
  export let onplace: (point: Point, start: boolean) => void = () => {};
  export let oninteract: (pointerId: number, interaction: Interaction, start: boolean) => void = () => {};
  export let onrelease: (pointerId: number) => void = () => {};

  /** SVG overlay units. The overlay stretches to the stage box. */
  const VIEW_WIDTH = 960;
  const VIEW_HEIGHT = 540;

  let stage: HTMLDivElement;
  let dragVertex = -1;
  let bodyStart: Point | null = null;
  let bodyPoints: Point[] = [];

  /** Stop reshaping a corner (called when the mode changes mid-drag). */
  export function cancelDrag() {
    dragVertex = -1;
  }

  function position(e: PointerEvent): Point {
    const box = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (e.clientY - box.top) / box.height)),
    };
  }

  function touch(e: PointerEvent, point: Point): Interaction {
    return { id: 'touch-' + e.pointerId, point, strength: e.pressure > 0 ? Math.max(0.3, e.pressure) : 1, mode: tool };
  }

  function down(e: PointerEvent) {
    stage.focus({ preventScroll: true });
    stage.setPointerCapture(e.pointerId);
    const p = position(e);
    if (placingEmitter) {
      onplace(p, true);
      return;
    }
    if (mode === 'perform') {
      oninteract(e.pointerId, touch(e, p), true);
      return;
    }
    if (mode === 'draw') {
      ondraftpoint(p);
      return;
    }
    onedit();
    const box = stage.getBoundingClientRect();
    const hit = hitTestSurfaces(surfaces, p, box.width, box.height);
    dragVertex = -1;
    if (hit.kind === 'vertex') {
      dragVertex = hit.index;
      onselect(hit.id);
    } else if (hit.kind === 'body') {
      bodyStart = p;
      bodyPoints = structuredClone(surfaces.find((s) => s.id === hit.id)!.points);
      onselect(hit.id);
    } else {
      onselect('');
    }
  }

  function move(e: PointerEvent) {
    const p = position(e);
    const captured = stage.hasPointerCapture(e.pointerId);
    if (placingEmitter && captured) {
      onplace(p, false);
      return;
    }
    if (mode === 'edit' && bodyStart && captured)
      onpoints(selected, translatePoints(bodyPoints, p.x - bodyStart.x, p.y - bodyStart.y));
    if (mode === 'perform') oninteract(e.pointerId, touch(e, p), false);
    if (mode === 'edit' && dragVertex >= 0 && captured) onvertex(selected, dragVertex, p);
  }

  function up(e: PointerEvent) {
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    onrelease(e.pointerId);
    dragVertex = -1;
    bodyStart = null;
  }

  const outline = (points: Point[]) => points.map((p) => `${p.x * VIEW_WIDTH},${p.y * VIEW_HEIGHT}`).join(' ');
</script>

<div class="viewport">
  <div
    class="stage"
    bind:this={stage}
    role="application"
    tabindex="0"
    aria-label="Interactive scene canvas"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={up}
    onpointercancel={up}
    onlostpointercapture={up}
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
    <svg viewBox="0 0 {VIEW_WIDTH} {VIEW_HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
      {#if mode !== 'perform'}
        {#each surfaces as s}
          <polygon class:selected={s.id === selected} points={outline(s.points)} />
          {#if s.id === selected}
            {#each s.points as p}<circle cx={p.x * VIEW_WIDTH} cy={p.y * VIEW_HEIGHT} r="6" />{/each}
          {/if}
        {/each}
      {/if}
      {#if emitter}
        <g class="emitter">
          <circle cx={emitter.x * VIEW_WIDTH} cy={emitter.y * VIEW_HEIGHT} r="12" />
          <text x={emitter.x * VIEW_WIDTH + 18} y={emitter.y * VIEW_HEIGHT + 4}>{emitter.label}</text>
        </g>
      {/if}
      <polyline points={outline(draft)} />
      {#each draft as p}<circle cx={p.x * VIEW_WIDTH} cy={p.y * VIEW_HEIGHT} r="5" />{/each}
    </svg>
  </div>
</div>
