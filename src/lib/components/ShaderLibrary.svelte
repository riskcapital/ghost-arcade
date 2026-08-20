<script lang="ts">
  import { onMount, createEventDispatcher } from 'svelte';
  import { parseISF } from '../isf/parser';
  import { estimateShaderLoadRating } from '../isf/loadRating';
  import { shaderLibrary, type SavedShader } from '../stores/shaderLibrary';
  import { t } from '../i18n';

  export let isOpen = false;
  export let currentShaderIds: Set<string> = new Set();
  export let onClose: () => void = () => {};

  const dispatch = createEventDispatcher();

  /**
   * Manifest entry — bundled shaders that ship with the app.
   * Loaded from `./ISF/manifest.json`. Identified by file path.
   */
  interface ManifestEntry {
    file: string;
    tier?: string;
    category?: string;
    tags?: string[];
    defaults?: Record<string, any>;
    featured?: boolean;
    enabled?: boolean;
    defaultLoad?: boolean;
  }

  /**
   * Unified card model for the modal grid. Both bundled (manifest) shaders
   * and user-library shaders (cloud / AI / user-imported) get normalised
   * into this shape so the grid + filters are source-agnostic.
   */
  interface ShaderCard {
    /** Stable identifier used in the tray's currentShaderIds set. */
    trayId: string;
    /** Display name. */
    name: string;
    /** 'manifest' = bundled (selectable + dispatched on add). 'cloud' / 'ai' / 'user' = already in the library store, tray-only. */
    source: 'manifest' | 'cloud' | 'ai' | 'user';
    category?: string;
    tags?: string[];
    /** Image URL or data URL for thumbnail. Falls back to gradient if missing/broken. */
    thumbnail?: string;
    /** Manifest-specific original entry (forwarded on add). */
    manifest?: ManifestEntry;
    /** Library-specific id (the `SavedShader.id`). */
    libraryShaderId?: string;
  }

  const categoryTranslationKeys: Record<string, string> = {
    Visual: 'visual',
    Generator: 'generator',
    Simulation: 'simulation',
    '3D Room': 'room3d',
    'Audio Reactive': 'audioReactive',
    Uncategorized: 'uncategorized',
    'source.cloud': 'cloud',
    'source.aiGenerated': 'aiGenerated',
    'source.myLibrary': 'myLibrary',
  };

  let manifestShaders: ManifestEntry[] = [];
  let manifestLoading = true;
  let searchQuery = '';
  let filterCategory = 'all';
  let sourceFilter: 'all' | 'manifest' | 'library' = 'all';
  let selected: Set<string> = new Set(); // by trayId — only manifest shaders are selectable
  let isSyncing = false;
  let syncMessage = '';

  // Live subscription to user library (cloud + AI + user-imported)
  $: librarySaved = $shaderLibrary.shaders.filter((s: SavedShader) => s.type === 'shader-isf');

  // Build the unified card list whenever inputs change.
  $: allCards = buildCards(manifestShaders, librarySaved);
  $: categories = uniqueCategories(allCards);
  $: filteredCards = applyFilters(allCards, searchQuery, filterCategory, sourceFilter);
  $: selectedCount = selected.size;

  function buildCards(manifest: ManifestEntry[], saved: SavedShader[]): ShaderCard[] {
    const cards: ShaderCard[] = [];
    for (const m of manifest) {
      cards.push({
        trayId: `isf:${m.file}`,
        name: displayName(m.file),
        source: 'manifest',
        category: m.category,
        tags: m.tags,
        thumbnail: thumbnailUrl(m.file),
        manifest: m,
      });
    }
    for (const s of saved) {
      const src: 'cloud' | 'ai' | 'user' = s.source === 'cloud' ? 'cloud' : s.source === 'ai' ? 'ai' : 'user';
      cards.push({
        trayId: s.id,
        name: s.name,
        source: src,
        category: src === 'cloud' ? 'source.cloud' : src === 'ai' ? 'source.aiGenerated' : 'source.myLibrary',
        tags: s.tags,
        thumbnail: s.thumbnail,
        libraryShaderId: s.id,
      });
    }
    return cards;
  }

  function uniqueCategories(cards: ShaderCard[]): string[] {
    const set = new Set<string>();
    for (const c of cards) {
      if (c.category) set.add(c.category);
    }
    return [...set].sort();
  }

  function applyFilters(
    cards: ShaderCard[],
    q: string,
    cat: string,
    src: 'all' | 'manifest' | 'library',
  ): ShaderCard[] {
    const ql = q.trim().toLowerCase();
    return cards.filter((c) => {
      if (src === 'manifest' && c.source !== 'manifest') return false;
      if (src === 'library' && c.source === 'manifest') return false;
      if (cat !== 'all' && c.category !== cat) return false;
      if (ql) {
        const inName = c.name.toLowerCase().includes(ql);
        const inCat = (c.category || '').toLowerCase().includes(ql);
        const inTag = c.tags?.some((t) => t.toLowerCase().includes(ql)) ?? false;
        if (!inName && !inCat && !inTag) return false;
      }
      return true;
    });
  }

  function displayName(file: string): string {
    return file
      .replace('.fs', '')
      .replace(/^DM-/, '')
      .replace(/^SM-/, '')
      .replace(/^AR-/, '')
      .replace(/^cube shaders\//, '');
  }

  function thumbnailUrl(file: string): string {
    const thumbName = file.replace(/\//g, '_').replace('.fs', '.jpg');
    return `./ISF/thumbnails/${thumbName}`;
  }

  function localizedCategory(category: string | undefined): string {
    if (!category) return '';
    const key = categoryTranslationKeys[category];
    return key ? $t(`shaderAi.library.categories.${key}`) : category;
  }

  function toggleSelect(card: ShaderCard) {
    if (currentShaderIds.has(card.trayId)) return; // already in tray
    if (selected.has(card.trayId)) {
      selected.delete(card.trayId);
    } else {
      selected.add(card.trayId);
    }
    selected = selected;
  }

  function addSelected() {
    const selectedCards = allCards.filter((c) => selected.has(c.trayId));
    if (selectedCards.length === 0) return;

    // Manifest shaders go through the original add flow (file fetch + parse).
    const manifestEntries = selectedCards.filter((c) => c.source === 'manifest' && c.manifest).map((c) => c.manifest!);

    // Library shaders (cloud / AI / user-imported) get added directly from
    // their persisted SavedShader records in the shaderLibrary store.
    const libraryById = new Map($shaderLibrary.shaders.map((s) => [s.id, s]));
    const savedShaders = selectedCards
      .filter((c) => c.source !== 'manifest' && c.libraryShaderId)
      .map((c) => libraryById.get(c.libraryShaderId!))
      .filter((s): s is SavedShader => !!s);

    if (manifestEntries.length > 0) dispatch('addShaders', manifestEntries);
    if (savedShaders.length > 0) dispatch('addSavedShaders', savedShaders);
    selected = new Set();
  }

  async function findLatest() {
    if (isSyncing) return;
    isSyncing = true;
    syncMessage = '';
    try {
      const result = await shaderLibrary.syncFromCloud();
      const parts: string[] = [];
      if (result.added > 0) {
        parts.push($t('shaderAi.library.sync.newCount', { values: { count: result.added } }));
      }
      if (result.updated > 0) {
        parts.push($t('shaderAi.library.sync.updatedCount', { values: { count: result.updated } }));
      }
      syncMessage = parts.length
        ? $t('shaderAi.library.sync.synced', { values: { details: parts.join(', ') } })
        : $t('shaderAi.library.sync.upToDate', { values: { total: result.total } });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      syncMessage =
        msg === 'offline'
          ? $t('shaderAi.library.sync.offline')
          : $t('shaderAi.library.sync.failed', { values: { message: msg } });
    } finally {
      isSyncing = false;
      // Auto-clear message after a few seconds
      setTimeout(() => {
        if (!isSyncing) syncMessage = '';
      }, 5000);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  async function loadManifest() {
    try {
      const response = await fetch('./ISF/manifest.json');
      const manifest = await response.json();
      manifestShaders = manifest.version === 2 ? manifest.shaders : manifest.shaders.map((f: string) => ({ file: f }));
      manifestLoading = false;
    } catch (err) {
      console.error('Failed to load shader manifest:', err);
      manifestLoading = false;
    }
  }

  $: if (isOpen && manifestShaders.length === 0) {
    loadManifest();
  }

  // When the modal opens, lazily generate thumbnails for any library shaders
  // (cloud / user-imported / AI) that don't have one yet. Saves the result
  // back to the shaderLibrary store so it's also visible in the tray and
  // persists across sessions.
  let thumbnailGenInFlight = false;
  async function generateMissingLibraryThumbnails() {
    if (thumbnailGenInFlight) return;
    const missing = $shaderLibrary.shaders.filter((s) => s.type === 'shader-isf' && !s.thumbnail);
    if (missing.length === 0) return;
    thumbnailGenInFlight = true;
    try {
      const { generateCachedThumbnail } = await import('../isf/thumbnail');
      // Sequential to avoid GPU thrash and to throttle startup work.
      for (const s of missing) {
        try {
          const dataUrl = await generateCachedThumbnail(s.code, 0.5);
          shaderLibrary.setThumbnail(s.id, dataUrl);
        } catch (e) {
          console.warn(`[ShaderLibrary] thumbnail failed for ${s.name}:`, e);
        }
      }
    } finally {
      thumbnailGenInFlight = false;
    }
  }

  $: if (isOpen) {
    // Fire-and-forget — runs in background, modal updates reactively as
    // each setThumbnail call hits the store and `librarySaved` re-derives.
    generateMissingLibraryThumbnails();
  }

  function badgeForSource(src: ShaderCard['source']): string | null {
    if (src === 'cloud') return $t('shaderAi.library.badges.cloud');
    if (src === 'ai') return $t('shaderAi.library.badges.ai');
    if (src === 'user') return $t('shaderAi.library.badges.user');
    return null;
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if isOpen}
  <div class="shader-library-backdrop" on:click={onClose}>
    <div class="shader-library-modal" on:click|stopPropagation>
      <!-- Header -->
      <div class="sl-header">
        <div class="sl-header-left">
          <h2>{$t('shaderAi.library.title')}</h2>
          <span class="sl-count">{$t('shaderAi.library.count', { values: { count: allCards.length } })}</span>
        </div>
        <div class="sl-header-right">
          <button
            class="sl-find-latest"
            on:click={findLatest}
            disabled={isSyncing}
            title={$t('shaderAi.library.findLatestTitle')}
            aria-label={$t('shaderAi.library.findLatestTitle')}
          >
            {#if isSyncing}
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                class="spin"
              >
                <path d="M21 12a9 9 0 1 1-6.219-8.56" />
              </svg>
              {$t('shaderAi.library.syncing')}
            {:else}
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              {$t('shaderAi.library.findLatest')}
            {/if}
          </button>
          <button
            class="sl-close"
            on:click={onClose}
            aria-label={$t('shaderAi.library.close')}
            title={$t('shaderAi.library.close')}>×</button
          >
        </div>
      </div>

      {#if syncMessage}
        <div class="sl-sync-banner">{syncMessage}</div>
      {/if}

      <!-- Search + Filters -->
      <div class="sl-toolbar">
        <input
          type="text"
          class="sl-search"
          placeholder={$t('shaderAi.library.searchPlaceholder')}
          aria-label={$t('shaderAi.library.searchPlaceholder')}
          bind:value={searchQuery}
        />
        <div class="sl-filter-row">
          <div class="sl-source-filter">
            <button
              class="sl-cat-btn sl-source-btn"
              class:active={sourceFilter === 'all'}
              on:click={() => (sourceFilter = 'all')}>{$t('shaderAi.library.sourceAll')}</button
            >
            <button
              class="sl-cat-btn sl-source-btn"
              class:active={sourceFilter === 'manifest'}
              on:click={() => (sourceFilter = 'manifest')}>{$t('shaderAi.library.sourceBundled')}</button
            >
            <button
              class="sl-cat-btn sl-source-btn"
              class:active={sourceFilter === 'library'}
              on:click={() => (sourceFilter = 'library')}>{$t('shaderAi.library.sourceLibrary')}</button
            >
          </div>
          <div class="sl-categories">
            <button class="sl-cat-btn" class:active={filterCategory === 'all'} on:click={() => (filterCategory = 'all')}
              >{$t('shaderAi.library.allCategories')}</button
            >
            {#each categories as cat}
              <button class="sl-cat-btn" class:active={filterCategory === cat} on:click={() => (filterCategory = cat)}
                >{localizedCategory(cat)}</button
              >
            {/each}
          </div>
        </div>
      </div>

      <!-- Grid -->
      <div class="sl-grid-container">
        {#if manifestLoading && allCards.length === 0}
          <div class="sl-loading">{$t('shaderAi.library.loading')}</div>
        {:else}
          <div class="sl-grid">
            {#each filteredCards as card (card.trayId)}
              {@const inTray = currentShaderIds.has(card.trayId)}
              {@const isSelected = selected.has(card.trayId)}
              {@const badge = badgeForSource(card.source)}
              {@const clickable = card.source === 'manifest'}
              <div
                class="sl-card"
                class:in-tray={inTray}
                class:selected={isSelected}
                class:not-clickable={!clickable}
                on:click={() => toggleSelect(card)}
              >
                <div class="sl-card-thumb">
                  {#if card.thumbnail}
                    <img
                      src={card.thumbnail}
                      alt={card.name}
                      loading="lazy"
                      on:error={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  {/if}
                  {#if badge}
                    <div class="sl-source-badge sl-badge-{card.source}">{badge}</div>
                  {/if}
                  {#if inTray}
                    <div class="sl-in-tray-badge">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                  {:else if isSelected}
                    <div class="sl-selected-badge">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="3"
                      >
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    </div>
                  {/if}
                </div>
                <div class="sl-card-info">
                  <span class="sl-card-name">{card.name}</span>
                  {#if card.category}
                    <span class="sl-card-cat">{localizedCategory(card.category)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
          <div class="sl-grid-end">{$t('shaderAi.library.end', { values: { count: filteredCards.length } })}</div>
        {/if}
      </div>

      <!-- Footer -->
      <div class="sl-footer">
        <span class="sl-footer-info">
          {$t('shaderAi.library.footer', {
            values: {
              shown: filteredCards.length,
              selected: selectedCount,
              inTray: filteredCards.filter((c) => currentShaderIds.has(c.trayId)).length,
            },
          })}
        </span>
        <div class="sl-footer-actions">
          <button class="sl-cancel" on:click={onClose}>{$t('shaderAi.library.cancel')}</button>
          <button class="sl-add-btn" disabled={selectedCount === 0} on:click={addSelected}>
            {$t(
              selectedCount === 0
                ? 'shaderAi.library.addSelected'
                : selectedCount === 1
                  ? 'shaderAi.library.addOne'
                  : 'shaderAi.library.addMany',
              { values: { count: selectedCount } },
            )}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .shader-library-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.75);
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    backdrop-filter: blur(4px);
  }

  .shader-library-modal {
    background: #141418;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 8px;
    width: 90vw;
    max-width: 1100px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }

  .sl-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  .sl-header-left { display: flex; align-items: center; gap: 12px; }
  .sl-header-right { display: flex; align-items: center; gap: 8px; }
  .sl-header h2 { font-size: 17px; font-weight: 600; margin: 0; color: #fff; }
  .sl-count { font-size: 13px; color: #666; }

  .sl-find-latest {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(126,200,227,0.1);
    border: 1px solid rgba(126,200,227,0.25);
    border-radius: 4px;
    color: #7ec8e3;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.04em;
    cursor: pointer;
    transition: all 0.15s;
  }
  .sl-find-latest:hover:not(:disabled) {
    background: rgba(126,200,227,0.18);
    border-color: rgba(126,200,227,0.5);
  }
  .sl-find-latest:disabled { opacity: 0.6; cursor: not-allowed; }
  .spin { animation: sl-spin 1s linear infinite; }
  @keyframes sl-spin { to { transform: rotate(360deg); } }

  .sl-close {
    width: 28px; height: 28px; border-radius: 50%;
    background: rgba(255,255,255,0.06); border: none;
    color: var(--text-muted, #888); font-size: 19px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .sl-close:hover { background: rgba(255,50,50,0.3); color: #fff; }

  .sl-sync-banner {
    padding: 8px 20px;
    background: rgba(126,200,227,0.08);
    border-bottom: 1px solid rgba(126,200,227,0.15);
    color: #7ec8e3;
    font-size: 13px;
  }

  .sl-toolbar {
    padding: 12px 20px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    flex-shrink: 0;
  }
  .sl-search {
    width: 100%;
    padding: 8px 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 4px;
    color: #fff;
    font-size: 14px;
    outline: none;
    margin-bottom: 10px;
  }
  .sl-search:focus { border-color: rgba(255,133,119,0.4); }
  .sl-search::placeholder { color: #555; }

  .sl-filter-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .sl-source-filter {
    display: flex;
    gap: 4px;
  }
  .sl-source-btn {
    background: rgba(126,200,227,0.04);
    border-color: rgba(126,200,227,0.12);
    color: #7ec8e3;
    font-weight: 600;
  }
  .sl-source-btn.active {
    background: rgba(126,200,227,0.18);
    border-color: rgba(126,200,227,0.4);
    color: #b3dff0;
  }

  .sl-categories {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
  }
  .sl-cat-btn {
    padding: 4px 10px;
    font-size: 12px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    color: var(--text-muted, #888);
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .sl-cat-btn:hover { border-color: rgba(255,255,255,0.2); color: var(--text-primary, #ccc); }
  .sl-cat-btn.active { background: rgba(255,133,119,0.15); border-color: rgba(255,133,119,0.3); color: #ff8577; }

  .sl-grid-container {
    flex: 1;
    overflow-y: auto;
    padding: 16px 20px;
  }
  .sl-loading {
    text-align: center;
    color: #666;
    padding: 40px;
    font-size: 14px;
  }
  .sl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 10px;
  }
  .sl-grid-end {
    text-align: center; padding: 20px; color: #555; font-size: 12px;
    grid-column: 1 / -1;
  }

  .sl-card {
    background: var(--bg-tertiary, #1a1a1e);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    overflow: hidden;
  }
  .sl-card:hover { border-color: rgba(255,255,255,0.15); }
  .sl-card.selected { border-color: #ff8577; background: #1e1418; }
  .sl-card.in-tray { opacity: 0.5; cursor: default; }
  .sl-card.not-clickable { cursor: default; }
  .sl-card.not-clickable:not(.in-tray):hover { border-color: rgba(255,255,255,0.06); }

  .sl-card-thumb {
    width: 100%;
    aspect-ratio: 16/9;
    background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
    overflow: hidden;
    position: relative;
  }
  .sl-card-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .sl-source-badge {
    position: absolute;
    top: 6px;
    left: 6px;
    padding: 2px 6px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    border-radius: 3px;
    color: #fff;
    background: rgba(0,0,0,0.6);
  }
  .sl-badge-cloud { background: rgba(168,85,247,0.85); }
  .sl-badge-ai { background: rgba(255,133,119,0.85); }
  .sl-badge-user { background: rgba(46,213,115,0.85); }

  .sl-in-tray-badge, .sl-selected-badge {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 28px; height: 28px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
  }
  .sl-in-tray-badge {
    background: rgba(46,213,115,0.8);
    color: #fff;
  }
  .sl-selected-badge {
    background: rgba(255,133,119,0.9);
    color: #fff;
  }

  .sl-card-info { padding: 6px 8px; }
  .sl-card-name { font-size: 11px; font-weight: 500; color: var(--text-primary, #ccc); display: block; line-height: 1.3; word-break: break-word; }
  .sl-card-cat { font-size: 10px; color: #555; display: block; margin-top: 2px; }

  .sl-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-top: 1px solid rgba(255,255,255,0.08);
    flex-shrink: 0;
  }
  .sl-footer-info { font-size: 13px; color: #666; }
  .sl-footer-actions { display: flex; gap: 8px; }
  .sl-cancel {
    padding: 8px 16px;
    background: transparent;
    border: 1px solid rgba(255,255,255,0.15);
    border-radius: 4px;
    color: var(--text-muted, #888);
    font-size: 13px;
    cursor: pointer;
  }
  .sl-cancel:hover { border-color: rgba(255,255,255,0.3); color: var(--text-primary, #ccc); }
  .sl-add-btn {
    padding: 8px 20px;
    background: #ff8577;
    border: none;
    border-radius: 4px;
    color: #0a0a0a;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.15s;
  }
  .sl-add-btn:hover { background: #ff6b5a; }
  .sl-add-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
