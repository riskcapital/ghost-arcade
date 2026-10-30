<script lang="ts">
  /**
   * AdvLightPaintingPanel — UI for the Adv Light Painting (WebGPU)
   * layer type. Mounted by App.svelte's right sidebar when an
   * adv-lightpaint layer is selected. The actual rendering happens
   * in WebGPUCanvas via webgpuAdvLightPaint.ts; this panel just
   * mutates the layer's content object and the renderer picks it up
   * via the project subscription.
   *
   * Phase 3.2 v1: brush preset picker + the key physics knobs +
   * colour + reset. Future versions may add: shader-source picker
   * for the 'shader' brush, multi-stroke recording, save/load,
   * audio mapping per band, animation timeline.
   */
  import { selectedAdvLightPaintingLayer } from '$lib/stores/layers';
  import { project } from '$lib/stores/layers';
  import type { AdvLightPaintBrush } from '$lib/types';

  // Mutate the layer's content via the layers store. Each setter
  // triggers a project update so WebGPUCanvas's subscription
  // re-pulls the content into the renderer.
  function patch(updates: Record<string, any>): void {
    const layer = $selectedAdvLightPaintingLayer;
    if (!layer || !layer.advLightPaintingContent) return;
    project.updateLayer(layer.id, {
      advLightPaintingContent: { ...layer.advLightPaintingContent, ...updates },
    } as any);
  }

  // Per-brush sensible defaults — applied alongside the brush
  // change so each brush has a distinct visual character out of
  // the box. User can still override any value individually after
  // picking the brush.
  const BRUSH_DEFAULTS: Record<AdvLightPaintBrush, Partial<{
    baseColor: [number, number, number];
    gravity: number;
    viscosity: number;
    glow: number;
    hueCycleSpeed: number;
    spawnSpread: number;
    size: number;
    lifespanSec: number;
  }>> = {
    drip:   { baseColor: [1.0, 0.3, 0.82], gravity: 0.85, viscosity: 0.93, glow: 1.8, hueCycleSpeed: 0.04, size: 0.013, lifespanSec: 5 },
    water:  { baseColor: [0.3, 0.7, 1.0],  gravity: 0.55, viscosity: 0.94, glow: 1.4, hueCycleSpeed: 0.0,  size: 0.018, lifespanSec: 6, spawnSpread: 0.6 },
    smoke:  { baseColor: [0.85, 0.88, 0.95], gravity: 0.4, viscosity: 0.96, glow: 1.0, hueCycleSpeed: 0.0,  size: 0.022, lifespanSec: 5 },
    plasma: { baseColor: [0.4, 1.0, 0.7],  gravity: 0.0,  viscosity: 0.96, glow: 2.4, hueCycleSpeed: 0.25, size: 0.012, lifespanSec: 4 },
    shader: { baseColor: [0.8, 0.5, 1.0],  gravity: 0.3,  viscosity: 0.94, glow: 2.0, hueCycleSpeed: 0.15, size: 0.014, lifespanSec: 5 },
  };

  function setBrush(b: AdvLightPaintBrush): void {
    patch({ brush: b, ...BRUSH_DEFAULTS[b] });
  }
  function setNum(key: string, v: number): void { patch({ [key]: v }); }
  function setColor(hex: string): void {
    const rgb = hexToRgb(hex);
    if (rgb) patch({ baseColor: rgb });
  }
  function hexToRgb(hex: string): [number, number, number] | null {
    const m = hex.match(/^#([0-9a-f]{6})$/i);
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }
  function rgbToHex(rgb: [number, number, number]): string {
    const r = Math.round(rgb[0] * 255).toString(16).padStart(2, '0');
    const g = Math.round(rgb[1] * 255).toString(16).padStart(2, '0');
    const b = Math.round(rgb[2] * 255).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }

  // Reset just clears the renderer's particle buffer — content
  // (settings) stays. We expose this via window so WebGPUCanvas can
  // hook it; for now we just bump a "clearVersion" counter on the
  // content which the renderer can react to. v1 simplification: the
  // reset is implicit via the renderer's particle buffer being
  // recreated whenever particleCount changes. To force a clear,
  // bump the count by 1 then back.
  function clearAll(): void {
    const layer = $selectedAdvLightPaintingLayer;
    if (!layer || !layer.advLightPaintingContent) return;
    const c = layer.advLightPaintingContent;
    project.updateLayer(layer.id, {
      advLightPaintingContent: { ...c, particleCount: c.particleCount + 1 },
    } as any);
    setTimeout(() => {
      project.updateLayer(layer.id, {
        advLightPaintingContent: { ...c, particleCount: c.particleCount },
      } as any);
    }, 50);
  }

  const BRUSH_PRESETS: { id: AdvLightPaintBrush; label: string; desc: string }[] = [
    { id: 'drip',   label: 'Drip',   desc: 'Gravity + viscosity. Falling streams.' },
    { id: 'water',  label: 'Water',  desc: 'Gravity + cohesion. Pools at rest.' },
    { id: 'smoke',  label: 'Smoke',  desc: 'Buoyant + curl noise. Wispy plumes.' },
    { id: 'plasma', label: 'Plasma', desc: 'Curl noise chaos. Bright swirls.' },
    { id: 'shader', label: 'Shader', desc: 'Hue-driven swirl. (Shader source v2.)' },
  ];

  $: c = $selectedAdvLightPaintingLayer?.advLightPaintingContent ?? null;
</script>

{#if c}
  <div data-help-page="layers" class="adv-paint-panel">
    <div class="adv-title">Advanced light paint <span class="badge">WebGPU</span></div>
    <div class="panel-hint">Click and drag over the editor canvas to paint.</div>

    <!-- Brush preset picker -->
    <div class="section">
      <div class="section-title">Brush</div>
      <div class="brush-grid">
        {#each BRUSH_PRESETS as b}
          <button
            class="brush-button"
            class:active={c.brush === b.id}
            onclick={() => setBrush(b.id)}
            title={b.desc}
          >
            {b.label}
          </button>
        {/each}
      </div>
      <div class="brush-desc">
        {BRUSH_PRESETS.find((p) => p.id === c.brush)?.desc ?? ''}
      </div>
    </div>

    <!-- Particle population -->
    <div class="section">
      <div class="section-title">Density</div>
      <label class="row">
        <span>Particles</span>
        <input type="range" min="10000" max="200000" step="5000" value={c.particleCount}
               oninput={(e) => setNum('particleCount', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.particleCount.toLocaleString()}</span>
      </label>
      <label class="row">
        <span>Spawn rate</span>
        <input type="range" min="10" max="500" step="10" value={c.spawnRate}
               oninput={(e) => setNum('spawnRate', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.spawnRate}</span>
      </label>
      <label class="row">
        <span>Spawn spread</span>
        <input type="range" min="0" max="1" step="0.05" value={c.spawnSpread}
               oninput={(e) => setNum('spawnSpread', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.spawnSpread.toFixed(2)}</span>
      </label>
    </div>

    <!-- Physics -->
    <div class="section">
      <div class="section-title">Physics</div>
      <label class="row">
        <span>Gravity</span>
        <input type="range" min="0" max="2" step="0.05" value={c.gravity}
               oninput={(e) => setNum('gravity', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.gravity.toFixed(2)}</span>
      </label>
      <label class="row">
        <span>Viscosity</span>
        <input type="range" min="0.5" max="0.99" step="0.005" value={c.viscosity}
               oninput={(e) => setNum('viscosity', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.viscosity.toFixed(3)}</span>
      </label>
      <label class="row">
        <span>Lifespan (s)</span>
        <input type="range" min="0.5" max="10" step="0.5" value={c.lifespanSec}
               oninput={(e) => setNum('lifespanSec', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.lifespanSec.toFixed(1)}</span>
      </label>
      <label class="row">
        <span>Depth (Z)</span>
        <input type="range" min="-1" max="1" step="0.05" value={c.emissionZ}
               oninput={(e) => setNum('emissionZ', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.emissionZ.toFixed(2)}</span>
      </label>
    </div>

    <!-- Visuals -->
    <div class="section">
      <div class="section-title">Visuals</div>
      <label class="row">
        <span>Particle size</span>
        <input type="range" min="0.001" max="0.05" step="0.001" value={c.size}
               oninput={(e) => setNum('size', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.size.toFixed(3)}</span>
      </label>
      <label class="row">
        <span>Glow</span>
        <input type="range" min="0" max="4" step="0.1" value={c.glow}
               oninput={(e) => setNum('glow', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.glow.toFixed(1)}</span>
      </label>
      <label class="row">
        <span>Hue cycle</span>
        <input type="range" min="0" max="1" step="0.01" value={c.hueCycleSpeed}
               oninput={(e) => setNum('hueCycleSpeed', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.hueCycleSpeed.toFixed(2)}</span>
      </label>
      <label class="row color-row">
        <span>Base color</span>
        <input type="color" value={rgbToHex(c.baseColor)}
               oninput={(e) => setColor((e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{rgbToHex(c.baseColor)}</span>
      </label>
    </div>

    <!-- Audio -->
    <div class="section">
      <div class="section-title">Audio</div>
      <label class="row">
        <span>Bass kick</span>
        <input type="range" min="0" max="1" step="0.05" value={c.audioReactivity}
               oninput={(e) => setNum('audioReactivity', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.audioReactivity.toFixed(2)}</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="section actions">
      <button class="action-btn danger" onclick={clearAll}>Clear all particles</button>
    </div>
  </div>
{/if}

<style>
  .adv-paint-panel {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 12px;
    color: var(--ga-ink-0);
    background: var(--ga-panel);
    font-family: var(--ga-font-ui, 'Geist', system-ui, sans-serif);
    font-size: var(--ga-text-body);
    box-sizing: border-box;
  }
  .adv-title {
    font-size: var(--ga-text-title);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0);
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-1);
    padding: 1px 6px;
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
  }
  .panel-hint {
    color: var(--ga-ink-2);
    font-size: var(--ga-text-meta);
    margin-bottom: 12px;
  }
  .section {
    padding: 12px 0;
    border-top: 1px solid var(--ga-line-1);
  }
  /* Eyebrow section label, same as every layer editor. */
  .section-title {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
    color: var(--ga-ink-2);
    margin-bottom: 8px;
  }
  .brush-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin-bottom: 6px;
  }
  .brush-button {
    height: var(--ga-control-h);
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    padding: 0 4px;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    border-radius: var(--ga-r-hard);
    cursor: pointer;
    transition: all 0.15s;
  }
  .brush-button:hover:not(.active) { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .brush-button.active {
    background: var(--ga-selection-bg);
    color: var(--ga-selection-ink);
    border-color: var(--ga-selection-line);
  }
  .brush-desc {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    line-height: 1.4;
  }
  .row {
    display: grid;
    grid-template-columns: 90px 1fr 56px;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h);
    margin-bottom: 2px;
  }
  .row span:first-child { color: var(--ga-ink-1); font-size: var(--ga-text-control); }
  .row .num {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta);
    font-variant-numeric: tabular-nums;
    text-align: right;
    color: var(--ga-ink-1);
  }
  .row.color-row { grid-template-columns: 90px 40px 1fr; }
  .row.color-row input[type="color"] {
    width: 40px;
    height: var(--ga-control-h-sm);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    background: transparent;
    cursor: pointer;
    padding: 0;
  }
  input[type="range"] {
    accent-color: var(--ga-slider-fill, var(--ga-blue));
    width: 100%;
  }
  .actions { display: flex; gap: 6px; }
  .action-btn {
    flex: 1;
    height: var(--ga-control-h);
    padding: 0 10px;
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    border-radius: var(--ga-r-hard);
    cursor: pointer;
  }
  .action-btn:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .action-btn.danger {
    border-color: color-mix(in srgb, var(--ga-rec) 40%, transparent);
    color: var(--ga-rec);
  }
  .action-btn.danger:hover {
    background: color-mix(in srgb, var(--ga-rec) 10%, transparent);
  }
</style>
