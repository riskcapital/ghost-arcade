<script lang="ts">
  /**
   * Modules both sets use: the effects rack (each set has its own effects),
   * the macro knobs with an input jack each, and the strip of layer jacks
   * beside the output.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { FX_RACKS } from '../../music/studioSets';
  import { macros } from '../../stores/macros';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { macroEditorId } from '../../music/studioUi';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  /** `columns`: 8 lays the macros out in one row, 4 in two compact rows. */
  let { part, columns = 4 }: { part: 'fx' | 'macros' | 'bay'; columns?: number } = $props();

  const s = $derived($musicStudio);
  const rack = $derived(FX_RACKS[s.set]);
  const fed = $derived(s.cables[s.set].filter((c) => c.to === 'fx:in').length);
  const macroCable = (id: string) => s.cables[s.set].find((c) => c.to === `dest:macro:${id}`);
</script>

{#if part === 'fx'}
  <StudioModule title="FX" subtitle={fed ? `${fed} patched in` : 'Patch an instrument in'}>
    {#snippet head()}
      <StudioJack id="fx:in" label="In" title="Effects rack input" />
    {/snippet}
    <div class="units">
      {#each rack as unit (unit.id)}
        <div class="unit">
          <span class="unit-name">{unit.name.toUpperCase()}</span>
          <div class="unit-knobs">
            {#each unit.params as p (p.key)}
              <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={32} onchange={(v) => musicStudio.setParam(p.key, v)} />
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </StudioModule>
{:else if part === 'macros'}
  <StudioModule title="MACROS" subtitle="Patch a signal into a knob">
    <div class="macro-grid" class:compact={columns < 8} style="grid-template-columns: repeat({columns}, minmax(0, 1fr))">
      {#each $macros.macros as m (m.id)}
        {@const cable = macroCable(m.id)}
        {@const count = m.effects.length + (s.macroFx[m.id]?.length ?? 0)}
        <div class="macro">
          <StudioKnob label={m.name} value={m.value} size={columns < 8 ? 28 : 44} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => macros.setMacroValue(m.id, v)} midiPath="vj:macro:{m.id.replace('macro-', '')}:value" />
          <button class="fx-btn" class:has={count > 0} class:open={$macroEditorId === m.id} onclick={() => macroEditorId.set($macroEditorId === m.id ? null : m.id)} title="Sound and visual effects on {m.name}{cable ? ' (patched)' : ''}">
            FX{count ? ` ${count}` : ''}
          </button>
          <StudioJack id="dest:macro:{m.id}" title="Turn {m.name} with a control signal" />
        </div>
      {/each}
    </div>
  </StudioModule>
{:else}
  <div class="bay" role="group" aria-label="Layer inputs">
    <span class="bay-title">LAYERS</span>
    {#each $vjClipLauncher.layerStates as _, i (i)}
      <StudioJack id="dest:layer:{i}" label="L{i + 1}" title="Pulse layer {i + 1} with a control signal" />
    {/each}
  </div>
{/if}

<style>
  .units { display: flex; flex-direction: column; }
  .unit { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid var(--studio-edge-soft); }
  .unit:last-child { border-bottom: 0; }
  .unit-name { width: 72px; font-size: 11px; font-weight: 800; letter-spacing: 0.1em; }
  .unit-knobs { flex: 1; display: flex; justify-content: space-around; }
  .macro-grid { display: grid; gap: 8px 4px; }
  .macro-grid.compact { gap: 4px; }
  .macro { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .fx-btn {
    height: 18px;
    padding: 0 7px;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .fx-btn.has { color: var(--studio-ink); }
  .fx-btn.open { border-color: var(--studio-accent); color: var(--studio-accent); }
  .bay {
    width: 48px;
    box-sizing: border-box;
    padding: 10px 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .bay-title { font-size: 8px; font-weight: 800; letter-spacing: 0.1em; color: var(--studio-accent); }
</style>
