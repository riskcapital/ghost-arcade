<script lang="ts">
  /**
   * The mixer: one strip per instrument of the set, then the live input.
   * Each strip has a three-band EQ, pan, mute and solo, and its fader with
   * a meter beside it. The input strip also chooses the audio input, what
   * the visuals see it as, and how quietly it can be played and still count.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { CHANNEL_LABELS, EQ_BANDS, EQ_RANGE_DB, formatDb, formatPan, stripFor, type ChannelId, type EqBand } from '../../music/mixer';
  import { VOICE_SOURCES, type VoiceSourceId } from '../../music/visualVoices';
  import { channelLevels, mixerChannels, startLiveInput, stopLiveInput } from '../../music/musicRuntime';
  import { listAudioInputs, type AudioInputDevice } from '../../music/liveInput';
  import type { InstrumentId } from '../../music/noteEvents';
  import StudioKnob from './StudioKnob.svelte';
  import StudioFader from './StudioFader.svelte';

  const s = $derived($musicStudio);
  const channels = $derived(mixerChannels(s.set));
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

  function volumeOf(id: ChannelId): number {
    return id === 'input' ? s.liveInputs[0].volume : s.volumes[id as InstrumentId];
  }

  function setVolume(id: ChannelId, v: number) {
    if (id === 'input') musicStudio.setLiveInput(0, { volume: v });
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

  async function chooseDevice(id: string) {
    musicStudio.setInputDevice(0, id);
    if (s.inputOn) await startLiveInput();
  }
</script>

<div class="mixer" role="group" aria-label="Mixer">
  {#if s.liveControl}
    <p class="note">Live is in control: the studio's instruments are off. The input still plays and drives the visuals.</p>
  {/if}
  <div class="strips">
    {#each channels as id (id)}
      {@const strip = stripFor(s.mixer, id)}
      {@const off = s.liveControl && id !== 'input'}
      <div class="strip" class:input={id === 'input'} class:off>
        <span class="name">{CHANNEL_LABELS[id]}</span>
        {#if id === 'input'}
          <div class="input-head">
            <button class="power" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={toggleInput} title={s.inputOn ? 'Stop listening to the input' : 'Listen to the input'}>
              <span class="led" class:on={s.inputOn}></span>{s.inputOn ? 'On' : 'Off'}
            </button>
            <select aria-label="Audio input" value={s.inputDevices[0] ?? ''} onchange={(e) => void chooseDevice((e.target as HTMLSelectElement).value)}>
              <option value="">Default input</option>
              {#each devices as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
            </select>
            <label class="labelled">
              <span>Feeds</span>
              <select aria-label="What the visuals see the input as" value={s.liveInputs[0].role} onchange={(e) => musicStudio.setLiveInput(0, { role: (e.target as HTMLSelectElement).value as VoiceSourceId })}>
                {#each VOICE_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
              </select>
            </label>
            <div class="row">
              <StudioKnob label="Sens" value={s.liveInputs[0].sensitivity} defaultValue={0.5} size={22} title="How quietly you can play and still trigger the visuals" onchange={(v) => musicStudio.setLiveInput(0, { sensitivity: v })} />
              <button class="chip" class:on={s.liveInputs[0].monitor} aria-pressed={s.liveInputs[0].monitor} onclick={() => musicStudio.setLiveInput(0, { monitor: !s.liveInputs[0].monitor })} title="Hear the input through the mix. Off, it only drives the visuals.">Monitor</button>
            </div>
            {#if s.inputError}<span class="error" role="alert">{s.inputError}</span>{/if}
          </div>
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
              title="{CHANNEL_LABELS[id]} {EQ_BANDS[band].label.toLowerCase()}"
              onchange={(v) => musicStudio.setStrip(id, { [band]: Math.round(v * 2) / 2 })}
            />
          {/each}
          <StudioKnob label="Pan" value={strip.pan} min={-1} max={1} defaultValue={0} size={24} format={formatPan} title="{CHANNEL_LABELS[id]} pan" onchange={(v) => musicStudio.setStrip(id, { pan: Math.abs(v) < 0.02 ? 0 : v })} />
        </div>
        <div class="ms">
          <button class="chip mute" class:on={strip.mute} aria-pressed={strip.mute} onclick={() => musicStudio.setStrip(id, { mute: !strip.mute })} title="Mute {CHANNEL_LABELS[id]}">M</button>
          <button class="chip solo" class:on={strip.solo} aria-pressed={strip.solo} onclick={() => musicStudio.setStrip(id, { solo: !strip.solo })} title="Solo {CHANNEL_LABELS[id]}">S</button>
        </div>
        <div class="level">
          <StudioFader label="{CHANNEL_LABELS[id]} level" value={volumeOf(id)} defaultValue={id === 'input' ? 0.5 : 0.8} onchange={(v) => setVolume(id, v)} />
          <span class="meter" aria-hidden="true"><span class="meter-fill" class:hot={(levels[id] ?? 0) > 0.95} style="height: {(levels[id] ?? 0) * 100}%"></span></span>
        </div>
      </div>
    {/each}
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
  .led { width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .error { font-size: var(--ga-text-meta, 11px); color: var(--ga-rec, #e5483a); }
</style>
