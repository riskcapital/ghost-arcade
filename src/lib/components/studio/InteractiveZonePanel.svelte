<script lang="ts">
  /**
   * "When touched": what a trigger zone does. A list of actions, a way to add
   * one, the re-arm time, and Test. The desktop fires the zone when a touch
   * (this phone's included), a tracked hand or body, or a ball comes into it.
   *
   * The phone's version of the desktop panel. Show actions (a Look, a VJ
   * clip, a cue…) name things only the desktop has: with a desktop that lists
   * them (`showMenu`, from its capabilities) the phone adds them from that
   * list; otherwise it keeps and shows the ones a scene already has. Test
   * fires the zone's bursts (a scene change) and its world actions
   * (studio_world_action); show actions fire on the desktop when the zone does.
   */
  import {
    MAX_ZONE_ACTIONS,
    ZONE_REARM_MAX,
    ZONE_REARM_MIN,
    type ZoneAction,
    type ZoneTrigger,
    type ZoneWorldAction,
    type ZoneSource,
  } from '../../mobile/studio/interactive';
  import type { ShowAction } from '../../show/showActionTypes';
  import { describeShowAction, type ShowActionMenu } from '../../mobile/studio/showActionMenu';
  import InfoTip from './ui/InfoTip.svelte';
  import PhoneShowActionPicker from './PhoneShowActionPicker.svelte';

  export let trigger: ZoneTrigger;
  /** Effects aimed at this zone: what a burst fires. */
  export let burstTargets = 0;
  /** `step` is a single change and its own undo step. */
  export let onchange: (trigger: ZoneTrigger, step: boolean) => void;
  /** The re-arm slider is about to change: remember the scene for undo. */
  export let onrearmstart: () => void;
  export let ontest: () => void;
  /** The scene's 3D world is on: offer what the zone can do to it. */
  export let world = false;
  /** The desktop's show actions (its kinds, Looks, presets, sections); null: none can be added here. */
  export let showMenu: ShowActionMenu | null = null;
  /** The picker opened: ask the desktop for its lists again (presets and sections change). */
  export let onshowmenu: () => void = () => {};

  const WORLD_LABELS: Record<ZoneWorldAction, string> = {
    ignite: 'Set fire here',
    pour: 'Pour paint here',
    balls: 'Drop balls from here',
  };
  const WORLD_ADD: Record<ZoneWorldAction, string> = { ignite: '+ Fire', pour: '+ Paint', balls: '+ Balls' };
  const SOURCES: { value: ZoneSource; label: string }[] = [
    { value: 'touch', label: 'Touch' },
    { value: 'ball', label: 'Ball' },
    { value: 'either', label: 'Either' },
  ];
  $: when = (world ? trigger.when : undefined) ?? 'touch';
  $: heading = when === 'ball' ? 'When a ball comes in' : when === 'either' ? 'When touched or a ball comes in' : 'When touched';
  function setWhen(value: ZoneSource) {
    const { when: _old, ...rest } = trigger;
    onchange(value === 'touch' ? rest : { ...rest, when: value }, true);
  }

  function label(a: ZoneAction): string {
    if (a.kind === 'world') return world ? WORLD_LABELS[a.what] : `${WORLD_LABELS[a.what]} · needs the 3D world`;
    if (a.kind === 'burst') return burstTargets ? `Burst · ${burstTargets} effect${burstTargets === 1 ? '' : 's'} on this zone` : 'Burst · no effect is aimed at this zone';
    return describeShowAction(a.action, showMenu);
  }
  $: full = trigger.actions.length >= MAX_ZONE_ACTIONS;
  $: hasBurst = trigger.actions.some((a) => a.kind === 'burst');

  function remove(index: number) {
    onchange({ ...trigger, actions: trigger.actions.filter((_, i) => i !== index) }, true);
  }
  let adding = false;
  let draft: ShowAction | null = null;
  $: if (!showMenu && adding) { adding = false; draft = null; }
  function startShow() {
    adding = true;
    draft = null;
    onshowmenu();
  }
  function addShow() {
    if (!draft) return;
    onchange({ ...trigger, actions: [...trigger.actions, { kind: 'show', action: draft }] }, true);
    draft = null;
    adding = false;
  }
  function addWorld(what: ZoneWorldAction) {
    onchange({ ...trigger, actions: [...trigger.actions, { kind: 'world', what }] }, true);
  }
  function addBurst() {
    onchange({ ...trigger, actions: [...trigger.actions, { kind: 'burst' }] }, true);
  }
</script>

{#if world}
  <div class="world-flat zone-when" role="group" aria-label="What sets the zone off">
    {#each SOURCES as source}
      <button class:active={when === source.value} aria-pressed={when === source.value} onclick={() => setWhen(source.value)}>{source.label}</button>
    {/each}
  </div>
{/if}
<div class="group-label zone-heading">
  {heading}
  <InfoTip
    label="How trigger zones fire"
    text={when === 'touch'
      ? `The desktop fires the zone once when a touch, a tracked hand or a body comes into it. A touch held there does not fire again until it leaves. ${showMenu ? 'Show actions (a Look, a VJ clip, a cue) run on the desktop when the zone fires; Test here fires the bursts and world actions.' : 'Show actions (a Look, a VJ clip, a cue) are added on the desktop.'}`
      : 'The desktop fires the zone when a ball of the 3D world comes into it, as seen on the output, at most once per re-arm time.'}
  />
</div>
{#if trigger.actions.length}
  <ol class="zone-actions">
    {#each trigger.actions as a, i}
      <li class:muted={(a.kind === 'burst' && !burstTargets) || (a.kind === 'world' && !world)}>
        <span>{label(a)}</span>
        <button class="remove" aria-label="Remove this action" title="Remove" onclick={() => remove(i)}>×</button>
      </li>
    {/each}
  </ol>
{:else}
  <p class="hint">Nothing happens yet. Add what this zone should do.</p>
{/if}

{#if adding && showMenu}
  <div class="add-show" role="group" aria-label="Add a show action">
    <PhoneShowActionPicker menu={showMenu} action={draft} onchange={(a) => (draft = a)} />
    <div class="tools">
      <button class="primary" disabled={!draft} onclick={addShow}>Add</button>
      <button onclick={() => { adding = false; draft = null; }}>Cancel</button>
    </div>
  </div>
{:else}
  <div class="tools">
    {#if showMenu}<button disabled={full} onclick={startShow}>+ Show action</button>{/if}
    <button disabled={full || hasBurst} onclick={addBurst}>+ Burst</button>
    {#if world}
      {#each Object.keys(WORLD_ADD) as what}
        <button
          disabled={full || trigger.actions.some((a) => a.kind === 'world' && a.what === what)}
          onclick={() => addWorld(what as ZoneWorldAction)}>{WORLD_ADD[what as ZoneWorldAction]}</button
        >
      {/each}
    {/if}
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
<button class="wide" disabled={!(hasBurst && burstTargets) && !(world && trigger.actions.some((a) => a.kind === 'world'))} onclick={ontest}>Test</button>

<style>
  .zone-heading {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .zone-actions {
    list-style: none;
    margin: 0 0 8px;
    padding: 0;
    display: grid;
    gap: 2px;
  }
  .zone-actions li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 44px;
    padding: 0 0 0 2px;
    border-bottom: 1px solid var(--ga-line-2, #34383f);
    font-size: 13px;
  }
  .zone-actions li span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .zone-actions li.muted span {
    color: var(--ga-ink-3, var(--ga-ink-2));
  }
  .zone-actions .remove {
    min-width: 44px;
    padding: 0;
  }
  .add-show {
    display: grid;
    gap: 8px;
    margin-bottom: 8px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--ga-line-2, #34383f);
  }
  .add-show .primary:not(:disabled) {
    background: var(--ga-act-bg);
    border-color: var(--ga-act-line);
    color: var(--ga-act-ink);
    font-weight: 700;
  }
</style>
