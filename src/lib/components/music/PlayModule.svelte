<script lang="ts">
  /**
   * The keys (or the drum pads), with the voice they play, the octave of the
   * letter keys and how that voice's visuals behave.
   */
  import { PLAYABLE_INSTRUMENTS, noteName, type InstrumentId } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from '../../music/instruments';
  import { KEYBOARD_SIZES, keyboardRange, octaveBaseNote, type KeyboardSize } from '../../music/keyboardLayout';
  import { NOTE_SHADERS, addNoteShaderToDeck } from '../../music/noteShaders';
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
    const shader = NOTE_SHADERS.find((n) => n.file === el.value);
    if (shader) void addNoteShaderToDeck(shader.file, shader.name);
    el.value = '';
  }
</script>

<StudioModule title="PLAY" class="play">
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
        <button onclick={() => musicStudio.shiftOctave(-1)} aria-label="Octave down">‹</button>
        <span>{noteName(octaveBaseNote(s.octave))}</span>
        <button onclick={() => musicStudio.shiftOctave(1)} aria-label="Octave up">›</button>
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
    <div class="seg small" role="group" aria-label="Visual behaviour">
      <button class:on={visual.mode === 'fade'} onclick={() => musicStudio.setVisualMode(s.instrument, 'fade')} title="Visuals linger, then fade away">Fade</button>
      <button class:on={visual.mode === 'build'} onclick={() => musicStudio.setVisualMode(s.instrument, 'build')} title="Visuals keep building while you play">Build</button>
    </div>
    <select class="add-visual" value="" aria-label="Add a note-reactive visual to the deck" onchange={addVisual}>
      <option value="" disabled>Add a note visual…</option>
      {#each NOTE_SHADERS as shader}<option value={shader.file}>{shader.name}</option>{/each}
    </select>
  </div>
</StudioModule>

<style>
  .surface { flex: 1; min-height: 56px; display: flex; }
  .foot { display: flex; align-items: center; gap: 8px; }
  .add-visual { flex: 1; min-width: 0; height: 22px; }
</style>
