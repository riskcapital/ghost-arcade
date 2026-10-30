<script lang="ts">
  // Screen FX colour chase and click-to-order controls, shared by Mapping
  // Screen FX and VJ Stage FX. `onUpdate` writes a patch to the effect.
  import type { StageEffect } from '../types';
  import { chaseOrderRecording, startChaseOrderRecording, stopChaseOrderRecording } from '../stores/chaseOrderRecorder';
  import { DEFAULT_CHASE_COLOR, DEFAULT_CHASE_COLOR2 } from '../stores/stageEffects';
  import { recordDiscreteAction } from '../stores/historyHooks';

  let { effect, target, onUpdate }: {
    effect: StageEffect;
    target: 'mapping' | 'surface';
    onUpdate: (patch: Partial<StageEffect>) => void;
  } = $props();

  const output = $derived(effect.output ?? 'brightness');
  const recording = $derived($chaseOrderRecording?.effectId === effect.id ? $chaseOrderRecording : null);

  function set(patch: Partial<StageEffect>) {
    onUpdate(patch);
    recordDiscreteAction();
  }

  function toggleRecording() {
    if (recording) { stopChaseOrderRecording(true); return; }
    startChaseOrderRecording(target, effect.id, (_t, _id, order) => onUpdate({ order }));
  }
</script>

<div class="chase-controls">
  <div class="param-row">
    <span class="param-label">Drives</span>
    <div class="chase-seg" role="radiogroup" aria-label="What the effect drives">
      {#each [['brightness', 'Brightness'], ['color', 'Color'], ['both', 'Both']] as [value, label] (value)}
        <button type="button" role="radio" aria-checked={output === value} class:active={output === value}
          onclick={() => set({ output: value as StageEffect['output'] })}>{label}</button>
      {/each}
    </div>
  </div>
  {#if output !== 'brightness'}
    <div class="param-row">
      <span class="param-label">Colors</span>
      <div class="chase-seg" role="radiogroup" aria-label="Color style">
        {#each [['two-tone', 'Two colors'], ['rainbow', 'Rainbow']] as [value, label] (value)}
          <button type="button" role="radio" aria-checked={(effect.colorStyle ?? 'two-tone') === value}
            class:active={(effect.colorStyle ?? 'two-tone') === value}
            onclick={() => set({ colorStyle: value as StageEffect['colorStyle'] })}>{label}</button>
        {/each}
      </div>
      {#if (effect.colorStyle ?? 'two-tone') === 'two-tone'}
        <input type="color" class="chase-color" aria-label="Lit color" title="Lit color" value={effect.color ?? DEFAULT_CHASE_COLOR}
          onchange={(e) => set({ color: (e.currentTarget as HTMLInputElement).value })} />
      {/if}
      <input type="color" class="chase-color" aria-label="Rest color" title="Rest color" value={effect.color2 ?? DEFAULT_CHASE_COLOR2}
        onchange={(e) => set({ color2: (e.currentTarget as HTMLInputElement).value })} />
    </div>
  {/if}
  <div class="param-row chase-order-row">
    <span class="param-label">Order</span>
    <button type="button" class="chase-order-btn" class:recording={!!recording} onclick={toggleRecording}
      title="Click screens on the canvas (or in the layer list) in the order the chase should visit them">
      {#if recording}Done ({recording.order.length} picked){:else}{effect.order?.length ? `Custom (${effect.order.length})` : 'Set by clicking screens'}{/if}
    </button>
    {#if effect.order?.length && !recording}
      <button type="button" class="chase-order-reset" onclick={() => set({ order: undefined })}>Reset</button>
    {/if}
  </div>
  {#if recording}
    <p class="chase-hint" role="status">Click the screens in chase order. Click Done when finished.</p>
  {/if}
</div>

<style>
  .chase-controls { display: flex; flex-direction: column; gap: 4px; margin-top: 4px; }
  .param-row { display: flex; align-items: center; gap: 6px; min-height: var(--ga-control-h-sm, 22px); }
  .param-label { flex: 0 0 64px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2); }
  /* One-of-few choice: a segmented track (docs/DESIGN-SYSTEM.md). */
  .chase-seg { flex: 1; display: flex; gap: 2px; min-width: 0; padding: 2px; background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px); }
  .chase-seg button { flex: 1; min-height: 18px; background: transparent; color: var(--ga-ink-1); border: 0; border-radius: calc(var(--ga-r-hard, 5px) - 1px); font: inherit; font-size: var(--ga-text-meta, 11px); font-weight: var(--ga-weight-control, 600); padding: 0 4px; cursor: pointer; white-space: nowrap; }
  .chase-seg button:hover:not(.active) { color: var(--ga-ink-0); }
  .chase-seg button.active { background: var(--ga-selection-bg); color: var(--ga-selection-ink); box-shadow: inset 0 0 0 1px var(--ga-selection-line); }
  .chase-color { width: 26px; height: var(--ga-control-h-sm, 22px); padding: 0; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px); background: none; cursor: pointer; }
  .chase-order-btn, .chase-order-reset { min-height: var(--ga-control-h-sm, 22px); background: var(--ga-card); color: var(--ga-ink-0); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px); font: inherit; font-size: var(--ga-text-meta, 11px); font-weight: var(--ga-weight-control, 600); padding: 0 8px; cursor: pointer; }
  .chase-order-btn:hover, .chase-order-reset:hover { border-color: var(--ga-line-3); }
  .chase-order-btn { flex: 1; }
  .chase-order-btn.recording { border-color: var(--ga-rec, #ff3b30); color: var(--ga-ink-0); background: color-mix(in srgb, var(--ga-rec, #ff3b30) 16%, transparent); }
  .chase-hint { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1); }
</style>
