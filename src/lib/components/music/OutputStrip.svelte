<script lang="ts">
  /**
   * The strip under the live output: the scan synth, which sweeps a line
   * across the picture and plays what it crosses (brighter is louder, higher
   * up is higher pitched), and the layer inputs, so any signal can pulse a
   * deck layer.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { SCAN_PARAMS } from '../../music/studioSets';
  import { SCAN_BARS, scanBars } from '../../music/scanSynth';
  import { setScan } from '../../music/musicRuntime';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  let { layers = true }: { layers?: boolean } = $props();

  const s = $derived($musicStudio);

  const FORMATS: Record<string, (v: number) => string> = {
    'scan.speed': (v) => {
      const bars = scanBars(v);
      return bars === 1 ? '1 bar' : `${bars} bars`;
    },
  };
</script>

<div class="strip" role="group" aria-label="Scan synth and layer inputs">
  <button class="scan-toggle" class:on={s.scanOn} aria-pressed={s.scanOn} onclick={() => setScan(!s.scanOn)} title="Sweep a line across the output and play what it crosses">
    <span class="led" class:on={s.scanOn}></span>
    Scan
  </button>
  <span class="hint">{s.scanOn ? 'Reading the picture' : 'Plays the picture'}</span>
  <div class="knobs">
    {#each SCAN_PARAMS as p (p.key)}
      <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={22} format={FORMATS[p.key]} title="Scan {p.label}" onchange={(v) => musicStudio.setParam(p.key, p.key === 'scan.speed' ? Math.round(v * (SCAN_BARS.length - 1)) / (SCAN_BARS.length - 1) : v)} />
    {/each}
  </div>
  <StudioJack id="cv:scan.level" label="Level" title="How bright the scan line is, as a control signal" />
  <StudioJack id="audio:scan" label="Out" title="Scan synth sound" />
  {#if layers}
    <span class="spacer"></span>
    <span class="ga-eyebrow">Layers</span>
    {#each $vjClipLauncher.layerStates as _, i (i)}
      <StudioJack id="dest:layer:{i}" label="L{i + 1}" title="Pulse layer {i + 1} with a control signal" />
    {/each}
  {/if}
</div>

<style>
  .strip {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    height: 58px;
    box-sizing: border-box;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 12px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .scan-toggle {
    height: var(--ga-control-h, 26px);
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .scan-toggle.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); white-space: nowrap; min-width: 112px; }
  .knobs { display: flex; gap: 12px; }
  .spacer { flex: 1; }
</style>
