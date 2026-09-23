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
  <header><span class="eyebrow">STAGE INSPECTOR</span><h2>{selected?.name ?? 'Select a screen'}</h2><p>{screen ? 'Live geometry and source routing' : group ? `${children.length} linked screens` : 'Choose a screen on the canvas or in the list.'}</p></header>
  {#if screen || group}
    <div class="inspector-body">
      <section>
        <h3>{group ? 'SCREEN GROUP' : 'SCREEN'}</h3>
        <label for="stage-name">Name</label>
        <input id="stage-name" value={selected?.name ?? ''} onchange={(e) => selected && project.renameLayer(selected.id, e.currentTarget.value)} />
        <label for="stage-source">{group ? 'Group VJ source' : 'VJ source'}</label>
        <select id="stage-source" value={screen ? (screen.vjGroupId ? `group:${screen.vjGroupId}` : screen.vjLayerIndex === undefined ? 'own' : String(screen.vjLayerIndex)) : group ? (group.vjGroupId ? `group:${group.vjGroupId}` : group.vjLayerIndex === undefined ? 'own' : String(group.vjLayerIndex)) : 'own'} onchange={(e) => group ? setGroupSource(e.currentTarget.value) : setSource([screen!.id], e.currentTarget.value)}>
          <option value="own">{group ? 'Use each screen’s source' : 'Own mapping content'}</option>
          <option value={String(VJ_MIX_SOURCE_INDEX)}>Full VJ mix</option>
          {#each Array($vjClipLauncher.numLayers) as _, index}<option value={String(index)}>Layer {index + 1}{#if $vjClipLauncher.layerStates[index]?.activeClip} · {$vjClipLauncher.layerStates[index].activeClip?.name}{/if}</option>{/each}
          {#each $vjClipLauncher.groups ?? [] as vjGroup}<option value={`group:${vjGroup.id}`}>{vjGroup.name} · VJ group</option>{/each}
        </select>
        {#if group}
          <label>Content across screens</label>
          <div class="segmented" role="group" aria-label="Group content mapping"><button class:active={group.groupConfig?.shaderMode !== 'unified'} onclick={() => setGroupMode('individual')}>Individual</button><button class:active={group.groupConfig?.shaderMode === 'unified'} onclick={() => setGroupMode('unified')}>Unified</button></div>
          <p class="hint">{group.groupConfig?.shaderMode === 'unified' ? 'One image spans the group; each screen reveals its part.' : 'The group source repeats and fits independently on each screen.'}</p>
        {/if}
      </section>
      {#if screen}
        <section>
          <h3>GEOMETRY</h3>
          <label for="stage-content-fit">Content fit</label>
          <select id="stage-content-fit" value={screen.contentFit ?? 'stretch'} onchange={(e) => project.setContentFit(screen.id, e.currentTarget.value as ContentFitMode)}>
            <option value="stretch">Stretch to screen</option>
            <option value="fill">Fill screen</option>
            <option value="crop">Contain entire source</option>
          </select>
          <p class="hint">Stretch follows the warp; Fill covers the screen; Contain keeps the full source visible.</p>
          <label for="stage-shape">Screen shape</label>
          <select id="stage-shape" value={screen.layerShape?.type ?? 'rectangle'} onchange={(e) => setShape(e.currentTarget.value as LayerShapeType)}>
            <option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="ellipse">Ellipse</option><option value="triangle">Triangle</option><option value="polygon">Polygon</option><option value="star">Star</option><option value="custom">Custom outline</option>
          </select>
          <p class="hint">Drag the screen directly on the canvas. Custom outlines expose point editing there.</p>
        </section>
        <section>
          <h3>WARP</h3>
          <div class="segmented" role="group" aria-label="Warp mode"><button class:active={screen.warpMode !== 'mesh'} onclick={() => project.setWarpMode(screen.id, 'corners')}>Corner / edge</button><button class:active={screen.warpMode === 'mesh'} onclick={() => project.setWarpMode(screen.id, 'mesh')}>Mesh</button></div>
          {#if screen.warpMode === 'mesh'}
            <label for="stage-density">Mesh density</label>
            <select id="stage-density" value={`${screen.meshGrid?.rows ?? 3}x${screen.meshGrid?.cols ?? 3}`} onchange={(e) => { const [rows, cols] = e.currentTarget.value.split('x').map(Number); project.setMeshGridSize(screen.id, rows, cols); }}>
              {#each [2,3,4,5,6,8,10,12] as count}<option value={`${count}x${count}`}>{count} × {count}</option>{/each}
            </select>
          {/if}
          <button class="secondary" onclick={() => screen.warpMode === 'mesh' ? project.resetMeshGrid(screen.id) : project.resetCorners(screen.id)}>Reset {screen.warpMode === 'mesh' ? 'mesh' : 'corners'}</button>
        </section>
        <section>
          <h3>SCREEN STATE</h3>
          <div class="pair"><button class:active={screen.visible} onclick={() => project.toggleLayerVisibility(screen.id)}>{screen.visible ? '◉ Visible' : '○ Hidden'}</button><button class:active={screen.locked} onclick={() => project.toggleLayerLock(screen.id)}>{screen.locked ? 'Locked' : 'Unlocked'}</button></div>
          <button class="remove" onclick={removeScreen}>Remove screen</button>
        </section>
      {/if}
    </div>
  {:else}<div class="empty">The center canvas shows the live VJ content through your stage slices. Add a screen using the shape tools, then assign its source here.</div>{/if}
</aside>

<style>
  .stage-inspector{width:300px;min-width:300px;height:100%;overflow-y:auto;overflow-x:hidden;background:#111419;border-left:1px solid #303846;color:#e8eef8;font-family:Inter,system-ui,sans-serif}header{padding:20px 19px 17px;border-bottom:1px solid #303846}.eyebrow,h3{font-size:10px;font-weight:800;letter-spacing:.13em;color:#94acd5}h2{font-size:20px;line-height:1.1;letter-spacing:-.03em;margin:7px 0 5px}p{font-size:11px;line-height:1.45;color:#94a1b4;margin:0}.inspector-body{padding:0 18px 22px}section{padding:17px 0 19px;border-bottom:1px solid #303846;display:flex;flex-direction:column;gap:9px}h3{margin:0 0 3px}label{color:#b9c6d9;font-size:11px;font-weight:700}input,select{width:100%;height:34px;padding:0 10px;background:#0b0f15;border:1px solid #3b4659;border-radius:6px;color:#edf3fd;font:12px Inter,system-ui,sans-serif}.hint{margin-top:1px}.segmented,.pair{display:flex;gap:5px}.segmented button,.pair button,.secondary{flex:1;min-height:32px;border:1px solid #3e4a5d;background:#1a202a;color:#bac7d9;border-radius:6px;font:12px Inter,system-ui,sans-serif;cursor:pointer}.segmented button.active,.pair button.active{background:#203961;border-color:#5685ce;color:#eff6ff}.secondary{margin-top:3px}.remove{align-self:flex-start;background:none;border:0;color:#d89a9f;padding:8px 0;cursor:pointer;font-size:11px}.empty{padding:22px 19px;color:#9daabe;font-size:12px;line-height:1.55}
</style>
