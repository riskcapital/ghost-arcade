<script lang="ts">
  import { project, selectedLayer, selectedLayerIds } from '../stores/layers';
  import { edgeEffectPresets, MAX_EDGE_PRESET_FILE_BYTES } from '../stores/edgeEffectPresets';
  import { edgeEffectLimitWarning } from '../drawing/edgeEffects';
  import { edgeTypeDef } from '../drawing/edgeEffectCatalog';
  import type { EdgeEffect } from '../types';

  let selected = '';
  let name = '';
  let message = '';
  let importInput: HTMLInputElement;
  let importing = false;

  $: preset = $edgeEffectPresets.presets.find(item => item.id === selected);
  $: current = $selectedLayer?.edgeEffects?.effects ?? [];
  // Every selected layer receives the preset; the inspector's own layer
  // counts even when nothing else is selected.
  $: targetIds = (() => {
    const ids = $selectedLayerIds.filter(id => $project.layers.some(layer => layer.id === id));
    if ($selectedLayer && !ids.includes($selectedLayer.id)) ids.push($selectedLayer.id);
    return ids;
  })();
  $: targetLabel = targetIds.length === 1 ? 'this layer' : `${targetIds.length} layers`;
  $: appendWarning = preset ? edgeEffectLimitWarning([...current, ...preset.effects]) : null;
  $: replaceWarning = preset ? edgeEffectLimitWarning(preset.effects) : null;

  function describe(effects: EdgeEffect[]): string {
    return effects.map(effect => [
      edgeTypeDef('stroke', effect.stroke?.type)?.label,
      edgeTypeDef('fill', effect.fill?.type)?.label,
      edgeTypeDef('animation', effect.animation?.type)?.label,
    ].filter(label => label && label !== 'None').join(' + ') || 'Empty').join(', ');
  }

  function save() {
    try {
      selected = edgeEffectPresets.save(name, current, $selectedLayer?.edgeEffects?.cornerRadius);
      name = '';
      message = 'Preset saved on this computer.';
    } catch (error) { message = error instanceof Error ? error.message : 'Could not save the preset.'; }
  }

  function apply(mode: 'replace' | 'append') {
    if (!preset || !targetIds.length) return;
    project.applyEdgeEffects(targetIds, preset.effects, mode, mode === 'replace' ? preset.cornerRadius ?? 0 : undefined);
    const verb = mode === 'replace' ? 'Applied to' : 'Added to';
    message = `${verb} ${targetLabel}.${(mode === 'replace' ? replaceWarning : appendWarning) ? ' Some effects are over the limit and are bypassed.' : ''}`;
  }

  function remove() {
    try { edgeEffectPresets.remove(selected); selected = ''; message = 'Preset deleted. Applied effects are unchanged.'; }
    catch (error) { message = error instanceof Error ? error.message : 'Could not delete the preset.'; }
  }

  function exportLibrary() {
    try {
      const blob = new Blob([edgeEffectPresets.exportLibrary()], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'ghost-arcade-edge-effects.json';
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
      if (file.size > MAX_EDGE_PRESET_FILE_BYTES) throw new Error('Choose a preset file smaller than 32 MB.');
      const ids = edgeEffectPresets.importLibrary(await file.text());
      selected = ids[0];
      message = `Imported ${ids.length} preset${ids.length === 1 ? '' : 's'}. Choose Apply or Add to use one.`;
    } catch (error) { message = error instanceof Error ? error.message : 'Could not import presets.'; }
    finally { importing = false; input.value = ''; }
  }
</script>

<!-- Keeps a multi-layer selection alive: presets apply to every selected layer. -->
<details data-help-page="layers" class="edge-presets" data-keep-layer-selection>
  <summary>Presets</summary>
  <div class="tray">
    <label>Saved edge effects
      <select bind:value={selected} aria-label="Saved edge effect presets">
        <option value="">Choose a preset…</option>
        {#each $edgeEffectPresets.presets as item (item.id)}<option value={item.id}>{item.name}</option>{/each}
      </select>
    </label>
    {#if preset}
      <p class="summary">{preset.effects.length} effect{preset.effects.length === 1 ? '' : 's'}: {describe(preset.effects)}{preset.cornerRadius ? `, corners ${preset.cornerRadius} px` : ''}</p>
      <div class="actions">
        <button class="primary" disabled={!targetIds.length} title={`Replace the edge effects on ${targetLabel}`} onclick={() => apply('replace')}>Apply to {targetLabel}</button>
        <button disabled={!targetIds.length} title={`Add after the edge effects on ${targetLabel}`} onclick={() => apply('append')}>Add</button>
        <button class="delete" onclick={remove} title="Delete this saved preset">Delete</button>
      </div>
      {#if replaceWarning}<p role="status">{replaceWarning}</p>{:else if appendWarning}<p role="status">Adding this preset goes past the limit: {appendWarning}</p>{/if}
    {/if}
    <p>Applied presets save with your project. Select several layers to apply one to all of them. Export the library to take your presets to another computer.</p>
    <div class="actions">
      <button onclick={() => importInput.click()} disabled={importing || !!$edgeEffectPresets.error}>{importing ? 'Importing…' : 'Import library'}</button>
      <button onclick={exportLibrary} disabled={!$edgeEffectPresets.presets.length || !!$edgeEffectPresets.error}>Export library</button>
      <input bind:this={importInput} type="file" accept=".json,application/json" hidden aria-label="Import edge effect library" onchange={importLibrary} />
    </div>
    <form onsubmit={(event) => { event.preventDefault(); save(); }}>
      <label>Save this layer's edge effects<input bind:value={name} maxlength="80" placeholder="Preset name" aria-label="Preset name" disabled={!current.length} /></label>
      <button disabled={!current.length || !name.trim() || !!$edgeEffectPresets.error}>Save</button>
    </form>
    {#if $edgeEffectPresets.error || message}<p role="status">{$edgeEffectPresets.error || message}</p>{/if}
  </div>
</details>

<style>
  .edge-presets { margin: 4px 0 8px; font-size: var(--ga-text-control); color: var(--ga-ink-1); }
  summary { cursor: pointer; width: fit-content; display: flex; align-items: center; height: var(--ga-control-h-sm); padding: 0 10px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard); background: var(--ga-card); font-weight: var(--ga-weight-control); }
  summary:hover, .edge-presets[open] > summary { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
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
  .summary { color: var(--ga-ink-1); }
  :is(summary, button, input, select):focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
</style>
