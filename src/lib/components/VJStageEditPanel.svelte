<script lang="ts">
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { project, layers } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { activeSurface, activeSurfaceSlices, surfaceStore } from '../stores/surface';
  import { STAGE_TEMPLATES, type StageTemplate } from '../stores/stageTemplates';
  import { VJ_MIX_SOURCE_INDEX, type LayerShapeType } from '../types';

  $: screens = $layers.filter(layer => layer.type === 'screen');
  $: groups = $project.layers.filter(layer => layer.type === 'group' && screens.some(screen => screen.parentGroupId === layer.id));
  let groupSelection: string[] = [];
  let fileInput: HTMLInputElement;
  let importError = '';

  function shortTemplateLabel(template: StageTemplate): string {
    const labels: Record<string, string> = {
      'wall-of-circles': 'Circles',
      'vertical-stripes': 'Stripes',
      triptych: 'Triptych',
      'hexagon-wall': 'Hex wall',
      concert: 'Concert',
      'pillar-array': 'Pillars',
      'horizontal-bars': 'Bars',
      'diamond-grid': 'Diamonds',
      'festival-mainstage': 'Festival',
      'arena-hero': 'Arena',
      'club-wrap': 'Club',
      'conference-curved': 'Conf.',
      'tetris-tower': 'Tetris',
      'festival-fan': 'Fan',
    };
    return labels[template.id] ?? template.label;
  }

  function addScreen(shape: LayerShapeType = 'rectangle') {
    const count = get(layers).filter(layer => layer.type === 'screen').length;
    project.addScreenLayer();
    const id = get(project).selectedLayerId;
    if (!id) return;
    project.setLayerVJIndex(id, $vjClipLauncher.isOpen ? VJ_MIX_SOURCE_INDEX : undefined);
    project.setLayerShape(id, shape);
    if (count > 0) {
      const left = 0.08 + ((count - 1) % 4) * 0.14;
      const top = 0.88 - Math.floor((count - 1) / 4) * 0.15;
      const right = left + 0.32;
      const bottom = top - 0.34;
      project.setCorner(id, 'topLeft', { x: left, y: top });
      project.setCorner(id, 'topRight', { x: right, y: top });
      project.setCorner(id, 'bottomLeft', { x: left, y: bottom });
      project.setCorner(id, 'bottomRight', { x: right, y: bottom });
    }
    const screen = get(project).layers.find(layer => layer.id === id);
    if (screen) surfaceStore.registerLiveScreenLayer(screen);
  }

  function toggleSelection(id: string) {
    groupSelection = groupSelection.includes(id) ? groupSelection.filter(item => item !== id) : [...groupSelection, id];
  }

  function groupScreens() {
    const ids = groupSelection.filter(id => screens.some(screen => screen.id === id));
    if (ids.length < 2) return;
    project.createGroupFromIds(ids);
    groupSelection = [];
  }

  async function sync2DLayout() {
    surfaceStore.syncFromMappingLayers(get(project).layers);
    await surfaceStore.applyStage({ stayInVJ: true });
  }

  function routeNewScreens(previous: Set<string>) {
    for (const layer of get(project).layers) {
      if (layer.type === 'screen' && !previous.has(layer.id)) project.setLayerVJIndex(layer.id, $vjClipLauncher.isOpen ? VJ_MIX_SOURCE_INDEX : undefined);
    }
  }

  async function addLayout(templateId: string) {
    const template = STAGE_TEMPLATES.find(item => item.id === templateId);
    if (!template) return;
    const previous = new Set(get(project).layers.filter(layer => layer.type === 'screen').map(layer => layer.id));
    if (!get(activeSurface)) surfaceStore.createSurface('Stage 1');
    const surface = get(activeSurface)!;
    for (const slice of template.build(surface.width, surface.height)) surfaceStore.addSlice(slice.polygon, slice.name);
    await surfaceStore.applyStage({ stayInVJ: true });
    routeNewScreens(previous);
  }

  function importSVG(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    importError = '';
    const reader = new FileReader();
    reader.onload = async () => {
      const previous = new Set(get(project).layers.filter(layer => layer.type === 'screen').map(layer => layer.id));
      if (!surfaceStore.importSVG(String(reader.result ?? ''), { replace: false })) {
        importError = 'This SVG has no usable paths.';
        return;
      }
      await surfaceStore.applyStage({ stayInVJ: true });
      routeNewScreens(previous);
    };
    reader.readAsText(file);
    fileInput.value = '';
  }

  // Live screen layers are the performance geometry. Mirror completed
  // edits back into linked 2D slices when the workspace closes.
  onDestroy(() => surfaceStore.syncFromMappingLayers(get(project).layers));
</script>

<aside class="stage-tools" aria-label="Stage design tools">
  <button class="tool" onclick={() => project.selectLayer(null)} title="Select a screen on the canvas" aria-label="Select screen tool"><span>↖</span><small>Select</small></button>
  <button class="tool" onclick={() => addScreen('custom')} title="Draw a custom screen; click to place points and close the outline" aria-label="Draw custom screen"><span>✎</span><small>Pen</small></button>
  <span class="divider"></span>
  <span class="tool-section">Shapes</span>
  <button class="tool" onclick={() => addScreen('rectangle')} title="Add rectangle screen" aria-label="Add rectangle screen"><span>▭</span><small>Rect</small></button>
  <button class="tool" onclick={() => addScreen('circle')} title="Add circle screen" aria-label="Add circle screen"><span>◯</span><small>Circle</small></button>
  <button class="tool" onclick={() => addScreen('ellipse')} title="Add ellipse screen" aria-label="Add ellipse screen"><span>⬭</span><small>Ellipse</small></button>
  <button class="tool" onclick={() => addScreen('triangle')} title="Add triangle screen" aria-label="Add triangle screen"><span>△</span><small>Tri</small></button>
  <button class="tool" onclick={() => addScreen('polygon')} title="Add hexagon screen" aria-label="Add hexagon screen"><span>⬡</span><small>Hex</small></button>
  <button class="tool" onclick={() => addScreen('star')} title="Add star screen" aria-label="Add star screen"><span>☆</span><small>Star</small></button>
  <span class="divider"></span>
  <span class="tool-section">Presets</span>
  {#each STAGE_TEMPLATES as template (template.id)}
    <button class="tool preset" onclick={() => addLayout(template.id)} title={`Add ${template.label} to this stage`} aria-label={`Add ${template.label} stage design`}><span>{template.icon}</span><small>{shortTemplateLabel(template)}</small></button>
  {/each}
  <span class="divider"></span>
  <span class="tool-section">Import</span>
  <button class="tool import" onclick={() => fileInput.click()} title="Import SVG paths as live screens" aria-label="Import SVG screens"><span>↑</span><small>SVG</small></button>
</aside>

<aside class="stage-list" aria-label="Live stage screens">
  <div class="list-head"><span class="eyebrow">Screens <b>{screens.length}</b></span><button onclick={() => addScreen()} title="Add a screen">+ Add</button></div>
  <div class="screen-list">
    {#each screens.filter(screen => !screen.parentGroupId) as screen (screen.id)}
      <div class="screen-row" class:chosen={screen.id === $project.selectedLayerId}>
        <input type="checkbox" checked={groupSelection.includes(screen.id)} onchange={() => toggleSelection(screen.id)} aria-label={`Select ${screen.name} for grouping`} />
        <button class="screen-name" onclick={() => project.selectLayer(screen.id)}><span class="glyph">▭</span><span>{screen.name}</span></button>
        <button class="icon" class:dim={!screen.visible} onclick={() => project.toggleLayerVisibility(screen.id)} title={screen.visible ? `Hide ${screen.name}` : `Show ${screen.name}`} aria-label={screen.visible ? `Hide ${screen.name}` : `Show ${screen.name}`}>{screen.visible ? '◉' : '○'}</button>
        <button class="icon" class:dim={!screen.locked} onclick={() => project.toggleLayerLock(screen.id)} title={screen.locked ? `Unlock ${screen.name}` : `Lock ${screen.name}`} aria-label={screen.locked ? `Unlock ${screen.name}` : `Lock ${screen.name}`}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d={screen.locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.5-1.7'} /></svg></button>
      </div>
    {/each}
    {#each groups as group (group.id)}
      <div class="group-heading" class:chosen={group.id === $project.selectedLayerId}><button class="group-select" onclick={() => project.selectLayer(group.id)}>▦ {group.name}</button><button onclick={() => project.dissolveGroup(group.id)} title={`Ungroup ${group.name}`}>Ungroup</button></div>
      {#each screens.filter(screen => screen.parentGroupId === group.id) as screen (screen.id)}
        <div class="screen-row child" class:chosen={screen.id === $project.selectedLayerId}>
          <input type="checkbox" checked={groupSelection.includes(screen.id)} onchange={() => toggleSelection(screen.id)} aria-label={`Select ${screen.name} for grouping`} />
          <button class="screen-name" onclick={() => project.selectLayer(screen.id)}><span class="glyph">▭</span><span>{screen.name}</span></button>
          <button class="icon" class:dim={!screen.visible} onclick={() => project.toggleLayerVisibility(screen.id)} title={screen.visible ? `Hide ${screen.name}` : `Show ${screen.name}`} aria-label={screen.visible ? `Hide ${screen.name}` : `Show ${screen.name}`}>{screen.visible ? '◉' : '○'}</button>
          <button class="icon" class:dim={!screen.locked} onclick={() => project.toggleLayerLock(screen.id)} title={screen.locked ? `Unlock ${screen.name}` : `Lock ${screen.name}`} aria-label={screen.locked ? `Unlock ${screen.name}` : `Lock ${screen.name}`}><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d={screen.locked ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.5-1.7'} /></svg></button>
        </div>
      {/each}
    {/each}
    {#if screens.length === 0}<div class="empty">Choose a shape on the left to add your first screen.</div>{/if}
  </div>
  <div class="list-footer">
    <button disabled={groupSelection.length < 2} onclick={groupScreens}>Group selected {groupSelection.length > 1 ? `(${groupSelection.length})` : ''}</button>
    {#if $activeSurfaceSlices.length}<button class="surface-action" onclick={sync2DLayout} title="Import unlinked slices from a saved 2D layout while preserving live screen edits">Import saved layout · {$activeSurfaceSlices.length} slices</button>{/if}
    {#if importError}<p class="error">{importError}</p>{/if}
    <p>Presets and SVGs add live screens. Select one to edit its routing and warp.</p>
  </div>
  <input bind:this={fileInput} type="file" accept=".svg,image/svg+xml" class="file-input" onchange={importSVG} />
</aside>

<style>
  /* Matches the mapping sidebars: panel surface, eyebrow section labels,
     26px controls, selection colours for the chosen row. */
  .stage-tools, .stage-list { height: 100%; flex-shrink: 0; box-sizing: border-box; background: var(--ga-panel, #100f0d); color: var(--ga-ink-0, #f2ede4); }
  .stage-tools { width: 64px; border-right: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); display: flex; align-items: center; flex-direction: column; gap: 2px; padding: 8px 6px; overflow-y: auto; scrollbar-width: none; }
  .stage-tools::-webkit-scrollbar { display: none; }
  .tool { display: flex; align-items: center; justify-content: center; flex-direction: column; gap: 2px; flex-shrink: 0; width: 52px; min-height: 44px; padding: 4px 0; box-sizing: border-box; border: 1px solid transparent; background: transparent; color: var(--ga-ink-1, #ada9a2); border-radius: var(--ga-r-hard, 5px); cursor: pointer; transition: background 0.12s, border-color 0.12s, color 0.12s; }
  .tool span { font-size: 20px; line-height: 22px; }
  .tool small { font-size: var(--ga-text-eyebrow, 10px); font-weight: var(--ga-weight-control, 600); line-height: 12px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tool:hover { background: var(--ga-sub, #1e1b16); border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .tool-section, .eyebrow { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #89857e); line-height: 1.2; }
  .tool-section { align-self: stretch; padding: 2px 0 4px; text-align: center; }
  .divider { width: 32px; height: 1px; background: var(--ga-line-2, rgba(245, 236, 222, 0.13)); margin: 6px 0; flex-shrink: 0; }

  .stage-list { width: 220px; border-right: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); display: flex; flex-direction: column; min-height: 0; }
  .list-head { height: 40px; box-sizing: border-box; padding: 0 8px 0 12px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); }
  .list-head b { margin-left: 4px; font-weight: 700; color: var(--ga-ink-1, #ada9a2); font-variant-numeric: tabular-nums; }
  button { font-family: inherit; }
  .list-head button, .list-footer button { height: var(--ga-control-h, 26px); box-sizing: border-box; padding: 0 10px; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); background: var(--ga-card, #16140f); color: var(--ga-ink-1, #ada9a2); border-radius: var(--ga-r-hard, 5px); cursor: pointer; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); }
  .list-head button { height: var(--ga-control-h-sm, 22px); padding: 0 8px; }
  .list-head button:hover, .list-footer button:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  p { font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #89857e); margin: 0; }

  .screen-list { flex: 1; min-height: 0; overflow-y: auto; padding: 6px; }
  .screen-row { height: 30px; display: flex; align-items: center; gap: 4px; padding: 0 4px 0 6px; border: 1px solid transparent; border-radius: var(--ga-r-hard, 5px); }
  .screen-row:hover { background: var(--ga-sub, #1e1b16); }
  .screen-row.chosen, .group-heading.chosen { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .screen-row.chosen .screen-name { color: var(--ga-selection-ink, #e0e8ff); }
  .screen-row.child { padding-left: 14px; }
  .screen-row input { width: 13px; height: 13px; flex: none; accent-color: var(--ga-selection-line, #5278ff); margin: 0 2px 0 0; cursor: pointer; }
  .screen-name { min-width: 0; flex: 1; height: 100%; display: flex; align-items: center; gap: 6px; text-align: left; border: 0; background: transparent; color: var(--ga-ink-0, #f2ede4); font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-body, 500); cursor: pointer; padding: 0; }
  .screen-name span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .glyph { color: var(--ga-ink-2, #89857e); font-size: 14px; }
  .icon { flex: none; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: var(--ga-r-hard, 5px); background: transparent; color: var(--ga-ink-1, #ada9a2); width: 22px; height: 22px; padding: 0; font-size: 12px; cursor: pointer; }
  .icon:hover { color: var(--ga-ink-0, #f2ede4); background: rgba(255, 255, 255, 0.05); }
  .icon.dim { color: var(--ga-ink-2, #89857e); opacity: 0.55; }
  .icon.dim:hover { color: var(--ga-ink-1, #ada9a2); opacity: 1; }
  .group-heading { margin: 8px 0 2px; padding: 0 4px 0 6px; height: 28px; display: flex; align-items: center; justify-content: space-between; gap: 6px; border: 1px solid transparent; border-bottom-color: var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); }
  .group-heading button { height: 22px; padding: 0 6px; background: transparent; border: 0; border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); font-weight: var(--ga-weight-control, 600); cursor: pointer; }
  .group-heading button:hover { color: var(--ga-ink-0, #f2ede4); background: rgba(255, 255, 255, 0.05); }
  .group-heading .group-select { flex: 1; min-width: 0; padding: 0; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ga-ink-0, #f2ede4); font-size: var(--ga-text-control, 12px); }
  .group-heading .group-select:hover { background: transparent; }
  .empty { padding: 12px 8px; }

  .list-footer { padding: 12px; border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); display: flex; flex-direction: column; gap: 8px; }
  .list-footer button:disabled { opacity: 0.4; cursor: default; }
  .list-footer .surface-action { border-style: dashed; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .list-footer .error { color: #ff9d9d; }
  .file-input { display: none; }
</style>
