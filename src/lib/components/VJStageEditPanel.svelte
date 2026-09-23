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
      'hexagon-wall': 'Hex Wall',
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
  <div class="list-head"><span>SCREENS <b>{screens.length}</b></span><button onclick={() => addScreen()} title="Add a screen">+ Add</button></div>
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
  .stage-tools,.stage-list{height:100%;flex-shrink:0;background:#111419;color:#e8eef8;font-family:Inter,system-ui,sans-serif}.stage-tools{width:64px;border-right:1px solid #303846;display:flex;align-items:center;flex-direction:column;gap:3px;padding:10px 5px;overflow-y:auto}.tool{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1px;flex-shrink:0;width:51px;min-height:45px;border:1px solid transparent;background:transparent;color:#bac6d9;border-radius:8px;cursor:pointer}.tool span{font-size:21px;line-height:23px}.tool small{font-size:9px;font-weight:650;line-height:13px}.tool:hover{background:#223655;border-color:#4269a9;color:#fff}.tool-section{align-self:stretch;padding:5px 4px 1px;color:#7589a7;font-size:9px;font-weight:800;letter-spacing:.12em;text-align:center;text-transform:uppercase}.divider{width:32px;height:1px;background:#343d4e;margin:6px;flex-shrink:0}
  .stage-list{width:220px;border-right:1px solid #303846;display:flex;flex-direction:column;min-height:0}.list-head{font-size:10px;font-weight:800;letter-spacing:.13em;color:#94acd5;padding:14px 12px 8px;display:flex;align-items:center;justify-content:space-between}.list-head b{font-size:11px;color:#c3d6f4;margin-left:5px}.list-head button{border:1px solid #4569a7;background:#1d3559;color:#e7f0ff;border-radius:6px;padding:5px 10px;cursor:pointer;font-size:11px;font-weight:700}p{font-size:11px;line-height:1.5;color:#93a0b4;margin:0}
  .screen-list{flex:1;min-height:0;overflow-y:auto;padding:2px 7px}.screen-row{height:38px;display:flex;align-items:center;gap:3px;padding:0 4px;border:1px solid transparent;border-radius:7px}.screen-row:hover{background:#1b2534}.screen-row.chosen,.group-heading.chosen{background:#203658;border-color:#5077b4}.screen-row.child{padding-left:12px}.screen-row input{width:13px;height:13px;accent-color:#75a1e9;margin:0 3px 0 0;cursor:pointer}.screen-name{min-width:0;flex:1;display:flex;align-items:center;gap:7px;text-align:left;border:0;background:transparent;color:#d5dfef;font-size:12px;cursor:pointer;padding:0}.screen-name span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.glyph{color:#92b5ee;font-size:16px}.icon{border:0;background:transparent;color:#9dc6fb;width:23px;height:25px;cursor:pointer}.icon.dim{color:#566070}.group-heading{margin:10px 5px 3px;padding:8px 5px 5px;display:flex;justify-content:space-between;border:1px solid transparent;border-bottom-color:#30405a;border-radius:6px;color:#bcd1f2;font-size:11px;font-weight:700}.group-heading button{background:transparent;border:0;color:#91a9cb;font-size:10px;cursor:pointer}.group-heading .group-select{flex:1;text-align:left;color:#bdd4f5;font-size:11px;font-weight:700}.empty{padding:16px;color:#8999b1;font-size:12px;line-height:1.5}
  .list-footer{padding:12px;border-top:1px solid #303846;display:flex;flex-direction:column;gap:8px}.list-footer button,.list-footer select{min-height:30px;border:1px solid #3e536f;background:#192638;color:#c6dcf8;border-radius:6px;cursor:pointer;font-size:11px}.list-footer select{width:100%;padding:0 7px}.list-footer button:disabled{opacity:.4;cursor:default}.list-footer .surface-action{border-style:dashed;background:#151e2b}.list-footer p{padding:2px 2px 0}.list-footer .error{color:#ff9d9d}.file-input{display:none}
</style>
