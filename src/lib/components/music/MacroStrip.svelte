<script lang="ts">
  /**
   * The app's eight macro knobs, in the Studio's top bar as they are in the
   * app's. Each has its effects (FX) and a jack, so any signal can turn it.
   */
  import { macros } from '../../stores/macros';
  import { musicStudio } from '../../music/musicStudioStore';
  import { macroEditorId } from '../../music/studioUi';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  const s = $derived($musicStudio);
</script>

<div class="macros" role="group" aria-label="Macros">
  {#each $macros.macros as m (m.id)}
    {@const count = m.effects.length + (s.macroFx[m.id]?.length ?? 0)}
    {@const patched = s.cables[s.set].some((c) => c.to === `dest:macro:${m.id}`)}
    <div class="macro">
      <StudioKnob label={m.name} value={m.value} size={22} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => macros.setMacroValue(m.id, v)} midiPath="vj:macro:{m.id.replace('macro-', '')}:value" />
      <div class="side">
        <button class="fx" class:has={count > 0} class:open={$macroEditorId === m.id} onclick={() => macroEditorId.set($macroEditorId === m.id ? null : m.id)} title="Sound and visual effects on {m.name}{patched ? ' (patched)' : ''}">
          FX{count ? count : ''}
        </button>
        <StudioJack id="dest:macro:{m.id}" title="Turn {m.name} with a control signal" />
      </div>
    </div>
  {/each}
</div>

<style>
  .macros { display: flex; align-items: center; gap: 4px; }
  .macro { display: flex; align-items: center; gap: 2px; }
  .macro :global(.knob-wrap) { min-width: 40px; gap: 1px; }
  .side { display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .side :global(.jack-wrap) { transform: scale(0.8); margin: -3px 0; }
  .side :global(.jack-label) { display: none; }
  .fx {
    height: 14px;
    min-width: 22px;
    padding: 0 3px;
    border: 1px solid var(--studio-edge-soft);
    background: transparent;
    color: var(--studio-muted);
    border-radius: 3px;
    font: inherit;
    font-size: var(--ga-text-micro, 9px);
    font-weight: 700;
    letter-spacing: 0;
    cursor: pointer;
  }
  .fx.has { color: var(--studio-accent); border-color: var(--studio-accent); }
  .fx.open { background: var(--studio-accent-soft); }
</style>
