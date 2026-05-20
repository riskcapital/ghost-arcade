<script lang="ts">
  /**
   * Stage Designer workspace — Phase 1 implementation.
   *
   * A fullscreen overlay (mirrors VJModePanel's z=999 positioning)
   * where the user designs the projection geometry: imports SVG /
   * pre-made shapes, edits polygon slices, and prepares the surface
   * for slice→content binding (Phase 3) + stage effects (Phase 4).
   *
   * THIS phase is metadata-only:
   *  - SVG import → slices list
   *  - Pan/zoom design canvas with polygon overlays
   *  - Click-to-select, drag-to-move
   *  - Slice list (rename, visibility, lock, delete)
   *  - Pen tool to draw new polygons
   *  - Premade shape drag
   *
   * No render integration: slices don't yet feed the engine. Phase 2
   * adds real-geometry rendering; Phase 3 wires slice→output.
   */

  import { onMount, onDestroy } from 'svelte';
  import { workspace } from '../stores/workspace';
  import {
    surfaceStore,
    activeSurface,
    activeSurfaceSlices,
    selectedSlice,
    parseSurfaceSVG,
  } from '../stores/surface';
  import type { Point2D, SurfaceSlice } from '../types';

  // ── Canvas pan/zoom state ─────────────────────────────────
  // Mirrors the App.svelte viewport pattern: pan + zoom on a wrapper
  // div so SVG overlays stay in sync with the canvas-space content.
  let canvasEl: HTMLDivElement;
  let zoom = 0.5;
  let panX = 0;
  let panY = 0;
  let isPanning = false;
  let panStart = { x: 0, y: 0, px: 0, py: 0 };

  // ── Tool state ────────────────────────────────────────────
  type Tool = 'select' | 'pen';
  let tool: Tool = 'select';

  // Pen-tool in-flight polygon points. First click starts a draft;
  // each subsequent click adds a vertex; clicking near the first
  // vertex (or pressing Enter) closes the polygon and commits a slice.
  let penDraft: Point2D[] | null = null;
  /** Live cursor position in surface coords — used to render a
   *  preview segment from the last placed vertex to the cursor while
   *  the user is mid-draw. */
  let penCursor: Point2D | null = null;

  // ── File input for SVG import ─────────────────────────────
  let fileInput: HTMLInputElement;
  function triggerFilePicker() { fileInput?.click(); }
  function handleFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      if (!surfaceStore.importSVG(text)) {
        alert('No polygons could be extracted from that SVG.');
      }
    };
    reader.readAsText(f);
    // Reset so the same file can be reselected after a parse failure.
    (e.target as HTMLInputElement).value = '';
  }

  // ── Coordinate transforms ─────────────────────────────────
  // screen <-> surface (the surface's intrinsic width/height). All
  // polygon storage is in surface coords; we apply zoom + pan only at
  // the wrapper transform layer.
  function screenToSurface(clientX: number, clientY: number): Point2D | null {
    if (!canvasEl || !$activeSurface) return null;
    const rect = canvasEl.getBoundingClientRect();
    // canvas-local px coords (pre-zoom/pan):
    const localX = (clientX - rect.left - panX) / zoom;
    const localY = (clientY - rect.top - panY) / zoom;
    return { x: localX, y: localY };
  }

  // ── Panning ──────────────────────────────────────────────
  function onCanvasMouseDown(e: MouseEvent) {
    // Middle button OR space+left = pan. Right-click = context menu (TODO).
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isPanning = true;
      panStart = { x: e.clientX, y: e.clientY, px: panX, py: panY };
      e.preventDefault();
      return;
    }
    // Pen tool: place a vertex.
    if (tool === 'pen' && e.button === 0) {
      const pt = screenToSurface(e.clientX, e.clientY);
      if (!pt) return;
      if (!penDraft) {
        penDraft = [pt];
      } else {
        // Click near the first vertex (within 12px in surface units
        // at current zoom) closes the polygon.
        const first = penDraft[0];
        const closeDistSurface = 12 / zoom;
        const dx = first.x - pt.x, dy = first.y - pt.y;
        if (penDraft.length >= 3 && Math.hypot(dx, dy) < closeDistSurface) {
          surfaceStore.addSlice(penDraft);
          penDraft = null;
          penCursor = null;
        } else {
          penDraft = [...penDraft, pt];
        }
      }
      return;
    }
    // Select tool: click empty canvas → clear selection.
    if (tool === 'select' && e.button === 0 && e.target === canvasEl) {
      surfaceStore.selectSlice(null);
    }
  }
  function onWindowMouseMove(e: MouseEvent) {
    if (isPanning) {
      panX = panStart.px + (e.clientX - panStart.x);
      panY = panStart.py + (e.clientY - panStart.y);
      return;
    }
    if (tool === 'pen' && penDraft) {
      penCursor = screenToSurface(e.clientX, e.clientY);
    }
  }
  function onWindowMouseUp(_e: MouseEvent) {
    isPanning = false;
  }
  function onCanvasWheel(e: WheelEvent) {
    if (!canvasEl) return;
    e.preventDefault();
    const rect = canvasEl.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const oldZoom = zoom;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const next = Math.max(0.1, Math.min(8, oldZoom * factor));
    // Anchor zoom on the cursor — adjust pan so the surface point
    // under the cursor stays put across the zoom change.
    const scaleDelta = next / oldZoom;
    panX = cx - (cx - panX) * scaleDelta;
    panY = cy - (cy - panY) * scaleDelta;
    zoom = next;
  }

  // ── Keyboard ──────────────────────────────────────────────
  function onWindowKeyDown(e: KeyboardEvent) {
    if (!$activeSurface) return;
    // Ignore when typing in an input.
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      return;
    }
    if (e.key === 'Escape') {
      if (penDraft) { penDraft = null; penCursor = null; e.preventDefault(); return; }
      workspace.closeAll();
      return;
    }
    if (e.key === 'Enter' && tool === 'pen' && penDraft && penDraft.length >= 3) {
      surfaceStore.addSlice(penDraft);
      penDraft = null;
      penCursor = null;
      e.preventDefault();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && $selectedSlice) {
      surfaceStore.deleteSlice($selectedSlice.id);
      e.preventDefault();
      return;
    }
    if (e.key === 'v' || e.key === 'V') { tool = 'select'; return; }
    if (e.key === 'p' || e.key === 'P') { tool = 'pen'; return; }
  }

  // ── Slice interactions ────────────────────────────────────
  function onSliceClick(slice: SurfaceSlice, e: MouseEvent) {
    e.stopPropagation();
    surfaceStore.selectSlice(slice.id);
  }

  // ── Helpers ──────────────────────────────────────────────
  function polygonToPath(pts: Point2D[]): string {
    if (pts.length === 0) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
    d += ' Z';
    return d;
  }

  // ── Premade shape builder ─────────────────────────────────
  // Drops a shape centered in the visible viewport.
  function viewportCenter(): Point2D {
    if (!canvasEl || !$activeSurface) return { x: 200, y: 200 };
    const rect = canvasEl.getBoundingClientRect();
    return screenToSurface(rect.left + rect.width / 2, rect.top + rect.height / 2) ?? { x: 200, y: 200 };
  }
  function addPremade(kind: 'rect' | 'circle' | 'triangle' | 'star' | 'hex') {
    const c = viewportCenter();
    const r = 120;
    let pts: Point2D[] = [];
    if (kind === 'rect') {
      pts = [
        { x: c.x - r, y: c.y - r * 0.7 },
        { x: c.x + r, y: c.y - r * 0.7 },
        { x: c.x + r, y: c.y + r * 0.7 },
        { x: c.x - r, y: c.y + r * 0.7 },
      ];
    } else if (kind === 'circle') {
      const N = 48;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2;
        pts.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
      }
    } else if (kind === 'triangle') {
      pts = [
        { x: c.x, y: c.y - r },
        { x: c.x + r * 0.866, y: c.y + r * 0.5 },
        { x: c.x - r * 0.866, y: c.y + r * 0.5 },
      ];
    } else if (kind === 'star') {
      const N = 10;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.42;
        pts.push({ x: c.x + Math.cos(t) * rr, y: c.y + Math.sin(t) * rr });
      }
    } else if (kind === 'hex') {
      const N = 6;
      for (let i = 0; i < N; i++) {
        const t = (i / N) * Math.PI * 2 - Math.PI / 6;
        pts.push({ x: c.x + Math.cos(t) * r, y: c.y + Math.sin(t) * r });
      }
    }
    surfaceStore.addSlice(pts, kind === 'rect' ? 'Rectangle' :
                                kind === 'circle' ? 'Circle' :
                                kind === 'triangle' ? 'Triangle' :
                                kind === 'star' ? 'Star' :
                                kind === 'hex' ? 'Hexagon' : undefined);
  }

  // ── Auto-create a default surface when user opens the panel
  //    without one — saves them a click.
  $: if (!$activeSurface && $surfaceStore.surfaces.length === 0) {
    // Defer one tick so the reactive graph settles before we mutate.
    queueMicrotask(() => surfaceStore.createSurface('Stage 1'));
  }

  // ── Auto-fit the surface to the viewport when it changes —
  //    so first-time imports aren't tiny in the corner.
  $: if ($activeSurface && canvasEl) fitToViewport();
  function fitToViewport() {
    if (!canvasEl || !$activeSurface) return;
    const rect = canvasEl.getBoundingClientRect();
    const padding = 40;
    const sw = $activeSurface.width;
    const sh = $activeSurface.height;
    const fit = Math.min(
      (rect.width - padding * 2) / sw,
      (rect.height - padding * 2) / sh
    );
    zoom = Math.max(0.05, Math.min(4, fit));
    panX = (rect.width - sw * zoom) / 2;
    panY = (rect.height - sh * zoom) / 2;
  }

  onMount(() => {
    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    window.addEventListener('keydown', onWindowKeyDown);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
      window.removeEventListener('keydown', onWindowKeyDown);
    };
  });

  onDestroy(() => {
    // Nothing per-instance — listeners are removed in onMount cleanup.
  });
</script>

<div class="stage-overlay">
  <!-- Header ── tools, surface name, close button ───────────────── -->
  <header class="stage-header">
    <div class="header-left">
      <button class="close-btn" onclick={() => workspace.closeAll()} title="Close Stage Designer (Esc)">×</button>
      <span class="title">STAGE DESIGNER</span>
      {#if $activeSurface}
        <input
          class="surface-name-input"
          type="text"
          value={$activeSurface.name}
          onchange={(e) => surfaceStore.renameSurface($activeSurface!.id, (e.target as HTMLInputElement).value)}
        />
        <span class="surface-dims">{$activeSurface.width} × {$activeSurface.height}</span>
      {/if}
    </div>

    <div class="header-center toolbar">
      <button class="tool-btn" class:active={tool === 'select'} onclick={() => tool = 'select'} title="Select (V)">↖</button>
      <button class="tool-btn" class:active={tool === 'pen'} onclick={() => tool = 'pen'} title="Pen — click to add vertices, click first to close (P)">✎</button>
      <span class="tool-sep"></span>
      <button class="tool-btn" onclick={() => addPremade('rect')}     title="Add rectangle">▭</button>
      <button class="tool-btn" onclick={() => addPremade('circle')}   title="Add circle">◯</button>
      <button class="tool-btn" onclick={() => addPremade('triangle')} title="Add triangle">△</button>
      <button class="tool-btn" onclick={() => addPremade('star')}     title="Add star">☆</button>
      <button class="tool-btn" onclick={() => addPremade('hex')}      title="Add hexagon">⬡</button>
      <span class="tool-sep"></span>
      <button class="tool-btn import-btn" onclick={triggerFilePicker} title="Import SVG file">↑ SVG</button>
      <input
        bind:this={fileInput}
        type="file"
        accept=".svg,image/svg+xml"
        style="display:none"
        onchange={handleFile}
      />
    </div>

    <div class="header-right">
      <button class="zoom-btn" onclick={fitToViewport} title="Fit to viewport">⛶</button>
      <span class="zoom-readout">{Math.round(zoom * 100)}%</span>
    </div>
  </header>

  <!-- Body ── slice list | canvas | inspector ─────────────────── -->
  <div class="stage-body">
    <!-- Slice list -->
    <aside class="slice-list-panel">
      <div class="panel-header">
        <span>Slices</span>
        <span class="slice-count">{$activeSurfaceSlices.length}</span>
      </div>
      <div class="slice-list">
        {#each $activeSurfaceSlices as slice, idx (slice.id)}
          <div
            class="slice-row"
            class:selected={$selectedSlice?.id === slice.id}
            onclick={() => surfaceStore.selectSlice(slice.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && surfaceStore.selectSlice(slice.id)}
          >
            <span class="slice-color-dot" style="background: {slice.color}"></span>
            <span class="slice-name">{slice.name}</span>
            <button
              class="slice-icon-btn"
              class:active={slice.visible}
              onclick={(e) => { e.stopPropagation(); surfaceStore.updateSlice(slice.id, { visible: !slice.visible }); }}
              title="Visible"
            >{slice.visible ? '◉' : '○'}</button>
            <button
              class="slice-icon-btn"
              class:active={slice.locked}
              onclick={(e) => { e.stopPropagation(); surfaceStore.updateSlice(slice.id, { locked: !slice.locked }); }}
              title="Locked"
            >{slice.locked ? '🔒' : '🔓'}</button>
            <button
              class="slice-icon-btn danger"
              onclick={(e) => { e.stopPropagation(); surfaceStore.deleteSlice(slice.id); }}
              title="Delete"
            >×</button>
          </div>
        {/each}
        {#if $activeSurfaceSlices.length === 0}
          <div class="slice-empty">
            No slices yet. Import an SVG, drop a premade shape, or use the pen tool.
          </div>
        {/if}
      </div>
    </aside>

    <!-- Design canvas -->
    <div
      class="design-canvas"
      class:tool-pen={tool === 'pen'}
      bind:this={canvasEl}
      onmousedown={onCanvasMouseDown}
      onwheel={onCanvasWheel}
      role="application"
      tabindex="0"
    >
      {#if $activeSurface}
        <!-- Surface bounds + slices, all under a single transform -->
        <svg
          class="canvas-svg"
          width={$activeSurface.width * zoom}
          height={$activeSurface.height * zoom}
          viewBox="0 0 {$activeSurface.width} {$activeSurface.height}"
          style="transform: translate({panX}px, {panY}px);"
        >
          <!-- Surface background -->
          <rect
            x="0" y="0"
            width={$activeSurface.width}
            height={$activeSurface.height}
            fill="#0a0a0c"
            stroke="#2a2a30"
            stroke-width={1 / zoom}
          />

          <!-- Existing slices -->
          {#each $activeSurfaceSlices as slice (slice.id)}
            {#if slice.visible}
              {@const isSelected = $selectedSlice?.id === slice.id}
              <path
                d={polygonToPath(slice.polygon)}
                fill={isSelected ? slice.color + '33' : slice.color + '18'}
                stroke={slice.color}
                stroke-width={(isSelected ? 2 : 1.2) / zoom}
                style="cursor: {tool === 'select' && !slice.locked ? 'pointer' : 'default'};"
                onclick={(e) => onSliceClick(slice, e)}
                onkeydown={(e) => e.key === 'Enter' && surfaceStore.selectSlice(slice.id)}
                role="button"
                tabindex="0"
              />
              <!-- Label at first vertex -->
              {#if slice.polygon.length > 0}
                <text
                  x={slice.polygon[0].x + 8 / zoom}
                  y={slice.polygon[0].y - 8 / zoom}
                  fill={slice.color}
                  font-size={11 / zoom}
                  font-family="monospace"
                  pointer-events="none"
                >{slice.name}</text>
              {/if}
              <!-- Vertex handles for the selected slice -->
              {#if isSelected}
                {#each slice.polygon as v, vi}
                  <circle
                    cx={v.x}
                    cy={v.y}
                    r={4 / zoom}
                    fill="#0a0a0c"
                    stroke={slice.color}
                    stroke-width={1.5 / zoom}
                  />
                {/each}
              {/if}
            {/if}
          {/each}

          <!-- Pen-tool live draft -->
          {#if penDraft && penDraft.length > 0}
            <path
              d={polygonToPath([...penDraft, ...(penCursor ? [penCursor] : [])])}
              fill="none"
              stroke="#4cd1ff"
              stroke-width={1.5 / zoom}
              stroke-dasharray="{4 / zoom},{3 / zoom}"
            />
            {#each penDraft as v, vi}
              <circle cx={v.x} cy={v.y} r={4 / zoom} fill="#4cd1ff" stroke="#0a0a0c" stroke-width={1 / zoom} />
            {/each}
          {/if}
        </svg>
      {/if}

      <!-- Help overlay when nothing yet -->
      {#if $activeSurfaceSlices.length === 0 && !penDraft}
        <div class="canvas-hint">
          <p><strong>Stage Designer</strong></p>
          <p>↑ Import an SVG, drag a premade shape, or press <kbd>P</kbd> to draw with the pen.</p>
          <p style="opacity: 0.6;">Shift+drag = pan · Mouse wheel = zoom · Esc = close</p>
        </div>
      {/if}
    </div>

    <!-- Inspector -->
    <aside class="inspector-panel">
      <div class="panel-header"><span>Inspector</span></div>
      {#if $selectedSlice}
        {@const sl = $selectedSlice}
        <div class="inspector-section">
          <label>
            Name
            <input
              type="text"
              value={sl.name}
              onchange={(e) => surfaceStore.updateSlice(sl.id, { name: (e.target as HTMLInputElement).value })}
            />
          </label>
          <label>
            Color
            <input
              type="color"
              value={sl.color}
              onchange={(e) => surfaceStore.updateSlice(sl.id, { color: (e.target as HTMLInputElement).value })}
            />
          </label>
          <div class="inspector-row">
            <label class="check">
              <input type="checkbox" checked={sl.visible} onchange={(e) => surfaceStore.updateSlice(sl.id, { visible: (e.target as HTMLInputElement).checked })}/>
              Visible
            </label>
            <label class="check">
              <input type="checkbox" checked={sl.locked} onchange={(e) => surfaceStore.updateSlice(sl.id, { locked: (e.target as HTMLInputElement).checked })}/>
              Locked
            </label>
          </div>
          <div class="inspector-stat"><span>Vertices</span><span>{sl.polygon.length}</span></div>
          <div class="inspector-stat"><span>Binding</span><span>{sl.sourceBinding ? sl.sourceBinding.kind : 'unbound'}</span></div>
          <div class="inspector-note">
            Slice→content binding lands in Phase 3. Output routing in Phase 3 too. Stage Effects in Phase 4.
          </div>
        </div>
      {:else}
        <div class="inspector-empty">Select a slice to edit its properties.</div>
      {/if}
    </aside>
  </div>
</div>

<style>
  .stage-overlay {
    position: fixed;
    inset: 0;
    z-index: 999;
    background: #050507;
    color: #ddd;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, sans-serif;
    user-select: none;
  }

  /* ─── Header ─── */
  .stage-header {
    flex: 0 0 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    background: linear-gradient(180deg, #0e0e12, #08080a);
    border-bottom: 1px solid #1d1d22;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .close-btn {
    width: 28px;
    height: 28px;
    border: 1px solid #2a2a30;
    background: transparent;
    color: #aaa;
    border-radius: 4px;
    font-size: 18px;
    line-height: 1;
    cursor: pointer;
  }
  .close-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .title {
    font-size: 11px;
    letter-spacing: 2px;
    color: #4cd1ff;
    font-weight: 600;
  }
  .surface-name-input {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    color: #ddd;
    padding: 4px 6px;
    font-size: 13px;
    min-width: 160px;
  }
  .surface-name-input:hover { border-color: #2a2a30; }
  .surface-name-input:focus { border-color: #4cd1ff; outline: none; }
  .surface-dims {
    color: #666;
    font-size: 11px;
    font-family: monospace;
  }

  /* ─── Toolbar ─── */
  .header-center.toolbar {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tool-btn {
    width: 30px;
    height: 30px;
    border: 1px solid #2a2a30;
    background: #14141a;
    color: #aaa;
    border-radius: 4px;
    font-size: 14px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .tool-btn:hover {
    border-color: #4cd1ff;
    color: #fff;
  }
  .tool-btn.active {
    background: rgba(76,209,255,0.15);
    border-color: #4cd1ff;
    color: #4cd1ff;
  }
  .tool-btn.import-btn {
    width: auto;
    padding: 0 10px;
    font-size: 11px;
    letter-spacing: 1px;
  }
  .tool-sep {
    width: 1px;
    height: 22px;
    background: #2a2a30;
    margin: 0 6px;
  }
  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .zoom-btn {
    width: 28px;
    height: 28px;
    background: transparent;
    border: 1px solid #2a2a30;
    color: #aaa;
    border-radius: 4px;
    cursor: pointer;
  }
  .zoom-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .zoom-readout {
    font-family: monospace;
    font-size: 11px;
    color: #888;
    min-width: 44px;
    text-align: right;
  }

  /* ─── Body ─── */
  .stage-body {
    flex: 1;
    display: grid;
    grid-template-columns: 240px 1fr 280px;
    min-height: 0;
  }

  /* ─── Slice list (left) ─── */
  .slice-list-panel {
    background: #0a0a0c;
    border-right: 1px solid #1d1d22;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .panel-header {
    flex: 0 0 28px;
    padding: 6px 12px;
    font-size: 10px;
    letter-spacing: 1.5px;
    color: #888;
    background: #08080a;
    border-bottom: 1px solid #1d1d22;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .slice-count {
    color: #555;
    font-family: monospace;
  }
  .slice-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }
  .slice-row {
    display: grid;
    grid-template-columns: 14px 1fr 22px 22px 22px;
    gap: 4px;
    align-items: center;
    padding: 4px 10px;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .slice-row:hover {
    background: rgba(255,255,255,0.03);
  }
  .slice-row.selected {
    background: rgba(76,209,255,0.08);
    border-left-color: #4cd1ff;
  }
  .slice-color-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .slice-name {
    font-size: 12px;
    color: #ccc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .slice-icon-btn {
    background: transparent;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 12px;
    padding: 2px;
    border-radius: 3px;
  }
  .slice-icon-btn.active { color: #aaa; }
  .slice-icon-btn:hover { background: rgba(255,255,255,0.06); color: #fff; }
  .slice-icon-btn.danger:hover { color: #ff8888; }
  .slice-empty {
    padding: 24px 12px;
    color: #555;
    font-size: 11px;
    line-height: 1.5;
    text-align: center;
  }

  /* ─── Design canvas ─── */
  .design-canvas {
    position: relative;
    overflow: hidden;
    background:
      linear-gradient(45deg, #0c0c10 25%, transparent 25%),
      linear-gradient(-45deg, #0c0c10 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, #0c0c10 75%),
      linear-gradient(-45deg, transparent 75%, #0c0c10 75%);
    background-size: 16px 16px;
    background-position: 0 0, 0 8px, 8px -8px, -8px 0;
    background-color: #050507;
    cursor: default;
  }
  .design-canvas.tool-pen {
    cursor: crosshair;
  }
  .canvas-svg {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    /* Wrapper transform scales the SVG via width/height — keeps text
       and stroke widths legible at any zoom via the /zoom divisions
       above. */
  }
  .canvas-hint {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    text-align: center;
    color: #666;
    pointer-events: none;
    font-size: 13px;
    line-height: 1.6;
  }
  .canvas-hint kbd {
    display: inline-block;
    padding: 1px 6px;
    background: #14141a;
    border: 1px solid #2a2a30;
    border-radius: 3px;
    font-family: monospace;
    font-size: 11px;
    color: #aaa;
  }

  /* ─── Inspector (right) ─── */
  .inspector-panel {
    background: #0a0a0c;
    border-left: 1px solid #1d1d22;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
  .inspector-section {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .inspector-section label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 10px;
    letter-spacing: 1px;
    color: #888;
  }
  .inspector-section label.check {
    flex-direction: row;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    letter-spacing: 0;
    color: #bbb;
    text-transform: none;
  }
  .inspector-section input[type="text"] {
    background: #14141a;
    border: 1px solid #2a2a30;
    border-radius: 3px;
    color: #ddd;
    padding: 5px 8px;
    font-size: 12px;
  }
  .inspector-section input[type="text"]:focus {
    border-color: #4cd1ff;
    outline: none;
  }
  .inspector-section input[type="color"] {
    width: 100%;
    height: 28px;
    background: #14141a;
    border: 1px solid #2a2a30;
    border-radius: 3px;
  }
  .inspector-row {
    display: flex;
    gap: 12px;
  }
  .inspector-stat {
    display: flex;
    justify-content: space-between;
    font-size: 11px;
    color: #888;
    padding: 4px 0;
    border-top: 1px solid #1a1a20;
  }
  .inspector-stat span:last-child {
    color: #ddd;
    font-family: monospace;
  }
  .inspector-note {
    font-size: 10px;
    color: #555;
    line-height: 1.5;
    padding: 8px;
    background: rgba(76,209,255,0.04);
    border-left: 2px solid rgba(76,209,255,0.3);
    margin-top: 8px;
  }
  .inspector-empty {
    padding: 24px 12px;
    color: #555;
    font-size: 11px;
    text-align: center;
  }
</style>
