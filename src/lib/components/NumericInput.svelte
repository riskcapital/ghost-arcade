<script lang="ts">
  /**
   * NumericInput — slider + click-to-type readout.
   *
   * Looks like a label-with-bold-value plus a range slider, matching
   * the existing panel sliders. Click on the value to convert it
   * into a small text input where you can type any number, scrubbing
   * with the slider AND keying in precise values.
   *
   * Confirmation: Enter / blur commits the typed value (clamped to
   * min/max). Escape reverts.
   *
   * Designed to be a drop-in replacement for the
   *   <div class="sc"><label>X <b>{val}</b></label><input type="range" .../></div>
   * pattern used throughout the panels. Just import + use:
   *   <NumericInput label="Depth" value={c.depth} min={0} max={2}
   *     step={0.01} on:input={(e) => patch({ depth: e.detail })} />
   *
   * `displayValue` lets the caller customise how the value is shown
   * (e.g. trailing units, fixed precision) without affecting the
   * numeric value itself.
   */
  import { createEventDispatcher, tick } from 'svelte';

  export let label: string;
  export let value: number;
  export let min: number = 0;
  export let max: number = 1;
  export let step: number = 0.01;
  /** Optional formatter for the displayed number (e.g. "0.50×",
   *  "45°"). Falls back to the value with sensible precision. */
  export let displayValue: ((v: number) => string) | undefined = undefined;
  /** When true (default), commits as the user drags the slider in
   *  realtime. When false, only commits on slider release. */
  export let live: boolean = true;
  /** Optional MIDI / MediaPipe / OSC binding path. When set, this
   *  slider is discoverable by the binding overlays — the underlying
   *  range input gets `data-midi-path` (+ min/max/step/label) so
   *  MidiOverlay and MediaPipeLearnOverlay treat it as a learn target.
   *  Components that wrap NumericInput just pass these through. */
  export let midiPath: string | undefined = undefined;
  export let midiLabel: string | undefined = undefined;

  const dispatch = createEventDispatcher<{ input: number; change: number }>();

  let editing = false;
  let inputEl: HTMLInputElement | null = null;
  // Buffer for the in-progress text edit so we can support free
  // typing (intermediate states like "-" or "0." that aren't valid
  // numbers yet) without immediately reformatting.
  let editBuffer = '';

  function defaultDisplay(v: number): string {
    if (Number.isNaN(v)) return '—';
    // Choose precision based on step: smaller step = more decimals.
    const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : step >= 0.001 ? 3 : 4;
    return v.toFixed(decimals);
  }

  $: shown = displayValue ? displayValue(value) : defaultDisplay(value);

  async function startEdit() {
    editBuffer = String(value);
    editing = true;
    await tick();
    inputEl?.focus();
    inputEl?.select();
  }

  function commit() {
    const parsed = parseFloat(editBuffer);
    if (!Number.isNaN(parsed)) {
      const clamped = Math.max(min, Math.min(max, parsed));
      dispatch('input', clamped);
      dispatch('change', clamped);
    }
    editing = false;
  }

  function cancel() {
    editing = false;
  }

  function onSlider(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (live) dispatch('input', v);
  }
  function onSliderChange(e: Event) {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!live) dispatch('input', v);
    dispatch('change', v);
  }
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  }
</script>

<div class="ni">
  <label class="ni-label">
    {label}
    {#if editing}
      <input
        bind:this={inputEl}
        bind:value={editBuffer}
        type="text"
        inputmode="decimal"
        class="ni-edit"
        onblur={commit}
        onkeydown={onKeyDown}
      />
    {:else}
      <button type="button" class="ni-display" title="Click to type a value" onclick={startEdit}>
        {shown}
      </button>
    {/if}
  </label>
  <input
    type="range"
    {min}
    {max}
    {step}
    {value}
    oninput={onSlider}
    onchange={onSliderChange}
    data-midi-path={midiPath}
    data-midi-label={midiLabel ?? label}
    data-midi-min={midiPath ? min : undefined}
    data-midi-max={midiPath ? max : undefined}
    data-midi-step={midiPath ? step : undefined}
  />
</div>

<style>
  .ni { display: flex; flex-direction: column; gap: 2px; }
  .ni-label {
    font-size: 10.5px;
    opacity: 0.85;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 6px;
  }
  .ni-display {
    background: transparent;
    border: 1px dashed transparent;
    color: #67e8f9;
    font: inherit;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    cursor: text;
    padding: 1px 6px;
    border-radius: 3px;
    transition: background 0.08s, border-color 0.08s;
  }
  .ni-display:hover {
    background: rgba(103, 232, 249, 0.08);
    border-color: rgba(103, 232, 249, 0.35);
  }
  .ni-edit {
    background: #0f1219;
    border: 1px solid #67e8f9;
    color: #e0e7ef;
    font: inherit;
    font-weight: 500;
    font-variant-numeric: tabular-nums;
    padding: 1px 6px;
    border-radius: 3px;
    width: 70px;
    text-align: right;
    outline: none;
  }
  input[type="range"] { width: 100%; accent-color: #67e8f9; }
</style>
