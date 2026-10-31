<script lang="ts">
  /**
   * The tempo strip (level meter, beat lights, Tap, BPM, audio tempo) behind
   * one top-bar button that shows the current BPM. The strip stays mounted
   * while the menu is closed, so tap shortcuts and MIDI on its controls keep
   * working; the menu moves to <body> so the bar's scaling never shrinks it.
   */
  import { audioBpm, audioIsActive, audioManualBpm } from '../stores/audio';
  import { portal } from '../utils/portal';
  import AudioMeterPanel from './AudioMeterPanel.svelte';

  let open = $state(false);
  let button = $state<HTMLButtonElement | null>(null);
  let menu = $state<HTMLDivElement | null>(null);
  let pos = $state({ top: 0, left: 0 });

  const waiting = $derived($audioManualBpm === null && !$audioIsActive);
  const bpm = $derived(waiting ? 0 : Math.round($audioBpm));

  function toggle() {
    open = !open;
    if (!open || !button) return;
    const r = button.getBoundingClientRect();
    pos = { top: Math.round(r.bottom + 6), left: Math.round(r.left) };
  }

  // Keep it on screen, and close on a click elsewhere or Escape.
  $effect(() => {
    if (!open || !menu) return;
    const w = menu.offsetWidth;
    if (pos.left + w > window.innerWidth - 8) pos = { ...pos, left: Math.max(8, window.innerWidth - 8 - w) };
    const away = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu?.contains(t) || button?.contains(t)) return;
      // The meter's own tweaks popover lives at <body> too.
      if ((t as HTMLElement).closest?.('.amp-popover')) return;
      open = false;
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') open = false; };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('keydown', key);
    };
  });
</script>

<button class="tempo-btn" class:open bind:this={button} onclick={toggle} aria-expanded={open} aria-haspopup="true" title="Tempo: tap, set the BPM, follow the audio">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9 3h6l3 18H6z" /><path d="M12 15l5-9" />
  </svg>
  <span class="tempo-value">{bpm > 0 ? bpm : '—'}</span>
  <span class="tempo-unit">BPM</span>
</button>

<div class="tempo-home">
  <div class="tempo-menu" class:open use:portal bind:this={menu} style="top:{pos.top}px; left:{pos.left}px" role="dialog" aria-label="Tempo">
    <AudioMeterPanel alwaysShow />
  </div>
</div>

<style>
  .tempo-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--ga-bar-control-h, 30px);
    padding: 0 10px;
    box-sizing: border-box;
    flex: 0 0 auto;
    white-space: nowrap;
    background: var(--ga-card, #13161c);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-soft, 8px);
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-body, 13px);
    cursor: pointer;
  }
  .tempo-btn:hover, .tempo-btn.open { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); color: var(--ga-ink-0, #f2ede4); }
  .tempo-value {
    min-width: 3ch;
    text-align: right;
    font-family: var(--ga-font-mono, ui-monospace);
    font-variant-numeric: tabular-nums;
    color: var(--ga-ink-0, #f2ede4);
  }
  .tempo-unit { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .tempo-home { display: contents; }
  .tempo-menu {
    position: fixed;
    z-index: 4000;
    display: none;
    align-items: center;
    padding: 8px 10px;
    background: var(--ga-panel, #100f0d);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5);
  }
  .tempo-menu.open { display: flex; }
</style>
