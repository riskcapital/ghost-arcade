<script lang="ts">
  /**
   * A section header in the Timeline's header column: fold chevron, icon,
   * the section's name in capitals, a count, and its actions on the right.
   * Folded, a short summary says what is inside. 24 px (taller when asked).
   */
  import type { Snippet } from 'svelte';
  import TimelineIcon, { type TimelineIconName } from './TimelineIcon.svelte';

  interface Props {
    id: string;
    title: string;
    icon: TimelineIconName;
    count?: number | string | null;
    folded: boolean;
    /** No fold (the section always shows its rows). */
    fixed?: boolean;
    ontoggle?: () => void;
    summary?: string;
    height?: number;
    help?: string;
    actions?: Snippet;
  }
  let { id, title, icon, count = null, folded, fixed = false, ontoggle, summary = '', height = 24, help, actions }: Props = $props();
</script>

<div class="rsh" class:folded style:height="{height}px" data-row-section={id} data-help={help}>
  <button
    class="rsh-fold"
    disabled={fixed}
    onmousedown={(e) => e.stopPropagation()}
    onclick={ontoggle}
    aria-expanded={!folded}
    title={folded ? 'Show the rows' : 'Fold the rows away'}
    data-row-section-fold={id}
  >
    <span class="rsh-chev" aria-hidden="true"><TimelineIcon name="chevron" size={12} /></span>
    <span class="rsh-icon"><TimelineIcon name={icon} size={14} /></span>
    <span class="rsh-title">{title}</span>
    {#if count !== null && count !== undefined}<span class="rsh-count" data-row-section-count>{count}</span>{/if}
  </button>
  {#if folded && summary}<span class="rsh-sum" title={summary}>{summary}</span>{/if}
  <span class="rsh-acts">{#if actions}{@render actions()}{/if}</span>
</div>

<style>
  .rsh {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px 0 4px;
    box-sizing: border-box;
    background: var(--ga-card, #16140f);
    border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07));
    white-space: nowrap;
    min-width: 0;
  }
  .rsh-fold {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 4px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ga-ink-2, #89857e);
    font: inherit;
    cursor: pointer;
    min-width: 0;
    flex: 0 0 auto;
  }
  .rsh-fold:hover:not(:disabled) { background: var(--ga-raise, #26221c); }
  .rsh-fold:disabled { cursor: default; }
  .rsh-fold:disabled .rsh-chev { visibility: hidden; }
  .rsh-chev { display: inline-flex; transition: transform 0.12s; }
  .folded .rsh-chev { transform: rotate(-90deg); }
  .rsh-icon { display: inline-flex; color: var(--ga-icon, #5278ff); }
  .rsh-title {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .rsh-count { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 10px; color: var(--ga-ink-2, #89857e); }
  .rsh-sum { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); text-align: right; }
  .rsh-acts { margin-left: auto; display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
  .rsh-acts :global(.rsh-act) {
    height: 20px;
    padding: 0 4px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .rsh-acts :global(.rsh-act .tl-icon) { color: var(--ga-icon, #5278ff); }
  .rsh-acts :global(.rsh-act:hover:not(:disabled)) { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .rsh-acts :global(.rsh-act:disabled) { opacity: 0.45; cursor: default; }
</style>
