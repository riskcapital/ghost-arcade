<script lang="ts">
  /**
   * The selected block on the Looks row: which Look, its colours, which
   * shapes wear it (all, or chosen pieces), its timing and fades.
   */
  import type { Layer, ShowLookClip } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { EDGE_LOOKS } from '../../../looks/edgeLookCatalog';
  import { LOOK_PALETTES, isLookTarget, type Rgba } from '../../../looks/edgeLooks';
  import { addLineAtPlayhead } from '../../../timeline/lines/timelineLines';
  import { lookBlockParams } from '../../../timeline/lines/paramRegistry';

  interface Props {
    clip: ShowLookClip;
    /** The mapping layers (pieces a block can be scoped to). */
    layers: readonly Layer[];
    onclose: () => void;
  }
  let { clip, layers, onclose }: Props = $props();

  const css = (c: Rgba) => `rgb(${Math.round(c[0] * 255)} ${Math.round(c[1] * 255)} ${Math.round(c[2] * 255)})`;
  /** Pieces a look can be scoped to: shapes and the groups that hold them. */
  const pieces = $derived(layers.filter((l) => isLookTarget(l) || (l.type === 'group' && layers.some((c) => c.parentGroupId === l.id && isLookTarget(c)))));
  const chosen = $derived(new Set(clip.layerIds ?? []));
  let piecesOpen = $state(false);

  function patch(p: Partial<ShowLookClip>) {
    showTimeline.updateLookClip(clip.id, p, { discrete: true });
  }
  function commit(e: Event, apply: (v: number) => void, read: () => number | undefined) {
    const input = e.currentTarget as HTMLInputElement;
    apply(parseFloat(input.value));
    const v = read();
    if (v !== undefined && Number.isFinite(v)) input.value = v.toFixed(2);
  }
  const live = () => showTimeline.findLookClip(clip.id);
  function togglePiece(id: string, on: boolean) {
    const next = new Set(chosen);
    if (on) next.add(id); else next.delete(id);
    patch({ scope: 'pieces', layerIds: [...next] });
  }
</script>

<div class="show-inspector" data-look-inspector>
  <span class="insp-title">Look block</span>
  <label class="insp-field">
    <span>Look</span>
    <select class="insp-look" value={clip.lookId} onchange={(e) => patch({ lookId: (e.currentTarget as HTMLSelectElement).value })} data-look-select>
      {#each EDGE_LOOKS as look (look.id)}
        <option value={look.id}>{look.name}</option>
      {/each}
    </select>
  </label>
  <span class="insp-palettes" role="radiogroup" aria-label="Colours">
    {#each LOOK_PALETTES as p (p.id)}
      <button type="button" role="radio" class="insp-palette" class:on={clip.paletteId === p.id} aria-checked={clip.paletteId === p.id}
        title={p.name} aria-label={`${p.name} colours`} onclick={() => patch({ paletteId: p.id })}>
        {#each p.colors as c, i (i)}<span style:background={css(c)}></span>{/each}
      </button>
    {/each}
  </span>
  <span class="insp-seg" role="radiogroup" aria-label="Worn by">
    <button type="button" role="radio" class:on={clip.scope === 'all'} aria-checked={clip.scope === 'all'} onclick={() => patch({ scope: 'all' })} data-look-scope-all>All shapes</button>
    <button type="button" role="radio" class:on={clip.scope === 'pieces'} aria-checked={clip.scope === 'pieces'}
      onclick={() => { piecesOpen = true; if (clip.scope !== 'pieces') patch({ scope: 'pieces', layerIds: clip.layerIds ?? [] }); }} data-look-scope-pieces>
      Pieces{clip.scope === 'pieces' ? ` (${chosen.size})` : ''}
    </button>
  </span>
  {#if clip.scope === 'pieces' && piecesOpen}
    <span class="insp-pieces" role="group" aria-label="Pieces that wear the look">
      {#each pieces as layer (layer.id)}
        <label class="insp-piece">
          <input type="checkbox" checked={chosen.has(layer.id)} onchange={(e) => togglePiece(layer.id, (e.currentTarget as HTMLInputElement).checked)} />
          <span class="layer-name">{layer.name}</span>
        </label>
      {:else}
        <span class="insp-hint">No shapes yet: draw one in Mapping.</span>
      {/each}
    </span>
  {/if}
  <span class="insp-lines" role="group" aria-label="Control lines for this look block">
    {#each lookBlockParams() as p (p.key)}
      <button type="button" class="insp-line" onclick={() => addLineAtPlayhead({ scope: 'look', id: clip.id }, p.key)}
        title={`◆ ${p.label}: a point at the playhead on this look block's ${p.label.toLowerCase()} line`} data-line-key={p.key} data-line-scope="look" data-line-target={clip.id} data-look-line={p.key}>◆ {p.label}</button>
    {/each}
  </span>
  <label class="insp-field">
    <span>Start</span>
    <input type="number" min="0" step="0.1" value={clip.startTime.toFixed(2)}
      onchange={(e) => commit(e, (v) => showTimeline.updateLookClip(clip.id, { startTime: Math.max(0, v || 0) }, { discrete: true }), () => live()?.startTime)} />
    <span class="insp-unit">s</span>
  </label>
  <label class="insp-field">
    <span>Length</span>
    <input type="number" min="0.1" step="0.1" value={clip.duration.toFixed(2)}
      onchange={(e) => commit(e, (v) => patch({ duration: Math.max(0.1, v || 0) }), () => live()?.duration)} />
    <span class="insp-unit">s</span>
  </label>
  <label class="insp-field">
    <span>Fade in</span>
    <input type="number" min="0" step="0.1" value={clip.fadeIn.toFixed(2)}
      onchange={(e) => commit(e, (v) => patch({ fadeIn: Math.max(0, v || 0) }), () => live()?.fadeIn)} />
    <span class="insp-unit">s</span>
  </label>
  <label class="insp-field">
    <span>Fade out</span>
    <input type="number" min="0" step="0.1" value={clip.fadeOut.toFixed(2)}
      onchange={(e) => commit(e, (v) => patch({ fadeOut: Math.max(0, v || 0) }), () => live()?.fadeOut)} />
    <span class="insp-unit">s</span>
  </label>
  <span class="insp-hint">Overlap two looks to crossfade them. Outside the blocks the shapes wear their own Edge Effects.</span>
  <button class="insp-delete" onclick={() => showTimeline.removeLookClip(clip.id)}>Delete</button>
  <button aria-label="Close look inspector" class="insp-close" onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex;
    align-items: center;
    gap: 10px 12px;
    min-height: 36px;
    padding: 4px 12px;
    background: var(--ga-card, #121217);
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .insp-title {
    color: #FFD96B;
    font-weight: var(--ga-weight-control, 600);
    padding-right: 12px;
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input[type="number"],
  .insp-field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    width: 64px;
    outline: none;
    font-family: inherit;
  }
  .insp-field input[type="number"] { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .insp-field select.insp-look { width: 120px; }
  .insp-unit { color: var(--ga-ink-2, #888); }
  .insp-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .insp-palettes { display: flex; gap: 3px; }
  .insp-palette {
    display: flex; height: var(--ga-control-h-sm, 22px); box-sizing: border-box; align-items: center; padding: 3px; gap: 1px;
    border-radius: var(--ga-r-hard, 3px); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); background: var(--ga-slot, #0b0b0f); cursor: pointer;
  }
  .insp-palette span { width: 6px; height: 100%; border-radius: 1px; }
  .insp-palette.on { border-color: var(--ga-selection-line, #5278ff); box-shadow: 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .insp-seg {
    display: flex; height: var(--ga-control-h-sm, 22px); padding: 1px; gap: 1px; box-sizing: border-box;
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: var(--ga-r-hard, 3px);
  }
  .insp-seg button {
    background: none; border: 0; border-radius: 2px; color: var(--ga-ink-1, #b9bdc8); padding: 0 8px; cursor: pointer;
    font: inherit; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600);
  }
  .insp-seg button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .insp-pieces { display: flex; flex-wrap: wrap; gap: 4px 10px; max-width: 520px; }
  .insp-piece { display: flex; align-items: center; gap: 4px; }
  .insp-delete {
    margin-left: auto;
    height: var(--ga-control-h-sm, 22px);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    font-family: inherit;
  }
  .insp-delete:hover { background: color-mix(in srgb, var(--ga-rec, #ff4757) 14%, transparent); }
  .insp-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }
  .insp-lines { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .insp-line {
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid rgba(255, 217, 107, 0.4);
    color: rgba(255, 217, 107, 0.85);
    border-radius: 3px;
    font: inherit;
    font-size: 11px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .insp-line:hover { border-color: #FFD96B; color: #FFD96B; }
</style>
