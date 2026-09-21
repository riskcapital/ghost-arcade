<script lang="ts">
  import { onMount } from 'svelte';
  import { nativeRendererRuntime } from '../stores/nativeRenderer';
  import { nativeAudioMaster } from '../audio/nativeClipAudio';
  import { getNativeAudioDevices, getNativeAudioStatus, setNativeAudioOutput, type NativeClipAudioStatus } from '../api/native-renderer';
  let opened = $state(false);
  let tray: HTMLDivElement;
  let left = $state(0);
  let top = $state(0);
  let devices = $state<string[]>([]);
  let device = $state('default');
  let status = $state<NativeClipAudioStatus | null>(null);
  let error = $state('');
  let busy = $state(false);
  async function refresh() {
    try { status = await getNativeAudioStatus(); error = ''; }
    catch (e) { error = String(e); }
  }
  async function open(event: MouseEvent) {
    if (opened) { tray.hidePopover(); return; }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    left = Math.max(8, Math.min(rect.left, window.innerWidth - 304));
    top = Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 320));
    tray.showPopover();
    try { devices = await getNativeAudioDevices(); await refresh(); device = status?.device ?? 'default'; }
    catch (e) { error = String(e); }
  }
  async function selectDevice(next: string) {
    busy = true;
    try { await setNativeAudioOutput(next); device = next; localStorage.setItem('ghost-native-audio-device', next); await refresh(); }
    catch (e) { error = String(e); }
    finally { busy = false; }
  }
  onMount(() => {
    let wasRunning = false;
    const unsubscribe = nativeRendererRuntime.subscribe(runtime => {
      if (runtime.running && !wasRunning) {
        const saved = localStorage.getItem('ghost-native-audio-device');
        if (saved && saved !== 'default') void selectDevice(saved);
      }
      wasRunning = runtime.running;
    });
    const timer = setInterval(() => { if (opened) void refresh(); }, 1500); return () => { clearInterval(timer); unsubscribe(); }; });
</script>
<div data-help-page="midi-audio" class="audio-output">
  <button class="output-button" class:muted={$nativeAudioMaster.muted} aria-expanded={opened} onclick={open} title="Clip audio output and master volume">Audio Out <span>{$nativeAudioMaster.muted ? 'Muted' : `${Math.round($nativeAudioMaster.volume * 100)}%`}</span></button>
    <div bind:this={tray} popover="auto" class="output-panel" role="group" aria-label="Clip audio output"
      style:left="{left}px" style:top="{top}px" style:max-height="calc(100vh - {top + 8}px)"
      ontoggle={e => opened = (e as ToggleEvent).newState === 'open'}>
      <div class="panel-heading">Clip audio <button aria-label="Close audio output" onclick={() => tray.hidePopover()}>×</button></div>
      <label>Output device<select value={device} disabled={busy} onchange={e => selectDevice(e.currentTarget.value)}><option value="default">System default</option>{#each devices as name}<option value={name}>{name}</option>{/each}</select></label>
      <label>Master volume <span>{Math.round($nativeAudioMaster.volume * 100)}%</span><input aria-label="Master audio volume" data-midi-path="vj:master:audioVolume" data-midi-label="Master audio volume" data-midi-min="0" data-midi-max="1" type="range" min="0" max="1" step=".01" value={$nativeAudioMaster.volume} oninput={e => nativeAudioMaster.update(v => ({ ...v, volume: +e.currentTarget.value }))} /></label>
      <button data-midi-path="vj:master:audioMute" data-midi-label="Master audio mute" data-midi-mode="toggle" class:active={$nativeAudioMaster.muted} aria-pressed={$nativeAudioMaster.muted} onclick={() => nativeAudioMaster.update(v => ({ ...v, muted: !v.muted }))}>{$nativeAudioMaster.muted ? 'Unmute audio' : 'Mute audio'}</button>
      <p class="status">{status?.running ? 'Output active' : 'Ready when a clip plays'} · {status?.assets.filter(a => a.complete && !a.error).length ?? 0} clips prepared</p>
      {#if status?.assets.some(a => !a.complete)}<p class="status">Preparing audio…</p>{/if}
      {#if error || status?.error}<p class="error" role="status">{error || status?.error}</p>{/if}
      {#each status?.assets.filter(a => a.error) ?? [] as asset}<p class="error">{asset.uri.split('/').pop()}: {asset.error}</p>{/each}
    </div>
</div>
<style>
  .audio-output { position: relative; font-size: 12px; }
  button, select { min-height: 28px; border: 1px solid #34383f; border-radius: 5px; background: #121419; color: #dce0e7; font: inherit; padding: 4px 8px; }
  .output-button { display: flex; gap: 8px; align-items: center; white-space: nowrap; }
  .output-button span, .status { color: #969eab; font-size: 11px; }
  .muted, .active { background: #172a5b; border-color: #3d59b8; }
  .output-panel { color: #dce0e7; font-size: 12px; position: fixed; margin: 0; inset: auto; overflow-y: auto; width: 280px; max-width: calc(100vw - 16px); padding: 14px; border: 1px solid #343b49; border-radius: 8px; background: #111318; box-shadow: 0 12px 36px #0009; }
  .panel-heading { display: flex; justify-content: space-between; align-items: center; font-weight: 650; margin-bottom: 12px; }
  label { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin: 12px 0; }
  select, input { width: 100%; accent-color: #3d59b8; }
  p { margin: 10px 0 0; line-height: 1.4; overflow-wrap: anywhere; }
  .error { color: #e6b77a; font-size: 11px; }
</style>
