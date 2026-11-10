<script lang="ts">
  /**
   * The Timeline transport's line tools: the pen, record arm (Touch: writes
   * while a control moves, then goes back to the line; Latch: keeps the
   * last value until stop), and "touch a knob to bind" for the selected
   * line. Armed is red; while a pass is being written the dot pulses.
   */
  import { showTimeline } from '../../../stores/showTimeline';
  import {
    armLines,
    bindNextControl,
    cancelBind,
    disarmLines,
    lineRecordState,
    lineSelection,
    setRecordMode,
  } from '../../../timeline/lines/timelineLines';
  import type { RecordMode } from '../../../timeline/lines/lineRecorder';
  import { linePenTool } from './lineUi';
  import { lastLineControl } from './lineDiamond';

  const rec = $derived($lineRecordState);
  const pen = $derived($linePenTool);
  const sel = $derived($lineSelection);
  const last = $derived($lastLineControl);

  /** What "bind" binds: the selected line, else the last control picked with ◆. */
  const bindTarget = $derived.by(() => {
    const lines = $showTimeline.lines;
    const line = sel ? lines.find((l) => l.id === sel.lineId) : null;
    if (line) return { target: line.target, key: line.key, label: line.label ?? line.key };
    return last;
  });

  function toggleArm() {
    if (rec.armed) disarmLines();
    else armLines(rec.mode);
  }
  function toggleBind() {
    if (rec.bindPending) { cancelBind(); return; }
    const b = bindTarget;
    if (b) bindNextControl(b.target, b.key, b.label);
  }
</script>

<div class="lr" data-line-record>
  <button
    class="lr-btn lr-pen"
    class:on={pen}
    onclick={() => linePenTool.set(!pen)}
    title={pen ? 'Pen on: press and draw on a line lane. Click to go back to points' : 'Pen: draw a line freehand (it is thinned to a few points)'}
    aria-pressed={pen}
    data-line-pen
  >✎</button>
  <button
    class="lr-btn lr-arm"
    class:armed={rec.armed}
    class:writing={rec.writing}
    onclick={toggleArm}
    title={rec.armed ? 'Armed: moving a bound knob, a slider or a line\'s control while the Timeline plays writes its line. Click to disarm' : 'Arm: record control lines from MIDI, the panel sliders, OSC and Live while the Timeline plays'}
    aria-pressed={rec.armed}
    data-line-arm
  ><span class="lr-dot"></span>{rec.armed ? 'Armed' : 'Rec lines'}</button>
  <select
    class="lr-mode"
    value={rec.mode}
    onchange={(e) => setRecordMode((e.currentTarget as HTMLSelectElement).value as RecordMode)}
    title="Touch: writes while you move a control, then glides back to the line. Latch: keeps the last value until you stop"
    aria-label="Record mode"
    data-line-record-mode
  >
    <option value="touch">Touch</option>
    <option value="latch">Latch</option>
  </select>
  <button
    class="lr-btn lr-bind"
    class:pending={!!rec.bindPending}
    disabled={!rec.bindPending && !bindTarget}
    onclick={toggleBind}
    title={rec.bindPending ? `Move a MIDI knob or fader now: it will drive ${rec.bindPending.label}. Click to cancel` : bindTarget ? `Touch a knob to bind: the next MIDI control you move drives ${bindTarget.label}` : 'Select a line (or ◆ a control) first, then touch a knob to bind it'}
    data-line-bind-transport
  >{rec.bindPending ? `Touch a knob… (${rec.bindPending.label})` : '🎛 Bind'}</button>
</div>

<style>
  .lr { display: inline-flex; align-items: center; gap: 4px; }
  .lr-btn, .lr-mode {
    height: 24px;
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    border-radius: 4px;
    font: inherit;
    font-size: 11px;
    padding: 0 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .lr-mode { padding: 0 4px; }
  .lr-btn:disabled { opacity: 0.4; cursor: default; }
  .lr-btn.on { color: #FFD96B; border-color: #FFD96B; }
  .lr-arm { display: inline-flex; align-items: center; gap: 5px; }
  .lr-dot { width: 8px; height: 8px; border-radius: 50%; background: color-mix(in srgb, var(--ga-rec, #ff4757) 45%, transparent); }
  .lr-arm.armed { color: #fff; background: color-mix(in srgb, var(--ga-rec, #ff4757) 70%, #000); border-color: var(--ga-rec, #ff4757); }
  .lr-arm.armed .lr-dot { background: #fff; }
  .lr-arm.writing .lr-dot { animation: lr-pulse 0.5s ease-in-out infinite alternate; }
  .lr-bind.pending { color: var(--ga-rec, #ff4757); border-color: var(--ga-rec, #ff4757); max-width: 220px; overflow: hidden; text-overflow: ellipsis; }
  @keyframes lr-pulse { from { opacity: 1; } to { opacity: 0.25; } }
</style>
