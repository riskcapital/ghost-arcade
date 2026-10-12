<script lang="ts">
  import { screenSetups } from '../stores/screenSetups';
  let name = '';
  let feedback = '';
  function perform(action: () => unknown, message: string) {
    try { action(); feedback = message; }
    catch (error) { feedback = error instanceof Error ? error.message : 'Could not save screen setup.'; }
  }
</script>
<details class="setups" data-help-page="output-screens">
  <summary>Screen setups</summary>
  <p>Save screen geometry, dome, warp, and output adjustments. Set a default rig for new projects.</p>
  <input aria-label="Screen setup name" placeholder="Name this setup" maxlength="80" bind:value={name} />
  <div class="actions">
    <button onclick={() => perform(() => { screenSetups.save(name); name = ''; }, 'Screen setup saved.')}>Save setup</button>
    <button onclick={() => perform(() => screenSetups.setCurrentAsDefault(name || 'Default screen setup'), 'New projects will use this rig.')}>Make default</button>
  </div>
  {#if $screenSetups.defaultSetup}
    <p>Default: {$screenSetups.defaultSetup.name}</p>
    <button onclick={() => perform(() => screenSetups.clearDefault(), 'New projects will start with a clean stage.')}>Clear default</button>
  {/if}
  {#each $screenSetups.saved as entry (entry.id)}
    <div class="entry">
      <strong>{entry.name}</strong><span>{entry.summary}</span>
      <div class="actions">
        <button onclick={() => perform(() => screenSetups.load(entry.id), `Loaded ${entry.name}.`)}>Load</button>
        <button onclick={() => perform(() => screenSetups.setDefaultFromSaved(entry.id), `Default: ${entry.name}.`)}>Default</button>
        <button aria-label={`Delete ${entry.name}`} onclick={() => perform(() => screenSetups.remove(entry.id), 'Setup removed.')}>Delete</button>
      </div>
    </div>
  {/each}
  {#if feedback}<p role="status">{feedback}</p>{/if}
</details>
<style>
  .setups { padding: 12px; border-top: 1px solid var(--border-subtle, #333); font-size: 12px; }
  summary { cursor: pointer; font-weight: 600; }
  p, .entry span { color: var(--text-muted, #999); line-height: 1.5; }
  input { width: 100%; box-sizing: border-box; }
  input, button { background: var(--bg-input, #15171b); color: var(--text-primary, #ddd); border: 1px solid var(--border-subtle, #333); border-radius: 6px; padding: 7px 9px; font: inherit; }
  button { cursor: pointer; } button:hover { border-color: #486cb4; background: #192e58; }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .entry { display: grid; gap: 3px; border-top: 1px solid var(--border-subtle, #333); margin-top: 12px; padding-top: 10px; }
</style>
