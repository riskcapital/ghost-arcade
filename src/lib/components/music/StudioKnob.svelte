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
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
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
  <span class="knob-label">{label}</span>
</div>

<style>
  .knob-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    min-width: calc(var(--size) + 12px);
  }
  .knob {
    position: relative;
    width: var(--size);
    height: var(--size);
    padding: 0;
    box-sizing: border-box;
    border-radius: 50%;
    border: 2px solid var(--studio-knob-edge);
    background: var(--studio-knob-face);
    box-shadow: 0 3px 6px rgba(0, 0, 0, 0.55);
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
    width: 3px;
    height: calc(var(--size) * 0.32);
    margin-left: -1.5px;
    border-radius: 2px;
    background: var(--studio-ink);
    transform-origin: 50% calc(var(--size) / 2 - 5px);
    pointer-events: none;
  }
  .knob-label {
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--studio-ink);
    white-space: nowrap;
  }
</style>
