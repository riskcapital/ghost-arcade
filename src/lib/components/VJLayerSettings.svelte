<script lang="ts">
  import { vjClipLauncher, type VJDeck, type VJLayerState } from '../stores/vjClipLauncher';
  import VJAutopilotControls from './VJAutopilotControls.svelte';

  export let layer: VJLayerState;
  export let index: number;
  export let deck: VJDeck = 'A';
  export let columns = 8;

  let tray: HTMLDivElement;
  let open = false;
  let left = 0;
  let top = 0;

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    left = Math.max(8, Math.min(window.innerWidth - 268, rect.left));
    top = Math.min(window.innerHeight - 120, rect.bottom + 6);
    tray.togglePopover();
  }
</script>

<div class="strip-tools">
  <button class:active={!!layer.autopilot && !layer.autopilotPaused} aria-pressed={!!layer.autopilot && !layer.autopilotPaused}
    aria-label="Autopilot for layer {index + 1} on Deck {deck}" title="Toggle Autopilot (keeps its settings)"
    data-midi-path="{deck === 'B' ? 'vj-b' : 'vj'}:{index}:autopilot" data-midi-label="Deck {deck} L{index + 1} Autopilot" data-midi-mode="toggle"
    onclick={(e) => { e.stopPropagation(); vjClipLauncher.toggleLayerAutopilot(index, deck); }}>A</button>
  <button class:active={open} aria-expanded={open} aria-label="Autopilot settings for layer {index + 1} on Deck {deck}" title="Autopilot settings" onclick={toggle}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>
  </button>
</div>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div bind:this={tray} popover="auto" class="settings-tray" style:left="{left}px" style:top="{top}px"
  onmousedown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}
  ontoggle={(event) => { open = (event as ToggleEvent).newState === 'open'; }}>
  <header><strong>Layer {index + 1} <span>· Deck {deck}</span></strong><button aria-label="Close" onclick={() => tray.hidePopover()}>×</button></header>
  <p class="status">{layer.autopilot && !layer.autopilotPaused ? 'Autopilot enabled' : 'Autopilot off'}</p>
  <VJAutopilotControls value={layer.autopilot} {columns} onChange={(value) => vjClipLauncher.setLayerAutopilot(index, value, deck)} />
</div>

<style>
  .strip-tools { display: flex; gap: 3px; }
  .strip-tools button {
    width: 20px; height: 18px; padding: 0; display: grid; place-items: center;
    background: transparent; color: var(--ga-text-dim, #9aa); border: 1px solid var(--ga-border, #333);
    border-radius: 4px; font-size: 10px; font-weight: 700; cursor: pointer;
  }
  .strip-tools button:hover { color: var(--ga-text, #eee); }
  .strip-tools button.active { color: #05070a; background: var(--ga-accent, #4aa3ff); border-color: var(--ga-accent, #4aa3ff); }
  .settings-tray {
    position: fixed; inset: auto; margin: 0; width: 260px; padding: 10px 12px;
    background: var(--ga-surface, #16181d); color: var(--ga-text, #e8e8e8);
    border: 1px solid var(--ga-border, #333); border-radius: 10px; box-shadow: 0 12px 32px rgba(0, 0, 0, 0.55);
  }
  header { display: flex; justify-content: space-between; align-items: center; font-size: 12px; }
  header span { color: var(--ga-text-dim, #9aa); font-weight: 400; }
  header button { background: none; border: 0; color: inherit; font-size: 16px; cursor: pointer; }
  .status { margin: 6px 0 0; font-size: 11px; color: var(--ga-text-dim, #9aa); }
</style>
