<script lang="ts">
  /**
   * Link to existing surface: pick the shared surface, tick the presets that
   * should use it and, in each, the layer that joins it (a copy it already
   * has, or the surface's layer added to it). Nothing is matched for the
   * user. A review lists every change before it is applied, as one undo step.
   * The model is stores/mapSurfaceLinks.ts.
   */
  import { onDestroy } from 'svelte';
  import { project } from '../stores/layers';
  import { surfaceLinkRequest } from '../stores/surfaceLinkRequest';
  import { showToast } from '../stores/errorToast';
  import {
    isBlockingIssue,
    linkableSurfaces,
    linkCandidates,
    planSurfaceLink,
    presetSurfaceState,
    type LinkableSurface,
    type SurfaceLinkDestination,
    type SurfaceLinkIssue,
    type SurfaceLinkPlanRow,
    type SurfaceLinkTarget,
  } from '../stores/mapSurfaceLinks';

  type Phase = 'closed' | 'choose' | 'review';
  interface Choice {
    selected: boolean;
    /** '' = not chosen yet, 'add' = add the layer, else a layer id. */
    dest: string;
    warp: 'shared' | 'own' | null;
    moveOff: boolean;
  }

  let phase: Phase = 'closed';
  let surfaceId = '';
  let choices: Record<string, Choice> = {};

  const blank = (): Choice => ({ selected: false, dest: '', warp: null, moveOff: false });

  const unsubscribe = surfaceLinkRequest.subscribe((request) => {
    if (!request) return;
    surfaceLinkRequest.set(null);
    const list = linkableSurfaces($project);
    surfaceId = request.surfaceId && list.some((s) => s.id === request.surfaceId) ? request.surfaceId : (list[0]?.id ?? '');
    choices = {};
    for (const id of request.compositionIds ?? []) choices[id] = { ...blank(), selected: true };
    phase = 'choose';
  });
  onDestroy(unsubscribe);

  $: surfaceList = phase === 'closed' ? [] : linkableSurfaces($project);
  $: source = surfaceList.find((s) => s.id === surfaceId) ?? null;
  $: presets = phase === 'closed' ? [] : ($project.vjMode?.compositions ?? []);
  $: destinations = presets
    .filter((c) => choices[c.id]?.selected)
    .map((c): SurfaceLinkDestination => ({ compositionId: c.id, target: targetOf(choices[c.id]) }));
  $: plan = phase === 'closed' || !surfaceId ? null : planSurfaceLink($project, { surfaceId, destinations });
  $: rowById = new Map((plan?.rows ?? []).map((row) => [row.compositionId, row]));
  $: changes = (plan?.rows ?? []).filter((row) => row.action !== 'none');
  $: selectedCount = destinations.length;

  function targetOf(choice: Choice | undefined): SurfaceLinkTarget | null {
    if (!choice?.dest) return null;
    if (choice.dest === 'add') return { kind: 'add' };
    return { kind: 'layer', layerId: choice.dest, ...(choice.warp ? { warp: choice.warp } : {}), moveOff: choice.moveOff };
  }

  function patch(id: string, next: Partial<Choice>) {
    choices = { ...choices, [id]: { ...(choices[id] ?? blank()), ...next } };
  }

  function pickSurface(id: string) {
    surfaceId = id;
    // The layers to choose from depend on the surface: keep the ticks only.
    choices = Object.fromEntries(Object.entries(choices).map(([key, c]) => [key, { ...blank(), selected: c.selected }]));
  }

  function close() {
    phase = 'closed';
    choices = {};
  }

  function apply() {
    if (!plan?.ready) return;
    const name = plan.surfaceName;
    const result = project.linkLayersToSurface({ surfaceId, destinations });
    if (!result.ok) {
      phase = 'choose';
      return;
    }
    showToast(`Linked ${result.changed} preset${result.changed === 1 ? '' : 's'} to ${name}. Undo reverts it.`, 'info');
    close();
  }

  function onKey(e: KeyboardEvent) {
    if (phase === 'closed') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (phase === 'review') phase = 'choose';
      else close();
    }
  }

  function issueText(issue: SurfaceLinkIssue): string {
    switch (issue.kind) {
      case 'no-source': return 'Pick a surface first.';
      case 'preset-missing': return 'This preset was deleted.';
      case 'no-choice': return 'Choose a layer, or add the layer.';
      case 'layer-missing': return 'That layer is no longer in this preset.';
      case 'group-layer': return 'A group cannot be linked.';
      case 'already-on-surface': return `Already on this surface (${issue.layerName}).`;
      case 'no-template': return 'No layer is on this surface to copy.';
      case 'detached': return 'This layer keeps its own warp.';
      case 'shared-elsewhere': return `${issue.presetNames.length} other preset${issue.presetNames.length === 1 ? '' : 's'} share its surface “${issue.surfaceName}” and stay on it.`;
    }
  }

  function reviewDetail(row: SurfaceLinkPlanRow): string {
    if (row.action === 'add') return `Adds ${row.layerName ?? 'the layer'}, on the shared warp`;
    const warp = row.warp === 'own' ? 'keeps its own warp' : 'takes the shared warp';
    const left = row.issues.find((issue) => issue.kind === 'shared-elsewhere');
    if (left?.kind === 'shared-elsewhere') return `Leaves “${left.surfaceName}” (${presetsLabel(left.presetNames.length)} stay), ${warp}`;
    return `Leaves its own surface, ${warp}`;
  }

  const presetsLabel = (n: number) => `${n} preset${n === 1 ? '' : 's'}`;

  $: presetNames = new Map(presets.map((c) => [c.id, c.name]));
  $: repeatedNames = new Set(surfaceList.map((s) => s.name).filter((name, i, all) => all.indexOf(name) !== i));

  /** Surfaces often share a name (pasted copies): say where each one is. */
  function surfaceLabel(s: LinkableSurface): string {
    const first = s.presetIds.length ? presetNames.get(s.presetIds[0]) ?? '' : '';
    if (s.presetIds.length === 0) return `${s.name} · editor only`;
    if (s.presetIds.length === 1) return `${s.name} · in ${first}`;
    return `${s.name} · ${presetsLabel(s.presetIds.length)}${repeatedNames.has(s.name) ? `, first in ${first}` : ''}`;
  }
</script>

<svelte:window onkeydown={onKey} />

{#if phase !== 'closed'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="sl-backdrop" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="sl-dialog" role="dialog" aria-modal="true" aria-labelledby="sl-title" tabindex="-1" data-testid="surface-link-dialog" onclick={(e) => e.stopPropagation()}>
      <header class="sl-head">
        <h2 id="sl-title">{phase === 'review' ? 'Review link' : 'Link to existing surface'}</h2>
        <button class="sl-close" onclick={close} aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg></button>
      </header>

      <div class="sl-body">
        {#if surfaceList.length === 0}
          <p class="sl-muted">No preset uses a shared surface yet. Save a preset first.</p>
        {:else if phase === 'choose'}
          <div class="sl-field">
            <label class="sl-eyebrow" for="sl-surface">Surface</label>
            <select id="sl-surface" data-testid="surface-link-source" value={surfaceId} onchange={(e) => pickSurface(e.currentTarget.value)}>
              {#each surfaceList as s (s.id)}
                <option value={s.id}>{surfaceLabel(s)}</option>
              {/each}
            </select>
          </div>
          <p class="sl-muted">Tick the presets that should use this surface's warp and pick the layer in each. Nothing is matched for you; media, effects and routing stay with each preset.</p>

          <div class="sl-eyebrow sl-list-head">Presets</div>
          <ul class="sl-presets">
            {#each presets as c (c.id)}
              {@const state = presetSurfaceState(c, surfaceId)}
              {@const choice = choices[c.id] ?? blank()}
              {@const row = rowById.get(c.id)}
              {@const candidates = state.kind === 'off' ? linkCandidates($project, c.id, surfaceId) : []}
              <li class="sl-preset" class:on={choice.selected} class:linked={state.kind === 'on'} data-testid="surface-link-preset">
                <label class="sl-tick">
                  <input
                    type="checkbox"
                    checked={choice.selected}
                    disabled={state.kind === 'on' && !choice.selected}
                    onchange={(e) => patch(c.id, { selected: e.currentTarget.checked })}
                  />
                  <span class="sl-name" title={c.name}>{c.name}</span>
                </label>
                {#if state.kind === 'on'}
                  <span class="sl-state">On this surface · {state.layerName}{state.detached ? ' (own warp)' : ''}</span>
                {:else}
                  <select
                    class="sl-dest"
                    aria-label={`Layer in ${c.name}`}
                    data-testid="surface-link-dest"
                    value={choice.dest}
                    disabled={!choice.selected}
                    onchange={(e) => patch(c.id, { dest: e.currentTarget.value, warp: null, moveOff: false })}
                  >
                    <option value="">Choose a layer…</option>
                    {#each candidates as layer (layer.id)}
                      <option value={layer.id}>{layer.name}{layer.detached ? ' · own warp' : ''}{layer.sharedWith.length ? ` · shared by ${presetsLabel(layer.sharedWith.length)}` : ''}</option>
                    {/each}
                    <option value="add">Add the layer to this preset</option>
                  </select>
                {/if}
                {#if choice.selected && row}
                  {#each row.issues as issue}
                    {#if issue.kind === 'detached'}
                      <div class="sl-resolve" role="radiogroup" aria-label="Warp">
                        <span class="sl-note">{issueText(issue)}</span>
                        <label class:picked={choice.warp === 'shared'}><input type="radio" name={`warp-${c.id}`} checked={choice.warp === 'shared'} onchange={() => patch(c.id, { warp: 'shared' })} />Use the shared warp</label>
                        <label class:picked={choice.warp === 'own'}><input type="radio" name={`warp-${c.id}`} checked={choice.warp === 'own'} onchange={() => patch(c.id, { warp: 'own' })} />Keep its own</label>
                      </div>
                    {:else if issue.kind === 'shared-elsewhere'}
                      <div class="sl-resolve">
                        <span class="sl-note" title={issue.presetNames.join(', ')}>{issueText(issue)}</span>
                        <label class:picked={choice.moveOff}><input type="checkbox" checked={choice.moveOff} onchange={(e) => patch(c.id, { moveOff: e.currentTarget.checked })} />Move this layer anyway</label>
                      </div>
                    {:else if isBlockingIssue(issue) && issue.kind !== 'no-choice'}
                      <div class="sl-resolve"><span class="sl-warn">{issueText(issue)}</span></div>
                    {/if}
                  {/each}
                {/if}
              </li>
            {/each}
          </ul>
        {:else if plan}
          <p class="sl-review-source">
            <span class="sl-eyebrow">Surface</span>
            <span class="sl-surface-name">{plan.surfaceName}</span>
            {#if source}<span class="sl-muted-inline">used by {presetsLabel(source.presetIds.length)} now</span>{/if}
          </p>
          <ul class="sl-review" data-testid="surface-link-review">
            {#each changes as row (row.compositionId)}
              <li>
                <span class="sl-arrow" aria-hidden="true">→</span>
                <span class="sl-name">{row.presetName}</span>
                <span class="sl-layer">{row.action === 'add' ? 'new layer' : row.layerName}</span>
                <span class="sl-detail">{reviewDetail(row)}</span>
              </li>
            {/each}
          </ul>
          <p class="sl-muted">Warp edits on this surface will move all of these. One undo reverts the whole link.</p>
        {/if}
      </div>

      <footer class="sl-actions">
        {#if phase === 'choose'}
          <span class="sl-count">{selectedCount ? `${presetsLabel(selectedCount)} selected` : 'No presets selected'}</span>
          <button class="sl-cancel" onclick={close}>Cancel</button>
          <button class="sl-primary" data-testid="surface-link-review-btn" disabled={!plan?.ready} onclick={() => (phase = 'review')}>Review</button>
        {:else}
          <button class="sl-cancel" onclick={() => (phase = 'choose')}>Back</button>
          <button class="sl-primary" data-testid="surface-link-apply" disabled={!plan?.ready} onclick={apply}>Link {presetsLabel(changes.length)}</button>
        {/if}
      </footer>
    </div>
  </div>
{/if}

<style>
  .sl-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: color-mix(in srgb, var(--ga-void, #0a0908) 76%, transparent);
    backdrop-filter: blur(8px);
    -webkit-app-region: no-drag;
  }
  .sl-dialog {
    width: min(600px, 100%);
    max-height: calc(100vh - 48px);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--ga-faceplate-bg, var(--ga-panel, #100f0d));
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: inset 0 1px 0 var(--ga-metal-hi, rgba(255, 255, 255, 0.08)), 0 24px 80px rgba(0, 0, 0, 0.58);
    color: var(--ga-ink-1, #ada9a2);
    font-size: var(--ga-text-body);
    font-family: var(--ga-font-ui, inherit);
    outline: none;
  }
  .sl-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    line-height: 1.3;
    color: var(--ga-ink-0, #f2ede4);
  }
  .sl-close {
    width: 26px;
    height: 26px;
    display: inline-grid;
    place-items: center;
    padding: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
  }
  .sl-close:hover { color: var(--ga-ink-0, #f2ede4); background: var(--ga-raise, #26221c); border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .sl-body { padding: 14px 16px; overflow-y: auto; }
  .sl-muted { color: var(--ga-ink-2, #89857e); margin: 8px 0 12px; font-size: var(--ga-text-meta); line-height: 1.45; }
  .sl-muted-inline { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); }
  .sl-eyebrow {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  .sl-field { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 6px; }
  select {
    min-width: 0;
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, #060504);
    color: var(--ga-ink-0, #eef0f4);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    padding: 0 8px;
    border-radius: var(--ga-r-hard, 2px);
    font-size: var(--ga-text-control, 12px);
  }
  select:disabled { opacity: 0.45; }
  select option { background: var(--ga-raise, #14141a); color: var(--ga-ink-0, #ddd); }
  #sl-surface { color: var(--ga-blue-300, #7d9aff); }
  .sl-list-head { margin: 4px 0 6px; }
  .sl-presets { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .sl-preset {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
    align-items: center;
    gap: 4px 10px;
    padding: 5px 8px;
    border: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
  }
  .sl-preset.on { border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); }
  .sl-preset.linked { background: transparent; }
  .sl-tick { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: pointer; }
  .sl-tick input { accent-color: var(--tl-on, #ff725f); margin: 0; }
  .sl-name { color: var(--ga-ink-0, #f2ede4); font-weight: var(--ga-weight-control); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sl-state { font-size: var(--ga-text-meta); color: var(--ga-blue-300, #7d9aff); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sl-resolve {
    grid-column: 1 / -1;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 12px;
    padding: 2px 0 2px 24px;
    font-size: var(--ga-text-meta);
  }
  .sl-resolve label { display: inline-flex; align-items: center; gap: 5px; color: var(--ga-ink-1, #ada9a2); cursor: pointer; }
  .sl-resolve label.picked { color: var(--tl-on-ink, #ffd9d2); }
  .sl-resolve input { accent-color: var(--tl-on, #ff725f); margin: 0; }
  .sl-note { color: var(--ga-ink-2, #89857e); flex-basis: 100%; }
  .sl-warn { color: #f0b35a; }
  .sl-review-source { display: flex; align-items: baseline; gap: 10px; margin: 0 0 10px; }
  .sl-surface-name { color: var(--ga-blue-300, #7d9aff); font-weight: var(--ga-weight-control); }
  .sl-review { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .sl-review li {
    display: grid;
    grid-template-columns: 16px minmax(0, 0.8fr) minmax(0, 0.9fr) minmax(0, 1.6fr);
    align-items: baseline;
    gap: 8px;
    padding: 5px 8px;
    border-bottom: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
    font-size: var(--ga-text-control);
  }
  .sl-arrow { color: var(--ga-blue-300, #7d9aff); }
  .sl-layer { color: var(--ga-ink-1, #ada9a2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sl-detail { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); }
  .sl-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 16px;
    border-top: 1px solid var(--ga-line-1, rgba(245, 236, 222, 0.07));
  }
  .sl-count { margin-right: auto; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta); }
  .sl-cancel,
  .sl-primary {
    height: var(--ga-bar-control-h, 28px);
    padding: 0 14px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
  }
  .sl-cancel { background: var(--ga-raise, #26221c); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); color: var(--ga-ink-1, #ada9a2); }
  .sl-cancel:hover { color: var(--ga-ink-0, #f2ede4); border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .sl-primary { background: var(--ga-ink-0, #f2ede4); border: 1px solid var(--ga-ink-0, #f2ede4); color: var(--ga-void, #0a0908); }
  .sl-primary:hover:not(:disabled) { filter: brightness(1.06); }
  .sl-primary:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
