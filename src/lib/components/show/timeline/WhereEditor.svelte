<script lang="ts">
  /**
   * A block's "⇄ Where" button in the inspector: what its pattern is, and a
   * click opens the pattern editor (WherePatternEditor) by the button. The
   * same editor opens with a double-click on the pattern in the block.
   */
  import { showSlice } from './timelineSlices';
  import type { ParamTarget } from '../../../timeline/lines/paramRegistry';
  import type { WhereSpec } from '../../../timeline/where/whereModel';
  import { openWhereEditor, whereEditing, whereSummary } from './whereUi';

  interface Props {
    where: WhereSpec | null | undefined;
    /** Where the block's lines live (its pattern editor opens for it). */
    target: ParamTarget;
  }
  let { where, target }: Props = $props();

  // A slice: the whole store publishes every playhead frame.
  const ordersSlice = showSlice('whereOrders');
  const id = $derived('id' in target ? target.id : null);
  const isOpen = $derived(!!id && $whereEditing?.id === id);

  function toggle(e: MouseEvent) {
    if (isOpen) whereEditing.set(null);
    else openWhereEditor(target, e.currentTarget as Element);
  }
</script>

<button type="button" class="where-btn" class:on={!!where} class:open={isOpen} onclick={toggle}
  title={where ? `Where: ${whereSummary(where, $ordersSlice)}. Click to change.` : 'Where: make this block travel across the pieces (a sweep, a burst, a random piece on the beat…)'}
  data-where-button>
  ⇄ Where{where ? `: ${whereSummary(where, $ordersSlice)}` : ''}
</button>

<style>
  .where-btn {
    height: var(--ga-control-h-sm, 22px); background: var(--ga-sunk, #0c0c10); border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.14));
    color: var(--ga-ink-1, #ccc); border-radius: 3px; font: inherit; font-size: 11px; padding: 0 8px; cursor: pointer;
    max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .where-btn:hover { color: var(--ga-ink-0, #fff); }
  .where-btn.on { border-color: color-mix(in srgb, var(--ga-icon, #5278ff) 60%, transparent); color: var(--ga-ink-0, #fff); }
  .where-btn.open { background: color-mix(in srgb, var(--ga-icon, #5278ff) 18%, transparent); }
</style>
