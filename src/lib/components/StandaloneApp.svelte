<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { StandaloneAudio, SILENT_AUDIO } from '../mobile/standaloneAudio';
  import { StandaloneRenderer } from '../mobile/standaloneRenderer';
  import { MOBILE_SHADERS, findShader, type MobileShader } from '../mobile/standaloneShaderList';
  import StandaloneShaderPicker from './StandaloneShaderPicker.svelte';
  import StandaloneProjectionMap from './StandaloneProjectionMap.svelte';

  export let onSwitchMode: () => void;

  // ── Persistent state ──
  // 9-slot clip grid. Each slot stores a shader id; null = empty.
  // Crossfader 0..1: 0 = full deck A, 1 = full deck B.
  // Initial clip layout pre-fills the grid with the first 9 shaders so a
  // first-time user sees something cool the moment they tap any pad.
  type SavedState = {
    clips: (string | null)[];
    crossfader: number;
    deckA: string | null;
    deckB: string | null;
    blendMode: string;
    projection?: { corners?: { x: number; y: number }[]; enabled?: boolean };
  };
  const SAVE_KEY = 'ga-mobile-vj-state';

  function loadSavedState(): SavedState {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        // Validate clip ids — drop any that point at shaders we no longer ship.
        if (Array.isArray(parsed.clips)) {
          parsed.clips = parsed.clips.map((id: any) => (typeof id === 'string' && findShader(id) ? id : null));
        }
        return parsed;
      }
    } catch { /* corrupt save — fall through */ }
    // Default: first 9 shaders pre-loaded
    return {
      clips: MOBILE_SHADERS.slice(0, 9).map(s => s.id),
      crossfader: 0,
      deckA: MOBILE_SHADERS[0].id,
      deckB: MOBILE_SHADERS[1]?.id ?? null,
      blendMode: 'normal',
    };
  }

  let state: SavedState = loadSavedState();
  function save() {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* private mode */ }
  }

  // ── Renderer / audio ──
  let canvasA: HTMLCanvasElement;
  let canvasB: HTMLCanvasElement;
  let rendererA: StandaloneRenderer | null = null;
  let rendererB: StandaloneRenderer | null = null;
  let audio: StandaloneAudio | null = null;
  let micEnabled = false;
  let micRequesting = false;
  let micError: string | null = null;
  let resizeObs: ResizeObserver | null = null;
  let pumpTimer: ReturnType<typeof setInterval> | null = null;

  // ── Sheets ──
  let showLauncher = true;
  let pickerForSlot: number | null = null;
  let showSettings = false;
  let showProjection = false;
  let blendDropdownOpen = false;

  // First-run tip overlay. Persistent flag so the tip only ever appears
  // once per install — users hate forced onboarding on subsequent boots.
  const ONBOARD_KEY = 'ga-mobile-onboarded-v1';
  let showOnboarding = false;
  try { showOnboarding = !localStorage.getItem(ONBOARD_KEY); } catch { /* private mode */ }
  function dismissOnboarding() {
    showOnboarding = false;
    try { localStorage.setItem(ONBOARD_KEY, '1'); } catch { /* private mode */ }
  }

  // Clean Output mode — hides ALL UI overlays so screen-mirroring via
  // USB-C → HDMI to a projector shows ONLY the rendered visuals.
  // Activated by long-press anywhere; tap again to bring UI back.
  let cleanOutput = false;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  function onCanvasPointerDown() {
    if (cleanOutput) { cleanOutput = false; return; }
    longPressTimer = setTimeout(() => { cleanOutput = true; longPressTimer = null; }, 650);
  }
  function onCanvasPointerUp() {
    if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; }
  }

  const BLEND_MODES = [
    'normal', 'screen', 'multiply', 'overlay',
    'difference', 'lighten', 'darken', 'color-dodge',
  ];

  $: blendMode = state.blendMode;
  $: deckOpacityB = state.crossfader;

  async function fetchAndLoad(renderer: StandaloneRenderer | null, shaderId: string | null) {
    if (!renderer || !shaderId) return;
    const s = findShader(shaderId);
    if (!s) return;
    try {
      const url = encodeURI(`${import.meta.env.BASE_URL}${s.path}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`${url} → ${res.status}`);
      await renderer.loadShaderSource(await res.text(), s.audioNative);
    } catch (e: any) {
      console.error('[Standalone] Shader load failed:', s.id, e?.message || e);
    }
  }

  function launchClip(slot: number) {
    const id = state.clips[slot];
    if (!id) { pickerForSlot = slot; return; }
    // Resolume-style: clip launches into the deck the crossfader is pointing AWAY from.
    if (state.crossfader < 0.5) {
      state.deckB = id;
      fetchAndLoad(rendererB, id);
    } else {
      state.deckA = id;
      fetchAndLoad(rendererA, id);
    }
    state = state;
    save();
  }

  function assignToSlot(slot: number, shader: MobileShader) {
    state.clips[slot] = shader.id;
    state = state;
    save();
    pickerForSlot = null;
  }

  function clearSlot(slot: number) {
    state.clips[slot] = null;
    state = state;
    save();
  }

  // ── Audio pump ──
  function pumpAudio() {
    if (audio?.ready) audio.update();
    const u = audio?.ready ? audio.uniforms : SILENT_AUDIO;
    rendererA?.setAudio(u);
    rendererB?.setAudio(u);
  }

  async function enableMic() {
    if (micEnabled || micRequesting) return;
    micRequesting = true;
    micError = null;
    try {
      audio = new StandaloneAudio();
      await audio.start();
      micEnabled = true;
    } catch (e: any) {
      micError = e?.message || 'Mic permission denied';
      audio = null;
    } finally {
      micRequesting = false;
    }
  }

  // ── Crossfader drag ──
  let crossDragging = false;
  function onCrossPointerDown(e: PointerEvent) {
    crossDragging = true;
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    updateCrossFromEvent(e);
  }
  function onCrossPointerMove(e: PointerEvent) {
    if (!crossDragging) return;
    updateCrossFromEvent(e);
  }
  function onCrossPointerUp(e: PointerEvent) {
    crossDragging = false;
    (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    save();
  }
  function updateCrossFromEvent(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    state.crossfader = Math.max(0, Math.min(1, x));
    state = state;
  }
  function snapCrossfader(v: number) {
    state.crossfader = v;
    state = state;
    save();
  }

  onMount(() => {
    rendererA = new StandaloneRenderer(canvasA);
    rendererB = new StandaloneRenderer(canvasB);
    rendererA.start();
    rendererB.start();
    pumpTimer = setInterval(pumpAudio, 16);

    resizeObs = new ResizeObserver(() => {
      rendererA?.resize();
      rendererB?.resize();
    });
    resizeObs.observe(canvasA);
    resizeObs.observe(canvasB);

    // Boot both decks with their saved shaders.
    if (state.deckA) fetchAndLoad(rendererA, state.deckA);
    if (state.deckB) fetchAndLoad(rendererB, state.deckB);
  });

  onDestroy(() => {
    pumpTimer && clearInterval(pumpTimer);
    resizeObs?.disconnect();
    rendererA?.destroy(); rendererA = null;
    rendererB?.destroy(); rendererB = null;
    audio?.stop(); audio = null;
  });
</script>

<div
  class="vj-root"
  class:clean={cleanOutput}
  onpointerdown={onCanvasPointerDown}
  onpointerup={onCanvasPointerUp}
  onpointercancel={onCanvasPointerUp}
  role="presentation"
>
  <!-- Warp target — when projection mapping is enabled, the projection
       overlay writes a `--ga-warp-matrix` CSS variable that this wrapper
       applies as a matrix3d() transform. Both canvases inherit the warp
       so the composited A/B/blend output gets perspective-mapped. -->
  <div class="warp-target" class:warped={state.projection?.enabled}>
    <!-- A/B canvases stacked. B sits on top with adjustable opacity for the
         crossfader; mix-blend-mode is per-deck-B and applies relative to A. -->
    <canvas bind:this={canvasA} class="canvas deck-a"></canvas>
    <canvas
      bind:this={canvasB}
      class="canvas deck-b"
      style="opacity: {deckOpacityB}; mix-blend-mode: {blendMode};"
    ></canvas>
  </div>

  <!-- Projection-map overlay (corner pin + mask). Self-hides unless toggled on. -->
  {#if state.projection?.enabled}
    <StandaloneProjectionMap
      bind:corners={state.projection.corners}
      onChange={save}
    />
  {/if}

  <!-- Top bar -->
  <header class="top-bar">
    <button class="icon-btn" onclick={onSwitchMode} aria-label="Switch mode">‹</button>
    <div class="title-area">
      <span class="deck-label">A · {findShader(state.deckA ?? '')?.name ?? '—'}</span>
      <span class="cross-pos">{Math.round(state.crossfader * 100)}%</span>
      <span class="deck-label">B · {findShader(state.deckB ?? '')?.name ?? '—'}</span>
    </div>
    <button class="icon-btn" onclick={() => showSettings = true} aria-label="Settings">⋯</button>
  </header>

  <!-- Crossfader -->
  <div class="crossfader-strip">
    <button class="cross-snap" onclick={() => snapCrossfader(0)} aria-label="Snap A">A</button>
    <div
      class="cross-track"
      onpointerdown={onCrossPointerDown}
      onpointermove={onCrossPointerMove}
      onpointerup={onCrossPointerUp}
      onpointercancel={onCrossPointerUp}
      role="slider"
      aria-valuemin="0" aria-valuemax="1" aria-valuenow={state.crossfader}
      tabindex="0"
    >
      <div class="cross-fill" style="left: 0; right: {(1 - state.crossfader) * 100}%;"></div>
      <div class="cross-knob" style="left: {state.crossfader * 100}%;"></div>
    </div>
    <button class="cross-snap" onclick={() => snapCrossfader(1)} aria-label="Snap B">B</button>
  </div>

  <!-- Clip launcher toggle -->
  <button class="launcher-toggle" onclick={() => showLauncher = !showLauncher} aria-label="Toggle clip launcher">
    {showLauncher ? '▾' : '▴'}
  </button>

  <!-- Clip launcher sheet -->
  {#if showLauncher}
    <div class="launcher-sheet">
      <div class="launcher-controls">
        <button
          class="blend-pill"
          class:open={blendDropdownOpen}
          onclick={() => blendDropdownOpen = !blendDropdownOpen}
        >
          Blend: {blendMode}
        </button>
        {#if blendDropdownOpen}
          <div class="blend-menu">
            {#each BLEND_MODES as m}
              <button
                class="blend-option"
                class:active={blendMode === m}
                onclick={() => { state.blendMode = m; state = state; save(); blendDropdownOpen = false; }}
              >{m}</button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="clip-grid">
        {#each state.clips as clipId, slot}
          {@const sh = clipId ? findShader(clipId) : null}
          <button
            class="clip-pad"
            class:filled={!!sh}
            class:active-a={state.deckA === clipId}
            class:active-b={state.deckB === clipId}
            onclick={() => launchClip(slot)}
            oncontextmenu={(e) => { e.preventDefault(); if (clipId) clearSlot(slot); }}
            aria-label={sh ? `Launch ${sh.name}` : 'Empty slot — tap to assign'}
          >
            {#if sh}
              <span class="clip-name">{sh.name}</span>
              <span class="clip-cat">{sh.category}</span>
            {:else}
              <span class="clip-empty">+</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>
  {/if}

  <!-- Mic prompt -->
  {#if !micEnabled}
    <button class="mic-prompt" onclick={enableMic} disabled={micRequesting}>
      {micRequesting ? 'Enabling mic…' : '🎤 Enable mic for audio reactivity'}
    </button>
  {/if}

  {#if micError}
    <div class="banner">{micError}</div>
  {/if}

  <!-- Shader picker sheet (assigning to a slot) -->
  {#if pickerForSlot !== null}
    <StandaloneShaderPicker
      shaders={MOBILE_SHADERS}
      onPick={(s) => assignToSlot(pickerForSlot!, s)}
      onClose={() => pickerForSlot = null}
    />
  {/if}

  <!-- First-run tip overlay -->
  {#if showOnboarding}
    <div class="onboard-bg" onclick={dismissOnboarding} role="presentation">
      <div class="onboard-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <h2>Welcome to Ghost Arcade</h2>
        <ul class="tips">
          <li><strong>Tap a clip pad</strong> to launch a shader. Pads launch into deck A or B based on the crossfader position.</li>
          <li><strong>Drag the crossfader</strong> to blend between decks. Change the blend mode in the launcher.</li>
          <li><strong>Long-press the canvas</strong> to enter Clean Output — hides every UI overlay so a USB-C → HDMI mirror shows pure visuals.</li>
          <li><strong>⋯ Settings</strong> turns on touch projection mapping for warping onto angled surfaces.</li>
        </ul>
        <button class="onboard-cta" onclick={dismissOnboarding}>Got it</button>
      </div>
    </div>
  {/if}

  <!-- Settings sheet -->
  {#if showSettings}
    <div class="modal-bg" onclick={() => showSettings = false} role="presentation">
      <div class="modal-card" onclick={(e) => e.stopPropagation()} role="presentation">
        <h2>Settings</h2>
        <button class="row-btn" onclick={() => {
          state.projection = state.projection?.enabled
            ? { ...state.projection, enabled: false }
            : { enabled: true, corners: state.projection?.corners };
          state = state;
          save();
          showSettings = false;
        }}>
          {state.projection?.enabled ? 'Disable projection mapping' : 'Enable projection mapping'}
        </button>
        <button class="row-btn" onclick={() => {
          state.crossfader = 0;
          state.blendMode = 'normal';
          state.projection = undefined;
          state = state;
          save();
          showSettings = false;
        }}>Reset performance state</button>
        <button class="row-btn" onclick={onSwitchMode}>Switch mode (Standalone / Remote)</button>
        <button class="close-x" onclick={() => showSettings = false} aria-label="Close">✕</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .vj-root {
    position: fixed;
    inset: 0;
    background: #000;
    color: #fff;
    overflow: hidden;
    -webkit-tap-highlight-color: transparent;
    touch-action: manipulation;
  }
  /* Clean Output: hide every UI overlay so a mirrored HDMI/projector
     output shows only the rendered visuals. Long-press to enter, tap to exit. */
  .vj-root.clean > :not(.warp-target) {
    display: none !important;
  }
  .warp-target {
    position: absolute;
    inset: 0;
    transform-origin: 0 0;
    /* matrix3d injected by StandaloneProjectionMap when enabled */
  }
  .warp-target.warped {
    transform: var(--ga-warp-matrix, none);
  }
  .canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    display: block;
  }
  .deck-a { z-index: 0; }
  .deck-b { z-index: 1; pointer-events: none; }

  /* Top bar — only the buttons are pointer-active so taps pass through to deck. */
  .top-bar {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    padding: max(env(safe-area-inset-top, 0px), 12px) 12px 12px;
    z-index: 6;
    pointer-events: none;
  }
  .icon-btn {
    width: 36px;
    height: 36px;
    border-radius: 18px;
    border: none;
    background: rgba(20, 20, 26, 0.7);
    backdrop-filter: blur(8px);
    color: #fff;
    font-size: 20px;
    line-height: 1;
    cursor: pointer;
    pointer-events: auto;
  }
  .icon-btn:active { background: rgba(50, 50, 60, 0.8); }
  .title-area {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    font-size: 11px;
    color: var(--text-primary, #ccc);
    margin: 0 8px;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 13px;
    padding: 6px 10px;
    height: 26px;
    overflow: hidden;
    white-space: nowrap;
    min-width: 0;
  }
  .title-area .deck-label {
    flex: 1;
    text-align: center;
    text-overflow: ellipsis;
    overflow: hidden;
    color: #bbb;
  }
  .title-area .cross-pos {
    font-variant-numeric: tabular-nums;
    color: #BB86FC;
    font-weight: 600;
  }

  /* Crossfader */
  .crossfader-strip {
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 72px);
    left: 12px;
    right: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    z-index: 5;
    pointer-events: none;
  }
  .cross-snap {
    width: 32px;
    height: 32px;
    border-radius: 16px;
    border: none;
    background: rgba(20, 20, 26, 0.85);
    color: #fff;
    font-weight: 600;
    font-size: 13px;
    pointer-events: auto;
  }
  .cross-snap:active { background: #BB86FC; color: #1a1a1f; }
  .cross-track {
    flex: 1;
    height: 32px;
    background: rgba(20, 20, 26, 0.85);
    backdrop-filter: blur(8px);
    border-radius: 16px;
    position: relative;
    cursor: pointer;
    pointer-events: auto;
    touch-action: none;
  }
  .cross-fill {
    position: absolute;
    top: 4px; bottom: 4px;
    background: linear-gradient(90deg, #BB86FC, #69F0AE);
    border-radius: 12px;
  }
  .cross-knob {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 24px; height: 24px;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6);
  }

  /* Launcher toggle */
  .launcher-toggle {
    position: absolute;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
    left: 50%;
    transform: translateX(-50%);
    width: 56px;
    height: 28px;
    border-radius: 14px;
    border: none;
    background: rgba(20, 20, 26, 0.85);
    backdrop-filter: blur(8px);
    color: #BB86FC;
    font-size: 16px;
    z-index: 5;
  }

  /* Launcher sheet */
  .launcher-sheet {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 14px 14px calc(env(safe-area-inset-bottom, 0px) + 52px);
    background: rgba(8, 8, 12, 0.94);
    backdrop-filter: blur(14px);
    border-top: 1px solid #1f1f29;
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    z-index: 4;
    animation: sheet-up 0.18s ease-out;
  }
  @keyframes sheet-up {
    from { transform: translateY(20%); opacity: 0; }
    to   { transform: translateY(0); opacity: 1; }
  }
  .launcher-controls {
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
    position: relative;
  }
  .blend-pill {
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    color: #fff;
    padding: 6px 12px;
    border-radius: 14px;
    font-size: 12px;
    text-transform: capitalize;
  }
  .blend-pill.open { background: #BB86FC; color: #1a1a1f; }
  .blend-menu {
    position: absolute;
    top: 34px;
    left: 0;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 12px;
    padding: 6px;
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    z-index: 10;
    min-width: 220px;
  }
  .blend-option {
    background: transparent;
    border: none;
    color: var(--text-primary, #ccc);
    text-transform: capitalize;
    padding: 8px 10px;
    border-radius: 8px;
    font-size: 12px;
    text-align: left;
  }
  .blend-option:active, .blend-option.active { background: #BB86FC; color: #1a1a1f; }

  .clip-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  .clip-pad {
    aspect-ratio: 1;
    border: 1px solid #2a2a30;
    background: var(--bg-tertiary, #14141a);
    color: #fff;
    border-radius: 12px;
    padding: 8px;
    display: flex;
    flex-direction: column;
    align-items: stretch;
    justify-content: space-between;
    text-align: left;
    cursor: pointer;
    overflow: hidden;
  }
  .clip-pad.filled { background: linear-gradient(135deg, #1c1c24, #14141a); }
  .clip-pad.active-a { border-color: #69F0AE; box-shadow: 0 0 0 2px rgba(105, 240, 174, 0.25); }
  .clip-pad.active-b { border-color: #BB86FC; box-shadow: 0 0 0 2px rgba(187, 134, 252, 0.25); }
  .clip-pad:active { transform: scale(0.97); }
  .clip-name {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.2;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .clip-cat {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--text-muted, #888);
  }
  .clip-empty {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 28px;
    color: #444;
  }

  /* Mic prompt */
  .mic-prompt {
    position: absolute;
    left: 50%;
    bottom: calc(env(safe-area-inset-bottom, 0px) + 50%);
    transform: translate(-50%, 50%);
    background: rgba(187, 134, 252, 0.95);
    color: #1a1a1f;
    border: none;
    padding: 14px 20px;
    border-radius: 22px;
    font-size: 14px;
    font-weight: 600;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
    z-index: 7;
  }
  .mic-prompt:active { transform: translate(-50%, 50%) scale(0.97); }
  .mic-prompt:disabled { opacity: 0.6; }

  .banner {
    position: absolute;
    top: 64px;
    left: 12px;
    right: 12px;
    background: rgba(180, 50, 50, 0.9);
    color: #fff;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 12px;
    z-index: 8;
  }

  /* Modals */
  .modal-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 20;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .modal-card {
    width: 100%;
    max-width: 460px;
    background: var(--bg-tertiary, #14141a);
    border-top-left-radius: 18px;
    border-top-right-radius: 18px;
    padding: 18px 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
    position: relative;
  }
  .modal-card h2 { margin: 0 0 14px 0; font-size: 16px; }
  .row-btn {
    width: 100%;
    background: #1c1c24;
    border: 1px solid #2a2a30;
    color: #fff;
    padding: 14px;
    border-radius: 10px;
    text-align: left;
    margin-bottom: 8px;
    font-size: 14px;
  }
  .row-btn:active { background: #25252e; }
  .close-x {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 30px; height: 30px;
    border-radius: 15px;
    border: none;
    background: #1c1c24;
    color: #fff;
    font-size: 14px;
  }

  /* Onboarding overlay */
  .onboard-bg {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(6px);
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: onboard-fade 0.2s ease-out;
  }
  @keyframes onboard-fade {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .onboard-card {
    width: 100%;
    max-width: 380px;
    background: var(--bg-tertiary, #14141a);
    border: 1px solid #2a2a30;
    border-radius: 16px;
    padding: 22px 22px 18px;
  }
  .onboard-card h2 {
    margin: 0 0 14px 0;
    font-size: 18px;
    text-align: center;
  }
  .tips {
    list-style: none;
    padding: 0;
    margin: 0 0 16px 0;
  }
  .tips li {
    font-size: 13px;
    color: var(--text-primary, #ccc);
    line-height: 1.5;
    margin-bottom: 10px;
    padding-left: 14px;
    position: relative;
  }
  .tips li::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    width: 6px;
    height: 6px;
    border-radius: 3px;
    background: #BB86FC;
  }
  .tips strong { color: #fff; }
  .onboard-cta {
    width: 100%;
    background: #BB86FC;
    color: #1a1a1f;
    border: none;
    padding: 14px;
    border-radius: 12px;
    font-size: 15px;
    font-weight: 600;
    cursor: pointer;
  }
  .onboard-cta:active { transform: scale(0.98); }
</style>
