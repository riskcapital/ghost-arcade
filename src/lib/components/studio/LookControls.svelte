<script lang="ts">
  import { EDGE_LOOKS } from '../../mobile/studio/looks/edgeLookCatalog';
  import { LOOK_PALETTES } from '../../mobile/studio/looks/edgeLooks';
  import { EDGE_STROKE_TYPES, EDGE_FILL_TYPES } from '../../mobile/studio/looks/edgeEffectCatalog';
  import { MOBILE_EDGE_STROKES, MOBILE_EDGE_FILLS } from '../../mobile/studio/looks/renderer';
  import type { LookConfig } from '../../mobile/studio/looks/types';
  export let value: LookConfig | undefined;
  export let onchange: (config: LookConfig | undefined) => void;
  export let onapplyall: (() => void) | undefined = undefined;
  let expanded = false;
  const fresh = (id = 'neon-pulse', palette = 'neon'): LookConfig => ({
    id,
    palette,
    enabled: true,
    amount: 1,
    speed: 1,
    width: 1,
  });
  function patch(changes: Partial<LookConfig>) {
    onchange({ ...(value || fresh()), ...changes });
  }
  $: current = EDGE_LOOKS.find((l) => l.id === value?.id);
</script>

<section class="looks-panel">
  <header>
    <strong>EDGE EFFECTS & LOOKS</strong><button
      class:active={value?.enabled}
      aria-label="Toggle edge look"
      disabled={!value}
      onclick={() => patch({ enabled: !value?.enabled })}>{value?.enabled ? 'On' : 'Off'}</button
    >
  </header>
  <button class="choose" aria-expanded={expanded} onclick={() => (expanded = !expanded)}
    >{current?.name || (value?.id === 'custom' ? 'Custom edge effects' : 'Choose a Look')}
    <span>{expanded ? '−' : '+'}</span></button
  >
  {#if expanded}
    <div class="gallery">
      {#each EDGE_LOOKS as look}<button
          class:chosen={value?.id === look.id}
          title={look.blurb}
          onclick={() => {
            onchange(fresh(look.id, value?.palette || look.palette));
            expanded = false;
          }}
          ><img src={`${import.meta.env.BASE_URL}looks/${look.id}.png`} alt="" loading="lazy" /><span>{look.name}</span
          ></button
        >{/each}
    </div>
    <button
      class="custom"
      onclick={() => {
        onchange({ ...fresh('custom', value?.palette), stroke: 'neon', fill: 'none' });
        expanded = false;
      }}>Custom stroke & fill</button
    >
  {/if}
  {#if value}
    <label
      >Palette<select
        aria-label="Look palette"
        value={value.palette}
        onchange={(e) => patch({ palette: e.currentTarget.value })}
        >{#each LOOK_PALETTES as p}<option value={p.id}>{p.name}</option>{/each}</select
      ></label
    >
    {#if value.id === 'custom'}
      <label
        >Stroke<select value={value.stroke || 'neon'} onchange={(e) => patch({ stroke: e.currentTarget.value })}
          >{#each EDGE_STROKE_TYPES.filter((s) => MOBILE_EDGE_STROKES.includes(s.type)) as s}<option value={s.type}
              >{s.label}</option
            >{/each}</select
        ></label
      >
      <label
        >Fill<select value={value.fill || 'none'} onchange={(e) => patch({ fill: e.currentTarget.value })}
          >{#each EDGE_FILL_TYPES.filter((s) => MOBILE_EDGE_FILLS.includes(s.type)) as s}<option value={s.type}
              >{s.label}</option
            >{/each}</select
        ></label
      >
    {/if}
    {#each [{ key: 'amount', name: 'Amount', min: 0, max: 1 }, { key: 'speed', name: 'Speed', min: 0, max: 3 }, { key: 'width', name: 'Edge width', min: 0.25, max: 4 }] as p}
      <label
        >{p.name}<input
          aria-label={`Look ${p.name.toLowerCase()}`}
          style={`--fill:${((value[p.key as 'amount'] - p.min) / (p.max - p.min)) * 100}%`}
          type="range"
          min={p.min}
          max={p.max}
          step=".01"
          data-default="1"
          value={value[p.key as 'amount']}
          oninput={(e) => patch({ [p.key]: Number(e.currentTarget.value) })}
        /><output>{value[p.key as 'amount'].toFixed(2)}</output></label
      >
    {/each}
    <p>{current?.blurb || 'Animated outlines and fills that follow the screen geometry.'}</p>
    <footer>
      {#if onapplyall}<button onclick={onapplyall}>Apply to all screens</button>{/if}<button
        onclick={() => onchange(undefined)}>Remove</button
      >
    </footer>
  {/if}
</section>

<style>
  .looks-panel {
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-soft);
    padding: 14px;
    margin: 14px 0;
    background: var(--ga-card);
  }
  header,
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  header strong {
    font-size: 11px;
    letter-spacing: 0.06em;
    color: var(--ga-ink-1);
  }
  button,
  select {
    font: inherit;
    color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2);
    border-radius: 5px;
    background: var(--ga-hardware-bg);
    min-height: 40px;
    padding: 6px 10px;
    cursor: pointer;
  }
  button:focus-visible,
  select:focus-visible,
  input:focus-visible {
    outline: 2px solid var(--ga-focus);
    outline-offset: 2px;
  }
  button:disabled {
    opacity: 0.4;
  }
  .active,
  .chosen {
    background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line);
  }
  .choose {
    display: flex;
    justify-content: space-between;
    width: 100%;
    margin-top: 12px;
    text-align: left;
    background: var(--ga-slot);
  }
  .gallery {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 7px;
    max-height: 340px;
    overflow: auto;
    margin: 12px 0;
  }
  .gallery button {
    padding: 0;
    overflow: hidden;
    text-align: left;
    font-size: 11px;
  }
  .gallery img {
    width: 100%;
    aspect-ratio: 1.6;
    object-fit: cover;
    display: block;
  }
  .gallery span {
    display: block;
    padding: 7px;
  }
  .custom {
    width: 100%;
  }
  label {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 12px;
    margin-top: 12px;
    color: var(--ga-ink-1);
  }
  select {
    margin-left: auto;
    min-width: 120px;
    background: var(--ga-slot);
  }
  input {
    flex: 1;
    min-width: 0;
    appearance: none;
    -webkit-appearance: none;
    background: transparent;
    height: 32px;
  }
  output {
    font-variant-numeric: tabular-nums;
    font-size: 11px;
    width: 32px;
    text-align: right;
  }
  input::-webkit-slider-runnable-track {
    height: 8px;
    border-radius: 3px;
    background:
      repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), var(--ga-line-2) calc(12.5% - 1px) 12.5%),
      linear-gradient(90deg, var(--ga-slider-fill) var(--fill), var(--ga-slot) var(--fill));
  }
  input::-webkit-slider-thumb {
    appearance: none;
    -webkit-appearance: none;
    width: 20px;
    height: 26px;
    margin-top: -9px;
    border: 1px solid #000;
    border-radius: 2px;
    background:
      linear-gradient(var(--ga-slider-fill), var(--ga-slider-fill)) center/10px 2px no-repeat,
      linear-gradient(#46433d, #1b1916);
  }
  input::-moz-range-track {
    height: 8px;
    background: var(--ga-slot);
  }
  input::-moz-range-progress {
    height: 8px;
    background: var(--ga-slider-fill);
  }
  input::-moz-range-thumb {
    width: 20px;
    height: 26px;
    border: 1px solid #000;
    background: var(--ga-hardware-bg);
  }
  p {
    font-size: 11px;
    line-height: 1.5;
    color: var(--ga-ink-2);
    margin: 12px 0;
  }
  footer {
    border-top: 1px solid var(--ga-line-2);
    padding-top: 10px;
    font-size: 11px;
  }
</style>
