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

<details class="chain-presets">
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
  .chain-presets { margin: 6px 0 10px; font-size: 12px; color: #b9c0cd; }
  summary { cursor: pointer; width: fit-content; padding: 5px 9px; border: 1px solid #343944; border-radius: 6px; background: #171a20; }
  summary:hover, .chain-presets[open] > summary { color: #e4ecff; background: #192d59; border-color: #4564a1; }
  .tray { padding: 10px; margin-top: 6px; border: 1px solid #343944; border-radius: 8px; background: #11151d; }
  label { display: flex; flex-direction: column; gap: 5px; min-width: 0; flex: 1; }
  select, input { width: 100%; box-sizing: border-box; min-width: 0; padding: 7px 8px; background: #090c12; color: #e1e6ef; border: 1px solid #343944; border-radius: 5px; font: inherit; }
  .actions, form { display: flex; flex-wrap: wrap; gap: 6px; align-items: end; margin-top: 10px; }
  button { border: 1px solid #3b4351; border-radius: 5px; padding: 6px 9px; background: #202632; color: #e1e6ef; font: inherit; cursor: pointer; }
  .primary { background: #1b3569; border-color: #496daf; }
  .delete { margin-left: auto; }
  button:disabled { opacity: .4; cursor: default; }
  p { font-size: 11px; line-height: 1.5; margin: 8px 0 0; overflow-wrap: anywhere; }
  :is(summary, button, input, select):focus-visible { outline: 2px solid #7397ed; outline-offset: 2px; }
</style>
