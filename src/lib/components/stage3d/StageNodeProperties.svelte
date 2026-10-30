<script lang="ts">
  /**
   * Per-screen 3D properties inspector. Each screen layer's 3D
   * presentation (position / rotation / brightness / display fit /
   * edge effect) is stored as an override keyed by layer id in the
   * stage3dScene store. The layer itself (name, ordering, slice
   * polygon) is owned by the 2D Stage Designer and is not editable
   * from here.
   */
  import { stage3dScene } from '../../stage3d/store';
  import { project } from '../../stores/layers';
  import type { Stage3DScreenOverride } from '../../stage3d/types';

  export let layerId: string;

  $: layer = $project.layers.find(l => l.id === layerId);
  $: override = ($stage3dScene.screenOverrides ?? {})[layerId] ?? {};
  // Dome content mapping only applies on the sphere venue, where this
  // screen is a spherical sector on the dome interior.
  $: isDomeVenue = ($stage3dScene.venue ?? 'festival') === 'sphere';
  const domeModes: { value: NonNullable<Stage3DScreenOverride['domeMapping']>; label: string }[] = [
    { value: 'wrap', label: 'Stretch' },
    { value: 'domemaster', label: 'Domemaster' },
    { value: 'equirect', label: 'Equirect' },
  ];
  // Shown names for the stored option values.
  const OPTION_LABELS: Record<string, string> = {
    led: 'LED', projection: 'Projection', clean: 'Clean',
    stretch: 'Stretch', contain: 'Contain', cover: 'Cover',
    none: 'None', 'bezel-glow': 'Bezel glow', 'soft-border': 'Soft border',
    scanlines: 'Scanlines', 'pixel-grid': 'Pixel grid',
  };
  const domeDefaults = {
    domePanX: 0,
    domePanY: 0,
    domeZoom: 1,
    domeRoll: 0,
    domeEdgeBlend: 0.35,
    domeVerticalBlend: 0,
  } as const;

  function patch(field: keyof Stage3DScreenOverride, value: any) {
    if (isDomeVenue && (field === 'position' || field === 'rotation' || field === 'scale' || field === 'curvature' || field === 'frameDepth')) return;
    stage3dScene.setScreenOverride(layerId, { [field]: value });
  }

  function reset() {
    if (confirm('Reset 3D tweaks for this screen?')) {
      stage3dScene.setScreenOverride(layerId, null);
    }
  }
  function resetDomeTuning() {
    stage3dScene.setScreenOverride(layerId, { ...domeDefaults });
  }
  function domeNumber(field: keyof typeof domeDefaults): number {
    const value = override[field];
    return typeof value === 'number' && Number.isFinite(value) ? value : domeDefaults[field];
  }

  $: pitchDeg = ((override.rotation ?? [0, 0, 0])[0] * 180 / Math.PI);
  $: yawDeg = ((override.rotation ?? [0, 0, 0])[1] * 180 / Math.PI);
  $: rollDeg = ((override.rotation ?? [0, 0, 0])[2] * 180 / Math.PI);
  $: scaleValue = override.scale ?? [1, 1, 1];

  function setRotationAxis(axis: 0 | 1 | 2, degrees: number) {
    const current = override.rotation ?? [0, 0, 0];
    const radians = degrees * Math.PI / 180;
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axis] = radians;
    patch('rotation', next);
  }

  function setPositionAxis(axis: 0 | 1 | 2, value: number) {
    const current = override.position ?? (isDomeVenue ? [0, 9, 7] : [0, 0, 0]);
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axis] = value;
    patch('position', next);
  }

  function setScaleAxis(axis: 0 | 1 | 2, value: number) {
    const current = override.scale ?? [1, 1, 1];
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axis] = Math.max(0.05, value);
    patch('scale', next);
  }
</script>

{#if layer}
<div data-help-page="stage-simulator" class="props">
  <header class="props-head">
    <div class="layer-name">{layer.name}</div>
    <span class="badge">screen</span>
  </header>
  <p class="hint">Rename / reorder this screen in the 2D Stage Designer. The 3D tweaks below are presentation-only.</p>
  {#if isDomeVenue}
    <p class="hint">Sphere screens are fixed to the venue. Use Dome mapping and tuning for content alignment.</p>
  {:else}
    <section class="prop-section">
      <h4>Position (m)</h4>
      <div class="vec3-row">
        {#each ['X', 'Y', 'Z'] as label, i}
          <label class="prop-axis">
            <span class="axis-label">{label}</span>
            <input
              type="number" step="0.1"
              value={(override.position ?? [0, 0, 0])[i].toFixed(2)}
              oninput={(e) => setPositionAxis(i as 0|1|2, parseFloat((e.target as HTMLInputElement).value) || 0)}
            />
          </label>
        {/each}
      </div>
    </section>

    <section class="prop-section">
      <h4>Rotation (°)</h4>
      <div class="vec3-row">
        <label class="prop-axis"><span class="axis-label">P</span>
          <input type="number" step="5" value={pitchDeg.toFixed(0)}
            oninput={(e) => setRotationAxis(0, parseFloat((e.target as HTMLInputElement).value) || 0)} />
        </label>
        <label class="prop-axis"><span class="axis-label">Y</span>
          <input type="number" step="5" value={yawDeg.toFixed(0)}
            oninput={(e) => setRotationAxis(1, parseFloat((e.target as HTMLInputElement).value) || 0)} />
        </label>
        <label class="prop-axis"><span class="axis-label">R</span>
          <input type="number" step="5" value={rollDeg.toFixed(0)}
            oninput={(e) => setRotationAxis(2, parseFloat((e.target as HTMLInputElement).value) || 0)} />
        </label>
      </div>
    </section>

    <section class="prop-section">
      <h4>Scale</h4>
      <div class="vec3-row">
        {#each ['X', 'Y', 'Z'] as label, i}
          <label class="prop-axis">
            <span class="axis-label">{label}</span>
            <input
              type="number" step="0.05" min="0.05"
              value={scaleValue[i].toFixed(2)}
              oninput={(e) => setScaleAxis(i as 0|1|2, parseFloat((e.target as HTMLInputElement).value) || 1)}
            />
          </label>
        {/each}
      </div>
    </section>
  {/if}

  <section class="prop-section">
    <h4>Visual</h4>
    <label class="slider-row">
      <span>Brightness</span>
      <input type="range" min="0" max="4" step="0.1" value={override.brightness ?? 1.0}
        oninput={(e) => patch('brightness', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{(override.brightness ?? 1.0).toFixed(1)}</span>
    </label>
    {#if !isDomeVenue}
      <label class="slider-row">
        <span>Curvature</span>
        <input type="range" min="-0.2" max="0.2" step="0.01" value={override.curvature ?? 0}
          oninput={(e) => patch('curvature', parseFloat((e.target as HTMLInputElement).value))} />
        <span class="slider-val">{(override.curvature ?? 0).toFixed(2)}</span>
      </label>
      <label class="slider-row">
        <span>Frame depth</span>
        <input type="range" min="0" max="1" step="0.05" value={override.frameDepth ?? 0.25}
          oninput={(e) => patch('frameDepth', parseFloat((e.target as HTMLInputElement).value))} />
        <span class="slider-val">{(override.frameDepth ?? 0.25).toFixed(2)}m</span>
      </label>
    {/if}
    <div class="pill-row">
      {#each ['led', 'projection', 'clean'] as f}
        <button class="pill" class:active={(override.finish ?? 'led') === f}
          onclick={() => patch('finish', f as Stage3DScreenOverride['finish'])}>{OPTION_LABELS[f] ?? f}</button>
      {/each}
    </div>
  </section>

  <section class="prop-section">
    <h4>Display fit</h4>
    <div class="pill-row">
      {#each ['stretch', 'contain', 'cover'] as f}
        <button class="pill" class:active={(override.displayFit ?? 'stretch') === f}
          onclick={() => patch('displayFit', f as Stage3DScreenOverride['displayFit'])}>{OPTION_LABELS[f] ?? f}</button>
      {/each}
    </div>
  </section>

  {#if isDomeVenue}
  <section class="prop-section">
    <h4>Dome mapping</h4>
    <div class="pill-row">
      {#each domeModes as mode}
        <button class="pill" class:active={(override.domeMapping ?? 'wrap') === mode.value}
          onclick={() => patch('domeMapping', mode.value)}>{mode.label}</button>
      {/each}
    </div>
    <p class="hint">Stretch: flat content projected over the spherical cap. Domemaster and equirect use the editor's Dome Projection output so dome-formatted content lands correctly.</p>
  </section>

  <section class="prop-section">
    <div class="section-title-row">
      <h4>Dome tuning</h4>
      <button class="mini-reset" onclick={resetDomeTuning}>Reset</button>
    </div>
    <label class="slider-row">
      <span>Center X</span>
      <input type="range" min="-0.5" max="0.5" step="0.01" value={domeNumber('domePanX')}
        oninput={(e) => patch('domePanX', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{domeNumber('domePanX').toFixed(2)}</span>
    </label>
    <label class="slider-row">
      <span>Center Y</span>
      <input type="range" min="-0.5" max="0.5" step="0.01" value={domeNumber('domePanY')}
        oninput={(e) => patch('domePanY', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{domeNumber('domePanY').toFixed(2)}</span>
    </label>
    <label class="slider-row">
      <span>Zoom</span>
      <input type="range" min="0.35" max="3" step="0.01" value={domeNumber('domeZoom')}
        oninput={(e) => patch('domeZoom', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{domeNumber('domeZoom').toFixed(2)}x</span>
    </label>
    <label class="slider-row">
      <span>Roll</span>
      <input type="range" min="-180" max="180" step="1" value={domeNumber('domeRoll')}
        oninput={(e) => patch('domeRoll', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{domeNumber('domeRoll').toFixed(0)}°</span>
    </label>
    <label class="slider-row">
      <span>Edge relief</span>
      <input type="range" min="0" max="1" step="0.01" value={domeNumber('domeEdgeBlend')}
        oninput={(e) => patch('domeEdgeBlend', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{Math.round(domeNumber('domeEdgeBlend') * 100)}%</span>
    </label>
    <label class="slider-row">
      <span>Vertical curve</span>
      <input type="range" min="0" max="1" step="0.01" value={domeNumber('domeVerticalBlend')}
        oninput={(e) => patch('domeVerticalBlend', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{Math.round(domeNumber('domeVerticalBlend') * 100)}%</span>
    </label>
  </section>
  {/if}

  <section class="prop-section">
    <h4>Edge effect</h4>
    <div class="pill-row pill-wrap">
      {#each ['none', 'bezel-glow', 'soft-border', 'scanlines', 'pixel-grid'] as e}
        <button class="pill" class:active={(override.edgeEffect ?? 'none') === e}
          onclick={() => patch('edgeEffect', e as Stage3DScreenOverride['edgeEffect'])}>{OPTION_LABELS[e] ?? e}</button>
      {/each}
    </div>
  </section>

  <button class="reset-btn" onclick={reset}>Reset 3D tweaks for this screen</button>
</div>
{:else}
  <p data-help-page="stage-simulator" class="missing">Screen no longer in the project.</p>
{/if}

<style>
  .props {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    min-width: 0;
    padding: 4px 0;
    overflow: hidden;
    box-sizing: border-box;
  }
  .props * { box-sizing: border-box; min-width: 0; }
  .props-head { display: flex; align-items: center; gap: 8px; }
  .layer-name {
    flex: 1;
    color: var(--ga-ink-0);
    font-size: var(--ga-text-title, 14px);
    font-weight: var(--ga-weight-title, 650);
  }
  .badge {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    background: var(--ga-sub);
    color: var(--ga-ink-2);
    padding: 2px 6px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid var(--ga-line-2);
  }
  .hint {
    margin: 0;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2);
    line-height: 1.45;
  }
  .missing { color: var(--ga-ink-2); font-size: var(--ga-text-body, 13px); padding: 12px; text-align: center; }
  .prop-section h4 {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2);
    margin: 0 0 6px 0;
  }
  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .section-title-row h4 { margin: 0; }
  .mini-reset {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    padding: 0 8px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .mini-reset:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .vec3-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .prop-axis {
    display: flex; align-items: center;
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot); border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px); padding: 0 6px; gap: 4px;
  }
  .axis-label { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2); font-weight: 600; }
  .prop-axis input[type=number] {
    flex: 1; background: transparent !important; border: none !important; color: var(--ga-ink-0);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-control, 12px); width: 100%; min-width: 0; padding: 0;
    box-shadow: none !important;
  }
  .prop-axis input[type=number]:focus { outline: none; }
  .slider-row {
    display: grid; grid-template-columns: minmax(68px, 0.9fr) minmax(72px, 1fr) minmax(40px, auto);
    align-items: center; gap: 6px;
    min-height: var(--ga-control-h, 26px);
    font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1);
  }
  .slider-row input[type=range] { accent-color: var(--ga-selection-line); width: 100%; }
  .slider-val {
    text-align: right; font-variant-numeric: tabular-nums;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    color: var(--ga-ink-1); font-size: var(--ga-text-meta, 11px);
  }
  .pill-row {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    margin-top: 6px;
    width: 100%;
  }
  .pill-row.pill-wrap { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .pill-row.pill-wrap .pill:last-child:nth-child(odd) { grid-column: 1 / -1; }
  .pill {
    height: var(--ga-control-h, 26px);
    background: var(--ga-card); border: 1px solid var(--ga-line-2); color: var(--ga-ink-1);
    padding: 0 6px; border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer; white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .pill.active {
    background: var(--ga-selection-bg) !important;
    color: var(--ga-selection-ink) !important;
    border-color: var(--ga-selection-line) !important;
  }
  .reset-btn {
    min-height: var(--ga-control-h, 26px);
    background: color-mix(in srgb, var(--ga-rec, #ff3b30) 10%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff3b30) 35%, transparent);
    color: var(--ga-rec, #ff3b30);
    padding: 4px 10px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    margin-top: 4px;
    white-space: normal;
    line-height: 1.25;
  }
  .reset-btn:hover { background: color-mix(in srgb, var(--ga-rec, #ff3b30) 18%, transparent); }
</style>
