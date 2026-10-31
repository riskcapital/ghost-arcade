<script lang="ts">
  /**
   * Sixteen pads for finger and touch drumming: the kit on the bottom two
   * rows (kick bottom left, as on a pad controller) and the set's eight FX
   * pads above, each holding any sound from the library (Sounds chooses
   * them). An atmosphere starts on one press and stops on the next.
   * Velocity comes from pressure where the screen reports it, otherwise
   * from where the pad is hit: higher up is harder. Several fingers play at
   * once. Note repeat keeps a held pad playing on the beat grid, and Rec
   * records the pads into the beat grid as they are played.
   */
  import { DRUM_LABELS, DRUM_NOTES, type DrumVoice } from '../../music/noteEvents';
  import { DRUM_PAD_KEYS, PIANO_KEY_LABELS } from '../../music/keyboardLayout';
  import { SHOT_NAMES } from '../../music/dubSounds';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { REPEAT_RATES, padDown, padUp, toggleLoopRecord, type PadSound } from '../../music/musicRuntime';
  import { SHOT_PARAMS } from '../../music/studioSets';
  import { soundById, soundGroups } from '../../music/sounds/library';
  import { isChopId } from '../../music/sounds/chops';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  /** `drums`: the kit's two rows under the FX pads (off: the FX pads alone). */
  let { title = 'Pads', drums = true }: { title?: string; drums?: boolean } = $props();

  interface Pad {
    sound: PadSound;
    label: string;
    held: string;
    key?: string;
  }

  const kit = (voice: DrumVoice): Pad => {
    const i = (['kick', 'snare', 'clap', 'hatClosed', 'hatOpen', 'tom', 'rim', 'crash'] as DrumVoice[]).indexOf(voice);
    return { sound: { kind: 'drum', voice }, label: DRUM_LABELS[voice], held: `drums:${DRUM_NOTES[voice]}`, key: PIANO_KEY_LABELS[DRUM_PAD_KEYS[i]] };
  };
  const shot = (index: number): Pad => ({ sound: { kind: 'shot', index }, label: SHOT_NAMES[index], held: `shots:${60 + index}` });

  /** Top row first. */
  const ALL_PADS: Pad[] = [
    shot(4), shot(5), shot(6), shot(7),
    shot(0), shot(1), shot(2), shot(3),
    kit('hatClosed'), kit('hatOpen'), kit('tom'), kit('crash'),
    kit('kick'), kit('snare'), kit('clap'), kit('rim'),
  ];
  const PADS = $derived(drums ? ALL_PADS : ALL_PADS.slice(0, 8));

  /** The sound on an FX pad in the current set. */
  const padSound = (index: number) => soundById(s.fxPads[s.set][index]);
  const groups = soundGroups();
  let choosing = $state(false);

  let full = $state(false);
  let repeat = $state(false);
  let rate = $state<(typeof REPEAT_RATES)[number]['id']>('1/16');
  let pressed = $state<Record<number, number>>({});

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);
  const recording = $derived(t.loopRec.phase !== 'off');

  function velocityFor(e: PointerEvent, el: HTMLElement): number {
    if (full) return 1;
    // Pens and pressure screens report a real pressure; mice report 0.5 while down.
    if (e.pointerType !== 'mouse' && e.pressure > 0 && e.pressure !== 0.5) return Math.max(0.15, Math.min(1, 0.2 + e.pressure * 0.8));
    const rect = el.getBoundingClientRect();
    const y = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    return Math.max(0.25, Math.min(1, 1.05 - y * 0.8));
  }

  function down(e: PointerEvent, index: number) {
    if (choosing && PADS[index].sound.kind === 'shot') return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture?.(e.pointerId);
    const velocity = velocityFor(e, el);
    pressed = { ...pressed, [e.pointerId]: index };
    padDown(e.pointerId, PADS[index].sound, velocity, repeat ? (REPEAT_RATES.find((r) => r.id === rate)?.beats ?? 0) : 0);
  }

  function up(e: PointerEvent) {
    if (!(e.pointerId in pressed)) return;
    const next = { ...pressed };
    delete next[e.pointerId];
    pressed = next;
    padUp(e.pointerId);
  }

  const isDown = (index: number) => Object.values(pressed).includes(index);
</script>

<StudioModule {title} led={drums && recording}>
  {#snippet head()}
    {#if drums}
    <button class="loop-rec" class:on={recording} class:count={t.loopRec.phase === 'count'} onclick={toggleLoopRecord} aria-pressed={recording} title={recording ? 'Stop recording on the next bar' : 'Record into the beat from the next bar'}>
      <span class="dot"></span>Rec
    </button>
    <button class="studio-btn" class:on={full} aria-pressed={full} onclick={() => (full = !full)} title="Every hit at full velocity">Full</button>
    <button class="studio-btn" class:on={repeat} aria-pressed={repeat} onclick={() => (repeat = !repeat)} title="Hold a pad to repeat it on the beat">Repeat</button>
    <select bind:value={rate} disabled={!repeat} aria-label="Repeat rate">
      {#each REPEAT_RATES as r}<option value={r.id}>{r.id}</option>{/each}
    </select>
    {/if}
    <button class="studio-btn" class:on={choosing} aria-pressed={choosing} onclick={() => (choosing = !choosing)} title="Choose the sound on each FX pad">Sounds</button>
  {/snippet}
  <div class="pads" class:short={!drums} title={choosing ? 'Tap an FX pad to choose its sound' : 'Higher on a pad hits harder. Rec writes the pads into the beat.'}>
    {#each PADS as pad, i (pad.held)}
      {@const fx = pad.sound.kind === 'shot' ? padSound(pad.sound.index) : undefined}
      {@const label = pad.sound.kind === 'shot' ? (fx?.name ?? SHOT_NAMES[pad.sound.index] ?? 'Empty') : pad.label}
      <button
        class="pad"
        class:kit={pad.sound.kind === 'drum'}
        class:choosing={choosing && pad.sound.kind === 'shot'}
        class:lit={t.held.has(pad.held) || isDown(i)}
        onpointerdown={(e) => down(e, i)}
        onpointerup={up}
        onpointercancel={up}
        onlostpointercapture={up}
        aria-label={label}
        title={fx?.blurb ?? ''}
        data-midi-path={pad.sound.kind === 'shot' ? `studio:pad.${pad.sound.index + 1}` : undefined}
        data-midi-label={pad.sound.kind === 'shot' ? `FX pad ${pad.sound.index + 1}` : undefined}
      >
        <span class="label">{label}</span>
        {#if fx?.kind === 'loop'}
          <svg class="loop" viewBox="0 0 16 16" aria-label="Plays until pressed again"><path d="M4 5h6a3 3 0 0 1 0 6H6M4 5l2-2M4 5l2 2" /></svg>
        {/if}
        {#if pad.key}<kbd>{pad.key}</kbd>{/if}
        {#if choosing && pad.sound.kind === 'shot'}
          {@const index = pad.sound.index}
          <select
            class="choose"
            value={s.fxPads[s.set][index]}
            onchange={(e) => musicStudio.setFxPad(index, (e.target as HTMLSelectElement).value)}
            aria-label="Sound on pad {i + 1}"
          >
            {#if isChopId(s.fxPads[s.set][index])}
              <!-- A slice of the band looper is not in the library: keep it chosen until another sound is. -->
              <option value={s.fxPads[s.set][index]}>{fx?.name ?? 'Chop'}</option>
            {/if}
            {#each groups as group (group.category)}
              <optgroup label={group.label}>
                {#each group.sounds as sound (sound.id)}<option value={sound.id}>{sound.name}</option>{/each}
              </optgroup>
            {/each}
          </select>
        {/if}
      </button>
    {/each}
  </div>
  {#if choosing}
    <div class="knob-row">
      {#each SHOT_PARAMS as p (p.key)}
        <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={26} onchange={(v) => musicStudio.setParam(p.key, v)} />
      {/each}
    </div>
  {/if}
</StudioModule>

<style>
  .pads {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    grid-auto-rows: minmax(0, 1fr);
    gap: 5px;
  }
  .pad {
    position: relative;
    min-width: 0;
    min-height: 0;
    padding: 4px 6px;
    display: flex;
    align-items: flex-start;
    overflow: hidden;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-cell);
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    text-align: left;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    transition: background-color 60ms linear, border-color 60ms linear;
  }
  .pad.kit { background: var(--studio-slot); color: var(--studio-ink); border-color: var(--studio-edge); }
  .label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; pointer-events: none; }
  kbd { position: absolute; right: 5px; bottom: 3px; font-family: var(--ga-font-mono, ui-monospace); font-size: 9px; color: var(--studio-muted); pointer-events: none; }
  .pad.lit { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); transition: none; }
  .pad.lit kbd { color: var(--studio-on-accent); }
  .pads.short { min-height: 76px; }
  .loop { position: absolute; right: 4px; top: 4px; width: 11px; height: 11px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; opacity: 0.8; pointer-events: none; }
  .pad.choosing { border-style: dashed; border-color: var(--studio-accent); color: var(--studio-ink); }
  /* An invisible menu over the pad: tapping it opens the sound list. */
  .choose { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; }
  .knob-row { display: flex; justify-content: space-around; padding-top: 6px; }
</style>
