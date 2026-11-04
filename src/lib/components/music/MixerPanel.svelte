<script lang="ts">
  /**
   * The mixer: one strip per instrument of the set, then one per band input,
   * all the same shape. Each strip has a three-band EQ, pan, mute and solo,
   * and its fader with a meter beside it. A band input's strip also names it
   * and says where it listens; its channel, what the visuals see it as and
   * its sensitivity are on the Live band tab and the mixer desk.
   */
  import { onMount } from 'svelte';
  import { insertEditorChannel } from '../../music/studioUi';
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
  import { addBandInput, bandInputStatus, channelLevels, mixerChannels } from '../../music/musicRuntime';
  import InputSourceSelect from './InputSourceSelect.svelte';
  import type { InstrumentId } from '../../music/noteEvents';
  import StudioKnob from './StudioKnob.svelte';
  import StudioFader from './StudioFader.svelte';

  const s = $derived($musicStudio);
  const status = $derived($bandInputStatus);
  const channels = $derived(mixerChannels(s.set, s.liveInputs.length));
  const bands: EqBand[] = ['high', 'mid', 'low'];

  let levels = $state<Partial<Record<ChannelId, number>>>({});

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
    return () => cancelAnimationFrame(frame);
  });

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
</script>

<div class="mixer" role="group" aria-label="Mixer">
  <div class="strips">
    {#each channels as id (id)}
      {@const strip = stripFor(s.mixer, id)}
      {@const index = inputIndex(id)}
      {@const input = index >= 0 ? s.liveInputs[index] : null}
      {@const st = index >= 0 ? status[index] : undefined}
      {@const label = labelOf(id)}
      <div class="strip" class:input={!!input}>
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
          <div class="sub"><InputSourceSelect {index} compact class="strip-source" /></div>
        {:else}
          <span class="name">{label}</span>
          <div class="sub"></div>
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
          {#if !input}
            {@const n = s.inserts[id]?.length ?? 0}
            <button class="chip" class:on={n > 0} onclick={() => insertEditorChannel.set($insertEditorChannel === id ? null : id)} title="Insert effects on {label}">FX{n ? ` ${n}` : ''}</button>
          {/if}
        </div>
        <div class="level">
          <StudioFader label="{label} level" value={volumeOf(id)} defaultValue={input ? 0.5 : 0.8} onchange={(v) => setVolume(id, v)} />
          <span class="meter" aria-hidden="true"><span class="meter-fill" class:hot={(levels[id] ?? 0) > 0.95} style="transform: scaleY({levels[id] ?? 0})"></span></span>
        </div>
      </div>
    {/each}
    <button class="studio-btn master-fx" class:on={(s.inserts.master?.length ?? 0) > 0} onclick={() => insertEditorChannel.set($insertEditorChannel === 'master' ? null : 'master')} title="Insert effects on the whole mix">Master FX{s.inserts.master?.length ? ` ${s.inserts.master.length}` : ''}</button>
    {#if s.liveInputs.length < MAX_LIVE_INPUTS}
      <button class="studio-btn dashed add-input" onclick={addBandInput} title="Add a band input with its own strip: another instrument, or another channel of the same interface">Add input</button>
    {/if}
  </div>
</div>

<style>
  .mixer { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
  /* A short panel scrolls; strips never squeeze, so nothing in them overlaps. */
  .strips { flex: 1; min-height: 0; display: flex; align-items: flex-start; gap: 6px; overflow: auto; padding-bottom: 2px; }
  .strip {
    flex: 0 0 auto;
    width: 92px;
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 6px;
    background: var(--studio-cell);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .strip.input { border-color: var(--studio-edge); }
  /* Every strip keeps this line, so the knobs and faders line up across the mixer. */
  .sub { width: 100%; height: var(--ga-control-h-sm, 22px); display: flex; }
  .sub :global(.strip-source) { width: 100%; min-width: 0; font-size: var(--ga-text-meta, 11px); }
  /* Strip names are eyebrows, in the panel's ink. */
  .name { height: var(--ga-control-h-sm, 22px); line-height: var(--ga-control-h-sm, 22px); font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; white-space: nowrap; color: var(--studio-ink); }
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
  .level { flex: 1; min-height: 64px; display: flex; gap: 4px; align-items: stretch; }
  .meter { width: 5px; background: var(--studio-slot); border: 1px solid var(--studio-edge-soft); border-radius: 2px; position: relative; margin: 6px 0; overflow: hidden; }
  /* Scaled on its own layer: a moving meter only recomposites, it never repaints the mixer. */
  .meter-fill { position: absolute; inset: 0; background: var(--studio-accent); transform-origin: center bottom; transform: scaleY(0); transition: transform 60ms linear; will-change: transform; }
  .meter-fill.hot { background: var(--ga-rec, #e5483a); }
  .led { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: var(--studio-edge); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .led.error { background: var(--ga-rec, #e5483a); box-shadow: none; }
  .add-input { flex: 0 0 auto; align-self: flex-start; }
</style>
