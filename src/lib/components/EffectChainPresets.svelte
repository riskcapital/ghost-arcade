<script lang="ts">
  import type { Effect } from '../types';
  import { effectChainPresets, instantiateEffectChain, MAX_PRESET_FILE_BYTES } from '../stores/effectChainPresets';
  import { nativeEffectChainWarning } from '../renderer/nativeEffectChainPolicy';
  import { isNativeSelectableEffect } from '../renderer/nativeEffectCoverage';
  export let effects: Effect[] = [];
  export let companionEffects: Effect[] = [];
  export let disabled = false;
  export let nativeOnly = false;
  export let onApply: (effects: Effect[]) => void;
  let selected = '';
  let name = '';
  let message = '';
  let importInput: HTMLInputElement;
  let importing = false;
  $: preset = $effectChainPresets.presets.find(item => item.id === selected);
  $: unsupported = nativeOnly && preset?.effects.some(effect => !isNativeSelectableEffect(effect.type));
  $: appendWarning = preset && nativeOnly ? nativeEffectChainWarning([...companionEffects, ...effects, ...preset.effects]) : null;
  $: replaceWarning = preset && nativeOnly ? nativeEffectChainWarning([...companionEffects, ...preset.effects]) : null;
  function save() {
    try { selected = effectChainPresets.save(name, effects); name = ''; message = 'Chain saved on this computer.'; }
    catch (error) { message = error instanceof Error ? error.message : 'Could not save the preset.'; }
  }
  function apply(replace: boolean) {
    if (!preset || disabled || unsupported || (replace ? replaceWarning : appendWarning)) return;
    onApply([...(replace ? [] : effects), ...instantiateEffectChain(preset.effects)]);
    message = replace ? 'Chain replaced.' : 'Chain added.';
  }
  function remove() {
    try { effectChainPresets.remove(selected); selected = ''; message = 'Preset deleted. Applied effects are unchanged.'; }
    catch (error) { message = error instanceof Error ? error.message : 'Could not delete the preset.'; }
  }
  function exportLibrary() {
    try {
      const blob = new Blob([effectChainPresets.exportLibrary()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ghost-arcade-effect-chains.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      message = 'Library export requested.';
    } catch (error) { message = error instanceof Error ? error.message : 'Could not export presets.'; }
  }
  async function importLibrary(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    importing = true;
    try {
      if (file.size > MAX_PRESET_FILE_BYTES) throw new Error('Choose a preset file smaller than 32 MB.');
      const ids = effectChainPresets.importLibrary(await file.text());
      selected = ids[0];
      message = `Imported ${ids.length} preset${ids.length === 1 ? '' : 's'}. Choose Add chain or Replace to apply.`;
    } catch (error) { message = error instanceof Error ? error.message : 'Could not import presets.'; }
    finally { importing = false; input.value = ''; }
  }

</script>

<details data-help-page="effects" class="chain-presets">
  <summary>Presets</summary>
  <div class="tray">
    <label>Saved chains
      <select bind:value={selected} aria-label="Saved effect chains">
        <option value="">Choose a preset…</option>
        {#each $effectChainPresets.presets as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
      </select>
    </label>
    {#if preset}
      <p>{preset.effects.length} effects · {preset.effects.map(effect => effect.type).join(' → ')}</p>
      <div class="actions">
        <button class="primary" disabled={disabled || unsupported || !!appendWarning} title={appendWarning ?? 'Add after the current effects'} onclick={() => apply(false)}>Add chain</button>
        <button disabled={disabled || unsupported || !!replaceWarning} title={replaceWarning ?? 'Replace the current effects'} onclick={() => apply(true)}>Replace</button>
        <button class="delete" onclick={remove} title="Delete this saved preset">Delete</button>
      </div>
      {#if unsupported}<p role="status">This chain includes effects unavailable in the native renderer.</p>{/if}
      {#if appendWarning}<p role="status">Adding this chain exceeds the 16-effect limit. Remove effects first{!replaceWarning ? ', or use Replace' : ''}.</p>{/if}
    {/if}
    <p>Applied chains save with your project. Export the library to take your presets to another computer.</p>
    <div class="actions">
      <button onclick={() => importInput.click()} disabled={importing || !!$effectChainPresets.error}>{importing ? 'Importing…' : 'Import library'}</button>
      <button onclick={exportLibrary} disabled={!$effectChainPresets.presets.length || !!$effectChainPresets.error}>Export library</button>
      <input bind:this={importInput} type="file" accept=".json,application/json" hidden aria-label="Import effect-chain library" onchange={importLibrary} />
    </div>
    <form onsubmit={(event) => { event.preventDefault(); save(); }}>
      <label>Save current chain<input bind:value={name} maxlength="80" placeholder="Preset name" disabled={disabled || !effects.length} /></label>
      <button disabled={disabled || !effects.length || !name.trim() || !!$effectChainPresets.error}>Save</button>
    </form>
    {#if $effectChainPresets.error || message}<p role="status">{$effectChainPresets.error || message}</p>{/if}
  </div>
</details>

<style>
  .chain-presets { margin: 6px 0 10px; font-size: var(--ga-text-control); color: var(--ga-ink-1); }
  summary { cursor: pointer; width: fit-content; display: flex; align-items: center; height: var(--ga-control-h-sm); padding: 0 10px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); background: var(--ga-card); font-weight: var(--ga-weight-control); }
  summary:hover, .chain-presets[open] > summary { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .tray { padding: 10px; margin-top: 6px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-soft); background: var(--ga-card); }
  label { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 1; font-size: var(--ga-text-meta); color: var(--ga-ink-2); }
  select, input { width: 100%; box-sizing: border-box; min-width: 0; height: var(--ga-control-h); padding: 0 8px; background: var(--ga-slot); color: var(--ga-ink-0); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); font: inherit; font-size: var(--ga-text-control); }
  .actions, form { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; margin-top: 10px; }
  button { height: var(--ga-control-h); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); padding: 0 10px; background: var(--ga-sub); color: var(--ga-ink-1); font: inherit; font-size: var(--ga-text-control); font-weight: var(--ga-weight-control); cursor: pointer; }
  button:hover:not(:disabled) { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .primary { background: var(--ga-accent-gradient, var(--ga-violet)); border-color: transparent; color: var(--ga-blue-800); border-radius: var(--ga-r-soft); font-weight: 700; }
  .primary:hover:not(:disabled) { color: var(--ga-blue-800); filter: brightness(1.06); }
  .delete { margin-left: auto; }
  .delete:hover:not(:disabled) { color: var(--ga-rec); border-color: color-mix(in srgb, var(--ga-rec) 45%, transparent); }
  button:disabled { opacity: .4; cursor: default; }
  p { font-size: var(--ga-text-meta); line-height: 1.5; margin: 8px 0 0; color: var(--ga-ink-2); overflow-wrap: anywhere; }
  :is(summary, button, input, select):focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
</style>
