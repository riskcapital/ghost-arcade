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

<div class="hy-panel">
  <!-- Transport -->
  <div class="hy-transport">
    <button class="hy-btn" title="Previous sketch" onclick={() => fire('prev')}>◀</button>
    <button class="hy-btn" title="Random sketch (R)" onclick={() => fire('random')}>🎲</button>
    <button class="hy-btn" title="Next sketch (D)" onclick={() => fire('next')}>▶</button>
  </div>
  <div class="hy-hotkey-hint"><kbd>D</kbd> next · <kbd>R</kbd> random</div>

  <!-- Now-playing -->
  <div class="hy-now">
    <span class="hy-now-label">NOW</span>
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
    background: linear-gradient(180deg, #0e0a1a, #0a0612);
    border-bottom: 1px solid #2a2a3a;
    padding: 8px;
    gap: 6px;
    max-height: 460px;
  }
  .hy-transport { display: flex; gap: 4px; }
  .hy-btn {
    flex: 1;
    padding: 5px 0;
    background: #15101e;
    border: 1px solid rgba(255, 107, 107, 0.20);
    border-radius: 3px;
    color: var(--accent-secondary, #FF8585);
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.12s;
  }
  .hy-btn:hover { background: #20162e; color: var(--accent-primary, #FF6B6B); border-color: rgba(255, 107, 107, 0.55); }

  .hy-hotkey-hint {
    font-size: 10px;
    color: #555;
    text-align: center;
    letter-spacing: 0.4px;
  }
  .hy-hotkey-hint kbd {
    background: #15102a;
    border: 1px solid #2a2235;
    color: var(--text-secondary, #aaa);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
    margin: 0 2px;
  }

  .hy-now {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #060410;
    border-radius: 3px;
    padding: 4px 8px;
  }
  .hy-now-label {
    font-size: 10px;
    color: #555;
    letter-spacing: 0.6px;
  }
  .hy-now-name {
    flex: 1;
    font-size: 12px;
    color: var(--accent-secondary, #FF8585);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .hy-fav-btn, .hy-fav-only {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .hy-fav-btn.active, .hy-fav-only.active {
    color: #fcd34d;
    border-color: #92681f;
    background: #2a1f08;
  }

  .hy-by {
    font-size: 10px;
    color: #555;
    padding: 0 2px;
  }

  .hy-code-toggle {
    background: transparent;
    border: 1px dashed rgba(255, 107, 107, 0.20);
    color: var(--text-muted, #888);
    font-size: 10px;
    padding: 3px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .hy-code-toggle:hover { color: var(--accent-secondary, #FF8585); border-color: rgba(255, 107, 107, 0.45); }
  .hy-code {
    font-size: 10.5px;
    color: #b8a8d4;
    background: #060410;
    border: 1px solid #1a1428;
    border-radius: 3px;
    padding: 5px 7px;
    margin: 0;
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }

  .hy-filter { display: flex; gap: 4px; }
  .hy-filter input[type="text"] {
    flex: 1;
    background: #0a0612;
    border: 1px solid #2a2235;
    color: var(--text-primary, #ddd);
    padding: 4px 6px;
    border-radius: 3px;
    font-size: 11px;
    outline: none;
  }
  .hy-filter input[type="text"]:focus { border-color: var(--accent-primary, #FF6B6B); }

  .hy-list {
    overflow-y: auto;
    flex: 1;
    background: #060410;
    border: 1px solid #1a1428;
    border-radius: 3px;
    min-height: 100px;
    max-height: 200px;
  }
  .hy-row {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    cursor: pointer;
    gap: 4px;
    border-bottom: 1px solid #110a1c;
  }
  .hy-row:hover { background: #15102a; }
  .hy-row.active { background: rgba(255, 107, 107, 0.15); }
  .hy-row.active .hy-row-name { color: #fff; }
  .hy-row-name {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--ga-font-mono, 'IBM Plex Mono', ui-monospace, monospace);
  }
  .hy-row-fav {
    background: transparent;
    border: none;
    color: #555;
    font-size: 13px;
    padding: 0 4px;
    cursor: pointer;
  }
  .hy-row-fav.active { color: #fcd34d; }

  .hy-empty {
    padding: 12px;
    text-align: center;
    font-size: 11px;
    color: #555;
  }
</style>
