<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { midiStore } from '../midi/midiStore';
  import { macros } from '../stores/macros';
  import type { MidiMappingMode } from '../midi/midiTypes';

  interface OverlayItem {
    path: string;
    label: string;
    min: number;
    max: number;
    step: number;
    mode: MidiMappingMode;
    discreteValues?: string[];
    rect: DOMRect;        // raw bounding rect of the element (viewport coords)
    clipRect: DOMRect;    // rect intersected with all scroll-clipping ancestors — what we actually render
    element: HTMLElement;
    visible: boolean;
  }

  let overlayItems: OverlayItem[] = [];
  let overlayRevision = 0; // Bump to trigger selective re-renders
  let rafId: number | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanning = false;

  // Walk up the DOM and intersect the element's rect with every scrollable
  // ancestor's bounding rect. Returns the smallest visible portion of the
  // element, or a 0×0 rect if it's fully clipped out of view.
  //
  // Without this, the MIDI overlay rendered indicators at the element's
  // logical viewport position even when the element was scrolled past its
  // container's edge — so panel-internal sliders ghosted onto unrelated UI
  // (tabs, shader thumbnails) below the panel.
  function computeClipRect(el: HTMLElement, rawRect: DOMRect): DOMRect {
    let left = rawRect.left;
    let top = rawRect.top;
    let right = rawRect.right;
    let bottom = rawRect.bottom;

    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      const clips =
        style.overflowX === 'hidden' || style.overflowX === 'auto' || style.overflowX === 'scroll' ||
        style.overflowY === 'hidden' || style.overflowY === 'auto' || style.overflowY === 'scroll';
      if (clips) {
        const ancestorRect = node.getBoundingClientRect();
        if (style.overflowX !== 'visible') {
          left = Math.max(left, ancestorRect.left);
          right = Math.min(right, ancestorRect.right);
        }
        if (style.overflowY !== 'visible') {
          top = Math.max(top, ancestorRect.top);
          bottom = Math.min(bottom, ancestorRect.bottom);
        }
      }
      node = node.parentElement;
    }

    const width = Math.max(0, right - left);
    const height = Math.max(0, bottom - top);
    return new DOMRect(left, top, width, height);
  }

  // Check if element is actually visible (handles closed <details>, display:none, scroll-clipped containers, etc.)
  function isEffectivelyVisible(el: HTMLElement, clipRect: DOMRect): boolean {
    // Walk up DOM to check for closed <details> parents
    let node: HTMLElement | null = el;
    while (node) {
      if (node.tagName === 'DETAILS' && !(node as HTMLDetailsElement).open) return false;
      // offsetParent is null for display:none elements (except position:fixed)
      if (node.offsetParent === null && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if (style.position !== 'fixed' && style.display === 'none') return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // After clipping, must still have at least 4×4 of visible surface to bother rendering an indicator.
    return clipRect.width >= 4 && clipRect.height >= 4;
  }

  // Scan DOM for mappable controls (debounced — skip if already scanning)
  function scanControls() {
    if (scanning) return;
    scanning = true;
    try {
      const elements = document.querySelectorAll<HTMLElement>('[data-midi-path]');
      const newItems: OverlayItem[] = [];

      elements.forEach(el => {
        const path = el.dataset.midiPath!;
        const label = el.dataset.midiLabel || path;
        const min = parseFloat(el.dataset.midiMin || '0');
        const max = parseFloat(el.dataset.midiMax || '1');
        const step = parseFloat(el.dataset.midiStep || '0');
        const mode = (el.dataset.midiMode || 'absolute') as MidiMappingMode;
        const discreteStr = el.dataset.midiDiscrete;
        const discreteValues = discreteStr ? discreteStr.split(',') : undefined;
        const rect = el.getBoundingClientRect();
        const clipRect = computeClipRect(el, rect);
        const visible = isEffectivelyVisible(el, clipRect);
        newItems.push({ path, label, min, max, step, mode, discreteValues, rect, clipRect, element: el, visible });
      });

      overlayItems = newItems;
      overlayRevision++;
    } finally {
      scanning = false;
    }
  }

  // Update positions at ~15fps (every 4th rAF) instead of 60fps to reduce overhead
  let rafSkipCount = 0;
  function updatePositions() {
    if (!$midiStore.editMode) return;
    rafSkipCount++;
    if (rafSkipCount < 4) {
      rafId = requestAnimationFrame(updatePositions);
      return;
    }
    rafSkipCount = 0;

    let changed = false;
    for (const item of overlayItems) {
      const newRect = item.element.getBoundingClientRect();
      const newClipRect = computeClipRect(item.element, newRect);
      const wasVisible = item.visible;
      item.visible = isEffectivelyVisible(item.element, newClipRect);
      if (Math.abs(newRect.left - item.rect.left) > 1 || Math.abs(newRect.top - item.rect.top) > 1 ||
          Math.abs(newRect.width - item.rect.width) > 1 || Math.abs(newRect.height - item.rect.height) > 1 ||
          Math.abs(newClipRect.left - item.clipRect.left) > 1 || Math.abs(newClipRect.top - item.clipRect.top) > 1 ||
          Math.abs(newClipRect.width - item.clipRect.width) > 1 || Math.abs(newClipRect.height - item.clipRect.height) > 1 ||
          wasVisible !== item.visible) {
        item.rect = newRect;
        item.clipRect = newClipRect;
        changed = true;
      }
    }
    if (changed) overlayRevision++; // trigger re-render via {#key}
    rafId = requestAnimationFrame(updatePositions);
  }

  // Start learning for a control. Two modes:
  //   1) Normal MIDI learn — bind a controller to this param.
  //   (Macro-learn was removed in the v2 macros redesign — macros are
  //    now effect bundles with a wet/dry knob, not parameter-routing
  //    multipliers. MIDI Learn flows are unchanged for everything else.)
  function handleControlClick(e: MouseEvent, item: OverlayItem) {
    e.stopPropagation();
    e.preventDefault();

    if ($midiStore.learn.active && $midiStore.learn.targetPath === item.path) {
      midiStore.cancelLearn();
      return;
    }
    midiStore.startLearn(item.path, item.label, item.min, item.max, item.step, item.mode, item.discreteValues);
  }

  // Right-click to clear mapping
  function handleControlRightClick(e: MouseEvent, item: OverlayItem) {
    e.preventDefault();
    e.stopPropagation();
    midiStore.removeMapping(item.path);
  }

  // Get mapping label for a path
  function getMappingLabel(path: string): string | null {
    const m = $midiStore.mappings.find(m => m.path === path);
    if (!m) return null;
    if (m.type === 'cc') return `CC${m.number}`;
    if (m.type === 'note') return `N${m.number}`;
    if (m.type === 'pitchbend') return 'PB';
    return `${m.type}${m.number}`;
  }

  // Watch editMode changes — use guard variable to prevent re-triggering on other store changes
  let wasEditMode = false;
  $: {
    const isEdit = $midiStore.editMode;
    if (isEdit && !wasEditMode) {
      // Just entered edit mode — delay scan to let DOM settle
      wasEditMode = true;
      tick().then(() => {
        scanControls();
        rafSkipCount = 0;
        rafId = requestAnimationFrame(updatePositions);
      });
      scanTimer = setInterval(scanControls, 2000); // Re-scan every 2s (not 1s)
      // Instant rescan when <details> sections toggle
      document.addEventListener('toggle', handleDetailsToggle, true);
    } else if (!isEdit && wasEditMode) {
      // Just exited edit mode
      wasEditMode = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      document.removeEventListener('toggle', handleDetailsToggle, true);
      overlayItems = [];
      overlayRevision++;
    }
  }

  function handleDetailsToggle() {
    // Small delay to let DOM settle after toggle animation
    setTimeout(scanControls, 50);
  }

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (scanTimer) clearInterval(scanTimer);
    document.removeEventListener('toggle', handleDetailsToggle, true);
  });
</script>

{#if $midiStore.editMode}
  <div class="midi-overlay-root">
    <!-- Overlay indicators on each control — keyed by revision to batch position updates -->
    {#key overlayRevision}
      {#each overlayItems as item (item.path)}
        {#if item.visible}
          {@const mappingLabel = getMappingLabel(item.path)}
          {@const isLearning = $midiStore.learn.active && $midiStore.learn.targetPath === item.path}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="midi-indicator"
            class:mapped={!!mappingLabel}
            class:learning={isLearning}
            style="left:{item.clipRect.left}px; top:{item.clipRect.top}px; width:{Math.max(item.clipRect.width, 4)}px; height:{Math.max(item.clipRect.height, 4)}px;"
            onclick={(e) => handleControlClick(e, item)}
            oncontextmenu={(e) => handleControlRightClick(e, item)}
            title={mappingLabel ? `${item.label}: ${mappingLabel} (right-click to clear)` : `Click to learn: ${item.label}`}
          >
            {#if mappingLabel}
              <span class="midi-tag">{mappingLabel}</span>
            {/if}
            {#if isLearning}
              <span class="midi-learn-label">LEARN</span>
            {/if}
          </div>
        {/if}
      {/each}
    {/key}

    <!-- Status bar at bottom -->
    <div class="midi-status-bar">
      <span class="midi-status-title">MIDI EDIT</span>
      {#if $midiStore.learn.active && $midiStore.learn.targetLabel}
        <span class="midi-learn-status">Waiting: <strong>{$midiStore.learn.targetLabel}</strong> &mdash; move a control on your MIDI device</span>
      {:else}
        <span class="midi-hint">Click control to assign | Right-click to clear | ESC to exit</span>
      {/if}
      {#if $midiStore.lastMessage}
        <span class="midi-last-msg">
          {$midiStore.lastMessage.type.toUpperCase()} #{$midiStore.lastMessage.number}
          Ch{$midiStore.lastMessage.channel + 1}
        </span>
      {/if}
      <span class="midi-map-count">{$midiStore.mappings.length} mapped</span>
      <button class="midi-exit-btn" onclick={() => midiStore.setEditMode(false)}>EXIT</button>
    </div>
  </div>
{/if}

<style>
  .midi-overlay-root {
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    z-index: 99999;
    pointer-events: none;
  }

  .midi-indicator {
    position: fixed;
    border: 1px solid rgba(255, 60, 60, 0.6);
    border-radius: 3px;
    cursor: pointer;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, background 0.15s;
    z-index: 100000;
  }

  .midi-indicator:hover {
    border-color: #ff4444;
    background: rgba(255, 60, 60, 0.12);
  }

  .midi-indicator.mapped {
    border-color: #00ff88;
    background: rgba(0, 255, 136, 0.08);
  }

  .midi-indicator.mapped:hover {
    background: rgba(0, 255, 136, 0.2);
  }

  .midi-indicator.learning {
    border-color: #00e5ff;
    background: rgba(0, 229, 255, 0.15);
    animation: midi-pulse 0.8s ease-in-out infinite alternate;
  }

  @keyframes midi-pulse {
    0% { border-color: #00e5ff; box-shadow: 0 0 4px rgba(0, 229, 255, 0.3); }
    100% { border-color: #00b8d4; box-shadow: 0 0 12px rgba(0, 229, 255, 0.6); }
  }

  .midi-tag {
    position: absolute;
    top: -10px;
    right: -2px;
    background: #00ff88;
    color: #000;
    font-size: 10px;
    font-weight: 700;
    padding: 1px 3px;
    border-radius: 2px;
    line-height: 1;
    white-space: nowrap;
    letter-spacing: 0.3px;
    pointer-events: none;
  }

  .midi-learn-label {
    font-size: 11px;
    font-weight: 700;
    color: #00e5ff;
    letter-spacing: 1px;
    text-shadow: 0 0 6px rgba(0, 229, 255, 0.8);
    pointer-events: none;
  }

  .midi-status-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 28px;
    background: rgba(20, 20, 40, 0.95);
    border-top: 2px solid #bb86fc;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 12px;
    font-size: 13px;
    color: var(--text-primary, #ccc);
    z-index: 100001;
    pointer-events: auto;
    backdrop-filter: blur(8px);
  }

  .midi-status-title {
    color: #bb86fc;
    font-weight: 700;
    letter-spacing: 1px;
    font-size: 12px;
  }

  .midi-learn-status {
    color: #00e5ff;
    flex: 1;
  }
  .midi-learn-status strong {
    color: #fff;
  }

  .midi-hint {
    color: var(--text-muted, #888);
    flex: 1;
    font-size: 12px;
  }

  .midi-last-msg {
    color: #666;
    font-size: 12px;
    font-family: monospace;
  }

  .midi-map-count {
    color: #00ff88;
    font-size: 12px;
    font-weight: 600;
  }

  .midi-exit-btn {
    background: transparent;
    border: 1px solid #bb86fc;
    color: #bb86fc;
    font-size: 11px;
    font-weight: 700;
    padding: 2px 8px;
    border-radius: 3px;
    cursor: pointer;
    letter-spacing: 1px;
  }
  .midi-exit-btn:hover {
    background: #bb86fc;
    color: #000;
  }
</style>
