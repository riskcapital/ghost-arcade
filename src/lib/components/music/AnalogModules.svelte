<script lang="ts">
  /**
   * The analog set's semi-modular synth: two oscillators, a mixer, a
   * resonant filter, an envelope and an LFO, with a patch bay. The envelope
   * is normalled to the filter and the amp, so it plays with no cables; a
   * cable from the bay re-routes a signal inside the synth, or out to a
   * layer or a macro so the same signal moves the picture.
   */
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { ANALOG_PARAMS } from '../../music/studioSets';
  import { WAVE_LABELS } from '../../music/analogSynth';
  import { loadAnalogPatch } from '../../music/jams';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  /** `bay`: show the patch bay (the tray leaves patching to the Studio view). */
  let { bay = true }: { bay?: boolean } = $props();

  const s = $derived($musicStudio);
  const sounding = $derived([...$musicTransport.held].some((k) => k.startsWith('analog:')));

  const def = (key: string) => ANALOG_PARAMS.find((p) => p.key === `analog.${key}`)!;

  const hz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`);
  const FORMATS: Record<string, (v: number) => string> = {
    wave1: (v) => WAVE_LABELS[Math.round(v * 3)],
    wave2: (v) => WAVE_LABELS[Math.round(v * 3)],
    tune1: (v) => `${Math.round((v - 0.5) * 24)} st`,
    tune2: (v) => `${Math.round((v - 0.5) * 24)} st`,
    cutoff: (v) => hz(40 * Math.pow(400, v)),
    lforate: (v) => `${(0.05 * Math.pow(400, v)).toFixed(2)} Hz`,
  };

  /** Each section is two rows of knobs, read left to right. */
  const SECTIONS: Array<{ name: string; rows: string[][] }> = [
    { name: 'VCO 1', rows: [['wave1'], ['tune1']] },
    { name: 'VCO 2', rows: [['wave2'], ['tune2']] },
    { name: 'MIX', rows: [['mix2', 'sub'], ['noise', 'glide']] },
    { name: 'FILTER', rows: [['cutoff', 'reso'], ['envamt', 'drive']] },
    { name: 'ENVELOPE', rows: [['attack', 'decay'], ['sustain', 'release']] },
    { name: 'LFO', rows: [['lforate'], ['lfodepth']] },
  ];

  const LABELS: Record<string, string> = { wave1: 'Wave', wave2: 'Wave', tune1: 'Tune', tune2: 'Tune', lforate: 'Rate', lfodepth: 'Depth' };
</script>

<StudioModule title="ANALOG" subtitle="Envelope normalled to filter and amp · patch to re-route, or out to the picture" led={sounding}>
  {#snippet head()}
    <button class="load" onclick={() => void loadAnalogPatch()} title="A first patch: the LFO sweeps the filter and two note visuals follow the envelope and the LFO">LOAD PATCH</button>
  {/snippet}
  <div class="synth">
    {#each SECTIONS as section (section.name)}
      <div class="section">
        <span class="section-name">{section.name}</span>
        <div class="knobs">
          {#each section.rows as row, ri (ri)}
            <div class="row">
              {#each row as key (key)}
                {@const p = def(key)}
                <StudioKnob
                  label={LABELS[key] ?? p.label}
                  title="{section.name} {LABELS[key] ?? p.label}"
                  value={s.params[p.key]}
                  defaultValue={p.default}
                  size={key === 'cutoff' ? 42 : 36}
                  format={FORMATS[key]}
                  onchange={(v) => musicStudio.setParam(p.key, key.startsWith('wave') ? Math.round(v * 3) / 3 : v)}
                />
              {/each}
            </div>
          {/each}
        </div>
      </div>
    {/each}
    {#if bay}
    <div class="section bay">
      <span class="section-name">PATCH</span>
      <div class="bay-grid">
        <span class="row-name">OUT</span>
        <StudioJack id="cv:analog.lfo" label="LFO" title="LFO out" />
        <StudioJack id="cv:analog.env" label="Env" title="Envelope out" />
        <StudioJack id="cv:analog.vco2" label="VCO 2" title="VCO 2 out: into Pitch for FM" />
        <StudioJack id="cv:analog.level" label="Level" title="How loud the synth is, as a control signal" />
        <span class="row-name">IN</span>
        <StudioJack id="dest:analog.cutoff" label="Cutoff" title="Filter cutoff in" />
        <StudioJack id="dest:analog.pitch" label="Pitch" title="Pitch in" />
        <StudioJack id="dest:analog.amp" label="Amp" title="Amp in" />
        <StudioJack id="audio:analog" label="Audio" title="Synth sound out" />
      </div>
    </div>
    {/if}
  </div>
</StudioModule>

<style>
  .synth { flex: 1; min-height: 0; display: flex; }
  .section {
    flex: 1 1 auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 12px;
    border-left: 1px solid var(--studio-edge-soft);
  }
  .section:first-child { padding-left: 0; border-left: 0; }
  .section-name { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: var(--studio-accent); }
  .knobs { flex: 1; display: flex; flex-direction: column; justify-content: space-between; }
  .row { display: flex; justify-content: space-around; gap: 6px; }
  .bay { flex: 0 0 auto; padding-right: 0; }
  .bay-grid {
    flex: 1;
    display: grid;
    grid-template-columns: auto repeat(4, 44px);
    align-items: center;
    justify-items: center;
    row-gap: 10px;
    padding: 6px 10px;
    background: var(--studio-slot);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .row-name { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: var(--studio-muted); justify-self: start; padding-right: 6px; }
  .load {
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--studio-accent);
    background: var(--studio-accent-soft);
    color: var(--studio-accent);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
</style>
