<!--
  Hydra custom panel: sketch browser + transport + favorites + sketch
  source viewer. Rendered inside PluginLayerPanel when the selected
  layer's effect is 'hydra'. D/R hotkeys mirror Milkdrop's pattern.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { hydraStore } from '../stores/hydra';
  import { HYDRA_PRESETS, pickNextHydraPreset } from '../effects/hydraPresets';

  export let layerId: string;
  export let onPresetSelect: ((preset: { name: string; code: string }) => void) | null = null;

  let filterText = '';
  let favoritesOnly = false;
  let showCode = false;

  $: store = $hydraStore;
  $: currentPresetName = store.currentPreset[layerId] ?? '';
  $: favorites = store.favorites;

  $: filteredPresets = (() => {
    const lower = filterText.trim().toLowerCase();
    let out = HYDRA_PRESETS;
    if (lower) out = out.filter(p => p.name.toLowerCase().includes(lower));
    if (favoritesOnly) out = out.filter(p => favorites.has(p.name));
    return out;
  })();

  $: currentPresetCode = HYDRA_PRESETS.find(p => p.name === currentPresetName)?.code ?? '';
  $: currentPresetBy   = HYDRA_PRESETS.find(p => p.name === currentPresetName)?.by ?? '';

  function targetPresetFor(kind: 'next' | 'prev' | 'random') {
    if (kind === 'random') return pickNextHydraPreset(currentPresetName || null);
    const idx = currentPresetName ? HYDRA_PRESETS.findIndex(p => p.name === currentPresetName) : -1;
    if (kind === 'next') return HYDRA_PRESETS[(idx + 1 + HYDRA_PRESETS.length) % HYDRA_PRESETS.length];
    const prevIdx = idx >= 0 ? idx : 0;
    return HYDRA_PRESETS[(prevIdx - 1 + HYDRA_PRESETS.length) % HYDRA_PRESETS.length];
  }

  function fire(kind: 'next' | 'prev' | 'random') {
    const target = onPresetSelect ? targetPresetFor(kind) : null;
    if (target && onPresetSelect) {
      onPresetSelect(target);
      hydraStore.reportPreset(layerId, target.name);
    }
    hydraStore.command(layerId, kind);
  }
  function loadByName(name: string) {
    const target = HYDRA_PRESETS.find(p => p.name === name);
    if (target && onPresetSelect) {
      onPresetSelect(target);
      hydraStore.reportPreset(layerId, target.name);
    }
    hydraStore.command(layerId, 'load', name);
  }
  function toggleFav(name: string, ev?: MouseEvent) {
    ev?.stopPropagation();
    hydraStore.toggleFavorite(name);
  }

  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as any)?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'd' || e.key === 'D') { e.preventDefault(); fire('next'); }
    else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); fire('random'); }
  }

  let listEl: HTMLDivElement | undefined;
  $: if (listEl && currentPresetName) {
    queueMicrotask(() => {
      const el = listEl!.querySelector(`[data-name="${cssEscape(currentPresetName)}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
  function cssEscape(s: string): string {
    if (typeof CSS !== 'undefined' && (CSS as any).escape) return (CSS as any).escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  onMount(() => { window.addEventListener('keydown', onKeydown); });
  onDestroy(() => { window.removeEventListener('keydown', onKeydown); });
</script>

<div data-help-page="gpu-instruments" class="hy-panel">
  <!-- Transport -->
  <div class="hy-transport">
    <button class="hy-btn" title="Previous sketch" onclick={() => fire('prev')}>◀</button>
    <button class="hy-btn" title="Random sketch (R)" onclick={() => fire('random')}>🎲</button>
    <button class="hy-btn" title="Next sketch (D)" onclick={() => fire('next')}>▶</button>
  </div>
  <div class="hy-hotkey-hint"><kbd>D</kbd> next · <kbd>R</kbd> random</div>

  <!-- Now-playing -->
  <div class="hy-now">
    <span class="hy-now-label">Now</span>
    <span class="hy-now-name" title={currentPresetName}>{currentPresetName || '—'}</span>
    {#if currentPresetName}
      <button
        class="hy-fav-btn"
        class:active={favorites.has(currentPresetName)}
        title={favorites.has(currentPresetName) ? 'Unfavorite' : 'Favorite'}
        onclick={(e) => toggleFav(currentPresetName, e)}
      >{favorites.has(currentPresetName) ? '★' : '☆'}</button>
    {/if}
  </div>
  {#if currentPresetBy}
    <div class="hy-by">sketch by {currentPresetBy}</div>
  {/if}

  <!-- Sketch source viewer (toggle) -->
  <button class="hy-code-toggle" onclick={() => (showCode = !showCode)}>
    {showCode ? 'Hide' : 'Show'} sketch source
  </button>
  {#if showCode && currentPresetCode}
    <pre class="hy-code">{currentPresetCode}</pre>
  {/if}

  <!-- Filter -->
  <div class="hy-filter">
    <input type="text" placeholder="Filter sketches…" bind:value={filterText} />
    <button
      class="hy-fav-only"
      class:active={favoritesOnly}
      title="Show only favorites"
      onclick={() => (favoritesOnly = !favoritesOnly)}
    >★ {favorites.size}</button>
  </div>

  <!-- Sketch list -->
  <div class="hy-list" bind:this={listEl}>
    {#if filteredPresets.length === 0}
      <div class="hy-empty">No matches.</div>
    {:else}
      {#each filteredPresets as p (p.name)}
        <div
          class="hy-row"
          class:active={p.name === currentPresetName}
          data-name={p.name}
          onclick={() => loadByName(p.name)}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') loadByName(p.name); }}
        >
          <span class="hy-row-name">{p.name}</span>
          <button
            class="hy-row-fav"
            class:active={favorites.has(p.name)}
            onclick={(e) => toggleFav(p.name, e)}
          >{favorites.has(p.name) ? '★' : '☆'}</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .hy-panel {
    display: flex;
    flex-direction: column;
    background: var(--ga-panel);
    border-bottom: 1px solid var(--ga-line-1);
    padding: 12px;
    gap: 8px;
    max-height: 460px;
  }
  .hy-transport { display: flex; gap: 4px; }
  .hy-btn {
    flex: 1;
    height: var(--ga-control-h);
    padding: 0;
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    color: var(--ga-ink-1);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: all 0.12s;
  }
  .hy-btn:hover:not(.active) { color: var(--ga-ink-0); border-color: var(--ga-line-3); }

  .hy-hotkey-hint {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    text-align: center;
    margin-top: -2px;
  }
  .hy-hotkey-hint kbd {
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard);
    padding: 1px 5px;
    font-size: var(--ga-text-eyebrow);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    margin: 0 2px;
  }

  .hy-now {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: var(--ga-control-h);
    background: var(--ga-card);
    border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard);
    padding: 2px 4px 2px 8px;
  }
  /* Eyebrow label, same as every layer editor. */
  .hy-now-label {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
  }
  .hy-now-name {
    flex: 1;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hy-fav-btn, .hy-fav-only {
    height: var(--ga-control-h-sm);
    background: transparent;
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-2);
    font-size: var(--ga-text-control);
    padding: 0 6px;
    border-radius: var(--ga-r-hard);
    cursor: pointer;
  }
  .hy-fav-only { height: var(--ga-control-h); }
  .hy-fav-btn:hover, .hy-fav-only:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .hy-fav-btn.active, .hy-fav-only.active {
    color: #fcd34d;
    border-color: #92681f;
    background: #2a1f08;
  }

  .hy-by {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    margin-top: -4px;
  }

  .hy-code-toggle {
    align-self: flex-start;
    height: var(--ga-control-h-sm);
    background: transparent;
    border: 1px dashed var(--ga-line-2);
    color: var(--ga-ink-1);
    font-size: var(--ga-text-meta);
    font-weight: var(--ga-weight-control);
    padding: 0 8px;
    border-radius: var(--ga-r-hard);
    cursor: pointer;
  }
  .hy-code-toggle:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .hy-code {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1);
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    padding: 6px 8px;
    margin: 0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }

  .hy-filter { display: flex; gap: 4px; }
  .hy-filter input[type="text"] {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h);
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-0);
    padding: 0 8px;
    border-radius: var(--ga-r-hard);
    font-size: var(--ga-text-control);
    outline: none;
  }
  .hy-filter input[type="text"]:focus { border-color: var(--ga-focus); }

  .hy-list {
    overflow-y: auto;
    flex: 1;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    min-height: 100px;
    max-height: 200px;
  }
  .hy-row {
    display: flex;
    align-items: center;
    min-height: var(--ga-control-h-sm);
    padding: 0 4px 0 8px;
    cursor: pointer;
    gap: 4px;
    border-bottom: 1px solid var(--ga-line-1);
  }
  .hy-row:hover { background: var(--ga-card); }
  .hy-row.active { background: var(--ga-selection-bg); box-shadow: inset 2px 0 0 var(--ga-selection-line); }
  .hy-row.active .hy-row-name { color: var(--ga-selection-ink); }
  .hy-row-name {
    flex: 1;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .hy-row-fav {
    background: transparent;
    border: none;
    color: var(--ga-ink-3);
    font-size: 13px;
    padding: 0 4px;
    cursor: pointer;
  }
  .hy-row-fav:hover { color: var(--ga-ink-1); }
  .hy-row-fav.active { color: #fcd34d; }

  .hy-empty {
    padding: 12px;
    text-align: center;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
  }
</style>
