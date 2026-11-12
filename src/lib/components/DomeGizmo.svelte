<script lang="ts">
  /**
   * DomeGizmo — places layers on the dome by hand, on the editor canvas.
   *
   * While a dome output is on, the editor canvas shows the dome picture, so
   * a layer's canvas-space handles no longer sit on what it draws. This
   * overlay draws the dome's rim and front, the outline of every layer
   * placed on the dome (Layer.domePlacement), and handles for the selected
   * one:
   *   - drag the layer to move it over the dome (its top keeps pointing to
   *     the zenith, and its turn stays as set);
   *   - drag a corner to size it;
   *   - drag the knob above it to turn it.
   * It works the same over the Inside view (`inside`), drawn through that
   * view's camera, so a layer can be placed while looking at it from the
   * seats; dragging anywhere else there still turns the view.
   * The geometry is output/domeMath.ts, which mirrors the renderer.
   */
  import { onDestroy } from 'svelte';
  import { project } from '../stores/layers';
  import { settings } from '../stores/settings';
  import { domeView } from '../stores/domeView';
  import {
    azElOf,
    directionAt,
    domeLensOf,
    domePointToFrame,
    dot,
    framePointToDome,
    insideViewDirection,
    insideViewPoint,
    placedCanvasDirection,
    placementBasis,
    placementOf,
    pointOf,
    type Vec2,
    type Vec3,
  } from '../output/domeMath';
  import type { DomePlacement, Layer, Point2D } from '../types';

  interface Props {
    containerWidth: number;
    containerHeight: number;
    zoom?: number;
    /** Over the Inside view rather than the dome picture. */
    inside?: boolean;
  }
  let { containerWidth, containerHeight, zoom = 1, inside = false }: Props = $props();
  let camera = $derived($domeView);

  let out = $derived($settings.output);
  let lens = $derived(domeLensOf(out));
  let fov = $derived(out.domeFOV ?? 180);
  let truncation = $derived(out.domeTruncation ?? 1);
  let aspect = $derived(containerWidth / Math.max(containerHeight, 1));
  let placed = $derived($project.layers.filter((layer) => layer.visible && layer.domePlacement?.enabled));
  let selectedId = $derived($project.selectedLayerId);
  let handleR = $derived(5 / Math.max(zoom, 0.25));

  // ─── Frame <-> dome ─────────────────────────────────────────────────
  function toPx(m: Vec2): Vec2 {
    const f = domePointToFrame(m, aspect, out);
    return { x: f.x * containerWidth, y: (1 - f.y) * containerHeight };
  }

  function dirToPx(dir: Vec3): Vec2 | null {
    // Off the dome is off the dome, whichever way it is looked at.
    const m = pointOf(dir, lens, fov);
    if (!m || Math.hypot(m.x, m.y) > truncation + 1e-3) return null;
    if (!inside) return toPx(m);
    const uv = insideViewPoint(dir, camera, aspect);
    // Far outside the view a point only stretches the outline across it.
    if (!uv || uv.x < -2 || uv.x > 3 || uv.y < -2 || uv.y > 3) return null;
    return { x: uv.x * containerWidth, y: (1 - uv.y) * containerHeight };
  }

  function pointerDir(e: PointerEvent, svg: SVGSVGElement): Vec3 {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * containerWidth;
    const py = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * containerHeight;
    const uv = { x: px / containerWidth, y: 1 - py / containerHeight };
    if (inside) return insideViewDirection(uv, camera, aspect);
    return directionAt(framePointToDome(uv, aspect, out), lens, fov);
  }

  // ─── Outlines ───────────────────────────────────────────────────────
  const EDGE_STEPS = 24;

  /** An SVG path through canvas points (y-up) of a placed layer, broken where it leaves the dome. */
  function pathThrough(points: Point2D[], place: DomePlacement, closed: boolean): string {
    const ring = closed ? [...points, points[0]] : points;
    let d = '';
    let pen = false;
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i];
      const b = ring[i + 1];
      for (let s = i === 0 ? 0 : 1; s <= EDGE_STEPS; s++) {
        const t = s / EDGE_STEPS;
        const uv = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const px = dirToPx(placedCanvasDirection(uv, place, aspect));
        if (!px) {
          pen = false;
          continue;
        }
        d += `${pen ? 'L' : 'M'}${px.x.toFixed(1)},${px.y.toFixed(1)}`;
        pen = true;
      }
    }
    return d;
  }

  function layerQuad(layer: Layer): Point2D[] {
    const c = layer.corners;
    return [c.topLeft, c.topRight, c.bottomRight, c.bottomLeft];
  }

  const FRAME: Point2D[] = [
    { x: 0, y: 1 },
    { x: 1, y: 1 },
    { x: 1, y: 0 },
    { x: 0, y: 0 },
  ];
  const ROLL_KNOB: Point2D = { x: 0.5, y: 1.14 };

  function at(uv: Point2D, place: DomePlacement): Vec2 | null {
    return dirToPx(placedCanvasDirection(uv, place, aspect));
  }

  let rimCenter = $derived(toPx({ x: 0, y: 0 }));
  let rimRadius = $derived(truncation * Math.min(containerWidth, containerHeight) * 0.5);
  let frontIn = $derived(toPx({ x: 0, y: -truncation + 0.05 }));
  let frontOut = $derived(toPx({ x: 0, y: -truncation - 0.02 }));

  // ─── Dragging ───────────────────────────────────────────────────────
  type Drag =
    | { kind: 'move'; layerId: string; from: Vec3; center: Vec3 }
    | { kind: 'size'; layerId: string }
    | { kind: 'roll'; layerId: string };
  let drag: Drag | null = null;
  let dragSvg: SVGSVGElement | null = null;

  function rotateTowards(v: Vec3, from: Vec3, to: Vec3): Vec3 {
    const k: Vec3 = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]];
    const sin = Math.hypot(k[0], k[1], k[2]);
    if (sin < 1e-7) return v;
    const axis: Vec3 = [k[0] / sin, k[1] / sin, k[2] / sin];
    const cos = dot(from, to);
    const angle = Math.atan2(sin, cos);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    const kv: Vec3 = [axis[1] * v[2] - axis[2] * v[1], axis[2] * v[0] - axis[0] * v[2], axis[0] * v[1] - axis[1] * v[0]];
    const kd = dot(axis, v) * (1 - c);
    return [v[0] * c + kv[0] * s + axis[0] * kd, v[1] * c + kv[1] * s + axis[1] * kd, v[2] * c + kv[2] * s + axis[2] * kd];
  }

  function layerById(id: string): Layer | undefined {
    return $project.layers.find((layer) => layer.id === id);
  }

  function commit(layerId: string, patch: Partial<DomePlacement>) {
    const layer = layerById(layerId);
    if (!layer || layer.locked) return;
    // Hundredths of a degree: finer than a projector pixel, and no float dust in the project.
    const tidy = Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, Math.round((value as number) * 100) / 100 + 0]));
    project.updateLayer(layerId, { domePlacement: { ...placementOf(layer), ...tidy, enabled: true } });
  }

  function begin(e: PointerEvent, layer: Layer, kind: Drag['kind']) {
    if (e.button !== 0) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement;
    if (!svg) return;
    e.preventDefault();
    e.stopPropagation();
    if ($project.selectedLayerId !== layer.id) project.selectLayer(layer.id);
    if (layer.locked) return;
    const place = placementOf(layer);
    dragSvg = svg;
    if (kind === 'move') {
      const basis = placementBasis(place);
      drag = { kind, layerId: layer.id, from: pointerDir(e, svg), center: basis.center };
    } else {
      drag = { kind, layerId: layer.id };
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  }

  function onMove(e: PointerEvent) {
    if (!drag || !dragSvg) return;
    const dir = pointerDir(e, dragSvg);
    const layer = layerById(drag.layerId);
    if (!layer) return;
    const place = placementOf(layer);
    if (drag.kind === 'move') {
      // Turn the layer's center with the pointer around the dome's center,
      // so the point grabbed stays under the pointer. Its turn is left as
      // set: measured from the zenith, so the top keeps pointing up.
      const center = rotateTowards(drag.center, drag.from, dir);
      const { azimuth, elevation } = azElOf(center);
      commit(drag.layerId, { azimuth, elevation });
    } else {
      const basis = placementBasis(drag.kind === 'roll' ? { ...place, roll: 0 } : place);
      const facing = dot(dir, basis.center);
      if (facing <= 0.05) return;
      const x = dot(dir, basis.across) / facing;
      const y = dot(dir, basis.upward) / facing;
      if (drag.kind === 'size') {
        const halfW = Math.max(Math.abs(x), Math.abs(y) * aspect);
        commit(drag.layerId, { size: Math.max(1, Math.min(170, (2 * Math.atan(halfW) * 180) / Math.PI)) });
      } else {
        commit(drag.layerId, { roll: (Math.atan2(-x, y) * 180) / Math.PI });
      }
    }
  }

  function end() {
    drag = null;
    dragSvg = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
  }

  onDestroy(end);
</script>

<svg
  class="dome-gizmo"
  class:inside
  width={containerWidth}
  height={containerHeight}
  viewBox={`0 0 ${containerWidth} ${containerHeight}`}
  aria-label="Dome placement"
>
  {#if !inside}
    <circle class="rim" cx={rimCenter.x} cy={rimCenter.y} r={rimRadius} />
    <line class="front" x1={frontIn.x} y1={frontIn.y} x2={frontOut.x} y2={frontOut.y} />
    <text class="front-label" x={frontOut.x} y={frontOut.y + 12} text-anchor="middle">Front</text>
  {/if}

  {#each placed as layer (layer.id)}
    {@const place = placementOf(layer)}
    {@const selected = layer.id === selectedId}
    {@const outline = pathThrough(layerQuad(layer), place, true)}
    <path
      class="layer-outline"
      class:selected
      d={outline}
      role="button"
      tabindex="-1"
      aria-label={`Move ${layer.name} on the dome`}
      onpointerdown={(e) => begin(e, layer, 'move')}
    />
    {#if selected}
      {@const frame = pathThrough(FRAME, place, true)}
      {@const top = at({ x: 0.5, y: 1 }, place)}
      {@const knob = at(ROLL_KNOB, place)}
      <path class="spot" d={frame} />
      {#if top && knob}
        <line class="roll-stem" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} />
        <circle
          class="handle roll"
          cx={knob.x}
          cy={knob.y}
          r={handleR}
          role="button"
          tabindex="-1"
          aria-label={`Turn ${layer.name}`}
          onpointerdown={(e) => begin(e, layer, 'roll')}
        />
      {/if}
      {#each FRAME as corner, index (index)}
        {@const p = at(corner, place)}
        {#if p}
          <rect
            class="handle size"
            x={p.x - handleR}
            y={p.y - handleR}
            width={handleR * 2}
            height={handleR * 2}
            role="button"
            tabindex="-1"
            aria-label={`Size ${layer.name}`}
            onpointerdown={(e) => begin(e, layer, 'size')}
          />
        {/if}
      {/each}
      {@const center = at({ x: 0.5, y: 0.5 }, place)}
      {#if center}
        <circle class="center" cx={center.x} cy={center.y} r={handleR * 0.6} />
        <text class="label" x={center.x} y={center.y - handleR - 6} text-anchor="middle">{layer.name}</text>
      {/if}
    {/if}
  {/each}
</svg>

<style>
  .dome-gizmo {
    position: absolute;
    left: 0;
    top: 0;
    overflow: visible;
    pointer-events: none;
    z-index: 12;
  }
  /* The Inside view ends at the canvas; outlines running past it would
     draw over the panels around it. */
  .dome-gizmo.inside { overflow: hidden; }
  .rim {
    fill: none;
    stroke: rgba(255, 255, 255, 0.28);
    stroke-width: 1;
  }
  .front {
    stroke: var(--ga-amber, #ffad2e);
    stroke-width: 2;
  }
  .front-label {
    fill: var(--ga-amber, #ffad2e);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.04em;
  }
  .layer-outline {
    fill: rgba(255, 255, 255, 0.001);
    stroke: rgba(255, 255, 255, 0.55);
    stroke-width: 1;
    pointer-events: visiblePainted;
    cursor: grab;
  }
  .layer-outline.selected {
    stroke: var(--ga-icon, #5278ff);
    stroke-width: 1.5;
  }
  .layer-outline:active { cursor: grabbing; }
  .spot {
    fill: none;
    stroke: var(--ga-icon, #5278ff);
    stroke-width: 1;
    stroke-dasharray: 4 4;
    opacity: 0.6;
  }
  .roll-stem {
    stroke: var(--ga-icon, #5278ff);
    stroke-width: 1;
  }
  .handle {
    fill: #fff;
    stroke: var(--ga-icon, #5278ff);
    stroke-width: 1.5;
    pointer-events: all;
  }
  .handle.size { cursor: nwse-resize; }
  .handle.roll { cursor: grab; }
  .center {
    fill: var(--ga-icon, #5278ff);
  }
  .label {
    fill: #fff;
    font-size: 11px;
    font-weight: 600;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.7);
    stroke-width: 3px;
  }
</style>
