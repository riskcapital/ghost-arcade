<script lang="ts">
  import { onDestroy, tick } from 'svelte';
  import { keyboardStore, formatKeyCombo, type KeyActionMode } from '../keyboard/keyboardStore';

  interface OverlayItem {
    path: string;
    label: string;
    min: number;
    max: number;
    step: number;
    mode?: KeyActionMode;
    discreteValues?: string[];
    rect: DOMRect;
    clipRect: DOMRect;
    element: HTMLElement;
    visible: boolean;
  }

  let overlayItems: OverlayItem[] = [];
  let overlayRevision = 0;
  let rafId: number | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;
  let scanning = false;
  let wasEditMode = false;

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

    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  }

  function isEffectivelyVisible(el: HTMLElement, clipRect: DOMRect): boolean {
    let node: HTMLElement | null = el;
    while (node) {
      if (node.tagName === 'DETAILS' && !(node as HTMLDetailsElement).open) return false;
      if (node.offsetParent === null && node !== document.body && node !== document.documentElement) {
        const style = getComputedStyle(node);
        if (style.position !== 'fixed' && style.display === 'none') return false;
      }
      node = node.parentElement;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && clipRect.width >= 4 && clipRect.height >= 4;
  }

  function isKeyActionMode(value: string | undefined): value is KeyActionMode {
    return value === 'trigger' || value === 'toggle' || value === 'momentary' || value === 'nudge';
  }

  function defaultKeyboardMode(path: string, el: HTMLElement): KeyActionMode | undefined {
    const explicit = el.dataset.keyboardMode;
    if (isKeyActionMode(explicit)) return explicit;
    if (path.startsWith('vj:stage-effect:') && path.endsWith(':hold')) return 'momentary';
    if (path.startsWith('vj:led-effect:') && path.endsWith(':hold')) return 'momentary';
    return undefined;
  }

  function scanControls() {
    if (scanning) return;
    scanning = true;
    try {
      const elements = document.querySelectorAll<HTMLElement>('[data-midi-path]');
      const nextItems: OverlayItem[] = [];
      elements.forEach(el => {
        const path = el.dataset.midiPath;
        if (!path) return;
        const rect = el.getBoundingClientRect();
        const clipRect = computeClipRect(el, rect);
        const discreteStr = el.dataset.midiDiscrete;
        nextItems.push({
          path,
          label: el.dataset.midiLabel || path,
          min: parseFloat(el.dataset.midiMin || '0'),
          max: parseFloat(el.dataset.midiMax || '1'),
          step: parseFloat(el.dataset.midiStep || '0.05'),
          mode: defaultKeyboardMode(path, el),
          discreteValues: discreteStr ? discreteStr.split(',') : undefined,
          rect,
          clipRect,
          element: el,
          visible: isEffectivelyVisible(el, clipRect),
        });
      });
      overlayItems = nextItems;
      overlayRevision++;
    } finally {
      scanning = false;
    }
  }

  let rafSkipCount = 0;
  function updatePositions() {
    if (!$keyboardStore.editMode) return;
    rafSkipCount++;
    if (rafSkipCount < 4) {
      rafId = requestAnimationFrame(updatePositions);
      return;
    }
    rafSkipCount = 0;

    let changed = false;
    for (const item of overlayItems) {
      const rect = item.element.getBoundingClientRect();
      const clipRect = computeClipRect(item.element, rect);
      const visible = isEffectivelyVisible(item.element, clipRect);
      if (
        Math.abs(rect.left - item.rect.left) > 1 ||
        Math.abs(rect.top - item.rect.top) > 1 ||
        Math.abs(rect.width - item.rect.width) > 1 ||
        Math.abs(rect.height - item.rect.height) > 1 ||
        Math.abs(clipRect.left - item.clipRect.left) > 1 ||
        Math.abs(clipRect.top - item.clipRect.top) > 1 ||
        Math.abs(clipRect.width - item.clipRect.width) > 1 ||
        Math.abs(clipRect.height - item.clipRect.height) > 1 ||
        visible !== item.visible
      ) {
        item.rect = rect;
        item.clipRect = clipRect;
        item.visible = visible;
        changed = true;
      }
    }
    if (changed) overlayRevision++;
    rafId = requestAnimationFrame(updatePositions);
  }

  function handleControlClick(event: MouseEvent, item: OverlayItem) {
    event.stopPropagation();
    event.preventDefault();
    if ($keyboardStore.learnTarget?.path === item.path) {
      keyboardStore.cancelLearn();
      return;
    }
    keyboardStore.startLearn(item.path, item.label, item.mode, {
      min: item.min,
      max: item.max,
      step: item.step,
      value: item.max,
      discreteValues: item.discreteValues,
    });
  }

  function handleControlRightClick(event: MouseEvent, item: OverlayItem) {
    event.preventDefault();
    event.stopPropagation();
    for (const binding of $keyboardStore.bindings.filter(binding => binding.path === item.path)) {
      keyboardStore.removeBinding(binding.id);
    }
  }

  function getBindingLabel(path: string): string | null {
    const bindings = $keyboardStore.bindings.filter(binding => binding.path === path);
    if (bindings.length === 0) return null;
    if (bindings.length === 1) return formatKeyCombo(bindings[0]);
    return `${bindings.length} keys`;
  }

  function handleDetailsToggle() {
    setTimeout(scanControls, 50);
  }

  $: {
    const isEdit = $keyboardStore.editMode;
    if (isEdit && !wasEditMode) {
      wasEditMode = true;
      tick().then(() => {
        scanControls();
        rafSkipCount = 0;
        rafId = requestAnimationFrame(updatePositions);
      });
      scanTimer = setInterval(scanControls, 2000);
      document.addEventListener('toggle', handleDetailsToggle, true);
    } else if (!isEdit && wasEditMode) {
      wasEditMode = false;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
      document.removeEventListener('toggle', handleDetailsToggle, true);
      overlayItems = [];
      overlayRevision++;
    }
  }

  onDestroy(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (scanTimer) clearInterval(scanTimer);
    document.removeEventListener('toggle', handleDetailsToggle, true);
  });
</script>

{#if $keyboardStore.editMode}
  <div class="keyboard-overlay-root">
    {#key overlayRevision}
      {#each overlayItems as item (item.path)}
        {#if item.visible}
          {@const bindingLabel = getBindingLabel(item.path)}
          {@const isLearning = $keyboardStore.learnTarget?.path === item.path}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="keyboard-indicator"
            class:mapped={!!bindingLabel}
            class:learning={isLearning}
            style="left:{item.clipRect.left}px; top:{item.clipRect.top}px; width:{Math.max(item.clipRect.width, 4)}px; height:{Math.max(item.clipRect.height, 4)}px;"
            onclick={(event) => handleControlClick(event, item)}
            oncontextmenu={(event) => handleControlRightClick(event, item)}
            title={bindingLabel ? `${item.label}: ${bindingLabel} (right-click to clear)` : `Click, then press a key: ${item.label}`}
          >
            {#if bindingLabel}
              <span class="keyboard-tag">{bindingLabel}</span>
            {/if}
            {#if isLearning}
              <span class="keyboard-learn-label">KEY</span>
            {/if}
          </div>
        {/if}
      {/each}
    {/key}

    <div class="keyboard-status-bar">
      <span class="keyboard-status-title">KEYBOARD EDIT</span>
      {#if $keyboardStore.learnTarget}
        <span class="keyboard-learn-status">Press key for <strong>{$keyboardStore.learnTarget.label ?? $keyboardStore.learnTarget.path}</strong></span>
      {:else}
        <span class="keyboard-hint">Click control to assign | Right-click to clear | ESC to exit</span>
      {/if}
      {#if $keyboardStore.lastKey}
        <span class="keyboard-last-msg">{formatKeyCombo($keyboardStore.lastKey)}</span>
      {/if}
      <span class="keyboard-map-count">{$keyboardStore.bindings.length} mapped</span>
      <button class="keyboard-exit-btn" onclick={() => keyboardStore.setEditMode(false)}>EXIT</button>
    </div>
  </div>
{/if}

<style>
  .keyboard-overlay-root {
    position: fixed;
    inset: 0;
    z-index: 99998;
    pointer-events: none;
  }

  .keyboard-indicator {
    position: fixed;
    border: 1px solid rgba(255, 214, 102, 0.76);
    border-radius: 3px;
    cursor: pointer;
    pointer-events: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: border-color 0.15s, background 0.15s;
    z-index: 99999;
  }

  .keyboard-indicator:hover {
    border-color: #ffd166;
    background: rgba(255, 214, 102, 0.13);
  }

  .keyboard-indicator.mapped {
    border-color: #7cffc4;
    background: rgba(124, 255, 196, 0.08);
  }

  .keyboard-indicator.learning {
    border-color: #ffffff;
    background: rgba(255, 214, 102, 0.2);
    animation: keyboard-pulse 0.8s ease-in-out infinite alternate;
  }

  @keyframes keyboard-pulse {
    0% { box-shadow: 0 0 4px rgba(255, 214, 102, 0.3); }
    100% { box-shadow: 0 0 14px rgba(255, 214, 102, 0.72); }
  }

  .keyboard-tag {
    position: absolute;
    top: -10px;
    right: -2px;
    background: #7cffc4;
    color: #00140a;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 8px;
    font-weight: 800;
    padding: 1px 4px;
    border-radius: 2px;
    white-space: nowrap;
  }

  .keyboard-learn-label {
    background: #ffd166;
    color: #111;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: 9px;
    font-weight: 900;
    padding: 2px 6px;
    border-radius: 3px;
    letter-spacing: 0.08em;
  }

  .keyboard-status-bar {
    position: fixed;
    left: 12px;
    right: 12px;
    bottom: 12px;
    z-index: 100000;
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 14px;
    min-height: 38px;
    padding: 8px 12px;
    box-sizing: border-box;
    color: #e8edf2;
    background: rgba(12, 13, 16, 0.96);
    border: 1px solid rgba(255, 214, 102, 0.36);
    border-radius: 6px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    font-size: 12px;
  }

  .keyboard-status-title {
    color: #ffd166;
    font-weight: 900;
    letter-spacing: 0.08em;
  }

  .keyboard-learn-status strong {
    color: #fff;
  }

  .keyboard-hint {
    color: rgba(232, 237, 242, 0.72);
  }

  .keyboard-last-msg,
  .keyboard-map-count {
    margin-left: auto;
    color: rgba(232, 237, 242, 0.72);
    font-family: var(--ga-font-mono, ui-monospace, monospace);
  }

  .keyboard-map-count {
    margin-left: 0;
  }

  .keyboard-exit-btn {
    border: 1px solid rgba(255, 214, 102, 0.45);
    border-radius: 4px;
    color: #ffd166;
    background: rgba(255, 214, 102, 0.08);
    padding: 4px 10px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 800;
  }

  .keyboard-exit-btn:hover {
    color: #111;
    background: #ffd166;
  }
</style>
