<script lang="ts">
  /**
   * AudioInputPicker — single source of truth for "which audio source is
   * driving the analyzer." Used in mapping mode, VJ mode, and Performer
   * mode so users see the same UI regardless of where they are.
   *
   * Composed of three buttons (laid out left-to-right):
   *   1. Mic toggle (large) — turns mic capture on/off
   *   2. Chevron — opens device-picker dropdown so the user can choose
   *      a specific input (BlackHole / Loopback for DAW routing, etc.)
   *   3. System audio toggle — captures system loopback (WASAPI on Windows,
   *      ScreenCaptureKit on macOS 13+)
   *
   * All three read/write through the shared `audioStore` so toggling in one
   * mode is immediately reflected in every other mode.
   */
  import { audioStore } from '../stores/audio';
  import { isMac } from '../bridge';
  import AudioWaveformIndicator from './AudioWaveformIndicator.svelte';

  // Internal popover state. Closes on outside click via window listener.
  let showMicPicker = false;
  let pickerEl: HTMLDivElement | null = null;

  /**
   * Svelte action for the popover. After it mounts, measures the rect and
   * flips the anchor side if the popover would overflow the viewport.
   * Default anchor is `right: 0` (popover grows left from the chevron).
   * If that puts the left edge < 8px, switch to `left: 0` so it grows right.
   * Also clamps to viewport if both sides would overflow.
   */
  function clampToViewport(node: HTMLDivElement) {
    const adjust = () => {
      // Reset before measuring so we always start from a known baseline.
      node.style.left = '';
      node.style.right = '0';
      const rect = node.getBoundingClientRect();
      const margin = 8;
      if (rect.left < margin) {
        // Right-anchor would overflow left edge → flip to left-anchor.
        node.style.right = '';
        node.style.left = '0';
        const after = node.getBoundingClientRect();
        if (after.right > window.innerWidth - margin) {
          // Both sides overflow → pin to right edge of viewport explicitly.
          const offset = window.innerWidth - margin - after.right;
          node.style.transform = `translateX(${offset}px)`;
        }
      }
    };
    requestAnimationFrame(adjust);
    window.addEventListener('resize', adjust);
    return {
      destroy() {
        window.removeEventListener('resize', adjust);
      },
    };
  }

  async function activateMicInput() {
    if ($audioStore.inputType === 'microphone') {
      await audioStore.stop();
    } else {
      await audioStore.stop();
      await audioStore.startMicrophone();
    }
  }

  async function activateSystemAudio() {
    if ($audioStore.inputType === 'system') {
      await audioStore.stop();
    } else {
      await audioStore.stop();
      await audioStore.startSystemAudio();
    }
  }

  async function toggleMicPicker() {
    showMicPicker = !showMicPicker;
    if (showMicPicker) {
      // Re-enumerate every open — devices come and go (USB mics, BlackHole
      // installs, etc.) and the user expects fresh data each time.
      await audioStore.refreshInputDevices();
    }
  }

  async function pickMicDevice(deviceId: string | null) {
    showMicPicker = false;
    await audioStore.setPreferredInputDevice(deviceId);
    if ($audioStore.inputType !== 'microphone') {
      await audioStore.startMicrophone();
    }
  }

  function handleWindowClick(e: MouseEvent) {
    if (!showMicPicker) return;
    const target = e.target as Node;
    if (pickerEl && !pickerEl.contains(target)) {
      showMicPicker = false;
    }
  }
</script>

<svelte:window onclick={handleWindowClick} />

<div class="audio-input-picker" bind:this={pickerEl}>
  <!-- Mic button + device-picker chevron, grouped as one visual unit -->
  <div class="aip-mic-group">
    <button
      class="aip-btn aip-mic-main"
      class:active={$audioStore.inputType === 'microphone'}
      onclick={activateMicInput}
      title={$audioStore.inputType === 'microphone' ? 'Disable Mic' : 'Enable Mic Input (right side = pick device)'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
        <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
        <line x1="12" y1="19" x2="12" y2="23"/>
        <line x1="8" y1="23" x2="16" y2="23"/>
      </svg>
      {#if $audioStore.inputType === 'microphone'}
        <span class="aip-active-dot"></span>
      {/if}
    </button>
    <button
      class="aip-btn aip-mic-chevron"
      class:active={showMicPicker}
      onclick={toggleMicPicker}
      title="Select audio input device (e.g. BlackHole for DAW routing)"
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    {#if showMicPicker}
      <div class="aip-popover" use:clampToViewport>
        <div class="aip-popover-label">Audio Input</div>
        <button
          class="aip-popover-item"
          class:selected={$audioStore.preferredInputDeviceId === null}
          onclick={() => pickMicDevice(null)}
        >
          System Default
        </button>
        {#each $audioStore.availableInputDevices as dev (dev.deviceId)}
          <button
            class="aip-popover-item"
            class:selected={$audioStore.preferredInputDeviceId === dev.deviceId}
            onclick={() => pickMicDevice(dev.deviceId)}
          >
            {dev.label}
          </button>
        {/each}
        {#if $audioStore.availableInputDevices.length === 0}
          <div class="aip-popover-empty">No input devices found</div>
        {/if}
        <div class="aip-popover-hint">
          Route DAW → virtual device (BlackHole / Loopback) → pick it here.
        </div>
      </div>
    {/if}
  </div>

  <!-- System audio toggle — captures the system audio mix:
         · Windows: WASAPI loopback (any source)
         · macOS:   Chromium's getDisplayMedia. The user MUST pick
                    "Entire Screen" in the OS picker AND toggle the
                    "Share audio" / speaker checkbox before clicking
                    Share. Picking a Window returns silent video and
                    we surface a "No audio track" error. There is no
                    per-app capture on macOS via this API. -->
  <AudioWaveformIndicator />

  <button
    class="aip-btn"
    class:active={$audioStore.inputType === 'system'}
    onclick={activateSystemAudio}
    title={$audioStore.inputType === 'system'
      ? 'Disable System Audio'
      : (isMac
        ? 'Capture System Audio — pick "Entire Screen" and toggle "Share audio" in the picker'
        : 'Enable System Audio')}
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
      <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
      <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
    </svg>
    {#if $audioStore.inputType === 'system'}
      <span class="aip-active-dot"></span>
    {/if}
  </button>
</div>

<style>
  .audio-input-picker {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .aip-btn {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 28px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #a0a0a0;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .aip-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #e8e8e8;
    border-color: rgba(255, 255, 255, 0.2);
  }

  .aip-btn.active {
    background: rgba(46, 213, 115, 0.15);
    border-color: rgba(46, 213, 115, 0.4);
    color: #2ED573;
    box-shadow: 0 0 8px rgba(46, 213, 115, 0.2);
  }

  .aip-btn.active:hover {
    background: rgba(46, 213, 115, 0.25);
    color: #5AE08C;
  }

  .aip-active-dot {
    position: absolute;
    top: 2px;
    right: 2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: #2ED573;
    box-shadow: 0 0 6px #2ED57380;
    animation: aip-pulse 1.5s infinite;
  }

  @keyframes aip-pulse {
    0%, 100% { opacity: 1; transform: scale(1); }
    50%      { opacity: 0.5; transform: scale(0.85); }
  }

  /* Mic main + chevron grouped as one visual unit */
  .aip-mic-group {
    position: relative;
    display: inline-flex;
    align-items: stretch;
  }
  .aip-mic-main {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
    border-right: none;
  }
  .aip-mic-chevron {
    width: 16px;
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
    padding: 0;
    color: #808080;
  }
  .aip-mic-chevron:hover {
    color: #e8e8e8;
  }

  .aip-popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 220px;
    max-width: 320px;
    background: #1a1a1a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 6px;
    padding: 6px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    z-index: 1000;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .aip-popover-label {
    font-size: 10px;
    font-weight: 600;
    color: #808080;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    padding: 4px 8px 2px;
  }
  .aip-popover-item {
    text-align: left;
    font-size: 12px;
    color: #d0d0d0;
    background: transparent;
    border: 1px solid transparent;
    padding: 6px 8px;
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .aip-popover-item:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
  }
  .aip-popover-item.selected {
    background: rgba(46, 213, 115, 0.12);
    border-color: rgba(46, 213, 115, 0.3);
    color: #2ED573;
  }
  .aip-popover-empty {
    padding: 8px;
    font-size: 11px;
    color: #707070;
    font-style: italic;
  }
  .aip-popover-hint {
    margin-top: 4px;
    padding: 6px 8px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 10px;
    color: #808080;
    line-height: 1.4;
  }
</style>
