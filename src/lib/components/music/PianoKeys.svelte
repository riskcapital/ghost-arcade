<script lang="ts">
  /**
   * On-screen piano: press, slide across keys, several fingers at once.
   * Keys the letter keyboard plays show their letter; held notes light up
   * whichever input is holding them.
   */
  import { isBlackKey, noteName } from '../../music/noteEvents';
  import { PIANO_KEY_LABELS, keyForNote } from '../../music/keyboardLayout';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { screenNoteOff, screenNoteOn } from '../../music/musicRuntime';

  let { low, high }: { low: number; high: number } = $props();

  const notes = $derived(Array.from({ length: high - low + 1 }, (_, i) => low + i));
  const whites = $derived(notes.filter((n) => !isBlackKey(n)));
  const blacks = $derived(notes.filter(isBlackKey));
  const blackWidth = $derived((100 / whites.length) * 0.62);
  const instrument = $derived($musicStudio.instrument);
  const octave = $derived($musicStudio.octave);

  function lit(note: number): boolean {
    return $musicTransport.held.has(`${instrument}:${note}`);
  }

  function label(note: number): string {
    const code = keyForNote(note, octave);
    return code ? PIANO_KEY_LABELS[code] : '';
  }

  /** Left edge of a black key, between the white keys either side. */
  function blackLeft(note: number): number {
    return (whites.filter((n) => n < note).length / whites.length) * 100;
  }

  function noteUnder(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const n = el?.closest<HTMLElement>('[data-note]')?.dataset.note;
    return n === undefined ? null : Number(n);
  }

  const pressed = new Map<number, number>();

  function down(e: PointerEvent) {
    const note = noteUnder(e);
    if (note === null) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pressed.set(e.pointerId, note);
    screenNoteOn(e.pointerId, note);
  }

  function move(e: PointerEvent) {
    if (!pressed.has(e.pointerId)) return;
    const note = noteUnder(e);
    if (note === null || note === pressed.get(e.pointerId)) return;
    pressed.set(e.pointerId, note);
    screenNoteOn(e.pointerId, note);
  }

  function up(e: PointerEvent) {
    if (!pressed.has(e.pointerId)) return;
    pressed.delete(e.pointerId);
    screenNoteOff(e.pointerId);
  }
</script>

<div class="piano" role="group" aria-label="On-screen keys" style="--black-w: {blackWidth}%"
  onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up}>
  {#each whites as note (note)}
    <div class="white" class:lit={lit(note)} data-note={note}>
      <kbd>{label(note)}</kbd>
      {#if note % 12 === 0}<span class="c">{noteName(note)}</span>{/if}
    </div>
  {/each}
  {#each blacks as note (note)}
    <div class="black" class:lit={lit(note)} data-note={note} style="left: calc({blackLeft(note)}% - var(--black-w) / 2)">
      <kbd>{label(note)}</kbd>
    </div>
  {/each}
</div>

<style>
  .piano {
    position: relative;
    flex: 1;
    min-height: 96px;
    display: flex;
    touch-action: none;
    user-select: none;
  }
  .white {
    flex: 1;
    min-width: 0;
    position: relative;
    margin-right: 1px;
    border-radius: 0 0 3px 3px;
    background: var(--mk-white, #d9dce2);
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-bottom: 6px;
    gap: 2px;
  }
  /* Pressed white keys darken toward the accent; the accent can be near white. */
  .white.lit { background: color-mix(in srgb, var(--mk-accent, var(--ga-coral, #ff6f5e)) 45%, #2a313c); }
  .black {
    position: absolute;
    top: 0;
    width: var(--black-w);
    height: 60%;
    border-radius: 0 0 3px 3px;
    background: var(--mk-black, #15181e);
    border: 1px solid #000;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    padding-bottom: 5px;
    z-index: 1;
  }
  .black.lit {
    background: var(--mk-accent, var(--ga-coral, #ff6f5e));
    border-color: var(--mk-accent, var(--ga-coral, #ff6f5e));
  }
  kbd {
    font-family: inherit;
    font-size: 10px;
    font-weight: 700;
    pointer-events: none;
  }
  .white kbd { color: #5e6571; }
  .black kbd { color: #9aa0ac; }
  .c { color: #8a909c; font-size: 9px; pointer-events: none; }
  .white.lit kbd, .white.lit .c { color: #fff; }
  .black.lit kbd { color: #0b0d11; }
</style>
