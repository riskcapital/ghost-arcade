<script lang="ts">
  /**
   * While the Timeline is open, a "◆" appears next to the control under the
   * pointer in the normal panels (Properties, Shader Parameters, effects,
   * edge effects, sketch controls, the look block bar…). Clicking it puts a
   * point at the playhead on that control's line, holding the value the
   * control shows (the line is made if it has none). See lineDiamond.ts.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { project } from '../../../stores/layers';
  import { activeBlock } from '../../../show/tracks/showBlockEdit';
  import { addLineWithPoint, describeLineParam, timelineRegistrySource } from '../../../timeline/lines/timelineLines';
  import { readParam, type ParamTarget } from '../../../timeline/lines/paramRegistry';
  import { controlAddressOf, lastLineControl, resolveControlTarget } from './lineDiamond';

  const SELECTOR = '[data-line-key], [data-midi-path^="map:"]';
  let hover: { x: number; y: number; target: ParamTarget; key: string; label: string; has: boolean } | null = $state(null);
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function resolve(el: Element) {
    const address = controlAddressOf(el);
    if (!address) return null;
    const target = resolveControlTarget(address, {
      selectedLayerId: (get(project) as any)?.selectedLayerId ?? null,
      activeBlockClipId: get(activeBlock)?.clipId ?? null,
    });
    if (!target) return null;
    const entry = describeLineParam(target, address.key);
    if (!entry) return null;
    return { target, key: address.key, label: entry.label };
  }

  function onOver(e: MouseEvent) {
    const t = e.target as Element | null;
    if (!t || t.closest?.('[data-line-diamond]')) {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      return;
    }
    // Not inside the Timeline tray itself.
    if (t.closest?.('.show-timeline-panel, [aria-label="Timeline"]')) return;
    const el = t.closest?.(SELECTOR);
    if (!el) {
      if (hover && !hideTimer) hideTimer = setTimeout(() => { hover = null; hideTimer = null; }, 350);
      return;
    }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    const found = resolve(el);
    if (!found) { hover = null; return; }
    const r = el.getBoundingClientRect();
    const lines = get(showTimeline).lines;
    const has = lines.some((l) => l.key === found.key && JSON.stringify(l.target) === JSON.stringify(found.target));
    hover = { x: Math.max(2, r.left - 16), y: r.top + Math.min(r.height, 28) / 2 - 7, ...found, has };
  }

  function add(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!hover) return;
    const { target, key, label } = hover;
    const stored = readParam(timelineRegistrySource(), target, key);
    const value = typeof stored === 'boolean' ? (stored ? 1 : 0) : typeof stored === 'number' ? stored : undefined;
    addLineWithPoint(target, key, get(showTimeline).currentTime, value);
    lastLineControl.set({ target, key, label });
    hover = { ...hover, has: true };
  }

  $effect(() => {
    document.addEventListener('mouseover', onOver, true);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      if (hideTimer) clearTimeout(hideTimer);
    };
  });
</script>

{#if hover}
  <button
    class="ld"
    class:has={hover.has}
    style:left="{hover.x}px"
    style:top="{hover.y}px"
    onmousedown={(e) => e.stopPropagation()}
    onclick={add}
    title={`◆ ${hover.label}: a point at the playhead on its Timeline line, with this value`}
    data-line-diamond
    data-line-diamond-key={hover.key}
  >◆</button>
{/if}

<style>
  .ld {
    position: fixed;
    z-index: 9000;
    width: 14px;
    height: 14px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    line-height: 1;
    background: rgba(10, 10, 14, 0.92);
    border: 1px solid rgba(255, 217, 107, 0.55);
    color: rgba(255, 217, 107, 0.8);
    border-radius: 3px;
    cursor: pointer;
  }
  .ld.has { background: #FFD96B; color: #111; border-color: #FFD96B; }
  .ld:hover { color: #fff; border-color: #fff; }
</style>
