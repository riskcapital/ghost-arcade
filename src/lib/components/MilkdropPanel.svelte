<!--
  Milkdrop custom panel: preset browser + transport controls + favorites.
  Rendered above the generic paramDefs slider list in PluginLayerPanel for
  any layer whose effectSource.effectType === 'milkdrop'.
-->
<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { milkdropStore } from '../stores/milkdrop';
  import { loadPresetPack, type MilkdropPresetPack } from '../effects/milkdropPresets';

  export let layerId: string;
  export let presetPack: string = 'minimal';

  let presetNames: string[] = [];
  let loading = false;
  let loadError: string | null = null;
  let filterText = '';
  let favoritesOnly = false;

  // Reactive state from the store — current preset reported by renderer, favorites, lock.
  $: store = $milkdropStore;
  $: currentPresetName = store.currentPreset[layerId] ?? '';
  $: locked = !!store.locked[layerId];
  $: favorites = store.favorites;

  $: filteredPresets = (() => {
    const lower = filterText.trim().toLowerCase();
    let out = presetNames;
    if (lower) out = out.filter(n => n.toLowerCase().includes(lower));
    if (favoritesOnly) out = out.filter(n => favorites.has(n));
    return out;
  })();

  // Load whenever the pack changes
  $: void reloadPack(presetPack);

  async function reloadPack(pack: string) {
    loading = true;
    loadError = null;
    try {
      const presets = await loadPresetPack(pack as MilkdropPresetPack);
      presetNames = Object.keys(presets).sort();
    } catch (e: any) {
      loadError = String(e?.message || e);
      presetNames = [];
    } finally {
      loading = false;
    }
  }

  function fire(kind: 'next' | 'prev' | 'random' | 'cut') {
    milkdropStore.command(layerId, kind);
  }
  function toggleLock() {
    milkdropStore.command(layerId, locked ? 'unlock' : 'lock');
  }
  function loadByName(name: string) {
    milkdropStore.command(layerId, 'load', name);
  }
  function toggleFav(name: string, ev: MouseEvent) {
    ev.stopPropagation();
    milkdropStore.toggleFavorite(name);
  }

  // Auto-scroll the current preset into view in the list when it changes.
  let listEl: HTMLDivElement | undefined;
  $: if (listEl && currentPresetName) {
    queueMicrotask(() => {
      const el = listEl!.querySelector(`[data-name="${cssEscape(currentPresetName)}"]`) as HTMLElement | null;
      el?.scrollIntoView({ block: 'nearest' });
    });
  }
  function cssEscape(s: string): string {
    // Minimal escape — preset names occasionally contain quotes/parens; CSS.escape is the standard.
    if (typeof CSS !== 'undefined' && (CSS as any).escape) return (CSS as any).escape(s);
    return s.replace(/[^a-zA-Z0-9_-]/g, c => '\\' + c);
  }

  // ── Keyboard shortcuts (scoped to when this panel is mounted) ────────
  // D = next preset, R = random preset. Active any time a milkdrop layer
  // is selected (= this panel is in the DOM). Skipped while the user is
  // typing in the filter box or any other input so we don't hijack
  // letters mid-typing.
  function onKeydown(e: KeyboardEvent) {
    const t = e.target as HTMLElement | null;
    const tag = t?.tagName ?? '';
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as any)?.isContentEditable) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      fire('next');
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      fire('random');
    }
  }

  onMount(() => {
    void reloadPack(presetPack);
    window.addEventListener('keydown', onKeydown);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', onKeydown);
  });
</script>

<div data-help-page="gpu-instruments" class="mk-panel">
  <!-- Transport row -->
  <div class="mk-transport">
    <button class="mk-btn" title="Previous preset" onclick={() => fire('prev')}>◀</button>
    <button class="mk-btn" title="Random preset (R)" onclick={() => fire('random')}>🎲</button>
    <button class="mk-btn" title="Next preset (D)" onclick={() => fire('next')}>▶</button>
    <button class="mk-btn cut" title="Hard cut now (instant blend)" onclick={() => fire('cut')}>Cut</button>
    <button
      class="mk-btn lock"
      class:active={locked}
      title={locked ? 'Locked — auto-evolve paused' : 'Lock current preset'}
      onclick={toggleLock}
    >{locked ? '🔒' : '🔓'}</button>
  </div>
  <div class="mk-hotkey-hint"><kbd>D</kbd> next · <kbd>R</kbd> random</div>

  <!-- Now-playing -->
  <div class="mk-now">
    <span class="mk-now-label">Now</span>
    <span class="mk-now-name" title={currentPresetName}>{currentPresetName || '—'}</span>
    {#if currentPresetName}
      <button
        class="mk-fav-btn"
        class:active={favorites.has(currentPresetName)}
        title={favorites.has(currentPresetName) ? 'Unfavorite' : 'Favorite'}
        onclick={(e) => toggleFav(currentPresetName, e)}
      >{favorites.has(currentPresetName) ? '★' : '☆'}</button>
    {/if}
  </div>

  <!-- Filter row -->
  <div class="mk-filter">
    <input
      type="text"
      placeholder="Filter presets…"
      bind:value={filterText}
    />
    <button
      class="mk-fav-only"
      class:active={favoritesOnly}
      title="Show only favorites"
      onclick={() => (favoritesOnly = !favoritesOnly)}
    >★ {favorites.size}</button>
  </div>

  <!-- Preset list -->
  <div class="mk-list" bind:this={listEl}>
    {#if loading}
      <div class="mk-empty">Loading {presetPack}…</div>
    {:else if loadError}
      <div class="mk-empty err">Failed: {loadError}</div>
    {:else if filteredPresets.length === 0}
      <div class="mk-empty">No matches in {presetPack}.</div>
    {:else}
      {#each filteredPresets as name (name)}
        <div
          class="mk-row"
          class:active={name === currentPresetName}
          data-name={name}
          onclick={() => loadByName(name)}
          role="button"
          tabindex="0"
          onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') loadByName(name); }}
        >
          <span class="mk-row-name">{name}</span>
          <button
            class="mk-row-fav"
            class:active={favorites.has(name)}
            title={favorites.has(name) ? 'Unfavorite' : 'Favorite'}
            onclick={(e) => toggleFav(name, e)}
          >{favorites.has(name) ? '★' : '☆'}</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .mk-panel {
    display: flex;
    flex-direction: column;
    background: var(--ga-panel);
    border-bottom: 1px solid var(--ga-line-1);
    padding: 12px;
    gap: 8px;
    max-height: 360px;
  }
  .mk-transport { display: flex; gap: 4px; }
  .mk-btn {
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
  .mk-btn:hover:not(.active) { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .mk-btn.lock.active { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }

  .mk-hotkey-hint {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
    text-align: center;
    margin-top: -2px;
  }
  .mk-hotkey-hint kbd {
    background: var(--ga-sub);
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard);
    padding: 1px 5px;
    font-size: var(--ga-text-eyebrow);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    margin: 0 2px;
  }

  .mk-now {
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
  .mk-now-label {
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    color: var(--ga-ink-2);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking);
  }
  .mk-now-name {
    flex: 1;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    color: var(--ga-ink-0);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mk-fav-btn, .mk-fav-only {
    height: var(--ga-control-h-sm);
    background: transparent;
    border: 1px solid var(--ga-line-2);
    color: var(--ga-ink-2);
    font-size: var(--ga-text-control);
    padding: 0 6px;
    border-radius: var(--ga-r-hard);
    cursor: pointer;
  }
  .mk-fav-only { height: var(--ga-control-h); }
  .mk-fav-btn:hover, .mk-fav-only:hover { color: var(--ga-ink-0); border-color: var(--ga-line-3); }
  .mk-fav-btn.active, .mk-fav-only.active {
    color: #fcd34d;
    border-color: #92681f;
    background: #2a1f08;
  }

  .mk-filter { display: flex; gap: 4px; }
  .mk-filter input[type="text"] {
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
  .mk-filter input[type="text"]:focus { border-color: var(--ga-focus); }

  .mk-list {
    overflow-y: auto;
    flex: 1;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard);
    min-height: 100px;
    max-height: 220px;
  }
  .mk-row {
    display: flex;
    align-items: center;
    min-height: var(--ga-control-h-sm);
    padding: 0 4px 0 8px;
    cursor: pointer;
    gap: 4px;
    border-bottom: 1px solid var(--ga-line-1);
  }
  .mk-row:hover { background: var(--ga-card); }
  .mk-row.active { background: var(--ga-selection-bg); box-shadow: inset 2px 0 0 var(--ga-selection-line); }
  .mk-row.active .mk-row-name { color: var(--ga-selection-ink); }
  .mk-row-name {
    flex: 1;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .mk-row-fav {
    background: transparent;
    border: none;
    color: var(--ga-ink-3);
    font-size: 13px;
    padding: 0 4px;
    cursor: pointer;
  }
  .mk-row-fav:hover { color: var(--ga-ink-1); }
  .mk-row-fav.active { color: #fcd34d; }

  .mk-empty {
    padding: 12px;
    text-align: center;
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2);
  }
  .mk-empty.err { color: var(--ga-rec); }
</style>
