<script lang="ts">
  /**
   * A layer's spot on the dome (Layer.domePlacement). A placed layer skips
   * the composition effects and the dome wrap: the renderer lays its canvas
   * flat on the dome here, so a logo or a planet lands undistorted. Dragged
   * on the editor canvas with DomeGizmo; set exactly here.
   */
  import { project } from '../stores/layers';
  import { settings } from '../stores/settings';
  import { placementOf } from '../output/domeMath';
  import type { DomePlacement, Layer } from '../types';

  interface Props {
    layer: Layer;
  }
  let { layer }: Props = $props();

  let place = $derived(placementOf(layer));
  let domeOn = $derived(!!$settings.output.domeEnabled);

  function set(patch: Partial<DomePlacement>) {
    project.updateLayer(layer.id, { domePlacement: { ...placementOf(layer), ...patch } });
  }

  function numberFrom(e: Event, fallback: number): number {
    const value = parseFloat((e.target as HTMLInputElement).value);
    return Number.isFinite(value) ? value : fallback;
  }

  /** Azimuth shown in -180..180, so the front sits mid-slider. */
  function wrap180(deg: number): number {
    return ((((deg + 180) % 360) + 360) % 360) - 180;
  }

  const rows: { key: 'azimuth' | 'elevation' | 'size' | 'roll'; label: string; title: string; min: number; max: number }[] = [
    { key: 'azimuth', label: 'Around', title: 'Around the dome from the front; positive is to the audience\'s right', min: -180, max: 180 },
    { key: 'elevation', label: 'Up', title: 'Up from the horizon; 90 is the zenith', min: -30, max: 90 },
    { key: 'size', label: 'Size', title: 'How wide the layer\'s canvas is on the dome, as an angle', min: 1, max: 170 },
    { key: 'roll', label: 'Turn', title: 'Turn about its own center', min: -180, max: 180 },
  ];

  function valueOf(key: (typeof rows)[number]['key']): number {
    return key === 'azimuth' ? wrap180(place.azimuth) : place[key];
  }
</script>

<div class="dome-place" data-dome-placement>
  <label class="dome-place-toggle">
    <input
      type="checkbox"
      checked={place.enabled}
      onchange={(e) => set({ enabled: (e.target as HTMLInputElement).checked })}
    />
    <span>Place on the dome</span>
  </label>
  {#if place.enabled}
    {#if !domeOn}
      <p class="dome-place-hint">Takes effect while the dome output is on (Screens, Dome output). Until then the layer draws on the canvas as usual.</p>
    {:else}
      <p class="dome-place-hint">Drawn straight onto the dome, after the composition effects and the dome wrap. Drag it on the canvas, or set it here.</p>
    {/if}
    {#each rows as row (row.key)}
      <div class="dome-place-row" title={row.title}>
        <span>{row.label}</span>
        <input
          type="range"
          min={row.min}
          max={row.max}
          step="0.5"
          value={valueOf(row.key)}
          oninput={(e) => set({ [row.key]: numberFrom(e, valueOf(row.key)) })}
          aria-label={row.label}
        />
        <input
          class="dome-place-num"
          type="number"
          min={row.min}
          max={row.max}
          step="1"
          value={Math.round(valueOf(row.key) * 10) / 10}
          onchange={(e) => set({ [row.key]: Math.max(row.min, Math.min(row.max, numberFrom(e, valueOf(row.key)))) })}
          aria-label={`${row.label} in degrees`}
        />
      </div>
    {/each}
    <div class="dome-place-actions">
      <button type="button" onclick={() => set({ azimuth: 0, elevation: 90, roll: 0 })} title="Center it on the top of the dome">Zenith</button>
      <button type="button" onclick={() => set({ azimuth: 0, elevation: 25, roll: 0 })} title="Low on the dome, straight ahead of the audience">Front</button>
      <button type="button" onclick={() => set({ roll: 0 })} title="Square it up">Level</button>
    </div>
  {/if}
</div>

<style>
  .dome-place {
    margin: 4px 0 10px;
  }
  .dome-place-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: var(--ga-control-h, 26px);
    color: var(--ga-ink-0, #e6e1ee);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .dome-place-toggle input { margin: 0; cursor: pointer; }
  .dome-place-hint {
    margin: 2px 0 8px;
    color: var(--ga-ink-2, #777);
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
  }
  .dome-place-row {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr) 54px;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }
  .dome-place-row span {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control, 12px);
  }
  .dome-place-row input[type='range'] {
    width: 100%;
    min-width: 0;
    accent-color: var(--ga-selection-line, #5278ff);
  }
  .dome-place-num {
    width: 100%;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 4px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.28));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e6e1ee);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    text-align: right;
  }
  .dome-place-actions {
    display: flex;
    gap: 6px;
    margin-top: 2px;
  }
  .dome-place-actions button {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 10px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #ccc);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
  }
  .dome-place-actions button:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }
</style>
