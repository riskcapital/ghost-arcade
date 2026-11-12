<script lang="ts">
  /**
   * "When touched": what a trigger zone does. A list of actions, a way to add
   * one, the re-arm time, and Test to fire them now. The zone fires when a
   * pointer, hand or body comes into it, editor open or not.
   */
  import {
    MAX_ZONE_ACTIONS,
    ZONE_REARM_MAX,
    ZONE_REARM_MIN,
    type ZoneAction,
    type ZoneTrigger,
  } from '../../mobile/studio/interactive';
  import type { ShowAction } from '../../show/showActions';
  import { describeShowAction } from '../../show/showActionLabels';
  import { compositions } from '../../stores/layers';
  import { showTimeline } from '../../stores/showTimeline';
  import ShowActionPicker from '../show/ShowActionPicker.svelte';

  export let trigger: ZoneTrigger;
  /** Effects aimed at this zone: what a burst fires. */
  export let burstTargets = 0;
  /** `step` is a single change and its own undo step. */
  export let onchange: (trigger: ZoneTrigger, step: boolean) => void;
  /** The re-arm slider is about to change: remember the scene for undo. */
  export let onrearmstart: () => void;
  export let ontest: () => void;

  let adding = false;
  let draft: ShowAction | null = null;

  const names = {
    preset: (id: string) => $compositions.find((c) => c.id === id)?.name,
    section: (id: string) => ($showTimeline.sections ?? []).find((s) => s.id === id)?.name,
  };
  function label(a: ZoneAction): string {
    if (a.kind === 'burst') return burstTargets ? `Burst · ${burstTargets} effect${burstTargets === 1 ? '' : 's'} on this zone` : 'Burst · no effect is aimed at this zone';
    return describeShowAction(a.action, names);
  }
  $: full = trigger.actions.length >= MAX_ZONE_ACTIONS;
  $: hasBurst = trigger.actions.some((a) => a.kind === 'burst');

  function remove(index: number) {
    onchange({ ...trigger, actions: trigger.actions.filter((_, i) => i !== index) }, true);
  }
  function addShow() {
    if (!draft) return;
    onchange({ ...trigger, actions: [...trigger.actions, { kind: 'show', action: draft }] }, true);
    draft = null;
    adding = false;
  }
  function addBurst() {
    onchange({ ...trigger, actions: [...trigger.actions, { kind: 'burst' }] }, true);
  }
</script>

<div class="group-label">When touched</div>
{#if trigger.actions.length}
  <ol class="zone-actions">
    {#each trigger.actions as a, i}
      <li class:muted={a.kind === 'burst' && !burstTargets}>
        <span>{label(a)}</span>
        <button class="remove" aria-label="Remove this action" title="Remove" onclick={() => remove(i)}>×</button>
      </li>
    {/each}
  </ol>
{:else}
  <p class="hint">Nothing happens yet. Add what this zone should do.</p>
{/if}

{#if adding}
  <div class="add">
    <ShowActionPicker action={draft} onchange={(a) => (draft = a)} />
    <div class="tools">
      <button disabled={!draft} onclick={addShow}>Add</button>
      <button onclick={() => { adding = false; draft = null; }}>Cancel</button>
    </div>
  </div>
{:else}
  <div class="tools">
    <button disabled={full} onclick={() => (adding = true)}>+ Show action</button>
    <button disabled={full || hasBurst} onclick={addBurst}>+ Burst</button>
  </div>
{/if}

<label>
  Re-arm after <output>{trigger.rearm.toFixed(1)} s</output>
  <input
    type="range"
    min={ZONE_REARM_MIN}
    max={10}
    step=".1"
    value={Math.min(10, trigger.rearm)}
    onpointerdown={onrearmstart}
    oninput={(e) => onchange({ ...trigger, rearm: Math.max(ZONE_REARM_MIN, Math.min(ZONE_REARM_MAX, +e.currentTarget.value)) }, false)}
  />
</label>
<p class="hint">Fires once when something comes into the zone. A touch held there does not fire again until it leaves.</p>
<button class="wide" disabled={!trigger.actions.length} onclick={ontest}>Test</button>

<style>
  .zone-actions {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .zone-actions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: var(--ga-control-h, 28px);
    padding: 0 4px 0 8px;
    border: 1px solid var(--ga-line-2, #34383f);
    border-radius: var(--ga-radius-sm, 4px);
    font-size: var(--ga-text-body, 12px);
  }
  .zone-actions li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zone-actions li.muted span {
    color: var(--ga-ink-3);
  }
  .zone-actions .remove {
    min-height: var(--ga-control-h-sm, 22px);
    padding: 0 7px;
  }
  .add {
    display: grid;
    gap: 8px;
    margin-bottom: 8px;
  }
</style>
