<script lang="ts">
  /**
   * Show Timeline panel — the mapping-mode arrangement surface.
   *
   * Audio lanes (with a peak-envelope waveform) above a single preset lane.
   * Drag a block to move it, drag its edges to trim, drop an audio file
   * anywhere on the grid to add a track, drag a card out of the Preset Tray
   * to drop a composition onto the preset lane. Scrub the playhead, zoom the
   * ruler, and the transport at the top plays the whole programmed show.
   *
   * Every interaction goes through `showTimeline` — this component owns no
   * arrangement state of its own, which is what lets the offline renderer
   * drive the exact same evaluation with nothing mounted.
   *
   * Hidden in VJ mode for the same reason KeyframeTimeline is: it is a
   * content-programming tool, and VJ mode needs the screen. The TRANSPORT
   * is module-scoped in the store and deliberately keeps running when the
   * panel closes or unmounts — an operator who ducks into VJ mid-show, or
   * just collapses the tray to see the canvas, does not expect the show to
   * stop. `showTimeline.pause()` is the way to stop it.
   */
  import {
    showTimeline,
    SHOW_MIN_RULER_SECONDS,
    SHOW_MIN_ZOOM,
    SHOW_MAX_ZOOM,
    SHOW_DEFAULT_PRESET_SECONDS,
    clampShowTransitionDuration,
    findPrecedingShowClip,
    resolveTransitionStyle,
  } from '../stores/showTimeline';
  import { TRANSITION_OPTIONS, isTransitionStyle } from '../stores/presetTransition';
  import { compositions } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { clipAudioBus, clipAudioMaster, CLIP_AUDIO_BLOCK_TEXT } from '../audio/clipAudioBus';

  $: state = $showTimeline;
  $: isOpen = state.isOpen;

  // ── Audio output state ───────────────────────────────────────────────────
  // The clip-audio master is a persisted, APP-WIDE control whose only other UI
  // is a self-hiding button in the top bar. A mute set once (in VJ mode, weeks
  // ago) silenced the show timeline forever with no visible cause — and zeroed
  // the recording mixdown with it. Surface it here, where the audio is being
  // authored, so a silent show always names its own reason and is one click
  // from fixed.
  $: audioBlocked = state.audioTracks.length > 0 ? $clipAudioMaster.blocked : null;
  $: audioMuted = $clipAudioMaster.muted;
  $: audioVolumePct = Math.round($clipAudioMaster.volume * 100);
  $: audioTitle = audioBlocked
    ? `${CLIP_AUDIO_BLOCK_TEXT[audioBlocked]} — click to fix`
    : `Show audio output — ${audioVolumePct}%`;

  /** One click clears whatever is silencing the show, in the order a user
   *  would try them by hand. */
  function fixAudioOutput() {
    if ($clipAudioMaster.muted) clipAudioBus.setMasterMuted(false);
    if ($clipAudioMaster.volume <= 0) clipAudioBus.setMasterVolume(1);
    clipAudioBus.resume();
  }

  function toggleAudioOutput() {
    if (audioBlocked) fixAudioOutput();
    else clipAudioBus.setMasterMuted(true);
  }

  // Content-creation tool: hide + auto-close in VJ mode, exactly like the
  // keyframe timeline does.
  $: hiddenInVJ = $vjClipLauncher.isOpen;
  $: if (hiddenInVJ && isOpen) showTimeline.setOpen(false);

  const PRESET_LANE_HEIGHT = 46;
  const AUDIO_LANE_HEIGHT = 52;
  const RULER_HEIGHT = 20;

  // ── Tray height ────────────────────────────────────────────────────────
  // This is a bottom TRAY, not a takeover. It sizes to exactly the height its
  // own content needs — transport + the lanes that actually exist + the
  // inspector when one is showing — instead of reserving a fixed tall block
  // and leaving most of it empty grid. Past the ceiling the lane stack
  // scrolls rather than the panel growing.
  //
  // The ceiling is `min(260px, 38vh)` so a 13" laptop does not lose a third
  // of its screen to it. Dragging the top edge overrides the height (up to a
  // larger but still sane ceiling) and that override persists.
  const TRAY_HEIGHT_KEY = 'ghostarcade-show-tray-height';
  const TRAY_MIN_HEIGHT = 150;
  /** Space an always-on horizontal scrollbar would eat inside the grid.
   *  Zero on macOS overlay scrollbars, ~8–15 px on Windows. */
  const GRID_SCROLLBAR_ALLOWANCE = 10;

  function autoCeiling(vh: number): number {
    return Math.max(TRAY_MIN_HEIGHT, Math.round(Math.min(260, vh * 0.38)));
  }
  /** A hand-dragged tray may be taller than the auto ceiling — the user
   *  asked for it — but never so tall the app underneath disappears. */
  function dragCeiling(vh: number): number {
    return Math.max(TRAY_MIN_HEIGHT, Math.round(Math.min(720, vh * 0.62)));
  }

  function loadUserHeight(): number | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = parseFloat(localStorage.getItem(TRAY_HEIGHT_KEY) || '');
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch {
      return null;
    }
  }
  function saveUserHeight(h: number | null): void {
    if (typeof localStorage === 'undefined') return;
    try {
      if (h === null) localStorage.removeItem(TRAY_HEIGHT_KEY);
      else localStorage.setItem(TRAY_HEIGHT_KEY, String(Math.round(h)));
    } catch {
      /* private mode — the session still resizes fine */
    }
  }

  let viewportH = typeof window !== 'undefined' ? window.innerHeight : 900;
  let userHeight: number | null = loadUserHeight();
  /** Measured, not assumed: both bars wrap at narrow widths, and a wrapped
   *  transport that the height maths did not know about is exactly how the
   *  inspector ends up hanging out of the bottom of the tray. */
  let transportH = 36;
  let inspectorH = 0;

  $: laneStackH = RULER_HEIGHT + audioLaneCount * AUDIO_LANE_HEIGHT + PRESET_LANE_HEIGHT;
  // The bound clientHeight keeps its last value after the inspector
  // unmounts, so gate it on the selection rather than trusting the binding.
  $: inspectorVisible = !!(selectedPreset || selectedAudio);
  $: contentH =
    transportH + laneStackH + (inspectorVisible ? inspectorH : 0) + GRID_SCROLLBAR_ALLOWANCE + 1 /* top border */;
  $: autoH = Math.max(TRAY_MIN_HEIGHT, Math.min(contentH, autoCeiling(viewportH)));
  $: trayHeight = userHeight === null
    ? autoH
    : Math.max(TRAY_MIN_HEIGHT, Math.min(userHeight, dragCeiling(viewportH)));

  let resizingTray = false;

  function startTrayResize(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = trayHeight;
    resizingTray = true;
    const onMove = (ev: MouseEvent) => {
      // Top edge: dragging UP (a negative delta) makes the tray taller.
      const next = startH - (ev.clientY - startY);
      userHeight = Math.max(TRAY_MIN_HEIGHT, Math.min(Math.round(next), dragCeiling(viewportH)));
    };
    const onUp = () => {
      resizingTray = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveUserHeight(userHeight);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  /** Double-click the grip to go back to auto-fit. */
  function resetTrayHeight() {
    userHeight = null;
    saveUserHeight(null);
  }

  // Publish the live height so App.svelte can reserve viewport space for the
  // tray, the way it already does for the Presets / Sequencer / Keyframes
  // panels. Those three hard-code a constant because their heights are
  // constant; this one is content-sized and resizable, so it has to be a
  // variable. Cleared on close so the viewport springs straight back.
  $: if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty(
      '--ga-show-tray-height',
      isOpen && !hiddenInVJ ? `${trayHeight}px` : '0px',
    );
  }

  $: zoom = state.zoom;
  $: rulerSeconds = Math.max(state.duration, SHOW_MIN_RULER_SECONDS);
  $: totalWidth = rulerSeconds * zoom;
  $: playheadX = state.currentTime * zoom;
  $: audioLaneCount = Math.max(1, state.audioTracks.reduce((m, t) => Math.max(m, t.lane + 1), 0));
  $: audioLanes = Array.from({ length: audioLaneCount }, (_, i) => i);

  $: rulerTicks = (() => {
    const ticks: { x: number; label: string; major: boolean }[] = [];
    // Pick a step that keeps labels ~60px apart at any zoom.
    const candidates = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = candidates.find((c) => c * zoom >= 60) ?? 600;
    for (let t = 0; t <= rulerSeconds + 1e-6; t += step) {
      ticks.push({ x: t * zoom, label: formatTime(t), major: t % (step * 4) === 0 });
    }
    return ticks;
  })();

  function formatTime(t: number): string {
    const safe = Math.max(0, t);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    return `${m}:${String(s).padStart(2, '0')}`;
  }
  function formatPrecise(t: number): string {
    const safe = Math.max(0, t);
    const m = Math.floor(safe / 60);
    const s = Math.floor(safe % 60);
    const d = Math.floor((safe % 1) * 10);
    return `${m}:${String(s).padStart(2, '0')}.${d}`;
  }

  function compositionName(id: string, fallback?: string): string {
    return $compositions.find((c) => c.id === id)?.name ?? fallback ?? 'Missing preset';
  }

  // ── Grid geometry ──────────────────────────────────────────────────────
  let gridEl: HTMLDivElement | undefined;
  /** Grid scrollTop, mirrored onto the lane-label column. */
  let laneScrollTop = 0;

  function timeAt(e: MouseEvent | DragEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left + gridEl.scrollLeft) / zoom);
  }

  function laneAt(e: DragEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    const y = e.clientY - rect.top + gridEl.scrollTop - RULER_HEIGHT;
    if (y < 0) return 0;
    return Math.max(0, Math.min(audioLaneCount, Math.floor(y / AUDIO_LANE_HEIGHT)));
  }

  // ── Scrub ──────────────────────────────────────────────────────────────
  let suppressNextClick = false;

  function seekFromClick(e: MouseEvent) {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const target = e.target as HTMLElement;
    if (target.closest('.show-block') || target.closest('.show-playhead')) return;
    showTimeline.seek(timeAt(e));
  }

  function startScrub(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const onMove = (ev: MouseEvent) => showTimeline.seek(timeAt(ev));
    const onUp = () => {
      suppressNextClick = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Block drag / resize ────────────────────────────────────────────────
  type BlockKind = 'preset' | 'audio';

  function startBlockDrag(e: MouseEvent, kind: BlockKind, id: string, startTime: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind, id });
    const grabOffset = timeAt(e) - startTime;
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      moved = true;
      const next = timeAt(ev) - grabOffset;
      if (kind === 'preset') showTimeline.movePresetClip(id, next);
      else showTimeline.moveAudioTrack(id, next);
    };
    const onUp = () => {
      if (moved) suppressNextClick = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function startBlockResize(e: MouseEvent, kind: BlockKind, id: string, edge: 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind, id });
    let moved = false;
    const onMove = (ev: MouseEvent) => {
      moved = true;
      const t = timeAt(ev);
      if (kind === 'preset') showTimeline.resizePresetClip(id, edge, t);
      else showTimeline.resizeAudioTrack(id, edge, t);
    };
    const onUp = () => {
      if (moved) suppressNextClick = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Drops: audio files + preset tray cards ─────────────────────────────
  let dragHover = false;

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    dragHover = true;
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragHover = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    const dropTime = timeAt(e);

    // A card dragged out of the Preset Tray carries its index into the
    // current compositions list (PresetTray.handlePresetDragStart).
    const presetIndex = dt.getData('application/x-ghost-mapping-preset');
    if (presetIndex) {
      const comp = $compositions[Number(presetIndex)];
      if (comp) {
        showTimeline.insertPresetClipAt(comp.id, dropTime, SHOW_DEFAULT_PRESET_SECONDS, comp.name);
      }
      return;
    }

    const lane = laneAt(e);
    const files = Array.from(dt.files ?? []).filter(
      (f) => f.type.startsWith('audio/') || /\.(mp3|wav|ogg|m4a|aac|flac|aif|aiff)$/i.test(f.name),
    );
    let cursor = dropTime;
    for (const file of files) {
      await showTimeline.addAudioTrackFromFile(file, { startTime: cursor, lane });
      cursor += 0.001; // keep drop order stable; lane placement resolves overlap
    }
  }

  let audioInput: HTMLInputElement | undefined;
  async function handleAudioPick(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const file of files) {
      await showTimeline.addAudioTrackFromFile(file, { startTime: state.currentTime });
    }
    input.value = '';
  }

  // ── Add preset ─────────────────────────────────────────────────────────
  let addPresetId = '';
  function addPreset() {
    const comp = $compositions.find((c) => c.id === addPresetId) ?? $compositions[0];
    if (!comp) return;
    showTimeline.addPresetClip(comp.id, SHOW_DEFAULT_PRESET_SECONDS, comp.name);
  }

  // ── Selection inspector ────────────────────────────────────────────────
  $: selectedPreset = state.selection?.kind === 'preset'
    ? state.presetClips.find((c) => c.id === state.selection!.id) ?? null
    : null;
  $: selectedAudio = state.selection?.kind === 'audio'
    ? state.audioTracks.find((t) => t.id === state.selection!.id) ?? null
    : null;

  function deleteSelected() {
    if (selectedPreset) showTimeline.removePresetClip(selectedPreset.id);
    else if (selectedAudio) showTimeline.removeAudioTrack(selectedAudio.id);
  }

  // ── Clip transition (inspector) ────────────────────────────────────────
  // `transitionIn` runs FORWARD from the clip's start time — see the
  // "Clip transitions" block in stores/showTimeline.ts for why start-at and
  // not lead-in. The effective length is clamped to the shorter of the two
  // neighbouring clips, and the inspector says so out loud when the clamp
  // actually bites: a 5 s dissolve silently becoming 1 s is the kind of
  // thing you otherwise only discover mid-show.
  $: selectedTransitionIn = selectedPreset?.transitionIn ?? 'cut';
  $: selectedTransitionStyle = resolveTransitionStyle(selectedTransitionIn);
  $: selectedTransitionPrev = selectedPreset
    ? findPrecedingShowClip(state.presetClips, selectedPreset)
    : null;
  $: selectedTransitionEffective = selectedPreset
    ? clampShowTransitionDuration(selectedPreset.transitionDuration, selectedPreset, selectedTransitionPrev)
    : 0;
  $: selectedTransitionClamped =
    !!selectedPreset &&
    selectedTransitionStyle !== null &&
    (selectedPreset.transitionDuration ?? 0) - selectedTransitionEffective > 0.01;

  // ── Waveform path ──────────────────────────────────────────────────────
  const WAVE_VIEW_H = 40;

  /** Mirror the peak envelope around the lane's midline. Only the visible
   *  [offset, offset+duration] slice of the source is drawn, so trimming a
   *  track scrolls the waveform rather than squashing it. */
  function wavePath(peaks: number[] | undefined, offset: number, duration: number, sourceDuration: number): string {
    if (!peaks || peaks.length === 0) return '';
    const total = sourceDuration > 0 ? sourceDuration : duration;
    if (total <= 0) return '';
    const from = Math.max(0, Math.floor((offset / total) * peaks.length));
    const to = Math.min(peaks.length, Math.max(from + 1, Math.ceil(((offset + duration) / total) * peaks.length)));
    const slice = peaks.slice(from, to);
    if (slice.length === 0) return '';
    const n = slice.length;
    const mid = WAVE_VIEW_H / 2;
    let top = '';
    let bottom = '';
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * 1000;
      const amp = (slice[i] / 255) * (WAVE_VIEW_H / 2);
      top += `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${(mid - amp).toFixed(2)}`;
      bottom = `L${x.toFixed(2)},${(mid + amp).toFixed(2)}` + bottom;
    }
    return `${top}${bottom}Z`;
  }

  // ── Keyboard (gated on pointer-over so it can't fight other panels) ────
  let pointerInTray = false;
  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen || hiddenInVJ || !pointerInTray) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      showTimeline.togglePlay();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && state.selection) {
      e.preventDefault();
      deleteSelected();
    }
  }

  function handleWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    showTimeline.setZoom(zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
  }

  let showClearConfirm = false;
  function confirmClear() {
    showTimeline.clear();
    showClearConfirm = false;
  }
</script>

<svelte:window onkeydown={handleKeydown} bind:innerHeight={viewportH} />

{#if !hiddenInVJ}
  <button
    class="show-toggle"
    class:active={isOpen}
    onclick={() => showTimeline.toggleOpen()}
    title="Show Timeline"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="4" width="9" height="6" rx="1"/>
      <rect x="13" y="4" width="9" height="6" rx="1"/>
      <path d="M2 16h3l1.5-3L8 19l1.5-3H12l1.5-3L15 19l1.5-3H22"/>
    </svg>
    <span>Show</span>
  </button>
{/if}

{#if isOpen && !hiddenInVJ}
  <div
    class="show-tray"
    class:resizing={resizingTray}
    style="height: {trayHeight}px"
    role="region"
    aria-label="Show timeline"
    onmouseenter={() => pointerInTray = true}
    onmouseleave={() => pointerInTray = false}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tray-resize"
      onmousedown={startTrayResize}
      ondblclick={resetTrayHeight}
      title="Drag to resize the show panel — double-click to fit its contents"
    >
      <div class="resize-grip"></div>
    </div>

    <div class="show-header-btns">
      <button class="show-clear" onclick={() => showClearConfirm = true} title="Clear the whole show">Clear</button>
      <button class="show-close" onclick={() => showTimeline.setOpen(false)} title="Close show timeline">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Transport -->
    <div class="show-transport" bind:clientHeight={transportH}>
      <button
        class="t-btn"
        class:active={state.isPlaying}
        disabled={state.duration <= 0}
        onclick={() => showTimeline.togglePlay()}
        title={state.isPlaying ? 'Pause show' : 'Play show'}
      >
        {#if state.isPlaying}
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3.5" height="10" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" fill="currentColor"/></svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>
        {/if}
      </button>
      <button class="t-btn" onclick={() => showTimeline.stop()} title="Stop and rewind">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="currentColor"/></svg>
      </button>
      <button class="t-btn" class:active={state.loop} onclick={() => showTimeline.setLoop(!state.loop)} title="Loop the show">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
          <path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
        </svg>
      </button>

      <span class="t-time">{formatPrecise(state.currentTime)}</span>
      <span class="t-sep">/</span>
      <span class="t-total" title="Total programmed show length">{formatPrecise(state.duration)}</span>

      <span class="t-divider"></span>

      <!-- Show audio output. Never hidden while the show has audio: a muted
           or blocked bus is exactly the state the user needs to SEE. -->
      {#if state.audioTracks.length > 0}
        <button
          class="t-btn t-audio"
          class:blocked={audioBlocked !== null}
          onclick={toggleAudioOutput}
          title={audioTitle}
          aria-label={audioTitle}
        >
          {#if audioBlocked !== null}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          {/if}
        </button>
<!-- Wrapper, not a width on the input: the app-wide
             `input[type="range"]:not(…)` skin in App.svelte sets width:100%
             at a specificity this scoped rule cannot beat. Constraining the
             parent keeps that shared track/thumb styling AND the size. -->
        <span class="t-audio-level">
          <input
            type="range"
            min="0" max="1" step="0.01"
            value={$clipAudioMaster.volume}
            disabled={audioMuted}
            oninput={(e) => clipAudioBus.setMasterVolume(+(e.currentTarget as HTMLInputElement).value)}
            title="Show audio output level"
            aria-label="Show audio output level"
          />
        </span>
        {#if audioBlocked !== null}
          <button class="t-audio-warn" onclick={fixAudioOutput} title="Click to restore show audio output">
            {CLIP_AUDIO_BLOCK_TEXT[audioBlocked]}
          </button>
        {/if}
      {/if}

      <span class="t-divider"></span>

      <button class="t-btn" onclick={() => showTimeline.setZoom(zoom / 1.4)} disabled={zoom <= SHOW_MIN_ZOOM} title="Zoom out">−</button>
      <button class="t-btn" onclick={() => showTimeline.setZoom(zoom * 1.4)} disabled={zoom >= SHOW_MAX_ZOOM} title="Zoom in">+</button>
      <button class="t-chip" class:active={state.snapEnabled} onclick={() => showTimeline.setSnapEnabled(!state.snapEnabled)} title="Snap to the 0.25s grid and to clip edges">
        Snap
      </button>

      <span class="t-divider"></span>

      <select class="t-select" bind:value={addPresetId} title="Preset to add">
        <option value="">Choose preset…</option>
        {#each $compositions as comp}
          <option value={comp.id}>{comp.name}</option>
        {/each}
      </select>
      <button class="t-chip" onclick={addPreset} disabled={$compositions.length === 0} title="Append this preset to the end of the show">
        + Preset
      </button>
      <button class="t-chip" onclick={() => audioInput?.click()} title="Add an audio file">+ Audio</button>
      <button class="t-chip" onclick={() => showTimeline.compactPresetClips()} disabled={state.presetClips.length < 2} title="Close every gap on the preset lane">
        Compact
      </button>
      <input
        class="hidden-file"
        type="file"
        accept="audio/*"
        multiple
        bind:this={audioInput}
        onchange={handleAudioPick}
      />
    </div>

    <!-- Body: lane labels + scrolling grid -->
    <div class="show-body">
      <div class="lane-labels">
        <div class="label-ruler-spacer" style="height: {RULER_HEIGHT}px"></div>
        <!-- Translated, not scrolled: the grid owns the scroll and the ruler
             spacer above has to stay pinned the way the sticky ruler does.
             Matters now that a short tray really can clip the lane stack. -->
        <div class="label-rows" style="transform: translateY({-laneScrollTop}px)">
          {#each audioLanes as lane}
            <div class="lane-label audio" style="height: {AUDIO_LANE_HEIGHT}px">
              <span class="lane-name">Audio {lane + 1}</span>
            </div>
          {/each}
          <div class="lane-label preset" style="height: {PRESET_LANE_HEIGHT}px">
            <span class="lane-name">Presets</span>
          </div>
        </div>
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="show-grid"
        class:drag-hover={dragHover}
        bind:this={gridEl}
        onclick={seekFromClick}
        onscroll={() => laneScrollTop = gridEl?.scrollTop ?? 0}
        onwheel={handleWheel}
        ondragover={handleDragOver}
        ondragleave={() => dragHover = false}
        ondrop={handleDrop}
      >
        <div class="show-ruler" style="width: {totalWidth}px; height: {RULER_HEIGHT}px" onmousedown={startScrub}>
          {#each rulerTicks as tick}
            <div class="ruler-tick" class:major={tick.major} style="left: {tick.x}px">
              <span class="ruler-label">{tick.label}</span>
            </div>
          {/each}
        </div>

        <div class="lanes" style="width: {totalWidth}px">
          {#each audioLanes as lane}
            <div class="lane audio-lane" style="height: {AUDIO_LANE_HEIGHT}px">
              {#each state.audioTracks.filter((t) => t.lane === lane) as track (track.id)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div
                  class="show-block audio-block"
                  class:selected={state.selection?.kind === 'audio' && state.selection.id === track.id}
                  class:missing={!track.url}
                  class:muted={track.muted}
                  style="left: {track.startTime * zoom}px; width: {Math.max(6, track.duration * zoom)}px"
                  onmousedown={(e) => startBlockDrag(e, 'audio', track.id, track.startTime)}
                  title={`${track.name} — ${formatPrecise(track.duration)}${track.url ? '' : ' (media missing)'}`}
                >
                  <div class="handle left" onmousedown={(e) => startBlockResize(e, 'audio', track.id, 'start')}></div>
                  <svg class="wave" viewBox="0 0 1000 {WAVE_VIEW_H}" preserveAspectRatio="none" aria-hidden="true">
                    <path d={wavePath(track.peaks, track.offset, track.duration, track.sourceDuration)} />
                  </svg>
                  <span class="block-label">
                    {track.muted ? '🔇 ' : ''}{track.name}
                  </span>
                  <div class="handle right" onmousedown={(e) => startBlockResize(e, 'audio', track.id, 'end')}></div>
                </div>
              {/each}
            </div>
          {/each}

          <div class="lane preset-lane" style="height: {PRESET_LANE_HEIGHT}px">
            {#each state.presetClips as clip (clip.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="show-block preset-block"
                class:selected={state.selection?.kind === 'preset' && state.selection.id === clip.id}
                class:live={state.activeClipId === clip.id}
                style="left: {clip.startTime * zoom}px; width: {Math.max(6, clip.duration * zoom)}px"
                onmousedown={(e) => startBlockDrag(e, 'preset', clip.id, clip.startTime)}
                title={`${compositionName(clip.compositionId, clip.label)} — ${formatPrecise(clip.duration)}`}
              >
                <div class="handle left" onmousedown={(e) => startBlockResize(e, 'preset', clip.id, 'start')}></div>
                <span class="block-label">{compositionName(clip.compositionId, clip.label)}</span>
                <span class="block-dur">{formatPrecise(clip.duration)}</span>
                <div class="handle right" onmousedown={(e) => startBlockResize(e, 'preset', clip.id, 'end')}></div>
              </div>
            {/each}
            {#if state.presetClips.length === 0}
              <span class="lane-empty">Drop a preset card here, or use “+ Preset”.</span>
            {/if}
          </div>
        </div>

        <div class="show-playhead" style="left: {playheadX}px" onmousedown={startScrub}>
          <div class="playhead-handle"></div>
          <div class="playhead-line"></div>
        </div>
      </div>
    </div>

    <!-- Inspector -->
    {#if selectedPreset}
      <div class="show-inspector" bind:clientHeight={inspectorH}>
        <span class="insp-title">Preset clip</span>
        <label class="insp-field insp-wide">
          <span>Composition</span>
          <select
            value={selectedPreset.compositionId}
            onchange={(e) => showTimeline.updatePresetClip(selectedPreset.id, {
              compositionId: (e.target as HTMLSelectElement).value,
              label: $compositions.find((c) => c.id === (e.target as HTMLSelectElement).value)?.name,
            })}
          >
            {#each $compositions as comp}
              <option value={comp.id}>{comp.name}</option>
            {/each}
            {#if !$compositions.some((c) => c.id === selectedPreset.compositionId)}
              <option value={selectedPreset.compositionId}>{selectedPreset.label ?? 'Missing preset'}</option>
            {/if}
          </select>
        </label>
        <label class="insp-field">
          <span>Start</span>
          <input
            type="number" min="0" step="0.25"
            value={selectedPreset.startTime.toFixed(2)}
            onchange={(e) => showTimeline.movePresetClip(selectedPreset.id, parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field">
          <span>Duration</span>
          <input
            type="number" min="0.25" step="0.25"
            value={selectedPreset.duration.toFixed(2)}
            onchange={(e) => showTimeline.resizePresetClip(
              selectedPreset.id, 'end',
              selectedPreset.startTime + parseFloat((e.target as HTMLInputElement).value),
            )}
          />
          <span class="insp-unit">s</span>
        </label>

        <!-- Transition. Same styles the preset tray offers, fired through
             the same engine call; new clips are born with whatever the tray
             is set to, and this is the per-clip override. -->
        <label class="insp-field">
          <span>Transition</span>
          <select
            class="insp-transition"
            value={selectedTransitionIn}
            onchange={(e) => showTimeline.updatePresetClip(selectedPreset.id, {
              transitionIn: (e.target as HTMLSelectElement).value as typeof selectedTransitionIn,
            })}
            title="What happens at this clip's start. The blend runs forward from the clip's start time."
          >
            <option value="cut">Cut</option>
            {#each TRANSITION_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
            {#if !isTransitionStyle(selectedTransitionIn) && selectedTransitionIn !== 'cut'}
              <!-- Legacy VJ-timeline value from an older project file. -->
              <option value={selectedTransitionIn}>{selectedTransitionIn} (legacy)</option>
            {/if}
          </select>
        </label>
        {#if selectedTransitionStyle}
          <label class="insp-field">
            <span>Fade</span>
            <input
              class="insp-fade"
              type="number" min="0" step="0.25"
              value={(selectedPreset.transitionDuration ?? 0).toFixed(2)}
              onchange={(e) => showTimeline.updatePresetClip(selectedPreset.id, {
                transitionDuration: Math.max(0, parseFloat((e.target as HTMLInputElement).value) || 0),
              })}
            />
            <span class="insp-unit">s</span>
          </label>
          {#if selectedTransitionClamped}
            <span
              class="insp-note"
              title="Clamped to the shorter of this clip and the one before it, so a transition can never outlive its clip."
            >→ {selectedTransitionEffective.toFixed(2)}s</span>
          {/if}
        {/if}

        <button class="insp-delete" onclick={deleteSelected}>Delete</button>
        <button class="insp-close" onclick={() => showTimeline.select(null)}>×</button>
      </div>
    {:else if selectedAudio}
      <div class="show-inspector" bind:clientHeight={inspectorH}>
        <span class="insp-title">Audio track</span>
        <label class="insp-field insp-wide">
          <span>Name</span>
          <input
            type="text"
            value={selectedAudio.name}
            onchange={(e) => showTimeline.renameAudioTrack(selectedAudio.id, (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="insp-field">
          <span>Start</span>
          <input
            type="number" min="0" step="0.25"
            value={selectedAudio.startTime.toFixed(2)}
            onchange={(e) => showTimeline.moveAudioTrack(selectedAudio.id, parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field">
          <span>Length</span>
          <input
            type="number" min="0.25" step="0.25"
            value={selectedAudio.duration.toFixed(2)}
            onchange={(e) => showTimeline.resizeAudioTrack(
              selectedAudio.id, 'end',
              selectedAudio.startTime + parseFloat((e.target as HTMLInputElement).value),
            )}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field">
          <span>Vol</span>
          <input
            class="insp-range"
            type="range" min="0" max="1" step="0.01"
            value={selectedAudio.volume}
            oninput={(e) => showTimeline.setAudioTrackVolume(selectedAudio.id, parseFloat((e.target as HTMLInputElement).value))}
          />
        </label>
        <button
          class="insp-chip"
          class:on={selectedAudio.muted}
          onclick={() => showTimeline.setAudioTrackMuted(selectedAudio.id, !selectedAudio.muted)}
        >{selectedAudio.muted ? 'Muted' : 'Mute'}</button>
        {#if !selectedAudio.url}
          <span class="insp-warn">Media missing — re-add the file</span>
        {/if}
        <button class="insp-delete" onclick={deleteSelected}>Delete</button>
        <button class="insp-close" onclick={() => showTimeline.select(null)}>×</button>
      </div>
    {/if}

    {#if showClearConfirm}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="show-modal-backdrop" onclick={() => showClearConfirm = false}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="show-modal" onclick={(e) => e.stopPropagation()}>
          <h3>Clear the show?</h3>
          <p>This removes every audio track and preset clip from the timeline. Your presets and media files are not touched.</p>
          <div class="show-modal-btns">
            <button class="modal-cancel" onclick={() => showClearConfirm = false}>Cancel</button>
            <button class="modal-confirm" onclick={confirmClear}>Clear Show</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .show-toggle {
    position: fixed;
    bottom: 24px;
    left: calc(50% + 320px);
    transform: translateX(-50%);
    z-index: 1002;
    display: flex;
    align-items: center;
    gap: 8px;
    background: linear-gradient(135deg, #0d0d10, #111114);
    border: 1px solid #444;
    color: var(--text-primary, #ddd);
    font-size: 13px;
    font-weight: 600;
    padding: 8px 16px;
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    font-family: inherit;
  }
  .show-toggle:hover {
    border-color: var(--ga-coral, #ff6f5e);
    box-shadow: 0 4px 30px color-mix(in srgb, var(--ga-coral, #ff6f5e) 20%, transparent);
  }
  .show-toggle.active {
    border-color: var(--ga-coral, #ff6f5e);
    background: linear-gradient(135deg, #1a2020, #201515);
  }

  /* Height comes from the inline style (auto-fit to content, or the user's
     dragged override) — see the "Tray height" block in the script.

     The background is FULLY OPAQUE on purpose. At 0.98 alpha the canvas and
     the layer-panel chrome behind it ghosted straight through, which is
     unreadable over high-contrast visuals; every inner surface below is
     opaque for the same reason. Anything wanting a blur here has to sit on
     top of this base layer, not replace it. */
  .show-tray {
    position: fixed;
    bottom: var(--ga-bottom-rail-offset, 74px);
    left: 0;
    right: 0;
    z-index: 90;
    background: #0a0a0e;
    border-top: 1px solid color-mix(in srgb, var(--ga-coral, #ff6f5e) 15%, transparent);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.2s ease-out;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
  }
  /* Suppress the entry animation mid-drag: re-running it on every reactive
     height change makes the panel visibly jitter under the pointer. */
  .show-tray.resizing { animation: none; }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .tray-resize {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 7px;
    z-index: 12;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .resize-grip {
    width: 40px;
    height: 3px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.14);
  }
  .tray-resize:hover .resize-grip,
  .show-tray.resizing .resize-grip {
    background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 70%, transparent);
  }

  .show-header-btns {
    position: absolute;
    top: 6px;
    right: 10px;
    z-index: 10;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .show-clear {
    background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 15%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-coral, #ff6f5e) 35%, transparent);
    color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 78%, #ffffff);
    font-size: 11px;
    font-weight: 600;
    padding: 5px 10px;
    border-radius: 4px;
    cursor: pointer;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    font-family: inherit;
  }
  .show-clear:hover { background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 25%, transparent); color: #fff; }
  .show-close {
    width: 26px;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: linear-gradient(135deg, var(--ga-coral, #ff6f5e), color-mix(in srgb, var(--ga-coral, #ff6f5e) 70%, #000000));
    border: 1px solid rgba(255, 255, 255, 0.2);
    color: #fff;
    border-radius: 4px;
    cursor: pointer;
  }
  .show-close:hover { transform: scale(1.05); }

  .show-transport {
    display: flex;
    align-items: center;
    gap: 5px;
    /* 7px of top padding clears the resize strip so the transport buttons
       are not sitting under an ns-resize cursor. */
    padding: 7px 8px 5px;
    padding-right: 130px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: #0a0a0e;
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .t-btn {
    background: none;
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-muted, #888);
    width: 26px;
    height: 26px;
    border-radius: 4px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 14px;
    font-family: inherit;
  }
  .t-btn:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.2); }
  .t-btn:disabled { opacity: 0.35; cursor: default; }
  .t-btn.active { color: var(--ga-coral, #ff6f5e); border-color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 40%, transparent); }
  .t-chip {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    font-weight: 600;
    border-radius: 4px;
    padding: 5px 9px;
    cursor: pointer;
    font-family: inherit;
  }
  .t-chip:hover:not(:disabled) { color: #fff; border-color: rgba(255, 255, 255, 0.25); }
  .t-chip:disabled { opacity: 0.35; cursor: default; }
  .t-chip.active {
    color: var(--ga-coral, #ff6f5e);
    border-color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 45%, transparent);
    background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 12%, transparent);
  }
  .t-select {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    border-radius: 3px;
    padding: 4px 6px;
    outline: none;
    max-width: 170px;
    font-family: inherit;
  }
  .t-time {
    font-family: var(--font-jetbrains), monospace;
    font-size: 13px;
    color: var(--text-primary, #ddd);
    min-width: 58px;
    text-align: center;
  }
  .t-total {
    font-family: var(--font-jetbrains), monospace;
    font-size: 13px;
    color: var(--text-muted, #888);
    min-width: 58px;
  }
  .t-sep { color: #444; }
  .t-divider { width: 1px; height: 18px; background: rgba(255, 255, 255, 0.1); margin: 0 4px; }
  .hidden-file { display: none; }

  /* Audio output — amber when the show is audible, red when something is
     silencing it, so a dead show is never mistaken for a working one.
     Literal hex rather than --ga-coral: that token resolves to a near-white
     (#e7eef5) on the current theme, which would render the warning state
     indistinguishable from every other control in this bar. */
  .t-audio { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }
  .t-audio:hover:not(:disabled) { color: #fde68a; border-color: rgba(251, 191, 36, 0.6); }
  .t-audio.blocked {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.6);
    background: rgba(248, 113, 113, 0.15);
  }
  .t-audio.blocked:hover { color: #fca5a5; border-color: #f87171; }
  .t-audio-level {
    display: flex;
    align-items: center;
    flex: 0 0 62px;
    width: 62px;
    accent-color: #fbbf24;
  }
  .t-audio-warn {
    font-size: 10.5px;
    font-weight: 600;
    font-family: inherit;
    color: #f87171;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.45);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .t-audio-warn:hover { color: #fff; background: rgba(248, 113, 113, 0.25); border-color: #f87171; }

  /* `flex: 1` + `min-height: 0` is what lets the tray be short: the body
     takes whatever is left after the transport and the inspector have had
     their intrinsic heights, and the grid inside it scrolls. Without the
     min-height a wrapped transport bar or a tall lane stack would refuse to
     shrink and push the inspector out through the bottom of the tray. */
  .show-body {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .lane-labels {
    width: 108px;
    flex: 0 0 108px;
    background: #0e0e12;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .label-ruler-spacer { border-bottom: 1px solid rgba(255, 255, 255, 0.08); }
  .label-rows { will-change: transform; }
  .lane-label {
    display: flex;
    align-items: center;
    padding: 0 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    box-sizing: border-box;
  }
  .lane-name {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #7a7a86;
    font-weight: 600;
  }
  .lane-label.preset .lane-name { color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 75%, #ffffff); }

  .show-grid {
    flex: 1;
    min-width: 0;
    overflow: auto;
    position: relative;
    background: #08080c;
    cursor: crosshair;
  }
  .show-grid.drag-hover { background: #12100c; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-coral, #ff6f5e) 45%, transparent); }

  .show-ruler {
    position: sticky;
    top: 0;
    z-index: 4;
    background: #0e0e12;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    cursor: col-resize;
  }
  .ruler-tick {
    position: absolute;
    top: 0;
    height: 100%;
    border-left: 1px solid rgba(255, 255, 255, 0.08);
  }
  .ruler-tick.major { border-left-color: rgba(255, 255, 255, 0.2); }
  .ruler-label {
    position: absolute;
    top: 4px;
    left: 3px;
    font-size: 9px;
    color: #666;
    font-family: var(--font-jetbrains), monospace;
    white-space: nowrap;
  }

  .lanes { position: relative; }
  .lane {
    position: relative;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
    box-sizing: border-box;
  }
  .audio-lane { background: rgba(255, 255, 255, 0.012); }
  .preset-lane { background: rgba(255, 111, 94, 0.04); }
  .lane-empty {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 11px;
    color: #55555f;
    pointer-events: none;
  }

  .show-block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    border-radius: 4px;
    overflow: hidden;
    cursor: grab;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    user-select: none;
  }
  .show-block:active { cursor: grabbing; }
  .audio-block {
    background: linear-gradient(180deg, rgba(92, 225, 230, 0.16), rgba(92, 225, 230, 0.07));
    border: 1px solid rgba(92, 225, 230, 0.45);
  }
  .audio-block.muted { opacity: 0.45; }
  .audio-block.missing {
    background: rgba(255, 71, 87, 0.12);
    border-color: rgba(255, 71, 87, 0.5);
  }
  .preset-block {
    background: linear-gradient(180deg, color-mix(in srgb, var(--ga-coral, #ff6f5e) 24%, transparent), color-mix(in srgb, var(--ga-coral, #ff6f5e) 10%, transparent));
    border: 1px solid color-mix(in srgb, var(--ga-coral, #ff6f5e) 50%, transparent);
    justify-content: space-between;
    padding: 0 8px;
  }
  .preset-block.live {
    border-color: #FFD96B;
    box-shadow: 0 0 0 1px rgba(255, 217, 107, 0.5), 0 0 12px rgba(255, 217, 107, 0.25);
  }
  .show-block.selected {
    box-shadow: 0 0 0 1px #FFD96B, 0 0 10px rgba(255, 217, 107, 0.3);
    z-index: 3;
  }

  .wave {
    position: absolute;
    inset: 4px 0;
    width: 100%;
    height: calc(100% - 8px);
    pointer-events: none;
  }
  .wave path { fill: rgba(92, 225, 230, 0.55); }

  .block-label {
    position: relative;
    z-index: 1;
    font-size: 11px;
    font-weight: 600;
    color: #e8e8ee;
    padding: 0 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.85);
    pointer-events: none;
  }
  .preset-block .block-label { padding: 0; }
  .block-dur {
    position: relative;
    z-index: 1;
    font-size: 10px;
    color: rgba(255, 255, 255, 0.55);
    font-family: var(--font-jetbrains), monospace;
    white-space: nowrap;
    pointer-events: none;
  }

  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 7px;
    z-index: 2;
    cursor: ew-resize;
  }
  .handle.left { left: 0; }
  .handle.right { right: 0; }
  .handle:hover { background: rgba(255, 255, 255, 0.25); }

  .show-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    z-index: 6;
    cursor: col-resize;
  }
  .playhead-handle {
    position: absolute;
    top: 0;
    left: -5px;
    width: 11px;
    height: 10px;
    background: #FFD96B;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
  .playhead-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: #FFD96B;
    opacity: 0.85;
  }

  .show-inspector {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    background: #121217;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
    font-size: 12px;
    color: #bbb;
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .insp-title {
    color: #FFD96B;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 11px;
    padding-right: 8px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
  }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: rgba(255, 255, 255, 0.55); }
  .insp-field input[type="number"],
  .insp-field input[type="text"],
  .insp-field select {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: var(--text-primary, #e8e8e8);
    font-size: 12px;
    padding: 3px 6px;
    width: 78px;
    outline: none;
    font-family: inherit;
  }
  .insp-wide input[type="text"], .insp-wide select { width: 168px; }
  .insp-field select.insp-transition { width: 118px; }
  .insp-field input.insp-fade { width: 62px; }
  .insp-range { width: 90px; }
  .insp-unit { color: rgba(255, 255, 255, 0.35); }
  /* Shown only when the transition-length clamp actually shortens the
     value the user typed. */
  .insp-note {
    font-size: 11px;
    font-weight: 600;
    color: #FFD96B;
    background: rgba(255, 217, 107, 0.1);
    border: 1px solid rgba(255, 217, 107, 0.3);
    border-radius: 3px;
    padding: 2px 6px;
    white-space: nowrap;
  }
  .insp-chip {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: #bbb;
    font-size: 11px;
    padding: 3px 9px;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
  }
  .insp-chip.on { color: #FFD96B; border-color: rgba(255, 217, 107, 0.5); }
  .insp-warn { color: #FF6B6B; font-size: 11px; }
  .insp-delete {
    margin-left: auto;
    background: rgba(255, 71, 87, 0.1);
    border: 1px solid rgba(255, 71, 87, 0.4);
    color: #FF4757;
    font-size: 12px;
    padding: 3px 10px;
    border-radius: 3px;
    cursor: pointer;
    font-family: inherit;
  }
  .insp-delete:hover { background: rgba(255, 71, 87, 0.2); }
  .insp-close {
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.5);
    font-size: 17px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .insp-close:hover { color: #fff; }

  .show-modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .show-modal {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid color-mix(in srgb, var(--ga-coral, #ff6f5e) 40%, transparent);
    border-radius: 8px;
    padding: 20px 24px;
    max-width: 400px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.8);
  }
  .show-modal h3 {
    margin: 0 0 10px 0;
    color: var(--ga-coral, #ff6f5e);
    font-size: 15px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .show-modal p {
    margin: 0 0 16px 0;
    color: var(--text-secondary, #aaa);
    font-size: 13px;
    line-height: 1.5;
  }
  .show-modal-btns { display: flex; gap: 10px; justify-content: flex-end; }
  .modal-cancel {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    color: var(--text-primary, #ccc);
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 600;
  }
  .modal-confirm {
    background: linear-gradient(135deg, #FF6B6B, #FF4757);
    border: 1px solid rgba(255, 107, 107, 0.6);
    color: #fff;
    padding: 6px 14px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
    font-family: inherit;
    font-weight: 700;
  }
</style>
