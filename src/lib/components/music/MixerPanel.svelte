<script lang="ts">
  /**
   * The mixer: one strip per instrument of the set, then one per band input.
   * Each strip has a three-band EQ, pan, mute and solo, and its fader with
   * a meter beside it. A band input's strip also names it, chooses its audio
   * device and which channel of it it hears, what the visuals see it as, and
   * how quietly it can be played and still count.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import {
    CHANNEL_LABELS,
    EQ_BANDS,
    EQ_RANGE_DB,
    INPUT_CHANNELS,
    MAX_LIVE_INPUTS,
    formatDb,
    formatPan,
    isInputChannel,
    liveInputLabel,
    stripFor,
    type ChannelId,
    type EqBand,
  } from '../../music/mixer';
  import { VOICE_SOURCES, type VoiceSourceId } from '../../music/visualVoices';
  import { bandInputStatus, channelLevels, mixerChannels, startLiveInput, stopLiveInput } from '../../music/musicRuntime';
  import { listAudioInputs, type AudioInputDevice } from '../../music/liveInput';
  import { channelChoices, channelLabel } from '../../music/bandInputs';
  import type { InstrumentId } from '../../music/noteEvents';
  import StudioKnob from './StudioKnob.svelte';
  import StudioFader from './StudioFader.svelte';

  const s = $derived($musicStudio);
  const status = $derived($bandInputStatus);
  const channels = $derived(mixerChannels(s.set, s.liveInputs.length));
  const bands: EqBand[] = ['high', 'mid', 'low'];

  let levels = $state<Partial<Record<ChannelId, number>>>({});
  let devices = $state<AudioInputDevice[]>([]);

  onMount(() => {
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      // Meters at about thirty frames a second are plenty, and cheaper.
      if (t - last > 33) {
        last = t;
        const next = channelLevels(channels);
        // Redraw only when a meter visibly moves (silence costs nothing).
        if (Object.keys(next).some((id) => Math.abs((next[id as ChannelId] ?? 0) - (levels[id as ChannelId] ?? 0)) > 0.01)
          || Object.keys(levels).some((id) => !(id in next))) levels = next;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    void refreshDevices();
    const onChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.('devicechange', onChange);
    return () => {
      cancelAnimationFrame(frame);
      navigator.mediaDevices?.removeEventListener?.('devicechange', onChange);
    };
  });

  async function refreshDevices() {
    devices = await listAudioInputs();
  }

  /** The band input a channel is, or -1 for an instrument. */
  function inputIndex(id: ChannelId): number {
    return isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1;
  }

  function labelOf(id: ChannelId): string {
    const index = inputIndex(id);
    return index >= 0 ? liveInputLabel(s.liveInputs[index] ?? { name: '' }, index) : CHANNEL_LABELS[id];
  }

  function volumeOf(id: ChannelId): number {
    const index = inputIndex(id);
    return index >= 0 ? (s.liveInputs[index]?.volume ?? 0.5) : s.volumes[id as InstrumentId];
  }

  function setVolume(id: ChannelId, v: number) {
    const index = inputIndex(id);
    if (index >= 0) musicStudio.setLiveInput(index, { volume: v });
    else musicStudio.setVolume(id as InstrumentId, v);
  }

  async function toggleInput() {
    if (s.inputOn) stopLiveInput();
    else {
      await startLiveInput();
      // Device names only show once an input has been allowed.
      void refreshDevices();
    }
  }

  /** While listening, the studio opens the new device by itself. */
  function chooseDevice(index: number, id: string) {
    musicStudio.setInputDevice(index, id);
  }

  /** A new input starts on the last one's device, on its next channel when it has one. */
  function addInput() {
    const count = s.liveInputs.length;
    if (count >= MAX_LIVE_INPUTS) return;
    const last = s.liveInputs[count - 1];
    const sends = status[count - 1]?.channels ?? null;
    const next = last.channel + 1;
    // The device first, so the new input never opens the default input on its way.
    musicStudio.setInputDevice(count, s.inputDevices[count - 1] ?? '');
    musicStudio.addLiveInput({ channel: last.channel >= 0 && (sends === null || next < sends) ? next : -1 });
  }

  function deviceTitle(index: number): string {
    return `The audio device ${liveInputLabel(s.liveInputs[index], index)} listens to`;
  }
</script>

<div class="mixer" role="group" aria-label="Mixer">
  {#if s.liveControl}
    <p class="note">Live is in control: the studio's instruments are off. The band inputs still play and drive the visuals.</p>
  {/if}
  <div class="strips">
    {#each channels as id (id)}
      {@const strip = stripFor(s.mixer, id)}
      {@const index = inputIndex(id)}
      {@const input = index >= 0 ? s.liveInputs[index] : null}
      {@const st = index >= 0 ? status[index] : undefined}
      {@const label = labelOf(id)}
      {@const deviceId = index >= 0 ? (s.inputDevices[index] ?? '') : ''}
      {@const off = s.liveControl && !input}
      <div class="strip" class:input={!!input} class:off>
        {#if input}
          <div class="input-name">
            <span class="led" class:on={!!st?.on} class:error={!!st?.error} title={st?.error ?? (st?.on ? 'Coming in' : 'Not listening')}></span>
            <input
              class="name-edit"
              type="text"
              value={input.name}
              placeholder="Input {index + 1}"
              maxlength="24"
              spellcheck="false"
              aria-label="Name of input {index + 1}"
              title="What the band calls this input"
              onchange={(e) => musicStudio.setLiveInput(index, { name: e.currentTarget.value })}
            />
          </div>
          <div class="input-head">
            {#if index === 0}
              <button class="power" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={toggleInput} title={s.inputOn ? 'Stop listening to the band inputs' : 'Listen to every band input'}>
                <span class="led" class:on={s.inputOn}></span>{s.inputOn ? 'On' : 'Off'}
              </button>
            {/if}
            <select aria-label="Audio device of {label}" title={deviceTitle(index)} value={deviceId} onchange={(e) => chooseDevice(index, e.currentTarget.value)}>
              <option value="">Default input</option>
              {#if deviceId && !devices.some((d) => d.id === deviceId)}<option value={deviceId}>Not connected</option>{/if}
              {#each devices as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
            </select>
            <label class="labelled" title="Which channel of the device {label} hears. A stereo interface sends its two inputs as 1 and 2; Mix hears them together.">
              <span>Channel</span>
              <select aria-label="Channel {label} hears" value={input.channel} onchange={(e) => musicStudio.setLiveInput(index, { channel: Number(e.currentTarget.value) })}>
                {#each channelChoices(st?.channels ?? null, input.channel) as c (c)}<option value={c}>{channelLabel(c)}</option>{/each}
              </select>
            </label>
            <label class="labelled">
              <span>Feeds</span>
              <select aria-label="What the visuals see {label} as" value={input.role} onchange={(e) => musicStudio.setLiveInput(index, { role: e.currentTarget.value as VoiceSourceId })}>
                {#each VOICE_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
              </select>
            </label>
            <div class="row">
              <StudioKnob label="Sens" value={input.sensitivity} defaultValue={0.5} size={22} title="How quietly {label} can be played and still trigger the visuals" onchange={(v) => musicStudio.setLiveInput(index, { sensitivity: v })} />
              <button class="chip" class:on={input.monitor} aria-pressed={input.monitor} onclick={() => musicStudio.setLiveInput(index, { monitor: !input.monitor })} title="Hear {label} through the mix. Off, it only drives the visuals and the band effects.">Monitor</button>
            </div>
            {#if st?.error}
              <span class="error" role="alert">{st.error}</span>
            {:else if index === 0 && s.inputError && !status.some((x) => x.error)}
              <span class="error" role="alert">{s.inputError}</span>
            {/if}
            {#if s.liveInputs.length > 1}
              <button class="studio-btn dashed remove" onclick={() => musicStudio.removeLiveInput(index)} title="Remove {label} and its strip; the inputs after it move up">Remove</button>
            {/if}
          </div>
        {:else}
          <span class="name">{label}</span>
        {/if}
        <div class="eq">
          {#each bands as band (band)}
            <StudioKnob
              label={EQ_BANDS[band].label}
              value={strip[band]}
              min={-EQ_RANGE_DB}
              max={EQ_RANGE_DB}
              defaultValue={0}
              size={24}
              format={formatDb}
              title="{label} {EQ_BANDS[band].label.toLowerCase()}"
              onchange={(v) => musicStudio.setStrip(id, { [band]: Math.round(v * 2) / 2 })}
            />
          {/each}
          <StudioKnob label="Pan" value={strip.pan} min={-1} max={1} defaultValue={0} size={24} format={formatPan} title="{label} pan" onchange={(v) => musicStudio.setStrip(id, { pan: Math.abs(v) < 0.02 ? 0 : v })} />
        </div>
        <div class="ms">
          <button class="chip mute" class:on={strip.mute} aria-pressed={strip.mute} onclick={() => musicStudio.setStrip(id, { mute: !strip.mute })} title="Mute {label}">M</button>
          <button class="chip solo" class:on={strip.solo} aria-pressed={strip.solo} onclick={() => musicStudio.setStrip(id, { solo: !strip.solo })} title="Solo {label}">S</button>
        </div>
        <div class="level">
          <StudioFader label="{label} level" value={volumeOf(id)} defaultValue={input ? 0.5 : 0.8} onchange={(v) => setVolume(id, v)} />
          <span class="meter" aria-hidden="true"><span class="meter-fill" class:hot={(levels[id] ?? 0) > 0.95} style="height: {(levels[id] ?? 0) * 100}%"></span></span>
        </div>
      </div>
    {/each}
    {#if s.liveInputs.length < MAX_LIVE_INPUTS}
      <button class="studio-btn dashed add-input" onclick={addInput} title="Add a band input with its own strip: another instrument, or another channel of the same interface">Add input</button>
    {/if}
  </div>
</div>

<style>
  .mixer { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
  .note { margin: 0; font-size: 11px; color: var(--studio-muted); }
  .strips { flex: 1; min-height: 0; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 2px; }
  .strip {
    flex: 0 0 auto;
    width: 92px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    padding: 8px 6px;
    background: var(--studio-cell);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .strip.input { width: 168px; border-color: var(--studio-edge); }
  .strip.off { opacity: 0.4; }
  /* Strip names are eyebrows, in the panel's ink. */
  .name { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; white-space: nowrap; color: var(--studio-ink); }
  .input-name { width: 100%; display: flex; align-items: center; gap: 6px; }
  .name-edit {
    flex: 1;
    min-width: 0;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 4px;
    border: 1px dashed transparent;
    background: transparent;
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
  }
  .name-edit::placeholder { color: var(--studio-ink); opacity: 1; }
  .name-edit:hover { border-color: var(--studio-edge); }
  .name-edit:focus { outline: none; border-style: solid; border-color: var(--studio-accent); text-transform: none; letter-spacing: 0; }
  .eq { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 8px; }
  .strip.input .eq { grid-template-columns: repeat(4, 1fr); }
  .ms { display: flex; gap: 4px; }
  .chip {
    min-width: 26px;
    height: var(--ga-control-h-sm, 22px);
    padding: 0 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .chip.on { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .chip.mute.on { background: #c8a23a; border-color: #c8a23a; color: #111; }
  .level { flex: 1; min-height: 80px; display: flex; gap: 4px; align-items: stretch; }
  .meter { width: 5px; background: var(--studio-slot); border: 1px solid var(--studio-edge-soft); border-radius: 2px; position: relative; margin: 6px 0; overflow: hidden; }
  .meter-fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--studio-accent); transition: height 60ms linear; }
  .meter-fill.hot { background: var(--ga-rec, #e5483a); }
  .input-head { width: 100%; display: flex; flex-direction: column; gap: 6px; }
  .input-head select { width: 100%; min-width: 0; }
  .labelled { display: flex; align-items: center; gap: 6px; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .labelled > span { flex: 0 0 48px; }
  .labelled select { flex: 1; }
  .row { display: flex; align-items: center; justify-content: space-between; }
  .power {
    height: var(--ga-control-h-sm, 22px);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .power.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .led { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .led.error { background: var(--ga-rec, #e5483a); box-shadow: none; }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-rec, #e5483a); line-height: 1.35; }
  .remove { align-self: flex-start; }
  .add-input { flex: 0 0 auto; align-self: flex-start; }
</style>
