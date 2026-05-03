<script lang="ts">
  /**
   * MobileTempoStrip — TAP TEMPO + live BPM readout + quantization grid
   * selector. Pulses on every detected beat so the performer has a
   * visual reference while triggering clips.
   *
   * Tap-tempo and quant set are exposed as one-shot WS messages that the
   * desktop's audio + clip-launcher stores actually consume.
   */

  export let bpm: number = 0;
  export let manualBPM: number | null = null;
  // Beat-pulse state — bumped via the dedicated `beat_pulse` WS channel.
  // We watch `beatPulseCount` (monotonic) for rising changes to trigger
  // the visual flash, and `beatPulseIntensity` (0..1, decays to 0 after
  // ~80ms) to scale the brightness. (v17.1 replaces the old `beat: bool`
  // prop, which was unreliable because beats are 10ms momentary and the
  // state-sync was throttled.)
  export let beatPulseCount: number = 0;
  export let beatPulseIntensity: number = 0;
  export let quantization: string = 'off';
  export let pendingTriggerCount: number = 0;
  export let onTap: () => void = () => {};
  export let onClearManualBPM: () => void = () => {};
  export let onQuantizationChange: (grid: string) => void = () => {};
  export let onClearPending: () => void = () => {};
  export let compact: boolean = false;

  // Quantization grid choices. 'off' = instant, then musical subdivisions.
  // Keep the labels short for mobile where horizontal real estate is tight.
  const QUANT_OPTIONS = [
    { value: 'off', label: 'OFF' },
    { value: '1/16', label: '1/16' },
    { value: '1/8', label: '1/8' },
    { value: '1/4', label: '1/4' },
    { value: '1/2', label: '1/2' },
    { value: '1', label: '1 BAR' },
    { value: '2', label: '2 BAR' },
    { value: '4', label: '4 BAR' },
    { value: '8', label: '8 BAR' },
  ];

  // Tap pulse animation — re-render the .pulse-ring on every beat by
  // keying on the monotonic beatPulseCount. `beat` boolean is gone since
  // it was lost across the throttled state sync.
  $: beating = beatPulseIntensity > 0;

  $: displayBpm = manualBPM != null ? manualBPM : bpm;
  $: bpmRounded = displayBpm > 0 ? displayBpm.toFixed(1) : '--';
  $: bpmSource = manualBPM != null ? 'TAP' : (bpm > 0 ? 'AUTO' : '--');
</script>

<div class="tempo-strip" class:compact>
  <!-- TAP button — large, central, pulses on beat -->
  <button
    class="tap-btn"
    class:beating
    onpointerdown={(e) => { e.preventDefault(); onTap(); }}
    title="Tap tempo (4+ taps in time)"
  >
    {#key beatPulseCount}
      <span class="pulse-ring" class:firing={beating}></span>
    {/key}
    <span class="tap-label">TAP</span>
  </button>

  <!-- BPM readout -->
  <div class="bpm-readout">
    <span class="bpm-num" class:beating>{bpmRounded}</span>
    <div class="bpm-meta">
      <span class="bpm-unit">BPM</span>
      <span class="bpm-source" class:manual={manualBPM != null}>{bpmSource}</span>
    </div>
    {#if manualBPM != null}
      <button
        class="bpm-clear"
        onclick={onClearManualBPM}
        title="Clear manual BPM and follow audio analysis"
      >×</button>
    {/if}
  </div>

  <!-- Quantization grid -->
  <div class="quant-block">
    <span class="quant-label">QUANT</span>
    <select
      class="quant-select"
      value={quantization}
      onchange={(e) => onQuantizationChange((e.target as HTMLSelectElement).value)}
    >
      {#each QUANT_OPTIONS as opt}
        <option value={opt.value}>{opt.label}</option>
      {/each}
    </select>
    {#if pendingTriggerCount > 0}
      <button
        class="pending-pill"
        onclick={onClearPending}
        title="Clear pending quantized triggers"
      >
        {pendingTriggerCount} ⌛
      </button>
    {/if}
  </div>
</div>

<style>
  .tempo-strip {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 10px;
    border-top: 2px solid #00ffaa;
    min-width: 0;
  }
  /* Compact mode (used in the new tablet bottom row): drop our own
     background / border / radius so we sit flush against the macros
     to our left (no double-border gap). The parent .bc-slot already
     gives us the divider line if any. Padding tightened to fit 64px
     bottom-row height. */
  .tempo-strip.compact {
    padding: 4px 6px;
    gap: 4px;
    background: transparent;
    border: none;
    border-top: none;
    border-radius: 0;
  }

  /* ── TAP button ── */
  .tap-btn {
    position: relative;
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    border-radius: 50%;
    background: radial-gradient(circle at 40% 40%, rgba(0, 255, 170, 0.18), rgba(0, 255, 170, 0.04));
    border: 2px solid rgba(0, 255, 170, 0.4);
    color: #00ffaa;
    font-weight: 800;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    -webkit-tap-highlight-color: transparent;
    /* Prevent iOS double-tap-zoom + scroll-cancel from racing the
       pointerdown handler. preventDefault on the event is also done
       in the handler for belt-and-braces. */
    touch-action: none;
    user-select: none;
    -webkit-user-select: none;
    transition: transform 0.08s, box-shadow 0.12s;
  }
  .tap-btn:active {
    transform: scale(0.92);
    background: radial-gradient(circle at 40% 40%, rgba(0, 255, 170, 0.4), rgba(0, 255, 170, 0.1));
  }
  .tap-btn.beating {
    box-shadow: 0 0 20px rgba(0, 255, 170, 0.7), inset 0 0 12px rgba(0, 255, 170, 0.3);
    border-color: #00ffaa;
  }
  .tap-label {
    font-size: 11px;
    letter-spacing: 1px;
    text-shadow: 0 0 8px #00ffaa;
    z-index: 2;
  }

  .pulse-ring {
    position: absolute;
    inset: -4px;
    border-radius: 50%;
    border: 2px solid #00ffaa;
    opacity: 0;
    pointer-events: none;
  }
  .pulse-ring.firing {
    animation: pulse-out 0.4s ease-out;
  }
  @keyframes pulse-out {
    0% { opacity: 0.8; transform: scale(0.95); }
    100% { opacity: 0; transform: scale(1.4); }
  }

  /* ── BPM readout ── */
  .bpm-readout {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    padding: 0 6px;
  }
  .bpm-num {
    font-size: 22px;
    font-weight: 800;
    color: #fff;
    font-variant-numeric: tabular-nums;
    letter-spacing: -1px;
    transition: color 0.1s;
    min-width: 56px;
    text-align: right;
  }
  .bpm-num.beating {
    color: #00ffaa;
    text-shadow: 0 0 12px rgba(0, 255, 170, 0.6);
  }
  .bpm-meta {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    line-height: 1;
  }
  .bpm-unit {
    font-size: 8px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 1px;
  }
  .bpm-source {
    font-size: 8px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.3);
    letter-spacing: 0.5px;
  }
  .bpm-source.manual {
    color: #ffaa00;
  }
  .bpm-clear {
    width: 18px;
    height: 18px;
    border: 1px solid rgba(255, 170, 0, 0.3);
    border-radius: 9px;
    background: rgba(255, 170, 0, 0.08);
    color: #ffaa00;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
    padding: 0;
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
  }

  /* ── Quantization ── */
  .quant-block {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 1;
    min-width: 0;
    padding-left: 4px;
    border-left: 1px solid rgba(255, 255, 255, 0.06);
  }
  .quant-label {
    font-size: 8px;
    font-weight: 800;
    color: rgba(255, 255, 255, 0.4);
    letter-spacing: 1px;
    flex-shrink: 0;
  }
  .quant-select {
    flex: 1;
    min-width: 60px;
    padding: 4px 4px;
    background: #111;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: #ddd;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    text-align: center;
    -webkit-appearance: none;
  }
  .quant-select:focus { border-color: #00ffaa; outline: none; }

  .pending-pill {
    padding: 2px 6px;
    border: 1px solid rgba(255, 170, 0, 0.4);
    border-radius: 10px;
    background: rgba(255, 170, 0, 0.12);
    color: #ffaa00;
    font-size: 10px;
    font-weight: 700;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    flex-shrink: 0;
    animation: pending-pulse 1s ease-in-out infinite;
  }
  @keyframes pending-pulse {
    0%, 100% { box-shadow: 0 0 4px rgba(255, 170, 0, 0.3); }
    50% { box-shadow: 0 0 12px rgba(255, 170, 0, 0.7); }
  }
</style>
