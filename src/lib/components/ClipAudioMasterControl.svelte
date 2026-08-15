<script lang="ts">
  /**
   * ClipAudioMasterControl — master output level for opt-in clip audio.
   *
   * Sits next to AudioInputPicker so the two halves of the audio story are
   * adjacent: the picker chooses what the app LISTENS to (analyzer input,
   * drives reactive visuals), this chooses how loud what the app PLAYS is
   * (video clips that opted into audio).
   *
   * SELF-HIDING BY DESIGN. Clip audio is opt-in and off by default, so a
   * project that never enables it never sees this control at all — no dead
   * speaker icon implying the app can make noise when nothing is wired.
   * `clipAudioMaster.activeClips` is 0 until the bus has a clip, and the bus
   * is completely inert until then.
   */
  import { clipAudioBus, clipAudioMaster } from '../audio/clipAudioBus';

  /** Open the slider popover upward — for hosts pinned to the bottom of the
   *  window (the VJ deck dock). */
  export let openUp: boolean = false;

  let showSlider = false;
  let rootEl: HTMLDivElement | null = null;

  $: active = $clipAudioMaster.activeClips > 0;
  $: muted = $clipAudioMaster.muted;
  $: volume = $clipAudioMaster.volume;
  $: exportSilenced = $clipAudioMaster.exportSilenced;
  $: percent = Math.round(volume * 100);

  function toggleMute() {
    clipAudioBus.setMasterMuted(!muted);
  }

  function onVolumeInput(e: Event) {
    clipAudioBus.setMasterVolume(+(e.target as HTMLInputElement).value);
  }

  function onWindowClick(e: MouseEvent) {
    if (!showSlider) return;
    if (rootEl && !rootEl.contains(e.target as Node)) showSlider = false;
  }
</script>

<svelte:window on:click={onWindowClick} />

{#if active}
  <div class="clip-audio-master" bind:this={rootEl}>
    <button
      class="cam-btn"
      class:muted
      class:silenced={exportSilenced}
      onclick={toggleMute}
      title={exportSilenced
        ? 'Clip audio is silenced while an offline render owns the clock'
        : muted ? 'Unmute clip audio output' : 'Mute clip audio output'}
      aria-label={muted ? 'Unmute clip audio' : 'Mute clip audio'}
    >
      {#if muted || exportSilenced}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
        </svg>
      {/if}
    </button>

    <button
      class="cam-chevron"
      onclick={(e) => { e.stopPropagation(); showSlider = !showSlider; }}
      title="Clip audio output level"
      aria-label="Clip audio output level"
      aria-expanded={showSlider}
    >
      <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </button>

    {#if showSlider}
      <div class="cam-popover" class:up={openUp}>
        <div class="cam-popover-head">
          <span>Clip audio</span>
          <span class="cam-popover-value">{muted ? 'Muted' : `${percent}%`}</span>
        </div>
        <input
          type="range"
          min="0" max="1" step="0.01"
          value={volume}
          disabled={muted}
          oninput={onVolumeInput}
          data-midi-path="global:clipAudio:volume"
          data-midi-label="Clip Audio Master Volume"
          data-midi-min="0"
          data-midi-max="1"
          data-midi-step="0.01"
          aria-label="Clip audio master volume"
        />
        <div class="cam-popover-note">
          {$clipAudioMaster.activeClips} clip{$clipAudioMaster.activeClips === 1 ? '' : 's'} playing audio
        </div>
        {#if exportSilenced}
          <div class="cam-popover-note warn">Silenced during offline render</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .clip-audio-master {
    position: relative;
    display: flex;
    align-items: center;
    gap: 1px;
  }
  .cam-btn,
  .cam-chevron {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 26px;
    border: 1px solid rgba(251, 191, 36, 0.35);
    background: rgba(251, 191, 36, 0.14);
    color: #fbbf24;
    cursor: pointer;
    padding: 0;
  }
  .cam-btn {
    width: 28px;
    border-radius: 4px 0 0 4px;
  }
  .cam-chevron {
    width: 16px;
    border-left: none;
    border-radius: 0 4px 4px 0;
  }
  .cam-btn:hover,
  .cam-chevron:hover {
    background: rgba(251, 191, 36, 0.24);
  }
  .cam-btn.muted,
  .cam-btn.silenced {
    border-color: rgba(255, 255, 255, 0.12);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-muted, #888);
  }

  .cam-popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 4000;
    width: 190px;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    background: var(--bg-elevated, #1a1a1e);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cam-popover.up {
    top: auto;
    bottom: calc(100% + 4px);
  }
  .cam-popover-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 11px;
    color: var(--text-secondary, #aaa);
  }
  .cam-popover-value {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: #fbbf24;
  }
  .cam-popover input[type='range'] {
    width: 100%;
    accent-color: #fbbf24;
  }
  .cam-popover-note {
    font-size: 10px;
    color: var(--text-muted, #888);
  }
  .cam-popover-note.warn {
    color: #fbbf24;
  }
</style>
