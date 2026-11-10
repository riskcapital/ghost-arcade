<script lang="ts">
  /**
   * "⌇+": add a control line for a parameter. Lists the registry's
   * parameters for what the row drives (the piece, or a block on it, a look
   * block, the Stage), grouped and searchable. The new line gets a point at
   * the playhead holding the value the parameter has there.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { addLineAtPlayhead, paramsForTarget } from '../../../timeline/lines/timelineLines';
  import { sameTarget, type ParamTarget } from '../../../timeline/lines/paramRegistry';
  import { filterParams } from './lineUi';
  import { portal } from './trackLayout';

  interface Props {
    targets: Array<{ target: ParamTarget; label: string }>;
    x: number;
    y: number;
    onclose: () => void;
  }
  let { targets, x, y, onclose }: Props = $props();

  let which = $state(0);
  let query = $state('');
  const current = $derived(targets[Math.min(which, targets.length - 1)] ?? null);
  const entries = $derived(current ? paramsForTarget(current.target) : []);
  const used = $derived(new Set(current ? get(showTimeline).lines.filter((l) => sameTarget(l.target, current.target)).map((l) => l.key) : []));
  const groups = $derived(filterParams(entries, query, used));

  function pick(key: string) {
    if (!current) return;
    addLineAtPlayhead(current.target, key);
    onclose();
  }

  function focus(node: HTMLInputElement) {
    // After the portal has moved the menu into the page.
    requestAnimationFrame(() => node.focus());
  }

  $effect(() => {
    const close = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-line-picker-menu]')) return;
      onclose();
    };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => { clearTimeout(t); window.removeEventListener('mousedown', close); };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="lp" use:portal style:left="{x}px" style:top="{y}px" onmousedown={(e) => e.stopPropagation()} data-line-picker-menu>
  <div class="lp-head">Add a control line</div>
  {#if targets.length > 1}
    <div class="lp-targets">
      {#each targets as t, i (i)}
        <button class="lp-target" class:on={i === which} onclick={() => (which = i)} data-line-picker-target={i}>{t.label}</button>
      {/each}
    </div>
  {/if}
  <input
    class="lp-search"
    type="search"
    placeholder="Search parameters"
    bind:value={query}
    use:focus
    onkeydown={(e) => {
      e.stopPropagation();
      if (e.key === 'Escape') onclose();
      if (e.key === 'Enter' && groups[0]?.[1][0]) pick(groups[0][1][0].key);
    }}
    data-line-picker-search
  />
  <div class="lp-list">
    {#if groups.length === 0}
      <div class="lp-empty">{entries.length === 0 ? 'Nothing here takes a line yet.' : query ? 'No parameter matches.' : 'Every parameter already has a line.'}</div>
    {/if}
    {#each groups as [group, list] (group)}
      <div class="lp-group">{group}</div>
      {#each list as p (p.key)}
        <button class="lp-item" onclick={() => pick(p.key)} data-param-key={p.key}>{p.label}</button>
      {/each}
    {/each}
  </div>
</div>

<style>
  .lp {
    position: fixed;
    z-index: 10000;
    width: 260px;
    max-height: 380px;
    display: flex;
    flex-direction: column;
    padding: 6px;
    gap: 5px;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    transform: translateY(-100%);
    font-size: var(--ga-text-control, 12px);
  }
  .lp-head, .lp-group {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 2px 4px;
  }
  .lp-group { margin-top: 4px; }
  .lp-targets { display: flex; flex-wrap: wrap; gap: 3px; }
  .lp-target {
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    border-radius: 3px;
    padding: 2px 6px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    max-width: 120px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .lp-target.on { border-color: #FFD96B; color: #FFD96B; }
  .lp-search {
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #ddd);
    border-radius: 3px;
    padding: 4px 6px;
    font: inherit;
  }
  .lp-list { overflow-y: auto; min-height: 0; }
  .lp-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    padding: 3px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .lp-item:hover { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
  .lp-empty { color: var(--ga-ink-2, #7a7a86); padding: 4px; }
</style>
