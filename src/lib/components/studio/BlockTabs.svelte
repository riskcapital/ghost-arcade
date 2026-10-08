<script lang="ts">
  /**
   * Clip blocks as a row of tabs above the deck, the way the desktop VJ panel shows them.
   * Tap a tab to open that block. Hold a tab and drag it to reorder; hold and let go, or tap the
   * open one, for Rename / Duplicate / Delete / Move. "+" adds an empty block.
   */
  import { tick } from 'svelte';
  import Icon from './StudioIcon.svelte';
  import type { BlockTab } from '../../mobile/studio/blocks';
  import { dragReorder } from '../../mobile/studio/reorder';

  export let tabs: BlockTab[] = [];
  /** False when the set already holds the most blocks it can. */
  export let canAdd = true;
  export let onselect: (id: string) => void = () => {};
  export let onadd: () => void = () => {};
  export let onrename: (id: string, name: string) => void = () => {};
  export let onduplicate: (id: string) => void = () => {};
  export let ondelete: (id: string) => void = () => {};
  /** A tab was dragged (or moved from its menu) to another place in the row. */
  export let onmove: (from: number, to: number) => void = () => {};
  /** A tab was lifted for dragging. */
  export let onlift: () => void = () => {};

  const HOLD_MS = 450;

  let strip: HTMLDivElement;
  /** Index of the tab whose menu is open. An index survives the tab getting its real id. */
  let menuIndex = -1;
  let renaming = false;
  let draft = '';
  let nameField: HTMLInputElement | null = null;

  $: menu = menuIndex >= 0 ? tabs[menuIndex] ?? null : null;
  $: if (menuIndex >= tabs.length) closeMenu();
  $: activeKey = tabs.find((t) => t.active)?.id ?? '';
  // Bring the open tab into view when it changes. Only the strip moves: scrollIntoView would
  // also scroll the deck back up to the tabs every time a clip is launched.
  let revealed = '';
  $: revealKey = `${activeKey}:${tabs.length}`;
  $: if (revealKey !== revealed) { revealed = revealKey; void reveal(); }

  async function reveal() {
    await tick();
    const tab = strip?.querySelector<HTMLElement>('.block-tab.active');
    if (!tab || !strip) return;
    const start = tab.offsetLeft, end = start + tab.offsetWidth, room = strip.clientWidth - 52; // 52: the pinned "+"
    if (start < strip.scrollLeft) strip.scrollLeft = start;
    else if (end > strip.scrollLeft + room) strip.scrollLeft = end - room;
  }

  function openMenu(index: number) {
    menuIndex = index;
    renaming = false;
  }
  function closeMenu() {
    menuIndex = -1;
    renaming = false;
  }
  function choose(index: number) {
    const tab = tabs[index];
    if (tab.active) return menuIndex === index ? closeMenu() : openMenu(index);
    closeMenu();
    onselect(tab.id);
  }
  /** From the menu: one place left or right. The menu follows the tab. */
  function step(by: number) {
    const from = menuIndex, to = from + by;
    if (from < 0 || to < 0 || to >= tabs.length) return;
    onmove(from, to);
    menuIndex = to;
  }
  async function startRename() {
    if (!menu) return;
    draft = menu.name;
    renaming = true;
    await tick();
    nameField?.focus();
    nameField?.select();
  }
  function saveName() {
    if (menu && draft.trim()) onrename(menu.id, draft.trim());
    closeMenu();
  }
</script>

<div class="block-tabs">
  <div class="strip" role="tablist" aria-label="Clip blocks" bind:this={strip}>
    {#each tabs as tab, index (tab.id || 'deck')}
      <button
        class="block-tab"
        class:active={tab.active}
        class:menu-open={menuIndex === index}
        role="tab"
        aria-selected={tab.active}
        aria-haspopup="menu"
        aria-expanded={menuIndex === index}
        data-block-tab={tab.id}
        data-reorder-item
        title="Hold and drag to reorder. Hold for Rename, Duplicate or Delete."
        use:dragReorder={{ axis: 'x', index, hold: HOLD_MS, onlift, onhold: () => openMenu(index), onmove: (from, to) => { closeMenu(); onmove(from, to); } }}
        onclick={() => choose(index)}
        ><span class="block-name">{tab.name}</span>{#if tab.active}<span class="more" aria-hidden="true">⋯</span>{/if}</button
      >
    {/each}
    <button class="block-add" aria-label="Add new block" title="Add new block" disabled={!canAdd} onclick={() => { closeMenu(); onadd(); }}
      ><Icon name="plus" size={18} /></button
    >
  </div>
  {#if menu}
    <div class="block-menu" role="menu" aria-label={`Block ${menu.name}`}>
      {#if renaming}
        <label class="block-rename"
          ><span>Block name</span><input
            bind:this={nameField}
            bind:value={draft}
            maxlength="80"
            enterkeyhint="done"
            onkeydown={(e) => { if (e.key === 'Enter') saveName(); else if (e.key === 'Escape') closeMenu(); }}
          /></label
        >
        <button class="primary" onclick={saveName} disabled={!draft.trim()}>Save</button>
        <button onclick={closeMenu}>Cancel</button>
      {:else}
        <strong>{menu.name}</strong>
        <button role="menuitem" onclick={startRename}>Rename</button>
        <button role="menuitem" disabled={!canAdd} onclick={() => { const id = menu.id; closeMenu(); onduplicate(id); }}>Duplicate</button>
        <button role="menuitem" class="move" data-block-move="-1" aria-label={`Move ${menu.name} left`} disabled={menuIndex <= 0} onclick={() => step(-1)}><Icon name="left" size={18} /></button>
        <button role="menuitem" class="move" data-block-move="1" aria-label={`Move ${menu.name} right`} disabled={menuIndex >= tabs.length - 1} onclick={() => step(1)}><Icon name="right" size={18} /></button>
        <button role="menuitem" class="danger" disabled={tabs.length <= 1} onclick={() => { const id = menu.id; closeMenu(); ondelete(id); }}>Delete</button>
        <button class="close" aria-label="Close block menu" onclick={closeMenu}><Icon name="close" size={18} /></button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .block-tabs { margin: 0 0 8px; min-width: 0; }
  .strip {
    position: relative; display: flex; gap: 4px; align-items: stretch; overflow-x: auto; overscroll-behavior-x: contain;
    scrollbar-width: none; -webkit-overflow-scrolling: touch; padding: 0 0 1px;
    border-bottom: 1px solid var(--ga-line-2);
  }
  .strip::-webkit-scrollbar { display: none; }
  button {
    font: inherit; font-size: 12px; color: var(--ga-ink-1); cursor: pointer; touch-action: manipulation;
    min-height: 44px; min-width: 44px; border: 1px solid transparent; border-radius: 6px 6px 0 0; background: none;
    -webkit-user-select: none; user-select: none; -webkit-touch-callout: none;
  }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: -2px; }
  button:disabled { opacity: .4; cursor: default; }
  .block-tab {
    flex: none; display: inline-flex; align-items: center; gap: 8px; max-width: 180px; padding: 0 14px;
    touch-action: pan-x; background: var(--ga-slot); border-color: var(--ga-line-2); border-bottom-color: transparent;
  }
  .block-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .block-tab.active {
    color: var(--ga-selection-ink); font-weight: 650; background: var(--ga-selection-bg);
    border-color: var(--ga-selection-line); box-shadow: inset 0 -2px 0 var(--ga-selection-line);
  }
  .more { font-size: 15px; line-height: 1; opacity: .8; }
  /* Always in reach: "+" stays at the right end while the tabs scroll under it. */
  .block-add {
    flex: none; display: grid; place-items: center; position: sticky; right: 0; z-index: 1;
    background: var(--ga-panel); border-color: var(--ga-line-2); border-style: dashed; border-bottom-color: transparent;
    box-shadow: -8px 0 10px -4px var(--ga-void);
  }
  .block-menu {
    display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 8px;
    background: var(--ga-inspector-bg); border: 1px solid var(--ga-line-2); border-top: 0; border-radius: 0 0 8px 8px;
  }
  .block-menu strong {
    flex: 1 1 56px; min-width: 0; padding: 0 6px; font-size: 12px; color: var(--ga-ink-0);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .block-menu button { padding: 0 10px; border-radius: 6px; color: var(--ga-ink-0); background: var(--ga-hardware-bg); border-color: var(--ga-line-2); }
  .block-menu .primary { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .block-menu .danger { color: var(--ga-rec); }
  .block-menu .close { padding: 0; display: grid; place-items: center; background: none; border-color: transparent; }
  .block-menu .move { padding: 0; display: grid; place-items: center; }
  /* Phone: the name gets its own line so the six actions share one row. */
  @media (max-width: 480px) { .block-menu { gap: 4px; } .block-menu strong { flex-basis: 100%; padding: 2px 6px; } .block-rename { flex-basis: 100%; } }
  .block-rename { flex: 1 1 160px; min-width: 0; display: grid; gap: 4px; font-size: 11px; color: var(--ga-ink-2); }
  .block-rename input {
    min-height: 44px; min-width: 0; box-sizing: border-box; width: 100%; padding: 0 10px; font: inherit; font-size: 16px;
    color: var(--ga-ink-0); background: var(--ga-slot); border: 1px solid var(--ga-line-2); border-radius: 6px;
  }
</style>
