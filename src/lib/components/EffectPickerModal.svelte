<script lang="ts">
  import type { EffectType } from '../types';
  import { EFFECT_CATALOG, getEffectCategories, type EffectCatalogEntry } from '../effects/effectCatalog';
  import {
    customEffects,
    customCatalogEntries,
    importDMFXFromFile,
    downloadTemplate,
    removeCustomEffect,
  } from '../effects/customEffects';
  import { licenseTier } from '../stores/license';
  import { canAccessEffect, getTierBadgeLabel } from '../license/featureGates';
  import { get } from 'svelte/store';

  interface Props {
    open: boolean;
    onAdd: (types: EffectType[]) => void;
    onClose: () => void;
  }

  let { open = $bindable(false), onAdd, onClose }: Props = $props();

  let searchQuery = $state('');
  let activeCategory = $state('All');
  let selected = $state<Set<EffectType>>(new Set());
  let importStatus = $state<{ kind: 'idle' | 'ok' | 'err'; message: string }>({
    kind: 'idle',
    message: '',
  });

  // Custom effects reactive snapshot so the picker list refreshes on import/remove.
  // `$effect` wraps the subscription so the assignment to the `$state` variable is
  // tracked by Svelte 5's reactivity graph.
  let customEntries = $state<EffectCatalogEntry[]>([]);
  $effect(() => customCatalogEntries.subscribe(($v) => { customEntries = $v; }));

  // Combine built-in + custom, with custom effects grouped under "Custom" category.
  const combinedCatalog = $derived<EffectCatalogEntry[]>([
    ...customEntries.map((c) => ({ ...c, category: 'Custom' })),
    ...EFFECT_CATALOG,
  ]);

  const categories = $derived.by<string[]>(() => {
    const builtins = getEffectCategories();
    return customEntries.length > 0 ? ['All', 'Custom', ...builtins] : ['All', ...builtins];
  });

  const customTypeSet = $derived(new Set(customEntries.map((e) => e.type as unknown as string)));

  function isCustomEntry(entry: EffectCatalogEntry): boolean {
    return customTypeSet.has(entry.type as unknown as string);
  }

  const filtered = $derived.by(() => {
    let list = combinedCatalog;
    if (activeCategory !== 'All') {
      list = list.filter((e) => e.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (e) =>
          e.label.toLowerCase().includes(q) ||
          e.description.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q)
      );
    }
    return list;
  });

  let fileInput: HTMLInputElement | undefined = $state();

  async function handleImport(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const result = await importDMFXFromFile(file);
    if (result.ok && result.effect) {
      importStatus = {
        kind: 'ok',
        message: `Imported "${result.effect.label}" — it's under the Custom category.`,
      };
      activeCategory = 'Custom';
    } else {
      importStatus = { kind: 'err', message: result.error ?? 'Import failed.' };
    }
    input.value = '';
    setTimeout(() => (importStatus = { kind: 'idle', message: '' }), 5000);
  }

  function handleDeleteCustom(type: string, ev: MouseEvent) {
    ev.stopPropagation();
    if (!confirm('Delete this imported effect? Layers already using it will fall back to a passthrough.')) {
      return;
    }
    removeCustomEffect(type);
    selected.delete(type as unknown as EffectType);
    selected = new Set(selected);
  }

  let showUpgradeToast = $state('');

  function isLocked(entry: EffectCatalogEntry): boolean {
    return !canAccessEffect(get(licenseTier), entry.category);
  }

  function handleCardClick(entry: EffectCatalogEntry, e: MouseEvent) {
    if (isLocked(entry)) {
      showUpgradeToast = `"${entry.label}" requires ${getTierBadgeLabel(entry.tier)} tier`;
      setTimeout(() => { showUpgradeToast = ''; }, 3000);
      return;
    }
    // Always toggle selection (touch-friendly multi-select)
    const next = new Set(selected);
    if (next.has(entry.type)) {
      next.delete(entry.type);
    } else {
      next.add(entry.type);
    }
    selected = next;
  }

  function handleDoubleClick(entry: EffectCatalogEntry) {
    if (isLocked(entry)) return;
    // Double-click instantly adds the single effect
    onAdd([entry.type]);
    selected = new Set();
    searchQuery = '';
    activeCategory = 'All';
    open = false;
  }

  function handleAdd() {
    if (selected.size === 0) return;
    onAdd([...selected]);
    selected = new Set();
    searchQuery = '';
    activeCategory = 'All';
    open = false;
  }

  function handleClose() {
    selected = new Set();
    searchQuery = '';
    activeCategory = 'All';
    onClose();
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) handleClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <div
    class="modal-overlay"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-label="Effect Picker"
  >
    <div class="modal-panel">
      <!-- Header -->
      <div class="modal-header">
        <h2>Add Effects</h2>
        <div class="header-right">
          <input
            type="file"
            bind:this={fileInput}
            accept=".dmfx,.dmfx.json,.json,application/json"
            style="display: none"
            onchange={handleImport}
          />
          <button
            class="import-btn"
            onclick={() => fileInput?.click()}
            title="Import a .dmfx.json custom effect"
          >
            + Import Custom
          </button>
          <button
            class="template-btn"
            onclick={downloadTemplate}
            title="Download a .dmfx.json template to edit"
          >
            Template
          </button>
          {#if selected.size > 0}
            <span class="selection-count">{selected.size} selected</span>
          {/if}
          <button class="close-btn" onclick={handleClose} aria-label="Close">&times;</button>
        </div>
      </div>

      {#if importStatus.kind !== 'idle'}
        <div class="import-banner {importStatus.kind}">{importStatus.message}</div>
      {/if}

      <!-- Search -->
      <div class="search-bar">
        <input
          type="text"
          placeholder="Search effects..."
          bind:value={searchQuery}
          class="search-input"
        />
      </div>

      <!-- Category tabs -->
      <div class="category-tabs">
        {#each categories as cat}
          <button
            class="cat-pill"
            class:active={activeCategory === cat}
            onclick={() => (activeCategory = cat)}
          >
            {cat}
          </button>
        {/each}
      </div>

      <!-- List -->
      <div class="effect-list">
        {#each filtered as entry (entry.type)}
          {@const locked = isLocked(entry)}
          {@const custom = isCustomEntry(entry)}
          <button
            class="effect-row"
            class:selected={selected.has(entry.type)}
            class:locked
            class:custom
            onclick={(e) => handleCardClick(entry, e)}
            ondblclick={() => handleDoubleClick(entry)}
            title="{entry.description}{locked ? `\n🔒 Requires ${getTierBadgeLabel(entry.tier)} tier` : '\nTap to select · Double-click to add instantly'}"
          >
            <div class="row-thumb" style="background: {entry.previewCSS};">
              {#if locked}
                <div class="lock-overlay">🔒</div>
              {/if}
            </div>
            <div class="row-info">
              <span class="row-name">
                {entry.label}
                {#if custom}
                  <span class="custom-badge">CUSTOM</span>
                {/if}
                {#if locked}
                  <span class="tier-badge">{getTierBadgeLabel(entry.tier)}</span>
                {/if}
              </span>
              <span class="row-cat">{entry.category}</span>
            </div>
            {#if custom}
              <button
                class="delete-btn"
                onclick={(e) => handleDeleteCustom(entry.type as unknown as string, e)}
                title="Delete this custom effect"
                aria-label="Delete custom effect"
              >×</button>
            {/if}
          </button>
        {/each}
        {#if filtered.length === 0}
          <div class="no-results">No effects match your search.</div>
        {/if}
      </div>

      <!-- Upgrade toast -->
      {#if showUpgradeToast}
        <div class="upgrade-toast">{showUpgradeToast}</div>
      {/if}

      <!-- Footer -->
      <div class="modal-footer">
        <span class="hint">Tap to select · Double-click to add one</span>
        <div class="footer-actions">
          <button class="secondary-btn" onclick={handleClose}>Cancel</button>
          <button
            class="primary-btn"
            onclick={handleAdd}
            disabled={selected.size === 0}
          >
            Add{selected.size > 0 ? ` (${selected.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1100;
    backdrop-filter: blur(4px);
  }

  .modal-panel {
    background: #0d0d10;
    border: 1px solid #333;
    border-radius: 12px;
    width: 94%;
    max-width: 700px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px 10px;
    border-bottom: 1px solid #222;
  }

  .modal-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: #eee;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .selection-count {
    font-size: 12px;
    color: #BB86FC;
    font-weight: 500;
  }

  .close-btn {
    background: none;
    border: none;
    color: #888;
    font-size: 22px;
    cursor: pointer;
    padding: 2px 6px;
    border-radius: 4px;
    line-height: 1;
    transition: all 0.15s;
  }

  .close-btn:hover {
    background: #333;
    color: #eee;
  }

  .search-bar {
    padding: 8px 18px;
  }

  .search-input {
    width: 100%;
    background: #161618;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px 12px;
    color: #eee;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
  }

  .search-input::placeholder {
    color: #666;
  }

  .search-input:focus {
    border-color: #BB86FC;
  }

  .category-tabs {
    display: flex;
    gap: 6px;
    padding: 4px 18px 10px;
    overflow-x: auto;
    flex-shrink: 0;
  }

  .category-tabs::-webkit-scrollbar {
    height: 3px;
  }

  .category-tabs::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 2px;
  }

  .cat-pill {
    background: #1a1a1e;
    border: 1px solid #333;
    border-radius: 14px;
    padding: 4px 12px;
    color: #999;
    font-size: 11px;
    cursor: pointer;
    white-space: nowrap;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .cat-pill:hover {
    background: #252528;
    color: #ccc;
  }

  .cat-pill.active {
    background: #BB86FC22;
    border-color: #BB86FC;
    color: #BB86FC;
  }

  /* ── 3-column grid layout ── */
  .effect-list {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px;
    padding: 4px 12px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
  }

  .effect-list::-webkit-scrollbar {
    width: 5px;
  }

  .effect-list::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 3px;
  }

  .effect-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 4px 6px 4px 4px;
    cursor: pointer;
    transition: all 0.12s;
    text-align: left;
    width: 100%;
    min-width: 0;
  }

  .effect-row:hover {
    background: #1c1c22;
    border-color: #333;
  }

  .effect-row.selected {
    background: #BB86FC11;
    border-color: #BB86FC;
  }

  .row-thumb {
    width: 32px;
    height: 32px;
    min-width: 32px;
    border-radius: 5px;
    flex-shrink: 0;
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    overflow: hidden;
  }

  .row-name {
    font-size: 11px;
    color: #ddd;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .effect-row.selected .row-name {
    color: #BB86FC;
  }

  .row-cat {
    font-size: 9px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-results {
    grid-column: 1 / -1;
    text-align: center;
    padding: 40px 0;
    color: #666;
    font-size: 13px;
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 18px;
    border-top: 1px solid #222;
  }

  .hint {
    font-size: 10px;
    color: #555;
  }

  .footer-actions {
    display: flex;
    gap: 8px;
  }

  .secondary-btn {
    background: #333;
    border: 1px solid #444;
    border-radius: 6px;
    padding: 7px 14px;
    color: #eee;
    font-size: 12px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .secondary-btn:hover {
    background: #3a3a3a;
    border-color: #555;
  }

  .primary-btn {
    background: #BB86FC;
    border: none;
    border-radius: 6px;
    padding: 7px 16px;
    color: #000;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .primary-btn:hover:not(:disabled) {
    background: #5dd3e3;
  }

  .primary-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  /* ── Tier lockout styles ── */
  .effect-row.locked {
    opacity: 0.45;
    cursor: default;
  }

  .effect-row.locked:hover {
    background: rgba(255, 255, 255, 0.03);
    border-color: rgba(255, 255, 255, 0.08);
  }

  .lock-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    border-radius: 5px;
    font-size: 14px;
  }

  .row-thumb {
    position: relative;
  }

  .tier-badge {
    display: inline-block;
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.06em;
    padding: 1px 4px;
    border-radius: 3px;
    background: #f59e0b;
    color: #000;
    margin-left: 4px;
    vertical-align: middle;
  }

  .upgrade-toast {
    background: rgba(245, 158, 11, 0.15);
    border: 1px solid rgba(245, 158, 11, 0.3);
    border-radius: 6px;
    padding: 8px 14px;
    margin: 0 18px;
    font-size: 12px;
    color: #f59e0b;
    text-align: center;
    animation: fadeIn 0.2s ease-out;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Custom-effect import UI ── */
  .import-btn,
  .template-btn {
    background: #1a1a1e;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 5px 10px;
    color: #ccc;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }

  .import-btn:hover,
  .template-btn:hover {
    background: #252528;
    color: #fff;
    border-color: #BB86FC;
  }

  .import-btn {
    color: #BB86FC;
    border-color: #BB86FC55;
  }

  .import-banner {
    margin: 8px 18px 0;
    padding: 8px 12px;
    border-radius: 6px;
    font-size: 12px;
    animation: fadeIn 0.2s ease-out;
  }

  .import-banner.ok {
    background: rgba(34, 197, 94, 0.12);
    border: 1px solid rgba(34, 197, 94, 0.35);
    color: #4ade80;
  }

  .import-banner.err {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.35);
    color: #f87171;
  }

  .custom-badge {
    display: inline-block;
    font-size: 7px;
    font-weight: 700;
    letter-spacing: 0.08em;
    padding: 1px 4px;
    border-radius: 3px;
    background: #BB86FC;
    color: #000;
    margin-left: 4px;
    vertical-align: middle;
  }

  .effect-row.custom {
    position: relative;
  }

  .effect-row.custom .row-thumb {
    border: 1px solid #BB86FC55;
  }

  .delete-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    background: #2a1a2a;
    border: 1px solid #BB86FC33;
    color: #BB86FC;
    width: 18px;
    height: 18px;
    border-radius: 3px;
    font-size: 14px;
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: all 0.15s;
    opacity: 0;
  }

  .effect-row.custom:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: #BB86FC;
    color: #000;
    border-color: #BB86FC;
  }
</style>
