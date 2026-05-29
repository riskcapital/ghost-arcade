<script lang="ts">
  /**
   * ScreenPanel — left-sidebar panel for managing output Screens.
   * Parallel structure to LayerPanel: top half is the screen list
   * (add/duplicate/remove, drag-reorder, click to select); bottom half
   * is an inspector for the selected screen (warp mode, edge blend,
   * effects, target display). Width and visual rhythm match LayerPanel
   * so the user feels at home flipping between the Layers and Screens
   * tabs.
   */
  import { onMount } from 'svelte';
  import { screens, selectedScreenId, selectedScreen, screenActions } from '../stores/screens';
  import { getMasterWarpCanvas } from '../sync/outputComposite';
  import { settings, identityOutputMesh, masterWarpIsActive, type OutputSlice } from '../stores/settings';
  import { maxOutputSlices } from '../stores/license';
  import { isDesktopApp, getTextureShareLabel, invoke } from '$lib/bridge';
  import OutputCanvasPreview from './OutputCanvasPreview.svelte';
  import ScreenInspector from './ScreenInspector.svelte';

  const tsLabel = getTextureShareLabel();

  // ─── Display enumeration ─────────────────────────────────────────────
  // Re-fetched each time the panel mounts (operators hot-plug projectors).
  type DisplayInfo = {
    id: number; label: string; width: number; height: number;
    x: number; y: number; isPrimary: boolean; scaleFactor: number;
  };
  let displays: DisplayInfo[] = [];
  async function refreshDisplays() {
    if (!isDesktopApp) return;
    try {
      displays = ((await invoke('get_displays')) as DisplayInfo[]) || [];
    } catch { displays = []; }
  }
  onMount(() => { refreshDisplays(); });

  // ─── Open-on-display window tracking ────────────────────────────────
  let openWindowIds: string[] = [];
  async function refreshOpenWindows() {
    if (!isDesktopApp) return;
    try {
      const ids = (await invoke('output_list_slice_windows')) as string[];
      openWindowIds = Array.isArray(ids) ? ids : [];
    } catch { openWindowIds = []; }
  }
  onMount(() => { refreshOpenWindows(); });

  // Auto-close any windows whose backing screen got removed/disabled/retargeted.
  $: if (isDesktopApp && openWindowIds.length > 0) {
    const live = $screens
      .filter(s => s.enabled && (s.targetType ?? 'sender') === 'display' && s.displayId != null)
      .map(s => s.id);
    const stale = openWindowIds.filter(id => !live.includes(id));
    if (stale.length > 0) {
      Promise.all(stale.map(id => invoke('output_close_slice_window', { sliceId: id }).catch(() => {})))
        .then(() => refreshOpenWindows());
    }
  }

  async function openOnDisplay(s: OutputSlice) {
    if (!isDesktopApp || s.displayId == null) return;
    await invoke('output_open_slice_window', { sliceId: s.id, displayId: s.displayId }).catch(() => {});
    refreshOpenWindows();
  }
  async function closeOnDisplay(s: OutputSlice) {
    if (!isDesktopApp) return;
    await invoke('output_close_slice_window', { sliceId: s.id }).catch(() => {});
    refreshOpenWindows();
  }

  // ─── Master-canvas helpers ──────────────────────────────────────────
  function setMaster(w: number, h: number) {
    const W = Math.max(128, Math.min(15360, Math.round(w)));
    const H = Math.max(128, Math.min(15360, Math.round(h)));
    settings.update(s => ({ ...s, output: { ...s.output, masterCanvasWidth: W, masterCanvasHeight: H } }));
  }
  function autoFitMaster() {
    const active = $screens.filter(s => s.enabled && s.targetType === 'display' && s.displayId != null);
    if (active.length === 0) return;
    let totalW = 0, maxH = 0;
    for (const s of active) {
      const d = displays.find(dd => dd.id === s.displayId);
      if (!d) continue;
      const dw = d.width * d.scaleFactor;
      const dh = d.height * d.scaleFactor;
      totalW += dw - dw * (s.edgeBlendLeft + s.edgeBlendRight) / 2;
      maxH = Math.max(maxH, dh);
    }
    if (totalW > 0 && maxH > 0) setMaster(totalW, maxH);
  }
  function matchSpoutToMaster() {
    settings.update(s => ({
      ...s,
      output: {
        ...s.output,
        spoutResolution: 'custom',
        customWidth: s.output.masterCanvasWidth,
        customHeight: s.output.masterCanvasHeight,
      },
    }));
  }
  $: spoutMatchesMaster =
    $settings.output.spoutResolution === 'custom' &&
    $settings.output.customWidth === $settings.output.masterCanvasWidth &&
    $settings.output.customHeight === $settings.output.masterCanvasHeight;

  // ─── Master warp ────────────────────────────────────────────────────
  // One global output-side warp on the WHOLE master canvas — distinct
  // from per-Screen warp (which targets a single slice). Applied editor-
  // side so BOTH output windows (WebGPU + WebRTC fallback) carry already-
  // warped pixels. Two modes: Corners (4-point edge/quad) and Mesh (grid).
  // Geometry is dragged directly on the editor canvas (MasterWarpHandles,
  // orange handles) — there's no numeric entry. Identity is a visual
  // no-op so flipping it on changes nothing until a handle moves.
  $: masterWarp = $settings.output.masterWarp ?? { enabled: false, mode: 'corners' as const };
  $: masterMode = masterWarp.mode === 'mesh' && masterWarp.meshGrid ? 'mesh' : 'corners';
  // Lit only when the warp would actually change the output (non-identity),
  // not merely enabled — so "on but untouched" reads as inert.
  $: masterWarpActive = masterWarpIsActive(masterWarp);

  function toggleMasterWarp(enabled: boolean) {
    // No geometry seeded on enable — an enabled-but-identity warp is a
    // passthrough no-op. Corner points are created only when the operator
    // drags a handle (MasterWarpHandles), so there are no "default" warp
    // points sitting on the canvas.
    settings.setMasterWarp({ enabled });
  }
  function setMasterMode(mode: 'corners' | 'mesh') {
    // Mesh needs a control lattice to show handles, so seed an identity
    // grid when the operator explicitly picks Mesh (still a passthrough
    // no-op until a point moves). Corners derive identity on the fly.
    if (mode === 'mesh') {
      settings.setMasterWarp({ mode, meshGrid: masterWarp.meshGrid ?? identityOutputMesh() });
    } else {
      settings.setMasterWarp({ mode });
    }
  }
  function resetMasterWarp() {
    // Back to identity. Corners: clear so nothing is stored (handles
    // derive identity); Mesh: reset to a flat lattice so its handles
    // remain visible.
    if (masterMode === 'mesh') settings.setMasterWarp({ meshGrid: identityOutputMesh() });
    else settings.setMasterWarp({ corners: undefined });
  }

  // ─── Live warped-output preview ─────────────────────────────────────
  // Mirrors the master-warp output canvas (getMasterWarpCanvas) into a
  // small canvas right here in the panel, so the operator SEES the warp
  // as they drag — no dependency on a projector/output window being
  // attached. Only runs while the warp is active (the canvas only
  // updates then).
  let mwPreviewCanvas: HTMLCanvasElement | null = null;
  let mwPreviewRaf = 0;
  function mwPreviewLoop() {
    mwPreviewRaf = requestAnimationFrame(mwPreviewLoop);
    if (!mwPreviewCanvas) return;
    const ctx = mwPreviewCanvas.getContext('2d');
    // Warped output source: in WebGPU mode the warp is baked into the
    // present canvas (.webgpu-present) — that IS the warped output. Else
    // (WebGL fallback) the blendRenderer master canvas holds it.
    const src = (document.querySelector('canvas.webgpu-present') as HTMLCanvasElement | null)
      ?? getMasterWarpCanvas();
    if (!ctx) return;
    const W = mwPreviewCanvas.width, H = mwPreviewCanvas.height;
    ctx.clearRect(0, 0, W, H);
    if (masterWarpActive && src && src.width > 0) {
      try { ctx.drawImage(src, 0, 0, W, H); } catch { /* not ready */ }
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    }
  }
  onMount(() => {
    mwPreviewRaf = requestAnimationFrame(mwPreviewLoop);
    return () => { if (mwPreviewRaf) cancelAnimationFrame(mwPreviewRaf); };
  });

  // ─── Drag-reorder for the screen list ───────────────────────────────
  let dragFromIdx = -1;
  function onDragStart(i: number) { dragFromIdx = i; }
  function onDragOver(e: DragEvent) { e.preventDefault(); }
  function onDrop(i: number) {
    if (dragFromIdx < 0 || dragFromIdx === i) return;
    screenActions.reorder(dragFromIdx, i);
    dragFromIdx = -1;
  }

  function add() {
    const id = screenActions.add();
    if (id) selectedScreenId.set(id);
  }
  function duplicate(s: OutputSlice) {
    const id = screenActions.duplicate(s.id);
    if (id) selectedScreenId.set(id);
  }
</script>

<div class="screen-panel">
  <!-- Top: screen list -->
  <div class="screens-section">
    <div class="section-head">
      <span class="section-title">Screens</span>
      <span class="section-count">{$screens.length}/{$maxOutputSlices === Infinity ? '∞' : $maxOutputSlices}</span>
    </div>

    <!-- Top-down preview pane (master canvas + slice rects + overlap zones) -->
    <div class="preview-host">
      <OutputCanvasPreview
        slices={$screens}
        masterWidth={$settings.output.masterCanvasWidth}
        masterHeight={$settings.output.masterCanvasHeight}
        selectedId={$selectedScreenId}
        onSelect={(id) => selectedScreenId.set(id)}
        onChange={(id, partial) => screenActions.update(id, partial)}
      />
    </div>

    <!-- Quick-setup presets, only when there are no screens yet -->
    {#if $screens.length === 0}
      <div class="preset-row">
        <button class="preset-btn" onclick={() => screenActions.applyPreset('2-wide')}>2-Wide</button>
        <button class="preset-btn" onclick={() => screenActions.applyPreset('3-wide')} disabled={$maxOutputSlices < 3}>3-Wide</button>
        {#if $maxOutputSlices >= 4}
          <button class="preset-btn" onclick={() => screenActions.applyPreset('2x2')}>2×2</button>
        {/if}
      </div>
    {/if}

    <div class="screen-list" role="list">
      {#each $screens as s, i (s.id)}
        <!-- Row is a <div> rather than <button> because it contains
             interactive children (checkbox + duplicate/remove buttons).
             Nested <button>s are invalid HTML and Svelte 5 errors on
             them. We restore button-like semantics via role+keydown. -->
        <div
          class="screen-row"
          class:selected={$selectedScreenId === s.id}
          class:disabled={!s.enabled}
          draggable="true"
          ondragstart={() => onDragStart(i)}
          ondragover={onDragOver}
          ondrop={() => onDrop(i)}
          onclick={() => selectedScreenId.set(s.id)}
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedScreenId.set(s.id); } }}
          role="button"
          tabindex="0"
          title={s.name}
        >
          <span class="row-handle" aria-hidden="true">⋮⋮</span>
          <input
            type="checkbox"
            class="row-enable"
            checked={s.enabled}
            onclick={(e) => e.stopPropagation()}
            onchange={(e) => screenActions.update(s.id, { enabled: (e.target as HTMLInputElement).checked })}
          />
          <span class="row-name">{s.name}</span>
          <span class="row-target">
            {#if (s.targetType ?? 'sender') === 'display'}
              {#if openWindowIds.includes(s.id)}● {/if}DISP{s.displayId ?? '?'}
            {:else}
              {tsLabel}
            {/if}
          </span>
          <button class="row-act" title="Duplicate" onclick={(e) => { e.stopPropagation(); duplicate(s); }}>⎘</button>
          <button class="row-act danger" title="Remove" onclick={(e) => { e.stopPropagation(); screenActions.remove(s.id); }}>×</button>
        </div>
      {/each}
    </div>

    <div class="add-row">
      <button class="add-btn" onclick={add} disabled={$screens.length >= $maxOutputSlices}>+ Add Screen</button>
    </div>

    <!-- Master-canvas controls. Tucked between the list and inspector
         so they're discoverable when working on the rig as a whole
         but don't dominate the top of the panel. -->
    <details class="master-details" open={$screens.length > 0}>
      <summary>Master canvas</summary>
      <div class="master-row">
        <input
          type="number" min="128" max="15360" step="2" class="master-num"
          value={$settings.output.masterCanvasWidth}
          onchange={(e) => setMaster(parseInt((e.target as HTMLInputElement).value) || 1920, $settings.output.masterCanvasHeight)}
        />
        <span class="dim-x">×</span>
        <input
          type="number" min="128" max="15360" step="2" class="master-num"
          value={$settings.output.masterCanvasHeight}
          onchange={(e) => setMaster($settings.output.masterCanvasWidth, parseInt((e.target as HTMLInputElement).value) || 1080)}
        />
      </div>
      <div class="master-row">
        <button class="mini-btn" onclick={autoFitMaster}
          disabled={!$screens.some(s => s.enabled && s.targetType === 'display' && s.displayId != null)}>
          Auto-fit
        </button>
        <button class="mini-btn" onclick={matchSpoutToMaster} disabled={spoutMatchesMaster}>
          {spoutMatchesMaster ? `${tsLabel} matches ✓` : `Match ${tsLabel}`}
        </button>
      </div>
    </details>

    <!-- Master warp — one global warp on the whole output composite,
         applied to both output windows (WebGPU + WebRTC). Drag the
         orange handles on the canvas; this panel is just enable + mode. -->
    <details class="master-details" open={masterWarp.enabled}>
      <summary>
        Master warp
        {#if masterWarpActive}<span class="mw-active-dot" title="Warp active"></span>{/if}
      </summary>
      <label class="mw-enable">
        <input
          type="checkbox"
          checked={masterWarp.enabled}
          onchange={(e) => toggleMasterWarp((e.target as HTMLInputElement).checked)}
        />
        <span>Warp entire output</span>
      </label>
      {#if masterWarp.enabled}
        <div class="mw-modes" role="group" aria-label="Master warp mode">
          <button class="mw-mode" class:active={masterMode === 'corners'} onclick={() => setMasterMode('corners')}>
            Edge / Corners
          </button>
          <button class="mw-mode" class:active={masterMode === 'mesh'} onclick={() => setMasterMode('mesh')}>
            Mesh
          </button>
        </div>
        <div class="mw-hint">
          Drag the orange handles on the canvas to warp the whole output.
          Live preview below shows the warped result.
        </div>
        <!-- Live warped-output preview — shows the actual warp result so
             you don't need a projector/output window open to see it. -->
        <canvas bind:this={mwPreviewCanvas} class="mw-preview" width="240" height="135"></canvas>
        <div class="master-row">
          <button class="mini-btn" onclick={resetMasterWarp}>Reset to identity</button>
        </div>
      {/if}
    </details>
  </div>

  <!-- Bottom: inspector for the selected screen -->
  <div class="inspector-section">
    {#if $selectedScreen}
      <ScreenInspector
        screen={$selectedScreen}
        displays={displays}
        openWindowIds={openWindowIds}
        onOpenOnDisplay={openOnDisplay}
        onCloseOnDisplay={closeOnDisplay}
        onRefreshDisplays={refreshDisplays}
      />
    {:else}
      <div class="inspector-empty">
        Select a Screen to edit warp, blend, color, and effects.
      </div>
    {/if}
  </div>
</div>

<style>
  .screen-panel {
    width: 280px;
    background: #111114;
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    flex-direction: column;
    color: #eee;
    font-size: 13px;
    height: 100%;
    overflow: hidden;
  }
  .screens-section {
    display: flex;
    flex-direction: column;
    flex: 0 0 50%;
    min-height: 200px;
    max-height: 60%;
    overflow: auto;
    padding: 8px;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #888;
    margin-bottom: 6px;
  }
  .section-count {
    color: #555;
    font-family: ui-monospace, monospace;
  }
  .preview-host {
    margin-bottom: 8px;
  }
  .preset-row {
    display: flex;
    gap: 6px;
    margin-bottom: 8px;
  }
  .preset-btn {
    flex: 1;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #ccc;
    font-size: 11px;
    cursor: pointer;
  }
  .preset-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.1); }
  .preset-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .screen-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .screen-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid transparent;
    border-radius: 4px;
    color: #ddd;
    font-size: 12px;
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: inherit;
  }
  .screen-row:hover { background: rgba(255, 255, 255, 0.06); }
  .screen-row.selected {
    background: rgba(187, 134, 252, 0.12);
    border-color: rgba(187, 134, 252, 0.4);
  }
  .screen-row.disabled .row-name { opacity: 0.45; text-decoration: line-through; }
  .row-handle {
    color: #555;
    cursor: grab;
    font-size: 10px;
    user-select: none;
  }
  .row-enable {
    margin: 0;
    cursor: pointer;
  }
  .row-name {
    flex: 1;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .row-target {
    font-size: 10px;
    color: #888;
    font-family: ui-monospace, monospace;
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .row-act {
    background: transparent;
    border: none;
    color: #888;
    cursor: pointer;
    padding: 0 4px;
    font-size: 14px;
    line-height: 1;
  }
  .row-act:hover { color: #fff; }
  .row-act.danger:hover { color: #ff6464; }

  .add-row { margin-top: 8px; }
  .add-btn {
    width: 100%;
    padding: 6px;
    background: rgba(187, 134, 252, 0.08);
    border: 1px solid rgba(187, 134, 252, 0.2);
    border-radius: 4px;
    color: #BB86FC;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
  }
  .add-btn:hover:not(:disabled) { background: rgba(187, 134, 252, 0.15); }
  .add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .master-details {
    margin-top: 12px;
    padding: 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 4px;
  }
  .master-details summary {
    cursor: pointer;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #888;
    user-select: none;
  }
  .master-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .master-num {
    width: 70px;
    padding: 3px 6px;
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: #ddd;
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  .dim-x { color: #666; font-family: ui-monospace, monospace; }
  .mini-btn {
    flex: 1;
    padding: 3px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    color: #ccc;
    font-size: 10px;
    cursor: pointer;
    font-family: inherit;
  }
  .mini-btn:hover:not(:disabled) { background: rgba(255, 255, 255, 0.08); }
  .mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Master warp ──────────────────────────────────────────────── */
  .mw-active-dot {
    display: inline-block;
    width: 7px; height: 7px;
    margin-left: 6px;
    border-radius: 50%;
    background: #f0a35e;
    box-shadow: 0 0 5px rgba(240, 163, 94, 0.8);
    vertical-align: middle;
  }
  .mw-enable {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 6px;
    font-size: 11px;
    color: #ccc;
    cursor: pointer;
  }
  .mw-enable input { cursor: pointer; }
  .mw-hint {
    margin-top: 6px;
    font-size: 10px;
    line-height: 1.4;
    color: #777;
  }
  .mw-preview {
    display: block;
    width: 100%;
    height: auto;
    margin-top: 8px;
    border: 1px solid rgba(240, 163, 94, 0.4);
    border-radius: 4px;
    background: #000;
    image-rendering: auto;
  }
  .mw-modes {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .mw-mode {
    flex: 1;
    padding: 4px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    color: #ccc;
    font-size: 10px;
    cursor: pointer;
    font-family: inherit;
  }
  .mw-mode:hover { background: rgba(255, 255, 255, 0.08); }
  .mw-mode.active {
    background: rgba(240, 163, 94, 0.18);
    border-color: #f0a35e;
    color: #f0a35e;
  }

  .inspector-section {
    flex: 1 1 50%;
    min-height: 200px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    overflow: auto;
  }
  .inspector-empty {
    padding: 24px;
    color: #666;
    font-size: 12px;
    text-align: center;
    line-height: 1.4;
  }
</style>
