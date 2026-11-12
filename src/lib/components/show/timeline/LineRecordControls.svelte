<script lang="ts">
  /**
   * The Timeline transport's line tools: the pen, record arm (Touch: writes
   * while a control moves, then goes back to the line; Latch: keeps the
   * last value until stop), and "touch a knob to bind" for the selected
   * line. Armed is red; while a pass is being written the dot pulses.
   * Follow edits records every setting you change in the editor while
   * armed (Mapping, the panels, controllers), not only bound ones.
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
  import { liveEditOn, setLiveEdit } from '../../../timeline/liveEdit';
  import TimelineIcon from './TimelineIcon.svelte';
  import { lastLineControl } from './lineDiamond';

  // A slice: the whole store publishes every playhead frame.
  const linesSlice = showSlice('lines');
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
  let popPos = $state({ left: 0, bottom: 0 });
  function toggleMore() {
    moreOpen = !moreOpen;
    if (moreOpen && moreAnchor) {
      const r = moreAnchor.getBoundingClientRect();
      popPos = { left: Math.max(8, Math.min(r.left, window.innerWidth - 380)), bottom: window.innerHeight - r.top + 6 };
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

  function toggleBind() {
    if (rec.bindPending) { cancelBind(); return; }
    const b = bindTarget;
    if (b) bindNextControl(b.target, b.key, b.label);
  }
</script>

<div class="lr" data-line-record>
  <button
    class="lr-btn lr-live"
    class:on={$liveEditOn}
    onclick={() => setLiveEdit(!$liveEditOn)}
    title={$liveEditOn ? 'Live edit on: what you change goes onto the Timeline (stopped: held for Update; playing: recorded). Click to stop' : 'Live edit: what you change in the editor goes onto the Timeline. Stopped, changes are held until you press Update; playing, they are recorded'}
    aria-pressed={$liveEditOn}
    data-live-edit
  ><span class="lr-dot"></span><span class="lr-label">Live edit</span></button>
  <span class="lr-more-wrap">
    <button
      class="lr-btn lr-more"
      class:on={moreOpen}
      class:armed={rec.armed && !$liveEditOn}
      bind:this={moreAnchor}
      onclick={toggleMore}
      title="Recording options: record lines, Touch or Latch, follow edits, bind a knob, draw lines"
      aria-label="Recording options"
      aria-expanded={moreOpen}
      data-line-record-options
    ><TimelineIcon name="sliders" size={14} /></button>
    {#if moreOpen}
      <div class="lr-pop" style:left="{popPos.left}px" style:bottom="{popPos.bottom}px" role="dialog" aria-label="Recording options" data-line-record-pop>
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
        <div class="lr-row">
          <button class="lr-btn lr-pen" class:on={pen} onclick={() => linePenTool.set(!pen)} aria-pressed={pen} data-line-pen>✎ Draw lines</button>
          <span class="lr-help">Press and draw on a line lane; it is thinned to a few points.</span>
        </div>
      </div>
    {/if}
  </span>
  {#if pen && !moreOpen}
    <button class="lr-btn lr-pen on" onclick={() => linePenTool.set(false)} title="Drawing lines by hand: click to go back to points">✎ Drawing</button>
  {/if}
  {#if rec.bindPending && !moreOpen}
    <button class="lr-btn lr-bind pending" onclick={toggleBind} title="Click to cancel">Touch a knob… ({rec.bindPending.label})</button>
  {/if}
</div>

<style>
  .lr { display: inline-flex; align-items: center; gap: 4px; }
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
  .lr-dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--ga-rec, #ff4757) 70%, transparent); }
  .lr-live.on { color: #fff; background: var(--ga-rec, #ff4757); border-color: var(--ga-rec, #ff4757); }
  .lr-live.on .lr-dot { background: #fff; }
  .lr-more { padding: 0 6px; }
  .lr-more.on { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  /* Recording armed without Live edit: say so on the options button. */
  .lr-more.armed { color: var(--ga-rec, #ff4757); border-color: var(--ga-rec, #ff4757); }
  .lr-more-wrap { position: relative; display: inline-flex; }
  .lr-pop {
    position: fixed;
    z-index: 2000;
    width: 360px;
    padding: 6px 0;
    background: var(--ga-panel, #15151a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    border-radius: 6px;
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
  .lr-follow.on, .lr-pen.on { color: #fff; border-color: var(--ga-icon, #5278ff); background: color-mix(in srgb, var(--ga-icon, #5278ff) 35%, transparent); }
  .lr-arm.armed { color: #fff; background: color-mix(in srgb, var(--ga-rec, #ff4757) 70%, #000); border-color: var(--ga-rec, #ff4757); }
  .lr-arm.armed .lr-dot { background: #fff; }
  .lr-arm.writing .lr-dot { animation: lr-pulse 0.5s ease-in-out infinite alternate; }
  .lr-bind.pending { color: var(--ga-rec, #ff4757); border-color: var(--ga-rec, #ff4757); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  @keyframes lr-pulse { from { opacity: 1; } to { opacity: 0.25; } }
</style>
