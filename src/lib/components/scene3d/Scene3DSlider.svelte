<script lang="ts">
  /**
   * One labelled value: a slider for dragging and a number field for typing.
   * A drag is one gesture (one undo step); Esc during a drag puts it back.
   */
  import { beginGesture, endGesture } from '../../stores/historyHooks';

  export let label: string;
  export let value: number;
  export let min: number;
  export let max: number;
  export let step = 0.01;
  /** Shown after the number, e.g. "m" or "°". */
  export let unit = '';
  /** `live` is true while dragging, false for a single change. */
  export let onchange: (value: number, live: boolean) => void;

  let dragging = false;
  let before = value;
  const digits = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const clamp = (v: number) => Math.max(min, Math.min(max, v));

  function start() {
    if (dragging) return;
    dragging = true;
    before = value;
    beginGesture();
  }
  function finish(commit: boolean) {
    if (!dragging) return;
    dragging = false;
    if (!commit) onchange(before, true);
    endGesture(commit);
  }
</script>

<div class="row">
  <span class="label">{label}</span>
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    aria-label={label}
    onpointerdown={start}
    oninput={(e) => {
      start();
      onchange(+e.currentTarget.value, true);
    }}
    onpointerup={() => finish(true)}
    onchange={() => finish(true)}
    onblur={() => finish(true)}
    onkeydown={(e) => {
      if (e.key === 'Escape') finish(false);
    }}
  />
  <span class="number">
    <input
      type="number"
      {min}
      {max}
      {step}
      value={Number(value.toFixed(digits))}
      aria-label={`${label} value`}
      onchange={(e) => {
        const v = Number(e.currentTarget.value);
        if (Number.isFinite(v)) onchange(clamp(v), false);
      }}
    />{#if unit}<span class="unit">{unit}</span>{/if}
  </span>
</div>

<style>
  .row {
    display: grid;
    grid-template-columns: 84px minmax(0, 1fr) 68px;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h, 26px);
    margin-bottom: 4px;
  }
  .label {
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control, 12px);
  }
  input[type='range'] {
    width: 100%;
  }
  .number {
    display: flex;
    align-items: center;
    gap: 2px;
  }
  .number input {
    width: 100%;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    background: transparent;
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 2px);
    font-size: var(--ga-text-meta, 11px);
    padding: 0 4px;
    text-align: right;
  }
  .unit {
    color: var(--ga-ink-2, #6b7280);
    font-size: var(--ga-text-meta, 11px);
  }
</style>
