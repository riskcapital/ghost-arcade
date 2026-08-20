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
  import { t } from '../i18n';

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
    drip:   { baseColor: [1.0, 0.3, 0.82], gravity: 0.85, viscosity: 0.93, glow: 1.8, hueCycleSpeed: 0.04, size: 0.013, lifespanSec: 5,
    },
    water:  { baseColor: [0.3, 0.7, 1.0],  gravity: 0.55, viscosity: 0.94, glow: 1.4, hueCycleSpeed: 0.0,  size: 0.018, lifespanSec: 6, spawnSpread: 0.6,
    },
    smoke:  { baseColor: [0.85, 0.88, 0.95], gravity: 0.4, viscosity: 0.96, glow: 1.0, hueCycleSpeed: 0.0,  size: 0.022, lifespanSec: 5,
    },
    plasma: { baseColor: [0.4, 1.0, 0.7],  gravity: 0.0,  viscosity: 0.96, glow: 2.4, hueCycleSpeed: 0.25, size: 0.012, lifespanSec: 4,
    },
    shader: { baseColor: [0.8, 0.5, 1.0],  gravity: 0.3,  viscosity: 0.94, glow: 2.0, hueCycleSpeed: 0.15, size: 0.014, lifespanSec: 5,
    },
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

  const BRUSH_PRESETS: { id: AdvLightPaintBrush }[] = [
    { id: 'drip' },
    { id: 'water' },
    { id: 'smoke' },
    { id: 'plasma' },
    { id: 'shader' },
  ];

  function advMessage(key: string): string {
    return $t(`lighting.advLightPainting.${key}`);
  }

  function brushLabel(id: AdvLightPaintBrush): string {
    return advMessage(`brushes.${id}.label`);
  }

  function brushDescription(id: AdvLightPaintBrush): string {
    return advMessage(`brushes.${id}.description`);
  }

  $: c = $selectedAdvLightPaintingLayer?.advLightPaintingContent ?? null;
</script>

{#if c}
  <div class="adv-paint-panel">
    <div class="panel-title">
      {$t('lighting.advLightPainting.title')} <span class="badge">{$t('lighting.advLightPainting.webgpu')}</span></div>
    <div class="panel-hint">{$t('lighting.advLightPainting.hint')}</div>

    <!-- Brush preset picker -->
    <div class="section">
      <div class="section-title">{$t('lighting.advLightPainting.sections.brush')}</div>
      <div class="brush-grid">
        {#each BRUSH_PRESETS as b}
          <button
            class="brush-button"
            class:active={c.brush === b.id}
            onclick={() => setBrush(b.id)}
            title={brushDescription(b.id)}
          >
            {brushLabel(b.id)}
          </button>
        {/each}
      </div>
      <div class="brush-desc">
        {BRUSH_PRESETS.find((p) => p.id === c.brush)? brushDescription(c.brush) : ''}
      </div>
    </div>

    <!-- Particle population -->
    <div class="section">
      <div class="section-title">{$t('lighting.advLightPainting.sections.density')}</div>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.particles')}</span>
        <input type="range" min="10000" max="200000" step="5000" value={c.particleCount}
               oninput={(e) => setNum('particleCount', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.particleCount.toLocaleString()}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.spawnRate')}</span>
        <input type="range" min="10" max="500" step="10" value={c.spawnRate}
               oninput={(e) => setNum('spawnRate', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.spawnRate}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.spawnSpread')}</span>
        <input type="range" min="0" max="1" step="0.05" value={c.spawnSpread}
               oninput={(e) => setNum('spawnSpread', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.spawnSpread.toFixed(2)}</span>
      </label>
    </div>

    <!-- Physics -->
    <div class="section">
      <div class="section-title">{$t('lighting.advLightPainting.sections.physics')}</div>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.gravity')}</span>
        <input type="range" min="0" max="2" step="0.05" value={c.gravity}
               oninput={(e) => setNum('gravity', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.gravity.toFixed(2)}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.viscosity')}</span>
        <input type="range" min="0.5" max="0.99" step="0.005" value={c.viscosity}
               oninput={(e) => setNum('viscosity', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.viscosity.toFixed(3)}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.lifespan')}</span>
        <input type="range" min="0.5" max="10" step="0.5" value={c.lifespanSec}
               oninput={(e) => setNum('lifespanSec', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.lifespanSec.toFixed(1)}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.depth')}</span>
        <input type="range" min="-1" max="1" step="0.05" value={c.emissionZ}
               oninput={(e) => setNum('emissionZ', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.emissionZ.toFixed(2)}</span>
      </label>
    </div>

    <!-- Visuals -->
    <div class="section">
      <div class="section-title">{$t('lighting.advLightPainting.sections.visuals')}</div>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.particleSize')}</span>
        <input type="range" min="0.001" max="0.05" step="0.001" value={c.size}
               oninput={(e) => setNum('size', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.size.toFixed(3)}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.glow')}</span>
        <input type="range" min="0" max="4" step="0.1" value={c.glow}
               oninput={(e) => setNum('glow', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.glow.toFixed(1)}</span>
      </label>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.hueCycle')}</span>
        <input type="range" min="0" max="1" step="0.01" value={c.hueCycleSpeed}
               oninput={(e) => setNum('hueCycleSpeed', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.hueCycleSpeed.toFixed(2)}</span>
      </label>
      <label class="row color-row">
        <span>{$t('lighting.advLightPainting.labels.baseColor')}</span>
        <input type="color" value={rgbToHex(c.baseColor)}
               oninput={(e) => setColor((e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{rgbToHex(c.baseColor)}</span>
      </label>
    </div>

    <!-- Audio -->
    <div class="section">
      <div class="section-title">{$t('lighting.advLightPainting.sections.audio')}</div>
      <label class="row">
        <span>{$t('lighting.advLightPainting.labels.bassKick')}</span>
        <input type="range" min="0" max="1" step="0.05" value={c.audioReactivity}
               oninput={(e) => setNum('audioReactivity', +(e.currentTarget as HTMLInputElement).value)} />
        <span class="num">{c.audioReactivity.toFixed(2)}</span>
      </label>
    </div>

    <!-- Actions -->
    <div class="section actions">
      <button class="action-btn danger" onclick={clearAll}>{$t('lighting.advLightPainting.labels.clearAll')}</button>
    </div>
  </div>
{/if}

<style>
  .adv-paint-panel {
    width: 100%;
    height: 100%;
    overflow-y: auto;
    padding: 14px;
    color: var(--text-primary, #ddd);
    background: #181820;
    font-family: var(--ga-font-ui, 'Space Grotesk', system-ui, sans-serif);
    font-size: 13px;
    box-sizing: border-box;
  }
  .panel-title {
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    margin-bottom: 4px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .badge {
    font-size: 10px;
    background: linear-gradient(135deg, #6df, #b9f);
    color: #000;
    padding: 2px 6px;
    border-radius: 999px;
    letter-spacing: 0.4px;
    font-weight: 700;
  }
  .panel-hint {
    color: var(--text-muted, #888);
    font-size: 12px;
    margin-bottom: 16px;
  }
  .section {
    margin-bottom: 16px;
    padding-bottom: 14px;
    border-bottom: 1px solid #2a2a35;
  }
  .section:last-child { border-bottom: none; }
  .section-title {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: var(--text-muted, #888);
    margin-bottom: 8px;
  }
  .brush-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    margin-bottom: 6px;
  }
  .brush-button {
    background: #25252e;
    border: 1px solid #333344;
    color: var(--text-secondary, #aaa);
    padding: 6px 4px;
    font-size: 12px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.15s;
  }
  .brush-button:hover { background: #2d2d3a; color: #fff; border-color: #6df; }
  .brush-button.active {
    background: linear-gradient(135deg, #6df, #b9f);
    color: #000;
    font-weight: 700;
    border-color: transparent;
  }
  .brush-desc {
    font-size: 11px;
    color: #666;
    line-height: 1.4;
  }
  .row {
    display: grid;
    grid-template-columns: 90px 1fr 56px;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .row span:first-child { color: var(--text-secondary, #aaa); font-size: 12px; }
  .row .num {
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    font-size: 11px;
    text-align: right;
    color: #6df;
  }
  .row.color-row { grid-template-columns: 90px 40px 1fr; }
  .row.color-row input[type='color'] {
    width: 40px;
    height: 24px;
    border: 1px solid #333344;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }
  input[type='range'] {
    accent-color: #6df;
    width: 100%;
  }
  .actions { display: flex; gap: 6px; }
  .action-btn {
    flex: 1;
    padding: 8px;
    background: #25252e;
    border: 1px solid #333344;
    color: var(--text-primary, #ddd);
    font-size: 12px;
    border-radius: 3px;
    cursor: pointer;
  }
  .action-btn:hover { background: #2d2d3a; }
  .action-btn.danger {
    border-color: rgba(255, 80, 80, 0.4);
    color: #ff7878;
  }
  .action-btn.danger:hover {
    background: rgba(255, 80, 80, 0.1);
  }
</style>
