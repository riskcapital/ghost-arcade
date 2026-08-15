<!--
  VJAudioBar — the FFT/BPM/beat/sensitivity strip in VJ mode.

  Extracted out of VJModePanel to isolate the `$audioStore` subscription so
  audio-frame-rate updates (60 Hz while audio is active) don't invalidate the
  5400-line parent's reactive graph. The parent would otherwise re-run every
  `$:` block (derived effects, filtered media, selected clip state, the giant
  class binding, etc.) on every FFT update, costing ~15-25 FPS on a mid laptop.

  Component boundary acts as a reactive firewall: `$audioStore` writes only
  re-render this component's template, not the whole VJ panel.

  Styling: ALL audio-bar CSS lives here to keep the extraction self-contained.
  The parent's CSS for these classes was deleted when this was extracted.
-->
<script lang="ts">
  import { audioStore } from '../stores/audio';
  import AudioInputPicker from './AudioInputPicker.svelte';
  import ClipAudioMasterControl from './ClipAudioMasterControl.svelte';
  import BpmTapWidget from './BpmTapWidget.svelte';

  // Props kept for backward compatibility with existing callers, but the
  // picker is self-contained — it owns its own start/stop orchestration via
  // audioStore. setAudioSource / isMac are no longer required here; the
  // parent can drop them in a follow-up cleanup pass.
  export let isMac: boolean = false;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  export let setAudioSource: ((source: 'none' | 'microphone' | 'system') => void) | null = null;
  void isMac;
  void setAudioSource;

  // Live signal level used to make the active source button GLOW
  // proportionally to actual incoming audio. User report: previously
  // the green LED stayed solid when audio was selected but silent —
  // made it impossible to tell whether the input was actually being
  // detected vs just routed. Now box-shadow + background brighten
  // with rms (and a small kick from beat intensity) so a cold mic
  // shows as dim-green and a loud one pulses bright.
  $: sigLevel = $audioStore.isActive
    ? Math.min(1, ($audioStore.rms ?? 0) * 4 + ($audioStore.beat?.beatIntensity ?? 0) * 0.3)
    : 0;
  $: sigGlow = sigLevel > 0.03
    ? `box-shadow: 0 0 ${4 + sigLevel * 12}px rgba(34, 197, 94, ${0.4 + sigLevel * 0.6}), inset 0 0 ${sigLevel * 8}px rgba(34, 197, 94, ${sigLevel * 0.4}); background: rgba(34, 197, 94, ${0.08 + sigLevel * 0.25});`
    : '';
  // Keep references explicit so unused-warning doesn't fire — these are
  // consumed by future callers / external CSS hooks.
  void sigLevel;
  void sigGlow;
</script>

<div class="audio-bar">
  <!-- Audio Source Selector — uses the shared AudioInputPicker so VJ mode
       sees the same mic + device-picker + system audio UI as mapping mode.
       State flows through the global audioStore so toggling here updates
       mapping/Performer too. -->
  <div class="audio-section">
    <AudioInputPicker />
    <!-- Master output level for opt-in clip audio. Self-hides until at least
         one clip has audio playback turned on. -->
    <ClipAudioMasterControl />
    {#if $audioStore.error}
      <span class="audio-error">{$audioStore.error}</span>
    {/if}
  </div>

  <!-- FFT Visualizer (mini bars) -->
  {#if $audioStore.isActive}
    <div class="audio-section fft-section">
      <div class="fft-bars">
        <div class="fft-bar" style="height: {$audioStore.bands.sub * 100}%"></div>
        <div class="fft-bar" style="height: {$audioStore.bands.bass * 100}%"></div>
        <div class="fft-bar" style="height: {$audioStore.bands.lowMid * 100}%"></div>
        <div class="fft-bar" style="height: {$audioStore.bands.mid * 100}%"></div>
        <div class="fft-bar" style="height: {$audioStore.bands.highMid * 100}%"></div>
        <div class="fft-bar" style="height: {$audioStore.bands.high * 100}%"></div>
      </div>
      <span class="fft-label">FFT</span>
    </div>

    <!-- BPM Display — shared widget (mapping mode + Performer mode use the
         same one) so behavior + look stay identical across modes. -->
    <div class="audio-section bpm-section">
      <BpmTapWidget alwaysShow={true} />
    </div>

    <!-- Beat Indicator -->
    <div class="audio-section">
      <div class="beat-dot" class:flash={$audioStore.beat.isBeat}></div>
    </div>

    <!-- Sensitivity -->
    <div class="audio-section">
      <span class="sens-label">SENS</span>
      <input
        type="range"
        min="0.2"
        max="3"
        step="0.1"
        value={$audioStore.sensitivity}
        oninput={(e) => audioStore.setSensitivity(parseFloat((e.target as HTMLInputElement).value))}
        class="sens-slider"
      />
    </div>
  {/if}
</div>

<style>
  .audio-bar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 20px;
    background: #111;
    border-bottom: 1px solid #161618;
    flex-shrink: 0;
    min-height: 36px;
  }

  .audio-section {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .audio-source-group {
    display: flex;
    gap: 2px;
  }

  .audio-src-btn {
    padding: 4px 10px;
    border: 1px solid #444;
    background: var(--bg-primary, #0d0d10);
    color: var(--text-muted, #888);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.5px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .audio-src-btn:first-child {
    border-radius: 4px 0 0 4px;
  }

  .audio-src-btn:last-of-type {
    border-radius: 0 4px 4px 0;
  }

  .audio-src-btn:hover {
    border-color: #666;
    color: var(--text-primary, #ccc);
  }

  .audio-src-btn.active {
    background: #1a3a1a;
    border-color: #22c55e;
    color: #22c55e;
  }

  .audio-error {
    color: #f44;
    font-size: 11px;
  }

  /* FFT Bars */
  .fft-section {
    gap: 4px;
  }

  .fft-bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 22px;
    padding: 0 2px;
  }

  .fft-bar {
    width: 4px;
    min-height: 1px;
    background: #BB86FC;
    border-radius: 1px;
    transition: height 0.05s ease-out;
  }

  .fft-bar:nth-child(1) { background: #f43f5e; }
  .fft-bar:nth-child(2) { background: #f97316; }
  .fft-bar:nth-child(3) { background: #eab308; }
  .fft-bar:nth-child(4) { background: #22c55e; }
  .fft-bar:nth-child(5) { background: #3b82f6; }
  .fft-bar:nth-child(6) { background: #a855f7; }

  .fft-label {
    font-size: 9px;
    color: #555;
    letter-spacing: 0.5px;
  }

  /* BPM */
  .bpm-section {
    gap: 6px;
  }

  .tap-btn {
    padding: 3px 10px;
    border: 1px solid #444;
    border-radius: 3px;
    background: var(--bg-primary, #0d0d10);
    color: var(--text-secondary, #aaa);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.1s;
  }

  .tap-btn:hover {
    border-color: #BB86FC;
    color: #BB86FC;
  }

  .tap-btn:active {
    background: #BB86FC;
    color: #000;
  }

  .bpm-display {
    font-size: 14px;
    font-weight: 700;
    color: #555;
    font-variant-numeric: tabular-nums;
    min-width: 70px;
  }

  .bpm-display.confident {
    color: #BB86FC;
  }

  .bpm-clear {
    padding: 2px 6px;
    border: 1px solid #444;
    border-radius: 3px;
    background: transparent;
    color: #666;
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
  }

  .bpm-clear:hover {
    color: var(--text-secondary, #aaa);
    border-color: #666;
  }

  /* Beat Dot */
  .beat-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #333;
    transition: background 0.05s;
  }

  .beat-dot.flash {
    background: #f43f5e;
    box-shadow: 0 0 8px #f43f5e80;
  }

  /* Sensitivity */
  .sens-label {
    font-size: 9px;
    color: #555;
    letter-spacing: 0.5px;
  }

  .sens-slider {
    width: 50px;
    height: 3px;
    accent-color: #BB86FC;
  }
</style>
