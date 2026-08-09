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

<div class="mk-panel">
  <!-- Transport row -->
  <div class="mk-transport">
    <button class="mk-btn" title="Previous preset" onclick={() => fire('prev')}>◀</button>
    <button class="mk-btn" title="Random preset (R)" onclick={() => fire('random')}>🎲</button>
    <button class="mk-btn" title="Next preset (D)" onclick={() => fire('next')}>▶</button>
    <button class="mk-btn cut" title="Hard cut now (instant blend)" onclick={() => fire('cut')}>CUT</button>
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
    <span class="mk-now-label">NOW</span>
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
    background: linear-gradient(180deg, #0e0a1a, #0a0612);
    border-bottom: 1px solid #2a2a3a;
    padding: 8px;
    gap: 8px;
    max-height: 360px;
  }
  .mk-transport {
    display: flex;
    gap: 4px;
  }
  .mk-btn {
    flex: 1;
    padding: 5px 0;
    background: #1a1530;
    border: 1px solid #3a2960;
    border-radius: 3px;
    color: #c9b8ff;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.12s;
  }
  .mk-btn:hover { background: #2a1f50; color: #fff; }
  .mk-btn.cut { background: #3a0d2a; border-color: #8a1f5e; color: #ff80c0; }
  .mk-btn.cut:hover { background: #5a153f; }
  .mk-btn.lock.active { background: #0d3320; border-color: #22c55e; color: #4ade80; }

  .mk-hotkey-hint {
    font-size: 10px;
    color: #555;
    text-align: center;
    letter-spacing: 0.4px;
    margin-top: -4px;
  }
  .mk-hotkey-hint kbd {
    background: #15102a;
    border: 1px solid #2a2235;
    color: var(--text-secondary, #aaa);
    border-radius: 3px;
    padding: 1px 5px;
    font-size: 10px;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    margin: 0 2px;
  }

  .mk-now {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #060410;
    border-radius: 3px;
    padding: 4px 8px;
  }
  .mk-now-label {
    font-size: 10px;
    color: #555;
    letter-spacing: 0.6px;
  }
  .mk-now-name {
    flex: 1;
    font-size: 12px;
    color: #d4b8ff;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .mk-fav-btn, .mk-fav-only {
    background: transparent;
    border: 1px solid #333;
    color: #555;
    font-size: 12px;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .mk-fav-btn.active, .mk-fav-only.active {
    color: #fcd34d;
    border-color: #92681f;
    background: #2a1f08;
  }

  .mk-filter {
    display: flex;
    gap: 4px;
  }
  .mk-filter input[type="text"] {
    flex: 1;
    background: #0a0612;
    border: 1px solid #2a2235;
    color: var(--text-primary, #ddd);
    padding: 4px 6px;
    border-radius: 3px;
    font-size: 11px;
    outline: none;
  }
  .mk-filter input[type="text"]:focus { border-color: #6938aa; }

  .mk-list {
    overflow-y: auto;
    flex: 1;
    background: #060410;
    border: 1px solid #1a1428;
    border-radius: 3px;
    min-height: 100px;
    max-height: 220px;
  }
  .mk-row {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    cursor: pointer;
    gap: 4px;
    border-bottom: 1px solid #110a1c;
  }
  .mk-row:hover { background: #15102a; }
  .mk-row.active { background: #2a1560; }
  .mk-row.active .mk-row-name { color: #fff; }
  .mk-row-name {
    flex: 1;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .mk-row-fav {
    background: transparent;
    border: none;
    color: #555;
    font-size: 13px;
    padding: 0 4px;
    cursor: pointer;
  }
  .mk-row-fav.active { color: #fcd34d; }

  .mk-empty {
    padding: 12px;
    text-align: center;
    font-size: 11px;
    color: #555;
  }
  .mk-empty.err { color: #f87171; }
</style>
