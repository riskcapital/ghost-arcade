<script lang="ts">
  /**
   * A row's keys at a glance, always shown along the bottom of the row: one
   * diamond per moment that has keys on any of the row's lines (merged when
   * a few pixels apart), the way a motion editor shows a layer's keyframes
   * collapsed.
   *
   * - Click: select that moment's keys (Shift: add or take them away).
   * - Drag: move every selected key in time, snapped like a block (Ctrl /
   *   Cmd: free). One undo step; Esc puts them back.
   * - Double-click: the playhead goes there.
   * Delete, the arrow keys, copy and paste then act on the selection with
   * the selected blocks (keyCommands.ts, trackCommands.ts).
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import type { ControlLine } from '../../../timeline/lines/lineModel';
  import { hasKey, keyMoments, type KeyAt } from '../../../timeline/lines/keyEdit';
  import { lineSelection, selectedKeys, selectKeys } from '../../../timeline/lines/timelineLines';
  import { beginKeyDrag } from './keyCommands';
  import { followPointer } from './dragSession';

  interface Props {
    lines: ControlLine[];
    zoom: number;
    viewStart: number;
    viewEnd: number;
    locked?: boolean;
  }
  let { lines, zoom, viewStart, viewEnd, locked = false }: Props = $props();

  const moments = $derived(keyMoments(lines, Math.max(0, viewStart) - 1, viewEnd + 1, zoom));
  const chosen = $derived.by(() => {
    void $lineSelection;
    return selectedKeys();
  });

  function state(keys: readonly KeyAt[]): 'all' | 'some' | 'none' {
    const n = keys.filter((k) => hasKey(chosen, k)).length;
    return n === 0 ? 'none' : n === keys.length ? 'all' : 'some';
  }

  function labelOf(keys: readonly KeyAt[]): string {
    const names = [...new Set(keys.map((k) => lines.find((l) => l.id === k.lineId)?.label ?? 'Line'))];
    const shown = names.slice(0, 4).join(', ') + (names.length > 4 ? ` and ${names.length - 4} more` : '');
    return `${keys.length} ${keys.length === 1 ? 'key' : 'keys'}: ${shown}. Drag to move the selected keys; double-click to go there.`;
  }

  function press(e: MouseEvent, m: { t: number; keys: KeyAt[] }) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const st = state(m.keys);
    if (e.shiftKey) {
      if (st === 'all') selectKeys(chosen.filter((k) => !hasKey(m.keys, k)));
      else selectKeys(m.keys, { add: true });
      return;
    }
    if (st !== 'all') {
      selectKeys(m.keys, { activeLineId: m.keys[0]?.lineId });
      showTimeline.selectLayerClips([]);
    }
    if (locked) return;
    const drag = beginKeyDrag();
    if (!drag) return;
    const sx = e.clientX;
    let moved = false;
    followPointer({
      move: (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < 3) return;
        moved = true;
        const raw = Math.max(0, m.t + (ev.clientX - sx) / zoom);
        const to = ev.metaKey || ev.ctrlKey || !get(showTimeline).snapEnabled ? raw : Math.max(0, showTimeline.snapTime(raw));
        drag.move(to - m.t);
      },
      end: () => { if (moved) drag.end(); },
      cancel: () => { if (moved) drag.cancel(); },
    });
  }
</script>

<div class="rk" aria-label="Keys on this row" data-row-keys>
  {#each moments as m (m.t)}
    {@const st = state(m.keys)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <span class="rk-key" class:all={st === 'all'} class:some={st === 'some'} class:locked
      style:left="{m.t * zoom}px" title={labelOf(m.keys)}
      onmousedown={(e) => press(e, m)} ondblclick={(e) => { e.stopPropagation(); showTimeline.seek(m.t); }}
      data-row-key={m.t.toFixed(3)}></span>
  {/each}
</div>

<style>
  .rk { position: absolute; left: 0; right: 0; bottom: 1px; height: 10px; z-index: 4; pointer-events: none; }
  .rk-key {
    position: absolute; top: 1px; width: 8px; height: 8px; margin-left: -4px;
    transform: rotate(45deg); pointer-events: auto; cursor: ew-resize;
    background: var(--ga-ink-1, #d6d0dc); border: 1px solid rgba(0, 0, 0, 0.7); box-sizing: border-box;
  }
  .rk-key:hover { background: #fff; }
  .rk-key.some { background: color-mix(in srgb, var(--ga-icon, #5278ff) 55%, #fff); }
  .rk-key.all { background: var(--ga-icon, #5278ff); border-color: #fff; }
  .rk-key.locked { cursor: pointer; }
</style>
