<script lang="ts">
  /**
   * ScreenInspector — bottom half of the Screens left-sidebar panel.
   *
   * Renders editable controls for the currently-selected Screen:
   *   - Identity (name, target type + spout sender name OR display picker)
   *   - Warp mode (rect / corners / mesh) + reset-warp action
   *   - Edge blend per edge + per-edge gamma overrides
   *   - Black-level lift (RGB + feather)
   *   - Color correction (brightness / contrast / gamma)
   *   - Rotation
   *   - Stage effect bind (drives screen brightness from a procedural
   *     stage-effect pattern)
   *   - Per-screen effect chain (Effect[] post-process)
   *
   * All edits go through `screenActions.update(id, partial)` so the
   * settings store is the single mutation point. The Screen Editor
   * canvas overlay (in Canvas.svelte / a sibling component) reads the
   * same store, so warp-handle drags and slider edits both reflect
   * live on the editor canvas.
   */
  import ProjectorCalibrationPanel from './ProjectorCalibrationPanel.svelte';
  import { onMount } from 'svelte';
  import type { OutputSlice } from '../stores/settings';
  import { displayFingerprint, resolveStoredDisplay } from '../output/displayAssignment';
  import { screenActions, selectedScreenMaskId, screenMaskPlacing } from '../stores/screens';
  import { recordDiscreteAction, scheduleHistorySnapshot } from '../stores/historyHooks';
  import { isDesktopApp, getTextureShareLabel } from '$lib/bridge';
  import { projectionSimScene } from '../projectionSim/store';

  // Is the NDI native addon built + the NDI runtime initialized? Gates
  // the NDI transport option below. Probed once on mount (same probe
  // SettingsPanel uses); false outside Electron / without the addon.
  let ndiAvailable = $state(false);
  let ndiReason = $state('Checking NDI output support…');
  onMount(async () => {
    try {
      const r = await (window as any).ghostNDI?.outputStatus?.();
      ndiAvailable = !!r?.available;
      ndiReason = r?.reason || 'NDI output requires the desktop app and optional NDI runtime.';
    } catch { ndiAvailable = false; ndiReason = 'Could not check NDI output support. See Settings → Output → NDI Output.'; }
  });

  type DisplayInfo = {
    id: number; label: string; width: number; height: number;
    x: number; y: number; isPrimary: boolean; scaleFactor: number;
  };

  interface Props {
    screen: OutputSlice;
    displays: DisplayInfo[];
    openWindowIds: string[];
    onOpenOnDisplay: (s: OutputSlice) => void;
    onCloseOnDisplay: (s: OutputSlice) => void;
    onRefreshDisplays: () => void;
  }
  let { screen, displays, openWindowIds, onOpenOnDisplay, onCloseOnDisplay, onRefreshDisplays }: Props = $props();

  const tsLabel = getTextureShareLabel();

  // The display this Screen goes to now: its stored id, or the display its
  // fingerprint matches when Windows renumbered or swapped the ids.
  const routedDisplay = $derived(resolveStoredDisplay(displays, screen.displayId, screen.displayFingerprint));

  // A stored display that no connected display matches. The main process
  // would fall back to the primary display and cover the editor.
  const displayMissing = $derived(
    screen.displayId != null && displays.length > 0 && !routedDisplay,
  );

  // A Screen shows either a slice of the master or a Map Sim projector view.
  const mapSimProjector = $derived(
    screen.mapSimProjectorId
      ? $projectionSimScene.projectors.find((p) => p.id === screen.mapSimProjectorId) ?? null
      : null,
  );

  // Inspector edits are undoable; a slider drag or a burst of typing
  // settles into one step.
  function update(partial: Partial<OutputSlice>) {
    screenActions.update(screen.id, partial);
    scheduleHistorySnapshot(`screen:${screen.id}:${Object.keys(partial).sort().join(',')}`);
  }

  function clampNumber(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
  }

  function numberFromEvent(e: Event, fallback = 0) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : fallback;
  }

  function updateNumber(key: keyof OutputSlice, value: number, min: number, max: number) {
    update({ [key]: clampNumber(value, min, max) } as Partial<OutputSlice>);
  }

  function updatePercent(key: keyof OutputSlice, value: number, min: number, max: number) {
    updateNumber(key, value / 100, min, max);
  }

  function resetBlend() {
    update({
      edgeBlendLeft: 0,
      edgeBlendRight: 0,
      edgeBlendTop: 0,
      edgeBlendBottom: 0,
      edgeBlendGamma: 2.2,
      edgeBlendLeftGamma: undefined,
      edgeBlendRightGamma: undefined,
      edgeBlendTopGamma: undefined,
      edgeBlendBottomGamma: undefined,
    });
  }

  function setAllBlend(value: number) {
    update({
      edgeBlendLeft: value,
      edgeBlendRight: value,
      edgeBlendTop: value,
      edgeBlendBottom: value,
    });
  }

  function resetBlackLevel() {
    update({
      blackLevelR: 0,
      blackLevelG: 0,
      blackLevelB: 0,
      blackLevelFeather: 0.5,
    });
  }

  function applyColorCorrection(brightness: number, contrast: number, gamma: number) {
    update({ brightness, contrast, gamma });
  }

  function selectMask(maskId: string) {
    if ($selectedScreenMaskId !== maskId) screenMaskPlacing.set(false);
    selectedScreenMaskId.set(maskId);
  }

  const colorPresets = [
    { label: 'Neutral', brightness: 1, contrast: 1, gamma: 1 },
    { label: 'Punch', brightness: 1.05, contrast: 1.12, gamma: 1.05 },
    { label: 'Soft', brightness: 0.96, contrast: 0.92, gamma: 1.18 },
  ];
</script>

<div data-help-page="masks-slices" class="inspector">
  <!-- Identity & target ─────────────────────────────────────────── -->
  <section class="sec">
    <input
      class="name-input"
      value={screen.name}
      onchange={(e) => update({ name: (e.target as HTMLInputElement).value })}
      placeholder="Screen name"
    />

    <label class="field">
      <span class="lbl">Send to</span>
      <select
        value={screen.targetType ?? 'sender'}
        onchange={(e) => {
          const t = (e.target as HTMLSelectElement).value as 'sender' | 'display';
          update({ targetType: t, ...(t === 'sender' ? { displayId: null } : {}) });
        }}
      >
        <option value="sender">{tsLabel} / NDI® sender</option>
        <option value="display" disabled={!isDesktopApp}>Physical display</option>
      </select>
    </label>

    {#if (screen.targetType ?? 'sender') === 'sender'}
      <!-- Transport sub-select. undefined outputType = platform-local
           texture share (Syphon on macOS / Spout on Windows). 'ndi'
           engages the main-process composite NDI pump (see
           stores/screens.ts engagement subscription). -->
      <label class="field">
        <span class="lbl">Transport</span>
        <select
          value={screen.outputType === 'ndi' ? 'ndi' : 'local'}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            update({ outputType: v === 'ndi' ? 'ndi' : undefined });
          }}
        >
          <option value="local">{tsLabel} (local)</option>
          <option value="ndi" disabled={!ndiAvailable}>NDI® (full composition)</option>
        </select>
      </label>
    {/if}

    {#if !ndiAvailable}
      <p class="ndi-attribution">{ndiReason}</p>
    {:else if screen.outputType === 'ndi'}
      <p class="ndi-attribution">Sends one full composition. This screen’s crop and warp do not apply to NDI.</p>
    {/if}
    <p class="ndi-attribution">
      <a href="https://ndi.video/" target="_blank" rel="noreferrer">NDI®</a>
      is a registered trademark of Vizrt NDI AB.
    </p>

    <label class="field">
      <span class="lbl">Source</span>
      <select
        aria-label="Screen source"
        value={screen.mapSimProjectorId ?? ''}
        onchange={(e) => {
          const v = (e.target as HTMLSelectElement).value;
          update({ mapSimProjectorId: v || null });
        }}
      >
        <option value="">Slice of the output</option>
        {#each $projectionSimScene.projectors as projector (projector.id)}
          <option value={projector.id}>Map Sim: {projector.name}</option>
        {/each}
        {#if screen.mapSimProjectorId && !mapSimProjector}
          <option value={screen.mapSimProjectorId}>Map Sim: missing projector</option>
        {/if}
      </select>
    </label>
    {#if screen.mapSimProjectorId}
      <p class="hint">
        {#if mapSimProjector}
          Shows what {mapSimProjector.name} must emit: the 3D model through its lens with the content mapped on. Calibrate it in Map Sim.
        {:else}
          The Map Sim projector this Screen showed is gone. Pick another source.
        {/if}
        {#if (screen.targetType ?? 'sender') !== 'display'}
          Map Sim views render on physical display outputs; switch Send to to Physical display.
        {/if}
      </p>
    {/if}

    {#if (screen.targetType ?? 'sender') === 'display'}
      <label class="field">
        <span class="lbl">Display</span>
        <select
          value={routedDisplay?.id ?? screen.displayId ?? ''}
          onchange={(e) => {
            const v = (e.target as HTMLSelectElement).value;
            const picked = v === '' ? null : displays.find((d) => d.id === parseInt(v)) ?? null;
            update({
              displayId: v === '' ? null : parseInt(v),
              displayFingerprint: picked ? displayFingerprint(picked) : null,
            });
          }}
        >
          <option value="">— pick —</option>
          {#each displays as d}
            <option value={d.id}>{d.label || `Display ${d.id}`} ({d.width}×{d.height}{d.isPrimary ? ' · primary' : ''})</option>
          {/each}
        </select>
        <button class="icon-btn" title="Refresh display list" onclick={onRefreshDisplays}>↻</button>
      </label>
      {#if screen.displayId != null && routedDisplay?.isPrimary}
        <p class="warn-banner">
          ⚠ This is your primary display. Opening here will cover the editor. Press <kbd>Esc</kbd> in the slice window to close it.
        </p>
      {/if}
      <div class="field">
        <span class="lbl">&nbsp;</span>
        {#if openWindowIds.includes(screen.id)}
          <button class="full-btn danger" onclick={() => onCloseOnDisplay(screen)}>Close on display</button>
        {:else}
          <button class="full-btn" disabled={screen.displayId == null || displayMissing} onclick={() => onOpenOnDisplay(screen)}>Open on display</button>
        {/if}
      </div>
      {#if displayMissing}
        <p class="warn-banner">
          ⚠ The display this Screen was routed to is not connected (a project from another computer, or a projector that was re-plugged). Pick its display above, or press ↻ after connecting it. Opening now would cover this editor on the main display.
        </p>
      {/if}
    {:else}
      <label class="field">
        <span class="lbl">Sender</span>
        <input
          type="text"
          value={screen.spoutName}
          oninput={(e) => update({ spoutName: (e.target as HTMLInputElement).value })}
        />
      </label>
    {/if}
  </section>

  <!-- Slice ────────────────────────────────────────────────────────
       A Screen takes a slice of the total (master-warped) output. By
       default that slice is a rectangle; Corner pin and Mesh let one
       projector sample a skewed or curved region of the master instead
       (the core's slice_warp_uv), with Bezier tangents on the mesh.
       Geometry is dragged on the editor canvas; orientation and the warp
       shape live here. -->
  <section class="sec">
    <h4>Slice</h4>
    <div class="preset-strip" role="group" aria-label="Screen warp shape">
      {#each [['rect', 'Rectangle'], ['corners', 'Corner pin'], ['mesh', 'Mesh']] as [mode, label] (mode)}
        <button class="chip-btn" class:active={(screen.warpMode ?? 'rect') === mode}
          onclick={() => screenActions.setWarpMode(screen.id, mode as 'rect' | 'corners' | 'mesh')}>{label}</button>
      {/each}
    </div>
    {#if (screen.warpMode ?? 'rect') === 'rect'}
      <p class="hint">This screen takes a rectangular slice of the total (master-warped) output. Drag its rectangle on the canvas or the preview above to set it.</p>
    {:else}
      {#if screen.warpMode === 'mesh' && screen.meshGrid}
        <label class="field check-field">
          <input type="checkbox" aria-label="Bezier curves" checked={screen.meshGrid.bezier ?? false}
            onchange={(e) => screenActions.setMeshBezier(screen.id, (e.target as HTMLInputElement).checked)} />
          <span>Bezier curves</span>
        </label>
      {/if}
      <p class="hint">
        {screen.warpMode === 'mesh' && screen.meshGrid?.bezier
          ? 'Drag the points on the canvas. Click a point to show its curve handles: drag one to bend, Alt-drag to move it on its own, double-click to straighten.'
          : 'Drag the points on the canvas to choose what this screen samples from the master.'}
      </p>
      <div class="preset-strip">
        <button class="chip-btn" onclick={() => screenActions.resetWarp(screen.id)}>Reset warp</button>
      </div>
    {/if}
    <label class="field">
      <span class="lbl">Rotation</span>
      <select value={screen.rotation} onchange={(e) => update({ rotation: parseInt((e.target as HTMLSelectElement).value) as 0 | 90 | 180 | 270 })}>
        <option value={0}>0°</option><option value={90}>90°</option><option value={180}>180°</option><option value={270}>270°</option>
      </select>
    </label>
  </section>

  <ProjectorCalibrationPanel {screen} {displays} outputOpen={openWindowIds.includes(screen.id)} />

  <!-- Masks ─────────────────────────────────────────────────────────
       Polygon masks cut from this screen's frame after its crop and
       warp, so they stay on the surface when the screen is re-pinned.
       Geometry is edited on the canvas; this section is the list plus
       enable / invert / feather. -->
  <section class="sec controls-sec">
    <div class="section-row">
      <h4>Masks</h4>
      <button class="section-action" onclick={() => screenActions.addMask(screen.id)}>Add mask</button>
    </div>
    {#if (screen.masks ?? []).length === 0}
      <p class="hint">Add a mask, then click on the canvas to place its points. Masks keep the inside of their shape; Invert cuts a hole instead.</p>
    {:else}
      <div class="mask-list">
        {#each screen.masks ?? [] as m (m.id)}
          {@const active = $selectedScreenMaskId === m.id}
          <div class="mask-row" class:active>
            <div class="mask-head">
              <input type="checkbox" aria-label="Enable {m.name}" checked={m.enabled}
                onchange={(e) => { screenActions.updateMask(screen.id, m.id, { enabled: (e.target as HTMLInputElement).checked }); recordDiscreteAction(); }} />
              <input class="mask-name" aria-label="Mask name" value={m.name}
                onfocus={() => selectMask(m.id)}
                onchange={(e) => { screenActions.updateMask(screen.id, m.id, { name: (e.target as HTMLInputElement).value }); recordDiscreteAction(); }} />
              <button class="chip-btn" class:active={active} onclick={() => selectMask(m.id)}
                title="Show this mask's points on the canvas">Edit</button>
              <button class="icon-btn" aria-label="Delete {m.name}" title="Delete mask"
                onclick={() => screenActions.removeMask(screen.id, m.id)}>✕</button>
            </div>
            {#if active}
              <div class="preset-strip mask-tools">
                <button class="chip-btn" class:active={$screenMaskPlacing}
                  onclick={() => screenMaskPlacing.set(!$screenMaskPlacing)}>
                  {$screenMaskPlacing ? 'Done placing' : 'Place points'}
                </button>
                <button class="chip-btn" class:active={m.invert}
                  onclick={() => { screenActions.updateMask(screen.id, m.id, { invert: !m.invert }); recordDiscreteAction(); }}>Invert</button>
                <span class="mask-count" class:warn={m.points.length < 3}>
                  {m.points.length} point{m.points.length === 1 ? '' : 's'}{m.points.length < 3 ? ', needs 3' : ''}
                </span>
              </div>
              <div class="range-row">
                <span class="range-label">Feather</span>
                <input aria-label="Mask feather" type="range" min="0" max="1" step="0.01" value={m.feather}
                  oninput={(e) => { screenActions.updateMask(screen.id, m.id, { feather: numberFromEvent(e) }); scheduleHistorySnapshot(`screen-mask:${screen.id}:${m.id}:feather`); }} />
                <span class="value-wrap">
                  <input class="value-box" aria-label="Mask feather percent" type="number" min="0" max="100" step="1" value={Math.round(m.feather * 100)}
                    onchange={(e) => { screenActions.updateMask(screen.id, m.id, { feather: numberFromEvent(e) / 100 }); recordDiscreteAction(); }} />
                  <span class="unit">%</span>
                </span>
              </div>
              <p class="hint">
                {$screenMaskPlacing
                  ? 'Click on the canvas to add points. Click the first point, right-click, or press Enter to close the mask.'
                  : 'Drag points on the canvas. Click a + to add a point on that edge. Double-click a point to curve it, then drag its round handles (Alt moves one alone). Right-click or Alt-click a point to remove it.'}
              </p>
            {/if}
          </div>
        {/each}
      </div>
    {/if}
  </section>

  <!-- Edge blend ───────────────────────────────────────────────── -->
  <section class="sec controls-sec">
    <div class="section-row">
      <h4>Edge blend</h4>
      <button class="section-action" onclick={resetBlend}>Reset</button>
    </div>
    <div class="preset-strip">
      <button class="chip-btn" onclick={() => setAllBlend(0)}>Clear</button>
      <button class="chip-btn" onclick={() => setAllBlend(0.10)}>All 10%</button>
      <button class="chip-btn" onclick={() => setAllBlend(0.15)}>All 15%</button>
    </div>
    <div class="control-stack">
      <div class="range-row">
        <span class="range-label">Left edge</span>
        <input aria-label="Left edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendLeft}
          oninput={(e) => updateNumber('edgeBlendLeft', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Left edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendLeft * 100)}
            onchange={(e) => updatePercent('edgeBlendLeft', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Right edge</span>
        <input aria-label="Right edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendRight}
          oninput={(e) => updateNumber('edgeBlendRight', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Right edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendRight * 100)}
            onchange={(e) => updatePercent('edgeBlendRight', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Top edge</span>
        <input aria-label="Top edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendTop}
          oninput={(e) => updateNumber('edgeBlendTop', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Top edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendTop * 100)}
            onchange={(e) => updatePercent('edgeBlendTop', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Bottom edge</span>
        <input aria-label="Bottom edge blend" type="range" min="0" max="0.5" step="0.01" value={screen.edgeBlendBottom}
          oninput={(e) => updateNumber('edgeBlendBottom', numberFromEvent(e), 0, 0.5)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Bottom edge blend percent" type="number" min="0" max="50" step="1" value={Math.round(screen.edgeBlendBottom * 100)}
            onchange={(e) => updatePercent('edgeBlendBottom', numberFromEvent(e), 0, 0.5)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Blend curve</span>
        <input aria-label="Edge blend gamma" type="range" min="1" max="4" step="0.1" value={screen.edgeBlendGamma}
          oninput={(e) => updateNumber('edgeBlendGamma', numberFromEvent(e, 2.2), 1, 4)} />
        <span class="value-wrap no-unit">
          <input class="value-box" aria-label="Edge blend gamma value" type="number" min="1" max="4" step="0.1" value={screen.edgeBlendGamma.toFixed(1)}
            onchange={(e) => updateNumber('edgeBlendGamma', numberFromEvent(e, 2.2), 1, 4)} />
        </span>
      </div>
    </div>
  </section>

  <!-- Black level ─────────────────────────────────────────────── -->
  <section class="sec controls-sec">
    <div class="section-row">
      <h4>Black-level lift</h4>
      <button class="section-action" onclick={resetBlackLevel}>Reset</button>
    </div>
    <div class="control-stack">
      <div class="range-row">
        <span class="range-label"><span class="swatch red"></span>Red floor</span>
        <input aria-label="Red black-level lift" type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelR ?? 0}
          oninput={(e) => updateNumber('blackLevelR', numberFromEvent(e), 0, 0.1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Red black-level lift percent" type="number" min="0" max="10" step="0.1" value={((screen.blackLevelR ?? 0) * 100).toFixed(1)}
            onchange={(e) => updatePercent('blackLevelR', numberFromEvent(e), 0, 0.1)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label"><span class="swatch green"></span>Green floor</span>
        <input aria-label="Green black-level lift" type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelG ?? 0}
          oninput={(e) => updateNumber('blackLevelG', numberFromEvent(e), 0, 0.1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Green black-level lift percent" type="number" min="0" max="10" step="0.1" value={((screen.blackLevelG ?? 0) * 100).toFixed(1)}
            onchange={(e) => updatePercent('blackLevelG', numberFromEvent(e), 0, 0.1)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label"><span class="swatch blue"></span>Blue floor</span>
        <input aria-label="Blue black-level lift" type="range" min="0" max="0.1" step="0.001" value={screen.blackLevelB ?? 0}
          oninput={(e) => updateNumber('blackLevelB', numberFromEvent(e), 0, 0.1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Blue black-level lift percent" type="number" min="0" max="10" step="0.1" value={((screen.blackLevelB ?? 0) * 100).toFixed(1)}
            onchange={(e) => updatePercent('blackLevelB', numberFromEvent(e), 0, 0.1)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Feather</span>
        <input aria-label="Black-level feather" type="range" min="0" max="1" step="0.01" value={screen.blackLevelFeather ?? 0.5}
          oninput={(e) => updateNumber('blackLevelFeather', numberFromEvent(e, 0.5), 0, 1)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Black-level feather percent" type="number" min="0" max="100" step="1" value={Math.round((screen.blackLevelFeather ?? 0.5) * 100)}
            onchange={(e) => updatePercent('blackLevelFeather', numberFromEvent(e, 50), 0, 1)} />
          <span class="unit">%</span>
        </span>
      </div>
    </div>
  </section>

  <!-- Color correction ─────────────────────────────────────────── -->
  <section class="sec controls-sec color-sec">
    <div class="section-row">
      <h4>Color correction</h4>
      <button class="section-action" onclick={() => applyColorCorrection(1, 1, 1)}>Reset</button>
    </div>
    <div class="preset-strip">
      {#each colorPresets as preset}
        <button
          class="chip-btn"
          class:active={screen.brightness === preset.brightness && screen.contrast === preset.contrast && screen.gamma === preset.gamma}
          onclick={() => applyColorCorrection(preset.brightness, preset.contrast, preset.gamma)}
        >
          {preset.label}
        </button>
      {/each}
    </div>
    <div class="control-stack">
      <div class="range-row">
        <span class="range-label">Brightness</span>
        <input aria-label="Brightness" type="range" min="0" max="2" step="0.01" value={screen.brightness}
          oninput={(e) => updateNumber('brightness', numberFromEvent(e, 1), 0, 2)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Brightness percent" type="number" min="0" max="200" step="1" value={(screen.brightness * 100).toFixed(0)}
            onchange={(e) => updatePercent('brightness', numberFromEvent(e, 100), 0, 2)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Contrast</span>
        <input aria-label="Contrast" type="range" min="0" max="2" step="0.01" value={screen.contrast}
          oninput={(e) => updateNumber('contrast', numberFromEvent(e, 1), 0, 2)} />
        <span class="value-wrap">
          <input class="value-box" aria-label="Contrast percent" type="number" min="0" max="200" step="1" value={(screen.contrast * 100).toFixed(0)}
            onchange={(e) => updatePercent('contrast', numberFromEvent(e, 100), 0, 2)} />
          <span class="unit">%</span>
        </span>
      </div>
      <div class="range-row">
        <span class="range-label">Gamma</span>
        <input aria-label="Gamma" type="range" min="0.2" max="5" step="0.05" value={screen.gamma}
          oninput={(e) => updateNumber('gamma', numberFromEvent(e, 1), 0.2, 5)} />
        <span class="value-wrap no-unit">
          <input class="value-box" aria-label="Gamma value" type="number" min="0.2" max="5" step="0.05" value={screen.gamma.toFixed(2)}
            onchange={(e) => updateNumber('gamma', numberFromEvent(e, 1), 0.2, 5)} />
        </span>
      </div>
    </div>
  </section>

</div>

<style>
  .inspector {
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .sec {
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    padding: 8px;
  }
  /* Section labels: the eyebrow style. */
  .sec > h4,
  .section-row h4 {
    margin: 0;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #8b93a2);
  }
  .sec > h4 {
    margin-bottom: 8px;
  }
  .section-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  }
  .section-action {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #a9a4b4);
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    font-family: inherit;
    cursor: pointer;
  }
  .section-action:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
  .name-input {
    width: 100%;
    height: 30px;
    padding: 0 8px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.28));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #f0edf6);
    font-size: var(--ga-text-title, 14px);
    font-weight: var(--ga-weight-control, 600);
    margin-bottom: 8px;
    font-family: inherit;
  }
  .name-input:focus,
  .field input:focus,
  .field select:focus,
  .value-box:focus {
    outline: none;
    border-color: var(--ga-focus, #8aa4ff);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--ga-focus, #8aa4ff) 25%, transparent);
  }
  .field {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .field:last-child { margin-bottom: 0; }
  .field.check-field {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #a29baa);
    cursor: pointer;
  }
  .field .lbl {
    flex: 0 0 66px;
    color: var(--ga-ink-1, #918b9b);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
  }
  .field input[type="text"],
  .field input[type="number"],
  .field select {
    flex: 1;
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
  .icon-btn {
    min-width: var(--ga-control-h, 26px);
    height: var(--ga-control-h, 26px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #c9c3d2);
    cursor: pointer;
    padding: 0 6px;
    font-size: var(--ga-text-control, 12px);
  }
  .icon-btn:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
  .full-btn {
    flex: 1;
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    color: var(--ga-ink-0, #eef0f4);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    font-family: inherit;
  }
  .full-btn:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .full-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .full-btn.ghost {
    background: transparent;
    color: var(--ga-ink-2, #888);
    border-color: var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .full-btn.danger {
    background: color-mix(in srgb, var(--ga-rec, #ff4438) 8%, transparent);
    border-color: color-mix(in srgb, var(--ga-rec, #ff4438) 35%, transparent);
    color: var(--ga-rec, #ff8080);
  }
  .hint {
    margin: 4px 0 0 0;
    color: var(--ga-ink-2, #7a7481);
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
  }
  .controls-sec {
    padding: 8px;
  }
  .preset-strip {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 8px;
  }
  .chip-btn {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #b8b2c2);
    font-size: var(--ga-text-meta, 11px);
    font-family: inherit;
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .chip-btn:hover:not(.active) {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
  .chip-btn.active {
    background: var(--ga-selection-bg, rgba(82, 120, 255, 0.16));
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .control-stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .range-row {
    display: grid;
    grid-template-columns: 76px minmax(64px, 1fr) 58px;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }
  .range-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--ga-ink-1, #a29baa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
    min-width: 0;
    white-space: nowrap;
  }
  .range-row input[type="range"] {
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
  .range-row input[type="range"]::-webkit-slider-runnable-track {
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ga-selection-line, #5278ff) 70%, transparent);
  }
  .range-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 12px;
    height: 12px;
    margin-top: -4px;
    border-radius: 50%;
    border: 2px solid var(--ga-panel, #111114);
    background: var(--ga-ink-0, #f2ede4);
    box-shadow: 0 0 0 1px var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
  .range-row input[type="range"]::-moz-range-track {
    height: 4px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ga-selection-line, #5278ff) 70%, transparent);
  }
  .range-row input[type="range"]::-moz-range-thumb {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 2px solid var(--ga-panel, #111114);
    background: var(--ga-ink-0, #f2ede4);
  }
  .value-wrap {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 2px;
    min-width: 0;
  }
  .value-wrap.no-unit {
    justify-content: flex-end;
  }
  .value-box {
    width: 43px;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 4px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.35));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #e7e1ef);
    font-size: var(--ga-text-meta, 11px);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    text-align: right;
  }
  .no-unit .value-box {
    width: 54px;
  }
  .unit {
    width: 11px;
    color: var(--ga-ink-2, #77717d);
    font-size: var(--ga-text-meta, 11px);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .mask-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mask-row {
    border: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .mask-row.active {
    border-color: var(--ga-selection-line, #5278ff);
    background: color-mix(in srgb, var(--ga-selection-bg, #1f3170) 40%, transparent);
  }
  .mask-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mask-head input[type="checkbox"] {
    accent-color: var(--ga-selection-line, #5278ff);
    margin: 0;
  }
  .mask-name {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 6px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.28));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #e6e1ee);
    font-size: var(--ga-text-control, 12px);
    font-family: inherit;
  }
  .mask-head .icon-btn {
    min-width: var(--ga-control-h-sm, 22px);
    height: var(--ga-control-h-sm, 22px);
  }
  .mask-tools {
    align-items: center;
    margin-bottom: 0;
  }
  .mask-count {
    color: var(--ga-ink-2, #8f8998);
    font-size: var(--ga-text-meta, 11px);
    margin-left: auto;
  }
  .mask-count.warn {
    color: #ffc875;
  }
  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    display: inline-block;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.12);
  }
  .swatch.red { background: #ff6b6b; }
  .swatch.green { background: #77d98b; }
  .swatch.blue { background: var(--ga-blue-300); }
  .warn-banner {
    margin: 6px 0 0 0;
    padding: 6px 8px;
    background: rgba(255, 180, 60, 0.12);
    border: 1px solid rgba(255, 180, 60, 0.35);
    border-radius: var(--ga-r-hard, 4px);
    color: #ffc875;
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
  }
  .warn-banner kbd {
    background: rgba(255, 255, 255, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    padding: 0 5px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
  }
  .ndi-attribution {
    margin: -2px 0 4px;
    color: var(--ga-ink-2, #77717d);
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.4;
  }
  .ndi-attribution a {
    color: var(--ga-ink-1, #c9c3d2);
    text-decoration: underline;
    text-decoration-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
  .ndi-attribution a:hover {
    color: var(--ga-ink-0, #fff);
  }
</style>
