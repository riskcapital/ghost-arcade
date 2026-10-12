<script lang="ts">
  import { macros } from '../stores/macros';
  import { macroTargetKey, type MacroTarget } from '../stores/macroAssignments';
  export let target: MacroTarget | null;
  export let label: string;
  export let min = 0;
  export let max = 1;
  export let beforeAssign: (() => void) | undefined = undefined;
  $: owner = target ? $macros.macros.find(m => m.assignments?.some(a => macroTargetKey(a.target) === macroTargetKey(target!))) : undefined;
  function assign(id: string) {
    if (!target) return;
    if (!id) { macros.unassignParameter(target); return; }
    beforeAssign?.();
    macros.assignParameter(id, { target, label, min, max, from: min, to: max });
  }
</script>
{#if target && min < max}
  <select aria-label={`Assign ${label} to macro`} title="Assign a macro; edit its range by right-clicking the macro knob" value={owner?.id ?? ''} onchange={e => assign(e.currentTarget.value)}>
    <option value="">Macro</option>
    {#each $macros.macros as macro}<option value={macro.id}>{macro.name}</option>{/each}
  </select>
{/if}
<style>
  select { max-width: 80px; min-width: 0; border: 1px solid #344467; border-radius: 5px; background: #172747; color: #cbd9f5; font-size: 10px; padding: 2px; }
</style>
