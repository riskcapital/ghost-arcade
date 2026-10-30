<script lang="ts">
  /**
   * The set's effects rack: patch instruments into its input. In the dub set
   * it is the echo chamber, with THROW and DROP to play the echoes.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import { FX_RACKS } from '../../music/studioSets';
  import { setDrop, setThrow } from '../../music/musicRuntime';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import StudioJack from './StudioJack.svelte';

  const s = $derived($musicStudio);
  const rack = $derived(FX_RACKS[s.set]);
  const fed = $derived(s.cables[s.set].filter((c) => c.to === 'fx:in').length);

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
</script>

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
        <div class="unit" class:wide={unit.params.length > 3}>
          <span class="unit-name">{unit.name}</span>
          <div class="unit-knobs">
            {#each unit.params as p (p.key)}
              <StudioKnob label={p.label} value={s.params[p.key]} defaultValue={p.default} size={22} title="{unit.name} {p.label}" onchange={(v) => musicStudio.setParam(p.key, v)} />
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </StudioModule>

<style>
  /* Units sit two to a row; one with more than three knobs takes a full row. */
  .units { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 12px; min-height: 0; }
  .unit { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .unit.wide { grid-column: 1 / -1; }
  .unit-name { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: var(--studio-muted); }
  .unit-knobs { display: flex; justify-content: space-between; }
  .throws { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .throw {
    height: 30px;
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
</style>
