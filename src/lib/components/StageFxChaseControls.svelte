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
      {#each [['brightness', 'Brightness'], ['color', 'Colour'], ['both', 'Both']] as [value, label] (value)}
        <button type="button" role="radio" aria-checked={output === value} class:active={output === value}
          onclick={() => set({ output: value as StageEffect['output'] })}>{label}</button>
      {/each}
    </div>
  </div>
  {#if output !== 'brightness'}
    <div class="param-row">
      <span class="param-label">Colours</span>
      <div class="chase-seg" role="radiogroup" aria-label="Colour style">
        {#each [['two-tone', 'Two colours'], ['rainbow', 'Rainbow']] as [value, label] (value)}
          <button type="button" role="radio" aria-checked={(effect.colorStyle ?? 'two-tone') === value}
            class:active={(effect.colorStyle ?? 'two-tone') === value}
            onclick={() => set({ colorStyle: value as StageEffect['colorStyle'] })}>{label}</button>
        {/each}
      </div>
      {#if (effect.colorStyle ?? 'two-tone') === 'two-tone'}
        <input type="color" class="chase-color" aria-label="Lit colour" title="Lit colour" value={effect.color ?? DEFAULT_CHASE_COLOR}
          onchange={(e) => set({ color: (e.currentTarget as HTMLInputElement).value })} />
      {/if}
      <input type="color" class="chase-color" aria-label="Rest colour" title="Rest colour" value={effect.color2 ?? DEFAULT_CHASE_COLOR2}
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
  .param-row { display: flex; align-items: center; gap: 6px; }
  .param-label { flex: 0 0 64px; font-size: 11px; color: #9da3b0; }
  .chase-seg { flex: 1; display: flex; min-width: 0; border: 1px solid #3a3a48; border-radius: 4px; overflow: hidden; }
  .chase-seg button { flex: 1; background: #15151b; color: #aeb2bd; border: 0; font-size: 11px; padding: 3px 4px; cursor: pointer; white-space: nowrap; }
  .chase-seg button + button { border-left: 1px solid #3a3a48; }
  .chase-seg button.active { background: rgba(255, 79, 216, 0.22); color: #fff; }
  .chase-color { width: 26px; height: 20px; padding: 0; border: 1px solid #333; border-radius: 4px; background: none; cursor: pointer; }
  .chase-order-btn, .chase-order-reset { background: #1a1a22; color: #d5d8e0; border: 1px solid #3a3a48; border-radius: 4px; font-size: 11px; padding: 3px 8px; cursor: pointer; }
  .chase-order-btn { flex: 1; }
  .chase-order-btn.recording { border-color: #ff4fd8; color: #fff; background: rgba(255, 79, 216, 0.18); }
  .chase-hint { margin: 0; font-size: 11px; color: #ff9ee9; }
</style>
