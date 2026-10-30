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
  import { screenOutputError } from '../stores/screenOutputStatus';
  import { screens, selectedScreenId, selectedScreen, screenActions } from '../stores/screens';
  import { settings, identityOutputMesh, masterWarpIsActive, type OutputSettings, type OutputSlice } from '../stores/settings';
  import { maxOutputSlices } from '../stores/license';
  import { screenSetups } from '../stores/screenSetups';
  import { recordDiscreteAction, scheduleHistorySnapshot } from '../stores/historyHooks';
  import { isDesktopApp, getTextureShareLabel, invoke } from '$lib/bridge';
  import { displayFingerprint, resolveStoredDisplay } from '../output/displayAssignment';
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
      const next = ((await invoke('get_displays')) as DisplayInfo[]) || [];
      // Polled, so only touch the list (and the pickers bound to it) on a real change.
      if (JSON.stringify(next) !== JSON.stringify(displays)) displays = next;
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
  onMount(() => {
    refreshOpenWindows();
    // A screen window can also close on its own (Esc in the window, or the
    // display going away), so keep the Open / Close button honest.
    // Displays too: a projector plugged in after the panel opened should
    // appear in the picker (and size the calibration editor) without ↻.
    const poll = setInterval(() => { void refreshOpenWindows(); void refreshDisplays(); }, 2000);
    return () => clearInterval(poll);
  });

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
    // Windows renumbers displays on a re-plug, and can give the projector's
    // old id to another display. Re-resolve against what is connected now,
    // and keep the Screen pointed at the display it was set up for.
    await refreshDisplays();
    const target = resolveStoredDisplay(displays, s.displayId, s.displayFingerprint);
    if (target && (target.id !== s.displayId || !s.displayFingerprint)) {
      screenActions.update(s.id, { displayId: target.id, displayFingerprint: displayFingerprint(target) });
    }
    // Always use the native Screen texture. The legacy VideoFrame window
    // bypasses destination calibration, source warp and screen masks.
    try {
      const result = await invoke<{ ok: boolean; error?: string }>('output_open_slice_window', {
        sliceId: s.id, displayId: target?.id ?? s.displayId,
      });
      if (!result?.ok) throw new Error(result?.error || 'Screen output could not open.');
      screenOutputError.set(null);
      // The render core starts drawing this Screen now, not at its next poll.
      window.dispatchEvent(new CustomEvent('ghost:slice-windows-changed'));
    } catch (error) {
      screenOutputError.set(error instanceof Error ? error.message : String(error));
    }
    await refreshOpenWindows();
  }
  async function closeOnDisplay(s: OutputSlice) {
    if (!isDesktopApp) return;
    await invoke('output_close_slice_window', { sliceId: s.id }).catch(() => {});
    window.dispatchEvent(new CustomEvent('ghost:slice-windows-changed'));
    await refreshOpenWindows();
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

  // A selected screen's handles sit above the Master Warp handles and
  // coincide with them (a full-canvas screen's corners and mesh points
  // are the master's), and nothing else clears the selection. Working the
  // Master Warp controls hands the canvas to the master handles; clicking
  // a screen row brings its handles back.
  function focusMasterWarp() {
    selectedScreenId.set(null);
  }

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
      focusMasterWarp();
    } else {
      settings.setMasterWarp({ enabled: false });
    }
    recordDiscreteAction();
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
    focusMasterWarp();
    recordDiscreteAction();
  }
  function resetMasterWarp() {
    // Back to identity. Corners: clear so nothing is stored (handles
    // derive identity); Mesh: reset to a flat lattice so its handles
    // remain visible, still in Bezier mode if it was.
    if (masterMode === 'mesh') {
      const bezier = masterWarp.meshGrid?.bezier ? { bezier: true } : {};
      settings.setMasterWarp({ meshGrid: { ...identityOutputMesh(), ...bezier } });
    } else settings.setMasterWarp({ corners: undefined });
    focusMasterWarp();
    recordDiscreteAction();
  }
  /** Bezier mesh: curved cell edges shaped by tangent handles on the
   *  selected point. Off keeps the tangents but renders straight. */
  function setMasterBezier(bezier: boolean) {
    if (!masterWarp.meshGrid) return;
    settings.setMasterWarp({ meshGrid: { ...masterWarp.meshGrid, bezier } });
    focusMasterWarp();
    recordDiscreteAction();
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

  // ─── Saved screen setups ────────────────────────────────────────────
  // New Project clears the output stage so a project cannot inherit the last
  // one's screens or a latched dome. That is right for a laptop moving
  // between gigs and wrong for a permanent install, where the rig belongs to
  // the room. A saved default is what New Project restores instead.
  let newSetupName = '';
  let setupFeedback = '';
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null;

  function flashFeedback(message: string) {
    setupFeedback = message;
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { setupFeedback = ''; }, 2600);
  }

  function saveCurrentSetup() {
    const entry = screenSetups.save(newSetupName || `Setup ${$screenSetups.saved.length + 1}`);
    newSetupName = '';
    flashFeedback(`Saved "${entry.name}"`);
  }

  function makeCurrentDefault() {
    const entry = screenSetups.setCurrentAsDefault(newSetupName || 'Default screen setup');
    newSetupName = '';
    flashFeedback(`New projects will start from "${entry.name}"`);
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

<div data-help-page="masks-slices" class="screen-panel">
  {#if $screenOutputError}
    <div class="screen-output-error" role="alert">
      <strong>Output change not applied</strong>
      <span>{$screenOutputError}</span>
      <span>Previously active outputs are preserved.</span>
    </div>
  {/if}
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
        onChange={(id, partial) => { screenActions.update(id, partial); scheduleHistorySnapshot(`screen:${id}:${Object.keys(partial).sort().join(',')}`); }}
      />
    </div>

    <!-- Quick-setup presets, only when there are no screens yet -->
    {#if $screens.length === 0}
      <div class="preset-row">
        <button class="preset-btn" onclick={() => screenActions.applyPreset('2-wide')}>2-wide</button>
        <button class="preset-btn" onclick={() => screenActions.applyPreset('3-wide')} disabled={$maxOutputSlices < 3}>3-wide</button>
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
            onchange={(e) => { screenActions.update(s.id, { enabled: (e.target as HTMLInputElement).checked }); recordDiscreteAction(); }}
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
      <button class="add-btn" onclick={add} disabled={$screens.length >= $maxOutputSlices}>+ Add screen</button>
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
            Edge / corners
          </button>
          <button class="mw-mode" class:active={masterMode === 'mesh'} onclick={() => setMasterMode('mesh')}>
            Mesh
          </button>
        </div>
        {#if masterMode === 'mesh' && masterWarp.meshGrid}
          <label class="mw-enable">
            <input
              type="checkbox"
              checked={masterWarp.meshGrid.bezier ?? false}
              onchange={(e) => setMasterBezier((e.target as HTMLInputElement).checked)}
            />
            <span>Bezier curves</span>
          </label>
        {/if}
        <div class="mw-hint">
          {masterMode === 'mesh' && masterWarp.meshGrid?.bezier
            ? 'Drag the orange handles on the canvas. Click a point to show its curve handles: drag one to bend, Alt-drag to move it on its own, double-click to straighten.'
            : 'Drag the orange handles on the canvas to warp the whole output.'}
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

    <!-- Saved setups. Sits after the rig controls because it acts on all of
         them at once: what is saved is the whole output stage, not one screen. -->
    <details class="master-details" open={$screenSetups.defaultSetup !== null}>
      <summary>
        Screen setups
        {#if $screenSetups.defaultSetup}<span class="mw-active-dot" title="A default setup is set"></span>{/if}
      </summary>

      <p class="setup-hint">
        New projects start from a clean output stage. Save this rig as the default
        and they will start from it instead. Useful for an installed dome or
        projector wall that does not change between shows.
      </p>

      <div class="master-row">
        <input
          type="text"
          class="setup-name"
          placeholder="Name this setup"
          bind:value={newSetupName}
        />
      </div>
      <div class="master-row">
        <button class="mini-btn" onclick={makeCurrentDefault}>Make default</button>
        <button class="mini-btn" onclick={saveCurrentSetup}>Save setup</button>
      </div>

      {#if $screenSetups.defaultSetup}
        <div class="setup-default-row">
          <span class="setup-default-label">
            New projects use <strong>{$screenSetups.defaultSetup.name}</strong>
            <span class="setup-summary">{$screenSetups.defaultSetup.summary}</span>
          </span>
          <button class="row-act" title="Back to factory defaults" onclick={() => { screenSetups.clearDefault(); flashFeedback('New projects will start clean'); }}>Clear</button>
        </div>
      {/if}

      {#if $screenSetups.saved.length > 0}
        <div class="setup-list">
          {#each $screenSetups.saved as entry (entry.id)}
            <div class="setup-row">
              <span class="setup-row-name" title={entry.summary}>
                {entry.name}
                <span class="setup-summary">{entry.summary}</span>
              </span>
              <button class="mini-btn" onclick={() => { screenSetups.load(entry.id); recordDiscreteAction(); flashFeedback(`Loaded "${entry.name}"`); }}>Load</button>
              <button
                class="mini-btn"
                title="Start new projects from this setup"
                onclick={() => { screenSetups.setDefaultFromSaved(entry.id); flashFeedback(`New projects will start from "${entry.name}"`); }}
              >Default</button>
              <button class="row-act danger" title="Delete" onclick={() => screenSetups.remove(entry.id)}>×</button>
            </div>
          {/each}
        </div>
      {/if}

      {#if setupFeedback}
        <div class="setup-feedback">{setupFeedback}</div>
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
  .screen-output-error { display: grid; gap: 5px; margin: 8px; padding: 10px; border: 1px solid #9c7139; border-radius: var(--ga-r-hard, 5px); background: #241e16; color: #e8d5b5; font-size: var(--ga-text-meta, 11px); line-height: 1.4; }
  .screen-output-error strong { font-weight: 600; }

  .screen-panel {
    width: 280px;
    background: var(--ga-panel, #111114);
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    color: var(--ga-ink-0, #eee);
    font-size: var(--ga-text-body, 13px);
    height: 100%;
    overflow: auto;
  }
  .screens-section {
    display: flex;
    flex-direction: column;
    min-height: 100%;
    padding: 10px 12px 12px;
  }
  /* Eyebrow + count. */
  .section-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #888);
    margin-bottom: 8px;
  }
  .section-count {
    color: var(--ga-ink-2, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    letter-spacing: 0;
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
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #ccc);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .preset-btn:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .preset-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .screen-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .screen-row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 32px;
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #ddd);
    font-size: var(--ga-text-body, 13px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    width: 100%;
    text-align: left;
    font-family: inherit;
  }
  .screen-row:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .screen-row.selected {
    background: var(--ga-selection-bg, rgba(82, 120, 255, 0.16));
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-ink-0, #fff);
  }
  .screen-row.disabled .row-name { opacity: 0.45; text-decoration: line-through; }
  .row-handle {
    color: var(--ga-ink-3, #555);
    cursor: grab;
    font-size: var(--ga-text-meta, 11px);
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
    font-size: var(--ga-text-meta, 11px);
    font-weight: 500;
    color: var(--ga-ink-2, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    background: rgba(255, 255, 255, 0.04);
    padding: 1px 4px;
    border-radius: 2px;
  }
  .row-act {
    background: transparent;
    border: none;
    color: var(--ga-ink-2, #888);
    cursor: pointer;
    padding: 0 4px;
    font-size: 14px;
    line-height: 1;
  }
  .row-act:hover { color: var(--ga-ink-0, #fff); }
  .row-act.danger:hover { color: var(--ga-rec, #ff6464); }

  .add-row { margin-top: 8px; }
  .add-btn {
    width: 100%;
    height: var(--ga-control-h, 26px);
    padding: 0 10px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    color: var(--ga-ink-0, #eef0f4);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    font-family: inherit;
  }
  .add-btn:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .add-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .setup-hint {
    margin: 6px 0 8px;
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
    color: var(--ga-ink-2, #6b7280);
  }
  .setup-name {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #d1d5db);
    font-size: var(--ga-text-control, 12px);
    padding: 0 8px;
  }
  .setup-default-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    padding: 6px;
    border: 1px solid color-mix(in srgb, var(--ga-green, #46d18a) 35%, transparent);
    border-radius: var(--ga-r-hard, 3px);
    background: color-mix(in srgb, var(--ga-green, #46d18a) 7%, transparent);
  }
  .setup-default-label {
    flex: 1;
    min-width: 0;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #9ca3af);
  }
  .setup-default-label strong { color: var(--ga-ink-0, #d1d5db); }
  .setup-summary {
    display: block;
    font-size: var(--ga-text-meta, 11px);
    font-weight: 500;
    color: var(--ga-ink-2, #6b7280);
  }
  .setup-list {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .setup-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
  }
  .setup-row-name {
    flex: 1;
    min-width: 0;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-0, #d1d5db);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .setup-feedback {
    margin-top: 8px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-green, #46d18a);
  }

  /* Collapsible rig sections. The summary keeps the app-wide disclosure
     style (an eyebrow with a chevron); this only sets its box. */
  .master-details {
    margin-top: 8px;
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    border-radius: var(--ga-r-hard, 4px);
  }
  .master-details[open] { padding-bottom: 8px; }
  .master-details summary {
    min-height: 30px;
    padding: 0;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2, #888);
  }
  .master-details summary:hover { color: var(--ga-ink-0, #eef0f4); }
  .master-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .master-num {
    width: 70px;
    height: var(--ga-control-h, 26px);
    padding: 0 6px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.3));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #ddd);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-control, 12px);
  }
  .dim-x { color: var(--ga-ink-2, #666); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .mini-btn {
    flex: 1;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #ccc);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    font-family: inherit;
    white-space: nowrap;
  }
  .mini-btn:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .mini-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  /* ── Master warp ──────────────────────────────────────────────── */
  /* Orange matches the master-warp handles drawn on the canvas. */
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
    gap: 8px;
    margin-top: 6px;
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #ccc);
    cursor: pointer;
  }
  .mw-enable input { margin: 0; cursor: pointer; }
  .mw-hint {
    margin-top: 6px;
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
    color: var(--ga-ink-2, #777);
  }
  .mw-modes {
    display: flex;
    gap: 6px;
    margin-top: 8px;
  }
  .mw-mode {
    flex: 1;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #ccc);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    font-family: inherit;
  }
  .mw-mode:hover:not(.active) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .mw-mode.active {
    background: var(--ga-selection-bg, rgba(82, 120, 255, 0.16));
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .dome-dot {
    background: var(--ga-blue-300);
    box-shadow: 0 0 5px color-mix(in srgb, var(--ga-blue-300) 80%, transparent);
  }
  .dome-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .dome-chip {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #b8b2c2);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    font-family: inherit;
    cursor: pointer;
  }
  .dome-chip:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
  .dome-field,
  .dome-row {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) 42px;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .dome-field {
    grid-template-columns: 74px minmax(0, 1fr);
  }
  .dome-field span,
  .dome-row span {
    color: var(--ga-ink-1, #a29baa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
  }
  .dome-field select {
    min-width: 0;
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.28));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #e6e1ee);
    font-size: var(--ga-text-control, 12px);
    font-family: inherit;
  }
  .dome-row input[type="range"] {
    width: 100%;
    min-width: 0;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--ga-slot, #050507);
    border-radius: 999px;
    accent-color: var(--ga-selection-line, #5278ff);
    cursor: pointer;
  }
  .dome-row input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ga-selection-line, #5278ff) 70%, transparent);
  }
  .dome-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 50%;
    border: 2px solid var(--ga-panel, #111114);
    background: var(--ga-ink-0, #f2ede4);
    box-shadow: 0 0 0 1px var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
  .dome-row em {
    color: var(--ga-ink-1, #8f8998);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    font-style: normal;
    text-align: right;
  }
  .inspector-section {
    margin-top: 12px;
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    padding-top: 8px;
  }
  .inspector-empty {
    padding: 20px 12px;
    color: var(--ga-ink-2, #666);
    font-size: var(--ga-text-meta, 11px);
    text-align: center;
    line-height: 1.5;
  }
</style>
