<script lang="ts">
  // One-click Looks gallery: pick a Look and every shape (or the selected
  // shapes / group) gets a beat-synced Edge Effects stack at once. Picking a
  // palette re-colours whatever Look the targets wear. One undo step each.
  //
  // In VJ MAP (`mapSurfaces`) a Look belongs to the map's surfaces instead:
  // it is stored on project.mapSurfaces and worn by every preset fired on
  // them, until Remove Look clears it. The editor's selection is hidden
  // behind the VJ panel there, so MAP always targets every outlined surface.
  import { project, selectedLayerIds } from '../stores/layers';
  import { EDGE_LOOKS } from '../looks/edgeLookCatalog';
  import { LOOK_PALETTES, lookTargetLayerIds, isLookTarget, type LookScope, type Rgba } from '../looks/edgeLooks';
  import { mapLookSurfaceIds } from '../stores/mapSurfaces';

  let { onClose = () => {}, mapSurfaces = false }: { onClose?: () => void; mapSurfaces?: boolean } = $props();

  const base = import.meta.env.BASE_URL ?? './';
  const thumb = (id: string) => `${base}looks/${id}.png`;
  const css = (c: Rgba) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;

  let scopeChoice = $state<LookScope | null>(null);
  let paletteChoice = $state<string | null>(null);
  let message = $state('');

  const shapes = $derived($project.layers.filter(isLookTarget));
  const selectedTargets = $derived(lookTargetLayerIds($project.layers, $selectedLayerIds, 'selected'));
  // Default to every shape; a multi-selection (or a group) narrows it.
  const scope = $derived<LookScope>(mapSurfaces ? 'all' : scopeChoice ?? (selectedTargets.length > 1 ? 'selected' : 'all'));
  const surfaceIds = $derived(mapSurfaces ? mapLookSurfaceIds($project) : []);
  const targets = $derived(mapSurfaces ? surfaceIds : scope === 'all' ? shapes.map((layer) => layer.id) : selectedTargets);
  const noun = $derived(mapSurfaces ? 'surface' : 'shape');
  const plural = (count: number) => `${count} ${noun}${count === 1 ? '' : 's'}`;
  const emptyHint = $derived(mapSurfaces
    ? 'Save a mapping preset first: Looks in MAP dress its surfaces.'
    : 'Draw a shape first: Add Layer, then Custom Shape.');
  const wearing = $derived.by(() => {
    const refs = mapSurfaces
      ? ($project.mapSurfaces ?? []).filter((surface) => targets.includes(surface.id)).map((surface) => surface.lookEffects?.look ?? null)
      : $project.layers.filter((layer) => targets.includes(layer.id)).map((layer) => layer.edgeEffects?.look ?? null);
    const first = refs[0];
    return first && refs.every((ref) => ref?.id === first.id && ref.paletteId === first.paletteId) ? first : null;
  });
  const palette = $derived(paletteChoice ?? wearing?.paletteId ?? null);

  function pickLook(id: string) {
    if (!targets.length) { message = emptyHint; return; }
    const look = EDGE_LOOKS.find((item) => item.id === id)!;
    // Each Look opens in its own colours until the user picks a palette.
    const count = apply(id, paletteChoice ?? look.palette);
    message = mapSurfaces
      ? `${look.name} on ${plural(count)}. Every preset on them wears it until Remove Look.`
      : `${look.name} on ${plural(count)}. Undo reverts it in one step.`;
  }

  function apply(id: string, paletteId: string) {
    return mapSurfaces ? project.applySurfaceLook(id, paletteId, targets) : project.applyLook(targets, id, paletteId);
  }

  function pickPalette(id: string) {
    paletteChoice = id;
    if (wearing) {
      apply(wearing.id, id);
      message = `Colours changed to ${LOOK_PALETTES.find((p) => p.id === id)?.name}.`;
    }
  }

  // In VJ the gallery lives inside the VJ overlay, under the Presets tray
  // that VJ MAP opens for dragging presets in, which hid Remove Look. Lift
  // it to the page root there so it draws above the tray.
  function liftAboveTray(node: HTMLElement, lift: boolean) {
    if (lift) document.body.appendChild(node);
    return { destroy() { if (lift) node.remove(); } };
  }

  function removeLook() {
    const count = mapSurfaces ? project.clearSurfaceLooks() : project.clearLook(targets);
    message = count
      ? `Look removed from ${plural(count)}.${mapSurfaces ? ' Presets show their own Edge Effects again.' : ''}`
      : `These ${noun}s have no Look.`;
  }
</script>

<div class="looks-gallery" class:lifted={mapSurfaces} role="dialog" aria-label="Looks" data-help-page="edge-effects" use:liftAboveTray={mapSurfaces}>
  <header class="looks-head">
    <div>
      <h3>Looks</h3>
      <p>{mapSurfaces ? 'One click dresses the map\'s surfaces, whichever preset is playing.' : 'One click dresses your shapes.'} They move to the beat: tap a tempo or turn on the mic.</p>
    </div>
    <button class="looks-close" type="button" aria-label="Close Looks" onclick={onClose}>×</button>
  </header>

  <div class="looks-controls">
    {#if mapSurfaces}
    <div class="looks-scope" role="radiogroup" aria-label="Apply to">
      <button type="button" role="radio" aria-checked="true" class="active">All surfaces ({surfaceIds.length})</button>
    </div>
    {:else}
    <div class="looks-scope" role="radiogroup" aria-label="Apply to">
      <button type="button" role="radio" aria-checked={scope === 'all'} class:active={scope === 'all'}
        onclick={() => (scopeChoice = 'all')}>All shapes ({shapes.length})</button>
      <button type="button" role="radio" aria-checked={scope === 'selected'} class:active={scope === 'selected'}
        disabled={!selectedTargets.length} onclick={() => (scopeChoice = 'selected')}>Selected ({selectedTargets.length})</button>
    </div>
    {/if}
    <div class="looks-palettes" role="radiogroup" aria-label="Colours">
      {#each LOOK_PALETTES as p (p.id)}
        <button type="button" role="radio" class="palette" class:active={palette === p.id} aria-checked={palette === p.id}
          title={p.name} aria-label={`${p.name} colours`} onclick={() => pickPalette(p.id)}>
          {#each p.colors as c, i (i)}<span style:background={css(c)}></span>{/each}
        </button>
      {/each}
    </div>
  </div>

  <div class="looks-grid">
    {#each EDGE_LOOKS as look (look.id)}
      <button type="button" class="look-card" class:active={wearing?.id === look.id} title={look.blurb}
        aria-label={`Apply ${look.name}`} data-look-id={look.id} onclick={() => pickLook(look.id)}>
        <span class="look-thumb"><img class="look-strip" src={thumb(look.id)} alt="" draggable="false" /></span>
        <span class="look-name">{look.name}</span>
      </button>
    {/each}
  </div>

  <footer class="looks-foot">
    <span class="looks-message" role="status">{message || (mapSurfaces
      ? (surfaceIds.length ? 'Replaces each preset\'s Edge Effects on these surfaces.' : emptyHint)
      : (shapes.length ? 'Replaces the Edge Effects on the target shapes.' : emptyHint))}</span>
    <button type="button" class="looks-remove" disabled={mapSurfaces ? !($project.mapSurfaces ?? []).some((surface) => surface.lookEffects) : !targets.length} onclick={removeLook}>Remove Look</button>
  </footer>
</div>

<style>
  .looks-gallery {
    position: fixed; z-index: 900; left: 316px; top: 92px; width: min(560px, calc(100vw - 340px));
    max-height: calc(100vh - 140px); display: flex; flex-direction: column;
    background: rgba(14, 15, 20, 0.97); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55); color: #e8e8ee; font-size: 12px;
  }
  /* Above the Presets tray (z-index 1204) and the VJ overlay. */
  .looks-gallery.lifted { z-index: 1300; }
  .looks-head { display: flex; justify-content: space-between; gap: 12px; padding: 14px 16px 8px; }
  .looks-head h3 { margin: 0 0 4px; font-size: 15px; letter-spacing: 0.02em; }
  .looks-head p { margin: 0; color: #9da3b0; line-height: 1.4; }
  .looks-close { background: none; border: 0; color: #9da3b0; font-size: 20px; cursor: pointer; line-height: 1; height: 24px; }
  .looks-close:hover { color: #fff; }
  .looks-controls { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 4px 16px 10px; }
  .looks-scope { display: flex; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 7px; overflow: hidden; }
  .looks-scope button { background: none; border: 0; color: #b9bdc8; padding: 5px 10px; cursor: pointer; font-size: 12px; }
  .looks-scope button.active { background: var(--ga-blue-a28); color: #fff; }
  .looks-scope button:disabled { opacity: 0.4; cursor: default; }
  .looks-palettes { display: flex; gap: 5px; flex-wrap: wrap; }
  .palette { display: flex; padding: 3px; gap: 1px; border-radius: 6px; border: 1px solid rgba(255, 255, 255, 0.12); background: #0b0b0f; cursor: pointer; }
  .palette span { width: 9px; height: 16px; border-radius: 2px; }
  .palette.active { border-color: #fff; box-shadow: 0 0 0 1px #fff; }
  .looks-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 8px; padding: 2px 16px 12px; overflow-y: auto; }
  .look-card { display: flex; flex-direction: column; gap: 5px; padding: 0; background: none; border: 0; color: inherit; cursor: pointer; text-align: left; }
  .look-thumb { position: relative; display: block; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 7px; background: #000; border: 1px solid rgba(255, 255, 255, 0.1); }
  .look-strip { position: absolute; left: 0; top: 0; height: 100%; width: 800%; max-width: none; animation: look-strip 1s steps(8) infinite; }
  .look-card:hover .look-thumb, .look-card:focus-visible .look-thumb { border-color: rgba(255, 255, 255, 0.5); }
  .look-card.active .look-thumb { border-color: var(--ga-blue-300); box-shadow: 0 0 0 2px var(--ga-blue-a45); }
  .look-name { font-size: 12px; color: #d5d8e0; }
  .look-card.active .look-name { color: #fff; font-weight: 600; }
  .looks-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 16px 14px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .looks-message { color: #9da3b0; }
  .looks-remove { background: none; border: 1px solid rgba(255, 255, 255, 0.18); color: #d5d8e0; border-radius: 6px; padding: 5px 10px; cursor: pointer; white-space: nowrap; }
  .looks-remove:disabled { opacity: 0.4; cursor: default; }
  @keyframes look-strip { to { transform: translateX(-100%); } }
  @media (prefers-reduced-motion: reduce) { .look-strip { animation: none; } }
</style>
