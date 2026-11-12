<script lang="ts">
  /**
   * Live edit, made obvious: while it is on (or changes are held), a red
   * bar over the editor says where edits are going, with Update, Discard
   * and Stop, and a red frame runs round the canvas. See timeline/liveEdit.ts.
   */
  import { liveEdit, discardHeldEdits, setLiveEdit, updateHeldEdits } from '../timeline/liveEdit';
  import { showSlice } from './show/timeline/timelineSlices';

  interface Props {
    canvasX: number;
    canvasY: number;
    canvasWidth: number;
    canvasHeight: number;
  }
  let { canvasX, canvasY, canvasWidth, canvasHeight }: Props = $props();

  const playing = showSlice('isPlaying');
  let state = $derived($liveEdit);
  let held = $derived(state.held);
  let shown = $derived(state.on || held.length > 0);

  function clock(t: number): string {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `${m}:${s.toFixed(1).padStart(4, '0')}`;
  }

  let heldAt = $derived.by(() => {
    if (!held.length) return '';
    const times = [...new Set(held.map((e) => clock(e.t)))];
    return times.length === 1 ? times[0] : `${times.length} places`;
  });

  let message = $derived.by(() => {
    const n = `${held.length} ${held.length === 1 ? 'change' : 'changes'}`;
    if (!state.on) return `${n} held at ${heldAt}, not on the Timeline yet`;
    if ($playing) return 'Recording your changes as it plays';
    if (held.length) return `${n} held at ${heldAt}`;
    return 'Changes are held for Update';
  });
</script>

{#if shown}
  <div class="live-frame" style="left: {canvasX}px; top: {canvasY}px; width: {canvasWidth}px; height: {canvasHeight}px;" aria-hidden="true"></div>
  <div class="live-bar" role="status" aria-live="polite" data-live-edit-bar>
    <span class="live-mark" class:recording={state.on && $playing}>Live edit</span>
    <span class="live-msg" title="Stopped, what you change is held: it shows on the stage now, and Update keys it on the Timeline where you made it. Playing, it is recorded as it happens.">{message}</span>
    {#if held.length}
      <button type="button" class="primary" onclick={() => updateHeldEdits()} title="Key every held change on the Timeline where it was made" data-live-update>Update</button>
      <button type="button" onclick={() => discardHeldEdits()} title="Undo the held changes: back to how it was before the first one" data-live-discard>Discard</button>
    {/if}
    {#if state.on}
      <button type="button" onclick={() => setLiveEdit(false)} title="Stop Live edit: changes no longer go onto the Timeline" data-live-stop>Stop</button>
    {/if}
  </div>
{/if}

<style>
  .live-frame {
    position: absolute;
    z-index: 55;
    pointer-events: none;
    box-shadow: inset 0 0 0 2px var(--ga-rec, #ff4757);
  }
  .live-bar {
    position: absolute;
    left: 50%;
    top: 10px;
    z-index: 70;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 8px;
    max-width: calc(100% - 24px);
    padding: 4px 4px 4px 10px;
    background: rgba(14, 6, 7, 0.92);
    border: 1px solid var(--ga-rec, #ff4757);
    border-radius: var(--ga-r-hard, 4px);
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-control, 12px);
  }
  .live-mark {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--ga-rec, #ff4757);
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    font-size: var(--ga-text-meta, 11px);
  }
  .live-mark::before {
    content: '';
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--ga-rec, #ff4757);
  }
  .live-mark.recording::before { animation: live-pulse 1s ease-in-out infinite; }
  @keyframes live-pulse { 50% { opacity: 0.25; } }
  .live-msg {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--ga-ink-1, #d6d0dc);
  }
  .live-bar button {
    flex-shrink: 0;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 10px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.16));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #f2ede4);
    font-family: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .live-bar button:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.3)); }
  .live-bar button.primary {
    background: var(--ga-rec, #ff4757);
    border-color: var(--ga-rec, #ff4757);
    color: #fff;
  }
</style>
