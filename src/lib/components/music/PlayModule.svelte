<script lang="ts">
  /**
   * The keys (or the drum pads), with the voice they play, the octave of the
   * letter keys and how that voice's visuals behave.
   */
  import { PLAYABLE_INSTRUMENTS, noteName, type InstrumentId } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from '../../music/instruments';
  import { KEYBOARD_SIZES, keyboardRange, octaveBaseNote, type KeyboardSize } from '../../music/keyboardLayout';
  import { VOICE_SHADERS } from '../../music/visualScenes';
  import { addStudioVoice } from '../../music/studioTarget';
  import { musicStudio } from '../../music/musicStudioStore';
  import StudioModule from './StudioModule.svelte';
  import PianoKeys from './PianoKeys.svelte';
  import DrumPads from './DrumPads.svelte';

  /**
   * `size`: a fixed keyboard span, or null to offer the size switch.
   * `patches`: offer the synth and keys sounds as well.
   */
  let { size = 'compact', patches = false }: { size?: KeyboardSize | null; patches?: boolean } = $props();

  const s = $derived($musicStudio);
  const visual = $derived(s.visuals[s.instrument]);
  const range = $derived(keyboardRange(size ?? s.keyboardSize, s.octave));

  function setPatch(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    if (s.instrument === 'synth') musicStudio.setSynthPatch(value as SynthPatch);
    else if (s.instrument === 'keys') musicStudio.setKeysPatch(value as KeysPatch);
  }

  function addVisual(e: Event) {
    const el = e.target as HTMLSelectElement;
    // A visual added from the keys follows what they play.
    if (el.value) addStudioVoice(el.value, 'played');
    el.value = '';
  }
</script>

<StudioModule title="Play" class="play">
  {#snippet head()}
    <select value={s.instrument} onchange={(e) => musicStudio.setInstrument((e.target as HTMLSelectElement).value as InstrumentId)} aria-label="What the keys play">
      {#each PLAYABLE_INSTRUMENTS as id}<option value={id}>{INSTRUMENT_LABELS[id]}</option>{/each}
    </select>
    {#if patches && (s.instrument === 'synth' || s.instrument === 'keys')}
      <select value={s.instrument === 'synth' ? s.synthPatch : s.keysPatch} onchange={setPatch} aria-label="Sound">
        {#each s.instrument === 'synth' ? SYNTH_PATCHES : KEYS_PATCHES as patch}<option value={patch.id}>{patch.label}</option>{/each}
      </select>
    {/if}
    {#if s.instrument !== 'drums'}
      {#if size === null}
        <div class="seg small" role="group" aria-label="Keyboard size">
          {#each KEYBOARD_SIZES as option}
            <button class:on={s.keyboardSize === option.id} onclick={() => musicStudio.setKeyboardSize(option.id)} title={option.title}>{option.label}</button>
          {/each}
        </div>
      {/if}
      <div class="stepper" title="Octave of the letter keys (Z / X)">
        <button onclick={() => musicStudio.shiftOctave(-1)} aria-label="Octave down"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3L4.5 6l3 3" /></svg></button>
        <span>{noteName(octaveBaseNote(s.octave))}</span>
        <button onclick={() => musicStudio.shiftOctave(1)} aria-label="Octave up"><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3l3 3-3 3" /></svg></button>
      </div>
    {/if}
  {/snippet}
  <div class="surface">
    {#if s.instrument === 'drums'}
      <DrumPads />
    {:else}
      <PianoKeys low={range.low} high={range.high} />
    {/if}
  </div>
  <div class="foot">
    <div class="seg small" role="group" aria-label="Visual behavior">
      <button class:on={visual.mode === 'fade'} onclick={() => musicStudio.setVisualMode(s.instrument, 'fade')} title="Visuals linger, then fade away">Fade</button>
      <button class:on={visual.mode === 'build'} onclick={() => musicStudio.setVisualMode(s.instrument, 'build')} title="Visuals keep building while you play">Build</button>
    </div>
    <select class="add-visual" value="" aria-label="Add a visual that follows what you play" onchange={addVisual}>
      <option value="" disabled>Add a visual for what you play…</option>
      {#each VOICE_SHADERS as shader (shader.file)}<option value={shader.file}>{shader.name}</option>{/each}
    </select>
  </div>
</StudioModule>

<style>
  .surface { flex: 1; min-height: 56px; display: flex; }
  .foot { display: flex; align-items: center; gap: 8px; }
  .stepper button { display: inline-grid; place-items: center; }
  .stepper svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .add-visual { flex: 1; min-width: 0; height: 22px; }
</style>
