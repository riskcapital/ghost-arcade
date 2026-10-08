<script lang="ts">
  /** Scenes tab: starter scenes and the scenes saved on this device. */
  import Icon from './StudioIcon.svelte';
  import {
    INTERACTIVE_STARTERS,
    type InteractiveStarter,
    type SavedInteractiveScene,
  } from '../../mobile/studio/interactiveLibrary';

  export let savedScenes: SavedInteractiveScene[] = [];
  /** The scene removed last, offered back with one button. */
  export let removedScene: SavedInteractiveScene | undefined = undefined;

  export let onstarter: (id: InteractiveStarter) => void;
  export let onsave: () => void;
  export let onrecall: (id: string) => void;
  export let onremove: (id: string) => void;
  export let onundoremove: () => void;
</script>

<div class="panel-heading"><strong>Start with a scene</strong><span>Ready to play</span></div>
<p class="hint">
  Choose a starting point. Add effects, move objects, make it yours. Undo brings your previous scene back.
</p>
<div class="starter-grid">
  {#each INTERACTIVE_STARTERS as starter}
    <button class="starter" style:--starter-color={starter.color} onclick={() => onstarter(starter.id)}>
      <Icon name={starter.icon} size={24} />
      <strong>{starter.name}</strong>
      <span>{starter.description}</span>
    </button>
  {/each}
</div>
<div class="panel-heading saved-heading">
  <strong>Your scenes</strong>
  <button onclick={onsave}><Icon name="save" size={16} />Save current</button>
</div>
{#if !savedScenes.length}
  <p class="hint">Save a scene to keep a version. Your current draft saves automatically on this device.</p>
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
