<script lang="ts">
  import { project, compositions, activeCompositionId } from '../stores/layers';
  import { showTimelineIsPlaying } from '../stores/showTimeline';
  import { presetTransition, TRANSITION_OPTIONS } from '../stores/presetTransition';
  import { audioStore } from '../stores/audio';
  import type { Composition, CompositionTransitionStyle } from '../types';
  import { showLoading, hideLoading } from '../stores/loading';
  import { invoke, isDesktopApp } from '$lib/bridge';
  import { NATIVE_ENGINE_ONLY } from '../stores/settings';
  import { startRecording as startRec, formatRecordingDuration, type RecorderHandle } from '../recording/recorder';
  import { onDestroy, onMount } from 'svelte';

  export let isOpen = false;

  // VJ MAP sub-mode: the tray floats above the VJ overlay so mapping
  // presets can be dragged straight into the deck cells. Cards become
  // draggable and publish the same payload the VJ media tray uses.
  export let vjDragMode = false;

  // Reorder-drag state (non-VJ mode): drag a card over another to
  // reorder the compositions list in place.
  let draggedPresetIndex: number | null = null;
  let dragOverPresetIndex: number | null = null;

  function handlePresetDragStart(e: DragEvent, comp: Composition, compIdx: number) {
    if (vjDragMode) {
      // VJ MAP sub-mode: drags feed the VJ deck, not reordering.
      if (!e.dataTransfer) return;
      const payload = { id: comp.id, type: 'preset', name: comp.name };
      e.dataTransfer.setData('application/x-ghost-media-source', JSON.stringify(payload));
      e.dataTransfer.effectAllowed = 'copy';
      (window as any).__ghostVJMediaTrayDragPayload = payload;
      return;
    }
    if (editingId) {
      e.preventDefault();
      return;
    }
    draggedPresetIndex = compIdx;
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('application/x-ghost-mapping-preset', String(compIdx));
    }
  }

  function handlePresetDragOver(e: DragEvent, compIdx: number) {
    if (vjDragMode) return;
    if (draggedPresetIndex === null) return;
    e.preventDefault();
    dragOverPresetIndex = compIdx;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  }

  function handlePresetDrop(e: DragEvent, compIdx: number) {
    if (vjDragMode) return;
    e.preventDefault();
    const rawIndex = e.dataTransfer?.getData('application/x-ghost-mapping-preset');
    const fromIndex = draggedPresetIndex ?? (rawIndex ? Number(rawIndex) : NaN);
    if (Number.isFinite(fromIndex)) {
      project.reorderComposition(fromIndex, compIdx);
    }
    draggedPresetIndex = null;
    dragOverPresetIndex = null;
  }

  function handlePresetDragEnd() {
    if ((window as any).__ghostVJMediaTrayDragPayload?.type === 'preset') {
      (window as any).__ghostVJMediaTrayDragPayload = undefined;
    }
    draggedPresetIndex = null;
    dragOverPresetIndex = null;
  }

  // Callback before loading a preset (for triggering transitions). Fired
  // while the OUTGOING composition is still the loaded one — the native
  // crossfade needs both ids, and only the caller can read the outgoing one
  // before `project.loadComposition` replaces it.
  export let onBeforeLoad:
    | ((durationSeconds: number, style: CompositionTransitionStyle, toCompositionId: string) => void)
    | null = null;

  // Transition settings live in `stores/presetTransition.ts` (loaded from,
  // and written back to, the same three localStorage keys they always used).
  // They are shared state now: the show timeline seeds every preset clip it
  // creates from these, so a crossfade set here is the crossfade a programmed
  // show uses.
  $: transitionEnabled = $presetTransition.enabled;
  $: transitionDuration = $presetTransition.duration;
  $: transitionType = $presetTransition.style;

  onMount(() => {
    // MIDI: bridge map:preset:<index> triggers into loadPreset(). The router
    // dispatches the event but had no listener until this hook — bound notes
    // appeared to do nothing. Index is into the *current* $compositions list,
    // which matches the visual order in the tray. Loader includes any active
    // transition so MIDI-fired preset changes feel the same as click-fires.
    const handler = (e: Event) => {
      const idx = (e as CustomEvent<{ index: number }>).detail?.index;
      if (typeof idx !== 'number') return;
      const comp = $compositions[idx];
      if (comp) loadPreset(comp.id);
    };
    window.addEventListener('midi-mapping-preset', handler);
    return () => window.removeEventListener('midi-mapping-preset', handler);
  });
  // Recording state (shared recorder)
  let recorderHandle: RecorderHandle | null = null;
  let isRecording = false;
  let recordingDuration = 0;

  // Preset management
  let editingId: string | null = null;
  let editingName = '';
  let newPresetName = '';

  // ─── Auto-Play Engine ──────────────────────────────────────────────
  type TimingMode = 'fixed' | 'beat';
  let autoPlaying = false;
  let autoPaused = false;
  let autoLoop = true;
  let autoTimingMode: TimingMode = 'fixed';
  let autoGlobalDuration = 10; // seconds per preset
  let autoBpm = 120;
  let autoBeatsPerPreset = 8; // how many beats before advancing
  let autoCurrentIndex = 0;
  let autoElapsed = 0; // seconds into current preset
  let autoAnimFrame: number | null = null;
  let autoLastTime: number | null = null;
  // Per-preset duration overrides: compositionId → seconds (0 = use global)
  let autoOverrides: Record<string, number> = {};

  /** Duration for the current preset (override or global) */
  function currentPresetDuration(): number {
    const comps = $compositions;
    if (comps.length === 0) return autoGlobalDuration;
    const comp = comps[autoCurrentIndex % comps.length];
    const override = autoOverrides[comp?.id];
    if (override && override > 0) return override;
    if (autoTimingMode === 'beat') {
      return (60 / autoBpm) * autoBeatsPerPreset;
    }
    return autoGlobalDuration;
  }

  function autoPlayStart() {
    if ($compositions.length < 2) return;
    // The show timeline owns scheduled preset changes while it runs — two
    // schedulers firing loadComposition would fight over the layer stack.
    if ($showTimelineIsPlaying) return;
    autoPlaying = true;
    autoPaused = false;
    autoElapsed = 0;
    autoLastTime = null;
    // Start from current active preset if possible
    const idx = $compositions.findIndex(c => c.id === $activeCompositionId);
    autoCurrentIndex = idx >= 0 ? idx : 0;
    loadPreset($compositions[autoCurrentIndex].id);
    autoTick(performance.now());
  }

  function autoPlayPause() {
    autoPaused = !autoPaused;
    if (!autoPaused) {
      autoLastTime = null;
      autoTick(performance.now());
    }
  }

  function autoPlayStop() {
    autoPlaying = false;
    autoPaused = false;
    autoElapsed = 0;
    autoLastTime = null;
    if (autoAnimFrame) { cancelAnimationFrame(autoAnimFrame); autoAnimFrame = null; }
  }

  function autoAdvance() {
    const comps = $compositions;
    if (comps.length < 2) { autoPlayStop(); return; }
    autoCurrentIndex++;
    if (autoCurrentIndex >= comps.length) {
      if (autoLoop) { autoCurrentIndex = 0; }
      else { autoPlayStop(); return; }
    }
    autoElapsed = 0;
    loadPreset(comps[autoCurrentIndex].id);
  }

  function autoTick(now: number) {
    if (!autoPlaying || autoPaused) return;
    if (autoLastTime !== null) {
      const dt = (now - autoLastTime) / 1000;
      autoElapsed += dt;
      if (autoElapsed >= currentPresetDuration()) {
        autoAdvance();
      }
    }
    autoLastTime = now;
    autoAnimFrame = requestAnimationFrame(autoTick);
  }

  // ── Show-timeline handover ──────────────────────────────────────────
  // Exactly one scheduler may drive presets. The show timeline is the
  // programmed one, so it wins: starting it stops tray auto-play, and the
  // tray's play button stays disabled for the duration. Manual preset
  // CLICKS still work as an operator punch-in — the show takes back over at
  // its next clip boundary.
  $: if ($showTimelineIsPlaying && autoPlaying) autoPlayStop();

  /** Reactive: pick up live BPM from audio store when in beat mode */
  $: if (autoTimingMode === 'beat' && $audioStore.bpm > 0) {
    autoBpm = $audioStore.bpm;
  }

  /** Progress 0-1 for the auto-play bar */
  $: autoProgress = autoPlaying ? Math.min(1, autoElapsed / currentPresetDuration()) : 0;

  onDestroy(() => {
    if (autoAnimFrame) cancelAnimationFrame(autoAnimFrame);
  });

  // Toggle tray
  function toggleTray() {
    isOpen = !isOpen;
  }

  // Load a preset with optional transition.
  // When a transition is active, suppress the "Loading Composition..." overlay —
  // the transition itself provides visual feedback and the white text just covers it.
  function loadPreset(compId: string) {
    // A composition crossfading into itself is a no-op that would only cost
    // a doubled scene layer count, so re-clicking the live preset cuts.
    const useTransition =
      transitionEnabled && transitionDuration > 0 && !!onBeforeLoad && compId !== $activeCompositionId;
    if (!useTransition) showLoading('Loading Composition...');
    if (useTransition) onBeforeLoad!(transitionDuration, transitionType, compId);
    project.loadComposition(compId);
    if (!useTransition) requestAnimationFrame(() => hideLoading());
  }

  // Start editing name
  function startEdit(comp: Composition, e: Event) {
    e.stopPropagation();
    editingId = comp.id;
    editingName = comp.name;
  }

  // Save edited name
  function saveEdit() {
    if (editingId && editingName.trim()) {
      project.renameComposition(editingId, editingName.trim());
    }
    editingId = null;
    editingName = '';
  }

  // Delete preset
  function deletePreset(id: string, e: Event) {
    e.stopPropagation();
    if (confirm('Delete this preset?')) {
      project.deleteComposition(id);
    }
  }

  // Native mode: the WebGL canvas is a cleared underlay (the core owns
  // the pixels), so grab a one-shot frame snapshot from the render core
  // and scale it down. Falls back to the canvas capture when the core
  // has nothing to give.
  async function captureNativeThumbnail(): Promise<string | undefined> {
    if (!(isDesktopApp && NATIVE_ENGINE_ONLY)) return undefined;
    try {
      const snap = await invoke('native_renderer_get_frame_snapshot', { include_pixels: true }) as {
        rgba_b64?: string;
        width?: number;
        height?: number;
        format?: string;
        bytes_per_row?: number;
        padded_bytes_per_row?: number;
        dark_frame?: boolean;
      } | null;
      if (!snap?.rgba_b64 || !snap.width || !snap.height) return undefined;
      const raw = atob(snap.rgba_b64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
      const w = snap.width;
      const h = snap.height;
      const rowBytes = snap.bytes_per_row || w * 4;
      const stride = snap.padded_bytes_per_row || rowBytes;
      const bgra = String(snap.format ?? '').toLowerCase().includes('bgra');
      const img = new ImageData(w, h);
      for (let y = 0; y < h; y++) {
        const src = y * stride;
        const dst = y * w * 4;
        for (let x = 0; x < w; x++) {
          const si = src + x * 4;
          const di = dst + x * 4;
          img.data[di]     = bytes[bgra ? si + 2 : si];
          img.data[di + 1] = bytes[si + 1];
          img.data[di + 2] = bytes[bgra ? si : si + 2];
          img.data[di + 3] = 255;
        }
      }
      const full = document.createElement('canvas');
      full.width = w;
      full.height = h;
      full.getContext('2d')!.putImageData(img, 0, 0);
      const thumb = document.createElement('canvas');
      thumb.width = 120;
      thumb.height = 68;
      thumb.getContext('2d')!.drawImage(full, 0, 0, 120, 68);
      return thumb.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      console.warn('[PresetTray] native thumbnail failed:', e);
      return undefined;
    }
  }

  // Capture a thumbnail of the current main canvas at preset size.
  // Shared by saveNewPreset and updateCurrentPreset so a re-saved
  // preset visually reflects whatever's on screen right now.
  function captureThumbnail(): string | undefined {
    try {
      const canvas = document.querySelector('canvas.main-canvas') as HTMLCanvasElement ||
                     document.querySelector('.canvas-container canvas') as HTMLCanvasElement ||
                     document.querySelector('canvas') as HTMLCanvasElement;
      if (!canvas) return undefined;
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 120;
      thumbCanvas.height = 68;
      const ctx = thumbCanvas.getContext('2d');
      if (!ctx) return undefined;
      ctx.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
      return thumbCanvas.toDataURL('image/jpeg', 0.7);
    } catch (e) {
      console.warn('Failed to capture thumbnail:', e);
      return undefined;
    }
  }

  // Right-click context menu state. Anchored to mouse pos at open.
  // Stays open until a menu item clicks or the backdrop click closes it.
  let ctxMenu: { x: number; y: number; comp: Composition } | null = null;
  function openCtxMenu(e: MouseEvent, comp: Composition) {
    e.preventDefault();
    e.stopPropagation();
    ctxMenu = { x: e.clientX, y: e.clientY, comp };
  }
  function closeCtxMenu() { ctxMenu = null; }

  // Update the active preset (or a specified one) with the current
  // project state — layers, sub-store snapshots, fresh thumbnail.
  // Targets the right-clicked preset when targetId is supplied; falls
  // back to the active preset for the "Update current" header button.
  async function updateCurrentPreset(targetId?: string) {
    const id = targetId ?? $activeCompositionId;
    if (!id) return;
    const thumbnail = (await captureNativeThumbnail()) ?? captureThumbnail();
    const ok = project.updateComposition(id, { thumbnail });
    if (!ok) console.warn('[PresetTray] update failed for', id);
  }

  // Save current state as new preset
  async function saveNewPreset() {
    const name = newPresetName.trim() || `Preset ${$compositions.length + 1}`;

    // Capture thumbnail — native core snapshot first, canvas fallback.
    let thumbnail: string | undefined = await captureNativeThumbnail();
    if (!thumbnail) thumbnail = captureThumbnail();

    project.saveComposition(name, thumbnail);
    newPresetName = '';
  }

  // Start recording (shared recorder with audio support)
  function startRecording() {
    recordingDuration = 0;
    recorderHandle = startRec({
      namePrefix: 'Preset Recording',
      onDurationUpdate: (s) => { recordingDuration = s; },
      onComplete: () => { isRecording = false; recorderHandle = null; },
      onError: (err) => { alert('Failed to start recording: ' + err.message); },
    });
    if (recorderHandle) {
      isRecording = true;
    }
  }

  // Stop recording
  function stopRecording() {
    if (recorderHandle) {
      recorderHandle.stop();
      isRecording = false;
      recorderHandle = null;
    }
  }

  // Format duration alias
  function formatDuration(seconds: number): string {
    return formatRecordingDuration(seconds);
  }
</script>

<!-- Preset Tray Toggle Button -->
<button class="tray-toggle" class:open={isOpen} class:vj-drag={vjDragMode} onclick={toggleTray}>
  <span class="toggle-icon">{isOpen ? '▼' : '▲'}</span>
  <span class="toggle-label">Presets</span>
  {#if $compositions.length > 0}
    <span class="count-badge">{$compositions.length}</span>
  {/if}
</button>

<!-- Preset Tray Content -->
{#if isOpen}
  <div class="preset-tray" class:vj-drag={vjDragMode}>
    <div class="tray-header">
      <div class="header-left">
        <span class="tray-title">MAPPING PRESETS</span>
        <div class="transition-controls">
          <label class="transition-toggle" title="Enable transition between presets">
            <input
              type="checkbox"
              checked={transitionEnabled}
              onchange={(e) => presetTransition.patch({ enabled: (e.currentTarget as HTMLInputElement).checked })}
            />
            <span class="transition-label">Transition</span>
          </label>
          {#if transitionEnabled}
            <select
              class="transition-duration"
              value={transitionType}
              onchange={(e) => presetTransition.patch({ style: (e.currentTarget as HTMLSelectElement).value as CompositionTransitionStyle })}
              title="Transition style"
            >
              {#each TRANSITION_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
            <select
              class="transition-duration"
              value={transitionDuration}
              onchange={(e) => presetTransition.patch({ duration: Number((e.currentTarget as HTMLSelectElement).value) })}
              title="Transition duration"
            >
              <option value={0.5}>0.5s</option>
              <option value={1}>1s</option>
              <option value={2}>2s</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={8}>8s</option>
              <option value={10}>10s</option>
            </select>
          {/if}
        </div>
      </div>

      <div class="header-center">
        <!-- Save / Update preset.  "+ Save" always creates a new entry.
             "↻ Update" appears only when a preset is currently active —
             clicking it overwrites that preset with the current layers
             + sub-store snapshots + a fresh thumbnail. Two buttons (vs
             one chameleon button) so the destructive action is never
             reached by muscle memory when the user means "save a new
             one." -->
        <div class="save-preset">
          <input
            type="text"
            placeholder="Preset name..."
            bind:value={newPresetName}
            onkeydown={(e) => e.key === 'Enter' && saveNewPreset()}
          />
          <button class="save-btn" onclick={saveNewPreset} title="Save current state as a new preset">
            + Save
          </button>
          {#if $activeCompositionId && $compositions.some(c => c.id === $activeCompositionId)}
            {@const activeName = $compositions.find(c => c.id === $activeCompositionId)?.name ?? 'preset'}
            <button class="update-btn" onclick={() => updateCurrentPreset()} title={`Overwrite "${activeName}" with the current state`}>
              ↻ Update
            </button>
          {/if}
        </div>

        <!-- Auto-Play Controls -->
        <div class="auto-play-controls">
          {#if !autoPlaying}
            <button
              class="ap-btn play"
              onclick={autoPlayStart}
              title={$showTimelineIsPlaying
                ? 'The show timeline is driving presets — stop it to use tray auto-play'
                : 'Auto-play presets'}
              disabled={$compositions.length < 2 || $showTimelineIsPlaying}
            >
              ▶
            </button>
          {:else}
            <button class="ap-btn pause" onclick={autoPlayPause} title={autoPaused ? 'Resume' : 'Pause'}>
              {autoPaused ? '▶' : '⏸'}
            </button>
            <button class="ap-btn stop" onclick={autoPlayStop} title="Stop">
              ■
            </button>
          {/if}
          <button class="ap-btn loop" class:active={autoLoop} onclick={() => autoLoop = !autoLoop} title="Loop">
            🔁
          </button>
          <select class="ap-select" bind:value={autoTimingMode}>
            <option value="fixed">Time</option>
            <option value="beat">Beat</option>
          </select>
          {#if autoTimingMode === 'fixed'}
            <select class="ap-select" bind:value={autoGlobalDuration}>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={8}>8s</option>
              <option value={10}>10s</option>
              <option value={15}>15s</option>
              <option value={20}>20s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
          {:else}
            <select class="ap-select" bind:value={autoBeatsPerPreset}>
              <option value={2}>2 beats</option>
              <option value={4}>4 beats</option>
              <option value={8}>8 beats</option>
              <option value={16}>16 beats</option>
              <option value={32}>32 beats</option>
            </select>
            <span class="ap-bpm">{autoBpm} BPM</span>
          {/if}
          {#if autoPlaying}
            <div class="ap-progress" title="{Math.ceil(currentPresetDuration() - autoElapsed)}s left">
              <div class="ap-progress-bar" style="width: {autoProgress * 100}%"></div>
            </div>
          {/if}
        </div>
      </div>

      <div class="header-right">
        {#if vjDragMode}
          <button class="tray-minimize-btn" onclick={() => isOpen = false} title="Minimize preset tray">
            ▼ Minimize
          </button>
        {/if}
        <!-- Recording controls -->
        {#if isRecording}
          <div class="recording-indicator">
            <span class="rec-dot"></span>
            <span class="rec-time">{formatDuration(recordingDuration)}</span>
          </div>
          <button class="stop-rec-btn" onclick={stopRecording}>
            ■ Stop Recording
          </button>
        {:else}
          <button class="rec-btn" onclick={startRecording}>
            ● Record Output
          </button>
        {/if}
      </div>
    </div>

    {#if ctxMenu}
      <!-- Right-click menu — anchored to mouse position. Backdrop catches
           outside clicks; ESC could close it via a global handler but
           the click-outside path is enough for this tray's UX. -->
      <div
        class="ctx-backdrop"
        onclick={closeCtxMenu}
        oncontextmenu={(e) => { e.preventDefault(); closeCtxMenu(); }}
        role="button"
        tabindex="-1"
      ></div>
      <div class="preset-ctx-menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px">
        <button
          class="ctx-item"
          onclick={(e) => { e.stopPropagation(); updateCurrentPreset(ctxMenu!.comp.id); closeCtxMenu(); }}
          title="Overwrite this preset with the current project state"
        >↻ Update with current state</button>
        <button
          class="ctx-item"
          onclick={(e) => { e.stopPropagation(); loadPreset(ctxMenu!.comp.id); closeCtxMenu(); }}
        >▶ Load preset</button>
        <button
          class="ctx-item"
          onclick={(e) => { e.stopPropagation(); const c = ctxMenu!.comp; closeCtxMenu(); startEdit(c, e); }}
        >✎ Rename</button>
        <div class="ctx-divider"></div>
        <button
          class="ctx-item ctx-danger"
          onclick={(e) => { e.stopPropagation(); const id = ctxMenu!.comp.id; closeCtxMenu(); if (confirm('Delete this preset?')) project.deleteComposition(id); }}
        >× Delete</button>
      </div>
    {/if}

    <div class="preset-list">
      {#if $compositions.length === 0}
        <div class="empty-state">
          <p>No presets saved yet</p>
          <p class="hint">Save your current mapping as a preset to quickly switch between different configurations</p>
        </div>
      {:else}
        {#each $compositions as comp, compIdx (comp.id)}
          <div
            class="preset-item"
            class:active={$activeCompositionId === comp.id}
            class:dragover={!vjDragMode && dragOverPresetIndex === compIdx}
            draggable={vjDragMode || editingId !== comp.id}
            ondragstart={(e) => handlePresetDragStart(e, comp, compIdx)}
            ondragover={(e) => handlePresetDragOver(e, compIdx)}
            ondrop={(e) => handlePresetDrop(e, compIdx)}
            ondragend={handlePresetDragEnd}
            onclick={() => loadPreset(comp.id)}
            oncontextmenu={(e) => openCtxMenu(e, comp)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && loadPreset(comp.id)}
            data-midi-path={`map:preset:${compIdx}`}
            data-midi-label={`Mapping Preset: ${comp.name}`}
            data-midi-mode="toggle"
          >
            <div class="preset-thumb">
              {#if comp.thumbnail}
                <img src={comp.thumbnail} alt={comp.name} />
              {:else}
                <div class="thumb-placeholder">
                  <span>{comp.layers.length}</span>
                </div>
              {/if}
            </div>
            <div class="preset-info">
              {#if editingId === comp.id}
                <input
                  type="text"
                  class="name-edit"
                  bind:value={editingName}
                  onclick={(e) => e.stopPropagation()}
                  onkeydown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') saveEdit();
                    if (e.key === 'Escape') { editingId = null; editingName = ''; }
                  }}
                  onblur={saveEdit}
                />
              {:else}
                <span class="preset-name" ondblclick={(e) => startEdit(comp, e)}>
                  {comp.name}
                </span>
              {/if}
              <span class="preset-layers">{comp.layers.length} layer{comp.layers.length !== 1 ? 's' : ''}</span>
            </div>
            <select
              class="preset-duration"
              value={autoOverrides[comp.id] || 0}
              onclick={(e) => e.stopPropagation()}
              onchange={(e) => { const v = parseInt((e.target as HTMLSelectElement).value); autoOverrides[comp.id] = v; autoOverrides = autoOverrides; }}
              title="Override auto-play duration for this preset (0 = use global)"
            >
              <option value={0}>—</option>
              <option value={3}>3s</option>
              <option value={5}>5s</option>
              <option value={8}>8s</option>
              <option value={10}>10s</option>
              <option value={15}>15s</option>
              <option value={20}>20s</option>
              <option value={30}>30s</option>
              <option value={60}>60s</option>
            </select>
            <button
              class="delete-btn"
              onclick={(e) => deletePreset(comp.id, e)}
              title="Delete preset"
            >×</button>
          </div>
        {/each}
      {/if}
    </div>
  </div>
{/if}

<style>
  .tray-toggle {
    position: fixed;
    bottom: 24px;
    left: calc(50% - 200px);
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, #0d0d10, #111114);
    border: 1px solid #444;
    color: var(--text-primary, #ddd);
    padding: 8px 16px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    z-index: 100;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  }

  .tray-toggle:hover {
    border-color: #BB86FC;
    box-shadow: 0 4px 30px rgba(0, 170, 255, 0.2);
  }

  .tray-toggle.open {
    border-color: #BB86FC;
    background: linear-gradient(135deg, #1a2530, #253040);
  }

  .toggle-icon {
    font-size: 11px;
    color: var(--text-muted, #888);
  }

  .toggle-label {
    font-size: 13px;
    font-weight: 600;
  }

  .count-badge {
    background: #BB86FC;
    color: #000;
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 700;
  }

  .tray-toggle.vj-drag {
    z-index: 1205;
    bottom: 10px;
    left: 14px;
    transform: none;
  }
  .preset-tray.vj-drag {
    z-index: 1204;
    bottom: 0;
    height: 172px;
    border-top: 1px solid var(--ga-coral-line, rgba(206,222,236,.45));
    box-shadow: 0 -8px 30px rgba(0, 0, 0, 0.55);
  }
  .tray-minimize-btn {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: var(--text-primary, #ddd);
    padding: 5px 12px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    white-space: nowrap;
  }
  .tray-minimize-btn:hover { border-color: var(--ga-coral, #ff6f5e); }
  .preset-tray.vj-drag .preset-item { cursor: grab; }
  .preset-tray.vj-drag .preset-item:active { cursor: grabbing; }

  .preset-tray {
    position: fixed;
    bottom: var(--ga-bottom-rail-offset, 74px);
    left: 0;
    right: 0;
    height: 180px;
    background: var(--bg-primary, #0a0a0c);
    border-top: 1px solid #333;
    z-index: 90;
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .tray-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg-primary, #0d0d10);
    border-bottom: 1px solid #161618;
    flex-shrink: 0;
  }

  .header-left, .header-center, .header-right {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .header-left { flex: 1; gap: 16px; }
  .header-center { flex: 1; justify-content: center; }
  .header-right { flex: 1; justify-content: flex-end; }

  .transition-controls {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .transition-toggle {
    display: flex;
    align-items: center;
    gap: 4px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-muted, #888);
  }

  .transition-toggle input {
    accent-color: #BB86FC;
    cursor: pointer;
    margin: 0;
  }

  .transition-toggle input:checked ~ .transition-label {
    color: #BB86FC;
  }

  .transition-label {
    font-size: 12px;
  }

  .transition-duration {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    color: var(--text-primary, #ddd);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 3px;
    cursor: pointer;
  }

  .transition-duration:focus {
    outline: none;
    border-color: #BB86FC;
  }

  .tray-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted, #888);
    letter-spacing: 0.5px;
  }

  .save-preset {
    display: flex;
    gap: 6px;
  }

  /* ─── Auto-Play ─── */
  .auto-play-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-top: 6px;
  }
  .ap-btn {
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    color: var(--text-primary, #ddd);
    width: 28px;
    height: 26px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
  }
  .ap-btn:hover { background: rgba(255,255,255,0.14); color: #fff; }
  .ap-btn.play { color: #2ED573; }
  .ap-btn.stop { color: #FF4757; }
  .ap-btn.loop.active { background: rgba(187,134,252,0.15); border-color: #BB86FC; color: #BB86FC; }
  .ap-select {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    color: var(--text-primary, #ddd);
    font-size: 11px;
    padding: 3px 4px;
    border-radius: 3px;
    cursor: pointer;
  }
  .ap-bpm {
    font-size: 11px;
    color: var(--text-muted, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .ap-progress {
    width: 60px;
    height: 6px;
    background: rgba(255,255,255,0.06);
    border-radius: 3px;
    overflow: hidden;
  }
  .ap-progress-bar {
    height: 100%;
    background: #BB86FC;
    transition: width 0.1s linear;
  }
  .preset-duration {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #333;
    color: var(--text-muted, #888);
    font-size: 10px;
    padding: 2px;
    border-radius: 3px;
    cursor: pointer;
    width: 36px;
  }

  .save-preset input {
    background: var(--bg-tertiary, #161618);
    border: 1px solid #444;
    color: var(--text-primary, #eee);
    padding: 5px 10px;
    border-radius: 4px;
    font-size: 12px;
    width: 140px;
  }

  .save-preset input:focus {
    outline: none;
    border-color: #BB86FC;
  }

  .save-btn {
    background: #BB86FC;
    border: none;
    color: #000;
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }

  .save-btn:hover {
    background: #00ccff;
  }

  /* "Update current preset" — visually paired with .save-btn but with
     an inverted scheme: outlined accent + filled-on-hover. Signals
     "this is destructive over an existing entry" without being
     alarming (preset overwrites aren't catastrophic — they can be
     re-saved). */
  .update-btn {
    background: transparent;
    border: 1px solid #BB86FC;
    color: #BB86FC;
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
  }
  .update-btn:hover {
    background: rgba(187,134,252,0.15);
    color: #fff;
  }

  /* Right-click context menu over preset cards. Mirrors the styling of
     similar context menus elsewhere (LayerPanel) — dark background,
     subtle border, hover row, danger-row for destructive actions. */
  .ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    background: transparent;
  }
  .preset-ctx-menu {
    position: fixed;
    z-index: 1101;
    min-width: 200px;
    background: #1a1a1f;
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 6px;
    padding: 4px;
    box-shadow: 0 6px 24px rgba(0,0,0,0.5);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .preset-ctx-menu .ctx-item {
    background: transparent;
    border: none;
    color: var(--text-primary, #ddd);
    padding: 6px 10px;
    text-align: left;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
  }
  .preset-ctx-menu .ctx-item:hover {
    background: rgba(255,255,255,0.06);
    color: #fff;
  }
  .preset-ctx-menu .ctx-item.ctx-danger {
    color: #ff8888;
  }
  .preset-ctx-menu .ctx-item.ctx-danger:hover {
    background: rgba(255,68,68,0.12);
    color: #ffb0b0;
  }
  .preset-ctx-menu .ctx-divider {
    height: 1px;
    background: rgba(255,255,255,0.08);
    margin: 4px 2px;
  }

  /* Recording controls */
  .rec-btn {
    background: var(--ga-card, #13161c);
    border: 1px solid var(--ga-line-2, #555);
    color: var(--ga-rec, #ff4444);
    padding: 6px 14px;
    border-radius: var(--ga-r-soft, 4px);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    /* Fixes the "Record / Output" vertical wrap when the tray gives
       us narrow space — was breaking into two lines because the flex
       column ancestor was crushing this in. */
    white-space: nowrap;
    flex: 0 0 auto;
    min-width: 130px;
  }

  .rec-btn:hover {
    background: #ff4444;
    border-color: #ff4444;
    color: #fff;
  }

  .stop-rec-btn {
    background: #ff4444;
    border: none;
    color: #fff;
    padding: 5px 12px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .stop-rec-btn:hover {
    background: #ff6666;
  }

  .recording-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .rec-dot {
    width: 8px;
    height: 8px;
    background: #ff4444;
    border-radius: 50%;
    animation: blink 1s infinite;
  }

  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .rec-time {
    font-size: 12px;
    font-weight: 600;
    color: #ff4444;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  /* Preset list */
  .preset-list {
    flex: 1;
    display: flex;
    gap: 8px;
    padding: 12px 16px;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .empty-state {
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: #555;
    text-align: center;
  }

  .empty-state p {
    margin: 0;
    font-size: 13px;
  }

  .empty-state .hint {
    font-size: 11px;
    color: #444;
    margin-top: 4px;
    max-width: 300px;
  }

  .preset-item {
    flex-shrink: 0;
    width: 120px;
    background: #1e1e1e;
    border: 1px solid #333;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    position: relative;
    overflow: hidden;
  }

  .preset-item:hover {
    border-color: #BB86FC;
    transform: translateY(-2px);
  }

  .preset-item.active {
    border-color: #BB86FC;
    box-shadow: 0 0 12px rgba(0, 170, 255, 0.3);
  }

  .preset-item.dragover {
    border-color: #7EC8E3;
    box-shadow: 0 0 0 1px rgba(126, 200, 227, 0.7), 0 0 14px rgba(126, 200, 227, 0.26);
    transform: translateY(-2px);
  }

  .preset-thumb {
    width: 100%;
    height: 68px;
    background: #111;
    overflow: hidden;
  }

  .preset-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, #161618, #0d0d10);
    color: #666;
    font-size: 19px;
    font-weight: 700;
  }

  .preset-info {
    padding: 6px 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .preset-name {
    font-size: 11px;
    color: var(--text-primary, #ddd);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .preset-layers {
    font-size: 10px;
    color: #666;
  }

  .name-edit {
    width: 100%;
    background: #333;
    border: 1px solid #BB86FC;
    color: var(--text-primary, #eee);
    padding: 2px 4px;
    border-radius: 2px;
    font-size: 11px;
  }

  .delete-btn {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 18px;
    height: 18px;
    background: rgba(255, 50, 50, 0.9);
    border: none;
    border-radius: 50%;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.1s;
    padding: 0;
    line-height: 1;
  }

  .preset-item:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: #ff3333;
  }

  /* Scrollbar */
  .preset-list::-webkit-scrollbar {
    height: 6px;
  }

  .preset-list::-webkit-scrollbar-track {
    background: var(--bg-primary, #0d0d10);
  }

  .preset-list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 3px;
  }

  .preset-list::-webkit-scrollbar-thumb:hover {
    background: #444;
  }
</style>
