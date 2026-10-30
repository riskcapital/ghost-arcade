<script lang="ts">
  /** A vertical channel fader: drag the cap, scroll, or use the arrow keys; double-click resets. */
  let {
    label,
    value,
    defaultValue = 0.8,
    onchange,
  }: { label: string; value: number; defaultValue?: number; onchange: (value: number) => void } = $props();

  let track = $state<HTMLElement | null>(null);
  let dragging = false;

  function set(v: number) {
    const next = Math.max(0, Math.min(1, v));
    if (next !== value) onchange(next);
  }

  function fromPointer(e: PointerEvent) {
    if (!track) return;
    const r = track.getBoundingClientRect();
    set(1 - (e.clientY - r.top) / r.height);
  }

  function down(e: PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    dragging = true;
    fromPointer(e);
  }

  function key(e: KeyboardEvent) {
    const step = e.shiftKey ? 0.01 : 0.05;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(value + step);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(value - step);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }
</script>

<button
  class="fader"
  role="slider"
  aria-label={label}
  aria-orientation="vertical"
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={Math.round(value * 100)}
  title="{label} {Math.round(value * 100)}%"
  onpointerdown={down}
  onpointermove={(e) => dragging && fromPointer(e)}
  onpointerup={() => (dragging = false)}
  onpointercancel={() => (dragging = false)}
  onwheel={(e) => { e.preventDefault(); set(value + (e.deltaY < 0 ? 0.03 : -0.03)); }}
  onkeydown={key}
  ondblclick={() => set(defaultValue)}
>
  <span class="track" bind:this={track}>
    <span class="fill" style="height: {value * 100}%"></span>
    <span class="cap" style="bottom: {value * 100}%"></span>
  </span>
</button>

<style>
  .fader {
    flex: 1;
    min-height: 60px;
    width: 30px;
    padding: 6px 0;
    border: 0;
    background: transparent;
    cursor: ns-resize;
    touch-action: none;
    display: flex;
    justify-content: center;
  }
  .fader:focus-visible { outline: 2px solid var(--studio-accent); outline-offset: 2px; }
  .track {
    position: relative;
    width: 6px;
    height: 100%;
    background: var(--studio-slot);
    border: 1px solid var(--studio-edge);
    border-radius: 2px;
  }
  .fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--studio-edge); pointer-events: none; }
  .cap {
    position: absolute;
    left: 50%;
    width: 24px;
    height: 12px;
    margin: 0 0 -6px -12px;
    background: linear-gradient(#e6ebf7, #aab6d6);
    border: 1px solid #000;
    border-radius: 2px;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.6), inset 0 -2px 0 rgba(0, 0, 0, 0.25);
    pointer-events: none;
  }
</style>
