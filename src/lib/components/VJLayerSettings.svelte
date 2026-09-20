<script lang="ts">
  import { vjClipLauncher, type VJDeck, type VJLayerState } from '../stores/vjClipLauncher';
  import VJAutopilotControls from './VJAutopilotControls.svelte';
  import VJTransitionControls from './VJTransitionControls.svelte';
  export let layer: VJLayerState;
  export let index: number;
  export let deck: VJDeck;
  export let columns: number;
  let tray: HTMLDivElement;
  let open = false;
  let left = 0;
  let top = 0;
  function toggle(event: MouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    left = Math.max(8, Math.min(rect.left, window.innerWidth - 320));
    top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 430));
    tray.togglePopover();
  }
</script>

<div class="strip-tools">
  <button class:active={layer.locked} aria-pressed={layer.locked === true}
    aria-label="Lock layer {index + 1} on Deck {deck}" title="Lock content — faders and effects remain available"
    onclick={(e) => { e.stopPropagation(); vjClipLauncher.setLayerLaunchProtection(index, { locked: !layer.locked }, deck); }}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">
      <rect x="5" y="10" width="14" height="11" rx="2"/><path d={layer.locked ? 'M8 10V6a4 4 0 0 1 8 0v4' : 'M8 10V6a4 4 0 0 1 8 0'}/><path d="M12 14v3"/>
    </svg>
  </button>
  <button class:active={!!layer.autopilot && !layer.autopilotPaused} aria-pressed={!!layer.autopilot && !layer.autopilotPaused}
    aria-label="Autopilot for layer {index + 1} on Deck {deck}" title="Toggle Autopilot — retains settings"
    data-midi-path="{deck === 'B' ? 'vj-b' : 'vj'}:{index}:autopilot" data-midi-label="Deck {deck} L{index + 1} Autopilot" data-midi-mode="toggle"
    onclick={(e) => { e.stopPropagation(); vjClipLauncher.toggleLayerAutopilot(index, deck); }}>A</button>
  <button class:active={open} aria-expanded={open} aria-label="Settings for layer {index + 1} on Deck {deck}" title="Layer settings" onclick={toggle}>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>
  </button>
</div>
<div bind:this={tray} popover="auto" class="settings-tray" style:left="{left}px" style:top="{top}px" style:max-height="calc(100vh - {top + 8}px)"
  ontoggle={(event) => { open = (event as ToggleEvent).newState === 'open'; }}>
  <header><strong>Layer {index + 1} <span>· Deck {deck}</span></strong><button aria-label="Close layer settings" onclick={() => tray.hidePopover()}>×</button></header>
  <p class="status">{layer.autopilot && !layer.autopilotPaused ? 'Autopilot enabled' : 'Autopilot off'}</p>
  <VJAutopilotControls value={layer.autopilot} {columns} onChange={(value) => vjClipLauncher.setLayerAutopilot(index, value, deck)} />
  <label title="Keep this layer playing when a column is launched."><input type="checkbox" checked={layer.ignoreColumnTrigger === true} onchange={(e) => vjClipLauncher.setLayerLaunchProtection(index, { ignoreColumnTrigger: e.currentTarget.checked }, deck)} />Ignore Column Trigger</label>
  <label title="Restart the current video when this layer's fader rises from zero."><input type="checkbox" checked={layer.faderStart === true} onchange={(e) => vjClipLauncher.setLayerFaderStart(index, e.currentTarget.checked, deck)} />Fader Start</label>
  <fieldset class="audio-settings"><legend>Layer audio</legend>
    <label>Volume <input type="range" min="0" max="1" step="0.01" value={layer.audioVolume ?? 1} aria-label="Layer audio volume"
      oninput={(e) => vjClipLauncher.setLayerAudio(index, { audioVolume: +e.currentTarget.value }, deck)}
      data-midi-path="{deck === 'B' ? 'vj-b' : 'vj'}:{index}:audioVolume" data-midi-label="Layer audio volume" data-midi-min="0" data-midi-max="1" />{Math.round((layer.audioVolume ?? 1) * 100)}%</label>
    <label>Pan <input type="range" min="-1" max="1" step="0.01" value={layer.audioPan ?? 0} aria-label="Layer audio pan"
      oninput={(e) => vjClipLauncher.setLayerAudio(index, { audioPan: +e.currentTarget.value }, deck)}
      data-midi-path="{deck === 'B' ? 'vj-b' : 'vj'}:{index}:audioPan" data-midi-label="Layer audio pan" data-midi-min="-1" data-midi-max="1" /></label>
  </fieldset>
  <VJTransitionControls contextKey={`${deck}:${index}`} duration={layer.transitionDuration} style={layer.transitionStyle} onChange={(patch) => vjClipLauncher.setLayerTransition(index, patch, deck)} />
</div>

<style>
  .audio-settings { margin: 12px 0; padding: 8px; border: 1px solid #34363c; border-radius: 5px; }
  .audio-settings legend { font-size: 11px; color: #ada9a2; }
  .audio-settings input { min-width: 0; flex: 1; }
  .strip-tools { display:flex; align-items:center; justify-content:flex-end; gap:2px; }
  button { display:flex; align-items:center; justify-content:center; width:26px; height:26px; padding:0; border:1px solid var(--border-color, #343438); border-radius:5px; background:var(--bg-secondary, #1b1b20); color:var(--text-secondary, #ada9a2); cursor:pointer; }
  button:hover, button.active { color:var(--ga-selection-ink, #e0e8ff); background:var(--ga-selection-bg, #172a5b); border-color:var(--ga-selection-line, #3d59b8); }
  .strip-tools button { width:20px; height:20px; min-width:20px; min-height:20px; border-radius:3px; font-size:10px; font-weight:700; }
  .strip-tools svg { width:12px; height:12px; }
  .settings-tray { position:fixed; margin:0; width:304px; box-sizing:border-box; max-width:calc(100vw - 16px); max-height:calc(100vh - 16px); overflow:auto; padding:12px; border:1px solid var(--ga-selection-line, #3d59b8); border-radius:8px; background:var(--bg-primary, #16140f); color:var(--text-primary, #e8e8e8); box-shadow:0 12px 40px #0009; font-family:inherit; font-size:var(--ga-type-control, 12px); }
  header { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  header strong { font-size:13px; font-weight:650; } header span { color:var(--text-secondary, #ada9a2); font-weight:500; }
  label { display:flex; align-items:center; gap:8px; min-height:32px; }
</style>
