<script lang="ts">
  /** Scenes tab: starter scenes and the scenes saved on this device. */
  import Icon from './StudioIcon.svelte';
  import InfoTip from './ui/InfoTip.svelte';
  import { isWorldStarter } from '../../mobile/studio/interactiveLibrary';
  import { phoneStarters } from '../../mobile/studio/phoneStarters';
  import {
    type InteractiveStarter,
    type SavedInteractiveScene,
  } from '../../mobile/studio/interactiveLibrary';

  export let savedScenes: SavedInteractiveScene[] = [];
  /** The scene removed last, offered back with one button. */
  export let removedScene: SavedInteractiveScene | undefined = undefined;
  /** The phone keeps the working scene as a draft; on desktop it lives in the project. */
  export let persistDraft = false;
  /** A paired desktop has the 3D world: its starters are offered too, as on the desktop. */
  export let world = false;
  $: starters = phoneStarters(world);
  $: groups = world
    ? [{ label: '', cards: starters.filter((s) => !isWorldStarter(s.id)) }, { label: 'In the 3D world', cards: starters.filter((s) => isWorldStarter(s.id)) }]
    : [{ label: '', cards: starters }];

  export let onstarter: (id: InteractiveStarter) => void;
  export let onsave: () => void;
  export let onrecall: (id: string) => void;
  export let onremove: (id: string) => void;
  export let onundoremove: () => void;
</script>

<div class="panel-heading"><strong>Start with a scene</strong><InfoTip label="About starter scenes" text="Choose a starting point, then add effects and move objects to make it yours. Undo brings your previous scene back." /><span>Ready to play</span></div>
{#each groups as group}
  {#if group.label}<div class="group-label">{group.label}</div>{/if}
  <div class="starter-grid">
    {#each group.cards as starter}
      <button class="starter" style:--starter-color={starter.color} onclick={() => onstarter(starter.id)}>
        <Icon name={starter.icon} size={24} />
        <strong>{starter.name}</strong>
        <span>{starter.description}</span>
      </button>
    {/each}
  </div>
{/each}
<div class="panel-heading saved-heading">
  <strong>Your scenes</strong>
  <button onclick={onsave}><Icon name="save" size={16} />Save current</button>
</div>
{#if !savedScenes.length}
  <p class="hint">
    {persistDraft
      ? 'Save a scene to keep a version. Your current draft saves automatically on this device.'
      : 'Save a scene to keep a version on this computer. The current scene is part of your project.'}
  </p>
{/if}
<div class="saved-scenes">
  {#each savedScenes as saved}
    <div class="saved-row">
      <button onclick={() => onrecall(saved.id)}>
        <strong>{saved.scene.name}</strong>
        <small>{saved.scene.effects?.length ?? 1} effects · {saved.scene.surfaces.length} objects</small>
      </button>
      <button
        class="delete-saved"
        aria-label={`Remove saved scene ${saved.scene.name}`}
        onclick={() => onremove(saved.id)}
      >
        <Icon name="trash" size={16} />
      </button>
    </div>
  {/each}
</div>
{#if removedScene}
  <button class="wide" onclick={onundoremove}>Undo removing {removedScene.scene.name}</button>
{/if}
