<script lang="ts">
  /**
   * A long-throw desk fader: a recessed slot, a ribbed cap with a centre
   * line, and a dB scale printed beside it with unity marked. Drag to move,
   * shift-drag for fine moves, the wheel nudges, a double-click goes back to
   * unity, and the arrow keys step.
   */
  import { FADER_MARKS, dbToGain, dbToPosition, gainToDb, positionToDb } from '../../music/faderScale';

  let { label, gain, onchange, midiPath = '' }: { label: string; gain: number; onchange: (gain: number) => void; midiPath?: string } = $props();

  let track = $state<HTMLElement | null>(null);
  const pos = $derived(dbToPosition(gainToDb(gain)));
  let drag: { y: number; pos: number } | null = null;

  function setPos(p: number) {
    const next = Math.max(0, Math.min(1, p));
    // A hair of snap at unity, so 0 dB is easy to find by hand.
    const db = positionToDb(next);
    onchange(Math.abs(db) < 0.35 ? 1 : dbToGain(db));
  }

  function down(e: PointerEvent) {
    if (e.button !== 0 || !track) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = track.getBoundingClientRect();
    const onCap = (e.target as HTMLElement).classList.contains('cap');
    // Grabbing the cap keeps it where it is; clicking the slot jumps there.
    if (!onCap) setPos(1 - (e.clientY - r.top) / r.height);
    drag = { y: e.clientY, pos: onCap ? pos : 1 - (e.clientY - r.top) / r.height };
  }

  function move(e: PointerEvent) {
    if (!drag || !track) return;
    const h = track.getBoundingClientRect().height;
    const scale = e.shiftKey ? 0.15 : 1;
    setPos(drag.pos - ((e.clientY - drag.y) / h) * scale);
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    setPos(pos - Math.sign(e.deltaY) * (e.shiftKey ? 0.004 : 0.02));
  }

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.004 : 0.02;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') setPos(pos + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') setPos(pos - step);
    else if (e.key === 'Home') onchange(1);
    else return;
    e.preventDefault();
  }
</script>

<div class="fader" data-midi-path={midiPath || undefined} data-midi-label={midiPath ? label : undefined}>
  <div class="scale" aria-hidden="true">
    {#each FADER_MARKS as m (m.label)}
      <span class="mark" class:unity={m.db === 0} style="bottom: {dbToPosition(m.db) * 100}%">{m.label}<i></i></span>
    {/each}
  </div>
  <div
    class="track"
    bind:this={track}
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={-100}
    aria-valuemax={10}
    aria-valuenow={Math.round(gainToDb(gain))}
    aria-valuetext="{gainToDb(gain) === -Infinity ? 'off' : `${gainToDb(gain).toFixed(1)} dB`}"
    onpointerdown={down}
    onpointermove={move}
    onpointerup={() => (drag = null)}
    onpointercancel={() => (drag = null)}
    ondblclick={() => onchange(1)}
    onwheel={wheel}
    onkeydown={key}
    title="{label}: drag (shift for fine), wheel to nudge, double-click for 0 dB"
  >
    <span class="slot"></span>
    <span class="cap" style="bottom: calc({pos * 100}% - 13px)"></span>
  </div>
</div>

<style>
  .fader { flex: 1; min-height: 0; display: flex; gap: 2px; }
  .scale { position: relative; width: 22px; margin: 13px 0; }
  .mark { position: absolute; right: 0; transform: translateY(50%); display: flex; align-items: center; gap: 2px; font-family: var(--ga-font-mono, ui-monospace); font-size: 8px; line-height: 1; color: var(--studio-muted); }
  .mark i { display: block; width: 4px; height: 1px; background: currentColor; }
  .mark.unity { color: var(--studio-ink); font-weight: 700; }
  .mark.unity i { width: 6px; }
  .track { position: relative; width: 26px; cursor: ns-resize; touch-action: none; outline: none; }
  .track:focus-visible .cap { box-shadow: 0 0 0 2px var(--studio-accent); }
  /* The slot: recessed, darker in the middle. */
  .slot {
    position: absolute;
    left: 50%;
    top: 13px;
    bottom: 13px;
    width: 6px;
    transform: translateX(-50%);
    border-radius: 3px;
    background: var(--studio-slot, #050608);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.8), 0 1px 0 rgba(255, 255, 255, 0.05);
  }
  /* The cap: a ribbed block with a bright centre line. */
  .cap {
    position: absolute;
    left: 0;
    width: 26px;
    height: 26px;
    border-radius: 3px;
    background:
      linear-gradient(var(--studio-ink), var(--studio-ink)) center / 100% 2px no-repeat,
      repeating-linear-gradient(180deg, rgba(255, 255, 255, 0.16) 0 1px, transparent 1px 4px),
      linear-gradient(180deg, color-mix(in srgb, var(--studio-cell) 60%, #fff 12%), var(--studio-cell));
    border: 1px solid var(--studio-edge);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.12);
    cursor: grab;
  }
</style>
