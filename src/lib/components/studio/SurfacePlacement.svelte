<script lang="ts">
  /**
   * The picture inside one surface: zoom, move and turn it (cropping is zooming in and moving),
   * put the same picture on every surface, or spread one picture across the surfaces that show it.
   */
  import { placementControls, isWholePicture, type Placement, type PlacementControls } from '../../mobile/studio/placement';
  import Icon from './StudioIcon.svelte';
  import InfoTip from './ui/InfoTip.svelte';

  export let placement: Placement | undefined;
  /** How many surfaces show the same thing as this one (this one included). */
  export let sharing = 1;
  /** Surfaces in the set that are switched on. */
  export let surfaces = 1;
  export let disabled = false;
  /** A control moves (`commit` false while dragging, true on release). */
  export let onchange: (control: keyof PlacementControls, value: number, commit: boolean) => void = () => {};
  export let onstart: () => void = () => {};
  export let onreset: () => void = () => {};
  export let onsameall: () => void = () => {};
  export let onspan: () => void = () => {};

  $: c = placementControls(placement);
  const ROWS: { key: keyof PlacementControls; label: string; min: number; max: number; step: number; show: (v: number) => string }[] = [
    { key: 'zoom', label: 'Zoom', min: 0.25, max: 4, step: 0.01, show: (v) => `${v.toFixed(2)}×` },
    { key: 'x', label: 'Left / right', min: 0, max: 1, step: 0.001, show: (v) => `${Math.round((v - 0.5) * 200)}` },
    { key: 'y', label: 'Up / down', min: 0, max: 1, step: 0.001, show: (v) => `${Math.round((v - 0.5) * 200)}` },
    { key: 'degrees', label: 'Turn', min: -180, max: 180, step: 1, show: (v) => `${Math.round(v)}°` },
  ];
</script>

<div class="placement" role="group" aria-label="Picture on this surface" data-surface-placement>
  <div class="heading"><span class="title"><Icon name="crop" size={16} />Picture on this surface</span><InfoTip label="About the picture on a surface" text="Zoom, move and turn the picture inside this surface; zooming in crops it. Same picture on all surfaces copies this one everywhere. Span stretches one picture across every surface that shows the same thing." /><span class="grow"></span>{#if !isWholePicture(placement)}<button data-placement-reset {disabled} onclick={onreset}>Whole picture</button>{/if}</div>
  {#each ROWS as row (row.key)}
    <label class="row">
      <span>{row.label}</span>
      <input type="range" min={row.min} max={row.max} step={row.step} value={c[row.key]} {disabled}
        data-default={row.key === 'zoom' ? 1 : row.key === 'degrees' ? 0 : 0.5}
        onpointerdown={onstart}
        oninput={(e) => onchange(row.key, Number(e.currentTarget.value), false)}
        onchange={(e) => onchange(row.key, Number(e.currentTarget.value), true)} />
      <output>{row.show(c[row.key])}</output>
    </label>
  {/each}
  <div class="actions">
    <button data-placement-all disabled={disabled || surfaces < 2} onclick={onsameall}>Same picture on all surfaces</button>
    <button data-placement-span disabled={disabled || sharing < 2} onclick={onspan}>{sharing < 2 ? 'Span (needs 2 surfaces)' : `Span across ${sharing} surfaces`}</button>
  </div>
</div>

<style>
  .placement { display: grid; gap: 4px; margin: 16px 0 10px; padding: 12px 0 0; border-top: 1px solid var(--ga-section-head-line, var(--ga-line-2)); }
  .heading { display: flex; align-items: center; gap: 2px; min-height: 44px; }
  .title { --ga-icon-tone: var(--ga-tone-map); display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 650; color: var(--ga-ink-0); }
  .grow { flex: 1; }
  .heading button, .actions button {
    min-height: 44px; padding: 0 12px; font: inherit; font-size: 13px; color: var(--ga-ink-0);
    background: var(--ga-hardware-bg); border: 1px solid var(--ga-line-2); border-radius: 6px; touch-action: manipulation;
  }
  button:disabled { opacity: .45; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  .row { display: grid; grid-template-columns: minmax(0, 84px) minmax(96px, 1fr) 48px; align-items: center; gap: 8px; min-height: 44px; }
  .row > span { font-size: 13px; color: var(--ga-ink-1); }
  .row input { width: 100%; min-height: 44px; margin: 0; }
  .row output { font-size: 12px; text-align: right; color: var(--ga-ink-0); font-variant-numeric: tabular-nums; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; }
  .actions button { padding: 4px 8px; line-height: 1.25; }
</style>
