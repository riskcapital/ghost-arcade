<script lang="ts">
  /**
   * MobileMacroBank — 8 touch-friendly macro knobs for the mobile VJ surface.
   *
   * Each macro is rendered as a 56px circular knob with an arc fill. Drag
   * vertically (up = increase) to set the value 0..1 and the desktop
   * dispatches it to all the destinations the macro is wired to. Double-tap
   * a knob to reset to 0. The dest count is shown as a small badge so the
   * performer knows which knobs are wired up.
   *
   * No popover / no rename here — that's a desktop-only concern. Mobile is
   * pure performance surface.
   */
  import { onDestroy, onMount } from 'svelte';

  interface MacroInfo {
    id: string;
    name: string;
    color: string;
    value: number;
    destCount: number;
    pulseMode?: string;
  }

  export let macros: MacroInfo[] = [];
  export let onValueChange: (macroId: string, value: number) => void = () => {};
  export let compact: boolean = false;

  // ── Drag state ──
  // We listen for pointermove/up on `window` once a drag starts so the
  // gesture survives the pointer leaving the 56px knob (the most likely
  // user behavior for a 160px sweep). The earlier per-element handlers
  // + setPointerCapture lost tracking when WS sync re-keyed the {#each}.
  let dragId: string | null = null;
  let dragPointerId: number | null = null;
  let dragStartY = 0;
  let dragStartValue = 0;
  let dragLocalValues: Record<string, number> = {};

  // Double-tap detection (250ms window)
  let lastTapId: string | null = null;
  let lastTapAt = 0;

  function onPointerDown(e: PointerEvent, m: MacroInfo) {
    e.preventDefault();
    e.stopPropagation();
    const now = Date.now();
    if (lastTapId === m.id && now - lastTapAt < 250) {
      // Double-tap → reset
      onValueChange(m.id, 0);
      lastTapId = null;
      return;
    }
    lastTapId = m.id;
    lastTapAt = now;

    dragId = m.id;
    dragPointerId = e.pointerId;
    dragStartY = e.clientY;
    dragStartValue = m.value;
    dragLocalValues[m.id] = m.value;
  }

  function onWindowPointerMove(e: PointerEvent) {
    if (dragId === null) return;
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return; // multi-touch palm guard
    e.preventDefault();
    // 160px = full sweep. Touch is more constrained than mouse so we use
    // a slightly tighter ratio than the desktop's 200px.
    const dy = dragStartY - e.clientY;
    const next = Math.max(0, Math.min(1, dragStartValue + dy / 160));
    dragLocalValues[dragId] = next;
    onValueChange(dragId, next);
  }

  function onWindowPointerUp(e: PointerEvent) {
    if (dragId === null) return;
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
    // Free the per-knob memory as the gesture ends. Without this the
    // record grew without bound across a long set.
    if (dragId !== null) delete dragLocalValues[dragId];
    dragId = null;
    dragPointerId = null;
  }

  function onWindowPointerCancel(e: PointerEvent) {
    if (dragId === null) return;
    if (dragPointerId !== null && e.pointerId !== dragPointerId) return;
    if (dragId !== null) delete dragLocalValues[dragId];
    dragId = null;
    dragPointerId = null;
  }

  // SVG arc path — sweeps from -135° clockwise to value × 270°.
  // largeArc=1 when the swept angle exceeds 180°; for a 270° max sweep
  // that's value > 180/270 = 2/3, NOT 0.5 (the prior threshold rendered
  // the arc the wrong way around the circle for 0.5 < v < 0.667).
  function arcPath(value: number, radius: number, cx: number, cy: number): string {
    const startAngle = (-135 * Math.PI) / 180;
    const endAngle = startAngle + value * (270 * Math.PI) / 180;
    const sx = cx + radius * Math.cos(startAngle);
    const sy = cy + radius * Math.sin(startAngle);
    const ex = cx + radius * Math.cos(endAngle);
    const ey = cy + radius * Math.sin(endAngle);
    const largeArc = value > 2 / 3 ? 1 : 0;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  }

  function getDisplayValue(m: MacroInfo): number {
    return dragId === m.id ? (dragLocalValues[m.id] ?? m.value) : m.value;
  }

  onMount(() => {
    // window-level so the drag continues outside the knob's bounds
    window.addEventListener('pointermove', onWindowPointerMove, { passive: false });
    window.addEventListener('pointerup', onWindowPointerUp);
    window.addEventListener('pointercancel', onWindowPointerCancel);
  });

  onDestroy(() => {
    window.removeEventListener('pointermove', onWindowPointerMove);
    window.removeEventListener('pointerup', onWindowPointerUp);
    window.removeEventListener('pointercancel', onWindowPointerCancel);
    dragLocalValues = {};
  });
</script>

<div class="macro-bank" class:compact>
  <!-- "MACROS" header label removed — was eating ~16px of vertical
       real estate in the new tablet bottom row, pushing the macros
       below the viewport on smaller iPads. Knobs are self-explanatory
       (color-coded with name labels under each). -->
  <div class="knobs">
    {#each macros as m (m.id)}
      {@const v = getDisplayValue(m)}
      {@const r = compact ? 18 : 22}
      {@const size = compact ? 48 : 56}
      {@const c = size / 2}
      <div class="knob-wrap">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="macro-knob"
          class:dragging={dragId === m.id}
          class:has-dest={m.destCount > 0}
          style="--macro-color: {m.color}; width: {size}px; height: {size}px;"
          onpointerdown={(e) => onPointerDown(e, m)}
        >
          <svg class="knob-svg" width={size} height={size} viewBox="0 0 {size} {size}">
            <!-- BG ring -->
            <path
              d={arcPath(1, r, c, c)}
              fill="none"
              stroke="rgba(255, 255, 255, 0.06)"
              stroke-width="3"
              stroke-linecap="round"
            />
            <!-- Value arc -->
            {#if v > 0.001}
              <path
                d={arcPath(v, r, c, c)}
                fill="none"
                stroke="var(--macro-color)"
                stroke-width="3"
                stroke-linecap="round"
                style="filter: drop-shadow(0 0 4px var(--macro-color));"
              />
            {/if}
            <!-- Center dot -->
            <circle cx={c} cy={c} r="3" fill="var(--macro-color)" opacity="0.9"/>
          </svg>
          {#if m.destCount > 0}
            <span class="dest-badge">{m.destCount}</span>
          {/if}
          <span class="knob-value">{Math.round(v * 100)}</span>
        </div>
        <span class="knob-name" title={m.name}>{m.name}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .macro-bank {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    min-width: 0;
  }
  .macro-bank.compact {
    padding: 4px 6px;
    gap: 0;
    background: transparent;
    border: none;
    border-radius: 0;
  }

  .knobs {
    display: flex;
    flex-wrap: nowrap;
    gap: 8px;
    justify-content: flex-start;
    align-items: center;
  }
  .macro-bank.compact .knobs {
    gap: 4px;
    height: 100%;
  }

  .knob-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .macro-knob {
    position: relative;
    border-radius: 50%;
    background: radial-gradient(circle at 30% 30%, rgba(255, 255, 255, 0.06), rgba(0, 0, 0, 0.3));
    border: 1px solid rgba(255, 255, 255, 0.05);
    cursor: ns-resize;
    touch-action: none;
    -webkit-touch-callout: none;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    -webkit-user-select: none;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: box-shadow 0.12s, transform 0.08s;
  }
  .macro-knob.has-dest {
    border-color: rgba(255, 255, 255, 0.12);
  }
  .macro-knob.dragging {
    transform: scale(1.06);
    box-shadow: 0 0 16px var(--macro-color);
  }

  .knob-svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .knob-value {
    position: relative;
    font-size: 10px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    font-variant-numeric: tabular-nums;
    z-index: 1;
    pointer-events: none;
  }

  .dest-badge {
    position: absolute;
    top: -2px;
    right: -2px;
    min-width: 14px;
    height: 14px;
    padding: 0 3px;
    border-radius: 7px;
    background: var(--macro-color);
    color: #000;
    font-size: 9px;
    font-weight: 800;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 0 6px var(--macro-color);
    z-index: 2;
    pointer-events: none;
  }

  .knob-name {
    font-size: 9px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.5);
    text-transform: uppercase;
    letter-spacing: 0.5px;
    text-align: center;
    max-width: 60px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
