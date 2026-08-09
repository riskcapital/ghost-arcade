<script lang="ts">
  /**
   * ScreenPanel — left-sidebar panel for managing output Screens.
   * A single continuous scroll surface for the screen list, global output
   * calibration (master canvas / master warp / dome projection), and the
   * selected screen inspector. Keeping everything in one flow avoids the
   * old split-panel trap where calibration controls disappeared in a
   * separate lower scroll area.
   */
  import { onMount } from 'svelte';
  import { screens, selectedScreenId, selectedScreen, screenActions } from '../stores/screens';
  import { settings, identityOutputMesh, masterWarpIsActive, type OutputSettings, type OutputSlice } from '../stores/settings';
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

  // Track slice windows opened via window.open (zero-copy path) so we
  // can close them locally without the editor losing the reference.
  const _zeroCopySliceWindows = new Map<string, Window>();

  async function openOnDisplay(s: OutputSlice) {
    if (!isDesktopApp || s.displayId == null) return;
    // Zero-copy path: open the slice window via window.open so it lives
    // in the SAME renderer process as the editor. SliceOutputApp can
    // then read the editor's already-warped presentCanvas via
    // window.opener.document and crop its region from that — no local
    // re-render, no fragile hidden-canvas → texture upload. Master warp
    // applies on the slice display automatically because the source is
    // the editor's WGSL-warped canvas.
    const zeroCopy = !!$settings.experimental?.outputZeroCopy;
    if (zeroCopy) {
      try {
        await invoke('configure_next_output_window', {
          displayId: s.displayId,
          fullscreen: true,
        });
        const url = new URL(window.location.href);
        url.search = `?mode=slice-display&sliceId=${encodeURIComponent(s.id)}&webgpu-disable=1`;
        const newWin = window.open(url.toString(), `ga-slice-${s.id}`, 'popup=true');
        if (!newWin) {
          alert('Slice display window failed to open. Check popup-blocker behaviour.');
          return;
        }
        _zeroCopySliceWindows.set(s.id, newWin);
        // Attach this slice window as an additional output target. The
        // editor's pump fan-outs each VideoFrame to all attached ports —
        // Fullscreen and slices can coexist. The slice window receives the
        // same warped frame and crops its own region from it.
        const { attachOutputWindow } = await import('$lib/sync/outputSharedTexturePresenter');
        attachOutputWindow(newWin, `slice:${s.id}`);
        console.log(`[ScreenPanel] slice ${s.id} opened on display ${s.displayId} [zero-copy]`);
        refreshOpenWindows();
        return;
      } catch (err) {
        console.error('[ScreenPanel] zero-copy open failed, falling back to IPC path:', err);
        // fall through to legacy IPC
      }
    }
    await invoke('output_open_slice_window', { sliceId: s.id, displayId: s.displayId }).catch(() => {});
    refreshOpenWindows();
  }
  async function closeOnDisplay(s: OutputSlice) {
    if (!isDesktopApp) return;
    // Close the zero-copy window proxy locally first if we opened it
    // via window.open. Electron's did-create-window listener also tracks
    // it in `sliceWindows`, so the editor's `output_close_slice_window`
    // IPC also closes it as a belt-and-suspenders. Either path works.
    const zc = _zeroCopySliceWindows.get(s.id);
    if (zc && !zc.closed) {
      try { zc.close(); } catch { /* */ }
      _zeroCopySliceWindows.delete(s.id);
    }
    // Detach from the presenter so the pump stops fan-out to a dead port.
    try {
      const { detachOutputWindow } = await import('$lib/sync/outputSharedTexturePresenter');
      detachOutputWindow(`slice:${s.id}`);
    } catch { /* */ }
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
    //
    // On ENABLE, also clear any stale corners/mesh that lingered from a
    // previous in-session toggle-off-toggle-on cycle. Without this, a
    // user who dragged corners, disabled, then re-enabled would surface
    // the OLD geometry — and if that geometry was degenerate (collapsed
    // quad from a misclick), output would render all-black on enable.
    if (enabled) {
      settings.setMasterWarp({ enabled: true, corners: undefined, meshGrid: undefined });
    } else {
      settings.setMasterWarp({ enabled: false });
    }
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

  // ─── Dome projection ────────────────────────────────────────────────
  type DomeNumberKey =
    | 'domeFOV'
    | 'domeRotation'
    | 'domeTilt'
    | 'domeOffsetX'
    | 'domeOffsetY'
    | 'domeCurvature'
    | 'domeTruncation';

  const domeModes: { value: OutputSettings['domeMode']; label: string }[] = [
    { value: 'angular', label: 'Angular fisheye' },
    { value: 'stereographic', label: 'Stereographic' },
    { value: 'orthographic', label: 'Orthographic' },
    { value: 'equirectangular', label: 'Equirectangular 360' },
  ];

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }
  function eventNumber(e: Event, fallback = 0) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : fallback;
  }
  function updateDomeNumber(key: DomeNumberKey, value: number, min: number, max: number) {
    settings.updateDomeSetting(key, clamp(value, min, max));
  }
  function resetDome() {
    settings.update(s => ({
      ...s,
      output: {
        ...s.output,
        domeFOV: 180,
        domeRotation: 0,
        domeTilt: 0,
        domeOffsetX: 0,
        domeOffsetY: 0,
        domeCurvature: 1,
        domeTruncation: 1,
      },
    }));
  }
  function applyDomePreset(kind: 'domemaster' | 'panorama' | 'half') {
    settings.update(s => ({
      ...s,
      output: {
        ...s.output,
        domeEnabled: true,
        domeMode: kind === 'panorama' ? 'equirectangular' : 'angular',
        domeFOV: kind === 'panorama' ? 360 : 180,
        domeRotation: 0,
        domeTilt: 0,
        domeOffsetX: 0,
        domeOffsetY: 0,
        domeCurvature: 1,
        domeTruncation: kind === 'half' ? 0.5 : 1,
      },
    }));
  }

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
        </div>
        <div class="master-row">
          <button class="mini-btn" onclick={resetMasterWarp}>Reset to identity</button>
        </div>
      {/if}
    </details>

    <!-- Dome projection — global fisheye/panorama reprojection for domes.
         Kept beside Master canvas/warp because it changes the entire
         master output before Screens slice it. -->
    <details class="master-details dome-details" open={$settings.output.domeEnabled}>
      <summary>
        Dome projection
        {#if $settings.output.domeEnabled}<span class="mw-active-dot dome-dot" title="Dome projection enabled"></span>{/if}
      </summary>
      <label class="mw-enable">
        <input
          type="checkbox"
          checked={$settings.output.domeEnabled ?? false}
          onchange={(e) => settings.setDomeEnabled((e.target as HTMLInputElement).checked)}
        />
        <span>Fisheye / domemaster output</span>
      </label>
      <div class="dome-presets">
        <button class="dome-chip" onclick={() => applyDomePreset('domemaster')}>Domemaster 180</button>
        <button class="dome-chip" onclick={() => applyDomePreset('half')}>Half dome</button>
        <button class="dome-chip" onclick={() => applyDomePreset('panorama')}>Panorama 360</button>
      </div>
      {#if $settings.output.domeEnabled ?? false}
        {@const dome = {
          fov: $settings.output.domeFOV ?? 180,
          rotation: $settings.output.domeRotation ?? 0,
          tilt: $settings.output.domeTilt ?? 0,
          curvature: $settings.output.domeCurvature ?? 1,
          truncation: $settings.output.domeTruncation ?? 1,
          offsetX: $settings.output.domeOffsetX ?? 0,
          offsetY: $settings.output.domeOffsetY ?? 0,
        }}
        <label class="dome-field">
          <span>Mode</span>
          <select
            value={$settings.output.domeMode ?? 'angular'}
            onchange={(e) => settings.setDomeMode((e.target as HTMLSelectElement).value as OutputSettings['domeMode'])}
          >
            {#each domeModes as mode}
              <option value={mode.value}>{mode.label}</option>
            {/each}
          </select>
        </label>
        <div class="dome-controls">
          <label class="dome-row">
            <span>FOV</span>
            <input type="range" min="90" max="360" step="1" value={dome.fov}
              oninput={(e) => updateDomeNumber('domeFOV', eventNumber(e, 180), 90, 360)} />
            <em>{dome.fov.toFixed(0)}°</em>
          </label>
          <label class="dome-row">
            <span>Rotation</span>
            <input type="range" min="0" max="360" step="1" value={dome.rotation}
              oninput={(e) => updateDomeNumber('domeRotation', eventNumber(e), 0, 360)} />
            <em>{dome.rotation.toFixed(0)}°</em>
          </label>
          <label class="dome-row">
            <span>Tilt</span>
            <input type="range" min="-90" max="90" step="1" value={dome.tilt}
              oninput={(e) => updateDomeNumber('domeTilt', eventNumber(e), -90, 90)} />
            <em>{dome.tilt.toFixed(0)}°</em>
          </label>
          <label class="dome-row">
            <span>Curvature</span>
            <input type="range" min="0" max="1" step="0.01" value={dome.curvature}
              oninput={(e) => updateDomeNumber('domeCurvature', eventNumber(e, 1), 0, 1)} />
            <em>{(dome.curvature * 100).toFixed(0)}%</em>
          </label>
          <label class="dome-row">
            <span>Truncation</span>
            <input type="range" min="0.5" max="1" step="0.01" value={dome.truncation}
              oninput={(e) => updateDomeNumber('domeTruncation', eventNumber(e, 1), 0.5, 1)} />
            <em>{(dome.truncation * 100).toFixed(0)}%</em>
          </label>
          <label class="dome-row">
            <span>Offset X</span>
            <input type="range" min="-1" max="1" step="0.01" value={dome.offsetX}
              oninput={(e) => updateDomeNumber('domeOffsetX', eventNumber(e), -1, 1)} />
            <em>{dome.offsetX.toFixed(2)}</em>
          </label>
          <label class="dome-row">
            <span>Offset Y</span>
            <input type="range" min="-1" max="1" step="0.01" value={dome.offsetY}
              oninput={(e) => updateDomeNumber('domeOffsetY', eventNumber(e), -1, 1)} />
            <em>{dome.offsetY.toFixed(2)}</em>
          </label>
        </div>
        <div class="master-row">
          <button class="mini-btn" onclick={resetDome}>Reset dome</button>
        </div>
      {/if}
    </details>

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
</div>

<style>
  .screen-panel {
    width: 280px;
    background: var(--bg-secondary, #111114);
    border-right: 1px solid rgba(255, 255, 255, 0.06);
    color: var(--text-primary, #eee);
    font-size: 14px;
    height: 100%;
    overflow: auto;
  }
  .screens-section {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 8px;
  }
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted, #888);
    margin-bottom: 6px;
  }
  .section-count {
    color: #555;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
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
    color: var(--text-primary, #ccc);
    font-size: 12px;
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
    color: var(--text-primary, #ddd);
    font-size: 13px;
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
    font-size: 11px;
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
    font-size: 11px;
    color: var(--text-muted, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .row-act {
    background: transparent;
    border: none;
    color: var(--text-muted, #888);
    cursor: pointer;
    padding: 0 4px;
    font-size: 15px;
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
    font-size: 13px;
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
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted, #888);
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
    color: var(--text-primary, #ddd);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 12px;
  }
  .dim-x { color: #666; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .mini-btn {
    flex: 1;
    padding: 3px 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 3px;
    color: var(--text-primary, #ccc);
    font-size: 11px;
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
    font-size: 12px;
    color: var(--text-primary, #ccc);
    cursor: pointer;
  }
  .mw-enable input { cursor: pointer; }
  .mw-hint {
    margin-top: 6px;
    font-size: 11px;
    line-height: 1.4;
    color: #777;
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
    color: var(--text-primary, #ccc);
    font-size: 11px;
    cursor: pointer;
    font-family: inherit;
  }
  .mw-mode:hover { background: rgba(255, 255, 255, 0.08); }
  .mw-mode.active {
    background: rgba(240, 163, 94, 0.18);
    border-color: #f0a35e;
    color: #f0a35e;
  }
  .dome-dot {
    background: #79d6ff;
    box-shadow: 0 0 5px rgba(121, 214, 255, 0.8);
  }
  .dome-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    margin-top: 8px;
  }
  .dome-chip {
    min-height: 24px;
    padding: 4px 7px;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    color: #b8b2c2;
    font-size: 11px;
    font-weight: 700;
    font-family: inherit;
    cursor: pointer;
  }
  .dome-chip:hover {
    background: rgba(121, 214, 255, 0.12);
    border-color: rgba(121, 214, 255, 0.32);
    color: #cdefff;
  }
  .dome-field,
  .dome-row {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) 42px;
    align-items: center;
    gap: 6px;
    margin-top: 7px;
  }
  .dome-field {
    grid-template-columns: 74px minmax(0, 1fr);
  }
  .dome-field span,
  .dome-row span {
    color: #a29baa;
    font-size: 12px;
    font-weight: 650;
  }
  .dome-field select {
    min-width: 0;
    padding: 5px 7px;
    background: rgba(0, 0, 0, 0.28);
    border: 1px solid rgba(255, 255, 255, 0.11);
    border-radius: 4px;
    color: #e6e1ee;
    font-size: 12px;
    font-family: inherit;
  }
  .dome-row input[type="range"] {
    width: 100%;
    min-width: 0;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-primary, #050507);
    border-radius: 999px;
    accent-color: #79d6ff;
    cursor: pointer;
  }
  .dome-row input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(121, 214, 255, 0.9), rgba(187, 134, 252, 0.55));
  }
  .dome-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 50%;
    border: 2px solid #111114;
    background: #cdefff;
    box-shadow: 0 0 0 1px rgba(121, 214, 255, 0.55);
  }
  .dome-row em {
    color: #8f8998;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 11px;
    font-style: normal;
    text-align: right;
  }
  .inspector-section {
    margin-top: 12px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    padding-top: 8px;
  }
  .inspector-empty {
    padding: 24px;
    color: #666;
    font-size: 13px;
    text-align: center;
    line-height: 1.4;
  }
</style>
