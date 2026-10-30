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
  import { isNativeSelectableEffect } from '../renderer/nativeEffectCoverage';
  import { webgpuSupportedStore } from '../renderer/webgpuCapability';
  import { NATIVE_ENGINE_ONLY, settings } from '../stores/settings';

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
  ].filter((entry) => (!entry.requiresWebGPU || $webgpuSupportedStore) && (!entry.requiresNative || (NATIVE_ENGINE_ONLY && Boolean($settings.experimental?.outputNativeCore)))));

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
  const nativeInventoryLocked = $derived(NATIVE_ENGINE_ONLY && Boolean($settings.experimental?.outputNativeCore));

  function isCustomEntry(entry: EffectCatalogEntry): boolean {
    return customTypeSet.has(entry.type as unknown as string);
  }

  function isNativeAvailable(entry: EffectCatalogEntry): boolean {
    return !nativeInventoryLocked || isNativeSelectableEffect(entry.type);
  }

  function nativeUnavailableLabel(entry: EffectCatalogEntry): string {
    return isNativeSelectableEffect(entry.type)
      ? entry.description
      : `${entry.description}\n\nNative v2: this effect is pending a core implementation.`;
  }

  $effect(() => {
    if (!nativeInventoryLocked || selected.size === 0) return;
    const next = new Set([...selected].filter((type) => isNativeSelectableEffect(type)));
    if (next.size !== selected.size) selected = next;
  });

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
    if (!isNativeAvailable(entry)) return;
    const next = new Set(selected);
    if (next.has(entry.type)) next.delete(entry.type);
    else next.add(entry.type);
    selected = next;
  }

  function handleDoubleClick(entry: EffectCatalogEntry) {
    if (!isNativeAvailable(entry)) return;
    onAdd([entry.type]);
    selected = new Set();
    searchQuery = '';
    open = false;
  }

  function handleAdd() {
    if (selected.size === 0) return;
    const selectable = nativeInventoryLocked
      ? [...selected].filter((type) => isNativeSelectableEffect(type))
      : [...selected];
    if (selectable.length === 0) return;
    onAdd(selectable);
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
  <div data-help-page="effects"
    class="modal-overlay"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
    role="dialog"
    aria-modal="true"
    aria-label="Effect picker"
    tabindex="0"
  >
    <div class="modal-panel">
      <!-- Header -->
      <div class="modal-header">
        <h2>Add effects</h2>
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
            + Import custom
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
                    {@const nativeUnavailable = !isNativeAvailable(entry)}
                    <button
                      class="effect-row"
                      class:selected={selected.has(entry.type)}
                      class:custom
                      class:native-unavailable={nativeUnavailable}
                      onclick={() => handleCardClick(entry)}
                      ondblclick={() => handleDoubleClick(entry)}
                      disabled={nativeUnavailable}
                      aria-disabled={nativeUnavailable}
                      title="{nativeUnavailableLabel(entry)}\n{nativeUnavailable ? '' : 'Tap to select · Double-click to add instantly'}"
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
        <span class="hint">
          {nativeInventoryLocked
            ? 'Native v2 inventory: pending effects are disabled until the core owns them.'
            : 'Tap to select · Double-click to add one · Click a category to collapse'}
        </span>
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
    background: var(--ga-panel, #0d0d10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 7px);
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
    gap: 12px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }

  .modal-header h2 {
    margin: 0;
    font-size: var(--ga-text-heading);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0, #eef0f4);
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .selection-count {
    font-size: var(--ga-text-control);
    color: var(--ga-ink-1, #9aa0ac);
    font-weight: 500;
    margin: 0 4px;
  }

  .close-btn {
    /* 32×32 keeps a comfortable tap target. */
    background: none;
    border: none;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-display);
    cursor: pointer;
    width: 32px;
    height: 32px;
    padding: 0;
    border-radius: var(--ga-r-hard, 3px);
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s, color 0.15s;
  }

  .close-btn:hover {
    background: var(--ga-raise, #26221c);
    color: var(--ga-ink-0, #eef0f4);
  }

  /* Search row + expand/collapse controls share one bar so the
     header stays compact. */
  .search-bar {
    padding: 8px 16px;
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .search-input {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, #050607);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 10px;
    color: var(--ga-ink-0, #eef0f4);
    font-size: var(--ga-text-body);
    outline: none;
    transition: border-color 0.15s;
  }
  .search-input::placeholder { color: var(--ga-ink-3, #3a404a); }
  .search-input:focus { border-color: var(--ga-focus, #8aa4ff); }

  .accordion-controls {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  /* Secondary buttons: one look across the picker. */
  .ctrl-btn,
  .import-btn,
  .template-btn,
  .secondary-btn {
    height: var(--ga-control-h, 26px);
    background: var(--ga-card, #13161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 10px;
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .ctrl-btn:hover,
  .import-btn:hover,
  .template-btn:hover,
  .secondary-btn:hover {
    color: var(--ga-ink-0, #eef0f4);
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }

  /* ── Accordion sections ────────────────────────────────────────── */
  .accordion-list {
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    padding: 0 12px 12px;
  }

  .accordion-list::-webkit-scrollbar {
    width: 5px;
  }

  .accordion-list::-webkit-scrollbar-thumb {
    background: var(--ga-line-3, #444);
    border-radius: 3px;
  }

  .cat-section {
    border-bottom: 1px solid var(--ga-line-1, rgba(255, 255, 255, 0.07));
    padding-bottom: 4px;
  }
  .cat-section:last-child { border-bottom: none; }

  /* Category header: an eyebrow section label that folds its grid. */
  .cat-header {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: var(--ga-control-h, 26px);
    background: transparent;
    border: none;
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 8px;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-eyebrow);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
    margin: 6px 0 4px;
    text-align: left;
  }
  .cat-header:hover {
    background: var(--ga-card, #13161c);
    color: var(--ga-ink-1, #9aa0ac);
  }
  .cat-header.empty {
    color: var(--ga-ink-3, #3a404a);
    background: transparent;
    cursor: default;
  }

  /* Tiny chevron rotates 90° when section is open. */
  .cat-chevron {
    display: inline-block;
    font-size: var(--ga-text-micro);
    color: var(--ga-ink-2, #89857e);
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

  /* Count badge. */
  .cat-count {
    box-sizing: border-box;
    height: 14px;
    min-width: 18px;
    padding: 0 5px;
    border-radius: 7px;
    background: var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    font-size: var(--ga-text-micro);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0;
    line-height: 14px;
    text-align: center;
  }

  /* Effects grid inside each open section. Two columns at this width
     so each tile has room for a description line — keeps the picker
     scannable. */
  .cat-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 4px;
    padding: 0 0 4px;
  }

  .effect-row {
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 3px);
    padding: 4px 6px 4px 4px;
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    text-align: left;
    width: 100%;
    min-width: 0;
    position: relative;
  }

  .effect-row:hover {
    background: var(--ga-card, #13161c);
    border-color: var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }

  .effect-row.selected {
    background: var(--ga-selection-bg, #1f3170);
    border-color: var(--ga-selection-line, #5278ff);
  }

  .effect-row.native-unavailable {
    opacity: 0.38;
    cursor: not-allowed;
    filter: grayscale(0.75);
  }

  .effect-row.native-unavailable:hover {
    background: transparent;
    border-color: transparent;
  }

  .row-thumb {
    width: 36px;
    height: 36px;
    min-width: 36px;
    border-radius: var(--ga-r-hard, 3px);
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
    font-size: var(--ga-text-body);
    color: var(--ga-ink-0, #eef0f4);
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .effect-row.selected .row-name {
    color: var(--ga-selection-ink, #e0e8ff);
  }

  .row-desc {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .no-results {
    text-align: center;
    padding: 40px 0;
    color: var(--ga-ink-2, #89857e);
    font-size: var(--ga-text-body);
  }

  .modal-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 16px;
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }

  .hint {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }

  .footer-actions {
    display: flex;
    gap: 6px;
  }

  .primary-btn {
    height: var(--ga-control-h, 26px);
    background: var(--ga-violet, #9b87f5);
    border: none;
    border-radius: var(--ga-r-soft, 7px);
    padding: 0 14px;
    color: var(--ga-blue-800, #0b0d11);
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    cursor: pointer;
    transition: filter 0.15s;
  }

  .primary-btn:hover:not(:disabled) {
    filter: brightness(1.06);
  }

  .primary-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(-4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* ── Custom-effect import UI ── */
  .import-banner {
    margin: 8px 16px 0;
    padding: 6px 10px;
    border-radius: var(--ga-r-hard, 3px);
    font-size: var(--ga-text-control);
    animation: fadeIn 0.2s ease-out;
  }

  .import-banner.ok {
    background: color-mix(in srgb, var(--ga-live, #22c55e) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-live, #22c55e) 35%, transparent);
    color: var(--ga-live, #4ade80);
  }

  .import-banner.err {
    background: color-mix(in srgb, var(--ga-rec, #ef4444) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ef4444) 35%, transparent);
    color: var(--ga-rec, #f87171);
  }

  /* Legend on effects you imported. */
  .custom-badge {
    display: inline-block;
    font-size: var(--ga-text-micro);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    padding: 1px 4px;
    border-radius: var(--ga-r-hard, 3px);
    background: var(--ga-violet, #9b87f5);
    color: var(--ga-blue-800, #0b0d11);
    margin-left: 4px;
    vertical-align: middle;
  }

  .effect-row.custom .row-thumb {
    border: 1px solid var(--ga-line-3, rgba(255, 255, 255, 0.20));
  }

  .delete-btn {
    position: absolute;
    top: 2px;
    right: 2px;
    background: var(--ga-card, #13161c);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #9aa0ac);
    width: 18px;
    height: 18px;
    border-radius: var(--ga-r-hard, 3px);
    font-size: var(--ga-text-title);
    line-height: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    padding: 0;
    transition: opacity 0.15s, color 0.15s, border-color 0.15s;
    opacity: 0;
  }

  .effect-row.custom:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    color: var(--ga-rec, #ff4438);
    border-color: color-mix(in srgb, var(--ga-rec, #ff4438) 45%, transparent);
  }
</style>
