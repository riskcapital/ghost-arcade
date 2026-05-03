<script lang="ts">
  /**
   * AudioMeterPanel — header-friendly meter strip showing live FFT bands,
   * tap tempo, current BPM, beat indicator, and an expandable "input tweaks"
   * popover with sensitivity / smoothing controls.
   *
   * Click anywhere on the meter (FFT bars) to open the popover. Used in the
   * VJ top bar so the user has one consolidated audio-monitoring + tuning
   * surface alongside the AudioInputPicker.
   *
   * Self-hides when no audio is active. The picker stays visible (it's a
   * separate component) so users can turn audio on without this widget
   * cluttering the header beforehand.
   */
  import { audioStore } from '../stores/audio';
  import BpmTapWidget from './BpmTapWidget.svelte';

  let showEq = false;
  let popoverEl: HTMLDivElement | null = null;
  let anchorEl: HTMLDivElement | null = null;

  function toggleEq() {
    showEq = !showEq;
  }

  function handleWindowClick(e: MouseEvent) {
    if (!showEq) return;
    const target = e.target as Node;
    if (popoverEl && popoverEl.contains(target)) return;
    if (anchorEl && anchorEl.contains(target)) return;
    showEq = false;
  }

  // Format a 0..1 value as a 2-decimal multiplier label
  function fmt(v: number): string { return v.toFixed(2) + '×'; }
</script>

<svelte:window onclick={handleWindowClick} />

{#if $audioStore.isActive}
  <div class="amp-strip" bind:this={anchorEl}>
    <!-- FFT bars — clickable to open the EQ popover -->
    <button class="amp-fft-btn" onclick={toggleEq}
      class:open={showEq}
      title="Audio input tweaks — click to open EQ / sensitivity / smoothing">
      <div class="amp-bars">
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.sub * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.bass * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.lowMid * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.mid * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.highMid * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.treble * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.air * 100)}%"></div>
        <div class="amp-bar" style="height: {Math.min(100, $audioStore.bands.presence * 100)}%"></div>
      </div>
      <span class="amp-eq-glyph" class:active={showEq}>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </span>
    </button>

    <!-- Beat indicator — generic energy-based beat -->
    <div class="amp-beat" class:flash={$audioStore.beat.isBeat} title="Beat detector"></div>

    <!-- Kick + snare onset dots — pulse on band-specific hits.
         Color-coded so users can see them firing independently of the
         generic beat dot. Useful when tuning kick/snare modulation routes. -->
    {#if $audioStore.kickSnare}
      <div class="amp-ks">
        <div class="amp-ks-dot amp-kick" class:flash={$audioStore.kickSnare.isKick} title="Kick onset (sub+bass)"></div>
        <div class="amp-ks-dot amp-snare" class:flash={$audioStore.kickSnare.isSnare} title="Snare onset (lowMid+highMid)"></div>
      </div>
    {/if}

    <!-- BPM + TAP -->
    <BpmTapWidget alwaysShow={true} />

    {#if $audioStore.error}
      <span class="amp-error" title={$audioStore.error}>⚠</span>
    {/if}

    <!-- Expandable EQ / input-tweaks popover -->
    {#if showEq}
      <div class="amp-popover" bind:this={popoverEl}>
        <div class="amp-popover-title">AUDIO INPUT TWEAKS</div>

        <div class="amp-row">
          <label class="amp-row-label">Sensitivity</label>
          <input type="range" min="0.2" max="3" step="0.05"
            value={$audioStore.sensitivity}
            oninput={(e) => audioStore.setSensitivity(parseFloat((e.target as HTMLInputElement).value))}
            class="amp-slider" />
          <span class="amp-row-value">{fmt($audioStore.sensitivity)}</span>
        </div>

        <div class="amp-row">
          <label class="amp-row-label">Smoothing</label>
          <input type="range" min="0" max="0.95" step="0.01"
            value={$audioStore.smoothing}
            oninput={(e) => audioStore.setSmoothing(parseFloat((e.target as HTMLInputElement).value))}
            class="amp-slider" />
          <span class="amp-row-value">{fmt($audioStore.smoothing)}</span>
        </div>

        <div class="amp-popover-hint">
          Sensitivity scales every band's response. Smoothing damps frame-to-frame
          jitter — higher values feel calmer, lower values feel snappier.
        </div>

        <!-- Per-band gain — 8 sliders, one per real frequency band. Each
             row shows the live level (left) + gain slider (right) so the
             user can boost the kick or cut harsh treble while watching
             the band react. -->
        <div class="amp-popover-subhead">
          <span>PER-BAND GAIN</span>
          <button class="amp-reset-btn" onclick={() => audioStore.resetBandGain()}
            title="Reset all band gains to 1×">RESET</button>
        </div>
        <div class="amp-bands-readout">
          {#each [
            { key: 'sub',      name: 'SUB',     cls: 'amp-band-sub'   },
            { key: 'bass',     name: 'BASS',    cls: 'amp-band-bass'  },
            { key: 'lowMid',   name: 'LO MID',  cls: 'amp-band-lomid' },
            { key: 'mid',      name: 'MID',     cls: 'amp-band-mid'   },
            { key: 'highMid',  name: 'HI MID',  cls: 'amp-band-himid' },
            { key: 'treble',   name: 'TREBLE',  cls: 'amp-band-treble' },
            { key: 'air',      name: 'AIR',     cls: 'amp-band-air'    },
            { key: 'presence', name: 'PRESENCE',cls: 'amp-band-presence' },
          ] as b (b.key)}
            <div class="amp-band">
              <span class="amp-band-name">{b.name}</span>
              <div class="amp-band-track">
                <div class="amp-band-fill {b.cls}" style="width:{($audioStore.bands as any)[b.key] * 100}%"></div>
              </div>
              <input type="range" min="0" max="3" step="0.05"
                class="amp-band-gain"
                value={($audioStore.bandGain as any)[b.key]}
                oninput={(e) => audioStore.setBandGain(b.key as any, parseFloat((e.target as HTMLInputElement).value))}
                title="Gain {(($audioStore.bandGain as any)[b.key] as number).toFixed(2)}×"
              />
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .amp-strip {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 0 4px;
  }

  /* FFT bars button */
  .amp-fft-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 4px;
    padding: 3px 6px 3px 6px;
    height: 28px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .amp-fft-btn:hover {
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }
  .amp-fft-btn.open {
    background: rgba(187, 134, 252, 0.12);
    border-color: rgba(187, 134, 252, 0.45);
  }

  .amp-bars {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    height: 18px;
  }
  .amp-bar {
    width: 4px;
    min-height: 1px;
    border-radius: 1px;
    transition: height 0.05s ease-out;
  }
  /* 8-band rainbow — matches the per-band readout in the popover */
  .amp-bar:nth-child(1) { background: #f43f5e; } /* sub */
  .amp-bar:nth-child(2) { background: #f97316; } /* bass */
  .amp-bar:nth-child(3) { background: #eab308; } /* lowMid */
  .amp-bar:nth-child(4) { background: #22c55e; } /* mid */
  .amp-bar:nth-child(5) { background: #14b8a6; } /* highMid */
  .amp-bar:nth-child(6) { background: #3b82f6; } /* treble */
  .amp-bar:nth-child(7) { background: #8b5cf6; } /* air */
  .amp-bar:nth-child(8) { background: #ec4899; } /* presence */

  .amp-eq-glyph {
    color: #888;
    line-height: 0;
    transition: transform 0.18s, color 0.18s;
  }
  .amp-eq-glyph.active {
    color: #BB86FC;
    transform: rotate(180deg);
  }

  .amp-beat {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #333;
    transition: background 0.06s, box-shadow 0.06s;
  }
  .amp-beat.flash {
    background: #f43f5e;
    box-shadow: 0 0 10px #f43f5e88;
  }

  .amp-error {
    color: #f44;
    font-size: 12px;
    padding: 0 4px;
  }

  /* Popover */
  .amp-popover {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    width: 280px;
    max-width: calc(100vw - 24px);
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 8px;
    padding: 12px 12px 10px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.55);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .amp-popover-title {
    font-size: 9px;
    font-weight: 700;
    color: #888;
    letter-spacing: 0.16em;
  }
  .amp-row {
    display: grid;
    grid-template-columns: 80px 1fr 48px;
    align-items: center;
    gap: 8px;
  }
  .amp-row-label {
    font-size: 11px;
    color: #ccc;
  }
  .amp-slider {
    width: 100%;
    accent-color: #BB86FC;
  }
  .amp-row-value {
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    font-size: 10px;
    color: #BB86FC;
    text-align: right;
  }
  .amp-popover-hint {
    font-size: 10px;
    color: #888;
    line-height: 1.4;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }

  /* Per-band readout (horizontal bars showing live levels) */
  .amp-bands-readout {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .amp-popover-subhead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 9px;
    font-weight: 700;
    color: #888;
    letter-spacing: 0.16em;
    padding-top: 4px;
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
  .amp-reset-btn {
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #aaa;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.12em;
    padding: 2px 6px;
    border-radius: 3px;
    cursor: pointer;
  }
  .amp-reset-btn:hover {
    color: #fff;
    border-color: rgba(255, 255, 255, 0.25);
  }

  .amp-band {
    display: grid;
    grid-template-columns: 60px 1fr 70px;
    align-items: center;
    gap: 6px;
  }
  .amp-band-name {
    font-size: 9px;
    font-weight: 700;
    color: #999;
    letter-spacing: 0.08em;
  }
  .amp-band-track {
    height: 4px;
    background: rgba(255, 255, 255, 0.05);
    border-radius: 2px;
    overflow: hidden;
  }
  .amp-band-fill {
    height: 100%;
    transition: width 0.05s ease-out;
  }
  /* Color-coded fills (8 bands now). Hue progression from low→high so the
     spectrum reads visually as a rainbow. */
  .amp-band-sub      { background: #f43f5e; }
  .amp-band-bass     { background: #f97316; }
  .amp-band-lomid    { background: #eab308; }
  .amp-band-mid      { background: #22c55e; }
  .amp-band-himid    { background: #14b8a6; }
  .amp-band-treble   { background: #3b82f6; }
  .amp-band-air      { background: #8b5cf6; }
  .amp-band-presence { background: #ec4899; }

  .amp-band-gain {
    width: 70px;
    accent-color: #BB86FC;
    height: 4px;
  }

  /* Kick + snare onset dots — same layout as the generic beat dot but
     color-coded to their band groups for at-a-glance distinction. */
  .amp-ks {
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }
  .amp-ks-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #333;
    transition: background 0.04s, box-shadow 0.04s;
  }
  .amp-ks-dot.amp-kick.flash {
    background: #f97316;
    box-shadow: 0 0 8px #f97316aa;
  }
  .amp-ks-dot.amp-snare.flash {
    background: #3b82f6;
    box-shadow: 0 0 8px #3b82f6aa;
  }
</style>
