<script lang="ts">
  import { autopilotTargets, type VJAutopilot, type AutopilotTarget } from '../stores/vjAutopilot';
  export let value: VJAutopilot | undefined = undefined;

  export let columns = 8;
  export let onChange: (value: VJAutopilot | undefined) => void;
  function change(patch: Partial<VJAutopilot>) {
    onChange({ target: 'next', unit: 'beats', count: 4, ...value, ...patch });
  }
</script>
<div data-help-page="clip-launcher" class="autopilot">
  <label>Autopilot
    <select aria-label="Autopilot action" data-help="Choose how this layer advances through its clips. Launch a clip to start; empty cells are skipped." value={value?.target ?? 'none'}
      onchange={(e) => e.currentTarget.value === 'none' ? onChange(undefined) : change({ target: e.currentTarget.value as AutopilotTarget })}>
      {#each autopilotTargets as target}<option value={target.value}>{target.label}</option>{/each}
    </select>
  </label>
  {#if value && value.target !== 'none'}
    <label>After <input aria-label="Autopilot count" data-help="Wait this many beats or video loops before advancing the layer." type="number" min="1" max="999" step="1" value={value.count}
      onchange={(e) => change({ count: Number(e.currentTarget.value) })} />
      <select aria-label="Autopilot timing" data-help="Beats follows the performance clock; Loops counts completed video loops. Use Beats for mixed media." value={value.unit} onchange={(e) => change({ unit: e.currentTarget.value as 'beats' | 'loops' })}>
        <option value="beats">beats</option><option value="loops">loops</option>
      </select>
    </label>
    {#if value.target === 'column'}
      <label>Column <input aria-label="Autopilot target column" data-help="Choose the destination column for this layer when the autopilot interval completes." type="number" min="1" max={columns} value={(value.column ?? 0) + 1}
        onchange={(e) => change({ column: Math.max(0, Math.min(columns - 1, Number(e.currentTarget.value) - 1)) })} /></label>
    {/if}
    <p>Launch a clip to start. Continues across this layer; empty cells are skipped. Launches follow QUANT. Loops require video clips; use beats for mixed media. Held Piano clips wait for manual control.</p>
  {/if}
</div>
<style>
  .autopilot { padding: 10px 12px; border: 1px solid var(--ga-border, #333); border-radius: var(--ga-rSoft, 8px); margin: 10px 0 12px; font-size: var(--ga-type-control, 12px); }
  label { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
  select { flex: 1; min-width: 0; background: #222; color: #ddd; border: 1px solid #444; border-radius: 4px; padding: 4px; }
  input { width: 54px; background: #222; color: #ddd; border: 1px solid #444; padding: 4px; }
  p { margin: 4px 0 0; color: #aaa; font-size: 11px; }
</style>
