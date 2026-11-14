<script lang="ts">
  /**
   * The mapping canvas over the live preview: outlines, handles and the
   * gestures that edit them. Pinch to zoom (one finger pans when zoomed),
   * drag a point with a loupe above the finger, drag a surface to move it,
   * tap to select. Points snap to other surfaces and the output frame and
   * weld when they land on another surface's corner.
   */
  import { onDestroy } from 'svelte';
  import type { Point, Surface } from '../../../mobile/studio/model';
  import { gridOf, hasCurves, latticeLines, neighbours, resolveTangent, edgePoint, cornerIndices } from '../../../mobile/studio/mapping/meshGrid';
  import { isShape, surfaceOutline, insideSurface } from '../../../mobile/studio/mapping/surfaceShape';
  import { isSmooth, segmentPoint, type PathPoint } from '../../../mobile/studio/mapping/pathGeometry';
  import { snapPoint, snapShift, type SnapTarget } from '../../../mobile/studio/mapping/snapping';
  import { IDENTITY, clampView, pinchView, zoomAt, inPixels, type View } from '../../../mobile/studio/mapping/viewport';
  import { addPathPoint, dragHandle, handlePosition, isWelded, selectionAnchors, selectionBox, selectionCentre, transformSelection, weldAt, withGroups, type Handle } from '../../../mobile/studio/mapping/edit';
  import { drawnPath } from '../../../mobile/studio/mapping/surfaceShape';
  import { addMaskPoint, contentPoint, dragMask, insideMask, maskHandles, maskOutline, tappedPolygon, withMask, type MaskHandle } from '../../../mobile/studio/mapping/maskEdit';
  import { newFreehandMask, newPolygonMask, MAX_MASKS } from '../../../mobile/studio/mapping/masks';
  import { strokeToPath } from '../../../mobile/studio/mapping/pathGeometry';
  import MapIcon from './MapIcon.svelte';

  type Props = {
    surfaces: Surface[];
    selected: number;
    /** Extra surfaces selected with the primary one (indices). */
    selection?: number[];
    point: number;
    snap?: boolean;
    grid?: boolean;
    /** Tap adds to / removes from the selection instead of replacing it. */
    multi?: boolean;
    /** 'view' draws the outlines only and leaves the canvas to another tool (Paint). */
    tool?: 'edit' | 'draw' | 'view';
    /** The live output canvas, zoomed with the overlay. */
    canvas?: HTMLCanvasElement;
    basis?: { width: number; height: number };
    onchange: (surfaces: Surface[]) => void;
    onbegin: () => void;
    oncommit: () => void;
    onselect: (index: number, point: number, selection: number[]) => void;
    ondrawn?: (path: PathPoint[]) => void;
    onnotice?: (message: string) => void;
    /** The mask being edited on the selected surface (-1: none) and its selected point. */
    mask?: number;
    maskPoint?: number;
    /** Making a new mask by tapping its corners or tracing it. */
    maskTool?: 'edit' | 'polygon' | 'freehand';
    onmask?: (mask: number, point: number, tool: 'edit' | 'polygon' | 'freehand') => void;
    /** How many corners of a new polygon mask have been tapped. */
    ontaps?: (count: number) => void;
  };
  let { surfaces, selected, selection = [], point, snap = false, grid = false, multi = false, tool = 'edit', canvas, basis = { width: 1920, height: 1080 }, onchange, onbegin, oncommit, onselect, ondrawn, onnotice, mask = -1, maskPoint = 0, maskTool = 'edit', onmask, ontaps }: Props = $props();

  let root: HTMLDivElement;
  let W = $state(1),
    H = $state(1);
  let view = $state<View>({ ...IDENTITY });
  let snapped = $state<SnapTarget | null>(null);
  let loupe = $state<{ x: number; y: number; at: Point } | null>(null);
  let drawing = $state<Point[]>([]);
  let loupeCanvas = $state<HTMLCanvasElement>();
  let lastHook = 0;

  const HIT = 22;
  const toScreen = (p: Point) => ({ x: view.x + p.x * W * view.scale, y: view.y + p.y * H * view.scale });
  const toNorm = (x: number, y: number): Point => ({ x: (x - view.x) / (W * view.scale), y: (y - view.y) / (H * view.scale) });
  const pts = (list: Point[]) => list.map((p) => { const s = toScreen(p); return `${s.x.toFixed(1)},${s.y.toFixed(1)}`; }).join(' ');

  // ── The zoomed picture ─────────────────────────────────────────────────────
  $effect(() => {
    if (!canvas) return;
    const zoomed = view.scale > 1.001;
    canvas.style.transformOrigin = '0 0';
    canvas.style.transform = zoomed ? `translate(${view.x}px, ${view.y}px) scale(${view.scale})` : '';
    if (canvas.parentElement) canvas.parentElement.style.overflow = zoomed ? 'hidden' : '';
  });
  onDestroy(() => {
    if (canvas) {
      canvas.style.transform = '';
      if (canvas.parentElement) canvas.parentElement.style.overflow = '';
    }
  });
  export function resetView() {
    view = { ...IDENTITY };
  }

  // ── What is on screen ──────────────────────────────────────────────────────
  const current = $derived(surfaces[selected]);
  const chosen = $derived(selection.length > 1 ? withGroups(surfaces, selection) : current ? withGroups(surfaces, [selected]) : []);
  const editable = $derived(!!current && !current.locked && tool === 'edit');
  const editedMask = $derived(current?.masks?.[mask] ?? null);
  /** Corners tapped so far for a new polygon mask (output frame). */
  let taps = $state<Point[]>([]);
  $effect(() => {
    if (maskTool !== 'polygon') taps = [];
  });
  $effect(() => {
    ontaps?.(taps.length);
  });
  const maskCandidates = $derived(current && editedMask && editable && maskTool === 'edit' ? maskHandles(current, editedMask, maskPoint) : []);
  const maskLine = $derived(current && editedMask ? maskOutline(current, editedMask) : null);
  const masksOn = $derived(current?.masks?.length ? current.masks.map((m) => maskOutline(current!, m)) : []);

  type Candidate = { handle: Handle; at: Point; kind: 'point' | 'handle' | 'mid'; weld?: boolean; smooth?: boolean; corner?: boolean };
  /** Every handle the selected surface offers, in output coordinates. */
  const candidates = $derived.by((): Candidate[] => {
    const s = current;
    if (!s || !editable || chosen.length > 1 || editedMask || maskTool !== 'edit') return [];
    const out: Candidate[] = [];
    if (isShape(s)) {
      const path = s.shape!.points;
      path.forEach((p, index) => out.push({ handle: { kind: 'path', index }, at: p, kind: 'point', weld: isWelded(s, p), smooth: isSmooth(p) }));
      for (let i = 0; i < path.length; i++) out.push({ handle: { kind: 'pathMid', index: i }, at: segmentPoint(path, i, 0.5), kind: 'mid' });
      const p = path[point];
      if (p?.in) out.push({ handle: { kind: 'pathHandle', index: point, side: 'in' }, at: { x: p.x + p.in.x, y: p.y + p.in.y }, kind: 'handle' });
      if (p?.out) out.push({ handle: { kind: 'pathHandle', index: point, side: 'out' }, at: { x: p.x + p.out.x, y: p.y + p.out.y }, kind: 'handle' });
      return out;
    }
    const g = gridOf(s);
    const indices = s.mode === 'corners' ? cornerIndices(g) : s.points.map((_, i) => i);
    for (const index of indices) out.push({ handle: { kind: 'point', index }, at: s.points[index], kind: 'point', weld: isWelded(s, s.points[index]), corner: cornerIndices(g).includes(index) });
    if (s.mode === 'mesh' && s.bezier && s.points[point]) {
      const t = resolveTangent(s, point);
      for (const n of neighbours(g, point)) {
        const p = s.points[point];
        out.push({ handle: { kind: 'tangent', index: point, side: n.side }, at: { x: p.x + t[n.side].x, y: p.y + t[n.side].y }, kind: 'handle' });
        const [a, b] = n.index > point ? [point, n.index] : [n.index, point];
        out.push({ handle: { kind: 'bend', a, b }, at: edgePoint(s, a, b, 0.5), kind: 'mid' });
      }
    }
    return out;
  });

  const box = $derived(chosen.length ? selectionBox(surfaces, chosen) : null);
  /** Scale and turn handles around the selection, outside its outline so they never cover a corner. */
  const boxHandles = $derived.by(() => {
    // Several surfaces, or one free shape (many points): turn and scale the whole thing.
    if (!box || tool !== 'edit' || chosen.every((i) => surfaces[i]?.locked)) return null;
    if (chosen.length < 2 && !(current && isShape(current))) return null;
    const a = toScreen({ x: box.x0, y: box.y0 }),
      b = toScreen({ x: box.x1, y: box.y1 });
    const inside = (p: Point) => ({ x: Math.max(12, Math.min(W - 12, p.x)), y: Math.max(12, Math.min(H - 12, p.y)) });
    return { a, b, rotate: inside({ x: (a.x + b.x) / 2, y: a.y - 30 }), scale: inside({ x: b.x + 22, y: b.y + 22 }) };
  });

  // ── Gestures ───────────────────────────────────────────────────────────────
  type Gesture =
    | { kind: 'handle'; id: number; surface: number; handle: Handle; start: Surface[]; offset: Point; moved: boolean; x0: number; y0: number }
    | { kind: 'body'; id: number; indices: number[]; start: Surface[]; x0: number; y0: number; moved: boolean; tap: number }
    | { kind: 'box'; id: number; mode: 'rotate' | 'scale'; indices: number[]; start: Surface[]; centre: Point; x0: number; y0: number; moved: boolean }
    | { kind: 'pan'; id: number; x0: number; y0: number; view0: View; moved: boolean; tap: number }
    | { kind: 'pinch'; from: { x: number; y: number; spread: number }; view0: View }
    | { kind: 'draw'; id: number }
    | { kind: 'mask'; id: number; handle: MaskHandle; start: Surface[]; from: Point; offset: Point; moved: boolean; x0: number; y0: number }
    | { kind: 'maskTap'; id: number; x0: number; y0: number; moved: boolean }
    | null;
  let gesture: Gesture = null;
  const fingers = new Map<number, { x: number; y: number }>();
  let lastTap = { x: -100, y: -100, at: 0 };

  function local(e: PointerEvent) {
    const r = root.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function nearest(x: number, y: number): Candidate | null {
    let best: Candidate | null = null,
      d = HIT;
    for (const c of candidates) {
      const s = toScreen(c.at);
      // Points win a near tie over the handles and midpoints drawn on top of them.
      const dist = Math.hypot(s.x - x, s.y - y) + (c.kind === 'point' ? 0 : 3);
      if (dist <= d) {
        d = dist;
        best = c;
      }
    }
    return best;
  }
  function surfacesAt(p: Point): number[] {
    const hits: number[] = [];
    for (let i = surfaces.length - 1; i >= 0; i--) if (surfaces[i].enabled !== false || i === selected) if (insideSurface(surfaces[i], p)) hits.push(i);
    return hits;
  }
  function spread() {
    const [a, b] = [...fingers.values()];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, spread: Math.hypot(a.x - b.x, a.y - b.y) };
  }
  function finish(commit: boolean) {
    if (commit) oncommit();
    gesture = null;
    loupe = null;
    snapped = null;
  }

  function down(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button')) return;
    const at = local(e);
    // The first finger of a new touch: forget any finger whose lift never reached us.
    if (e.isPrimary) fingers.clear();
    fingers.set(e.pointerId, at);
    try {
      root.setPointerCapture(e.pointerId);
    } catch {
      /* A pointer the browser no longer tracks cannot be captured; its moves still arrive here. */
    }
    e.preventDefault();
    if (fingers.size === 2) {
      // A second finger always zooms: whatever the first one did is kept.
      const moved = gesture && 'moved' in gesture && gesture.moved;
      if (gesture?.kind === 'handle' && moved && snapped?.kind === 'corner') welded(gesture);
      if (gesture && gesture.kind !== 'pinch') finish(!!moved);
      drawing = [];
      gesture = { kind: 'pinch', from: spread(), view0: { ...view } };
      return;
    }
    if (fingers.size > 2) return;
    if (tool === 'draw' || (editable && maskTool === 'freehand')) {
      drawing = [toNorm(at.x, at.y)];
      gesture = { kind: 'draw', id: e.pointerId };
      return;
    }
    const p = toNorm(at.x, at.y);
    if (editable && maskTool === 'polygon') {
      gesture = { kind: 'maskTap', id: e.pointerId, x0: at.x, y0: at.y, moved: false };
      return;
    }
    if (editedMask && editable && current) {
      let best: (typeof maskCandidates)[number] | null = null,
        d = HIT;
      for (const c of maskCandidates) {
        const q = toScreen(c.at);
        const dist = Math.hypot(q.x - at.x, q.y - at.y) + (c.role === 'point' ? 0 : 3);
        if (dist <= d) {
          d = dist;
          best = c;
        }
      }
      const handle: MaskHandle | null = best ? best.handle : insideMask(current, editedMask, p) ? { kind: 'mbody' } : null;
      if (handle) {
        if (handle.kind === 'mpoint' && handle.index !== maskPoint) onmask?.(mask, handle.index, 'edit');
        const q = best ? toScreen(best.at) : at;
        gesture = { kind: 'mask', id: e.pointerId, handle, start: surfaces, from: contentPoint(current, p) ?? p, offset: { x: at.x - q.x, y: at.y - q.y }, moved: false, x0: at.x, y0: at.y };
        if (best?.role === 'point') loupe = { x: e.clientX, y: e.clientY, at: best.at };
        return;
      }
    }
    if (boxHandles && !multi) {
      for (const mode of ['rotate', 'scale'] as const) {
        const h = boxHandles[mode];
        if (Math.hypot(h.x - at.x, h.y - at.y) <= HIT) {
          gesture = { kind: 'box', id: e.pointerId, mode, indices: chosen.filter((i) => !surfaces[i].locked), start: surfaces, centre: selectionCentre(surfaces, chosen), x0: at.x, y0: at.y, moved: false };
          return;
        }
      }
    }
    const hit = multi ? null : nearest(at.x, at.y);
    if (hit) {
      const s = toScreen(hit.at);
      const index = hit.handle.kind === 'point' || hit.handle.kind === 'path' ? hit.handle.index : point;
      if (index !== point) onselect(selected, index, selection);
      gesture = { kind: 'handle', id: e.pointerId, surface: selected, handle: hit.handle, start: surfaces, offset: { x: at.x - s.x, y: at.y - s.y }, moved: false, x0: at.x, y0: at.y };
      if (hit.kind === 'point') loupe = { x: e.clientX, y: e.clientY, at: hit.at };
      return;
    }
    const hits = surfacesAt(p);
    const onSelection = hits.find((i) => chosen.includes(i));
    if (!multi && onSelection !== undefined && !surfaces[onSelection].locked) {
      gesture = { kind: 'body', id: e.pointerId, indices: chosen.filter((i) => !surfaces[i].locked), start: surfaces, x0: at.x, y0: at.y, moved: false, tap: performance.now() };
      return;
    }
    gesture = { kind: 'pan', id: e.pointerId, x0: at.x, y0: at.y, view0: { ...view }, moved: false, tap: performance.now() };
  }

  function move(e: PointerEvent) {
    if (!fingers.has(e.pointerId)) return;
    const at = local(e);
    fingers.set(e.pointerId, at);
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (fingers.size < 2) return;
      view = pinchView(g.view0, g.from, spread(), W, H);
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === 'draw') {
      const p = toNorm(at.x, at.y);
      const last = drawing[drawing.length - 1];
      if (!last || Math.hypot((p.x - last.x) * W * view.scale, (p.y - last.y) * H * view.scale) > 2) drawing = [...drawing, p];
      return;
    }
    const dx = at.x - g.x0,
      dy = at.y - g.y0;
    if (!g.moved) {
      const slop = g.kind === 'handle' ? 2 : 6;
      if (Math.hypot(dx, dy) < slop) return;
      g.moved = true;
      if (g.kind !== 'pan') onbegin();
    }
    const scaleX = W * view.scale,
      scaleY = H * view.scale;
    if (g.kind === 'pan') {
      view = clampView({ scale: view.scale, x: g.view0.x + dx, y: g.view0.y + dy }, W, H);
      return;
    }
    if (g.kind === 'handle') {
      let target = toNorm(at.x - g.offset.x, at.y - g.offset.y);
      const pointLike = g.handle.kind === 'point' || g.handle.kind === 'path';
      snapped = null;
      if (snap && pointLike) {
        const hit = snapPoint(target, g.start, (i) => i === g.surface, { width: scaleX, height: scaleY, grid });
        target = hit.point;
        snapped = hit.target;
      }
      onchange(dragHandle(g.start, g.surface, g.handle, target, e.altKey));
      if (pointLike) loupe = { x: e.clientX - g.offset.x, y: e.clientY - g.offset.y, at: target };
      drawLoupeLines();
      return;
    }
    if (g.kind === 'maskTap') return;
    if (g.kind === 'mask') {
      const s = g.start[selected];
      const m = s?.masks?.[mask];
      if (!s || !m) return;
      const target = toNorm(at.x - g.offset.x, at.y - g.offset.y);
      const uv = contentPoint(s, target);
      if (!uv) return;
      onchange(withMask(g.start, selected, mask, dragMask(m, g.handle, uv, g.from)));
      if (g.handle.kind === 'mpoint' || g.handle.kind === 'ecentre') loupe = { x: e.clientX - g.offset.x, y: e.clientY - g.offset.y, at: target };
      drawLoupeLines();
      return;
    }
    if (g.kind === 'body') {
      let mx = dx / scaleX,
        my = dy / scaleY;
      snapped = null;
      if (snap) {
        const anchors = selectionAnchors(g.start, g.indices).map((p) => ({ x: p.x + mx, y: p.y + my }));
        const hit = snapShift(anchors, g.start, (i) => g.indices.includes(i), { width: scaleX, height: scaleY, grid });
        mx += hit.dx;
        my += hit.dy;
        snapped = hit.target;
      }
      onchange(transformSelection(g.start, g.indices, { dx: mx, dy: my }));
      return;
    }
    if (g.kind === 'box') {
      const c = toScreen(g.centre);
      if (g.mode === 'scale') {
        const k = Math.max(0.05, Math.hypot(at.x - c.x, at.y - c.y) / Math.max(1, Math.hypot(g.x0 - c.x, g.y0 - c.y)));
        onchange(transformSelection(g.start, g.indices, { scale: k, centre: g.centre }, (W * view.scale) / (H * view.scale)));
      } else {
        let a = Math.atan2(at.y - c.y, at.x - c.x) - Math.atan2(g.y0 - c.y, g.x0 - c.x);
        // Settle on whole 15° steps when close to one.
        const step = Math.PI / 12,
          near = Math.round(a / step) * step;
        if (Math.abs(a - near) < 0.03) a = near;
        onchange(transformSelection(g.start, g.indices, { angle: a, centre: g.centre }, W / H));
      }
    }
  }

  function welded(g: Extract<Gesture, { kind: 'handle' }>) {
    if (!snapped || snapped.kind !== 'corner') return;
    const next = weldAt(surfaces, g.surface, snapped.at);
    if (next !== surfaces) {
      onchange(next);
      onnotice?.('Welded: the shared corner now moves both surfaces.');
    }
  }

  function up(e: PointerEvent) {
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.kind === 'pinch') {
      if (fingers.size === 0) gesture = null;
      return;
    }
    if (g.id !== e.pointerId) return;
    if (g.kind === 'draw') {
      if (maskTool === 'freehand' && current) {
        const uv = drawing.map((q) => contentPoint(current!, q)).filter((q): q is Point => !!q);
        const r = box ? { w: (box.x1 - box.x0) * W, h: (box.y1 - box.y0) * H } : { w: W, h: H };
        const path = strokeToPath(uv, Math.max(40, r.w), Math.max(40, r.h), 3, 48);
        drawing = [];
        gesture = null;
        if (path.length >= 3) addMask(newFreehandMask(path, `Freehand ${(current.masks?.length ?? 0) + 1}`));
        else onnotice?.('Trace a closed outline over the surface, a little bigger.');
        return;
      }
      const path = drawnPath(drawing, W, H);
      drawing = [];
      gesture = null;
      if (path.length) ondrawn?.(path);
      else onnotice?.('Draw a closed outline with one finger, a little bigger.');
      return;
    }
    if (g.kind === 'maskTap') {
      gesture = null;
      const at = local(e);
      if (Math.hypot(at.x - g.x0, at.y - g.y0) > 10) return;
      const first = taps[0] ? toScreen(taps[0]) : null;
      // Tapping the first corner again closes the polygon.
      if (first && taps.length >= 3 && Math.hypot(first.x - at.x, first.y - at.y) <= HIT) finishPolygon();
      else taps = [...taps, toNorm(at.x, at.y)];
      return;
    }
    if (g.kind === 'mask') {
      if (!g.moved && g.handle.kind === 'mmid' && current?.masks?.[mask]) {
        onbegin();
        onchange(withMask(surfaces, selected, mask, addMaskPoint(current.masks[mask], g.handle.index)));
        onmask?.(mask, g.handle.index + 1, 'edit');
        oncommit();
      }
      finish(g.moved);
      return;
    }
    if (g.kind === 'handle') {
      if (g.moved && snapped?.kind === 'corner' && (g.handle.kind === 'point' || g.handle.kind === 'path')) welded(g);
      if (!g.moved && g.handle.kind === 'pathMid') {
        onbegin();
        const added = addPathPoint(surfaces, g.surface, g.handle.index);
        if (added.point >= 0) {
          onchange(added.surfaces);
          onselect(selected, added.point, selection);
          oncommit();
        }
      }
      finish(g.moved);
      return;
    }
    if (g.kind === 'body' || g.kind === 'box') {
      finish(g.moved);
      if (g.kind === 'body' && !g.moved) tap(e, local(e));
      return;
    }
    if (g.kind === 'pan') {
      gesture = null;
      if (!g.moved) tap(e, local(e));
    }
  }

  function addMask(m: import('../../../mobile/studio/mapping/masks').SurfaceMask) {
    if (!current) return;
    if ((current.masks?.length ?? 0) >= MAX_MASKS) {
      onnotice?.(`A surface holds up to ${MAX_MASKS} masks.`);
      return;
    }
    onbegin();
    const masks = [...(current.masks ?? []), m];
    onchange(surfaces.map((s, i) => (i === selected ? { ...s, masks } : s)));
    oncommit();
    onmask?.(masks.length - 1, 0, 'edit');
  }
  export function finishPolygon() {
    if (!current || taps.length < 3) return;
    const points = tappedPolygon(current, taps);
    taps = [];
    if (points.length >= 3) addMask(newPolygonMask(points, `Polygon ${(current.masks?.length ?? 0) + 1}`));
  }
  function tap(e: PointerEvent, at: { x: number; y: number }) {
    const p = toNorm(at.x, at.y);
    if (editedMask) {
      onmask?.(-1, 0, 'edit');
      return;
    }
    const hits = surfacesAt(p);
    const now = performance.now();
    const repeated = now - lastTap.at < 450 && Math.hypot(at.x - lastTap.x, at.y - lastTap.y) < 14;
    lastTap = { x: at.x, y: at.y, at: now };
    if (!hits.length) {
      // Double tap on empty canvas zooms in there, or back out.
      if (repeated) view = view.scale > 1.5 ? { ...IDENTITY } : zoomAt(view, 3, at, W, H);
      else if (selection.length > 1 && !multi) onselect(selected, point, []);
      return;
    }
    if (multi) {
      const i = hits[0];
      const next = selection.length ? [...selection] : [selected];
      const at2 = next.indexOf(i);
      if (at2 >= 0 && next.length > 1) next.splice(at2, 1);
      else if (at2 < 0) next.push(i);
      onselect(next.includes(selected) ? selected : next[0], 0, next);
      return;
    }
    // Tapping the same spot again steps through surfaces stacked under it.
    const index = repeated && hits.length > 1 ? hits[(hits.indexOf(selected) + 1) % hits.length] : hits.includes(selected) && !repeated ? selected : hits[0];
    if (index !== selected || selection.length > 1) onselect(index, 0, []);
  }

  // ── Loupe ──────────────────────────────────────────────────────────────────
  const LOUPE = 116,
    MAG = 3;
  const loupePos = $derived.by(() => {
    if (!loupe) return null;
    const above = loupe.y - LOUPE / 2 - 76;
    const y = above - LOUPE / 2 < 8 ? loupe.y + 76 + LOUPE / 2 : above;
    const x = Math.max(LOUPE / 2 + 6, Math.min((typeof window === 'undefined' ? 400 : window.innerWidth) - LOUPE / 2 - 6, loupe.x));
    return { x, y };
  });
  const readout = $derived(loupe ? inPixels(loupe.at, basis) : null);

  /** Called by the engine right after each frame is drawn, while the output canvas still holds it. */
  export function loupeFrame(source: HTMLCanvasElement) {
    if (!loupe || !loupeCanvas) return;
    lastHook = performance.now();
    drawLoupe(source);
  }
  function drawLoupeLines() {
    if (performance.now() - lastHook > 150) drawLoupe(null);
  }
  function drawLoupe(source: HTMLCanvasElement | null) {
    const c = loupeCanvas;
    if (!c || !loupe) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== LOUPE * dpr) {
      c.width = LOUPE * dpr;
      c.height = LOUPE * dpr;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const k = MAG * view.scale; // loupe pixels per canvas-on-screen pixel at zoom 1
    const span = LOUPE / (k * W); // normalised width shown
    const spanY = LOUPE / (k * H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    if (source && source.width > 1) {
      try {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, (loupe.at.x - span / 2) * source.width, (loupe.at.y - spanY / 2) * source.height, span * source.width, spanY * source.height, 0, 0, LOUPE, LOUPE);
      } catch {
        /* A frame that cannot be read leaves the lines on black. */
      }
    }
    const to = (p: Point) => ({ x: ((p.x - loupe!.at.x) / span + 0.5) * LOUPE, y: ((p.y - loupe!.at.y) / spanY + 0.5) * LOUPE });
    ctx.lineWidth = 1;
    surfaces.forEach((s, i) => {
      if (s.enabled === false && i !== selected) return;
      const ring = surfaceOutline(s, 24).map(to);
      ctx.strokeStyle = i === selected ? '#bcd3ff' : 'rgba(140,170,255,.75)';
      ctx.beginPath();
      ring.forEach((q, j) => (j ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
      ctx.closePath();
      ctx.stroke();
    });
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2, LOUPE / 2 - 14);
    ctx.lineTo(LOUPE / 2, LOUPE / 2 - 4);
    ctx.moveTo(LOUPE / 2, LOUPE / 2 + 4);
    ctx.lineTo(LOUPE / 2, LOUPE / 2 + 14);
    ctx.moveTo(LOUPE / 2 - 14, LOUPE / 2);
    ctx.lineTo(LOUPE / 2 - 4, LOUPE / 2);
    ctx.moveTo(LOUPE / 2 + 4, LOUPE / 2);
    ctx.lineTo(LOUPE / 2 + 14, LOUPE / 2);
    ctx.stroke();
    ctx.strokeStyle = snapped ? '#91f0d0' : '#ffd36b';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(LOUPE / 2, LOUPE / 2, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  $effect(() => {
    if (loupe && loupeCanvas) drawLoupeLines();
  });

  // ── Lines ──────────────────────────────────────────────────────────────────
  const outlines = $derived(surfaces.map((s) => surfaceOutline(s, 14)));
  const meshLines = $derived(current && current.mode === 'mesh' ? latticeLines(current, 10) : []);
  const gridLines = $derived.by(() => {
    if (!grid) return [];
    const out: [Point, Point][] = [];
    for (let i = 1; i < 16; i++) out.push([{ x: i / 16, y: 0 }, { x: i / 16, y: 1 }]);
    for (let i = 1; i < 9; i++) out.push([{ x: 0, y: i / 9 }, { x: 1, y: i / 9 }]);
    return out;
  });
  const frameRect = $derived.by(() => {
    const a = toScreen({ x: 0, y: 0 }),
      b = toScreen({ x: 1, y: 1 });
    return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
  });
  const selectedHandle = $derived.by(() => {
    if (!current) return null;
    const at = isShape(current) ? current.shape!.points[point] : current.points[point];
    return at ? toScreen(at) : null;
  });
</script>

<div
  class="mapping-canvas"
  class:drawing={tool === 'draw'}
  class:passive={tool === 'view'}
  bind:this={root}
  bind:clientWidth={W}
  bind:clientHeight={H}
  role="application"
  aria-label="Mapping canvas. Drag points to fit your surfaces; pinch to zoom."
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
>
  <svg class="lines" viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
    {#if view.scale > 1.001}<rect class="frame" x={frameRect.x} y={frameRect.y} width={frameRect.w} height={frameRect.h} />{/if}
    {#each gridLines as [a, b]}<line class="guide" x1={toScreen(a).x} y1={toScreen(a).y} x2={toScreen(b).x} y2={toScreen(b).y} />{/each}
    {#each surfaces as s, i (s.id)}
      <polygon points={pts(outlines[i] ?? [])} class:chosen={i === selected} class:picked={chosen.includes(i) && i !== selected} class:dim={s.enabled === false} class:locked={s.locked} />
      {#if outlines[i]?.length}{@const label = toScreen(outlines[i][0])}<text x={label.x + 8} y={label.y + 18}>{i + 1} · {s.name}{s.locked ? ' · locked' : ''}</text>{/if}
    {/each}
    {#each meshLines as line}<polyline class="mesh" points={pts(line)} />{/each}
    {#if snapped && (snapped.kind === 'edge' || snapped.kind === 'frame')}<line class="snap" x1={toScreen(snapped.from).x} y1={toScreen(snapped.from).y} x2={toScreen(snapped.to).x} y2={toScreen(snapped.to).y} />{/if}
    {#if snapped}<circle class="snap" cx={toScreen(snapped.at).x} cy={toScreen(snapped.at).y} r="11" />{/if}
    {#if boxHandles && chosen.length}
      <rect class="box" x={boxHandles.a.x} y={boxHandles.a.y} width={Math.max(0, boxHandles.b.x - boxHandles.a.x)} height={Math.max(0, boxHandles.b.y - boxHandles.a.y)} />
      <line class="box" x1={boxHandles.rotate.x} y1={boxHandles.rotate.y} x2={boxHandles.rotate.x} y2={boxHandles.a.y} />
      <circle class="rotate" cx={boxHandles.rotate.x} cy={boxHandles.rotate.y} r="8" />
      <rect class="scale" x={boxHandles.scale.x - 7} y={boxHandles.scale.y - 7} width="14" height="14" rx="2" />
    {/if}
    {#if candidates.length}
      {#each candidates as c}
        {@const s = toScreen(c.at)}
        {#if c.kind === 'handle'}
          {#if selectedHandle}<line class="tangent" x1={selectedHandle.x} y1={selectedHandle.y} x2={s.x} y2={s.y} />{/if}
          <circle class="tangent-tip" cx={s.x} cy={s.y} r="5.5" />
        {:else if c.kind === 'mid'}
          {#if c.handle.kind === 'pathMid'}<g class="add-point"><circle cx={s.x} cy={s.y} r="7" /><path d={`M${s.x - 3.5} ${s.y}h7M${s.x} ${s.y - 3.5}v7`} /></g>{:else}<rect class="bend" x={s.x - 5} y={s.y - 5} width="10" height="10" rx="2" />{/if}
        {:else}
          {@const on = (c.handle.kind === 'point' || c.handle.kind === 'path') && c.handle.index === point}
          {#if c.weld}<circle class="weld" cx={s.x} cy={s.y} r={on ? 14 : 12} />{/if}
          {#if c.handle.kind === 'path' && !c.smooth}<rect class="handle" class:on x={s.x - (on ? 8 : 6.5)} y={s.y - (on ? 8 : 6.5)} width={on ? 16 : 13} height={on ? 16 : 13} rx="2" />{:else}<circle class="handle" class:on class:inner={!c.corner && c.handle.kind === 'point'} cx={s.x} cy={s.y} r={on ? 8.5 : c.corner || c.handle.kind === 'path' ? 7 : 5.5} />{/if}
        {/if}
      {/each}
    {/if}
    {#if tool === 'edit' && masksOn.length}
      {#each masksOn as line, i}<polygon class="mask-line" class:edit={i === mask} class:off={current?.masks?.[i]?.enabled === false} points={pts(line)} />{/each}
    {/if}
    {#each maskCandidates as c}
      {@const q = toScreen(c.at)}
      {#if c.role === 'mid'}<g class="add-point"><circle cx={q.x} cy={q.y} r="7" /><path d={`M${q.x - 3.5} ${q.y}h7M${q.x} ${q.y - 3.5}v7`} /></g>
      {:else if c.role === 'handle'}<circle class="tangent-tip" cx={q.x} cy={q.y} r="6" />
      {:else}<circle class="mask-point" class:on={c.handle.kind === 'mpoint' && c.handle.index === maskPoint} cx={q.x} cy={q.y} r={c.handle.kind === 'ecentre' ? 7 : 6} />{/if}
    {/each}
    {#if taps.length}
      <polyline class="ink" points={pts(taps)} />
      {#each taps as t, i}<circle class="mask-point" class:on={i === 0} cx={toScreen(t).x} cy={toScreen(t).y} r="6" />{/each}
    {/if}
    {#if drawing.length > 1}<polyline class="ink" points={pts(drawing)} />{/if}
  </svg>
  {#if tool === 'draw'}<div class="draw-hint" role="status">Trace the outline with one finger</div>{/if}
  {#if tool === 'edit' && maskTool === 'polygon'}<div class="draw-hint" role="status">Tap the corners of the mask</div>{/if}
  {#if tool === 'edit' && maskTool === 'freehand'}<div class="draw-hint" role="status">Trace the mask with one finger</div>{/if}
  {#if view.scale > 1.001}<button class="zoom-chip" onclick={resetView} aria-label={`Zoom ${view.scale.toFixed(1)} times. Tap to fit the whole output.`}><MapIcon name="fit" size={15} />{view.scale.toFixed(1)}×</button>{/if}
  {#if loupe && loupePos}
    <div class="loupe" style:left={`${loupePos.x}px`} style:top={`${loupePos.y}px`} aria-hidden="true">
      <canvas bind:this={loupeCanvas} style:width={`${LOUPE}px`} style:height={`${LOUPE}px`}></canvas>
      {#if readout}<span>{readout.x.toFixed(1)}, {readout.y.toFixed(1)} px</span>{/if}
    </div>
  {/if}
</div>

<style>
  .mapping-canvas {
    position: absolute;
    inset: 0;
    z-index: 2;
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .passive {
    pointer-events: none;
  }
  .lines {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;
    pointer-events: none;
  }
  polygon {
    fill: none;
    stroke: var(--ga-blue-300, #7fa6ff);
    stroke-width: 1;
    stroke-dasharray: 6 5;
  }
  polygon.chosen {
    stroke: var(--ga-blue-200, #bcd3ff);
    stroke-width: 2;
    stroke-dasharray: none;
  }
  polygon.picked {
    stroke: #91f0d0;
    stroke-width: 1.5;
    stroke-dasharray: none;
  }
  polygon.dim {
    opacity: 0.35;
  }
  polygon.locked.chosen {
    stroke: #ffc570;
  }
  text {
    font-size: 12px;
    font-family: inherit;
    fill: #e3edff;
    paint-order: stroke;
    stroke: #07101b;
    stroke-width: 3px;
  }
  .frame {
    fill: none;
    stroke: #ffffff55;
    stroke-width: 1;
  }
  .guide {
    stroke: var(--ga-blue-200, #bcd3ff);
    stroke-opacity: 0.35;
    stroke-width: 1;
  }
  .mesh {
    fill: none;
    stroke: var(--ga-blue-300, #7fa6ff);
    stroke-opacity: 0.7;
    stroke-width: 1;
  }
  .handle {
    fill: var(--ga-blue-400, #4f7dff);
    stroke: #e4f0ff;
    stroke-width: 2;
  }
  .handle.inner {
    fill: #0b1a33;
  }
  .handle.on {
    fill: #91f0d0;
    stroke: #fff;
  }
  .weld {
    fill: none;
    stroke: #ffd36b;
    stroke-width: 2;
  }
  .tangent {
    stroke: #ffd36b;
    stroke-width: 1.5;
  }
  .tangent-tip {
    fill: #ffd36b;
    stroke: #07101b;
    stroke-width: 1.5;
  }
  .bend {
    fill: #07101bcc;
    stroke: #ffd36b;
    stroke-width: 1.5;
  }
  .add-point circle {
    fill: #07101bcc;
    stroke: #91f0d0;
    stroke-width: 1.5;
  }
  .add-point path {
    stroke: #91f0d0;
    stroke-width: 1.6;
  }
  .mask-line {
    fill: #ff6bd51a;
    stroke: #ff8be0;
    stroke-width: 1.2;
    stroke-dasharray: 4 4;
  }
  .mask-line.edit {
    fill: #ff6bd526;
    stroke-width: 2;
    stroke-dasharray: none;
  }
  .mask-line.off {
    opacity: 0.35;
  }
  .mask-point {
    fill: #ff8be0;
    stroke: #fff;
    stroke-width: 1.5;
  }
  .mask-point.on {
    fill: #91f0d0;
  }
  .snap {
    fill: none;
    stroke: #91f0d0;
    stroke-width: 2;
  }
  .box {
    fill: none;
    stroke: #91f0d088;
    stroke-width: 1;
    stroke-dasharray: 3 4;
  }
  .rotate,
  .scale {
    fill: #07101b;
    stroke: #91f0d0;
    stroke-width: 2;
  }
  .ink {
    fill: none;
    stroke: #91f0d0;
    stroke-width: 3;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .draw-hint {
    position: absolute;
    left: 8px;
    top: 8px;
    padding: 4px 8px;
    border-radius: 6px;
    background: #07101bcc;
    color: #e3edff;
    font-size: 12px;
    pointer-events: none;
  }
  .zoom-chip {
    position: absolute;
    right: 6px;
    top: 6px;
    display: flex;
    align-items: center;
    gap: 4px;
    min-width: 44px;
    min-height: 44px;
    padding: 0 10px;
    border-radius: 22px;
    border: 1px solid #ffffff33;
    background: #07101bdd;
    color: #e3edff;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .loupe {
    position: fixed;
    z-index: 50;
    transform: translate(-50%, -50%);
    pointer-events: none;
    display: grid;
    justify-items: center;
    gap: 4px;
  }
  .loupe canvas {
    border-radius: 50%;
    border: 2px solid #e4f0ff;
    box-shadow: 0 6px 24px #000a, 0 0 0 4px #07101b88;
    background: #000;
  }
  .loupe span {
    padding: 2px 8px;
    border-radius: 10px;
    background: #07101bdd;
    color: #e3edff;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
</style>
