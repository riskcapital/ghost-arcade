<script lang="ts">
  /**
   * Dome output: how the canvas becomes a dome picture on every output.
   *
   * The canvas is one of three things to the dome:
   *   - a panorama, wrapped around it (across = around the dome, up = up it),
   *     the polar wrap fulldome artists otherwise build with an effect;
   *   - a domemaster already (re-lensed, turned and tilted here);
   *   - a flat view, as a camera at the center looking up through it.
   * Layers can also be placed on the dome one by one (their Dome section,
   * dragged with DomeGizmo on the canvas): they skip the wrap and the
   * composition effects and land undistorted.
   *
   * The renderer side is dome_source_uv / dome_grid / dome_place_uv in
   * heartbeat.wgsl; output/domeMath.ts mirrors it.
   */
  import { settings, type OutputSettings } from '../stores/settings';
  import { project, selectedLayer } from '../stores/layers';
  import { recordDiscreteAction } from '../stores/historyHooks';
  import {
    defaultSourceAngle,
    domeLensOf,
    domeSourceAngleOf,
    domeSourceOf,
    placementOf,
    type DomeLens,
    type DomeSource,
  } from '../output/domeMath';

  let out = $derived($settings.output);
  let enabled = $derived(!!out.domeEnabled);
  let source = $derived(domeSourceOf(out));
  let lens = $derived(domeLensOf(out));
  let placed = $derived($project.layers.filter((layer) => layer.domePlacement?.enabled));

  type NumberKey =
    | 'domeFOV'
    | 'domeRotation'
    | 'domeTilt'
    | 'domeOffsetX'
    | 'domeOffsetY'
    | 'domeCurvature'
    | 'domeTruncation'
    | 'domeSourceAngle'
    | 'domePanoBottom'
    | 'domePanoTop'
    | 'domePanoSpan';

  type Row = { key: NumberKey; label: string; title: string; min: number; max: number; step: number; value: number; unit: 'deg' | 'pct' | 'num' };

  function patch(next: Partial<OutputSettings>) {
    settings.update((s) => ({ ...s, output: { ...s.output, ...next } }));
  }

  function setNumber(key: NumberKey, e: Event, row: Row) {
    const value = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(value)) return;
    const clamped = Math.max(row.min, Math.min(row.max, value));
    const next: Partial<OutputSettings> = { [key]: clamped };
    // Keep the panorama band the right way up.
    if (key === 'domePanoBottom' && clamped >= (out.domePanoTop ?? 90) - 1) next.domePanoTop = Math.min(90, clamped + 1);
    if (key === 'domePanoTop' && clamped <= (out.domePanoBottom ?? 0) + 1) next.domePanoBottom = Math.max(-90, clamped - 1);
    patch(next);
  }

  function setSource(next: DomeSource) {
    if (next === source) return;
    patch({
      domeSource: next,
      // The old mode value doubled as "panorama"; from here on it is only the lens.
      domeMode: lens,
      domeSourceAngle: defaultSourceAngle(next),
    });
    recordDiscreteAction();
  }

  const SOURCES: { value: DomeSource; label: string; hint: string }[] = [
    { value: 'panorama', label: 'Panorama', hint: 'The canvas wraps around the dome: across it goes around, up it climbs toward the top. Its middle faces the front.' },
    { value: 'domemaster', label: 'Domemaster', hint: 'The canvas already holds a round dome picture, fitted to its height. It is re-lensed, turned and tilted to suit this dome.' },
    { value: 'flat', label: 'Flat view', hint: 'A camera at the center of the dome looks up through the canvas. Best for a picture overhead; it cannot reach the rim.' },
  ];

  const LENSES: { value: DomeLens; label: string }[] = [
    { value: 'angular', label: 'Angular (domemaster)' },
    { value: 'stereographic', label: 'Stereographic' },
    { value: 'orthographic', label: 'Orthographic' },
  ];

  let canvasRows = $derived.by((): Row[] => {
    if (source === 'panorama') {
      return [
        { key: 'domePanoBottom', label: 'Bottom edge', title: 'The elevation the bottom of the canvas sits at. 0 is the horizon; below it reaches under a dome wider than 180 degrees.', min: -90, max: 85, step: 1, value: out.domePanoBottom ?? 0, unit: 'deg' },
        { key: 'domePanoTop', label: 'Top edge', title: 'The elevation the top of the canvas reaches. 90 closes it at the zenith; lower leaves the top of the dome clear for placed layers.', min: -85, max: 90, step: 1, value: out.domePanoTop ?? 90, unit: 'deg' },
        { key: 'domePanoSpan', label: 'Around', title: 'How far around the dome the canvas reaches, centered on the front', min: 10, max: 360, step: 1, value: out.domePanoSpan ?? 360, unit: 'deg' },
      ];
    }
    if (source === 'domemaster') {
      return [
        { key: 'domeSourceAngle', label: 'Canvas lens', title: 'The angle the round picture on the canvas covers, usually 180', min: 90, max: 360, step: 1, value: domeSourceAngleOf(out), unit: 'deg' },
      ];
    }
    return [
      { key: 'domeSourceAngle', label: 'View width', title: 'How wide the camera looking up through the canvas sees, across', min: 10, max: 170, step: 1, value: domeSourceAngleOf(out), unit: 'deg' },
      { key: 'domeCurvature', label: 'Curvature', title: 'Eases back toward the plain canvas at 0', min: 0, max: 1, step: 0.01, value: out.domeCurvature ?? 1, unit: 'pct' },
    ];
  });

  let domeRows = $derived.by((): Row[] => [
    { key: 'domeFOV', label: 'Dome angle', title: 'How much of the sphere the dome picture covers: 180 for a hemisphere', min: 90, max: 360, step: 1, value: out.domeFOV ?? 180, unit: 'deg' },
    { key: 'domeRotation', label: 'Turn', title: 'Turns the dome picture, to put the front where the projector expects it', min: 0, max: 360, step: 1, value: out.domeRotation ?? 0, unit: 'deg' },
    { key: 'domeTilt', label: 'Tilt', title: 'Tilts the canvas on the dome, for a tilted theater or to raise the horizon', min: -90, max: 90, step: 1, value: out.domeTilt ?? 0, unit: 'deg' },
    { key: 'domeTruncation', label: 'Visible', title: 'How far out from the center the picture reaches before it fades', min: 0.5, max: 1, step: 0.01, value: out.domeTruncation ?? 1, unit: 'pct' },
    { key: 'domeOffsetX', label: 'Center X', title: 'Moves the dome circle across the output', min: -1, max: 1, step: 0.01, value: out.domeOffsetX ?? 0, unit: 'num' },
    { key: 'domeOffsetY', label: 'Center Y', title: 'Moves the dome circle up the output', min: -1, max: 1, step: 0.01, value: out.domeOffsetY ?? 0, unit: 'num' },
  ]);

  function shown(row: Row): string {
    if (row.unit === 'pct') return `${Math.round(row.value * 100)}%`;
    if (row.unit === 'num') return row.value.toFixed(2);
    return `${Math.round(row.value)}°`;
  }

  function applyPreset(kind: DomeSource) {
    patch({
      domeEnabled: true,
      domeSource: kind,
      domeMode: 'angular',
      domeFOV: 180,
      domeRotation: 0,
      domeTilt: 0,
      domeOffsetX: 0,
      domeOffsetY: 0,
      domeCurvature: 1,
      domeTruncation: 1,
      domeSourceAngle: defaultSourceAngle(kind),
      domePanoBottom: 0,
      domePanoTop: 90,
      domePanoSpan: 360,
    });
    recordDiscreteAction();
  }

  function placeSelected() {
    const layer = $selectedLayer;
    if (!layer) return;
    project.updateLayer(layer.id, { domePlacement: { ...placementOf(layer), enabled: true } });
    recordDiscreteAction();
  }

  function wrap180(deg: number): number {
    return ((((deg + 180) % 360) + 360) % 360) - 180;
  }
</script>

<label class="dome-enable">
  <input
    type="checkbox"
    checked={enabled}
    onchange={(e) => { settings.setDomeEnabled((e.target as HTMLInputElement).checked); recordDiscreteAction(); }}
  />
  <span>Dome picture on every output</span>
</label>
<div class="dome-presets" role="group" aria-label="Start from">
  <button type="button" onclick={() => applyPreset('panorama')} title="Wrap a panorama canvas around a 180 degree dome">Panorama wrap</button>
  <button type="button" onclick={() => applyPreset('domemaster')} title="The canvas is already a 180 degree domemaster">Domemaster</button>
  <button type="button" onclick={() => applyPreset('flat')} title="Look up through a flat canvas">Flat overhead</button>
</div>

{#if enabled}
  <div class="dome-group">
    <div class="dome-group-title">Canvas</div>
    <div class="dome-kinds" role="radiogroup" aria-label="What the canvas is">
      {#each SOURCES as kind (kind.value)}
        <button
          type="button"
          role="radio"
          aria-checked={source === kind.value}
          class:active={source === kind.value}
          onclick={() => setSource(kind.value)}
        >{kind.label}</button>
      {/each}
    </div>
    <p class="dome-hint">{SOURCES.find((kind) => kind.value === source)?.hint}</p>
    {#each canvasRows as row (row.key)}
      <label class="dome-row" title={row.title}>
        <span>{row.label}</span>
        <input type="range" min={row.min} max={row.max} step={row.step} value={row.value}
          oninput={(e) => setNumber(row.key, e, row)} onchange={() => recordDiscreteAction()} />
        <em>{shown(row)}</em>
      </label>
    {/each}
  </div>

  <div class="dome-group">
    <div class="dome-group-title">Dome</div>
    <label class="dome-field">
      <span>Lens</span>
      <select
        value={lens}
        onchange={(e) => { patch({ domeMode: (e.target as HTMLSelectElement).value as DomeLens, domeSource: source }); recordDiscreteAction(); }}
      >
        {#each LENSES as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>
    {#each domeRows as row (row.key)}
      <label class="dome-row" title={row.title}>
        <span>{row.label}</span>
        <input type="range" min={row.min} max={row.max} step={row.step} value={row.value}
          oninput={(e) => setNumber(row.key, e, row)} onchange={() => recordDiscreteAction()} />
        <em>{shown(row)}</em>
      </label>
    {/each}
    <label class="dome-check" title="Elevation rings every 15 degrees, spokes every 30, the horizon and the front in amber. Drawn on the editor and every output, for lining projectors up with the dome.">
      <input type="checkbox" checked={!!out.domeGrid}
        onchange={(e) => { patch({ domeGrid: (e.target as HTMLInputElement).checked }); recordDiscreteAction(); }} />
      <span>Dome grid on every output</span>
    </label>
  </div>

  <div class="dome-group">
    <div class="dome-group-title">On the dome</div>
    {#if placed.length === 0}
      <p class="dome-hint">Layers placed on the dome skip the wrap and the composition effects and land undistorted: a logo at the zenith, a planet low in front. Turn on Place on the dome in a layer's properties, then drag it on the canvas.</p>
    {:else}
      <ul class="dome-placed">
        {#each placed as layer (layer.id)}
          {@const place = placementOf(layer)}
          <li>
            <button type="button" class:selected={layer.id === $project.selectedLayerId} onclick={() => project.selectLayer(layer.id)}>
              <span class="dome-placed-name">{layer.name}</span>
              <span class="dome-placed-at">{Math.round(wrap180(place.azimuth))}° around, {Math.round(place.elevation)}° up</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
    {#if $selectedLayer && !$selectedLayer.domePlacement?.enabled && $selectedLayer.type !== 'mask'}
      <button type="button" class="dome-action" onclick={placeSelected}>Place {$selectedLayer.name} on the dome</button>
    {/if}
  </div>
{/if}

<style>
  .dome-enable,
  .dome-check {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
    color: var(--ga-ink-0, #e6e1ee);
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
  }
  .dome-enable input,
  .dome-check input { margin: 0; cursor: pointer; }
  .dome-presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  .dome-presets button,
  .dome-action {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-1, #b8b2c2);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    font-family: inherit;
    cursor: pointer;
  }
  .dome-presets button:hover,
  .dome-action:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
  .dome-action { margin-top: 6px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dome-group {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .dome-group-title {
    color: var(--ga-ink-1, #a29baa);
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    margin-bottom: 4px;
  }
  .dome-kinds {
    display: flex;
    gap: 6px;
  }
  .dome-kinds button {
    flex: 1;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 6px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #ccc);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    font-family: inherit;
    cursor: pointer;
  }
  .dome-kinds button:hover:not(.active) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .dome-kinds button.active {
    background: var(--ga-selection-bg, rgba(82, 120, 255, 0.16));
    border-color: var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
  }
  .dome-hint {
    margin: 6px 0 2px;
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
    color: var(--ga-ink-2, #777);
  }
  .dome-field,
  .dome-row {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr) 42px;
    align-items: center;
    gap: 6px;
    margin-top: 6px;
  }
  .dome-field { grid-template-columns: 74px minmax(0, 1fr); }
  .dome-field span,
  .dome-row span {
    color: var(--ga-ink-1, #a29baa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-body, 500);
  }
  .dome-field select {
    min-width: 0;
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.28));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #e6e1ee);
    font-size: var(--ga-text-control, 12px);
    font-family: inherit;
  }
  .dome-row input[type='range'] {
    width: 100%;
    min-width: 0;
    accent-color: var(--ga-selection-line, #5278ff);
    cursor: pointer;
  }
  .dome-row em {
    color: var(--ga-ink-1, #8f8998);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    font-style: normal;
    text-align: right;
  }
  .dome-placed {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .dome-placed button {
    width: 100%;
    display: flex;
    justify-content: space-between;
    gap: 8px;
    padding: 4px 6px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e6e1ee);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    text-align: left;
    cursor: pointer;
  }
  .dome-placed button:hover { border-color: var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
  .dome-placed button.selected {
    background: var(--ga-selection-bg, rgba(82, 120, 255, 0.16));
    border-color: var(--ga-selection-line, #5278ff);
  }
  .dome-placed-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dome-placed-at {
    flex-shrink: 0;
    color: var(--ga-ink-2, #888);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
  }
</style>
