<!--
  Visual overlay shown during a MediaPipe learn session. Mirrors the
  MIDI Learn UX: every `[data-midi-path]` element gets an orange/red
  outline so the user knows what's bindable. Clicks are NOT handled
  here — the bus's `beginLearnSession` already eats them at the
  capture phase and creates the binding using the current modal spec.

  We render at the App level so we float above panels, sliders, etc.
-->
<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte';
  import { mediaPipeBus, type MediaPipeBinding } from '../mediapipe/mediaPipeBus';

  interface OverlayItem {
    path: string;
    label: string;
    rect: DOMRect;
    clipRect: DOMRect;
    element: HTMLElement;
    visible: boolean;
  }

  let active = false;
  let items: OverlayItem[] = [];
  let revision = 0;
  let bindings: MediaPipeBinding[] = mediaPipeBus.list();
  let unsubLearn = () => {};
  let unsubBindings = () => {};
  let rafId: number | null = null;
  let scanTimer: ReturnType<typeof setInterval> | null = null;

  // Walk up the DOM intersecting the element's rect with every clipping
  // ancestor — same logic MidiOverlay uses so outlines don't ghost past
  // scrollable panels.
  function computeClipRect(el: HTMLElement, rawRect: DOMRect): DOMRect {
    let left = rawRect.left, top = rawRect.top;
    let right = rawRect.right, bottom = rawRect.bottom;
    let node: HTMLElement | null = el.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const s = getComputedStyle(node);
      const clipsX = s.overflowX === 'hidden' || s.overflowX === 'auto' || s.overflowX === 'scroll';
      const clipsY = s.overflowY === 'hidden' || s.overflowY === 'auto' || s.overflowY === 'scroll';
      if (clipsX || clipsY) {
        const r = node.getBoundingClientRect();
        if (clipsX) { left = Math.max(left, r.left); right = Math.min(right, r.right); }
        if (clipsY) { top = Math.max(top, r.top); bottom = Math.min(bottom, r.bottom); }
      }
      node = node.parentElement;
    }
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  }

  function isVisible(el: HTMLElement, clip: DOMRect): boolean {
    let node: HTMLElement | null = el;
    while (node) {
      if (node.tagName === 'DETAILS' && !(node as HTMLDetailsElement).open) return false;
      if (node.offsetParent === null && node !== document.body && node !== document.documentElement) {
        const s = getComputedStyle(node);
        if (s.position !== 'fixed' && s.display === 'none') return false;
      }
      node = node.parentElement;
    }
    if (clip.width <= 0 || clip.height <= 0) return false;
    // Hit-test the centre: in modes that stack panels (VJ on top of MAP),
    // an element can be in the DOM and laid out normally but visually
    // *covered* by a later overlay. If `elementFromPoint` doesn't land
    // on our target (or a relative), it's covered — don't outline it,
    // because clicking it would hit the overlaying element instead and
    // the user can't actually see the slider anyway. Note: we test the
    // *centre* of the layout rect rather than imposing a minimum size,
    // because some real targets are 3px tall (range sliders) — a fixed
    // 4×4 floor would silently filter them out.
    const cx = clip.left + clip.width / 2;
    const cy = clip.top + clip.height / 2;
    const hit = document.elementFromPoint(cx, cy) as HTMLElement | null;
    if (!hit) return false;
    if (hit === el) return true;
    if (el.contains(hit)) return true;       // hit a descendant (e.g. slider thumb)
    if (hit.contains(el)) return true;       // hit an ancestor (rare; e.g. label wrapping input)
    return false;
  }

  function scan() {
    const els = document.querySelectorAll<HTMLElement>('[data-midi-path]');
    const next: OverlayItem[] = [];
    els.forEach(el => {
      const path = el.dataset.midiPath!;
      const label = el.dataset.midiLabel || path;
      const rect = el.getBoundingClientRect();
      const clip = computeClipRect(el, rect);
      next.push({ path, label, rect, clipRect: clip, element: el, visible: isVisible(el, clip) });
    });
    items = next;
    revision++;
  }

  // Cheap re-position loop — only mutates clipRect when geometry actually
  // shifts, so the {#key} re-render only fires when something moved.
  let rafSkip = 0;
  function tickPositions() {
    if (!active) return;
    rafSkip++;
    if (rafSkip < 4) { rafId = requestAnimationFrame(tickPositions); return; }
    rafSkip = 0;
    let dirty = false;
    for (const it of items) {
      const r = it.element.getBoundingClientRect();
      const c = computeClipRect(it.element, r);
      const v = isVisible(it.element, c);
      if (Math.abs(r.left - it.rect.left) > 1 || Math.abs(r.top - it.rect.top) > 1
        || Math.abs(r.width - it.rect.width) > 1 || Math.abs(r.height - it.rect.height) > 1
        || v !== it.visible) {
        it.rect = r; it.clipRect = c; it.visible = v; dirty = true;
      }
    }
    if (dirty) revision++;
    rafId = requestAnimationFrame(tickPositions);
  }

  function bindingsForPath(path: string): MediaPipeBinding[] {
    return bindings.filter(b => b.path === path);
  }

  onMount(() => {
    unsubLearn = mediaPipeBus.subscribeLearn(v => {
      active = v;
      if (v) {
        tick().then(() => {
          scan();
          rafSkip = 0;
          rafId = requestAnimationFrame(tickPositions);
          scanTimer = setInterval(scan, 1500);
        });
      } else {
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        if (scanTimer) { clearInterval(scanTimer); scanTimer = null; }
        items = [];
        revision++;
      }
    });
    unsubBindings = mediaPipeBus.subscribe(bs => { bindings = bs; revision++; });
  });

  onDestroy(() => {
    try { unsubLearn(); } catch {}
    try { unsubBindings(); } catch {}
    if (rafId) cancelAnimationFrame(rafId);
    if (scanTimer) clearInterval(scanTimer);
  });
</script>

{#if active}
  {#key revision}
    <div class="mp-learn-layer" aria-hidden="true">
      {#each items as item (item.path + ':' + item.rect.left + ':' + item.rect.top)}
        {#if item.visible}
          {@const existing = bindingsForPath(item.path)}
          <div
            class="mp-learn-target"
            class:bound={existing.length > 0}
            style:left="{item.clipRect.left}px"
            style:top="{item.clipRect.top}px"
            style:width="{item.clipRect.width}px"
            style:height="{item.clipRect.height}px"
            title={existing.length > 0
              ? `${item.label} — bound to: ${existing.map(b => b.signalId).join(', ')}`
              : `Click to bind: ${item.label}`}
          >
            {#if existing.length > 0}
              <span class="mp-learn-tag">{existing.length === 1 ? existing[0].signalId : `×${existing.length}`}</span>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  {/key}
{/if}

<style>
  .mp-learn-layer {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 99990;  /* above panels, below the floating modal */
  }
  .mp-learn-target {
    position: fixed;
    border: 2px solid var(--accent-primary, #FF6B6B);
    background: rgba(255, 107, 107, 0.08);
    border-radius: 3px;
    box-shadow: 0 0 12px rgba(255, 107, 107, 0.35), inset 0 0 6px rgba(255, 107, 107, 0.2);
    pointer-events: none;
    transition: background-color 0.12s ease, border-color 0.12s ease;
  }
  .mp-learn-target.bound {
    border-color: #ffd166;
    background: rgba(255, 209, 102, 0.10);
    box-shadow: 0 0 12px rgba(255, 209, 102, 0.35), inset 0 0 6px rgba(255, 209, 102, 0.2);
  }
  .mp-learn-tag {
    position: absolute;
    top: -8px;
    right: 4px;
    background: #ffd166;
    color: #1a0e08;
    padding: 1px 5px;
    border-radius: 3px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 9px;
    font-weight: 700;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    white-space: nowrap;
  }
</style>
