<script lang="ts">
  /**
   * Where one band input's sound comes from, grouped so the usual choices
   * are easy to find at a show with no feed from the desk: what this
   * computer plays (system audio), its own microphone, an iPhone nearby,
   * or an audio interface's line inputs.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { startLiveInput } from '../../music/musicRuntime';
  import { SYSTEM_AUDIO_DEVICE, inputKind, listAudioInputs, type AudioInputDevice } from '../../music/liveInput';
  import { liveInputLabel } from '../../music/mixer';

  /** compact drops the hint below it; class styles the select where it sits. */
  let { index, compact = false, class: cls = '' }: { index: number; compact?: boolean; class?: string } = $props();

  const s = $derived($musicStudio);
  let devices = $state<AudioInputDevice[]>([]);
  const deviceId = $derived(s.inputDevices[index] ?? '');
  const label = $derived(liveInputLabel(s.liveInputs[index] ?? { name: '' }, index));
  const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
  const computer = $derived(devices.filter((d) => inputKind(d.label) === 'computer'));
  const phone = $derived(devices.filter((d) => inputKind(d.label) === 'phone'));
  const line = $derived(devices.filter((d) => inputKind(d.label) === 'interface'));

  async function refresh() {
    devices = await listAudioInputs();
  }

  onMount(() => {
    void refresh();
    const onChange = () => void refresh();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
  });

  // Device names only appear once audio input has been allowed: look again when listening starts.
  $effect(() => {
    if (s.inputOn) void refresh();
  });

  function choose(id: string) {
    musicStudio.setInputDevice(index, id);
    // System audio already plays through this computer: hearing it again
    // through the mix would double it.
    if (id === SYSTEM_AUDIO_DEVICE) musicStudio.setLiveInput(index, { monitor: false });
    // Choosing where to listen is asking to listen.
    if (!$musicStudio.inputOn) void startLiveInput();
  }
</script>

<select class="source {cls}" class:compact aria-label="Where {label} comes from" title="Where {label} comes from: this computer's sound, a microphone, a phone or an audio interface" value={deviceId} onchange={(e) => choose(e.currentTarget.value)}>
  <option value="">Default microphone</option>
  {#if deviceId && deviceId !== SYSTEM_AUDIO_DEVICE && !devices.some((d) => d.id === deviceId)}<option value={deviceId}>Not connected</option>{/if}
  <optgroup label="This computer">
    <option value={SYSTEM_AUDIO_DEVICE}>System audio (what this computer plays)</option>
    {#each computer as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
  </optgroup>
  {#if phone.length}
    <optgroup label="Phone">
      {#each phone as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
    </optgroup>
  {/if}
  {#if line.length}
    <optgroup label="Interfaces and line inputs">
      {#each line as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
    </optgroup>
  {/if}
</select>
{#if !compact}
  {#if deviceId === SYSTEM_AUDIO_DEVICE}
    <span class="hint">Hears everything this computer plays: a DJ app, a stream, a playlist.{#if isMac} The first time, allow Screen &amp; System Audio Recording.{/if}</span>
  {:else if !deviceId && index === 0 && isMac && !phone.length}
    <span class="hint">No feed from the desk? Use the room mic, or an iPhone near this Mac: it shows up here as a microphone.</span>
  {/if}
{/if}

<style>
  .source { min-width: 0; max-width: 100%; }
  .hint { font-size: var(--ga-text-micro, 10px); line-height: 1.3; color: var(--studio-muted); white-space: normal; }
</style>
