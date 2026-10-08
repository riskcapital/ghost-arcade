<script lang="ts">
  /**
   * The effect browser: every effect on ten plain shelves, with search. It replaces a 122-line
   * system menu. One tap on an effect adds exactly that effect and closes the sheet.
   */
  import { onDestroy, onMount } from 'svelte';
  import Icon from './StudioIcon.svelte';
  import { EFFECT_SHELVES, browseEffects, effectEntries, effectShelves, type BrowsableEffect } from '../../mobile/studio/effectBrowser';

  export let effects: BrowsableEffect[] = [];
  /** Where the effect will go, for example "Layer 2". */
  export let scope = '';
  export let onadd: (type: string) => void = () => {};
  export let onclose: () => void = () => {};

  // One glyph per shelf, drawn on a 24 px grid with the same stroke as the app's other icons.
  const GLYPHS: Record<string, string> = {
    star: 'M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.8z',
    drop: 'M12 3.5c3.2 3.9 5.5 6.8 5.5 9.8a5.5 5.5 0 0 1-11 0c0-3 2.3-5.9 5.5-9.8z',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2.500v2.500M12 19v2.500M2.5 12H5M19 12h2.500M5.3 5.300l1.8 1.800M16.9 16.900l1.8 1.800M5.3 18.700l1.8-1.800M16.9 7.100l1.8-1.8',
    blur: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0',
    wave: 'M2.5 9c2.4-3 4.7-3 7.1 0s4.7 3 7.1 0 3.6-2.2 4.8-1M2.5 16c2.4-3 4.7-3 7.1 0s4.7 3 7.1 0 3.6-2.2 4.8-1',
    halftone: 'M6 6h.01M12 6h.01M18 6h.01M6 12h.01M12 12h.01M18 12h.01M6 18h.01M12 18h.01M18 18h.01',
    trail: 'M16 12m-4.5 0a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0-9 0M3 9h6M2 12h7M3 15h6',
    grain: 'M4 20c3-9 5-13 8-13s3 5 5 5 2-3 3-5M5 5h.01M19 17h.01M15 4h.01M9 19h.01',
    tiles: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
    mask: 'M3.5 5.500h17v13h-17zM12 12m-4 0a4 4 0 1 0 8 0a4 4 0 1 0-8 0',
  };
  const glyphOf = new Map(EFFECT_SHELVES.map((s) => [s.id, GLYPHS[s.icon] ?? GLYPHS.star]));
  const shelfName = new Map(EFFECT_SHELVES.map((s) => [s.id, s.label]));

  let shelf = 'all', search = '';
  let root: HTMLElement;
  let returnFocus: HTMLElement | null = null;
  $: entries = effectEntries(effects);
  $: shelves = effectShelves(entries);
  $: shown = browseEffects(entries, shelf, search);

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onclose(); return; }
    if (e.key !== 'Tab') return;
    const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]),input')].filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  onMount(() => {
    returnFocus = document.activeElement as HTMLElement | null;
    root.querySelector<HTMLElement>('[data-effects-close]')?.focus({ preventScroll: true });
  });
  onDestroy(() => { if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true }); });
</script>

<div class="scrim" role="presentation" onclick={(e) => { if (e.target === e.currentTarget) onclose(); }}>
    <div class="effect-browser" bind:this={root} role="dialog" aria-modal="true" aria-label={scope ? `Add an effect to ${scope}` : 'Add an effect'} data-effect-browser onkeydown={key}>
    <header>
      <h2>Add an effect{#if scope}<small>{scope}</small>{/if}</h2>
      <button class="close" data-effects-close aria-label="Close effects" onclick={onclose}><Icon name="close" size={20} /></button>
    </header>
    <label class="search"><Icon name="search" size={18} /><input type="search" placeholder="Search effects" bind:value={search} aria-label="Search effects" enterkeyhint="search" autocapitalize="off" autocomplete="off" /></label>
    <div class="chips" role="group" aria-label="Kind of effect">
      <button class:active={shelf === 'all' && !search} aria-pressed={shelf === 'all'} data-shelf="all" onclick={() => { shelf = 'all'; search = ''; }}>All <span>{entries.length}</span></button>
      {#each shelves as s}<button class:active={shelf === s.id && !search} aria-pressed={shelf === s.id} data-shelf={s.id} onclick={() => { shelf = s.id; search = ''; }}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={GLYPHS[s.icon]} /></svg>{s.label} <span>{s.count}</span></button>{/each}
    </div>
    <p class="count" role="status" aria-live="polite">{search ? `${shown.length} for “${search}”` : `${shown.length} effect${shown.length === 1 ? '' : 's'}`} · Tap one to add it.</p>
    <div class="scroll" data-effects-scroll>
      <div class="grid">
        {#each shown as effect (effect.type)}
          <button class="tile" data-effect={effect.type} aria-label={`Add ${effect.label}, ${shelfName.get(effect.shelf)}`} onclick={() => onadd(effect.type)}>
            <span class="glyph" data-shelf-icon={effect.shelf}><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={glyphOf.get(effect.shelf)} /></svg></span>
            <span class="text"><strong>{effect.label}</strong><small>{shelfName.get(effect.shelf)}</small></span>
          </button>
        {/each}
      </div>
      {#if !shown.length}<p class="none">No effect matches “{search}”.</p>{/if}
    </div>
  </div>
</div>

<style>
  .scrim { position: fixed; inset: 0; z-index: 56; display: flex; align-items: flex-end; justify-content: center; background: #000a; }
  .effect-browser {
    display: flex; flex-direction: column; min-height: 0; width: min(100%, 760px);
    height: calc(100dvh - max(28px, env(safe-area-inset-top)));
    padding: 10px max(12px, env(safe-area-inset-right)) 0 max(12px, env(safe-area-inset-left));
    border: 1px solid var(--ga-line-3); border-bottom: 0; border-radius: 14px 14px 0 0;
    background: var(--ga-inspector-bg, var(--ga-panel)); color: var(--ga-ink-0);
    animation: rise .2s ease-out;
  }
  @keyframes rise { from { transform: translateY(24px); opacity: 0; } }
  button { font: inherit; color: var(--ga-ink-0); background: var(--ga-hardware-bg); border: 1px solid var(--ga-line-2); border-radius: 6px; touch-action: manipulation; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ga-focus); outline-offset: 2px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 8px; }
  h2 { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin: 0; font-size: 18px; font-weight: 600; }
  h2 small { font-size: 12px; font-weight: 500; color: var(--ga-ink-1); }
  .close { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; flex: none; }
  .search { flex: none; display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px; margin-bottom: 8px; border: 1px solid var(--ga-line-2); border-radius: 6px; background: var(--ga-slot); }
  .search input { flex: 1; min-width: 0; height: 42px; border: 0; background: none; color: var(--ga-ink-0); font: inherit; font-size: 16px; outline-offset: -2px; }
  .chips { flex: none; display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; padding-bottom: 1px; }
  .chips::-webkit-scrollbar { display: none; }
  .chips button { flex: none; display: flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px; font-size: 13px; white-space: nowrap; }
  .chips button span { font-size: 11px; color: var(--ga-ink-2); }
  .chips button.active { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .chips svg, .glyph svg { color: var(--ga-icon, var(--ga-blue-400)); }
  .count { flex: none; margin: 8px 2px; font-size: 12px; color: var(--ga-ink-1); }
  /* The list ends above the home indicator: nothing tappable scrolls through that strip. */
  .scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; padding-bottom: 16px; margin-bottom: env(safe-area-inset-bottom); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(164px, 1fr)); gap: 6px; }
  .tile { display: grid; grid-template-columns: 40px minmax(0, 1fr); align-items: center; gap: 10px; min-height: 56px; padding: 6px 10px 6px 8px; text-align: left; content-visibility: auto; contain-intrinsic-size: 164px 56px; }
  .glyph { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 8px; background: var(--ga-blue-800); border: 1px solid var(--ga-blue-mute-600); }
  .text { display: grid; gap: 2px; min-width: 0; }
  .text strong { font-size: 13px; font-weight: 600; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .text small { font-size: 11px; color: var(--ga-ink-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .none { margin: 14px 2px; font-size: 14px; color: var(--ga-ink-1); }
  @media (min-width: 700px) {
    .scrim { align-items: center; }
    .effect-browser { height: min(86dvh, 820px); border-bottom: 1px solid var(--ga-line-3); border-radius: 14px; padding-bottom: 4px; }
  }
  @media (prefers-reduced-motion: reduce) { .effect-browser { animation: none; } }
</style>
