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
  import { t } from '../../i18n';

  export let layerId: string;

  $: layer = $project.layers.find((l) => l.id === layerId);
  $: override = ($stage3dScene.screenOverrides ?? {})[layerId] ?? {};
  // Dome content mapping only applies on the sphere venue, where this
  // screen is a spherical sector on the dome interior.
  $: isDomeVenue = ($stage3dScene.venue ?? 'festival') === 'sphere';
  const domeModes: { value: NonNullable<Stage3DScreenOverride['domeMapping']>; key: string }[] = [
    { value: 'wrap', key: 'stage3d.node.domeModes.wrap' },
    { value: 'domemaster', key: 'stage3d.node.domeModes.domemaster' },
    { value: 'equirect', key: 'stage3d.node.domeModes.equirect' },
  ];
  const edgeEffects: { value: NonNullable<Stage3DScreenOverride['edgeEffect']>; key: string }[] = [
    { value: 'none', key: 'stage3d.node.edgeEffects.none' },
    { value: 'bezel-glow', key: 'stage3d.node.edgeEffects.bezelGlow' },
    { value: 'soft-border', key: 'stage3d.node.edgeEffects.softBorder' },
    { value: 'scanlines', key: 'stage3d.node.edgeEffects.scanlines' },
    { value: 'pixel-grid', key: 'stage3d.node.edgeEffects.pixelGrid' },
  ];
  const domeDefaults = {
    domePanX: 0,
    domePanY: 0,
    domeZoom: 1,
    domeRoll: 0,
    domeEdgeBlend: 0.35,
    domeVerticalBlend: 0,
  } as const;

  function patch(field: keyof Stage3DScreenOverride, value: any) {
    if (
      isDomeVenue &&
      (field === 'position' ||
        field === 'rotation' ||
        field === 'scale' ||
        field === 'curvature' ||
        field === 'frameDepth')
    )
      return;
    stage3dScene.setScreenOverride(layerId, { [field]: value });
  }

  function reset() {
    if (confirm($t('stage3d.dialogs.resetScreen'))) {
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

  $: pitchDeg = ((override.rotation ?? [0, 0, 0])[0] * 180) / Math.PI;
  $: yawDeg = ((override.rotation ?? [0, 0, 0])[1] * 180) / Math.PI;
  $: rollDeg = ((override.rotation ?? [0, 0, 0])[2] * 180) / Math.PI;
  $: scaleValue = override.scale ?? [1, 1, 1];

  function setRotationAxis(axis: 0 | 1 | 2, degrees: number) {
    const current = override.rotation ?? [0, 0, 0];
    const radians = (degrees * Math.PI) / 180;
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
  <div class="props">
    <header class="props-head">
      <div class="layer-name">{layer.name}</div>
      <span class="badge">{$t('stage3d.node.screenBadge')}</span>
    </header>
    <p class="hint">{$t('stage3d.node.hint2d')}</p>
    {#if isDomeVenue}
      <p class="hint">{$t('stage3d.node.hintDome')}</p>
    {:else}
      <section class="prop-section">
        <h4>{$t('stage3d.node.position')}</h4>
        <div class="vec3-row">
          {#each ['X', 'Y', 'Z'] as label, i}
            <label class="prop-axis">
              <span class="axis-label">{label}</span>
              <input
                type="number"
                step="0.1"
                value={(override.position ?? [0, 0, 0])[i].toFixed(2)}
                oninput={(e) => setPositionAxis(i as 0 | 1 | 2, parseFloat((e.target as HTMLInputElement).value) || 0)}
              />
            </label>
          {/each}
        </div>
      </section>

      <section class="prop-section">
        <h4>{$t('stage3d.node.rotation')}</h4>
        <div class="vec3-row">
          <label class="prop-axis"
            ><span class="axis-label">P</span>
            <input
              type="number"
              step="5"
              value={pitchDeg.toFixed(0)}
              oninput={(e) => setRotationAxis(0, parseFloat((e.target as HTMLInputElement).value) || 0)}
            />
          </label>
          <label class="prop-axis"
            ><span class="axis-label">Y</span>
            <input
              type="number"
              step="5"
              value={yawDeg.toFixed(0)}
              oninput={(e) => setRotationAxis(1, parseFloat((e.target as HTMLInputElement).value) || 0)}
            />
          </label>
          <label class="prop-axis"
            ><span class="axis-label">R</span>
            <input
              type="number"
              step="5"
              value={rollDeg.toFixed(0)}
              oninput={(e) => setRotationAxis(2, parseFloat((e.target as HTMLInputElement).value) || 0)}
            />
          </label>
        </div>
      </section>

      <section class="prop-section">
        <h4>{$t('stage3d.node.scale')}</h4>
        <div class="vec3-row">
          {#each ['X', 'Y', 'Z'] as label, i}
            <label class="prop-axis">
              <span class="axis-label">{label}</span>
              <input
                type="number"
                step="0.05"
                min="0.05"
                value={scaleValue[i].toFixed(2)}
                oninput={(e) => setScaleAxis(i as 0 | 1 | 2, parseFloat((e.target as HTMLInputElement).value) || 1)}
              />
            </label>
          {/each}
        </div>
      </section>
    {/if}

    <section class="prop-section">
      <h4>{$t('stage3d.node.visual')}</h4>
      <label class="slider-row">
        <span>{$t('stage3d.node.brightness')}</span>
        <input
          type="range"
          min="0"
          max="4"
          step="0.1"
          value={override.brightness ?? 1.0}
          oninput={(e) => patch('brightness', parseFloat((e.target as HTMLInputElement).value))}
        />
        <span class="slider-val">{(override.brightness ?? 1.0).toFixed(1)}</span>
      </label>
      {#if !isDomeVenue}
        <label class="slider-row">
          <span>{$t('stage3d.node.curvature')}</span>
          <input
            type="range"
            min="-0.2"
            max="0.2"
            step="0.01"
            value={override.curvature ?? 0}
            oninput={(e) => patch('curvature', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{(override.curvature ?? 0).toFixed(2)}</span>
        </label>
        <label class="slider-row">
          <span>{$t('stage3d.node.frameDepth')}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={override.frameDepth ?? 0.25}
            oninput={(e) => patch('frameDepth', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{(override.frameDepth ?? 0.25).toFixed(2)}m</span>
        </label>
      {/if}
      <div class="pill-row">
        {#each ['led', 'projection', 'clean'] as f}
          <button
            class="pill"
            class:active={(override.finish ?? 'led') === f}
            onclick={() => patch('finish', f as Stage3DScreenOverride['finish'])}
            >{$t(`stage3d.node.finishes.${f}`)}</button
          >
        {/each}
      </div>
    </section>

    <section class="prop-section">
      <h4>{$t('stage3d.node.displayFit')}</h4>
      <div class="pill-row">
        {#each ['stretch', 'contain', 'cover'] as f}
          <button
            class="pill"
            class:active={(override.displayFit ?? 'stretch') === f}
            onclick={() => patch('displayFit', f as Stage3DScreenOverride['displayFit'])}
            >{$t(`stage3d.node.displayFits.${f}`)}</button
          >
        {/each}
      </div>
    </section>

    {#if isDomeVenue}
      <section class="prop-section">
        <h4>{$t('stage3d.node.domeMapping')}</h4>
        <div class="pill-row">
          {#each domeModes as mode}
            <button
              class="pill"
              class:active={(override.domeMapping ?? 'wrap') === mode.value}
              onclick={() => patch('domeMapping', mode.value)}>{$t(mode.key)}</button
            >
          {/each}
        </div>
        <p class="hint">{$t('stage3d.node.domeHint')}</p>
      </section>

      <section class="prop-section">
        <div class="section-title-row">
          <h4>{$t('stage3d.node.domeTuning')}</h4>
          <button class="mini-reset" onclick={resetDomeTuning}>{$t('stage3d.node.resetDome')}</button>
        </div>
        <label class="slider-row">
          <span>{$t('stage3d.node.centerX')}</span>
          <input
            type="range"
            min="-0.5"
            max="0.5"
            step="0.01"
            value={domeNumber('domePanX')}
            oninput={(e) => patch('domePanX', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{domeNumber('domePanX').toFixed(2)}</span>
        </label>
        <label class="slider-row">
          <span>{$t('stage3d.node.centerY')}</span>
          <input
            type="range"
            min="-0.5"
            max="0.5"
            step="0.01"
            value={domeNumber('domePanY')}
            oninput={(e) => patch('domePanY', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{domeNumber('domePanY').toFixed(2)}</span>
        </label>
        <label class="slider-row">
          <span>{$t('stage3d.node.zoom')}</span>
          <input
            type="range"
            min="0.35"
            max="3"
            step="0.01"
            value={domeNumber('domeZoom')}
            oninput={(e) => patch('domeZoom', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{domeNumber('domeZoom').toFixed(2)}x</span>
        </label>
        <label class="slider-row">
          <span>{$t('stage3d.node.roll')}</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="1"
            value={domeNumber('domeRoll')}
            oninput={(e) => patch('domeRoll', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{domeNumber('domeRoll').toFixed(0)}°</span>
        </label>
        <label class="slider-row">
          <span>{$t('stage3d.node.edgeRelief')}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={domeNumber('domeEdgeBlend')}
            oninput={(e) => patch('domeEdgeBlend', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{Math.round(domeNumber('domeEdgeBlend') * 100)}%</span>
        </label>
        <label class="slider-row">
          <span>{$t('stage3d.node.verticalCurve')}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={domeNumber('domeVerticalBlend')}
            oninput={(e) => patch('domeVerticalBlend', parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="slider-val">{Math.round(domeNumber('domeVerticalBlend') * 100)}%</span>
        </label>
      </section>
    {/if}

    <section class="prop-section">
      <h4>{$t('stage3d.node.edgeEffect')}</h4>
      <div class="pill-row pill-wrap">
        {#each edgeEffects as effect}
          <button
            class="pill"
            class:active={(override.edgeEffect ?? 'none') === effect.value}
            onclick={() => patch('edgeEffect', effect.value)}>{$t(effect.key)}</button
          >
        {/each}
      </div>
    </section>

    <button class="reset-btn" onclick={reset}>{$t('stage3d.node.resetTweaks')}</button>
  </div>
{:else}
  <p class="missing">{$t('stage3d.node.missing')}</p>
{/if}

<style>
  .props {
    display: flex;
    flex-direction: column;
    gap: 14px;
    width: 100%;
    min-width: 0;
    padding: 8px 0;
    overflow: hidden;
    box-sizing: border-box;
  }
  .props * {
    box-sizing: border-box;
    min-width: 0;
  }
  .props-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .layer-name {
    flex: 1;
    color: #fff;
    font-size: 15px;
    font-weight: 600;
  }
  .badge {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    background: rgba(187, 134, 252, 0.16);
    color: #bb86fc;
    padding: 3px 7px;
    border-radius: 4px;
    border: 1px solid rgba(187, 134, 252, 0.3);
  }
  .hint {
    margin: 0;
    font-size: 12px;
    color: #888;
    line-height: 1.4;
  }
  .missing {
    color: #888;
    font-size: 13px;
    padding: 12px;
    text-align: center;
  }
  .prop-section h4 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.7px;
    color: #888;
    margin: 0 0 6px 0;
    font-weight: 500;
  }
  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-bottom: 6px;
  }
  .section-title-row h4 {
    margin: 0;
  }
  .mini-reset {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #aaa;
    padding: 3px 7px;
    border-radius: 5px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    cursor: pointer;
  }
  .mini-reset:hover {
    color: #fff;
    border-color: rgba(187, 134, 252, 0.45);
  }
  .vec3-row {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 6px;
  }
  .prop-axis {
    display: flex;
    align-items: center;
    background: #14161e;
    border: 1px solid #2a2c36;
    border-radius: 6px;
    padding: 4px 6px;
    gap: 4px;
  }
  .axis-label {
    font-size: 11px;
    color: #888;
    font-weight: 600;
  }
  .prop-axis input[type='number'] {
    flex: 1;
    background: transparent;
    border: none;
    color: #fff;
    font-size: 13px;
    width: 100%;
    min-width: 0;
  }
  .prop-axis input[type='number']:focus {
    outline: none;
  }
  .slider-row {
    display: grid;
    grid-template-columns: minmax(68px, 0.9fr) minmax(72px, 1fr) minmax(40px, auto);
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: #ccc;
    margin-bottom: 6px;
  }
  .slider-row input[type='range'] { accent-color: #bb86fc; width: 100%; }
  .slider-val {
    text-align: right; font-variant-numeric: tabular-nums;
    color: #888; font-size: 11px;
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
    background: #14161e; border: 1px solid #2a2c36; color: #aaa;
    padding: 5px 5px; border-radius: 6px;
    font-size: 10px; text-transform: uppercase; letter-spacing: 0.25px;
    cursor: pointer; white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pill.active { background: #bb86fc; color: #1a1a1f; border-color: #bb86fc; }
  .reset-btn {
    background: rgba(255, 110, 110, 0.12);
    border: 1px solid rgba(255, 110, 110, 0.3);
    color: #ff8e8e;
    padding: 8px;
    border-radius: 8px;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    cursor: pointer;
    margin-top: 8px;
    white-space: normal;
    line-height: 1.25;
  }
  .reset-btn:hover { background: rgba(255, 110, 110, 0.2); }
</style>
