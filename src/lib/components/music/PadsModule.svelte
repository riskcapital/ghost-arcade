<script lang="ts">
  /**
   * Sixteen pads for finger and touch drumming: the kit on the bottom two
   * rows (kick bottom left, as on a pad controller) and the shots above.
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
  import StudioModule from './StudioModule.svelte';

  let { title = 'Pads' }: { title?: string } = $props();

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
  const PADS: Pad[] = [
    shot(4), shot(5), shot(6), shot(7),
    shot(0), shot(1), shot(2), shot(3),
    kit('hatClosed'), kit('hatOpen'), kit('tom'), kit('crash'),
    kit('kick'), kit('snare'), kit('clap'), kit('rim'),
  ];

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

<StudioModule {title} led={recording}>
  {#snippet head()}
    <button class="loop-rec" class:on={recording} class:count={t.loopRec.phase === 'count'} onclick={toggleLoopRecord} aria-pressed={recording} title={recording ? 'Stop recording on the next bar' : 'Record into the beat from the next bar'}>
      <span class="dot"></span>Rec
    </button>
    <button class="studio-btn" class:on={full} aria-pressed={full} onclick={() => (full = !full)} title="Every hit at full velocity">Full</button>
    <button class="studio-btn" class:on={repeat} aria-pressed={repeat} onclick={() => (repeat = !repeat)} title="Hold a pad to repeat it on the beat">Repeat</button>
    <select bind:value={rate} disabled={!repeat} aria-label="Repeat rate">
      {#each REPEAT_RATES as r}<option value={r.id}>{r.id}</option>{/each}
    </select>
  {/snippet}
  <div class="pads" title="Higher on a pad hits harder. Rec writes the pads into the beat.">
    {#each PADS as pad, i (pad.held)}
      <button
        class="pad"
        class:kit={pad.sound.kind === 'drum'}
        class:lit={t.held.has(pad.held) || isDown(i)}
        onpointerdown={(e) => down(e, i)}
        onpointerup={up}
        onpointercancel={up}
        onlostpointercapture={up}
        aria-label={pad.label}
      >
        <span class="label">{pad.label}</span>
        {#if pad.key}<kbd>{pad.key}</kbd>{/if}
      </button>
    {/each}
  </div>
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
</style>
