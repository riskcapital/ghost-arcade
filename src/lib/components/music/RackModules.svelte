<script lang="ts">
  /**
   * Modules every set uses: the effects rack (each set has its own effects),
   * the macro knobs with an input jack each, and the visual layers of deck A
   * with the set's own visuals to pick from.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { FX_RACKS, sourceLabel } from '../../music/studioSets';
  import { SET_VISUALS, setLayerVisual } from '../../music/noteShaders';
  import { loadBerlinJam, loadDubJam } from '../../music/jams';
  import { setDrop, setThrow } from '../../music/musicRuntime';
  import { macros } from '../../stores/macros';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { macroEditorId } from '../../music/studioUi';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  /** `columns`: 8 lays the macros out in one row, 4 in two compact rows. */
  let { part, columns = 4 }: { part: 'fx' | 'macros' | 'layers'; columns?: number } = $props();

  const s = $derived($musicStudio);
  const rack = $derived(FX_RACKS[s.set]);
  const fed = $derived(s.cables[s.set].filter((c) => c.to === 'fx:in').length);
  const macroCable = (id: string) => s.cables[s.set].find((c) => c.to === `dest:macro:${id}`);
  const visuals = $derived(SET_VISUALS[s.set]);
  const jam = $derived(s.set === 'berlin' ? loadBerlinJam : s.set === 'dub' ? loadDubJam : null);

  let throwing = $state(false);
  let dropping = $state(false);

  /** THROW and DROP last as long as they are held. */
  function press(kind: 'throw' | 'drop', on: boolean, e?: PointerEvent) {
    if (e) {
      e.preventDefault();
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    }
    if (kind === 'throw') {
      if (throwing === on) return;
      throwing = on;
      setThrow(on);
    } else {
      if (dropping === on) return;
      dropping = on;
      setDrop(on);
    }
  }

  // Let go of a held throw or drop if the rack goes away mid-press.
  $effect(() => () => {
    if (throwing) setThrow(false);
    if (dropping) setDrop(false);
  });

  function drivenBy(layer: number): string {
    const cable = s.cables[s.set].find((c) => c.to === `dest:layer:${layer}`);
    return cable ? `${sourceLabel(cable.from)} → pulse` : 'Always on';
  }

  function pickVisual(layer: number, e: Event) {
    const el = e.target as HTMLSelectElement;
    const visual = visuals.find((g) => g.file === el.value);
    if (visual) void setLayerVisual(layer, visual.file, visual.name);
    el.value = '';
  }
</script>

{#if part === 'fx'}
  <StudioModule title={s.set === 'dub' ? 'ECHO CHAMBER' : 'FX'} subtitle={fed ? `${fed} patched in` : 'Patch an instrument in'}>
    {#snippet head()}
      <StudioJack id="fx:in" label="In" title="Effects rack input" />
    {/snippet}
    {#if s.set === 'dub'}
      <div class="throws">
        <button
          class="throw"
          class:on={throwing}
          onpointerdown={(e) => press('throw', true, e)}
          onpointerup={() => press('throw', false)}
          onpointercancel={() => press('throw', false)}
          title="Hold: everything in the chamber floods the tape echo"
        >THROW</button>
        <button
          class="throw"
          class:on={dropping}
          onpointerdown={(e) => press('drop', true, e)}
          onpointerup={() => press('drop', false)}
          onpointercancel={() => press('drop', false)}
          title="Hold: the drums and bass drop out and the echoes carry on"
        >DROP</button>
      </div>
    {/if}
    <div class="units">
      {#each rack as unit (unit.id)}
        <div class="unit">
          <span class="unit-name">{unit.name}</span>
          <div class="unit-knobs">
            {#each unit.params as p (p.key)}
              <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={unit.params.length > 3 ? 26 : 30} title="{unit.name} {p.label}" onchange={(v) => musicStudio.setParam(p.key, v)} />
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
          <StudioKnob label={m.name} value={m.value} size={columns < 8 ? 26 : 38} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => macros.setMacroValue(m.id, v)} midiPath="vj:macro:{m.id.replace('macro-', '')}:value" />
          <div class="macro-foot">
            <button class="fx-btn" class:has={count > 0} class:open={$macroEditorId === m.id} onclick={() => macroEditorId.set($macroEditorId === m.id ? null : m.id)} title="Sound and visual effects on {m.name}{cable ? ' (patched)' : ''}">
              FX{count ? ` ${count}` : ''}
            </button>
            <StudioJack id="dest:macro:{m.id}" title="Turn {m.name} with a control signal" />
          </div>
        </div>
      {/each}
    </div>
  </StudioModule>
{:else}
  <StudioModule title="VISUAL LAYERS" subtitle="Deck A · patch any signal into a layer" grow>
    {#snippet head()}
      {#if jam}
        <button class="jam" onclick={() => void jam()} title="Load the set's ready-made jam: a groove, its visuals on the layers and the cables between them">LOAD JAM</button>
      {/if}
    {/snippet}
    <div class="layers">
      {#each $vjClipLauncher.layerStates as layer, i (i)}
        <div class="layer" class:muted={layer.mute}>
          <button class="toggle" class:on={!layer.mute} onclick={() => vjClipLauncher.toggleLayerMute(i, 'A')} aria-pressed={!layer.mute} aria-label="Layer {i + 1} on"></button>
          <div class="layer-name">
            <span class="ln">L{i + 1} · {drivenBy(i)}</span>
            <select class="visual" value="" onchange={(e) => pickVisual(i, e)} aria-label="Visual for layer {i + 1}">
              <option value="" disabled>{layer.activeClip?.name ?? 'Empty'}</option>
              {#each visuals as g (g.file)}<option value={g.file}>{g.name}</option>{/each}
            </select>
          </div>
          <input
            class="opacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={layer.opacity}
            oninput={(e) => vjClipLauncher.setLayerOpacity(i, +(e.target as HTMLInputElement).value, 'A')}
            aria-label="Layer {i + 1} opacity"
          />
          <StudioJack id="dest:layer:{i}" title="Pulse layer {i + 1} with a control signal" />
        </div>
      {/each}
    </div>
  </StudioModule>
{/if}

<style>
  .units { display: flex; flex-direction: column; min-height: 0; }
  .unit { display: flex; align-items: center; gap: 8px; padding: 4px 0; border-bottom: 1px solid var(--studio-edge-soft); }
  .unit:last-child { border-bottom: 0; }
  .unit-name { width: 68px; flex: 0 0 auto; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .unit-knobs { flex: 1; display: flex; justify-content: space-around; }
  .throws { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .throw {
    height: 34px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.14em;
    cursor: pointer;
    touch-action: none;
  }
  .throw.on { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); box-shadow: 0 0 14px var(--studio-accent-soft); }
  .macro-grid { display: grid; gap: 8px 4px; }
  .macro-grid.compact { gap: 6px 4px; }
  .macro { display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
  .macro-foot { display: flex; align-items: center; gap: 6px; }
  .fx-btn {
    height: 18px;
    padding: 0 6px;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .fx-btn.has { color: var(--studio-ink); }
  .fx-btn.open { border-color: var(--studio-accent); color: var(--studio-accent); }
  .layers { flex: 1; display: flex; flex-direction: column; min-height: 0; overflow: auto; }
  .layer {
    flex: 1 1 0;
    min-height: 44px;
    max-height: 60px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--studio-edge-soft);
  }
  .layer:last-child { border-bottom: 0; }
  .toggle {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
    padding: 0;
    border: 1px solid var(--studio-edge);
    background: transparent;
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .toggle.on { background: var(--studio-accent); border-color: var(--studio-accent); }
  .layer-name { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ln { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--studio-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .visual {
    width: 100%;
    height: 24px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 12px;
  }
  .layer.muted .visual { color: var(--studio-muted); }
  .opacity { flex: 0 0 90px; width: 90px; }
  .jam {
    height: 22px;
    padding: 0 9px;
    border: 1px solid var(--studio-accent);
    background: var(--studio-accent-soft);
    color: var(--studio-accent);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
</style>
