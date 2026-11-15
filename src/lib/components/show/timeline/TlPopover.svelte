<script lang="ts">
  /**
   * A small menu or popover under (or over) a Timeline button: it lives in
   * the page body so the tray's overflow cannot clip it, stays inside the
   * window, and closes on a click elsewhere or Esc (Esc is then the menu's,
   * see keyLabels.ts). Items use the `tl-mi` class for the shared look.
   */
  import type { Snippet } from 'svelte';
  import { keepInWindow, portal } from './trackLayout';

  interface Props {
    anchor: HTMLElement | null | undefined;
    onclose: () => void;
    placement?: 'below' | 'above';
    align?: 'start' | 'end';
    width?: number;
    label?: string;
    children: Snippet;
  }
  let { anchor, onclose, placement = 'below', align = 'start', width, label = '', children }: Props = $props();

  let el: HTMLDivElement | undefined = $state();
  const pos = $derived.by(() => {
    if (!anchor) return { left: 0, top: 0 };
    const r = anchor.getBoundingClientRect();
    const left = align === 'end' ? r.right - (width ?? 220) : r.left;
    return { left: Math.max(8, left), top: placement === 'below' ? r.bottom + 4 : r.top - 4 };
  });

  $effect(() => {
    const away = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (el?.contains(t) || anchor?.contains(t)) return;
      onclose();
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onclose();
    };
    const timer = setTimeout(() => window.addEventListener('pointerdown', away, true), 0);
    window.addEventListener('keydown', esc, true);
    window.addEventListener('resize', onclose);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', esc, true);
      window.removeEventListener('resize', onclose);
    };
  });
</script>

<div
  class="tl-pop"
  class:above={placement === 'above'}
  bind:this={el}
  use:portal
  use:keepInWindow={pos}
  style:left="{pos.left}px"
  style:top="{pos.top}px"
  style:width={width ? `${width}px` : undefined}
  role="menu"
  aria-label={label}
  data-tl-popover
  data-fit-ignore
>
  {@render children()}
</div>

<style>
  .tl-pop {
    position: fixed;
    z-index: 10050;
    min-width: 180px;
    padding: 4px;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: 1px;
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #f2ede4);
  }
  .tl-pop.above { transform: translateY(-100%); }
  .tl-pop :global(.tl-mi) {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 4px 8px;
    box-sizing: border-box;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }
  .tl-pop :global(.tl-mi:hover:not(:disabled)),
  .tl-pop :global(.tl-mi:focus-visible) { background: var(--ga-raise, #26221c); outline: none; }
  .tl-pop :global(.tl-mi:disabled) { opacity: 0.45; cursor: default; }
  .tl-pop :global(.tl-mi .tl-icon) { color: var(--ga-icon, #5278ff); }
  .tl-pop :global(.tl-mi.on) { color: var(--ga-selection-ink, #e0e8ff); }
  .tl-pop :global(.tl-mi.danger) { color: var(--tl-on, #ff725f); }
  .tl-pop :global(.tl-mi .tl-mi-key) {
    margin-left: auto;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: 10px;
    color: var(--ga-ink-2, #89857e);
  }
  .tl-pop :global(.tl-mi .tl-mi-desc) {
    display: block;
    font-weight: 500;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #89857e);
  }
  .tl-pop :global(.tl-mi-col) { display: flex; flex-direction: column; min-width: 0; }
  .tl-pop :global(.tl-mi-head) {
    padding: 6px 8px 2px;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  .tl-pop :global(.tl-mi-sep) { height: 1px; margin: 3px 4px; background: var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .tl-pop :global(.tl-pop-row) { display: flex; align-items: center; gap: 8px; padding: 4px 8px; min-height: 28px; }
  .tl-pop :global(.tl-pop-label) { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); min-width: 64px; }
</style>
