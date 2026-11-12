<script lang="ts">
  /**
   * Analog Synth in the deck tray, condensed: presets, the modules as
   * collapsible sections of knobs, the patch as a list, the input layer and
   * the snapshot pad. "Open the synth" opens the full instrument, where the
   * same patch is made with cables. Every knob answers MIDI learn.
   */
  import './music/studioTokens.css';
  import StudioKnob from './music/StudioKnob.svelte';
  import AnalogPatchBay from './AnalogPatchBay.svelte';
  import AnalogSynthStudio from './AnalogSynthStudio.svelte';
  import {
    INPUT_LAYER_KEY,
    MORPH_KEY,
    MORPHABLE,
    morphValues,
    paramValue,
    presetValues,
    SNAPSHOTS_KEY,
    VIDEOSYNTH_PRESETS,
    type Snapshots,
  } from '../videosynth/patch';
  import { formatParam, knobLabel, paramSpec } from '../videosynth/labels';

  let {
    effectSource,
    layers = [],
    midiPrefix = 'map:plugin',
    onpatch,
  }: {
    effectSource: Record<string, unknown>;
    /** Layers that can be the input (not this one). */
    layers?: { id: string; name: string }[];
    midiPrefix?: string;
    /** `gesture` names a continuous edit (a knob drag, the pad): one undo step. */
    onpatch: (patch: Record<string, unknown>, gesture?: string) => void;
  } = $props();

  /** The full instrument, opened from the tray. */
  let studioOpen = $state(false);

  const val = (key: string) => paramValue(effectSource, paramSpec(key));
  /** The tray has no row legends, so an LFO's rate knob carries its number. */
  function trayLabel(key: string): string {
    const lfo = key.match(/^vsLfo(\d)Rate$/);
    return lfo ? `LFO ${lfo[1]}` : knobLabel(key);
  }

  type Section = { name: string; knobs: string[]; menus: string[] };
  const osc = (n: 'A' | 'B' | 'C'): Section => ({
    name: `Oscillator ${n}`,
    knobs: ['Freq', 'Fine', 'Sync', 'Shape', 'Hue', 'Sat', 'Level'].map((k) => `vs${n}${k}`),
    menus: ['Input', 'ModMode'].map((k) => `vs${n}${k}`),
  });
  const SECTIONS: Section[] = [
    osc('A'),
    osc('B'),
    osc('C'),
    { name: 'Mixer and picture', knobs: ['vsX', 'vsY', 'vsRotate', 'vsScale', 'vsKaleido'], menus: ['vsMix'] },
    { name: 'Feedback', knobs: ['vsFeedback', 'vsFbZoom', 'vsFbRotate', 'vsFbX', 'vsFbY', 'vsFbHue'], menus: [] },
    { name: 'LFOs', knobs: ['vsLfo1Rate', 'vsLfo1Skew', 'vsLfo2Rate', 'vsLfo2Skew', 'vsLfo3Rate', 'vsLfo3Skew'], menus: [] },
    { name: 'Tube', knobs: ['vsScanlines', 'vsBleed', 'vsRoll', 'vsGlow'], menus: [] },
    { name: 'Music', knobs: ['vsReact'], menus: [] },
  ];
  const MENU_LABELS: Record<string, string> = { Input: 'Draws', ModMode: 'Mod mode', vsMix: 'Mixer' };
  const menuLabel = (key: string) => MENU_LABELS[key] ?? MENU_LABELS[key.replace(/^vs[ABC]/, '')] ?? paramSpec(key).label;

  let open = $state<Record<string, boolean>>({ 'Oscillator A': true });

  // ── Presets and randomise ──
  function loadPreset(id: string) {
    if (!id) return;
    onpatch(presetValues(id));
  }
  /** A new patch within ranges that make a picture, not noise. */
  function randomise() {
    const r = (a: number, b: number) => a + Math.random() * (b - a);
    const patch: Record<string, number> = {};
    for (const n of ['A', 'B', 'C']) {
      Object.assign(patch, {
        [`vs${n}Freq`]: r(0.2, 0.7), [`vs${n}Sync`]: r(0.5, 2), [`vs${n}Shape`]: r(0, 1),
        [`vs${n}ModMode`]: Math.floor(r(0, 3)), [`vs${n}Mod`]: r(0, 0.6), [`vs${n}Fm`]: r(0, 0.2),
        [`vs${n}Hue`]: r(0, 1), [`vs${n}Sat`]: r(0.5, 1), [`vs${n}Level`]: r(0.5, 1),
      });
    }
    Object.assign(patch, { vsMix: Math.floor(r(0, 3)), vsFeedback: r(0, 0.85), vsFbZoom: r(0.97, 1.03), vsFbRotate: r(-2, 2), vsKaleido: Math.random() < 0.3 ? Math.floor(r(2, 8)) : 0 });
    onpatch(patch);
  }

  // ── Snapshot pad ──
  const snapshots = $derived<Snapshots>(
    Array.isArray(effectSource[SNAPSHOTS_KEY]) ? (effectSource[SNAPSHOTS_KEY] as Snapshots).slice(0, 4) : [null, null, null, null],
  );
  const morph = $derived.by(() => {
    const m = effectSource[MORPH_KEY];
    return Array.isArray(m) && m.length === 2 ? { x: Number(m[0]) || 0, y: Number(m[1]) || 0 } : { x: 0.5, y: 0.5 };
  });
  const current = () => Object.fromEntries(MORPHABLE().map((p) => [p.key, paramValue(effectSource, p)]));
  function store(corner: number) {
    const next = [0, 1, 2, 3].map((i) => (i === corner ? current() : snapshots[i] ?? null));
    onpatch({ [SNAPSHOTS_KEY]: next });
  }
  function clearCorner(corner: number) {
    onpatch({ [SNAPSHOTS_KEY]: [0, 1, 2, 3].map((i) => (i === corner ? null : snapshots[i] ?? null)) });
  }
  let pad: HTMLDivElement | undefined = $state();
  function movePad(e: PointerEvent) {
    if (!pad) return;
    const r = pad.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    onpatch({ ...morphValues(snapshots, x, y, current()), [MORPH_KEY]: [x, y] }, 'analog-synth-pad');
  }
  function padDown(e: PointerEvent) {
    if (!snapshots.some(Boolean)) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    movePad(e);
  }
  const CORNERS = ['Top left', 'Top right', 'Bottom left', 'Bottom right'];
</script>

{#if studioOpen}
  <AnalogSynthStudio {effectSource} {layers} {midiPrefix} {onpatch} onclose={() => (studioOpen = false)} />
{/if}

<div class="studio-tokens analog-synth">
  <div class="bar">
    <label class="field">
      <span>Preset</span>
      <select value="" onchange={(e) => { loadPreset(e.currentTarget.value); e.currentTarget.value = ''; }}>
        <option value="">Load a preset…</option>
        {#each VIDEOSYNTH_PRESETS as p}
          <option value={p.id}>{p.name}</option>
        {/each}
      </select>
    </label>
    <button class="btn" onclick={randomise} title="A new patch, kept within ranges that make a picture">Randomise</button>
    <button class="btn open" onclick={() => (studioOpen = true)} title="The whole instrument full screen, patched with cables">Open the synth</button>
  </div>

  {#each SECTIONS as section (section.name)}
    <section class="section">
      <button class="section-head" aria-expanded={!!open[section.name]} onclick={() => (open[section.name] = !open[section.name])}>
        <span class="ga-eyebrow">{section.name}</span>
        <span class="chev" aria-hidden="true">{open[section.name] ? '−' : '+'}</span>
      </button>
      {#if open[section.name]}
        {#if section.menus.length}
          <div class="menus">
            {#each section.menus as key (key)}
              {@const p = paramSpec(key)}
              <label class="field">
                <span>{menuLabel(key)}</span>
                <select
                  value={String(val(key))}
                  onchange={(e) => onpatch({ [key]: Number(e.currentTarget.value) })}
                  data-midi-path={`${midiPrefix}:${key}`}
                  data-midi-label={`${section.name} · ${menuLabel(key)}`}
                  data-midi-min={0}
                  data-midi-max={(p.options?.length ?? 1) - 1}
                >
                  {#each p.options ?? [] as label, i}
                    <option value={String(i)}>{label}</option>
                  {/each}
                </select>
              </label>
            {/each}
          </div>
        {/if}
        <div class="knobs">
          {#each section.knobs as key (key)}
            {@const p = paramSpec(key)}
            <StudioKnob
              label={trayLabel(key)}
              title={`${section.name} · ${p.label}`}
              value={val(key)}
              min={p.min}
              max={p.max}
              defaultValue={p.default}
              size={38}
              format={formatParam(p)}
              midiPath={`${midiPrefix}:${key}`}
              onchange={(v) => onpatch({ [key]: p.step === 1 ? Math.round(v) : v }, `analog-synth:${key}`)}
            />
          {/each}
        </div>
      {/if}
    </section>
  {/each}

  <section class="section">
    <button class="section-head" aria-expanded={!!open.Patch} onclick={() => (open.Patch = !open.Patch)}>
      <span class="ga-eyebrow">Patch</span>
      <span class="chev" aria-hidden="true">{open.Patch ? '−' : '+'}</span>
    </button>
    {#if open.Patch}
      <AnalogPatchBay {effectSource} {midiPrefix} {onpatch} />
      <p class="hint">What feeds each input, and how much. Open the synth to patch with cables.</p>
    {/if}
  </section>

  <section class="section">
    <div class="section-head static"><span class="ga-eyebrow">Input</span></div>
    <label class="field">
      <span>Input layer</span>
      <select value={String(effectSource[INPUT_LAYER_KEY] ?? '')} onchange={(e) => onpatch({ [INPUT_LAYER_KEY]: e.currentTarget.value })}>
        <option value="">None</option>
        {#each layers as l (l.id)}
          <option value={l.id}>{l.name}</option>
        {/each}
      </select>
    </label>
    <p class="hint">Any layer, a camera included. An oscillator set to draw the input shows it, coloured by its own colour and saturation; any input can take it.</p>
  </section>

  <section class="section">
    <div class="section-head static"><span class="ga-eyebrow">Snapshots</span></div>
    <div
      class="pad"
      class:empty={!snapshots.some(Boolean)}
      bind:this={pad}
      role="slider"
      tabindex="0"
      aria-label="Blend between the stored snapshots"
      aria-valuetext={`${Math.round(morph.x * 100)}% across, ${Math.round(morph.y * 100)}% down`}
      aria-valuenow={Math.round(morph.x * 100)}
      onpointerdown={padDown}
      onpointermove={(e) => { if (e.buttons & 1 && snapshots.some(Boolean)) movePad(e); }}
    >
      {#each CORNERS as name, i}
        <span class="corner c{i}" class:stored={!!snapshots[i]}>{['1', '2', '3', '4'][i]}</span>
      {/each}
      <span class="dot" style:left={`${morph.x * 100}%`} style:top={`${morph.y * 100}%`}></span>
    </div>
    <div class="corner-buttons">
      {#each CORNERS as name, i}
        <div class="corner-row">
          <span>{i + 1} · {name}</span>
          <button class="btn small" onclick={() => store(i)}>Store</button>
          <button class="btn small" disabled={!snapshots[i]} onclick={() => clearCorner(i)}>Clear</button>
        </div>
      {/each}
    </div>
    <p class="hint">Store the knobs in a corner, then drag across the pad to blend between corners. Menus and the input stay as they are.</p>
  </section>
</div>

<style>
  .analog-synth {
    display: grid;
    gap: 2px;
    padding: 8px 12px 12px;
  }
  .bar {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 8px;
    align-items: end;
    margin-bottom: 6px;
  }
  .section {
    border-top: 1px solid var(--studio-edge-soft);
    padding: 6px 0;
  }
  .section-head {
    display: flex;
    width: 100%;
    justify-content: space-between;
    align-items: center;
    background: none;
    border: 0;
    padding: 4px 0;
    color: var(--studio-muted);
    cursor: pointer;
    font: inherit;
  }
  .section-head.static {
    cursor: default;
  }
  .section-head:focus-visible,
  .btn:focus-visible,
  .pad:focus-visible {
    outline: 2px solid var(--ga-focus, var(--studio-accent));
    outline-offset: 2px;
  }
  .chev {
    color: var(--studio-muted);
    font-size: 14px;
  }
  .knobs {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
    gap: 8px 4px;
    justify-items: center;
    padding: 6px 0 2px;
  }
  .menus {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 8px;
    padding: 4px 0;
  }
  .field {
    display: grid;
    gap: 3px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--studio-muted);
  }
  .field select {
    height: var(--ga-control-h, 26px);
    min-width: 0;
    background: var(--studio-slot);
    color: var(--studio-ink);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
  }
  .btn {
    height: var(--ga-control-h, 26px);
    padding: 0 10px;
    background: var(--studio-cell);
    color: var(--studio-ink-1);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
  }
  .btn:hover:not(:disabled) {
    color: var(--studio-ink);
  }
  .btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .btn.small {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
  }
  .hint {
    margin: 6px 0 0;
    color: var(--studio-muted);
    font-size: var(--ga-text-meta, 11px);
    line-height: 1.45;
  }
  .pad {
    position: relative;
    aspect-ratio: 1;
    max-width: 220px;
    margin: 6px auto 8px;
    background:
      linear-gradient(var(--studio-edge-soft) 1px, transparent 1px) 0 0 / 25% 25%,
      linear-gradient(90deg, var(--studio-edge-soft) 1px, transparent 1px) 0 0 / 25% 25%,
      var(--studio-slot);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    cursor: crosshair;
    touch-action: none;
  }
  .pad.empty {
    cursor: default;
  }
  .corner {
    position: absolute;
    font-size: var(--ga-text-micro, 9px);
    color: var(--studio-muted);
    padding: 4px 6px;
  }
  .corner.stored {
    color: var(--studio-accent);
  }
  .c0 { left: 0; top: 0; }
  .c1 { right: 0; top: 0; }
  .c2 { left: 0; bottom: 0; }
  .c3 { right: 0; bottom: 0; }
  .dot {
    position: absolute;
    width: 12px;
    height: 12px;
    margin: -6px 0 0 -6px;
    border-radius: 50%;
    background: var(--studio-accent);
    pointer-events: none;
  }
  .corner-buttons {
    display: grid;
    gap: 4px;
  }
  .corner-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    gap: 6px;
    align-items: center;
    font-size: var(--ga-text-meta, 11px);
    color: var(--studio-ink-1);
  }
</style>
