<script lang="ts">
  /**
   * Ghost Stage — 3D stage designer panel.
   *
   * Top bar:    tool segment (move/rotate/scale), snap, undo/redo,
   *             venue picker, PA preset dropdown, top/frame/save/load/clear.
   * Left rail:  element library (Stage / Lighting / Audio groups).
   * Right rail: inspector for the selected screen or element.
   *
   * LED screens auto-sync from the project's screen layers; everything
   * else is user-placed via the library. Press H to hide all panels.
   */
  import { onMount, onDestroy } from 'svelte';
  import {
    stage3dScene,
    selectedStage3DNodeId,
    selectedStage3DTargets,
    stage3DGizmoMode,
    stage3DRendererControls,
    historyVersion,
    parseSelection,
    setStage3DSelection,
    toggleStage3DSelection,
    setStage3DMultiSelection,
  } from '../../stage3d/store';
  import { project } from '../../stores/layers';
  import { ELEMENT_TYPES, makeUserElement } from '../../stage3d/elementTypes';
  import { buildVenue, paPresetElements, type PAPreset } from '../../stage3d/venues';
  import type { Stage3DVenue, UserStageElement } from '../../stage3d/types';
  import { startRecording as startCanvasRecording, formatRecordingDuration, type RecorderHandle } from '../../recording/recorder';
  import StageNodeProperties from './StageNodeProperties.svelte';
  import StageElementProperties from './StageElementProperties.svelte';
  import StageLightingPanel from './StageLightingPanel.svelte';

  /** When false, this component renders only the floating UI overlay;
   *  the viewport comes from Canvas.svelte's stage3DOutput mode. */
  export let renderViewport = true;
  export let onClose: () => void;

  let snapOn = false;
  let toastMessage = '';
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let panelsHidden = false;
  let recorderHandle: RecorderHandle | null = null;
  let recordingDuration = 0;
  let isRecording = false;

  // Refresh undo/redo button state whenever historyVersion bumps.
  let canUndo = false;
  let canRedo = false;
  $: { void $historyVersion; const c = stage3dScene.getHistoryCounts(); canUndo = c.past > 0; canRedo = c.future > 0; }

  $: screenLayers = $project.layers.filter(l => l.type === 'screen' && l.visible !== false);
  $: userElements = $stage3dScene.userElements ?? [];
  $: venue = ($stage3dScene.venue ?? 'festival') as Stage3DVenue;
  $: selection = parseSelection($selectedStage3DNodeId);
  $: selectedScreen = selection?.kind === 'screen'
    ? screenLayers.find(l => l.id === selection!.id) : null;
  $: selectedElement = selection?.kind === 'element'
    ? userElements.find(e => e.id === selection!.id) : null;

  function setVenue(v: Stage3DVenue) {
    stage3dScene.setVenue(v);
    toast(`Venue: ${v}`);
  }

  function addElement(type: string) {
    const def = ELEMENT_TYPES[type];
    if (!def) return;
    const el = makeUserElement(type);
    // Lighting placed at ~9m so it spawns near the rig height, others
    // on the ground. Position roughly under the camera target instead
    // of (0, 0, 0) so multiple adds don't stack.
    el.position = [0, def.group === 'Lighting' ? 9 : 0, 0];
    stage3dScene.addUserElement(el);
    setStage3DSelection(`element:${el.id}`);
    toast(`${def.label} added`);
  }

  function applyPAPreset(kind: PAPreset) {
    const venueBuild = buildVenue(venue);
    const elements = paPresetElements(kind, venueBuild);
    for (const el of elements) stage3dScene.addUserElement(el);
    toast(`PA preset added`);
  }

  let onPASelect: (e: Event) => void;
  onPASelect = (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    if (!v) return;
    applyPAPreset(v as PAPreset);
    (e.target as HTMLSelectElement).value = '';
  };

  function setGizmoMode(mode: 'translate' | 'rotate' | 'scale') {
    stage3DGizmoMode.set(mode);
  }

  function toggleSnap() {
    snapOn = !snapOn;
    $stage3DRendererControls?.setSnap(snapOn);
  }

  function clearElements() {
    if (!userElements.length) return;
    if (confirm(`Clear all ${userElements.length} placed elements?`)) {
      stage3dScene.clearUserElements();
      setStage3DSelection(null);
      toast('Cleared');
    }
  }

  /** Save the whole Ghost Stage design — 3D scene PLUS the project's
   *  screen layers + surface slices so loading the file later restores
   *  both the 3D viewport AND the matching 2D mapper layout. Other
   *  project layers (videos, shaders, etc.) are left out so loading a
   *  stage into a different project doesn't blow away unrelated work. */
  function saveDesign() {
    const proj = $project;
    const screenLayers = proj.layers.filter(l => l.type === 'screen');
    const bundle = {
      format: 'ghost-stage',
      version: 1,
      name: proj.name ?? 'Untitled Stage',
      savedAt: Date.now(),
      stage3d: JSON.parse(stage3dScene.exportJSON()),
      project: {
        name: proj.name,
        width: proj.width,
        height: proj.height,
        screenLayers,
        surfaces: proj.surfaces ?? [],
      },
    };
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(proj.name || 'stage-design').replace(/[^a-z0-9-_ ]/gi, '_')}.ghost-stage.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Stage saved');
  }

  let fileInput: HTMLInputElement;
  function loadDesign() { fileInput?.click(); }
  function onFileChosen(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      const text = rd.result as string;
      const ok = applyStageBundle(text);
      toast(ok ? 'Stage loaded' : 'Invalid file');
    };
    rd.readAsText(file);
    (e.target as HTMLInputElement).value = '';
  }

  /** Apply a saved bundle. Falls back to the legacy `.stage.json` shape
   *  (just a Stage3DScene) for files saved before the bundling work. */
  function applyStageBundle(text: string): boolean {
    try {
      const data = JSON.parse(text);
      // Modern bundle: replace 3D + merge screen layers into project.
      if (data?.format === 'ghost-stage' && data.stage3d) {
        stage3dScene.loadScene(data.stage3d);
        if (data.project?.screenLayers) {
          project.update(p => ({
            ...p,
            // Replace screens but keep every non-screen layer the user
            // already has (videos, shaders, lights, etc.).
            layers: [
              ...p.layers.filter(l => l.type !== 'screen'),
              ...data.project.screenLayers,
            ],
            surfaces: Array.isArray(data.project.surfaces) && data.project.surfaces.length
              ? data.project.surfaces
              : p.surfaces,
          }));
        }
        return true;
      }
      // Legacy: bare Stage3DScene.
      return stage3dScene.importJSON(text);
    } catch {
      return false;
    }
  }

  function toast(msg: string) {
    toastMessage = msg;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toastMessage = ''), 1600);
  }

  function getStageCanvas(): HTMLCanvasElement | null {
    const popoutCanvas = document.querySelector('.stage3d-window canvas.main-canvas') as HTMLCanvasElement | null;
    const fallbackCanvas = document.querySelector('canvas.main-canvas') as HTMLCanvasElement | null;
    return popoutCanvas ?? fallbackCanvas;
  }

  function startStageRecording() {
    if (recorderHandle) return;
    recordingDuration = 0;
    recorderHandle = startCanvasRecording({
      namePrefix: 'Stage Recording',
      canvas: getStageCanvas,
      onDurationUpdate: (s) => { recordingDuration = s; },
      onComplete: () => {
        isRecording = false;
        recorderHandle = null;
        toast('Stage recording saved');
      },
      onError: (err) => {
        isRecording = false;
        recorderHandle = null;
        toast(err.message || 'Recording failed');
      },
    });
    if (recorderHandle) {
      isRecording = true;
      toast('Stage recording started');
    }
  }

  function stopStageRecording() {
    if (!recorderHandle) return;
    recorderHandle.stop();
    recorderHandle = null;
    isRecording = false;
  }

  function toggleStageRecording() {
    if (isRecording) stopStageRecording();
    else startStageRecording();
  }

  // Library grouped by category.
  $: libraryGroups = (() => {
    const groups: Record<string, [string, typeof ELEMENT_TYPES[string]][]> = {};
    for (const [type, def] of Object.entries(ELEMENT_TYPES)) {
      (groups[def.group] = groups[def.group] || []).push([type, def]);
    }
    return ['Stage', 'Lighting', 'Audio'].map(g => ({ name: g, items: groups[g] ?? [] }));
  })();

  function undo() { stage3dScene.undo(); }
  function redo() { stage3dScene.redo(); }
  function togglePanels() { panelsHidden = !panelsHidden; }

  // ── Copy / paste ────────────────────────────────────────────────
  // Module-local clipboard for selected user-placed elements. Scenery
  // and screens are owned by the venue / 2D designer respectively, so
  // they're intentionally NOT copied — those don't make sense to
  // duplicate (you can't have two stage backdrops). Clipboard is per
  // window: cross-window paste isn't a goal here.
  let elementClipboard: UserStageElement[] = [];

  function copySelection() {
    const sel = $selectedStage3DTargets;
    if (!sel.size) { toast('Nothing selected to copy'); return; }
    const elements = userElements;
    const copies: UserStageElement[] = [];
    for (const key of sel) {
      const s = parseSelection(key);
      if (s?.kind !== 'element') continue;
      const el = elements.find(e => e.id === s.id);
      if (el) copies.push(JSON.parse(JSON.stringify(el)));
    }
    if (!copies.length) { toast('Only library elements can be copied'); return; }
    elementClipboard = copies;
    toast(`Copied ${copies.length} element${copies.length === 1 ? '' : 's'}`);
  }

  function pasteSelection() {
    if (!elementClipboard.length) { toast('Clipboard empty'); return; }
    const newIds: string[] = [];
    for (const original of elementClipboard) {
      const clone: UserStageElement = {
        ...JSON.parse(JSON.stringify(original)),
        id: `el-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        // Offset so pasted copies don't sit on top of the originals.
        position: [original.position[0] + 3, original.position[1], original.position[2] + 3],
      };
      stage3dScene.addUserElement(clone);
      newIds.push(`element:${clone.id}`);
    }
    setStage3DMultiSelection(newIds);
    toast(`Pasted ${newIds.length} element${newIds.length === 1 ? '' : 's'}`);
  }

  // Window-level shortcuts for Cmd/Ctrl-Z undo, Shift-Cmd-Z (or Ctrl-Y)
  // redo, and H to toggle panels. Gizmo / duplicate / delete keys are
  // owned by Stage3DRenderer; we just handle the chrome here.
  function onKeydown(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
    } else if (mod && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      copySelection();
    } else if (mod && e.key.toLowerCase() === 'v') {
      e.preventDefault();
      pasteSelection();
    } else if (e.key.toLowerCase() === 'h' && !mod) {
      e.preventDefault();
      togglePanels();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKeydown);
    recorderHandle?.stop();
    recorderHandle = null;
  });
</script>

<div class="stage3d-root" class:external={!renderViewport}>
  {#if renderViewport}
    <div class="viewport-fallback">
      <p>Open Stage 3D in the pop-out window for the live view.</p>
    </div>
  {/if}

  {#if !panelsHidden}
  <header class="topbar">
    <button class="icon-btn" onclick={onClose} aria-label="Back to editor" title="Back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 18l-6-6 6-6"/>
      </svg>
    </button>
    <div class="logo">GHOST<b>STAGE</b></div>

    <div class="seg" role="tablist">
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'translate'}
        onclick={() => setGizmoMode('translate')}
        title="Move (W / G)">✛ Move</button>
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'rotate'}
        onclick={() => setGizmoMode('rotate')}
        title="Rotate (E / R)">⟳ Rotate</button>
      <button
        class="seg-btn"
        class:on={$stage3DGizmoMode === 'scale'}
        onclick={() => setGizmoMode('scale')}
        title="Scale (S)">⤢ Scale</button>
    </div>

    <button class="tbtn" onclick={toggleSnap}>⊞ Snap: {snapOn ? '1m / 15°' : 'Off'}</button>

    <button class="tbtn" onclick={undo} disabled={!canUndo} title="Undo (⌘Z)">↶ Undo</button>
    <button class="tbtn" onclick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)">↷ Redo</button>

    <div class="spacer"></div>

    <label class="dim-label" for="stage3d-pa-select">PA</label>
    <select id="stage3d-pa-select" class="vsel" value="" onchange={onPASelect}>
      <option value="">Add PA preset…</option>
      <option value="linearray">Flown Line Array L/R</option>
      <option value="festivalpa">Festival PA + Subs</option>
      <option value="groundstack">Ground-Stacked L/R</option>
      <option value="club">Club Point-Source</option>
      <option value="nightclub">Nightclub Distributed</option>
    </select>

    <button class="tbtn" onclick={() => $stage3DRendererControls?.topCamera()}>⬓ Top</button>
    <button class="tbtn" onclick={() => $stage3DRendererControls?.frameCamera()}>⊡ Frame</button>
    <button class="tbtn" onclick={() => { $stage3DRendererControls?.reload(); toast('Scene reloaded'); }} title="Rebuild venue + screens">⟳ Reload</button>
    <button
      class="tbtn rec-btn"
      class:recording={isRecording}
      onclick={toggleStageRecording}
      title={isRecording ? 'Stop stage recording' : 'Record stage scene'}
    >
      {isRecording ? `■ ${formatRecordingDuration(recordingDuration)}` : '● Rec'}
    </button>
    <button class="tbtn" onclick={togglePanels} title="Hide panels (H)">▤ Hide</button>
    <button class="tbtn" onclick={saveDesign}>↓ Save</button>
    <button class="tbtn" onclick={loadDesign}>↑ Load</button>
    <button class="tbtn danger" onclick={clearElements}>✕ Clear</button>
    <input bind:this={fileInput} type="file" accept="application/json" style="display:none" onchange={onFileChosen} />
  </header>
  {/if}

  {#if !panelsHidden}
  <aside class="lib">
    <h3>Element Library</h3>
    {#each libraryGroups as group}
      <div class="grp">
        <div class="ghd">{group.name}</div>
        {#each group.items as [type, def]}
          <button class="additem" onclick={() => addElement(type)}>
            <span class="ic">{def.icon}</span>{def.label}
          </button>
        {/each}
      </div>
    {/each}
    {#if screenLayers.length > 0}
      <div class="grp">
        <div class="ghd">
          Screens (auto)
          <button
            class="ghd-action"
            onclick={() => setStage3DMultiSelection(screenLayers.map(l => `screen:${l.id}`))}
            title="Select all screens"
          >all</button>
        </div>
        {#each screenLayers as layer (layer.id)}
          {@const key = `screen:${layer.id}`}
          <button
            class="additem screen"
            class:selected={$selectedStage3DTargets.has(key)}
            class:primary={$selectedStage3DNodeId === key}
            onclick={(e) => (e.shiftKey || e.metaKey)
              ? toggleStage3DSelection(key)
              : setStage3DSelection(key)}
            title="Shift+click to add to selection"
          >
            <span class="ic">▦</span>{layer.name}
          </button>
        {/each}
      </div>
    {/if}
    {#if userElements.length > 0}
      <div class="grp">
        <div class="ghd">
          Placed elements
          <button
            class="ghd-action"
            onclick={() => setStage3DMultiSelection(userElements.map(el => `element:${el.id}`))}
            title="Select all placed elements"
          >all</button>
        </div>
        {#each userElements as el (el.id)}
          {@const key = `element:${el.id}`}
          <button
            class="additem screen"
            class:selected={$selectedStage3DTargets.has(key)}
            class:primary={$selectedStage3DNodeId === key}
            onclick={(e) => (e.shiftKey || e.metaKey)
              ? toggleStage3DSelection(key)
              : setStage3DSelection(key)}
            title="Shift+click to add to selection"
          >
            <span class="ic">▤</span>{el.type}
          </button>
        {/each}
      </div>
    {/if}
  </aside>

  <aside class="props">
    <h3>Inspector</h3>
    {#if $selectedStage3DTargets.size > 1}
      <div class="multi-banner">
        <b>{$selectedStage3DTargets.size}</b> selected — gizmo moves all together.
        Inspector shows the primary{selectedScreen ? ' (cyan outline)' : selectedElement ? ' (cyan outline)' : ''}.
      </div>
    {/if}
    {#if selectedScreen}
      <StageNodeProperties layerId={selectedScreen.id} />
    {:else if selectedElement}
      <StageElementProperties elementId={selectedElement.id} />
    {:else}
      <StageLightingPanel />
      <div class="empty">
        Click an element in the scene to edit it, or add one from the library.
        Shift+click any item (or in the library list) to add it to a multi-selection.
        LED screens are synced from the 2D Stage Designer — they appear on the venue's back wall.
      </div>
    {/if}
  </aside>

  <div class="hud">
    <span><b>{userElements.length}</b> element{userElements.length === 1 ? '' : 's'}</span>
    <span><b>{screenLayers.length}</b> screen{screenLayers.length === 1 ? '' : 's'}</span>
    {#if $selectedStage3DTargets.size > 1}
      <span class="multi-pill"><b>{$selectedStage3DTargets.size}</b> selected</span>
    {/if}
    <span><span class="kbd">⇧</span>+click multi</span>
    <span><span class="kbd">W</span><span class="kbd">E</span><span class="kbd">S</span> tools</span>
    <span><span class="kbd">⌘C</span>/<span class="kbd">⌘V</span> copy</span>
    <span><span class="kbd">⌘Z</span> undo</span>
    <span><span class="kbd">D</span> dup</span>
    <span><span class="kbd">⌫</span> del</span>
    <span><span class="kbd">H</span> hide</span>
  </div>
  {/if}

  {#if panelsHidden}
    <button class="show-panels-btn" onclick={togglePanels} title="Show panels (H)">▦ Show panels</button>
  {/if}

  {#if toastMessage}
    <div class="toast">{toastMessage}</div>
  {/if}
</div>

<style>
  .stage3d-root {
    position: fixed;
    inset: 0;
    background: #0a0c10;
    z-index: 1000;
    overflow: hidden;
    color: #e9edf4;
    font-family: 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }
  .stage3d-root.external { background: transparent; pointer-events: none; }
  .stage3d-root.external :global(button),
  .stage3d-root.external :global(input),
  .stage3d-root.external :global(select),
  .stage3d-root.external .topbar,
  .stage3d-root.external .lib,
  .stage3d-root.external .props,
  .stage3d-root.external .hud,
  .stage3d-root.external .toast { pointer-events: auto; }
  .viewport-fallback {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #666;
    font-size: 14px;
  }

  /* ── Top bar ────────────────────────────────────────────────── */
  .topbar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 54px;
    z-index: 20;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 14px;
    background: linear-gradient(180deg, rgba(10, 12, 16, 0.92), rgba(10, 12, 16, 0.4));
    backdrop-filter: blur(10px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .icon-btn {
    width: 36px; height: 36px; border-radius: 18px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(20, 22, 30, 0.85);
    color: #fff; font-size: 20px; cursor: pointer;
  }
  .icon-btn:hover { background: rgba(40, 44, 56, 0.95); }
  .logo {
    font-weight: 700;
    letter-spacing: 0.14em;
    font-size: 14px;
  }
  .logo b {
    background: linear-gradient(92deg, #4af2ff, #ff5cb8);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .seg {
    display: flex; gap: 2px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 9px;
    padding: 3px;
  }
  .seg-btn {
    font: inherit; font-size: 12px; color: #8a93a3;
    background: none; border: none;
    padding: 6px 11px; border-radius: 6px;
    cursor: pointer;
  }
  .seg-btn:hover { color: #e9edf4; }
  .seg-btn.on { background: #4af2ff; color: #04161a; font-weight: 600; }
  .tbtn {
    font: inherit; font-size: 12px; color: #e9edf4;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 7px 11px; cursor: pointer;
    white-space: nowrap;
  }
  .tbtn:hover { border-color: #4af2ff; color: #4af2ff; }
  .tbtn:disabled { opacity: 0.35; cursor: not-allowed; }
  .tbtn:disabled:hover { border-color: rgba(255, 255, 255, 0.08); color: #e9edf4; }
  .tbtn.danger:hover { border-color: #ff5cb8; color: #ff5cb8; }
  .rec-btn {
    min-width: 66px;
    text-align: center;
  }
  .rec-btn.recording {
    background: rgba(255, 68, 91, 0.18);
    border-color: rgba(255, 68, 91, 0.72);
    color: #ff8d9b;
    font-family: 'IBM Plex Mono', monospace;
    font-variant-numeric: tabular-nums;
  }
  .rec-btn.recording:hover {
    border-color: #ff445b;
    color: #ffd2d8;
  }
  .show-panels-btn {
    position: absolute;
    top: 14px; left: 50%;
    transform: translateX(-50%);
    z-index: 15;
    font: inherit; font-size: 12px;
    color: #e9edf4;
    background: rgba(16, 19, 26, 0.92);
    border: 1px solid #4af2ff;
    border-radius: 20px;
    padding: 8px 18px;
    cursor: pointer;
    pointer-events: auto;
    backdrop-filter: blur(10px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
  }
  .show-panels-btn:hover { background: rgba(74, 242, 255, 0.15); }
  .spacer { flex: 1; }
  .dim-label {
    font-family: 'IBM Plex Mono', monospace;
    font-size: 10px;
    color: #8a93a3;
    letter-spacing: 0.1em;
  }
  .vsel {
    font: inherit; font-size: 12px; color: #e9edf4;
    background: #10131a;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 7px 10px; cursor: pointer;
  }

  /* ── Library ────────────────────────────────────────────────── */
  .lib {
    position: absolute;
    top: 66px; left: 12px; bottom: 12px;
    width: 212px;
    z-index: 15;
    background: rgba(16, 19, 26, 0.86);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 11px;
    padding: 14px;
    overflow-y: auto;
  }
  .lib h3 {
    font-size: 10px; letter-spacing: 0.22em;
    color: #8a93a3; text-transform: uppercase;
    margin: 0 0 9px;
  }
  .grp { margin-bottom: 16px; }
  .ghd {
    font-size: 11px; letter-spacing: 0.14em;
    color: #4af2ff; text-transform: uppercase;
    margin-bottom: 7px;
    display: flex; align-items: center; gap: 6px;
  }
  .ghd::before {
    content: "";
    width: 5px; height: 5px; border-radius: 50%;
    background: #4af2ff;
  }
  .additem {
    width: 100%; text-align: left;
    font: inherit; font-size: 12.5px; color: #e9edf4;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 9px 11px; margin-bottom: 5px;
    cursor: pointer; transition: .14s;
    display: flex; align-items: center; gap: 9px;
  }
  .additem:hover {
    background: rgba(74, 242, 255, 0.08);
    border-color: rgba(74, 242, 255, 0.4);
    transform: translateX(2px);
  }
  .additem.screen.selected,
  .additem.screen.selected:hover {
    background: rgba(187, 134, 252, 0.16);
    border-color: rgba(187, 134, 252, 0.6);
  }
  .additem.screen.selected.primary,
  .additem.screen.selected.primary:hover {
    background: rgba(74, 242, 255, 0.18);
    border-color: #4af2ff;
  }
  .additem .ic { width: 16px; text-align: center; opacity: 0.8; }
  .ghd-action {
    margin-left: auto;
    font: inherit;
    font-size: 10px;
    color: #8a93a3;
    background: transparent;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 1px 6px;
    cursor: pointer;
    text-transform: lowercase;
    letter-spacing: 0.05em;
  }
  .ghd-action:hover { color: #4af2ff; border-color: #4af2ff; }

  /* ── Properties ─────────────────────────────────────────────── */
  .props {
    position: absolute;
    top: 66px; right: 12px; bottom: 12px;
    width: 264px;
    z-index: 15;
    background: rgba(16, 19, 26, 0.86);
    backdrop-filter: blur(14px);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 11px;
    padding: 14px;
    overflow-y: auto;
  }
  .props h3 {
    font-size: 10px; letter-spacing: 0.22em;
    color: #8a93a3; text-transform: uppercase;
    margin: 0 0 9px;
  }
  .empty {
    color: #8a93a3;
    font-size: 12.5px;
    line-height: 1.7;
    margin-top: 8px;
  }
  .multi-banner {
    background: rgba(187, 134, 252, 0.12);
    border: 1px solid rgba(187, 134, 252, 0.4);
    border-radius: 8px;
    padding: 9px 12px;
    margin-bottom: 12px;
    font-size: 11.5px;
    line-height: 1.5;
    color: #d8c8ff;
  }
  .multi-banner b { color: #fff; }

  /* ── HUD ────────────────────────────────────────────────────── */
  .hud {
    position: absolute;
    bottom: 18px; left: 50%;
    transform: translateX(-50%);
    z-index: 14;
    display: flex; gap: 14px; align-items: center;
    font-size: 11px; color: #8a93a3;
    background: rgba(16, 19, 26, 0.86);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 30px;
    padding: 8px 18px;
    backdrop-filter: blur(10px);
  }
  .hud b { color: #e9edf4; font-weight: 600; }
  .kbd {
    font-family: 'IBM Plex Mono', monospace;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 5px;
    padding: 1px 6px;
    color: #c4ccd8;
    font-size: 10px;
    margin: 0 2px;
  }
  .multi-pill {
    background: rgba(187, 134, 252, 0.18);
    color: #fff;
    border: 1px solid rgba(187, 134, 252, 0.5);
    border-radius: 12px;
    padding: 2px 9px;
  }

  /* ── Toast ──────────────────────────────────────────────────── */
  .toast {
    position: absolute;
    bottom: 64px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 30;
    background: #10131a;
    border: 1px solid #4af2ff;
    color: #e9edf4;
    font-size: 12.5px;
    padding: 10px 18px;
    border-radius: 9px;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
  }

  @media (max-width: 880px) {
    .lib, .props, .hud { display: none; }
  }
</style>
