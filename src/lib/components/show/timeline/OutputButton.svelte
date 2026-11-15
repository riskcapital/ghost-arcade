<script lang="ts">
  /**
   * The show's audio output in the Timeline toolbar: a speaker and a caret.
   * The popover holds the level, the sound card, the Stage Sim delay and
   * mute. Never hidden while the show has audio: a muted or blocked bus is
   * exactly what the user needs to see, so the button turns coral and says
   * a word ("Muted", "Blocked"); clicking the word fixes it.
   *
   * The clip-audio master is an app-wide setting whose only other control is
   * a self-hiding top-bar button; a mute set once in VJ mode used to silence
   * the show (and the recording mixdown) with no visible cause.
   */
  import { clipAudioBus, clipAudioMaster, CLIP_AUDIO_BLOCK_TEXT } from '../../../audio/clipAudioBus';
  import { audioOutput, selectAudioOutput, startAudioOutputSelection } from '../../../audio/audioOutputDevice';
  import { rehearsalAudioDelayActive } from '../../../show/rehearsal/editorRehearsal';
  import ShowAudioDelayBadge from './ShowAudioDelayBadge.svelte';
  import TimelineIcon from './TimelineIcon.svelte';
  import TlPopover from './TlPopover.svelte';

  interface Props {
    /** The show has audio tracks (the bus can only be blocked then). */
    hasAudio: boolean;
  }
  let { hasAudio }: Props = $props();

  const blocked = $derived(hasAudio ? $clipAudioMaster.blocked : null);
  const muted = $derived($clipAudioMaster.muted);
  const volumePct = $derived(Math.round($clipAudioMaster.volume * 100));
  const word = $derived(blocked === null ? '' : blocked === 'master-muted' ? 'Muted' : 'Blocked');
  const delayed = $derived($rehearsalAudioDelayActive > 0);
  const title = $derived(blocked !== null
    ? `${CLIP_AUDIO_BLOCK_TEXT[blocked]}: click the word to fix it`
    : `Show audio output: ${volumePct}%`);

  /** One click clears whatever silences the show, in the order a user would try them. */
  function fix() {
    if ($clipAudioMaster.muted) clipAudioBus.setMasterMuted(false);
    if ($clipAudioMaster.volume <= 0) clipAudioBus.setMasterVolume(1);
    clipAudioBus.resume();
  }

  let anchor: HTMLButtonElement | undefined = $state();
  let open = $state(false);
</script>

<span class="ob" class:blocked={blocked !== null} data-show-audio-output>
  <button
    class="ob-btn"
    bind:this={anchor}
    onclick={() => (open = !open)}
    {title}
    aria-label="Show audio output"
    aria-expanded={open}
    data-show-audio-button
  >
    <TimelineIcon name={muted || blocked !== null ? 'speaker-off' : 'speaker'} size={16} />
    {#if delayed}<span class="ob-dot" aria-hidden="true"></span>{/if}
    <TimelineIcon name="caret" size={12} />
  </button>
  {#if word}
    <button class="ob-word" onclick={fix} title="{blocked ? CLIP_AUDIO_BLOCK_TEXT[blocked] : ''}: click to restore show audio output" data-show-audio-fix>{word}</button>
  {/if}
</span>

{#if open}
  <TlPopover {anchor} onclose={() => (open = false)} align="end" width={300} label="Show audio output">
    <div class="tl-mi-head">Show audio output</div>
    {#if blocked !== null}
      <button class="tl-mi danger" onclick={fix} data-show-audio-restore>{CLIP_AUDIO_BLOCK_TEXT[blocked]}: restore</button>
    {/if}
    <div class="tl-pop-row">
      <span class="tl-pop-label">Level</span>
      <span class="ob-level">
        <input
          type="range" min="0" max="1" step="0.01"
          value={$clipAudioMaster.volume}
          disabled={muted}
          oninput={(e) => clipAudioBus.setMasterVolume(+(e.currentTarget as HTMLInputElement).value)}
          title="Show audio output level"
          aria-label="Show audio output level"
        />
      </span>
      <span class="ob-val">{volumePct}%</span>
    </div>
    {#if $audioOutput.supported}
      <div class="tl-pop-row">
        <span class="tl-pop-label">Sound card</span>
        <select
          class="ob-select"
          class:missing={$audioOutput.missing}
          value={$audioOutput.deviceId}
          onchange={(e) => void selectAudioOutput((e.currentTarget as HTMLSelectElement).value)}
          onfocus={() => startAudioOutputSelection()}
          title={$audioOutput.missing
            ? 'The chosen sound card is not connected: playing on the system default'
            : $audioOutput.error ?? 'Sound card the show audio plays on'}
          aria-label="Show audio output"
        >
          <option value="">System default</option>
          {#each $audioOutput.devices as device (device.deviceId)}
            <option value={device.deviceId} class="device-name">{device.label}</option>
          {/each}
          {#if $audioOutput.missing}
            <option value={$audioOutput.deviceId}>Not connected</option>
          {/if}
        </select>
      </div>
    {/if}
    {#if delayed}
      <div class="tl-pop-row"><ShowAudioDelayBadge /></div>
    {/if}
    <div class="tl-mi-sep"></div>
    <button class="tl-mi" class:on={muted} onclick={() => clipAudioBus.setMasterMuted(!muted)} aria-pressed={muted} data-show-audio-mute>
      <TimelineIcon name={muted ? 'speaker-off' : 'speaker'} size={14} />{muted ? 'Unmute show audio' : 'Mute show audio'}
    </button>
  </TlPopover>
{/if}

<style>
  .ob { display: inline-flex; align-items: center; gap: 4px; }
  .ob-btn {
    position: relative;
    height: var(--ga-control-h, 26px);
    padding: 0 4px 0 6px;
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid transparent;
    border-radius: var(--ga-r-hard, 5px);
    background: transparent;
    color: var(--ga-icon, #5278ff);
    cursor: pointer;
  }
  .ob-btn :global(.tl-icon:last-child) { color: var(--ga-ink-2, #89857e); }
  .ob-btn:hover { background: var(--ga-raise, #26221c); }
  .blocked .ob-btn { color: var(--tl-on, #ff725f); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
  .ob-dot { position: absolute; top: 3px; left: 17px; width: 5px; height: 5px; border-radius: 50%; background: var(--tl-on, #ff725f); }
  .ob-word {
    height: 22px;
    padding: 0 6px;
    border: 0;
    border-radius: 4px;
    background: var(--tl-on, #ff725f);
    color: #1a0a06;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: 700;
    cursor: pointer;
  }
  .ob-level { flex: 1; min-width: 0; display: flex; }
  .ob-val { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 11px; color: var(--ga-ink-1, #ada9a2); min-width: 34px; text-align: right; }
  .ob-select {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 4px;
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
  }
  .ob-select.missing { border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
</style>
