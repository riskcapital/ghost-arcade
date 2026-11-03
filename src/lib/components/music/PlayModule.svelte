<script lang="ts">
  /**
   * The keys (or the drum pads), with the voice they play, the octave of the
   * letter keys and how that voice's visuals behave.
   */
  import { PLAYABLE_INSTRUMENTS, noteName, type InstrumentId } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from '../../music/instruments';
  import { KEYBOARD_SIZES, keyboardRange, octaveBaseNote, type KeyboardSize } from '../../music/keyboardLayout';
  import VisualPickButton from './VisualPickButton.svelte';
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
  // Below this the header cannot hold the visual controls beside the instrument.
  let surfaceWidth = $state(1000);
  const narrow = $derived(surfaceWidth < 640);
  let visualOpen = $state(false);
  let visualAt = $state({ x: 0, y: 0 });
  let visualPop = $state<HTMLElement | undefined>();
  /** Fixed to the window, kept on screen: opens above the button when there is no room below. */
  function toggleVisual(button: HTMLElement) {
    visualOpen = !visualOpen;
    if (!visualOpen) return;
    const r = button.getBoundingClientRect();
    visualAt = { x: r.left, y: r.bottom + 4 };
    requestAnimationFrame(() => {
      if (!visualPop) return;
      const w = visualPop.offsetWidth, h = visualPop.offsetHeight;
      visualAt = {
        x: Math.max(8, Math.min(r.left, window.innerWidth - w - 8)),
        y: r.bottom + 4 + h <= window.innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - h - 4),
      };
    });
  }
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

</script>

<StudioModule title="Play" class="play">
  {#snippet head()}
    {#snippet visualControls()}
      <div class="seg small" role="group" aria-label="Visual behavior">
        <button class:on={visual.mode === 'fade'} onclick={() => musicStudio.setVisualMode(s.instrument, 'fade')} title="Visuals linger, then fade away">Fade</button>
        <button class:on={visual.mode === 'build'} onclick={() => musicStudio.setVisualMode(s.instrument, 'build')} title="Visuals keep building while you play">Build</button>
      </div>
      <VisualPickButton file={null} placeholder="Add a visual for what you play…" title="A visual for what you play" onpick={(f) => { visualOpen = false; if (f) addStudioVoice(f, 'played'); }} />
    {/snippet}
    {#if narrow}
      <!-- A narrow column has no room beside the instrument: the visual controls open from here. -->
      <span class="visual-menu">
        <button class="studio-btn" aria-expanded={visualOpen} aria-haspopup="true" onclick={(e) => toggleVisual(e.currentTarget as HTMLElement)} title="What you play draws: fade or build, and the visual it plays">Visual ▾</button>
        {#if visualOpen}<div class="visual-pop" role="group" aria-label="Visual for what you play" style="left: {visualAt.x}px; top: {visualAt.y}px" bind:this={visualPop}>{@render visualControls()}</div>{/if}
      </span>
    {:else}
      <div class="foot">{@render visualControls()}</div>
    {/if}
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
  <div class="surface" bind:clientWidth={surfaceWidth}>
    {#if s.instrument === 'drums'}
      <DrumPads />
    {:else}
      <PianoKeys low={range.low} high={range.high} />
    {/if}
  </div>
</StudioModule>

<svelte:window onpointerdown={(e) => { if (visualOpen && !(e.target as Element).closest?.('.visual-menu')) visualOpen = false; }} onkeydown={(e) => { if (visualOpen && e.key === 'Escape') visualOpen = false; }} />

<style>
  .visual-menu { position: relative; }
  /* The instrument name takes what width is left, so the octave control stays inside the module. */
  .instrument { flex: 1 1 140px; min-width: 36px; width: 0; text-overflow: ellipsis; }
  .visual-pop {
    position: fixed;
    z-index: 100;
    width: 280px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
  }
  .surface { flex: 1; min-height: 56px; display: flex; }
  /* Fade / Build and the visual picker sit in the header, beside the module's name. */
  .foot { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 0 1 260px; }
  .stepper button { display: inline-grid; place-items: center; }
  .stepper svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .add-visual { flex: 1; min-width: 60px; height: 22px; }
</style>
