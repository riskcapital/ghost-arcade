<!--
  Music motion for one shader (a mapping layer's shader or a VJ shader clip):
  an on/off button, an Amount slider, and the params it drives. The params are
  picked for you; "Params" opens a checklist of the shader's float params.
-->
<script lang="ts">
  import MusicMotionMark from './MusicMotionMark.svelte';
  import {
    isDrivableInput,
    isMusicMotionInput,
    isMusicMotionReady,
    musicMotionParams,
    MUSIC_MOTION_DEFAULT_AMOUNT,
    type MotionInput,
    type MusicMotionSettings,
  } from '../audio/musicMotion';

  interface Props {
    settings: MusicMotionSettings | undefined;
    inputs: readonly MotionInput[];
    onchange: (next: MusicMotionSettings) => void;
  }

  let { settings, inputs, onchange }: Props = $props();

  let showParams = $state(false);

  const current = $derived<MusicMotionSettings>(settings ?? { on: false, amount: MUSIC_MOTION_DEFAULT_AMOUNT });
  const ready = $derived(isMusicMotionReady(inputs));
  // A shader made for Music motion reads the music itself; its sliders stay put.
  const floats = $derived(ready ? [] : inputs.filter((i) => isDrivableInput(i) && !isMusicMotionInput(i.NAME)));
  const driven = $derived(new Set(musicMotionParams(current, inputs)));

  function toggle() {
    onchange({ ...current, on: !current.on });
  }

  function setAmount(value: number) {
    onchange({ ...current, amount: Math.max(0, Math.min(1, value)) });
  }

  function toggleParam(name: string) {
    const next = new Set(driven);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onchange({ ...current, params: floats.map((i) => i.NAME).filter((n) => next.has(n)) });
  }

  function autoPick() {
    const { params: _drop, ...rest } = current;
    onchange(rest);
  }
</script>

<div class="music-motion">
  <div class="mm-row">
    <button
      class="mm-toggle"
      class:on={current.on}
      aria-pressed={current.on}
      title={ready
        ? "The music runs this shader's own motion, in place of per-param audio"
        : "The music runs this shader's time and moves its main params, in place of per-param audio. Works on any shader; shaders with the mark respond best"}
      onclick={toggle}
    >{#if current.on}<MusicMotionMark size={11} live decorative />{/if}{current.on ? 'Music motion on' : 'Music motion'}</button>
    {#if ready && !current.on}
      <MusicMotionMark title="Made for Music motion: smooth, full response" />
    {/if}
    <input
      class="mm-amount"
      type="range"
      min="0"
      max="1"
      step="0.01"
      value={current.amount}
      disabled={!current.on}
      title={ready ? "Amount: how strongly the music moves it" : "Amount: how far the music pushes time and params"}
      aria-label="Music motion amount"
      oninput={(e) => setAmount(parseFloat((e.target as HTMLInputElement).value))}
    />
    <span class="mm-value">{Math.round(current.amount * 100)}%</span>
    {#if floats.length > 0}
      <button
        class="mm-params-btn"
        class:open={showParams}
        aria-expanded={showParams}
        title="Choose the params Music motion drives"
        onclick={() => (showParams = !showParams)}
      >Params</button>
    {/if}
  </div>
  {#if showParams && floats.length > 0}
    <div class="mm-params">
      {#each floats as input (input.NAME)}
        <label class="mm-param">
          <input type="checkbox" checked={driven.has(input.NAME)} onchange={() => toggleParam(input.NAME)} />
          <span>{input.LABEL || input.NAME}</span>
        </label>
      {/each}
      <button class="mm-auto" disabled={!current.params} onclick={autoPick} title="Let Music motion pick the params again">Pick for me</button>
    </div>
  {/if}
</div>

<style>
  .music-motion {
    padding: 6px 0 8px;
    border-bottom: 1px solid var(--ga-line-1, rgba(255, 255, 255, 0.06));
    margin-bottom: 6px;
  }
  .mm-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .mm-toggle,
  .mm-params-btn,
  .mm-auto {
    font-size: var(--ga-text-meta);
    padding: 2px 8px;
    background-color: var(--ga-slot, #050607);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-1, #aab1bd);
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.12s, color 0.12s, background 0.12s;
  }
  .mm-toggle:hover,
  .mm-params-btn:hover,
  .mm-auto:hover:not(:disabled) {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.25));
    color: var(--ga-ink-0, #e6e9ee);
  }
  .mm-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  /* On: solid icon blue, so it reads at a glance. */
  .mm-toggle.on,
  .mm-toggle.on:hover {
    border-color: var(--ga-icon, #5278ff);
    background: var(--ga-icon, #5278ff);
    color: #fff;
  }
  .mm-toggle.on :global(.mm-mark) {
    color: #fff;
  }
  .mm-params-btn.open {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.25));
    color: var(--ga-ink-0, #e6e9ee);
  }
  .mm-amount {
    flex: 1;
    min-width: 0;
  }
  .mm-amount:disabled {
    opacity: 0.4;
  }
  .mm-value {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #5e6571);
    min-width: 32px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .mm-params {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    padding-top: 6px;
  }
  .mm-param {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1, #aab1bd);
    cursor: pointer;
  }
  .mm-auto:disabled {
    opacity: 0.4;
    cursor: default;
  }
</style>
