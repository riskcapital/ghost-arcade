<script lang="ts">
  /**
   * A panel knob: drag up or down, scroll, or use the arrow keys; double-click
   * returns it to its default. The value is 0-1 unless min and max say otherwise.
   */
  let {
    label,
    value,
    min = 0,
    max = 1,
    defaultValue = min,
    size = 44,
    format = (v: number) => `${Math.round(((v - min) / (max - min)) * 100)}%`,
    onchange,
    title = '',
    midiPath = '',
    hideLabel = false,
  }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    defaultValue?: number;
    size?: number;
    format?: (v: number) => string;
    onchange: (value: number) => void;
    title?: string;
    midiPath?: string;
    /** Keep the label for screen readers but do not print it (a row of identical knobs). */
    hideLabel?: boolean;
  } = $props();

  const span = $derived(max - min);
  const amount = $derived(span > 0 ? Math.max(0, Math.min(1, (value - min) / span)) : 0);
  const angle = $derived(-135 + amount * 270);

  let drag: { y: number; start: number; fine: boolean } | null = null;

  function set(next: number) {
    const clamped = Math.max(min, Math.min(max, next));
    if (clamped !== value) onchange(clamped);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    drag = { y: e.clientY, start: value, fine: e.shiftKey };
  }

  function onPointerMove(e: PointerEvent) {
    if (!drag) return;
    // 160 px of travel covers the whole range; Shift for fine moves.
    const pixels = drag.y - e.clientY;
    set(drag.start + (pixels / (e.shiftKey ? 800 : 160)) * span);
  }

  function onPointerUp() {
    drag = null;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    set(value + (e.deltaY < 0 ? 1 : -1) * span * (e.shiftKey ? 0.005 : 0.03));
  }

  function onKeyDown(e: KeyboardEvent) {
    const step = span * (e.shiftKey ? 0.01 : 0.05);
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - step);
    else if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<div class="knob-wrap" style="--size: {size}px">
  <span class="dial">
  <svg class="arc" viewBox="0 0 40 40" aria-hidden="true">
    <circle class="track" cx="20" cy="20" r="18" pathLength="100" stroke-dasharray="75 100" />
    <circle class="value" cx="20" cy="20" r="18" pathLength="100" stroke-dasharray="{amount * 75} 100" />
  </svg>
  <button
    class="knob"
    role="slider"
    aria-label={label}
    aria-valuemin={min}
    aria-valuemax={max}
    aria-valuenow={value}
    aria-valuetext={format(value)}
    title={title ? `${title} · ${format(value)}` : `${label} ${format(value)}`}
    data-midi-path={midiPath || undefined}
    data-midi-label={midiPath ? label : undefined}
    data-midi-min={midiPath ? min : undefined}
    data-midi-max={midiPath ? max : undefined}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerUp}
    onlostpointercapture={onPointerUp}
    onwheel={onWheel}
    onkeydown={onKeyDown}
    ondblclick={() => set(defaultValue)}
  >
    <span class="pointer" style="transform: rotate({angle}deg)"></span>
  </button>
  </span>
  {#if !hideLabel}<span class="knob-label">{label}</span>{/if}
</div>

<style>
  .knob-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    min-width: calc(var(--size) + 12px);
  }
  /* The value arc rings the knob, so a row of knobs reads at a glance. */
  .dial {
    position: relative;
    width: calc(var(--size) + 10px);
    height: calc(var(--size) + 10px);
    display: grid;
    place-items: center;
  }
  .arc {
    position: absolute;
    inset: 0;
    transform: rotate(135deg);
    pointer-events: none;
  }
  .arc circle { fill: none; stroke-width: 2.4; stroke-linecap: round; }
  .arc .track { stroke: var(--studio-edge-soft); }
  .arc .value { stroke: var(--studio-accent); }
  .knob {
    position: relative;
    width: var(--size);
    height: var(--size);
    padding: 0;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1px solid var(--studio-knob-edge);
    background: var(--studio-knob-face);
    box-shadow: 0 2px 5px rgba(0, 0, 0, 0.5);
    cursor: ns-resize;
    touch-action: none;
  }
  .knob:focus-visible {
    outline: 2px solid var(--studio-accent);
    outline-offset: 3px;
  }
  .pointer {
    position: absolute;
    left: 50%;
    top: 3px;
    width: 2px;
    height: calc(var(--size) * 0.3);
    margin-left: -1px;
    border-radius: 1px;
    background: var(--studio-ink);
    transform-origin: 50% calc(var(--size) / 2 - 4px);
    pointer-events: none;
  }
  .knob-label {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--studio-muted);
    white-space: nowrap;
  }
</style>
