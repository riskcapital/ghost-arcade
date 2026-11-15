<script lang="ts">
  /**
   * Build one show action on the phone, from the desktop's menu (its kinds,
   * Looks, presets and sections): what to do, then its target. The phone's
   * version of the desktop's show-action picker. Emits a complete action with
   * `onchange`, or null while the choice is not yet complete.
   */
  import type { ShowAction, ShowActionKind } from '../../show/showActionTypes';
  import { editShowAction, fromOne, startShowAction, type ShowActionMenu } from '../../mobile/studio/showActionMenu';

  export let menu: ShowActionMenu;
  export let action: ShowAction | null = null;
  export let onchange: (action: ShowAction | null) => void;

  let kindPicked: ShowActionKind | '' = '';
  $: kind = action?.kind ?? kindPicked;

  function pickKind(next: ShowActionKind) {
    kindPicked = next;
    onchange(startShowAction(next, menu));
  }
  /** Patch the current action, keeping its kind; a change the desktop would refuse is ignored. */
  function set(patch: Record<string, unknown>) {
    if (!action) return;
    const next = editShowAction(action, patch);
    if (next) onchange(next);
  }
</script>

<div class="show-picker">
  <label>
    Do
    <select value={kind} onchange={(e) => pickKind(e.currentTarget.value as ShowActionKind)}>
      <option value="" disabled>Choose…</option>
      {#each menu.kinds as k}
        <option value={k.kind}>{k.label}</option>
      {/each}
    </select>
  </label>

  {#if kind === 'look'}
    <label>
      Look
      <select value={action?.kind === 'look' ? action.lookId : ''} disabled={!menu.looks.length} onchange={(e) => onchange({ kind: 'look', lookId: e.currentTarget.value })}>
        <option value="" disabled>{menu.looks.length ? 'Choose a Look…' : 'The desktop lists no Looks'}</option>
        {#each menu.looks as look}<option value={look.id}>{look.name}</option>{/each}
      </select>
    </label>
  {:else if kind === 'preset'}
    <label>
      Preset
      <select value={action?.kind === 'preset' ? action.compositionId : ''} disabled={!menu.presets.length} onchange={(e) => onchange({ kind: 'preset', compositionId: e.currentTarget.value })}>
        <option value="" disabled>{menu.presets.length ? 'Choose a preset…' : 'No presets in the desktop project'}</option>
        {#each menu.presets as c}<option value={c.id}>{c.name}</option>{/each}
      </select>
    </label>
  {:else if (kind === 'clip' || kind === 'clipColumn') && (action?.kind === 'clip' || action?.kind === 'clipColumn')}
    <div class="row">
      <label>
        Deck
        <select value={action.deck ?? 'A'} onchange={(e) => set({ deck: e.currentTarget.value })}>
          <option value="A">A</option>
          <option value="B">B</option>
        </select>
      </label>
      {#if action.kind === 'clip'}
        <label>
          Row
          <input type="number" inputmode="numeric" min="1" max="256" value={action.row + 1} onchange={(e) => set({ row: fromOne(e.currentTarget.value) })} />
        </label>
      {/if}
      <label>
        Column
        <input type="number" inputmode="numeric" min="1" max="256" value={action.column + 1} onchange={(e) => set({ column: fromOne(e.currentTarget.value) })} />
      </label>
    </div>
  {:else if kind === 'section' && action?.kind === 'section'}
    {#if menu.sections.length}
      <label>
        Section
        <select value={action.id ?? ''} onchange={(e) => onchange({ kind: 'section', id: e.currentTarget.value })}>
          {#each menu.sections as section}<option value={section.id}>{section.name}</option>{/each}
        </select>
      </label>
    {:else}
      <label>
        Section number
        <input type="number" inputmode="numeric" min="1" max="1000" value={(action.index ?? 0) + 1} onchange={(e) => onchange({ kind: 'section', index: fromOne(e.currentTarget.value, 999) })} />
      </label>
      <p class="hint">The desktop's Timeline has no sections yet: this jumps to the section at that place.</p>
    {/if}
  {:else if kind === 'cue' && action?.kind === 'cue'}
    <div class="row">
      <label>
        Cue list
        <select value={action.op} onchange={(e) => onchange(e.currentTarget.value === 'fire' ? { kind: 'cue', op: 'fire', index: 0 } : { kind: 'cue', op: e.currentTarget.value as 'go' })}>
          <option value="go">GO</option>
          <option value="back">Back</option>
          <option value="stop">Stop</option>
          <option value="reset">Reset</option>
          <option value="fire">Fire cue…</option>
        </select>
      </label>
      {#if action.op === 'fire'}
        <label>
          Cue
          <input type="number" inputmode="numeric" min="1" max="9999" value={(action.index ?? 0) + 1} onchange={(e) => set({ index: fromOne(e.currentTarget.value, 9998) })} />
        </label>
      {/if}
    </div>
  {:else if kind === 'phrase' && action?.kind === 'phrase'}
    <label>
      Pad
      <input type="number" inputmode="numeric" min="1" max="64" value={action.pad ?? 1} onchange={(e) => onchange({ kind: 'phrase', pad: fromOne(e.currentTarget.value, 63) + 1 })} />
    </label>
  {:else if kind === 'liveClip' && action?.kind === 'liveClip'}
    <div class="row">
      <label>
        Track
        <input type="number" inputmode="numeric" min="1" max="1000" value={action.track + 1} onchange={(e) => set({ track: fromOne(e.currentTarget.value, 999) })} />
      </label>
      <label>
        Slot
        <input type="number" inputmode="numeric" min="1" max="1000" value={action.slot + 1} onchange={(e) => set({ slot: fromOne(e.currentTarget.value, 999) })} />
      </label>
    </div>
  {:else if kind === 'liveScene' && action?.kind === 'liveScene'}
    <label>
      Scene
      <input type="number" inputmode="numeric" min="1" max="1000" value={action.scene + 1} onchange={(e) => set({ scene: fromOne(e.currentTarget.value, 999) })} />
    </label>
  {:else if kind === 'blackout' && action?.kind === 'blackout'}
    <label>
      Blackout
      <select
        value={action.on === undefined ? 'toggle' : action.on ? 'on' : 'off'}
        onchange={(e) => onchange(e.currentTarget.value === 'toggle' ? { kind: 'blackout' } : { kind: 'blackout', on: e.currentTarget.value === 'on' })}
      >
        <option value="toggle">Toggle</option>
        <option value="on">On</option>
        <option value="off">Off</option>
      </select>
    </label>
  {:else if kind === 'transport' && action?.kind === 'transport'}
    <label>
      Transport
      <select value={action.op} onchange={(e) => onchange({ kind: 'transport', op: e.currentTarget.value as 'toggle' })}>
        <option value="toggle">Play / pause</option>
        <option value="play">Play</option>
        <option value="pause">Pause</option>
        <option value="stop">Stop</option>
      </select>
    </label>
  {/if}
</div>

<style>
  .show-picker {
    display: grid;
    gap: 8px;
  }
  .row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(88px, 1fr));
    gap: 8px;
  }
</style>
