<!--
  Milkdrop stem routing panel section. Three rows:
    1. Multi-stem source toggle / device picker / layout picker
    2. Per-stem level meters (live bar per stem driven by its analyser)
    3. Routing matrix — rows = stems, cols = bass/mid/treb, cells = 0..2 sliders

  Writes the matrix to the layer's effectSource.milkdropRoutingMatrix
  so it persists per-layer and travels with saved compositions.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { project } from '../stores/layers';
  import { multiStemStore, type AudioInputDevice } from '../stores/multiStem';
  import type { RoutingBand } from '../audio/stemRouter';

  export let layerId: string;
  /** Live mirror of `effectSource.milkdropRoutingMatrix`. */
  export let matrix: Record<string, Partial<Record<RoutingBand, number>>> = {};
  export let onUpdateMatrix: ((matrix: Record<string, Partial<Record<RoutingBand, number>>>) => void) | null = null;

  let devices: AudioInputDevice[] = [];
  let pickedDeviceId: string = '';
  let pickedLayoutId: string = 'demucs-4';
  let starting = false;

  // Per-stem level meters. Each meter bar registers itself via the
  // `attachMeter` action so the RAF loop can directly mutate its width
  // without going through Svelte reactivity per frame.
  // Typed ArrayBuffer (not ArrayBufferLike) so it satisfies the strict
  // AnalyserNode.getByteFrequencyData signature.
  const meterFftBuf = new Map<string, Uint8Array<ArrayBuffer>>();
  const meterEls = new Map<string, HTMLDivElement>();
  let rafId: number | null = null;

  function attachMeter(node: HTMLDivElement, stemId: string) {
    meterEls.set(stemId, node);
    return {
      destroy() { meterEls.delete(stemId); },
    };
  }

  $: state = $multiStemStore;
  $: layouts = multiStemStore.layouts;
  $: activeLayout = state.running ? multiStemStore.getLayout() : null;
  $: activeStems = activeLayout?.stems ?? [];

  async function refreshDevices() {
    devices = await multiStemStore.listInputDevices();
    if (!pickedDeviceId && devices.length > 0) {
      pickedDeviceId = devices[0].deviceId;
    }
  }

  async function startStems() {
    if (!pickedDeviceId) return;
    starting = true;
    try {
      await multiStemStore.start(pickedDeviceId, pickedLayoutId);
      // Seed an empty row for any stem not already in the matrix so the
      // sliders render at 0 instead of disappearing.
      const layout = multiStemStore.getLayout();
      if (layout) {
        const next: typeof matrix = { ...matrix };
        for (const s of layout.stems) {
          if (!next[s.id]) next[s.id] = { bass: 0, mid: 0, treb: 0 };
        }
        // Default for first-time setup: drums→bass, vocals→mid, other→treb
        if (layout.id === 'demucs-4') {
          if (!matrix.drums)  next.drums  = { bass: 1.0, mid: 0,    treb: 0.5 };
          if (!matrix.bass)   next.bass   = { bass: 1.0, mid: 0,    treb: 0   };
          if (!matrix.vocals) next.vocals = { bass: 0,   mid: 1.0,  treb: 0.3 };
          if (!matrix.other)  next.other  = { bass: 0,   mid: 0.5,  treb: 1.0 };
        }
        persistMatrix(next);
      }
    } catch (e) {
      console.warn('[StemSection] start failed', e);
    } finally {
      starting = false;
    }
  }

  async function stopStems() {
    await multiStemStore.stop();
  }

  function setCell(stemId: string, band: RoutingBand, value: number) {
    const row = { ...(matrix[stemId] ?? {}) };
    row[band] = value;
    persistMatrix({ ...matrix, [stemId]: row });
  }

  function getCell(stemId: string, band: RoutingBand): number {
    return matrix[stemId]?.[band] ?? 0;
  }

  function persistMatrix(next: typeof matrix) {
    matrix = next;
    if (onUpdateMatrix) {
      onUpdateMatrix(next);
      return;
    }
    const proj = get(project);
    const layer = proj.layers.find(l => l.id === layerId);
    if (!layer?.source?.effectSource) return;
    project.setLayerSource(layerId, {
      ...layer.source,
      effectSource: { ...layer.source.effectSource, milkdropRoutingMatrix: next },
    });
  }

  // Level meter loop — runs only while multi-stem is active
  function pumpMeters() {
    if (!state.running) return;
    for (const stem of multiStemStore.analyzer.getStems()) {
      let buf = meterFftBuf.get(stem.id);
      if (!buf || buf.length !== stem.analyser.frequencyBinCount) {
        // Construct on a fresh ArrayBuffer so the type matches what
        // getByteFrequencyData accepts under TS strict settings.
        buf = new Uint8Array(new ArrayBuffer(stem.analyser.frequencyBinCount));
        meterFftBuf.set(stem.id, buf);
      }
      stem.analyser.getByteFrequencyData(buf);
      // Average over the lower half (most musical content)
      let sum = 0;
      const half = (buf.length >> 1) || 1;
      for (let i = 0; i < half; i++) sum += buf[i];
      const level = sum / (half * 255);
      const el = meterEls.get(stem.id);
      if (el) el.style.width = (level * 100).toFixed(1) + '%';
    }
    rafId = requestAnimationFrame(pumpMeters);
  }

  $: if (state.running && rafId === null) {
    rafId = requestAnimationFrame(pumpMeters);
  } else if (!state.running && rafId !== null) {
    cancelAnimationFrame(rafId); rafId = null;
  }

  onMount(async () => {
    await refreshDevices();
    // Browsers hide labels until permission is granted. Listen for device
    // changes so labels appear after a getUserMedia call elsewhere.
    if (navigator.mediaDevices?.addEventListener) {
      navigator.mediaDevices.addEventListener('devicechange', refreshDevices);
    }
  });
  onDestroy(() => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    try { navigator.mediaDevices?.removeEventListener?.('devicechange', refreshDevices); } catch {}
  });
</script>

<div class="ss-panel">
  <div class="ss-header">
    <span class="ss-title">Stem Routing</span>
    <span class="ss-sub">multi-channel input → bass / mid / treb</span>
  </div>

  {#if !state.running}
    <div class="ss-row">
      <label class="ss-label">Device</label>
      <select bind:value={pickedDeviceId}>
        {#each devices as d}
          <option value={d.deviceId}>{d.label}{d.isVirtual ? '  ◆' : ''}</option>
        {/each}
        {#if devices.length === 0}<option value="">No inputs detected</option>{/if}
      </select>
    </div>
    <div class="ss-row">
      <label class="ss-label">Layout</label>
      <select bind:value={pickedLayoutId}>
        {#each layouts as l}<option value={l.id}>{l.name}</option>{/each}
      </select>
    </div>
    <div class="ss-actions">
      <button class="ss-btn primary" onclick={startStems} disabled={starting || !pickedDeviceId}>
        {starting ? 'Starting…' : 'Start stems'}
      </button>
      <button class="ss-btn small" onclick={refreshDevices} title="Re-scan inputs">↻</button>
    </div>
    {#if state.error}<div class="ss-err">{state.error}</div>{/if}
    <div class="ss-hint">
      Route DAW tracks to a multi-channel virtual device (BlackHole, Loopback) and pick it here.
      <strong>Demucs / 4-stem stereo</strong> assumes channels 1–2 = drums, 3–4 = bass, 5–6 = vocals, 7–8 = other.
    </div>
  {:else}
    <div class="ss-active">
      <span class="ss-dot"></span>
      <span class="ss-active-name">{activeLayout?.name ?? 'Active'}</span>
      <button class="ss-btn small" onclick={stopStems}>Stop</button>
    </div>

    <!-- Matrix grid: header row + one row per stem -->
    <div class="ss-matrix">
      <div class="ss-matrix-head">
        <span></span>
        <span>Bass</span>
        <span>Mid</span>
        <span>Treb</span>
        <span>Lvl</span>
      </div>
      {#each activeStems as stem (stem.id)}
        <div class="ss-matrix-row">
          <span class="ss-stem-label" title={`channels ${stem.channels.map(c => c + 1).join('+')}`}>{stem.label}</span>
          {#each (['bass', 'mid', 'treb'] as RoutingBand[]) as band}
            <input
              type="range" min="0" max="2" step="0.05"
              value={getCell(stem.id, band)}
              oninput={(e) => setCell(stem.id, band, parseFloat((e.target as HTMLInputElement).value))}
              title={`${stem.label} → ${band}: ${getCell(stem.id, band).toFixed(2)}`}
            />
          {/each}
          <div class="ss-meter">
            <div class="ss-meter-bar" use:attachMeter={stem.id}></div>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .ss-panel {
    display: flex;
    flex-direction: column;
    background: linear-gradient(180deg, #0e0a1a, #0a0612);
    border-bottom: 1px solid #2a2a3a;
    padding: 8px 8px 10px;
    gap: 6px;
  }
  .ss-header { display: flex; align-items: baseline; gap: 6px; }
  .ss-title { font-size: 11px; color: var(--accent-secondary, #FF8585); letter-spacing: 0.6px; text-transform: uppercase; font-weight: 700; }
  .ss-sub   { font-size: 10px; color: #555; }

  .ss-row { display: flex; align-items: center; gap: 6px; }
  .ss-label { font-size: 10px; color: #666; width: 50px; }
  select {
    flex: 1;
    background: #0a0612;
    border: 1px solid #2a2235;
    color: var(--text-primary, #ddd);
    padding: 3px 6px;
    border-radius: 3px;
    font-size: 11px;
    outline: none;
  }
  select:focus { border-color: var(--accent-primary, #FF6B6B); }

  .ss-actions { display: flex; gap: 4px; margin-top: 2px; }
  .ss-btn {
    flex: 1;
    padding: 4px 8px;
    background: #15101e;
    border: 1px solid rgba(255, 107, 107, 0.20);
    border-radius: 3px;
    color: var(--accent-secondary, #FF8585);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s;
  }
  .ss-btn:hover:not(:disabled) { background: #20162e; border-color: rgba(255, 107, 107, 0.55); color: var(--accent-primary, #FF6B6B); }
  .ss-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ss-btn.small { flex: 0 0 28px; }
  .ss-btn.primary { background: rgba(255, 107, 107, 0.10); }

  .ss-err {
    font-size: 10px;
    color: #f87171;
    padding: 4px 6px;
    background: rgba(248, 113, 113, 0.08);
    border-radius: 3px;
  }
  .ss-hint {
    font-size: 10px;
    color: #666;
    line-height: 1.45;
    padding-top: 2px;
  }
  .ss-hint strong { color: var(--text-muted, #888); font-weight: 600; }

  .ss-active {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(255, 107, 107, 0.06);
    border: 1px solid rgba(255, 107, 107, 0.20);
    border-radius: 3px;
    padding: 4px 8px;
  }
  .ss-dot {
    width: 6px; height: 6px;
    background: var(--accent-primary, #FF6B6B);
    border-radius: 50%;
    box-shadow: 0 0 6px rgba(255, 107, 107, 0.6);
    animation: ssDot 2s infinite;
  }
  @keyframes ssDot { 0%,100%{opacity:1} 50%{opacity:.35} }
  .ss-active-name { flex: 1; font-size: 11px; color: var(--accent-secondary, #FF8585); }

  .ss-matrix {
    display: flex;
    flex-direction: column;
    gap: 2px;
    background: #060410;
    border: 1px solid #1a1428;
    border-radius: 3px;
    padding: 4px;
  }
  .ss-matrix-head,
  .ss-matrix-row {
    display: grid;
    grid-template-columns: 60px 1fr 1fr 1fr 36px;
    gap: 4px;
    align-items: center;
  }
  .ss-matrix-head { padding: 2px 0; }
  .ss-matrix-head span {
    font-size: 9px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: center;
  }
  .ss-stem-label {
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .ss-matrix-row input[type="range"] {
    width: 100%;
    height: 3px;
    -webkit-appearance: none;
    background: #2a1a2a;
    border-radius: 2px;
    cursor: pointer;
  }
  .ss-matrix-row input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 10px; height: 10px;
    background: var(--accent-primary, #FF6B6B);
    border-radius: 50%;
    cursor: pointer;
  }
  .ss-meter {
    width: 100%;
    height: 8px;
    background: #0a0612;
    border-radius: 2px;
    overflow: hidden;
  }
  .ss-meter-bar {
    height: 100%;
    width: 0%;
    background: linear-gradient(to right, #5a2a4a, var(--accent-primary, #FF6B6B));
    transition: width 0.05s linear;
  }
</style>
