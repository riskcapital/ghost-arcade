<script lang="ts">
  import type { EffectType } from '../types';
  import { EFFECT_CATALOG, getEffectCategories, type EffectCatalogEntry } from '../effects/effectCatalog';
  import {
    customCatalogEntries,
    importDMFXFromFile,
    downloadTemplate,
    removeCustomEffect,
  } from '../effects/customEffects';
  // licenseTier + canAccessEffect + getTierBadgeLabel imports removed —
  // every effect is unlocked in OSS build.
  import { webgpuSupportedStore } from '../renderer/webgpuCapability';
  import { get } from 'svelte/store';

  // WebGPU capability — reactive store, NOT a snapshot. The probe is
  // async and may not have resolved by the time this modal first
  // mounts; subscribing to the store means GPU-only effects appear
  // the instant the probe lands without needing to remount the modal.

  interface Props {
    open: boolean;
    onAdd: (types: EffectType[]) => void;
    onClose: () => void;
  }

  let { open = $bindable(false), onAdd, onClose }: Props = $props();

  let searchQuery = $state('');
  let selected = $state<Set<EffectType>>(new Set());
  let importStatus = $state<{ kind: 'idle' | 'ok' | 'err'; message: string }>({
    kind: 'idle',
    message: '',
  });

  // ── Accordion state ─────────────────────────────────────────────────
  // Persisted across sessions. Power users can collapse categories they
  // never use (e.g. Advanced 3D) so the picker doesn't scroll forever.
  // Storage key versioned ('v2') in case we want to invalidate later.
  const STORAGE_KEY = 'ga-effectpicker-collapsed-v2';
  const DEFAULT_COLLAPSED: string[] = [
    // Sensible default: collapse the deep-dive 3D / depth / feedback
    // sections so first-time users see the meat-and-potatoes picker
    // (Color, Stylize, Blur, Light) above the fold. Easy to expand
    // with one click — and the choice is remembered after the first
    // time you toggle it.
    'Advanced 3D',
    'Advanced Depth',
    'Advanced Feedback',
    'Advanced Trails',
    'Advanced Text & Pattern',
  ];
  function loadCollapsed(): Set<string> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {}
    return new Set(DEFAULT_COLLAPSED);
  }
  function saveCollapsed(s: Set<string>) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...s]));
    } catch {}
  }
  let collapsed = $state<Set<string>>(loadCollapsed());

  function toggleCategory(cat: string) {
    const next = new Set(collapsed);
    if (next.has(cat)) next.delete(cat);
    else next.add(cat);
    collapsed = next;
    saveCollapsed(next);
  }

  function expandAll() {
    collapsed = new Set();
    saveCollapsed(collapsed);
  }
  function collapseAll() {
    const all = new Set(allCategories);
    collapsed = all;
    saveCollapsed(all);
  }

  // Custom effects reactive snapshot so the picker list refreshes on import/remove.
  let customEntries = $state<EffectCatalogEntry[]>([]);
  $effect(() => customCatalogEntries.subscribe(($v) => { customEntries = $v; }));

  // Combine built-in + custom, with custom effects grouped under "Custom" category.
  // Entries that require WebGPU are filtered out on devices without WebGPU
  // support so they never appear in the picker (per "Hide entirely" UX choice
  // — no point teasing an effect that can't run). Subscribes to
  // $webgpuSupportedStore so the list updates as soon as the async probe
  // resolves, instead of being frozen to the value at component-mount time.
  const combinedCatalog = $derived<EffectCatalogEntry[]>([
    ...customEntries.map((c) => ({ ...c, category: 'Custom' })),
    ...EFFECT_CATALOG,
  ].filter((entry) => !entry.requiresWebGPU || $webgpuSupportedStore));

  // All categories (Custom first if present, then built-in order).
  // Drop categories that ended up empty after capability filtering — e.g.
  // the "WebGPU" category should disappear entirely on browsers without
  // WebGPU support rather than show an empty section header.
  const allCategories = $derived.by<string[]>(() => {
    const builtins = getEffectCategories();
    const present = new Set(combinedCatalog.map((e) => e.category));
    const filtered = builtins.filter((c) => present.has(c));
    return customEntries.length > 0 ? ['Custom', ...filtered] : filtered;
  });

  const customTypeSet = $derived(new Set(customEntries.map((e) => e.type as unknown as string)));

  function isCustomEntry(entry: EffectCatalogEntry): boolean {
    return customTypeSet.has(entry.type as unknown as string);
  }

  // Filter by search across ALL categories — search overrides the
  // accordion (results from collapsed sections still show up when you
  // type, otherwise the user would think the search was broken).
  const filteredByCategory = $derived.by<Map<string, EffectCatalogEntry[]>>(() => {
    const q = searchQuery.toLowerCase().trim();
    const map = new Map<string, EffectCatalogEntry[]>();
    for (const cat of allCategories) map.set(cat, []);
    for (const entry of combinedCatalog) {
      if (q) {
        const matches =
          entry.label.toLowerCase().includes(q) ||
          entry.description.toLowerCase().includes(q) ||
          entry.type.toLowerCase().includes(q);
        if (!matches) continue;
      }
      const bucket = map.get(entry.category);
      if (bucket) bucket.push(entry);
    }
    return map;
  });

  const totalMatches = $derived.by<number>(() => {
    let n = 0;
    for (const list of filteredByCategory.values()) n += list.length;
    return n;
  });

  // When searching, force-expand all categories that have matches so
  // the user can see them. Doesn't mutate the persisted collapsed set.
  const effectivelyCollapsed = $derived.by<Set<string>>(() => {
    if (!searchQuery.trim()) return collapsed;
    const next = new Set(collapsed);
    for (const [cat, list] of filteredByCategory.entries()) {
      if (list.length > 0) next.delete(cat);
    }
    return next;
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
      // Make sure Custom is expanded so they see it.
      const next = new Set(collapsed);
      next.delete('Custom');
      collapsed = next;
      saveCollapsed(next);
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

  // No tier locks in the OSS build — every effect is selectable.

  function handleCardClick(entry: EffectCatalogEntry) {
    const next = new Set(selected);
    if (next.has(entry.type)) next.delete(entry.type);
    else next.add(entry.type);
    selected = next;
  }

  function handleDoubleClick(entry: EffectCatalogEntry) {
    onAdd([entry.type]);
    selected = new Set();
    searchQuery = '';
    open = false;
  }

  function handleAdd() {
    if (selected.size === 0) return;
    onAdd([...selected]);
    selected = new Set();
    searchQuery = '';
    open = false;
  }

  function handleClose() {
    selected = new Set();
    searchQuery = '';
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

      <!-- Search + accordion controls -->
      <div class="search-bar">
        <input
          type="text"
          placeholder="Search effects..."
          bind:value={searchQuery}
          class="search-input"
        />
        <div class="accordion-controls">
          <button class="ctrl-btn" onclick={expandAll} title="Expand all categories">Expand all</button>
          <button class="ctrl-btn" onclick={collapseAll} title="Collapse all categories">Collapse all</button>
        </div>
      </div>

      <!-- Accordion list -->
      <div class="accordion-list">
        {#each allCategories as cat (cat)}
          {@const entries = filteredByCategory.get(cat) ?? []}
          {@const isCollapsed = effectivelyCollapsed.has(cat)}
          {#if entries.length > 0 || !searchQuery.trim()}
            <section class="cat-section" class:collapsed={isCollapsed}>
              <button
                class="cat-header"
                class:empty={entries.length === 0}
                onclick={() => toggleCategory(cat)}
                aria-expanded={!isCollapsed}
                aria-controls={`cat-grid-${cat}`}
              >
                <span class="cat-chevron" class:rotated={!isCollapsed}>▶</span>
                <span class="cat-label">{cat}</span>
                <span class="cat-count">{entries.length}</span>
              </button>

              {#if !isCollapsed && entries.length > 0}
                <div class="cat-grid" id={`cat-grid-${cat}`}>
                  {#each entries as entry (entry.type)}
                    {@const custom = isCustomEntry(entry)}
                    <button
                      class="effect-row"
                      class:selected={selected.has(entry.type)}
                      class:custom
                      onclick={() => handleCardClick(entry)}
                      ondblclick={() => handleDoubleClick(entry)}
                      title="{entry.description}\nTap to select · Double-click to add instantly"
                    >
                      <div class="row-thumb" style="background: {entry.previewCSS};"></div>
                      <div class="row-info">
                        <span class="row-name">
                          {entry.label}
                          {#if custom}
                            <span class="custom-badge">CUSTOM</span>
                          {/if}
                        </span>
                        <span class="row-desc">{entry.description}</span>
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
                </div>
              {/if}
            </section>
          {/if}
        {/each}

        {#if searchQuery.trim() && totalMatches === 0}
          <div class="no-results">No effects match "{searchQuery}".</div>
        {/if}
      </div>

      <!-- Upgrade toast -->
      <!-- Upgrade toast removed — no tiers in OSS build. -->

      <!-- Footer -->
      <div class="modal-footer">
        <span class="hint">Tap to select · Double-click to add one · Click a category to collapse</span>
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
    max-width: 760px;
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

  /* Search row + expand/collapse controls share one bar so the
     header stays compact. */
  .search-bar {
    padding: 8px 18px;
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .search-input {
    flex: 1;
    background: #161618;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 8px 12px;
    color: #eee;
    font-size: 13px;
    outline: none;
    transition: border-color 0.15s;
  }
  .search-input::placeholder { color: #666; }
  .search-input:focus { border-color: #BB86FC; }

  .accordion-controls {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }
  .ctrl-btn {
    background: #161618;
    border: 1px solid #333;
    border-radius: 6px;
    padding: 6px 10px;
    color: #999;
    font-size: 11px;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .ctrl-btn:hover {
    background: #1f1f23;
    color: #eee;
    border-color: #555;
  }

  /* ── Accordion sections ────────────────────────────────────────── */
  .accordion-list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding: 4px 12px 12px;
  }

  .accordion-list::-webkit-scrollbar {
    width: 5px;
  }

  .accordion-list::-webkit-scrollbar-thumb {
    background: #444;
    border-radius: 3px;
  }

  .cat-section {
    border-bottom: 1px solid #1d1d22;
    padding-bottom: 4px;
  }
  .cat-section:last-child { border-bottom: none; }

  /* Category header = sticky-ish accent bar that toggles its grid. */
  .cat-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    background: #131318;
    border: none;
    border-radius: 6px;
    padding: 8px 12px;
    color: #BB86FC;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: background 0.12s;
    margin: 8px 0 6px;
    text-align: left;
  }
  .cat-header:hover {
    background: #1a1a20;
  }
  .cat-header.empty {
    color: #555;
    background: transparent;
    cursor: default;
  }

  /* Tiny chevron rotates 90° when section is open. */
  .cat-chevron {
    display: inline-block;
    font-size: 9px;
    color: #888;
    width: 10px;
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }
  .cat-chevron.rotated {
    transform: rotate(90deg);
  }

  .cat-label {
    flex: 1;
  }

  .cat-count {
    color: #555;
    font-weight: 500;
    font-size: 10px;
    background: rgba(187, 134, 252, 0.08);
    border: 1px solid rgba(187, 134, 252, 0.18);
    border-radius: 999px;
    padding: 1px 8px;
    min-width: 22px;
    text-align: center;
  }

  /* Effects grid inside each open section. Two columns at this width
     so each tile has room for a description line — keeps the picker
     scannable. */
  .cat-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    padding: 0 4px 4px;
  }

  .effect-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 5px 7px 5px 5px;
    cursor: pointer;
    transition: all 0.12s;
    text-align: left;
    width: 100%;
    min-width: 0;
    position: relative;
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
    width: 36px;
    height: 36px;
    min-width: 36px;
    border-radius: 5px;
    flex-shrink: 0;
    position: relative;
  }

  .row-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    overflow: hidden;
    flex: 1;
  }

  .row-name {
    font-size: 12px;
    color: #ddd;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .effect-row.selected .row-name {
    color: #BB86FC;
  }

  .row-desc {
    font-size: 10px;
    color: #666;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-results {
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
    background: #d0a8ff;
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
