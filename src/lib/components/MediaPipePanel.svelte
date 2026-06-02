<!--
  MediaPipe integration settings panel. Three blocks:
    1. Source controls — device picker, mirror, gesture toggle, start/stop
    2. Debug overlay — live camera with hand landmarks drawn on top +
                       current signal values (palm xyz, pinch, gestures)
    3. Bindings — list of signal→param-path bindings (read/delete in
                  Phase 1A; Learn UX added in Phase 1B)
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { mediaPipeStore } from '../stores/mediaPipe';
  import { SIGNAL_DEFS, type SignalFrame } from '../mediapipe/signals';
  import { mediaPipeBus, type MediaPipeBinding } from '../mediapipe/mediaPipeBus';

  let devices: { deviceId: string; label: string }[] = [];
  let pickedDeviceId = '';
  let useGesture = true;
  let mirror = true;
  let numHands = 2;

  $: state = $mediaPipeStore;
  $: frame = state.frame;

  // ── Camera preview + landmark overlay ──────────────────────────────
  let previewWrap: HTMLDivElement | null = null;
  let overlayCanvas: HTMLCanvasElement | null = null;
  let overlayCtx: CanvasRenderingContext2D | null = null;
  // Connections between landmarks per MediaPipe's hand topology.
  const HAND_CONNECTIONS: [number, number][] = [
    [0,1],[1,2],[2,3],[3,4],          // thumb
    [0,5],[5,6],[6,7],[7,8],          // index
    [5,9],[9,10],[10,11],[11,12],     // middle
    [9,13],[13,14],[14,15],[15,16],   // ring
    [13,17],[17,18],[18,19],[19,20],  // pinky
    [0,17],                           // palm base
  ];

  function attachVideoPreview() {
    if (!previewWrap) return;
    const video = mediaPipeStore.source.getVideoElement();
    if (!video) return;
    // Reuse the source's hidden <video> for the preview by moving it
    // into the wrap and giving it visible styles. Avoids stealing the
    // camera with a second getUserMedia call.
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    if (video.parentElement !== previewWrap) previewWrap.appendChild(video);
  }

  function detachVideoPreview() {
    const video = mediaPipeStore.source.getVideoElement();
    if (video) {
      // Park offscreen again so the camera capture path remains
      // unaffected when this panel unmounts.
      video.style.cssText = 'position:absolute;top:-99999px;left:-99999px;pointer-events:none;';
      document.body.appendChild(video);
    }
  }

  let rafId: number | null = null;
  function drawOverlay() {
    if (!overlayCanvas || !overlayCtx) return;
    const video = mediaPipeStore.source.getVideoElement();
    if (!video) return;
    const w = overlayCanvas.width = previewWrap?.clientWidth ?? 320;
    const h = overlayCanvas.height = previewWrap?.clientHeight ?? 240;
    overlayCtx.clearRect(0, 0, w, h);
    if (!frame.hands.length) return;
    overlayCtx.lineWidth = 1.5;
    for (const hand of frame.hands) {
      const color = hand.handedness === 'Left' ? '#FF6B6B' : '#FF8585';
      overlayCtx.strokeStyle = color;
      overlayCtx.fillStyle = color;
      overlayCtx.beginPath();
      for (const [a, b] of HAND_CONNECTIONS) {
        const A = hand.landmarks[a], B = hand.landmarks[b];
        if (!A || !B) continue;
        overlayCtx.moveTo(A.x * w, A.y * h);
        overlayCtx.lineTo(B.x * w, B.y * h);
      }
      overlayCtx.stroke();
      for (const lm of hand.landmarks) {
        overlayCtx.beginPath();
        overlayCtx.arc(lm.x * w, lm.y * h, 2, 0, Math.PI * 2);
        overlayCtx.fill();
      }
    }
  }

  function tickOverlay() {
    drawOverlay();
    rafId = requestAnimationFrame(tickOverlay);
  }

  // ── Lifecycle ───────────────────────────────────────────────────────
  onMount(async () => {
    devices = await mediaPipeStore.listVideoInputs();
    if (!pickedDeviceId && devices.length > 0) pickedDeviceId = devices[0].deviceId;
    rafId = requestAnimationFrame(tickOverlay);
  });
  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    detachVideoPreview();
  });

  $: if (state.running) attachVideoPreview();

  // ── Actions ────────────────────────────────────────────────────────
  async function start() {
    await mediaPipeStore.start({
      deviceId: pickedDeviceId || undefined,
      useGesture, mirror, numHands,
    });
  }
  async function stop() { await mediaPipeStore.stop(); }
  function removeBinding(id: string) { mediaPipeBus.remove(id); }

  // Convenience grouping for the signal list display.
  $: continuousSignals = SIGNAL_DEFS.filter(s => s.kind === 'continuous');
  $: gestureSignals    = SIGNAL_DEFS.filter(s => s.kind === 'categorical');

  function fmt(v: number): string {
    if (typeof v !== 'number' || Number.isNaN(v)) return '—';
    return v.toFixed(2);
  }

  // ── Learn entry point ──────────────────────────────────────────────
  // The full binding UX (signal picker, range/invert/smoothing, multi-
  // bind, list of recent additions) lives in a floating modal mounted
  // at App level — see MediaPipeLearnHUD.svelte. This button just kicks
  // off a session and closes Settings so the underlying UI is reachable.
  function openLearn() {
    try { window.dispatchEvent(new CustomEvent('close-settings')); } catch {}
    // Defer one frame so Settings has unmounted before we drop the
    // overlay/modal on top — avoids the modal briefly rendering inside
    // Settings before it fades.
    setTimeout(() => {
      try { window.dispatchEvent(new CustomEvent('mediapipe-open-learn')); } catch {}
    }, 30);
  }
  function loadDefaults() {
    if (state.bindings.length > 0 && !confirm('Replace existing bindings with the default set?')) return;
    mediaPipeBus.loadDefaults();
  }
</script>

<section class="mp-panel">
  <header class="mp-head">
    <span class="mp-title">MediaPipe</span>
    <span class="mp-sub">camera gesture input · powered by @mediapipe/tasks-vision · Apache-2.0</span>
  </header>

  {#if !state.running}
    <div class="mp-row">
      <label class="mp-lbl">Camera</label>
      <select bind:value={pickedDeviceId}>
        {#each devices as d}<option value={d.deviceId}>{d.label}</option>{/each}
        {#if devices.length === 0}<option value="">No cameras detected</option>{/if}
      </select>
    </div>
    <div class="mp-row mp-row-inline">
      <label><input type="checkbox" bind:checked={mirror} /> Mirror (selfie)</label>
      <label><input type="checkbox" bind:checked={useGesture} /> Canned gestures</label>
      <label>Hands
        <select bind:value={numHands}>
          <option value={1}>1</option>
          <option value={2}>2</option>
        </select>
      </label>
    </div>
    <div class="mp-actions">
      <button class="mp-btn primary" disabled={state.starting} onclick={start}>
        {state.starting ? 'Starting…' : 'Enable MediaPipe'}
      </button>
    </div>
    <div class="mp-hint">
      Hand Landmarker + Gesture Recognizer run in a Web Worker. Models load from Google's MediaPipe CDN on first start (~5 MB).
    </div>
  {:else}
    <div class="mp-active">
      <span class="mp-dot"></span>
      <span class="mp-active-name">Running</span>
      <button class="mp-btn small" onclick={stop}>Stop</button>
    </div>

    <!-- Camera preview + landmark overlay -->
    <div class="mp-preview" bind:this={previewWrap}>
      <canvas class="mp-overlay" bind:this={overlayCanvas}></canvas>
    </div>

    <!-- Live signal values -->
    <div class="mp-signals">
      <div class="mp-signals-head">Live signals</div>
      {#each continuousSignals as s (s.id)}
        {@const val = frame.values[s.id]}
        <div class="mp-signal-row">
          <span class="mp-sig-id">{s.label}</span>
          <div class="mp-meter">
            <div class="mp-meter-bar" style:width="{Math.max(0, Math.min(1, val ?? 0)) * 100}%"></div>
          </div>
          <span class="mp-sig-val">{fmt(val)}</span>
        </div>
      {/each}
      {#each gestureSignals as s (s.id)}
        {@const g = frame.gestures[s.id]}
        <div class="mp-signal-row">
          <span class="mp-sig-id">{s.label}</span>
          <span class="mp-sig-gest" class:active={!!g}>{g || '—'}</span>
        </div>
      {/each}
    </div>
  {/if}

  {#if state.error}<div class="mp-err">{state.error}</div>{/if}

  <!-- Bindings -->
  <div class="mp-bindings">
    <div class="mp-bindings-head">
      <span>Bindings</span>
      <span class="mp-bindings-count">{state.bindings.length}</span>
    </div>

    <div class="mp-bind-actions">
      <button class="mp-btn small primary" onclick={openLearn}>+ Add binding</button>
      <button class="mp-btn small" onclick={loadDefaults} title="Wire 4 hand signals to Macros 1-4">Load defaults</button>
      {#if state.bindings.length > 0}
        <button class="mp-btn small ghost" onclick={() => mediaPipeBus.clear()}>Clear all</button>
      {/if}
    </div>

    {#if state.bindings.length === 0}
      <div class="mp-bindings-empty">
        No bindings yet. <strong>+ Add binding</strong> opens the learn modal — pick a signal then click any orange-outlined param to bind. Bind multiple params to the same signal to control them together.
      </div>
    {:else}
      {#each state.bindings as b (b.id)}
        {@const liveVal = b.mode === 'continuous'
          ? (frame.values[b.signalId] ?? 0)
          : (frame.gestures[b.signalId] === b.gestureName ? 1 : 0)}
        <div class="mp-binding">
          <span class="mp-bind-sig" title={b.signalId}>{b.signalId}{b.gestureName ? ` (${b.gestureName})` : ''}</span>
          <span class="mp-bind-arr">→</span>
          <span class="mp-bind-path" title={b.path}>{b.label ?? b.path}</span>
          <div class="mp-bind-meter"><div class="mp-bind-meter-bar" style:width="{Math.max(0, Math.min(1, liveVal)) * 100}%"></div></div>
          <button class="mp-bind-del" onclick={() => removeBinding(b.id)} title="Remove binding">×</button>
        </div>
      {/each}
    {/if}
  </div>
</section>

<style>
  .mp-panel {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px;
    background: #0a0a0d;
    border: 1px solid rgba(255, 107, 107, 0.10);
    border-radius: 6px;
  }
  .mp-head { display: flex; flex-direction: column; }
  .mp-title { font-size: 11px; color: var(--accent-secondary, #FF8585); letter-spacing: 0.6px; text-transform: uppercase; font-weight: 700; }
  .mp-sub   { font-size: 9px; color: #555; }

  .mp-row { display: flex; align-items: center; gap: 8px; }
  .mp-row-inline { gap: 12px; flex-wrap: wrap; font-size: 10px; color: #aaa; }
  .mp-row-inline label { display: flex; gap: 4px; align-items: center; cursor: pointer; }
  .mp-lbl { font-size: 9px; color: #777; width: 60px; }

  select {
    background: #050507;
    border: 1px solid #2a1a35;
    color: #ddd;
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 10px;
    outline: none;
  }
  select:focus { border-color: var(--accent-primary, #FF6B6B); }

  .mp-actions { display: flex; gap: 4px; }
  .mp-btn {
    padding: 5px 10px;
    background: #15101e;
    border: 1px solid rgba(255, 107, 107, 0.20);
    border-radius: 3px;
    color: var(--accent-secondary, #FF8585);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }
  .mp-btn:hover:not(:disabled) { background: #20162e; border-color: rgba(255, 107, 107, 0.55); color: var(--accent-primary, #FF6B6B); }
  .mp-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .mp-btn.primary { background: rgba(255, 107, 107, 0.10); }
  .mp-btn.small { padding: 3px 8px; font-size: 10px; }

  .mp-hint { font-size: 9px; color: #666; line-height: 1.45; }
  .mp-err { font-size: 10px; color: #f87171; padding: 6px 8px; background: rgba(248, 113, 113, 0.08); border-radius: 3px; }

  .mp-active {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 107, 107, 0.06);
    border: 1px solid rgba(255, 107, 107, 0.20);
    border-radius: 3px;
    padding: 4px 8px;
  }
  .mp-dot {
    width: 6px; height: 6px;
    background: var(--accent-primary, #FF6B6B);
    border-radius: 50%;
    box-shadow: 0 0 6px rgba(255, 107, 107, 0.6);
    animation: mpDot 2s infinite;
  }
  @keyframes mpDot { 0%,100%{opacity:1} 50%{opacity:.35} }
  .mp-active-name { flex: 1; font-size: 10px; color: var(--accent-secondary, #FF8585); }

  .mp-preview {
    position: relative;
    width: 100%;
    aspect-ratio: 4 / 3;
    background: #000;
    border: 1px solid #1a1428;
    border-radius: 4px;
    overflow: hidden;
  }
  .mp-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
  }

  .mp-signals {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #060410;
    border: 1px solid #1a1428;
    border-radius: 3px;
    padding: 6px;
  }
  .mp-signals-head {
    font-size: 8px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    padding-bottom: 2px;
  }
  .mp-signal-row {
    display: grid;
    grid-template-columns: 100px 1fr 36px;
    align-items: center;
    gap: 6px;
    font-size: 10px;
  }
  .mp-sig-id   { color: #888; font-family: 'JetBrains Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mp-sig-val  { color: #aaa; text-align: right; font-family: 'JetBrains Mono', monospace; }
  .mp-sig-gest { color: #555; font-family: 'JetBrains Mono', monospace; grid-column: 2 / -1; }
  .mp-sig-gest.active { color: var(--accent-primary, #FF6B6B); font-weight: 700; }

  .mp-meter {
    height: 6px;
    background: #15102a;
    border-radius: 2px;
    overflow: hidden;
  }
  .mp-meter-bar {
    height: 100%;
    background: linear-gradient(to right, #5a2a4a, var(--accent-primary, #FF6B6B));
    transition: width 0.05s linear;
  }

  .mp-bindings {
    display: flex;
    flex-direction: column;
    gap: 4px;
    background: #060410;
    border: 1px solid #1a1428;
    border-radius: 3px;
    padding: 6px 8px;
  }
  .mp-bindings-head {
    display: flex;
    justify-content: space-between;
    font-size: 8px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.6px;
  }
  .mp-bindings-count { color: #888; }
  .mp-bindings-empty {
    font-size: 10px;
    color: #555;
    line-height: 1.45;
    padding: 4px 0;
  }
  .mp-binding {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) 14px minmax(0, 1.4fr) 60px 18px;
    gap: 6px;
    align-items: center;
    font-size: 10px;
    padding: 3px 0;
    border-bottom: 1px solid #110a1c;
  }
  .mp-bind-sig  { color: #aaa; font-family: 'JetBrains Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mp-bind-arr  { color: #444; text-align: center; }
  .mp-bind-path { color: #ddd; font-family: 'JetBrains Mono', monospace; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mp-bind-meter {
    height: 4px;
    background: #15102a;
    border-radius: 2px;
    overflow: hidden;
  }
  .mp-bind-meter-bar {
    height: 100%;
    background: linear-gradient(to right, #5a2a4a, var(--accent-primary, #FF6B6B));
    transition: width 0.05s linear;
  }
  .mp-bind-del  {
    background: transparent;
    border: none;
    color: #555;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0;
  }
  .mp-bind-del:hover { color: #f87171; }

  .mp-bind-actions { display: flex; gap: 4px; flex-wrap: wrap; padding: 2px 0; }
  .mp-btn.ghost { background: transparent; color: #888; border-color: #2a1a35; }
  .mp-btn.ghost:hover:not(:disabled) { color: #aaa; }
</style>
