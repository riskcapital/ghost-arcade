<script lang="ts">
  /**
   * The studio's visuals: the voices of the Music Studio instance it plays
   * to (a studio clip in a VJ cell, or a mapping layer showing the studio).
   * Each voice shows which visual it is, which sound it follows and its main
   * controls; open it for the rest. Scenes load a whole stack at once. With
   * no instance yet, one is put on the deck (or the selected layer).
   */
  import { onDestroy } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { STUDIO_SETS } from '../../music/studioSets';
  import { VOICE_SOURCES, isVoiceDrivenInput, type VoiceSourceId } from '../../music/visualVoices';
  import { VISUAL_SCENES, VOICE_SHADERS, shaderInputs, voiceShaderByFile, type ShaderInput } from '../../music/visualScenes';
  import { MAX_STUDIO_VOICES, studioCodeTick, studioRenderInputs, studioVoiceCode, type StudioVoice } from '../../music/studioPlugin';
  import {
    addStudioVoice,
    loadSceneIntoStudio,
    placeStudio,
    removeStudioVoice,
    replaceStudioVoice,
    setStudioVoice,
    studioTarget,
  } from '../../music/studioTarget';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  /** Main controls shown on each voice; the rest open under it. */
  const MAIN_CONTROLS = 4;
  const LOOK_SKIP = new Set(['vxSource', 'vxAuto', 'ink', 'accent']);

  const s = $derived($musicStudio);
  const target = $derived($studioTarget);
  const voices = $derived(target?.source.musicVoices ?? []);
  let open = $state<number | null>(null);
  let activity = $state<number[]>([]);
  let codeTick = $state(0);

  const familyLabel = (id: string) => STUDIO_SETS.find((set) => set.id === id)?.label ?? id;
  const families = STUDIO_SETS.map((set) => ({ id: set.id, label: set.label, voices: VOICE_SHADERS.filter((v) => v.family === set.id) }));
  const ownScenes = $derived(VISUAL_SCENES.filter((sc) => sc.set === s.set));
  const otherScenes = $derived(VISUAL_SCENES.filter((sc) => sc.set !== s.set));

  const where = $derived(
    !target ? '' : target.kind === 'vj' ? `Deck ${target.deck}, row ${target.layer + 1}${target.playing ? '' : ' (stopped)'}` : `Layer: ${target.name}`,
  );

  function looks(file: string): ShaderInput[] {
    void codeTick;
    const code = studioVoiceCode(file);
    return code ? shaderInputs(code).filter((i) => (i.TYPE === 'float' || i.TYPE === 'long') && !LOOK_SKIP.has(i.NAME) && !isVoiceDrivenInput(i.NAME)) : [];
  }

  // How strongly each voice's sound plays now, for its light.
  let frame = 0;
  function tick() {
    const next = voices.map((v) => {
      const d = studioRenderInputs.driven(v.source, v.auto);
      return Math.min(1, (0.25 + 0.75 * (d.vxEnv ?? 0)) * (d.vxPresence ?? 1));
    });
    // Only repaint the lights when one has visibly changed.
    if (next.length !== activity.length || next.some((a, i) => Math.abs(a - activity[i]) > 0.01)) activity = next;
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  const unsub = studioCodeTick.subscribe((n) => (codeTick = n));
  onDestroy(() => {
    cancelAnimationFrame(frame);
    unsub();
  });

  function pickScene(e: Event) {
    const el = e.target as HTMLSelectElement;
    const scene = VISUAL_SCENES.find((sc) => sc.id === el.value);
    el.value = '';
    // A scene loads in the studio's own palette.
    if (scene) loadSceneIntoStudio({ ...scene, set: s.set });
  }

  /** A new instance starts with this set's first scene, in its palette. */
  function putInPlace() {
    if (!placeStudio()) return;
    const scene = VISUAL_SCENES.find((sc) => sc.set === s.set);
    if (scene) loadSceneIntoStudio(scene);
  }

  function addVoice() {
    const first = VOICE_SHADERS.find((v) => v.family === s.set) ?? VOICE_SHADERS[0];
    if (addStudioVoice(first.file, 'all')) open = voices.length;
  }

  const numberOf = (voice: StudioVoice, input: ShaderInput) => Number(voice.params[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0);
  const levelFormat = (v: number) => `${Math.round(v * 100)}%`;
  const valueFormat = (input: ShaderInput) => (v: number) => {
    const min = input.MIN ?? 0;
    const max = input.MAX ?? 1;
    return max - min > 4 ? String(Math.round(v)) : `${Math.round(((v - min) / (max - min || 1)) * 100)}%`;
  };
</script>

{#snippet knob(i: number, voice: StudioVoice, input: ShaderInput)}
  <StudioKnob
    label={input.LABEL ?? input.NAME}
    title={input.LABEL ?? input.NAME}
    value={numberOf(voice, input)}
    min={input.MIN ?? 0}
    max={input.MAX ?? 1}
    defaultValue={Number(input.DEFAULT ?? input.MIN ?? 0)}
    size={20}
    format={valueFormat(input)}
    onchange={(v) => setStudioVoice(i, { params: { [input.NAME]: input.TYPE === 'long' || (input.MAX ?? 1) - (input.MIN ?? 0) > 4 ? Math.round(v) : v } }, `voice:${i}:${input.NAME}`)}
  />
{/snippet}

<StudioModule title="Visuals" subtitle={where} grow>
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
  {#if !target}
    <div class="none">
      <p>The studio's visuals play in a Music Studio clip, so they never take over your deck rows. Drag Music Studio from Plugins onto a cell, or put one here.</p>
      <button class="studio-btn" onclick={putInPlace}>{$vjClipLauncher.isOpen ? 'Put it on the deck' : 'Show it on the selected layer'}</button>
    </div>
  {:else}
    <div class="voices">
      {#each voices as voice, i (i)}
        {@const all = looks(voice.file)}
        <div class="voice">
          <div class="line">
            <span class="led" class:on={voice.level > 0} style="--a: {activity[i] ?? 0}" aria-hidden="true"></span>
            <select class="pick" value={voice.file} onchange={(e) => replaceStudioVoice(i, (e.target as HTMLSelectElement).value)} aria-label="Voice {i + 1}" title={voiceShaderByFile(voice.file)?.blurb ?? ''}>
              {#each families as fam (fam.id)}
                <optgroup label={fam.label}>
                  {#each fam.voices as v (v.file)}<option value={v.file} title={v.blurb}>{v.name}</option>{/each}
                </optgroup>
              {/each}
            </select>
            <select class="follows" value={voice.source} onchange={(e) => setStudioVoice(i, { source: (e.target as HTMLSelectElement).value as VoiceSourceId })} aria-label="Sound voice {i + 1} follows" title="The sound this voice follows">
              {#each VOICE_SOURCES as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
            </select>
            <button class="auto studio-btn" class:on={voice.auto} onclick={() => setStudioVoice(i, { auto: !voice.auto })} aria-pressed={voice.auto} title={voice.auto ? 'Shows only while its sound plays' : 'Always shows'}>Auto</button>
            <button class="icon" onclick={() => removeStudioVoice(i)} aria-label="Remove voice {i + 1}" title="Remove this voice">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
            </button>
          </div>
          <div class="controls">
            {#each all.slice(0, MAIN_CONTROLS) as input (input.NAME)}{@render knob(i, voice, input)}{/each}
            <StudioKnob label="Level" title="How much of this voice shows" value={voice.level} defaultValue={1} size={20} format={levelFormat} onchange={(v) => setStudioVoice(i, { level: v }, `voice:${i}:level`)} />
            {#if all.length > MAIN_CONTROLS}
              <button class="icon more" class:on={open === i} onclick={() => (open = open === i ? null : i)} aria-expanded={open === i} aria-label="All controls for voice {i + 1}" title="All controls">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d={open === i ? 'M3 7.5L6 4.5 9 7.5' : 'M3 4.5L6 7.5 9 4.5'} /></svg>
              </button>
            {/if}
          </div>
          {#if open === i}
            <div class="all">
              {#each all.slice(MAIN_CONTROLS) as input (input.NAME)}{@render knob(i, voice, input)}{/each}
            </div>
          {/if}
        </div>
      {/each}
      {#if voices.length < MAX_STUDIO_VOICES}
        <button class="add studio-btn dashed" onclick={addVoice} title="Add a voice to this studio">+ Voice</button>
      {/if}
    </div>
  {/if}
</StudioModule>

<style>
  .voices { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .voice { padding: 4px 0; border-bottom: 1px solid var(--studio-edge-soft); }
  .voice:last-of-type { border-bottom: 0; }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .led {
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    border: 1px solid var(--studio-edge);
  }
  .led.on {
    border-color: var(--studio-accent);
    background: color-mix(in srgb, var(--studio-accent) calc(25% + var(--a) * 75%), transparent);
    box-shadow: 0 0 calc(var(--a) * 8px) var(--studio-accent);
  }
  .pick { flex: 1 1 0; min-width: 0; }
  .follows { flex: 1 1 0; min-width: 0; color: var(--studio-muted); }
  .line .auto { flex: 0 0 auto; padding: 0 7px; font-size: var(--ga-text-meta, 11px); }
  .line .auto:not(.on) { color: var(--studio-muted); }
  .controls { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; padding: 3px 0 0 15px; }
  .controls :global(.knob-wrap), .all :global(.knob-wrap) { gap: 1px; min-width: 0; flex: 1 1 0; }
  .all :global(.knob-wrap) { flex: 0 0 52px; }
  .controls :global(.knob-label), .all :global(.knob-label) { max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  .icon {
    flex: 0 0 auto;
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
  .more { align-self: center; }
  .icon svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .icon.on, .icon:hover { color: var(--studio-ink); border-color: var(--studio-edge); }
  .all { display: flex; flex-wrap: wrap; gap: 8px 6px; padding: 8px 0 2px 15px; }
  .add { align-self: flex-start; margin-top: 6px; }
  .none { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 4px 2px; }
  .none p { margin: 0; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--studio-muted); }
</style>
