<script lang="ts">
  /**
   * One cue action row: the fields for its kind. Every edit goes straight
   * to the cue engine (cueList.updateAction), which normalises the value.
   */
  import { cueList, type CueAction } from '../../show/cueList';
  import { compositions, project } from '../../stores/layers';
  import { snapshots } from '../../stores/snapshots';
  import { macros } from '../../stores/macros';
  import { projectors } from '../../show/projectors';
  import { validateControlPath } from '../../control/controlPaths';

  export let cueId: string;
  export let action: CueAction;

  const KIND_LABEL: Record<CueAction['kind'], string> = {
    preset: 'Mapping preset',
    snapshot: 'Snapshot',
    vjClip: 'VJ clip',
    vjColumn: 'VJ column',
    vjStopAll: 'Stop all VJ clips',
    blackout: 'Blackout',
    macro: 'Macro',
    layerOpacity: 'Layer opacity',
    param: 'Control path',
    timeline: 'Show timeline',
    projector: 'Projector',
  };

  function set(patch: Record<string, unknown>) {
    cueList.updateAction(cueId, action.id, patch);
  }
  function num(e: Event): number {
    return parseFloat((e.currentTarget as HTMLInputElement).value);
  }
  function val(e: Event): string {
    return (e.currentTarget as HTMLInputElement | HTMLSelectElement).value;
  }

  $: pathCheck = action.kind === 'param' && action.path ? validateControlPath(action.path) : null;
</script>

<div class="ca-row" data-cue-action={action.kind}>
  <span class="ca-kind">{KIND_LABEL[action.kind]}</span>

  {#if action.kind === 'preset'}
    <select class="ca-wide" value={action.compositionId} onchange={(e) => set({ compositionId: val(e) })} aria-label="Preset">
      <option value="">Choose preset</option>
      {#each $compositions as comp}
        <option value={comp.id}>{comp.name}</option>
      {/each}
    </select>
  {:else if action.kind === 'snapshot'}
    <select value={String(action.slot)} onchange={(e) => set({ slot: Number(val(e)) })} aria-label="Snapshot slot">
      {#each Array.from({ length: 16 }, (_, i) => i + 1) as slot}
        {@const snap = $snapshots.snapshots.find((s) => s.slot === slot)}
        <option value={String(slot)}>{slot}{snap?.name ? ` ${snap.name}` : ''}</option>
      {/each}
    </select>
  {:else if action.kind === 'vjClip' || action.kind === 'vjColumn'}
    <select value={action.deck} onchange={(e) => set({ deck: val(e) })} aria-label="Deck">
      <option value="A">Deck A</option>
      <option value="B">Deck B</option>
    </select>
    {#if action.kind === 'vjClip'}
      <label class="ca-field">Layer
        <input type="number" min="1" max="64" step="1" value={action.layer + 1} onchange={(e) => set({ layer: num(e) - 1 })} />
      </label>
    {/if}
    <label class="ca-field">Column
      <input type="number" min="1" max="256" step="1" value={action.column + 1} onchange={(e) => set({ column: num(e) - 1 })} />
    </label>
  {:else if action.kind === 'blackout'}
    <select value={action.on ? 'on' : 'off'} onchange={(e) => set({ on: val(e) === 'on' })} aria-label="Blackout">
      <option value="on">On</option>
      <option value="off">Off</option>
    </select>
  {:else if action.kind === 'macro' || action.kind === 'layerOpacity' || action.kind === 'param'}
    {#if action.kind === 'macro'}
      <select value={String(action.macro)} onchange={(e) => set({ macro: Number(val(e)) })} aria-label="Macro">
        {#each $macros.macros as m, i}
          <option value={String(i + 1)}>{i + 1} {m.name}</option>
        {/each}
      </select>
    {:else if action.kind === 'layerOpacity'}
      <select class="ca-wide" value={action.layerId} onchange={(e) => set({ layerId: val(e) })} aria-label="Layer">
        <option value="">Choose layer</option>
        {#each $project.layers as layer}
          <option value={layer.id}>{layer.name}</option>
        {/each}
      </select>
    {:else}
      <input
        class="ca-wide ca-path"
        class:invalid={pathCheck && !pathCheck.valid}
        type="text"
        placeholder="vj:master:opacity"
        value={action.path}
        onchange={(e) => set({ path: val(e) })}
        title={pathCheck?.reason ?? 'Any MIDI / OSC control path'}
        aria-label="Control path"
      />
    {/if}
    <label class="ca-field">To
      <input type="number" step="0.01" value={action.value} onchange={(e) => set({ value: num(e) })} />
    </label>
    {#if action.kind === 'param'}
      <label class="ca-field" title="Start value for the fade. Leave empty to start from the last value a cue set.">From
        <input type="number" step="0.01" value={action.from ?? ''} onchange={(e) => set({ from: val(e) === '' ? null : num(e) })} />
      </label>
    {/if}
    <label class="ca-field">Fade
      <input type="number" min="0" step="0.1" value={action.fade} onchange={(e) => set({ fade: num(e) })} />
      <span class="ca-unit">s</span>
    </label>
  {:else if action.kind === 'timeline'}
    <select value={action.op} onchange={(e) => set({ op: val(e) })} aria-label="Timeline action">
      <option value="play">Play</option>
      <option value="pause">Pause</option>
      <option value="stop">Stop and rewind</option>
      <option value="seek">Go to time</option>
    </select>
    {#if action.op === 'seek'}
      <label class="ca-field">At
        <input type="number" min="0" step="0.25" value={action.seconds} onchange={(e) => set({ seconds: num(e) })} />
        <span class="ca-unit">s</span>
      </label>
    {/if}
  {:else if action.kind === 'projector'}
    <select value={action.projectorId} onchange={(e) => set({ projectorId: val(e) })} aria-label="Projector">
      <option value="*">All projectors</option>
      {#each $projectors.projectors as p}
        <option value={p.id}>{p.name}</option>
      {/each}
    </select>
    <select value={action.command} onchange={(e) => set({ command: val(e) })} aria-label="Projector command">
      <option value="power-on">Power on</option>
      <option value="power-off">Power off</option>
      <option value="shutter-close">Shutter close</option>
      <option value="shutter-open">Shutter open</option>
      <option value="input">Input</option>
    </select>
    {#if action.command === 'input'}
      <input class="ca-code" type="text" maxlength="2" placeholder="31" value={action.input} onchange={(e) => set({ input: val(e).toUpperCase() })} title="PJLink input: 11-19 RGB, 21-29 video, 31-39 digital, 41-49 storage, 51-59 network" aria-label="Input code" />
    {/if}
  {/if}

  <button class="ca-remove" onclick={() => cueList.removeAction(cueId, action.id)} title="Remove this action" aria-label="Remove action">×</button>
</div>

<style>
  .ca-row {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px 6px;
    padding: 4px 6px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 4px;
    background: rgba(255, 255, 255, 0.02);
    font-size: 11px;
  }
  .ca-kind {
    color: var(--text-secondary, #aaa);
    font-weight: 600;
    min-width: 92px;
  }
  select, input {
    background: rgba(0, 0, 0, 0.4);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: var(--text-primary, #ddd);
    font-size: 11px;
    border-radius: 3px;
    padding: 2px 4px;
    font-family: inherit;
    min-width: 0;
  }
  input[type='number'] { width: 54px; }
  .ca-wide { flex: 1 1 120px; max-width: 200px; }
  .ca-path { font-family: var(--font-jetbrains), monospace; }
  .ca-path.invalid { border-color: #d9534f; }
  .ca-code { width: 36px; text-transform: uppercase; }
  .ca-field { display: inline-flex; align-items: center; gap: 3px; color: var(--text-muted, #888); }
  .ca-unit { color: var(--text-muted, #888); }
  .ca-remove {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--text-muted, #888);
    font-size: 15px;
    line-height: 1;
    cursor: pointer;
    padding: 0 3px;
  }
  .ca-remove:hover { color: #fff; }
</style>
