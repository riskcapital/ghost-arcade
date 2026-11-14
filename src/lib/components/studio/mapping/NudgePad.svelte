<script lang="ts">
  /** Step the selected point (or the whole selection) by output pixels; step through the points. */
  import './mappingPanel.css';
  import { holdRepeat } from '../../../mobile/studio/mappingInteraction';
  import { inPixels } from '../../../mobile/studio/mapping/viewport';
  import type { Point } from '../../../mobile/studio/model';
  import MapIcon from './MapIcon.svelte';

  type Props = {
    /** The selected point, or null when the whole selection moves. */
    at: Point | null;
    label: string;
    points: number;
    index: number;
    disabled?: boolean;
    basis: { width: number; height: number };
    onstart: () => void;
    onnudge: (dx: number, dy: number) => void;
    onpoint: (step: -1 | 1) => void;
  };
  let { at, label, points, index, disabled = false, basis, onstart, onnudge, onpoint }: Props = $props();
  const STEPS = [
    { px: 0.1, label: '0.1 px' },
    { px: 1, label: '1 px' },
    { px: 10, label: '10 px' },
  ];
  let step = $state(1);
  const readout = $derived(at ? inPixels(at, basis) : null);
  const arrows = [
    { x: 0, y: -1, label: 'Nudge up', area: 'up', icon: 'up' },
    { x: -1, y: 0, label: 'Nudge left', area: 'left', icon: 'left' },
    { x: 1, y: 0, label: 'Nudge right', area: 'right', icon: 'right' },
    { x: 0, y: 1, label: 'Nudge down', area: 'down', icon: 'down' },
  ];
</script>

<section class="mp nudge-pad" aria-label="Nudge">
  <div class="mp-head">
    <strong>NUDGE</strong>
    <span class="mp-label">{basis.width} × {basis.height} px</span>
  </div>
  <div class="layout">
    <div class="pad" role="group" aria-label="Nudge direction">
      {#each arrows as a}
        <button style:grid-area={a.area} aria-label={a.label} {disabled} use:holdRepeat={{ start: onstart, step: () => onnudge((a.x * STEPS[step].px) / basis.width, (a.y * STEPS[step].px) / basis.height) }}>
          {#if a.icon === 'up'}<MapIcon name="up" />{:else if a.icon === 'down'}<MapIcon name="down" />{:else}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={a.icon === 'left' ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} /></svg>{/if}
        </button>
      {/each}
      <span class="centre" style:grid-area="mid" aria-hidden="true"><MapIcon name="point" size={16} /></span>
    </div>
    <div class="side">
      <div class="mp-seg" role="group" aria-label="Nudge step">
        {#each STEPS as s, i}<button class:active={step === i} aria-pressed={step === i} onclick={() => (step = i)}>{s.label}</button>{/each}
      </div>
      {#if readout}<p class="readout" aria-live="polite">x {readout.x.toFixed(1)} · y {readout.y.toFixed(1)}</p>{/if}
      <div class="mp-row points">
        <button aria-label="Previous point" disabled={points < 2} onclick={() => onpoint(-1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg></button>
        <span class="mp-label grow">{label}{points > 1 ? ` ${index + 1} of ${points}` : ''}</span>
        <button aria-label="Next point" disabled={points < 2} onclick={() => onpoint(1)}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg></button>
      </div>
    </div>
  </div>
</section>

<style>
  .layout {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .pad {
    display: grid;
    grid-template-areas: '. up .' 'left mid right' '. down .';
    grid-template-columns: repeat(3, 44px);
    grid-template-rows: repeat(3, 44px);
    gap: 2px;
    flex: none;
  }
  .pad button {
    padding: 0;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
  }
  .centre {
    display: grid;
    place-items: center;
    color: var(--ga-ink-1, #9fb0cc);
  }
  .side {
    flex: 1;
    min-width: 0;
  }
  .readout {
    margin: 8px 0 0;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--ga-ink-0, #e8eefc);
  }
  .points {
    flex-wrap: nowrap;
  }
  .points .grow {
    text-align: center;
  }
</style>
