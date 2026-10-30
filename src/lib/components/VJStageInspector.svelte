<script lang="ts">
  import { project } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { activeSurfaceSlices, surfaceStore } from '../stores/surface';
  import { VJ_MIX_SOURCE_INDEX, type ContentFitMode, type GroupShaderMode, type LayerShapeType } from '../types';

  $: selected = $project.layers.find(layer => layer.id === $project.selectedLayerId) ?? null;
  $: screen = selected?.type === 'screen' ? selected : null;
  $: group = selected?.type === 'group' ? selected : null;
  $: children = group ? $project.layers.filter(layer => layer.type === 'screen' && layer.parentGroupId === group.id) : [];

  function setSource(ids: string[], value: string) {
    for (const id of ids) {
      if (value.startsWith('group:')) project.setLayerVJGroup(id, value.slice(6));
      else project.setLayerVJIndex(id, value === 'own' ? undefined : Number(value));
    }
  }

  function setGroupSource(value: string) {
    if (!group) return;
    if (value.startsWith('group:')) project.setLayerVJGroup(group.id, value.slice(6));
    else project.setLayerVJIndex(group.id, value === 'own' ? undefined : Number(value));
  }

  function setGroupMode(mode: GroupShaderMode) {
    if (!group) return;
    // When every child already shows the same feed, Unified should span that
    // feed immediately instead of appearing to do nothing until reassigned.
    if (mode === 'unified' && group.vjLayerIndex === undefined && !group.vjGroupId && !group.source) {
      const first = children[0];
      if (first?.vjGroupId && children.every(child => child.vjGroupId === first.vjGroupId)) {
        project.setLayerVJGroup(group.id, first.vjGroupId);
      } else if (first?.vjLayerIndex !== undefined && children.every(child => child.vjLayerIndex === first.vjLayerIndex)) {
        project.setLayerVJIndex(group.id, first.vjLayerIndex);
      } else if ($vjClipLauncher.isOpen) {
        project.setLayerVJIndex(group.id, VJ_MIX_SOURCE_INDEX);
      } else if (first?.source) {
        project.setLayerSource(group.id, first.source);
      }
    }
    project.updateGroupConfig(group.id, { shaderMode: mode });
  }

  function setShape(shape: LayerShapeType) {
    if (screen) project.setLayerShape(screen.id, shape);
  }

  function removeScreen() {
    if (!screen || !confirm(`Remove ${screen.name} from the live stage?`)) return;
    const linked = $activeSurfaceSlices.find(slice => slice.sourceBinding?.kind === 'layer' && slice.sourceBinding.layerId === screen.id);
    if (linked) surfaceStore.deleteSlice(linked.id);
    project.removeLayer(screen.id);
  }
</script>

<aside class="stage-inspector" aria-label="Stage screen properties">
  <header><span class="eyebrow">Stage inspector</span><h2>{selected?.name ?? 'Select a screen'}</h2><p>{screen ? 'Live geometry and source routing' : group ? `${children.length} linked screens` : 'Choose a screen on the canvas or in the list.'}</p></header>
  {#if screen || group}
    <div class="inspector-body">
      <section>
        <h3>{group ? 'Screen group' : 'Screen'}</h3>
        <div class="prop-row">
          <label for="stage-name">Name</label>
          <input id="stage-name" value={selected?.name ?? ''} onchange={(e) => selected && project.renameLayer(selected.id, e.currentTarget.value)} />
        </div>
        <div class="prop-row">
          <label for="stage-source">{group ? 'Group VJ source' : 'VJ source'}</label>
          <select id="stage-source" value={screen ? (screen.vjGroupId ? `group:${screen.vjGroupId}` : screen.vjLayerIndex === undefined ? 'own' : String(screen.vjLayerIndex)) : group ? (group.vjGroupId ? `group:${group.vjGroupId}` : group.vjLayerIndex === undefined ? 'own' : String(group.vjLayerIndex)) : 'own'} onchange={(e) => group ? setGroupSource(e.currentTarget.value) : setSource([screen!.id], e.currentTarget.value)}>
            <option value="own">{group ? 'Use each screen’s source' : 'Own mapping content'}</option>
            <option value={String(VJ_MIX_SOURCE_INDEX)}>Full VJ mix</option>
            {#each Array($vjClipLauncher.numLayers) as _, index}<option value={String(index)}>Layer {index + 1}{#if $vjClipLauncher.layerStates[index]?.activeClip} · {$vjClipLauncher.layerStates[index].activeClip?.name}{/if}</option>{/each}
            {#each $vjClipLauncher.groups ?? [] as vjGroup}<option value={`group:${vjGroup.id}`}>{vjGroup.name} · VJ group</option>{/each}
          </select>
        </div>
        {#if group}
          <span class="stack-label">Content across screens</span>
          <div class="segmented" role="group" aria-label="Group content mapping"><button class:active={group.groupConfig?.shaderMode !== 'unified'} onclick={() => setGroupMode('individual')}>Individual</button><button class:active={group.groupConfig?.shaderMode === 'unified'} onclick={() => setGroupMode('unified')}>Unified</button></div>
          <p class="hint">{group.groupConfig?.shaderMode === 'unified' ? 'One image spans the group; each screen reveals its part.' : 'The group source repeats and fits independently on each screen.'}</p>
        {/if}
      </section>
      {#if screen}
        <section>
          <h3>Geometry</h3>
          <div class="prop-row">
            <label for="stage-content-fit">Content fit</label>
            <select id="stage-content-fit" value={screen.contentFit ?? 'stretch'} onchange={(e) => project.setContentFit(screen.id, e.currentTarget.value as ContentFitMode)}>
              <option value="stretch">Stretch to screen</option>
              <option value="fill">Fill screen</option>
              <option value="crop">Contain entire source</option>
            </select>
          </div>
          <p class="hint">Stretch follows the warp; Fill covers the screen; Contain keeps the full source visible.</p>
          <div class="prop-row">
            <label for="stage-shape">Screen shape</label>
            <select id="stage-shape" value={screen.layerShape?.type ?? 'rectangle'} onchange={(e) => setShape(e.currentTarget.value as LayerShapeType)}>
              <option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option><option value="polygon">Polygon</option><option value="star">Star</option><option value="custom">Custom outline</option>
            </select>
          </div>
          <p class="hint">Drag the screen directly on the canvas. Custom outlines expose point editing there.</p>
        </section>
        <section>
          <h3>Warp</h3>
          <div class="segmented" role="group" aria-label="Warp mode"><button class:active={screen.warpMode !== 'mesh'} onclick={() => project.setWarpMode(screen.id, 'corners')}>Corner / edge</button><button class:active={screen.warpMode === 'mesh'} onclick={() => project.setWarpMode(screen.id, 'mesh')}>Mesh</button></div>
          {#if screen.warpMode === 'mesh'}
            <div class="prop-row">
              <label for="stage-density">Mesh density</label>
              <select id="stage-density" value={`${screen.meshGrid?.rows ?? 3}x${screen.meshGrid?.cols ?? 3}`} onchange={(e) => { const [rows, cols] = e.currentTarget.value.split('x').map(Number); project.setMeshGridSize(screen.id, rows, cols); }}>
                {#each [2,3,4,5,6,8,10,12] as count}<option value={`${count}x${count}`}>{count} × {count}</option>{/each}
              </select>
            </div>
          {/if}
          <button class="secondary" onclick={() => screen.warpMode === 'mesh' ? project.resetMeshGrid(screen.id) : project.resetCorners(screen.id)}>Reset {screen.warpMode === 'mesh' ? 'mesh' : 'corners'}</button>
        </section>
        <section>
          <h3>Screen state</h3>
          <div class="pair"><button class:active={screen.visible} onclick={() => project.toggleLayerVisibility(screen.id)}>{screen.visible ? '◉ Visible' : '○ Hidden'}</button><button class:active={screen.locked} onclick={() => project.toggleLayerLock(screen.id)}>{screen.locked ? 'Locked' : 'Unlocked'}</button></div>
          <button class="remove" onclick={removeScreen}>Remove screen</button>
        </section>
      {/if}
    </div>
  {:else}<div class="empty">The center canvas shows the live VJ content through your stage slices. Add a screen using the shape tools, then assign its source here.</div>{/if}
</aside>

<style>
  /* Matches the mapping inspector: panel surface, eyebrow section labels,
     label-left rows and 26px controls. */
  .stage-inspector { width: 300px; min-width: 300px; height: 100%; box-sizing: border-box; overflow-y: auto; overflow-x: hidden; background: var(--ga-panel, #100f0d); border-left: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); color: var(--ga-ink-0, #f2ede4); }
  header { padding: 14px 14px 12px; border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); }
  .eyebrow, h3 { margin: 0; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #89857e); line-height: 1.2; }
  h2 { margin: 6px 0 4px; font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); line-height: 1.25; letter-spacing: 0; color: var(--ga-ink-0, #f2ede4); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  p { font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--ga-ink-2, #89857e); margin: 0; }
  .inspector-body { padding: 0 14px 16px; }
  section { padding: 12px 0; border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07)); display: flex; flex-direction: column; gap: 8px; }
  section:last-child { border-bottom: 0; }
  h3 { margin-bottom: 2px; }
  .prop-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); align-items: center; gap: 8px; }
  label, .stack-label { color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-body, 500); }
  input, select { width: 100%; min-width: 0; height: var(--ga-control-h, 26px); box-sizing: border-box; padding: 0 8px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-0, #f2ede4); font-family: inherit; font-size: var(--ga-text-control, 12px); }
  .hint { margin-top: -2px; }
  button { font-family: inherit; }
  /* Segmented track, as everywhere else: the chosen segment takes the selection colours. */
  .segmented { display: flex; gap: 2px; height: var(--ga-control-h, 26px); padding: 2px; box-sizing: border-box; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); }
  .segmented button { flex: 1; min-width: 0; border: 0; border-radius: calc(var(--ga-r-hard, 5px) - 1px); background: transparent; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); cursor: pointer; }
  .segmented button:hover:not(.active) { color: var(--ga-ink-0, #f2ede4); background: rgba(255, 255, 255, 0.05); }
  .segmented button.active { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .pair { display: flex; gap: 6px; }
  .pair button, .secondary { flex: 1; height: var(--ga-control-h, 26px); padding: 0 10px; box-sizing: border-box; border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); background: var(--ga-card, #16140f); color: var(--ga-ink-1, #ada9a2); border-radius: var(--ga-r-hard, 5px); font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); cursor: pointer; }
  .pair button:hover:not(.active), .secondary:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .pair button.active { background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); color: var(--ga-selection-ink, #e0e8ff); }
  .secondary { flex: none; }
  .remove { align-self: flex-start; height: var(--ga-control-h-sm, 22px); padding: 0; background: none; border: 0; color: #d89a9f; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); cursor: pointer; }
  .remove:hover { color: var(--ga-rec, #ff3b30); }
  .empty { padding: 16px 14px; }
</style>
