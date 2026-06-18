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

  function patch(field: keyof Stage3DScreenOverride, value: any) {
    stage3dScene.setScreenOverride(layerId, { [field]: value });
  }

  function reset() {
    if (confirm('Reset 3D tweaks for this screen?')) {
      stage3dScene.setScreenOverride(layerId, null);
    }
  }

  $: pitchDeg = ((override.rotation ?? [0, 0, 0])[0] * 180 / Math.PI);
  $: yawDeg = ((override.rotation ?? [0, 0, 0])[1] * 180 / Math.PI);
  $: rollDeg = ((override.rotation ?? [0, 0, 0])[2] * 180 / Math.PI);

  function setRotationAxis(axis: 0 | 1 | 2, degrees: number) {
    const current = override.rotation ?? [0, 0, 0];
    const radians = degrees * Math.PI / 180;
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axis] = radians;
    patch('rotation', next);
  }

  function setPositionAxis(axis: 0 | 1 | 2, value: number) {
    const current = override.position ?? [0, 0, 0];
    const next: [number, number, number] = [current[0], current[1], current[2]];
    next[axis] = value;
    patch('position', next);
  }
</script>

{#if layer}
<div class="props">
  <header class="props-head">
    <div class="layer-name">{layer.name}</div>
    <span class="badge">screen</span>
  </header>
  <p class="hint">Rename / reorder this screen in the 2D Stage Designer. The 3D tweaks below are presentation-only.</p>

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
    <h4>Visual</h4>
    <label class="slider-row">
      <span>Brightness</span>
      <input type="range" min="0" max="4" step="0.1" value={override.brightness ?? 1.0}
        oninput={(e) => patch('brightness', parseFloat((e.target as HTMLInputElement).value))} />
      <span class="slider-val">{(override.brightness ?? 1.0).toFixed(1)}</span>
    </label>
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
    <div class="pill-row">
      {#each ['led', 'projection', 'clean'] as f}
        <button class="pill" class:active={(override.finish ?? 'led') === f}
          onclick={() => patch('finish', f as Stage3DScreenOverride['finish'])}>{f}</button>
      {/each}
    </div>
  </section>

  <section class="prop-section">
    <h4>Display fit</h4>
    <div class="pill-row">
      {#each ['stretch', 'contain', 'cover'] as f}
        <button class="pill" class:active={(override.displayFit ?? 'stretch') === f}
          onclick={() => patch('displayFit', f as Stage3DScreenOverride['displayFit'])}>{f}</button>
      {/each}
    </div>
  </section>

  {#if isDomeVenue}
  <section class="prop-section">
    <h4>Dome mapping</h4>
    <div class="pill-row">
      {#each ['wrap', 'domemaster', 'equirect'] as m}
        <button class="pill" class:active={(override.domeMapping ?? 'wrap') === m}
          onclick={() => patch('domeMapping', m as Stage3DScreenOverride['domeMapping'])}>{m}</button>
      {/each}
    </div>
    <p class="hint">wrap = flat content spreads across the dome. domemaster / equirect consume the editor's Dome Projection output (Output settings → Dome) so real dome-formatted content lands correctly on the sphere.</p>
  </section>
  {/if}

  <section class="prop-section">
    <h4>Edge effect</h4>
    <div class="pill-row pill-wrap">
      {#each ['none', 'bezel-glow', 'soft-border', 'scanlines', 'pixel-grid'] as e}
        <button class="pill" class:active={(override.edgeEffect ?? 'none') === e}
          onclick={() => patch('edgeEffect', e as Stage3DScreenOverride['edgeEffect'])}>{e}</button>
      {/each}
    </div>
  </section>

  <button class="reset-btn" onclick={reset}>Reset 3D tweaks for this screen</button>
</div>
{:else}
  <p class="missing">Screen no longer in the project.</p>
{/if}

<style>
  .props { display: flex; flex-direction: column; gap: 14px; padding: 8px 2px; }
  .props-head { display: flex; align-items: center; gap: 8px; }
  .layer-name {
    flex: 1;
    color: #fff;
    font-size: 16px;
    font-weight: 600;
  }
  .badge {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    background: rgba(187, 134, 252, 0.16);
    color: #BB86FC;
    padding: 3px 7px;
    border-radius: 4px;
    border: 1px solid rgba(187, 134, 252, 0.3);
  }
  .hint {
    margin: 0;
    font-size: 13px;
    color: #888;
    line-height: 1.4;
  }
  .missing { color: #888; font-size: 14px; padding: 12px; text-align: center; }
  .prop-section h4 {
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #888;
    margin: 0 0 6px 0;
    font-weight: 500;
  }
  .vec3-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .prop-axis {
    display: flex; align-items: center;
    background: #14161e; border: 1px solid #2a2c36;
    border-radius: 6px; padding: 4px 6px; gap: 4px;
  }
  .axis-label { font-size: 12px; color: #888; font-weight: 600; }
  .prop-axis input[type=number] {
    flex: 1; background: transparent; border: none; color: #fff;
    font-size: 14px; width: 100%; min-width: 0;
  }
  .prop-axis input[type=number]:focus { outline: none; }
  .slider-row {
    display: grid; grid-template-columns: 80px 1fr 50px;
    align-items: center; gap: 6px; font-size: 13px; color: #ccc;
    margin-bottom: 6px;
  }
  .slider-row input[type=range] { accent-color: #BB86FC; width: 100%; }
  .slider-val {
    text-align: right; font-variant-numeric: tabular-nums;
    color: #888; font-size: 12px;
  }
  .pill-row { display: flex; gap: 4px; margin-top: 6px; }
  .pill-row.pill-wrap { flex-wrap: wrap; }
  .pill {
    flex: 1 1 auto;
    background: #14161e; border: 1px solid #2a2c36; color: #aaa;
    padding: 5px 8px; border-radius: 6px;
    font-size: 12px; text-transform: uppercase; letter-spacing: 0.4px;
    cursor: pointer; white-space: nowrap;
  }
  .pill.active { background: #BB86FC; color: #1a1a1f; border-color: #BB86FC; }
  .reset-btn {
    background: rgba(255, 110, 110, 0.12);
    border: 1px solid rgba(255, 110, 110, 0.3);
    color: #ff8e8e;
    padding: 8px;
    border-radius: 8px;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    cursor: pointer;
    margin-top: 8px;
  }
  .reset-btn:hover { background: rgba(255, 110, 110, 0.2); }
</style>
