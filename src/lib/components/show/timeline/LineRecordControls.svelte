<script lang="ts">
  /**
   * The Timeline transport's line tools: the pen, record arm (Touch: writes
   * while a control moves, then goes back to the line; Latch: keeps the
   * last value until stop), and "touch a knob to bind" for the selected
   * line. Armed is red; while a pass is being written the dot pulses.
   * Follow edits records every setting you change in the editor while
   * armed (Mapping, the panels, controllers), not only bound ones.
   *
   * In the toolbar it is one split button: ● Record (Live edit; "Update"
   * while changes are held and the show is stopped) and the record mode
   * with a caret that opens the options. Notices show as a toast under it.
   */
  import { showSlice } from './timelineSlices';
  import {
    armLines,
    bindNextControl,
    cancelBind,
    disarmLines,
    lineRecordState,
    lineSelection,
    setFollowEdits,
    setRecordMode,
  } from '../../../timeline/lines/timelineLines';
  import { linePenTool } from './lineUi';
  import { heldEdits, liveEditOn, setLiveEdit, updateHeldEdits } from '../../../timeline/liveEdit';
  import TimelineIcon from './TimelineIcon.svelte';
  import { lastLineControl } from './lineDiamond';

  // A slice: the whole store publishes every playhead frame.
  const linesSlice = showSlice('lines');
  const playingSlice = showSlice('isPlaying');
  const holding = $derived($heldEdits.length > 0 && !$playingSlice);
  const rec = $derived($lineRecordState);
  const pen = $derived($linePenTool);
  const sel = $derived($lineSelection);
  const last = $derived($lastLineControl);

  /** What "bind" binds: the selected line, else the last control picked with ◆. */
  const bindTarget = $derived.by(() => {
    const lines = $linesSlice;
    const line = sel ? lines.find((l) => l.id === sel.lineId) : null;
    if (line) return { target: line.target, key: line.key, label: line.label ?? line.key };
    return last;
  });

  function toggleArm() {
    if (rec.armed) disarmLines();
    else armLines(rec.mode);
  }
  let moreOpen = $state(false);
  let moreAnchor: HTMLButtonElement | undefined = $state();
  let popPos = $state({ left: 0, top: 0 });
  function toggleMore() {
    moreOpen = !moreOpen;
    if (moreOpen && moreAnchor) {
      const r = moreAnchor.getBoundingClientRect();
      popPos = { left: Math.max(8, Math.min(r.right - 360, window.innerWidth - 380)), top: r.bottom + 6 };
    }
  }
  $effect(() => {
    if (!moreOpen) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest?.('[data-line-record-pop]') || t?.closest?.('[data-line-record-options]')) return;
      moreOpen = false;
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') moreOpen = false; };
    const timer = setTimeout(() => window.addEventListener('mousedown', close), 0);
    window.addEventListener('keydown', esc);
    return () => { clearTimeout(timer); window.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  });

  // The toast hangs under the button, outside the toolbar (which clips).
  let splitEl: HTMLSpanElement | undefined = $state();
  let toastPos = $state({ right: 0, top: 0 });
  $effect(() => {
    if (!(rec.notice || rec.bindPending) || !splitEl) return;
    const r = splitEl.getBoundingClientRect();
    toastPos = { right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 };
  });

  function pressRecord() {
    if (holding) { updateHeldEdits(); return; }
    setLiveEdit(!$liveEditOn);
  }

  function toggleBind() {
    if (rec.bindPending) { cancelBind(); return; }
    const b = bindTarget;
    if (b) bindNextControl(b.target, b.key, b.label);
  }
</script>

<div class="lr" data-line-record>
  <span class="lr-split" bind:this={splitEl} class:on={$liveEditOn} class:armed={rec.armed && !$liveEditOn}>
    <button
      class="lr-rec"
      onclick={pressRecord}
      title={holding
        ? 'Update: key every held change on the Timeline where it was made'
        : $liveEditOn
          ? 'Recording: what you change goes onto the Timeline (stopped: held for Update; playing: recorded). Click to stop'
          : 'Record: what you change in the editor goes onto the Timeline. Stopped, changes are held until you press Update; playing, they are recorded'}
      aria-pressed={$liveEditOn}
      data-live-edit
    ><span class="lr-dot" class:writing={rec.writing}></span><span class="lr-label">{holding ? 'Update' : 'Record'}</span></button>
    <button
      class="lr-caret"
      class:open={moreOpen}
      bind:this={moreAnchor}
      onclick={toggleMore}
      title="Recording options: record lines, Touch or Latch, follow edits, bind a knob"
      aria-label="Recording options"
      aria-expanded={moreOpen}
      data-line-record-options
    ><span class="lr-mode" data-line-record-mode-word>{rec.mode === 'touch' ? 'Touch' : 'Latch'}</span><TimelineIcon name="caret" size={12} /></button>
  </span>
  {#if moreOpen}
    <div class="lr-pop" style:left="{popPos.left}px" style:top="{popPos.top}px" role="dialog" aria-label="Recording options" data-line-record-pop data-tl-popover data-fit-ignore>
      <div class="lr-row">
        <button class="lr-btn lr-arm" class:armed={rec.armed} class:writing={rec.writing} onclick={toggleArm} aria-pressed={rec.armed} data-line-arm>
          <span class="lr-dot"></span>{rec.armed ? 'Recording lines' : 'Record lines'}
        </button>
        <span class="lr-help">While it plays, moving a bound knob, a slider or the control of a line writes that line.</span>
      </div>
      <div class="lr-row">
        <span class="lr-seg" role="radiogroup" aria-label="Record mode" data-line-record-mode>
          <button type="button" role="radio" aria-checked={rec.mode === 'touch'} class:on={rec.mode === 'touch'} onclick={() => setRecordMode('touch')}>Touch</button>
          <button type="button" role="radio" aria-checked={rec.mode === 'latch'} class:on={rec.mode === 'latch'} onclick={() => setRecordMode('latch')}>Latch</button>
        </span>
        <span class="lr-help">{rec.mode === 'touch' ? 'Writes while you move a control, then glides back to the line.' : 'Keeps the last value until you stop.'}</span>
      </div>
      <div class="lr-row">
        <button class="lr-btn lr-follow" class:on={rec.followEdits} onclick={() => setFollowEdits(!rec.followEdits)} aria-pressed={rec.followEdits} data-line-follow-edits>Follow edits</button>
        <span class="lr-help">Every setting you change in the editor lands on the Timeline, not only bound ones.</span>
      </div>
      <div class="lr-row">
        <button class="lr-btn lr-bind" class:pending={!!rec.bindPending} disabled={!rec.bindPending && !bindTarget} onclick={toggleBind} data-line-bind-transport>
          {rec.bindPending ? 'Cancel' : 'Bind a knob'}
        </button>
        <span class="lr-help">{rec.bindPending ? `Move a MIDI knob or fader now: it will drive ${rec.bindPending.label}.` : bindTarget ? `The next MIDI control you move drives ${bindTarget.label}.` : 'Select a line first, then touch a knob to drive it.'}</span>
      </div>
      {#if $liveEditOn}
        <div class="lr-row">
          <button class="lr-btn" onclick={() => { setLiveEdit(false); moreOpen = false; }} data-live-edit-stop>Stop recording</button>
          <span class="lr-help">Changes no longer go onto the Timeline. Held changes stay in the editor.</span>
        </div>
      {/if}
      <div class="lr-row">
        <button class="lr-btn lr-pen" class:on={pen} onclick={() => linePenTool.set(!pen)} aria-pressed={pen} data-line-pen><TimelineIcon name="pen" size={13} />Draw lines</button>
        <span class="lr-help">Press and draw on a line lane; it is thinned to a few points. Also in the tools.</span>
      </div>
    </div>
  {/if}
  {#if rec.notice}
    <span class="lr-toast" style:right="{toastPos.right}px" style:top="{toastPos.top}px" role="status" data-line-record-notice>{rec.notice}</span>
  {:else if rec.bindPending && !moreOpen}
    <button class="lr-toast lr-bind-toast" style:right="{toastPos.right}px" style:top="{toastPos.top}px" onclick={toggleBind} title="Click to cancel">Touch a knob… ({rec.bindPending.label})</button>
  {/if}
</div>

<style>
  .lr { position: relative; display: inline-flex; align-items: center; gap: 4px; }
  .lr-split {
    display: inline-flex;
    align-items: stretch;
    height: var(--ga-control-h, 26px);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
    overflow: hidden;
  }
  .lr-split button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 0;
    background: transparent;
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .lr-split button:hover { background: var(--ga-raise, #26221c); }
  .lr-caret { padding: 0 6px 0 2px !important; color: var(--ga-ink-2, #89857e) !important; }
  .lr-caret .lr-mode { color: var(--ga-ink-2, #89857e); font-weight: 500; }
  .lr-caret.open { background: var(--ga-raise, #26221c) !important; }
  .lr-split .lr-dot { width: 9px; height: 9px; background: var(--tl-on, #ff725f); }
  .lr-split.on { background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
  .lr-split.on .lr-rec { color: var(--tl-on-ink, #ffd9d2); }
  .lr-split.armed { border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
  .lr-dot.writing { animation: lr-pulse 0.5s ease-in-out infinite alternate; }
  .lr-toast {
    position: fixed;
    z-index: 2000;
    max-width: 320px;
    padding: 4px 8px;
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
    border: 1px solid var(--tl-on-line, rgba(255, 114, 95, 0.46));
    color: var(--tl-on-ink, #ffd9d2);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  }
  .lr-bind-toast { cursor: pointer; }
  .lr-btn {
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    border-radius: 4px;
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    padding: 0 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .lr-btn:hover:not(:disabled) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .lr-btn:disabled { opacity: 0.4; cursor: default; }
  .lr-dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--tl-on, #ff725f) 70%, transparent); flex: 0 0 auto; }
  .lr-pop {
    position: fixed;
    z-index: 2000;
    width: 360px;
    padding: 6px 0;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .lr-row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
  }
  .lr-row + .lr-row { border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.06)); }
  .lr-row .lr-btn { justify-content: center; }
  .lr-help { color: var(--ga-ink-2, #8a8a96); font-size: 11px; line-height: 1.35; white-space: normal; }
  .lr-seg { display: inline-flex; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 4px; overflow: hidden; }
  .lr-seg button {
    flex: 1;
    height: 22px;
    padding: 0 8px;
    background: transparent;
    border: none;
    color: var(--ga-ink-1, #aaa);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
  }
  .lr-seg button.on { color: #fff; background: color-mix(in srgb, var(--ga-icon, #5278ff) 35%, transparent); }
  .lr-follow.on, .lr-pen.on { color: var(--ga-selection-ink, #e0e8ff); border-color: var(--ga-selection-line, #5278ff); background: var(--ga-selection-bg, #1f3170); }
  .lr-arm.armed { color: var(--tl-on-ink, #ffd9d2); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
  .lr-arm.armed .lr-dot { background: var(--tl-on, #ff725f); }
  .lr-arm.writing .lr-dot { animation: lr-pulse 0.5s ease-in-out infinite alternate; }
  .lr-bind.pending { color: var(--ga-rec, #ff4757); border-color: var(--ga-rec, #ff4757); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  @keyframes lr-pulse { from { opacity: 1; } to { opacity: 0.25; } }
</style>
