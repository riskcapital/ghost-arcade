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
  import { TONES, TONE_FAMILY_LABELS, type ToneFamily } from '../../music/tone/tones';
  import { insertEditorChannel } from '../../music/studioUi';
  import StudioModule from './StudioModule.svelte';
  import StudioJack from './StudioJack.svelte';
  import PianoKeys from './PianoKeys.svelte';
  import DrumPads from './DrumPads.svelte';

  /**
   * `size`: a fixed keyboard span, or null to offer the size switch.
   * `patches`: kept for callers; every sound is in the Instrument menu now.
   */
  let { size = 'compact', patches = false }: { size?: KeyboardSize | null; patches?: boolean } = $props();

  const s = $derived($musicStudio);
  const visual = $derived(s.visuals[s.instrument]);
  const range = $derived(keyboardRange(size ?? s.keyboardSize, s.octave));

  const FAMILIES: ToneFamily[] = ['bass', 'pad', 'lead'];

  /** Other instruments than the synth and keys, which list their own sounds. */
  const OTHERS = PLAYABLE_INSTRUMENTS.filter((id) => id !== 'synth' && id !== 'keys');

  /** What the keys play now, as the Instrument menu shows it. */
  const current = $derived(
    s.instrument === 'synth'
      ? s.synthTone ? `tone:${s.synthTone}` : `synth:${s.synthPatch}`
      : s.instrument === 'keys'
        ? s.keysTone ? `tone:${s.keysTone}` : `keys:${s.keysPatch}`
        : `inst:${s.instrument}`,
  );

  /** One menu for whatever the keys play: any instrument, any synth or keys sound, any tone. */
  function choose(e: Event) {
    const [kind, id] = (e.target as HTMLSelectElement).value.split(/:(.*)/);
    if (kind === 'inst') musicStudio.setInstrument(id as InstrumentId);
    else if (kind === 'synth') {
      musicStudio.setInstrument('synth');
      musicStudio.setSynthPatch(id as SynthPatch);
    } else if (kind === 'keys') {
      musicStudio.setInstrument('keys');
      musicStudio.setKeysPatch(id as KeysPatch);
    } else if (kind === 'tone') {
      musicStudio.setInstrument('synth');
      musicStudio.setTone('synth', id);
    }
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
    <select class="instrument" value={current} onchange={choose} aria-label="Instrument the keys play" title={TONES.find((t) => current === `tone:${t.id}`)?.blurb ?? 'What the keys play, whatever the set'}>
      <optgroup label="Synth">
        {#each SYNTH_PATCHES as p (p.id)}<option value="synth:{p.id}">Synth · {p.label}</option>{/each}
      </optgroup>
      <optgroup label="Keys">
        {#each KEYS_PATCHES as p (p.id)}<option value="keys:{p.id}">Keys · {p.label}</option>{/each}
      </optgroup>
      <optgroup label="Instruments">
        {#each OTHERS as id (id)}<option value="inst:{id}">{INSTRUMENT_LABELS[id]}</option>{/each}
      </optgroup>
      {#each FAMILIES as fam (fam)}
        <optgroup label={TONE_FAMILY_LABELS[fam]}>
          {#each TONES.filter((t) => t.family === fam) as t (t.id)}<option value="tone:{t.id}" title={t.blurb}>{t.name}</option>{/each}
        </optgroup>
      {/each}
    </select>
    <StudioJack id="cv:keys.level" label="" title="How loud the keys are playing, as a control signal for visuals and macros" />
    <button class="fx-btn studio-btn" class:on={(s.inserts[s.instrument]?.length ?? 0) > 0} onclick={() => insertEditorChannel.set($insertEditorChannel === s.instrument ? null : s.instrument)} title="Effects on what the keys play">FX{s.inserts[s.instrument]?.length ? ` ${s.inserts[s.instrument].length}` : ''}</button>
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
</StudioModule>

<style>
  .surface { flex: 1; min-height: 56px; display: flex; }
  /* Fade / Build and the visual picker sit in the header, beside the module's name. */
  .foot { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 1 260px; }
  .stepper button { display: inline-grid; place-items: center; }
  .stepper svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .add-visual { flex: 1; min-width: 60px; height: 22px; }
</style>
