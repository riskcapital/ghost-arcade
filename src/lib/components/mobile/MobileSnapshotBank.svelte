<script lang="ts">
  /**
   * MobileSnapshotBank — 16-pad live snapshot recall for the mobile VJ
   * surface. Each pad represents one of the 16 snapshot slots from the
   * desktop store. Tap a populated pad to recall it. Long-press (or
   * shift-tap when on iPad with a keyboard) saves the current state into
   * that slot.
   *
   * Pads are color-coded to match the desktop bank so muscle memory carries
   * over between hardware controllers, the desktop UI, and the mobile UI.
   *
   * Mobile is recall-only by default — destructive actions like rename and
   * clear stay on the desktop where you can be careful with them.
   */

  interface SnapshotInfo {
    id: string;
    slot: number;
    name: string;
    color: string;
    populated: boolean;
  }

  export let snapshots: SnapshotInfo[] = [];
  export let activeId: string | null = null;
  export let onRecall: (index: number) => void = () => {};
  export let onSave: (index: number) => void = () => {};
  export let compact: boolean = false;
  /** Single-row dense layout — used at the very top of the tablet
   *  controller. Drops the header chrome and puts all 16 pads on one
   *  short row so the row is ~36px tall. */
  export let topRow: boolean = false;

  // Long-press detection for save-on-hold (600ms)
  // We track press start coords + a movement threshold so dragging
  // off the pad cancels the save (intent: user changed their mind).
  // Without the move-threshold check, holding then dragging then
  // releasing back over the pad still fired the save AND the recall.
  let pressId: string | null = null;
  let pressTimeoutId: ReturnType<typeof setTimeout> | null = null;
  let saveFiredFor: string | null = null;
  let pressStartX = 0;
  let pressStartY = 0;
  const MOVE_CANCEL_PX = 10;

  function clearPressTimer() {
    if (pressTimeoutId) {
      clearTimeout(pressTimeoutId);
      pressTimeoutId = null;
    }
  }

  function handlePointerDown(e: PointerEvent, snap: SnapshotInfo, idx: number) {
    e.preventDefault();
    pressId = snap.id;
    saveFiredFor = null;
    pressStartX = e.clientX;
    pressStartY = e.clientY;

    clearPressTimer();
    pressTimeoutId = setTimeout(() => {
      // Long-press → save snapshot
      if (pressId === snap.id) {
        onSave(idx);
        saveFiredFor = snap.id;
        // Haptic feedback on iOS Safari (no-op elsewhere)
        try { (navigator as any).vibrate?.(40); } catch { /* ignore */ }
      }
    }, 600);
  }

  function handlePointerMove(e: PointerEvent, snap: SnapshotInfo) {
    if (pressId !== snap.id) return;
    const dx = e.clientX - pressStartX;
    const dy = e.clientY - pressStartY;
    if (dx * dx + dy * dy > MOVE_CANCEL_PX * MOVE_CANCEL_PX) {
      // Moved too far — cancel the long-press timer; the upcoming
      // pointerup won't fire recall either since pressId is cleared.
      clearPressTimer();
      pressId = null;
    }
  }

  function handlePointerUp(e: PointerEvent, snap: SnapshotInfo, idx: number) {
    clearPressTimer();
    if (pressId !== snap.id) return;
    pressId = null;
    // If we already fired the save (long-press), don't also recall
    if (saveFiredFor === snap.id) {
      saveFiredFor = null;
      return;
    }
    if (snap.populated) {
      onRecall(idx);
    } else if (e.shiftKey) {
      // iPad with hardware keyboard: shift-tap to save into empty slot
      onSave(idx);
    }
  }

  function handlePointerCancel() {
    clearPressTimer();
    pressId = null;
  }
</script>

<div class="snap-bank" class:compact class:top-row={topRow}>
  {#if !topRow}
    <div class="bank-header">
      <span class="bank-label">SNAPS</span>
      <span class="bank-hint">tap recall · hold save</span>
    </div>
  {/if}
  <div class="snap-grid">
    {#each snapshots as snap, idx (snap.id)}
      {@const isActive = activeId === snap.id}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <button
        class="snap-pad"
        class:populated={snap.populated}
        class:active={isActive}
        class:pressing={pressId === snap.id}
        style="--snap-color: {snap.color}"
        onpointerdown={(e) => handlePointerDown(e, snap, idx)}
        onpointermove={(e) => handlePointerMove(e, snap)}
        onpointerup={(e) => handlePointerUp(e, snap, idx)}
        onpointercancel={handlePointerCancel}
        onpointerleave={handlePointerCancel}
        title={snap.populated ? snap.name : `Slot ${idx + 1} · empty`}
      >
        <span class="slot-num">{idx + 1}</span>
        {#if snap.populated}
          <span class="snap-name">{snap.name}</span>
        {/if}
      </button>
    {/each}
  </div>
</div>

<style>
  .snap-bank {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    min-width: 0;
  }
  .snap-bank.compact {
    padding: 6px 8px;
    gap: 4px;
  }

  /* Top-row dense layout: 16 pads on a single horizontal row, no
     header chrome. Pads become a flex row that auto-fills width so the
     bank scales cleanly across iPad sizes (mini → 12.9 Pro). */
  .snap-bank.top-row {
    padding: 4px 8px;
    gap: 0;
    background: transparent;
    border: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 0;
  }
  .snap-bank.top-row .snap-grid {
    grid-template-columns: repeat(16, 1fr);
    gap: 3px;
  }
  .snap-bank.top-row .snap-pad {
    aspect-ratio: auto;
    min-height: 30px;
    height: 30px;
    border-radius: 4px;
    padding: 1px;
  }
  .snap-bank.top-row .snap-name {
    display: none;  /* no room on a 30px-tall pad */
  }
  .snap-bank.top-row .slot-num {
    font-size: 11px;
  }

  .bank-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }
  .bank-label {
    font-size: 10px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 1.5px;
  }
  .bank-hint {
    font-size: 9px;
    color: rgba(255, 255, 255, 0.25);
    letter-spacing: 0.5px;
  }

  .snap-grid {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    gap: 4px;
  }
  .snap-bank.compact .snap-grid {
    grid-template-columns: repeat(8, 1fr);
    gap: 3px;
  }

  .snap-pad {
    aspect-ratio: 1;
    min-width: 32px;
    min-height: 32px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 5px;
    color: rgba(255, 255, 255, 0.25);
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1px;
    padding: 2px;
    -webkit-tap-highlight-color: transparent;
    touch-action: none;
    transition: all 0.1s;
    position: relative;
    overflow: hidden;
  }
  .snap-bank.compact .snap-pad {
    min-width: 26px;
    min-height: 26px;
  }

  .snap-pad.populated {
    background: color-mix(in srgb, var(--snap-color) 18%, transparent);
    border-color: color-mix(in srgb, var(--snap-color) 50%, transparent);
    color: var(--snap-color);
    box-shadow: 0 0 4px color-mix(in srgb, var(--snap-color) 30%, transparent);
  }

  .snap-pad.active {
    background: color-mix(in srgb, var(--snap-color) 35%, transparent);
    border-color: var(--snap-color);
    color: #fff;
    box-shadow: 0 0 12px var(--snap-color);
    animation: pad-pulse 1.5s ease-in-out infinite;
  }

  .snap-pad.pressing {
    transform: scale(0.92);
    background: color-mix(in srgb, var(--snap-color) 50%, transparent);
  }

  @keyframes pad-pulse {
    0%, 100% { box-shadow: 0 0 8px var(--snap-color); }
    50% { box-shadow: 0 0 18px var(--snap-color); }
  }

  .slot-num {
    font-size: 10px;
    font-weight: 800;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }
  .snap-name {
    font-size: 8px;
    line-height: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    opacity: 0.85;
  }
</style>
