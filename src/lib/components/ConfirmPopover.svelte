<!--
  ConfirmPopover — small in-app confirm dialog used by Safe Mode.

  Subscribes to the global `confirmPrompt` store. When a prompt is
  pushed, this floats a tiny popover near the click anchor (clamped
  inside the viewport), with a destructive-red Delete button on the
  right and Cancel on the left. Esc + click-outside cancel. Enter
  confirms. Once the user picks, the prompt's `resolve` callback
  fires with true/false and the popover unmounts.

  Mounted exactly once at the App.svelte root so any module can call
  `await confirmIfSafeMode(...)` without wiring its own dialog UI.
-->
<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { confirmPrompt, type ConfirmPrompt } from '../stores/confirmPrompt';

  let popoverEl: HTMLDivElement | null = null;
  let confirmBtn: HTMLButtonElement | null = null;
  let placement = { left: 0, top: 0, arrowX: 0, arrowFromTop: true };

  // Reposition once the prompt is set so we can measure the popover
  // and clamp it inside the viewport. Anchor near the click, but
  // never let the box overflow off-screen — shift it back in.
  $: if ($confirmPrompt) {
    void positionFor($confirmPrompt);
  }

  async function positionFor(p: ConfirmPrompt) {
    await tick();
    if (!popoverEl) return;
    const rect = popoverEl.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Default: appear just below the click, centered horizontally.
    let left = p.anchorX - rect.width / 2;
    let top = p.anchorY + 14;
    let arrowFromTop = true;
    // If it would go off the bottom, flip above the click.
    if (top + rect.height + margin > vh) {
      top = p.anchorY - rect.height - 14;
      arrowFromTop = false;
    }
    // Clamp horizontally.
    left = Math.max(margin, Math.min(left, vw - rect.width - margin));
    top = Math.max(margin, Math.min(top, vh - rect.height - margin));
    // Arrow tracks the original anchor X relative to the popover.
    const arrowX = Math.max(12, Math.min(p.anchorX - left, rect.width - 12));
    placement = { left, top, arrowX, arrowFromTop };
    confirmBtn?.focus();
  }

  function dismiss(ok: boolean) {
    const p = $confirmPrompt;
    if (!p) return;
    confirmPrompt.set(null);
    p.resolve(ok);
  }

  function onKey(e: KeyboardEvent) {
    if (!$confirmPrompt) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      dismiss(false);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      dismiss(true);
    }
  }

  function onBackdropClick(e: MouseEvent) {
    // Click outside the popover body cancels.
    if (popoverEl && !popoverEl.contains(e.target as Node)) {
      dismiss(false);
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });
</script>

{#if $confirmPrompt}
  <!-- Transparent backdrop catches click-outside-to-cancel without dimming the UI. -->
  <div class="confirm-backdrop" onmousedown={onBackdropClick} role="presentation">
    <div
      bind:this={popoverEl}
      class="confirm-popover"
      class:destructive={$confirmPrompt.destructive}
      style="left: {placement.left}px; top: {placement.top}px;"
      role="alertdialog"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-subtitle"
      onmousedown={(e) => e.stopPropagation()}
    >
      <!-- Tiny arrow that points at the click anchor. -->
      <div
        class="confirm-arrow"
        class:from-top={placement.arrowFromTop}
        class:from-bottom={!placement.arrowFromTop}
        style="left: {placement.arrowX}px;"
      ></div>

      <div id="confirm-title" class="confirm-title">{$confirmPrompt.title}</div>
      {#if $confirmPrompt.subtitle}
        <div id="confirm-subtitle" class="confirm-subtitle">{$confirmPrompt.subtitle}</div>
      {/if}

      <div class="confirm-actions">
        <button class="confirm-btn cancel secondary-btn" onclick={() => dismiss(false)}>
          {$confirmPrompt.cancelLabel}
        </button>
        <button
          bind:this={confirmBtn}
          class="confirm-btn primary"
          class:danger={$confirmPrompt.destructive}
          class:primary-btn={!$confirmPrompt.destructive}
          onclick={() => dismiss(true)}
        >
          {$confirmPrompt.confirmLabel}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .confirm-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100000;
    background: transparent;
  }

  /* A small dialog: the same surface, type and button pair as the others,
     at control size. */
  .confirm-popover {
    position: fixed;
    min-width: 220px;
    max-width: 320px;
    padding: 12px;
    background: var(--ga-panel, #100f0d);
    color: var(--ga-ink-1, #ada9a2);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
    font-family: var(--ga-font-ui, 'Geist', system-ui, sans-serif);
    font-size: var(--ga-text-body);
    line-height: 1.4;
    animation: confirm-pop 90ms ease-out;
  }

  .confirm-popover.destructive {
    border-color: color-mix(in srgb, var(--ga-rec, #ff3b30) 40%, transparent);
  }

  .confirm-arrow {
    position: absolute;
    width: 10px;
    height: 10px;
    background: var(--ga-panel, #100f0d);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    transform: translateX(-50%) rotate(45deg);
  }
  .confirm-popover.destructive .confirm-arrow {
    border-color: color-mix(in srgb, var(--ga-rec, #ff3b30) 40%, transparent);
  }
  .confirm-arrow.from-top {
    /* Popover is below the anchor, so the arrow sits on its TOP edge. */
    top: -6px;
    border-right: none;
    border-bottom: none;
  }
  .confirm-arrow.from-bottom {
    /* Popover is above the anchor, so the arrow sits on its BOTTOM edge. */
    bottom: -6px;
    border-left: none;
    border-top: none;
  }

  .confirm-title {
    font-size: var(--ga-text-body);
    font-weight: var(--ga-weight-title);
    color: var(--ga-ink-0, #f2ede4);
    margin-bottom: 2px;
  }

  .confirm-subtitle {
    font-size: var(--ga-text-meta);
    color: var(--ga-ink-2, #89857e);
  }

  .confirm-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
  }

  .confirm-btn {
    box-sizing: border-box;
    height: var(--ga-control-h);
    padding: 0 12px;
    font: inherit;
    font-size: var(--ga-text-control);
    font-weight: var(--ga-weight-control);
    border-radius: var(--ga-r-hard, 5px);
    cursor: pointer;
    transition: color 80ms ease, border-color 80ms ease, filter 80ms ease;
  }
  .confirm-btn.cancel {
    background: var(--ga-raise, #26221c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-1, #ada9a2);
  }
  .confirm-btn.cancel:hover {
    color: var(--ga-ink-0, #f2ede4);
    border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24));
  }
  .confirm-btn.primary {
    background: var(--ga-ink-0, #f2ede4);
    border: 1px solid var(--ga-ink-0, #f2ede4);
    color: var(--ga-void, #0a0908);
  }
  .confirm-btn.primary:hover {
    filter: brightness(1.06);
  }
  .confirm-btn.primary.danger {
    background: var(--ga-rec, #ff3b30);
    border-color: var(--ga-rec, #ff3b30);
    color: #fff;
  }
  .confirm-btn:focus-visible {
    outline: 2px solid var(--ga-focus, #8aa4ff);
    outline-offset: 1px;
  }
  .confirm-btn.primary.danger:focus-visible {
    outline-color: color-mix(in srgb, var(--ga-rec, #ff3b30) 60%, transparent);
  }

  @keyframes confirm-pop {
    from { opacity: 0; transform: scale(0.94); }
    to { opacity: 1; transform: scale(1); }
  }
</style>
