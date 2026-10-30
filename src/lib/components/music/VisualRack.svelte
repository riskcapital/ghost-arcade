<script lang="ts">
  /**
   * The visual voices on deck A, one per row. A row
   * shows which visual plays there, which sound it follows and its main
   * controls; open it for every control and its colours. Scenes load a
   * whole stack at once. Each row keeps a jack, so any signal can still
   * pulse the layer.
   */
  import { onDestroy } from 'svelte';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { musicStudio } from '../../music/musicStudioStore';
  import { STUDIO_SETS } from '../../music/studioSets';
  import { isNoteDrivenInput } from '../../music/noteVisuals';
  import {
    VOICE_AUTO_INPUT,
    VOICE_SOURCES,
    VOICE_SOURCE_INPUT,
    isVoiceDrivenInput,
    voiceSourceAt,
    voiceSourceIndex,
    type VoiceSourceId,
  } from '../../music/visualVoices';
  import {
    VISUAL_SCENES,
    VOICE_SHADERS,
    loadVisualScene,
    loadVoice,
    setVoiceValue,
    shaderInputs,
    voiceShaderByFile,
    type ShaderInput,
  } from '../../music/visualScenes';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  /** Main controls shown on each row; the rest open under it. */
  const MAIN_CONTROLS = 4;

  const s = $derived($musicStudio);
  const deck = $derived($vjClipLauncher);
  let open = $state<number | null>(null);
  let activity = $state<number[]>([]);

  const familyLabel = (id: string) => STUDIO_SETS.find((set) => set.id === id)?.label ?? id;
  const families = $derived(STUDIO_SETS.map((set) => ({ id: set.id, label: set.label, voices: VOICE_SHADERS.filter((v) => v.family === set.id) })));
  const ownScenes = $derived(VISUAL_SCENES.filter((sc) => sc.set === s.set));
  const otherScenes = $derived(VISUAL_SCENES.filter((sc) => sc.set !== s.set));

  interface Row {
    file: string | null;
    name: string;
    voice: boolean;
    source: VoiceSourceId;
    auto: boolean;
    looks: ShaderInput[];
    colors: ShaderInput[];
    values: Record<string, unknown>;
  }

  const rows = $derived(
    deck.layerStates.map((state): Row => {
      const clip = state.activeClip;
      const code = clip?.type === 'shader' ? clip.shaderCode : undefined;
      const inputs = code ? shaderInputs(code) : [];
      const voice = inputs.some((i) => i.NAME === VOICE_SOURCE_INPUT);
      const values = (clip?.shaderValues ?? {}) as Record<string, unknown>;
      const value = (input: ShaderInput | undefined) => (input ? values[input.NAME] ?? input.DEFAULT : undefined);
      const file = clip?.src?.startsWith('ISF/') ? clip.src.slice(4) : null;
      return {
        file,
        name: clip?.name ?? '',
        voice,
        source: voiceSourceAt(value(inputs.find((i) => i.NAME === VOICE_SOURCE_INPUT))),
        auto: Boolean(value(inputs.find((i) => i.NAME === VOICE_AUTO_INPUT)) ?? true),
        looks: inputs.filter((i) => (i.TYPE === 'float' || i.TYPE === 'long') && i.NAME !== VOICE_SOURCE_INPUT && !isVoiceDrivenInput(i.NAME) && !isNoteDrivenInput(i.NAME) && i.NAME !== 'noteMode'),
        colors: inputs.filter((i) => i.TYPE === 'color'),
        values,
      };
    }),
  );

  // How strongly each row's sound is playing, read from the values the studio writes every frame.
  let frame = 0;
  function tick() {
    const states = $vjClipLauncher.layerStates;
    activity = states.map((st) => {
      const v = st.activeClip?.shaderValues as Record<string, number> | undefined;
      if (!v || v.vxPresence === undefined) return 0;
      return Math.min(1, (0.25 + 0.75 * (v.vxEnv ?? 0)) * (v.vxPresence ?? 1));
    });
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  onDestroy(() => cancelAnimationFrame(frame));

  async function pickVoice(layer: number, file: string) {
    if (!file) {
      vjClipLauncher.stopLayer(layer, 'A');
      return;
    }
    const row = rows[layer];
    const shader = voiceShaderByFile(file);
    if (!shader) return;
    // A row keeps following the same sound when its visual changes; a new
    // row follows the sound the visual was drawn for.
    await loadVoice(layer, { file, source: row?.voice ? row.source : undefined }, s.set);
  }

  function pickScene(e: Event) {
    const el = e.target as HTMLSelectElement;
    const scene = VISUAL_SCENES.find((sc) => sc.id === el.value);
    el.value = '';
    if (scene) void loadVisualScene({ ...scene, set: s.set });
  }

  const numberOf = (row: Row, input: ShaderInput) => Number(row.values[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0);

  const hex = (c: unknown) => {
    const rgb = Array.isArray(c) ? c : [1, 1, 1];
    return `#${rgb.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, Number(x))) * 255).toString(16).padStart(2, '0')).join('')}`;
  };
  const fromHex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).concat(1);

  const levelFormat = (v: number) => `${Math.round(v * 100)}%`;
  const valueFormat = (input: ShaderInput) => (v: number) => {
    const min = input.MIN ?? 0;
    const max = input.MAX ?? 1;
    return max - min > 4 ? String(Math.round(v)) : `${Math.round(((v - min) / (max - min || 1)) * 100)}%`;
  };
</script>

{#snippet knob(i: number, row: Row, input: ShaderInput)}
  <StudioKnob
    label={input.LABEL ?? input.NAME}
    title={input.LABEL ?? input.NAME}
    value={numberOf(row, input)}
    min={input.MIN ?? 0}
    max={input.MAX ?? 1}
    defaultValue={Number(input.DEFAULT ?? input.MIN ?? 0)}
    size={20}
    format={valueFormat(input)}
    onchange={(v) => setVoiceValue(i, input.NAME, input.TYPE === 'long' || (input.MAX ?? 1) - (input.MIN ?? 0) > 4 ? Math.round(v) : v)}
  />
{/snippet}

<StudioModule title="Visuals" grow>
  {#snippet head()}
    <select class="scene" value="" onchange={pickScene} aria-label="Load a visual scene" title="Load a stack of voices for this set">
      <option value="" disabled>Load scene…</option>
      {#each ownScenes as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
      {#if otherScenes.length}
        <optgroup label="Other sets">
          {#each otherScenes as sc (sc.id)}<option value={sc.id}>{familyLabel(sc.set)} · {sc.name}</option>{/each}
        </optgroup>
      {/if}
    </select>
  {/snippet}
  <div class="voices">
    {#each rows as row, i (i)}
      {@const layer = deck.layerStates[i]}
      <div class="voice" class:muted={layer.mute} class:empty={!row.file}>
        <div class="line">
          <button class="led" class:on={!layer.mute && !!row.file} style="--a: {layer.mute ? 0 : activity[i] ?? 0}" onclick={() => vjClipLauncher.toggleLayerMute(i, 'A')} aria-pressed={!layer.mute} aria-label="Row {i + 1} on" title={layer.mute ? 'Show this row' : 'Hide this row'}></button>
          <span class="num">{i + 1}</span>
          <select class="pick" value={row.voice ? row.file ?? '' : ''} onchange={(e) => void pickVoice(i, (e.target as HTMLSelectElement).value)} aria-label="Visual on row {i + 1}">
            <option value="">{row.file && !row.voice ? row.name : 'Empty'}</option>
            {#each families as fam (fam.id)}
              <optgroup label={fam.label}>
                {#each fam.voices as v (v.file)}<option value={v.file} title={v.blurb}>{v.name}</option>{/each}
              </optgroup>
            {/each}
          </select>
          <select class="follows" value={voiceSourceIndex(row.source)} disabled={!row.voice} onchange={(e) => setVoiceValue(i, VOICE_SOURCE_INPUT, +(e.target as HTMLSelectElement).value)} aria-label="Sound row {i + 1} follows" title="The sound this visual follows">
            {#each VOICE_SOURCES as src, si}<option value={si}>{src.label}</option>{/each}
          </select>
          <button class="auto studio-btn" class:on={row.voice && row.auto} disabled={!row.voice} onclick={() => setVoiceValue(i, VOICE_AUTO_INPUT, !row.auto)} aria-pressed={row.auto} title={row.auto ? 'Shows only while its sound plays' : 'Always shows'}>Auto</button>
          <StudioJack id="dest:layer:{i}" title="Pulse row {i + 1} with a control signal" />
        </div>
        {#if row.voice}
          <div class="controls">
            {#each row.looks.slice(0, MAIN_CONTROLS) as input (input.NAME)}{@render knob(i, row, input)}{/each}
            <StudioKnob label="Level" title="How much of this row shows" value={layer.opacity} defaultValue={1} size={20} format={levelFormat} onchange={(v) => vjClipLauncher.setLayerOpacity(i, v, 'A')} />
            <button class="more" class:on={open === i} onclick={() => (open = open === i ? null : i)} aria-expanded={open === i} aria-label="All controls for row {i + 1}" title="All controls and colors">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d={open === i ? 'M3 7.5L6 4.5 9 7.5' : 'M3 4.5L6 7.5 9 4.5'} /></svg>
            </button>
          </div>
          {#if open === i}
            <div class="all">
              {#each row.looks.slice(MAIN_CONTROLS) as input (input.NAME)}{@render knob(i, row, input)}{/each}
              {#each row.colors as input (input.NAME)}
                <label class="swatch" title={input.LABEL ?? input.NAME}>
                  <input type="color" value={hex(row.values[input.NAME] ?? input.DEFAULT)} oninput={(e) => setVoiceValue(i, input.NAME, fromHex((e.target as HTMLInputElement).value))} />
                  <span class="ga-eyebrow legend">{input.LABEL ?? input.NAME}</span>
                </label>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/each}
    {#if deck.layerStates.length < 8}
      <button class="add studio-btn dashed" onclick={() => vjClipLauncher.addLayer()} title="Add a row to deck A">+ Row</button>
    {/if}
  </div>
</StudioModule>

<style>
  .voices { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .voice { padding: 4px 0; border-bottom: 1px solid var(--studio-edge-soft); }
  .voice:last-of-type { border-bottom: 0; }
  .voice.muted .controls, .voice.muted .pick { opacity: 0.45; }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .led {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--studio-edge);
    background: transparent;
    cursor: pointer;
  }
  .led.on {
    border-color: var(--studio-accent);
    background: color-mix(in srgb, var(--studio-accent) calc(25% + var(--a) * 75%), transparent);
    box-shadow: 0 0 calc(var(--a) * 8px) var(--studio-accent);
  }
  .num { flex: 0 0 12px; font-family: var(--ga-font-mono, ui-monospace); font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); text-align: center; }
  .pick { flex: 1 1 0; min-width: 0; }
  .follows { flex: 1 1 0; min-width: 0; color: var(--studio-muted); }
  .follows:disabled, .auto:disabled { opacity: 0.4; }
  .line .auto { flex: 0 0 auto; padding: 0 7px; font-size: var(--ga-text-meta, 11px); }
  .line .auto:not(.on) { color: var(--studio-muted); }
  .controls { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; padding: 3px 0 0 21px; }
  .controls :global(.knob-wrap), .all :global(.knob-wrap) { gap: 1px; min-width: 0; flex: 1 1 0; }
  .all :global(.knob-wrap) { flex: 0 0 52px; }
  /* Long control names stay on one line under their knob. */
  .controls :global(.knob-label), .all :global(.knob-label) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .more {
    align-self: center;
    width: 22px;
    height: 22px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--studio-edge-soft);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .more svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .more.on, .more:hover { color: var(--studio-ink); border-color: var(--studio-edge); }
  .all { display: flex; flex-wrap: wrap; gap: 8px 6px; padding: 8px 0 2px 21px; }
  .swatch { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; cursor: pointer; }
  .swatch input { width: 30px; height: 24px; padding: 0; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); background: transparent; cursor: pointer; }
  .add { align-self: flex-start; margin-top: 6px; }
</style>
