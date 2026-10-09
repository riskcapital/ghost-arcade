<script lang="ts">
  /**
   * The Flux XY surface, laid over the program picture: the performer plays the effect on the
   * image itself. Across changes character, up is more intense. A second finger (its height) or
   * Pencil pressure adds Energy. With "stay on" off, lifting the finger releases the effect.
   */
  import { onDestroy } from 'svelte';
  import type { FluxState } from '../../mobile/studio/flux';

  export let value: FluxState;
  export let onchange: (state: FluxState) => void;

  let pointer: number | null = null;
  let expressionPointer: number | null = null;
  const unit = (n: number) => Math.max(0, Math.min(1, n));

  function patch(p: Partial<FluxState>) { value = { ...value, ...p }; onchange(value); }
  function box(e: PointerEvent) { return (e.currentTarget as HTMLElement).getBoundingClientRect(); }
  function energy(e: PointerEvent) { const r = box(e); patch({ energy: unit(1 - (e.clientY - r.top) / r.height) }); }
  function position(e: PointerEvent) {
    const r = box(e);
    patch({ x: unit((e.clientX - r.left) / r.width), y: unit(1 - (e.clientY - r.top) / r.height), active: true, ...(e.pointerType === 'pen' ? { energy: e.pressure } : {}) });
  }
  function down(e: PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    if (pointer !== null) {
      if (expressionPointer === null) { expressionPointer = e.pointerId; el.setPointerCapture(e.pointerId); energy(e); }
      return;
    }
    e.preventDefault();
    pointer = e.pointerId;
    el.setPointerCapture(e.pointerId);
    position(e);
  }
  function move(e: PointerEvent) {
    if (pointer === e.pointerId) position(e);
    else if (expressionPointer === e.pointerId) energy(e);
  }
  function release() { pointer = null; expressionPointer = null; if (!value.latch) patch({ active: false }); }
  function lift(e: PointerEvent) {
    if (e.pointerId === expressionPointer) { expressionPointer = null; return; }
    if (e.pointerId === pointer) release();
  }
  function key(e: KeyboardEvent) {
    const d = 0.03;
    if (e.key === 'Escape') { pointer = null; expressionPointer = null; patch({ active: false, latch: false }); return; }
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    patch({ x: unit(value.x + (e.key === 'ArrowRight' ? d : e.key === 'ArrowLeft' ? -d : 0)), y: unit(value.y + (e.key === 'ArrowUp' ? d : e.key === 'ArrowDown' ? -d : 0)), active: true });
  }
  onDestroy(() => { if (!value.latch && value.active) onchange({ ...value, active: false }); });
</script>

<div
  class="flux-pad"
  class:playing={value.active}
  data-flux-pad
  role="application"
  aria-label="Flux pad on the picture. Left and right change the character, up is more intense. Arrow keys move, Escape releases."
  aria-roledescription="XY pad"
  tabindex="0"
  onpointerdown={down}
  onpointermove={move}
  onpointerup={lift}
  onpointercancel={lift}
  onlostpointercapture={lift}
  onkeydown={key}
  onkeyup={(e) => { if (e.key.startsWith('Arrow') && !value.latch) release(); }}
  onblur={() => { if (!value.latch && pointer === null && value.active) release(); }}
>
  <div class="cross-x" style={`left:${value.x * 100}%`}></div>
  <div class="cross-y" style={`bottom:${value.y * 100}%`}></div>
  <div class="cursor" style={`left:${value.x * 100}%;bottom:${value.y * 100}%`}></div>
  {#if !value.active}<span class="invitation">{value.modules.length ? 'Touch the picture to play' : 'Choose a module below'}</span>{/if}
</div>

<style>
  .flux-pad { position: absolute; inset: 0; z-index: 4; touch-action: none; user-select: none; -webkit-user-select: none; overflow: hidden; cursor: crosshair; border-radius: inherit; }
  .flux-pad:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: -2px; }
  .cross-x, .cross-y { position: absolute; background: var(--ga-blue-a45); pointer-events: none; opacity: .55; }
  .cross-x { width: 1px; top: 0; bottom: 0; }
  .cross-y { height: 1px; left: 0; right: 0; }
  .playing .cross-x, .playing .cross-y { opacity: 1; }
  .cursor {
    position: absolute; width: 28px; height: 28px; border-radius: 50%; transform: translate(-50%, 50%); pointer-events: none;
    border: 2px solid var(--ga-blue-200); background: var(--ga-blue-a45); box-shadow: 0 0 0 1px #0008, 0 0 0 8px var(--ga-blue-a16);
  }
  .playing .cursor { background: var(--ga-blue-a70); box-shadow: 0 0 0 1px #0008, 0 0 0 12px var(--ga-blue-a28), 0 0 30px var(--ga-blue-a45); }
  .invitation {
    position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); padding: 5px 12px; border-radius: 14px; white-space: nowrap;
    background: #000a; font-size: 13px; color: var(--ga-ink-0); pointer-events: none;
  }
</style>
