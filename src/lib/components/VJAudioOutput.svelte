<script lang="ts">
  // Clip audio output: where the clips' sound plays, and how loud. Same
  // control as the 2.0 deck bar; on this line the clips play through the
  // app's own audio mixer, so the device list is the system's outputs.
  import { onMount } from 'svelte';
  import { clipAudio, clipAudioMaster } from '../audio/clipAudio';
  let opened = $state(false);
  let tray: HTMLDivElement;
  let left = $state(0);
  let top = $state(0);
  let devices = $state<{ id: string; label: string }[]>([]);
  let device = $state(clipAudio.outputDevice);
  let busy = $state(false);
  const canChooseDevice = typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype;
  async function listDevices() {
    try {
      const all = await navigator.mediaDevices?.enumerateDevices?.() ?? [];
      devices = all
        .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default' && d.deviceId !== 'communications')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Output ${i + 1}` }));
    } catch {
      devices = [];
    }
  }
  async function open(event: MouseEvent) {
    if (opened) { tray.hidePopover(); return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    left = Math.max(8, Math.min(rect.left, window.innerWidth - 304));
    top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 320));
    tray.showPopover();
    if (canChooseDevice) await listDevices();
  }
  async function selectDevice(next: string) {
    busy = true;
    try { await clipAudio.setOutputDevice(next); device = next; }
    finally { busy = false; }
  }
  onMount(() => {
    const changed = () => { if (opened) void listDevices(); };
    navigator.mediaDevices?.addEventListener?.('devicechange', changed);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', changed);
  });
</script>
<div data-help-page="midi-audio" class="audio-output">
  <button class="output-button" class:muted={$clipAudioMaster.muted} aria-expanded={opened} onclick={open} title="Clip audio output and master volume">Audio Out <span>{$clipAudioMaster.muted ? 'Muted' : `${Math.round($clipAudioMaster.volume * 100)}%`}</span></button>
    <div bind:this={tray} popover="auto" class="output-panel" role="group" aria-label="Clip audio output"
      style:left="{left}px" style:top="{top}px" style:max-height="calc(100vh - {top + 8}px)"
      ontoggle={e => opened = (e as ToggleEvent).newState === 'open'}>
      <div class="panel-heading">Clip audio <button aria-label="Close audio output" onclick={() => tray.hidePopover()}>×</button></div>
      {#if canChooseDevice}
        <label>Output device<select value={device} disabled={busy} onchange={e => selectDevice(e.currentTarget.value)}><option value="default">System default</option>{#each devices as output (output.id)}<option value={output.id}>{output.label}</option>{/each}</select></label>
      {/if}
      <label>Master volume <span>{Math.round($clipAudioMaster.volume * 100)}%</span><input aria-label="Master audio volume" data-midi-path="vj:master:audioVolume" data-midi-label="Master audio volume" data-midi-min="0" data-midi-max="1" type="range" min="0" max="1" step=".01" value={$clipAudioMaster.volume} oninput={e => clipAudio.setMasterVolume(+e.currentTarget.value)} /></label>
      <button data-midi-path="vj:master:audioMute" data-midi-label="Master audio mute" data-midi-mode="toggle" class:active={$clipAudioMaster.muted} aria-pressed={$clipAudioMaster.muted} onclick={() => clipAudio.setMasterMuted(!$clipAudioMaster.muted)}>{$clipAudioMaster.muted ? 'Unmute audio' : 'Mute audio'}</button>
      <p class="status">{$clipAudioMaster.activeClips > 0 ? `Output active · ${$clipAudioMaster.activeClips} clip${$clipAudioMaster.activeClips === 1 ? '' : 's'} sounding` : 'Ready when a clip plays'}</p>
      {#if $clipAudioMaster.exportSilenced}<p class="status">Silenced while an offline render owns the clock</p>{/if}
    </div>
</div>
<style>
  .audio-output { position: relative; font-size: 12px; }
  button, select { min-height: 28px; border: 1px solid #34383f; border-radius: 5px; background: #121419; color: #dce0e7; font: inherit; padding: 4px 8px; }
  .output-button { display: flex; gap: 8px; align-items: center; white-space: nowrap; }
  .output-button span, .status { color: #969eab; font-size: 11px; }
  .muted, .active { background: var(--ga-blue-700, #2443b8); border-color: var(--ga-blue-500, #4b6dff); }
  .output-panel { color: #dce0e7; font-size: 12px; position: fixed; margin: 0; inset: auto; overflow-y: auto; width: 280px; max-width: calc(100vw - 16px); padding: 14px; border: 1px solid var(--ga-blue-mute-600, #2f3a5c); border-radius: 8px; background: #111318; box-shadow: 0 12px 36px #0009; }
  .panel-heading { display: flex; justify-content: space-between; align-items: center; font-weight: 650; margin-bottom: 12px; }
  label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 0; }
  select, input { width: 100%; accent-color: var(--ga-blue-500, #4b6dff); }
  p { margin: 10px 0 0; line-height: 1.4; overflow-wrap: anywhere; }
</style>
