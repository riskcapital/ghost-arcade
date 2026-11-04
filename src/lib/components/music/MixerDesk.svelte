<script lang="ts">
  /**
   * The mixing desk: a hardware-style strip for every sound the studio makes,
   * whatever the set, each band input, the shared returns, and a wider master
   * pinned at the right. Top to bottom: the channel number, trim, the insert
   * effects (click to edit the chain), a three-band EQ with a sweepable mid
   * and a low cut, the sends to the reverb, echo and spring, pan, the fader's
   * dB and the peak, a long-throw fader beside an LED meter, mute, solo and
   * record arm (which channels get stems), and the scribble strip. This is the
   * one place the studio's look goes skeuomorphic, on purpose.
   *
   * A band input's strip also says where it listens (this computer's sound,
   * a mic, a phone or an interface), which channel, what the visuals see it
   * as and how quietly it can be played and still count; band inputs have no
   * insert effects, so that is where this goes.
   *
   * It is the same state as the Mixer tab: one mixer. One meter tick serves
   * every strip, and only redraws what moved.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { CHANNEL_LABELS, EQ_RANGE_DB, INPUT_CHANNELS, MAX_LIVE_INPUTS, formatPan, isInputChannel, liveInputLabel, stripFor, type ChannelId, type ChannelStrip } from '../../music/mixer';
  import { INSTRUMENTS, type InstrumentId } from '../../music/noteEvents';
  import { addBandInput, bandInputStatus, channelLevels, masterLevels, startLiveInput, stopLiveInput } from '../../music/musicRuntime';
  import { channelChoices, channelLabel } from '../../music/bandInputs';
  import { PART_SOURCES, type VoiceSourceId } from '../../music/visualVoices';
  import InputSourceSelect from './InputSourceSelect.svelte';
  import { macroFxDef } from '../../music/macroFx';
  import { RETURN_IDS, RETURN_LABELS, type ReturnId } from '../../music/sendReturns';
  import { formatDb, gainToDb } from '../../music/faderScale';
  import { insertEditorChannel } from '../../music/studioUi';
  import StudioKnob from './StudioKnob.svelte';
  import DeskFader from './DeskFader.svelte';
  import DeskMeter from './DeskMeter.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const s = $derived($musicStudio);
  const status = $derived($bandInputStatus);
  const inputAt = (id: ChannelId) => (isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1);
  const channels = $derived<ChannelId[]>([...INSTRUMENTS, ...INPUT_CHANNELS.slice(0, Math.max(1, s.liveInputs.length))]);

  /** The scribble strip's colour by family, from the studio's own tokens. */
  function family(id: ChannelId): string {
    if (isInputChannel(id)) return 'var(--studio-muted)';
    if (id === 'drums') return 'var(--studio-accent)';
    if (id === 'dubbass' || id === 'acid' || id === 'analog') return 'var(--studio-jack-cv, #7ec8e3)';
    if (id === 'shots' || id === 'siren' || id === 'scan' || id === 'xy') return 'var(--studio-ink)';
    return 'var(--studio-jack-ring, #c9d3ee)';
  }

  function labelOf(id: ChannelId): string {
    const i = isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1;
    return i >= 0 ? liveInputLabel(s.liveInputs[i] ?? { name: '' }, i) : CHANNEL_LABELS[id];
  }

  function gainOf(id: ChannelId): number {
    const i = isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1;
    return i >= 0 ? (s.liveInputs[i]?.volume ?? 0.5) : s.volumes[id as InstrumentId];
  }

  function setGain(id: ChannelId, g: number) {
    const i = isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1;
    if (i >= 0) musicStudio.setLiveInput(i, { volume: Math.min(1, g) });
    else musicStudio.setVolume(id as InstrumentId, g);
  }

  const set = (id: ChannelId, patch: Partial<ChannelStrip>) => musicStudio.setStrip(id, patch);
  const setSend = (id: ChannelId, r: ReturnId, v: number) => set(id, { sends: { reverb: 0, echo: 0, spring: 0, ...stripFor(s.mixer, id).sends, [r]: v } });
  const dbKnob = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
  const hz = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

  // One tick for every meter, about thirty times a second: levels, falling peak holds, clip lights.
  let levels = $state<Partial<Record<ChannelId, number>>>({});
  let peaks = $state<Partial<Record<ChannelId, number>>>({});
  let clips = $state<Partial<Record<string, boolean>>>({});
  let master = $state<[number, number]>([0, 0]);
  let masterPeak = $state<[number, number]>([0, 0]);
  onMount(() => {
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 33) {
        last = t;
        const next = channelLevels(channels);
        const p: Partial<Record<ChannelId, number>> = {};
        let moved = false;
        let peakMoved = false;
        let clipped = false;
        for (const id of channels) {
          const v = next[id] ?? 0;
          p[id] = Math.max(v, (peaks[id] ?? 0) - 0.01);
          if (Math.abs(v - (levels[id] ?? 0)) > 0.005) moved = true;
          if (Math.abs(p[id]! - (peaks[id] ?? 0)) > 0.005) peakMoved = true;
          if (v > 0.985 && !clips[id]) clipped = true;
        }
        const m = masterLevels();
        const mp: [number, number] = [Math.max(m[0], masterPeak[0] - 0.01), Math.max(m[1], masterPeak[1] - 0.01)];
        // Nothing moved (silence, or a held level): nothing is redrawn.
        if (moved) levels = next;
        if (peakMoved) peaks = p;
        if (Math.abs(m[0] - master[0]) > 0.005 || Math.abs(m[1] - master[1]) > 0.005) master = m;
        if (Math.abs(mp[0] - masterPeak[0]) > 0.005 || Math.abs(mp[1] - masterPeak[1]) > 0.005) masterPeak = mp;
        if (clipped || ((m[0] > 0.985 || m[1] > 0.985) && !clips.master)) {
          const c = { ...clips };
          for (const id of channels) if ((next[id] ?? 0) > 0.985) c[id] = true;
          if (m[0] > 0.985 || m[1] > 0.985) c.master = true;
          clips = c;
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !$insertEditorChannel) onclose(); };
    window.addEventListener('keydown', esc);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('keydown', esc);
    };
  });

  const peakDb = (v: number) => (v <= 0.001 ? '-∞' : `${Math.round(v * 60 - 60)}`);
</script>

{#snippet inserts(channel: string)}
  {@const chain = s.inserts[channel] ?? []}
  <button class="inserts" class:open={$insertEditorChannel === channel} onclick={() => insertEditorChannel.set($insertEditorChannel === channel ? null : channel)} title="Insert effects: click to add, reorder, bypass and edit">
    {#each [0, 1, 2, 3] as i (i)}
      {@const fx = chain[i]}
      <span class="slot" class:used={!!fx} class:off={fx && !fx.enabled}>{fx ? macroFxDef(fx.type).label : ''}</span>
    {/each}
    {#if chain.length > 4}<span class="more">+{chain.length - 4}</span>{/if}
  </button>
{/snippet}

<div class="desk studio-tokens" role="dialog" aria-label="Mixer">
  <header>
    <h2>Mixer</h2>
    <span class="note">Every sound with its trim, effects, EQ, sends, pan and level. Arm channels to choose which stems Record A/V keeps.</span>
    <span class="spacer"></span>
    <button class="lit small listen" class:on={s.inputOn} aria-pressed={s.inputOn} onclick={() => (s.inputOn ? stopLiveInput() : void startLiveInput())} title={s.inputOn ? 'Stop listening to the band inputs' : 'Listen to every band input'}>{s.inputOn ? 'Inputs on' : 'Inputs off'}</button>
    {#if s.liveInputs.length < MAX_LIVE_INPUTS}
      <button class="lit small" onclick={addBandInput} title="Add a band input with its own strip: another instrument, or another channel of the same interface">Add input</button>
    {/if}
    <button class="close" onclick={onclose} aria-label="Close the mixer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
  </header>
  <div class="body">
    <div class="strips">
      {#each channels as id, n (id)}
        {@const st = stripFor(s.mixer, id)}
        {@const g = gainOf(id)}
        {@const i = inputAt(id)}
        {@const input = i >= 0 ? s.liveInputs[i] : null}
        {@const ist = i >= 0 ? status[i] : undefined}
        <div class="strip" class:input={!!input}>
          <span class="num">
            {#if input}<span class="led" class:on={!!ist?.on && ist.level > 0} class:ready={!!ist?.on} class:error={!!ist?.error} title={ist?.error ?? (ist?.on ? 'Listening' : 'Not listening')}></span>{/if}
            {n + 1}
            {#if input && s.liveInputs.length > 1}<button class="x" onclick={() => musicStudio.removeLiveInput(i)} title="Remove {labelOf(id)}; the inputs after it move up" aria-label="Remove {labelOf(id)}">×</button>{/if}
          </span>
          <div class="trim">
            <StudioKnob label="Trim" value={st.trim ?? 0} min={-12} max={12} defaultValue={0} size={20} format={dbKnob} onchange={(v) => set(id, { trim: Math.round(v * 2) / 2 })} midiPath="studio:mix.{id}.trim" />
            {#if input}
              <StudioKnob label="Sens" value={input.sensitivity} defaultValue={0.5} size={20} format={(v) => `${Math.round(v * 100)}%`} title="How quietly {labelOf(id)} can be played and still move the visuals" onchange={(v) => musicStudio.setLiveInput(i, { sensitivity: v })} />
            {/if}
          </div>
          {#if input}
            <span class="section">Input</span>
            <div class="io">
              <InputSourceSelect index={i} compact class="io-sel" />
              <select class="io-sel" value={input.channel} aria-label="Channel {labelOf(id)} hears" title="Which channel of the device it hears. A stereo interface sends its two inputs as 1 and 2; Mix hears them together." onchange={(e) => musicStudio.setLiveInput(i, { channel: Number(e.currentTarget.value) })}>
                {#each channelChoices(ist?.channels ?? null, input.channel) as c (c)}<option value={c}>{c < 0 ? 'Channel: mix' : `Channel ${channelLabel(c)}`}</option>{/each}
              </select>
              <select class="io-sel" value={input.role} aria-label="What the visuals see {labelOf(id)} as" title="What the visuals see it as" onchange={(e) => musicStudio.setLiveInput(i, { role: e.currentTarget.value as VoiceSourceId })}>
                {#each PART_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
              </select>
            </div>
          {:else}
            <span class="section">Insert</span>
            {@render inserts(id)}
          {/if}
          <span class="section">EQ</span>
          <div class="eq">
            <StudioKnob label="High" value={st.high} min={-EQ_RANGE_DB} max={EQ_RANGE_DB} defaultValue={0} size={18} format={dbKnob} onchange={(v) => set(id, { high: Math.round(v * 2) / 2 })} />
            <StudioKnob label="Mid" value={st.mid} min={-EQ_RANGE_DB} max={EQ_RANGE_DB} defaultValue={0} size={18} format={dbKnob} onchange={(v) => set(id, { mid: Math.round(v * 2) / 2 })} />
            <StudioKnob label="Freq" value={st.midFreq ?? 1100} min={200} max={5000} defaultValue={1100} size={18} format={hz} onchange={(v) => set(id, { midFreq: Math.round(v) })} />
            <StudioKnob label="Low" value={st.low} min={-EQ_RANGE_DB} max={EQ_RANGE_DB} defaultValue={0} size={18} format={dbKnob} onchange={(v) => set(id, { low: Math.round(v * 2) / 2 })} />
          </div>
          <button class="lit small" class:on={st.lowCut} aria-pressed={!!st.lowCut} onclick={() => set(id, { lowCut: !st.lowCut })} title="Low cut: roll off below about 90 Hz">Low cut</button>
          <span class="section">Send</span>
          <div class="sends">
            {#each RETURN_IDS as r (r)}
              <StudioKnob label={RETURN_LABELS[r].slice(0, 3)} value={st.sends?.[r] ?? 0} size={18} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => setSend(id, r, v)} title="{labelOf(id)} to the {RETURN_LABELS[r].toLowerCase()}" midiPath="studio:mix.{id}.send.{r}" />
            {/each}
          </div>
          <span class="section">Pan</span>
          <StudioKnob label="Pan" value={st.pan} min={-1} max={1} defaultValue={0} size={24} format={formatPan} onchange={(v) => set(id, { pan: Math.abs(v) < 0.04 ? 0 : v })} midiPath="studio:mix.{id}.pan" />
          <div class="readout"><span title="Fader, dB">{formatDb(gainToDb(g))}</span><span class="pk" class:hot={clips[id]} title="Peak, dB">{peakDb(peaks[id] ?? 0)}</span></div>
          <div class="throw">
            <DeskFader label="{labelOf(id)} level" gain={g} onchange={(v) => setGain(id, v)} midiPath="studio:mix.{id}.volume" />
            <DeskMeter levels={[levels[id] ?? 0]} peaks={[peaks[id] ?? 0]} clip={!!clips[id]} onclear={() => (clips = { ...clips, [id]: false })} />
          </div>
          <div class="buttons">
            <button class="lit mute" class:on={st.mute} aria-pressed={st.mute} onclick={() => set(id, { mute: !st.mute })} title="Mute" data-midi-path="studio:mix.{id}.mute" data-midi-label="{labelOf(id)} mute" data-midi-mode="toggle">M</button>
            <button class="lit solo" class:on={st.solo} aria-pressed={st.solo} onclick={() => set(id, { solo: !st.solo })} title="Solo" data-midi-path="studio:mix.{id}.solo" data-midi-label="{labelOf(id)} solo" data-midi-mode="toggle">S</button>
            <button class="lit arm" class:on={st.arm} aria-pressed={!!st.arm} onclick={() => set(id, { arm: !st.arm })} title="Record arm: keep a stem of it with Record A/V">R</button>
            {#if input}
              <button class="lit hear" class:on={input.monitor} aria-pressed={input.monitor} onclick={() => musicStudio.setLiveInput(i, { monitor: !input.monitor })} title="Hear it through the mix. Off, it only drives the visuals and the band effects.">H</button>
            {/if}
          </div>
          {#if input}
            <input class="scribble" style="--fam: {family(id)}" type="text" value={input.name} placeholder={labelOf(id)} maxlength="24" spellcheck="false" aria-label="Name of input {i + 1}" title="What the band calls this input" onchange={(e) => musicStudio.setLiveInput(i, { name: e.currentTarget.value })} />
          {:else}
            <span class="scribble" style="--fam: {family(id)}">{labelOf(id)}</span>
          {/if}
        </div>
      {/each}
      {#each RETURN_IDS as r, n (r)}
        <div class="strip return">
          <span class="num">R{n + 1}</span>
          <span class="section">Return</span>
          <div class="return-note">Shared {RETURN_LABELS[r].toLowerCase()}, fed by every strip's send</div>
          <div class="readout"><span>{formatDb(gainToDb(s.returns[r]))}</span></div>
          <div class="throw">
            <DeskFader label="{RETURN_LABELS[r]} return" gain={s.returns[r]} onchange={(v) => musicStudio.setReturn(r, Math.min(1, v))} midiPath="studio:mix.return.{r}" />
          </div>
          <span class="scribble" style="--fam: var(--studio-muted)">{RETURN_LABELS[r]}</span>
        </div>
      {/each}
    </div>
    <div class="strip master">
      <span class="num">Main</span>
      <span class="section">Insert</span>
      {@render inserts('master')}
      <div class="readout"><span>{formatDb(gainToDb(s.masterVolume))}</span><span class="pk" class:hot={clips.master}>{peakDb(Math.max(masterPeak[0], masterPeak[1]))}</span></div>
      <div class="throw">
        <DeskFader label="Master level" gain={s.masterVolume} onchange={(v) => musicStudio.setMasterVolume(v)} midiPath="studio:mix.master" />
        <DeskMeter levels={master} peaks={masterPeak} clip={!!clips.master} onclear={() => (clips = { ...clips, master: false })} />
      </div>
      <span class="scribble" style="--fam: var(--studio-ink)">Master</span>
    </div>
  </div>
</div>

<style>
  .desk {
    position: absolute;
    left: 14px;
    right: 14px;
    top: calc(var(--ga-bar-h, 48px) + 48px);
    bottom: 12px;
    z-index: 7;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge);
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
    color: var(--studio-ink);
  }
  header { display: flex; align-items: center; gap: 12px; }
  h2 { margin: 0; font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); }
  .note { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .spacer { flex: 1; }
  .close { flex: 0 0 auto; width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); cursor: pointer; }
  .close svg { width: 14px; height: 14px; }
  .body { flex: 1; min-height: 0; display: flex; gap: 6px; }
  .strips { flex: 1; min-width: 0; display: flex; gap: 3px; overflow-x: auto; overflow-y: hidden; padding-bottom: 4px; }
  /* A hardware strip: a raised panel with a soft bevel. */
  .strip {
    flex: 0 0 88px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 4px 5px;
    border-radius: 4px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--studio-cell) 88%, #fff 6%), var(--studio-cell));
    border: 1px solid var(--studio-edge-soft);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), inset 0 -1px 0 rgba(0, 0, 0, 0.4), 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .strip.master { flex-basis: 112px; border-color: var(--studio-edge); }
  .strip.input { flex-basis: 108px; }
  .num { display: flex; align-items: center; gap: 4px; }
  .trim { display: flex; gap: 6px; }
  .io { width: 100%; display: flex; flex-direction: column; gap: 2px; }
  .io :global(.io-sel) {
    width: 100%;
    min-width: 0;
    height: 16px;
    padding: 0 2px;
    border: 1px solid rgba(0, 0, 0, 0.5);
    border-radius: 2px;
    background: var(--studio-slot, #050608);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7);
    color: var(--studio-ink);
    font: inherit;
    font-size: 9px;
  }
  .led { width: 6px; height: 6px; border-radius: 50%; background: var(--studio-edge); }
  .led.ready { background: var(--studio-slot); box-shadow: inset 0 0 0 1px var(--studio-accent); }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 5px var(--studio-accent); }
  .led.error { background: var(--ga-rec, #ff3b30); box-shadow: none; }
  .x { width: 14px; height: 14px; padding: 0; border: 0; background: transparent; color: var(--studio-muted); font: inherit; font-size: 12px; line-height: 1; cursor: pointer; }
  .x:hover { color: var(--studio-ink); }
  header .lit.small { height: 22px; }
  .lit.hear.on { color: #000; background: var(--studio-jack-cv, #7ec8e3); box-shadow: 0 0 6px var(--studio-jack-cv, #7ec8e3); }
  input.scribble { border: 0; font: inherit; font-size: 9px; font-weight: 700; letter-spacing: 0.06em; text-align: center; text-transform: uppercase; min-width: 0; }
  input.scribble::placeholder { color: var(--fam); opacity: 1; }
  input.scribble:focus { outline: 1px solid var(--studio-accent); text-transform: none; letter-spacing: 0; }
  .num { min-height: 14px; font-family: var(--ga-font-mono, ui-monospace); font-size: 9px; color: var(--studio-muted); }
  .section {
    align-self: stretch;
    padding-top: 3px;
    border-top: 1px solid rgba(0, 0, 0, 0.45);
    box-shadow: 0 -1px 0 rgba(255, 255, 255, 0.05);
    font-size: 8px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    text-align: center;
    color: var(--studio-muted);
  }
  .inserts {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 2px;
    border: 1px solid rgba(0, 0, 0, 0.5);
    background: var(--studio-slot, #050608);
    border-radius: 2px;
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7);
    cursor: pointer;
    font: inherit;
  }
  .inserts.open, .inserts:hover { border-color: var(--studio-accent); }
  .slot { height: 11px; padding: 0 3px; font-size: 8px; line-height: 11px; text-align: left; border-radius: 1px; background: rgba(255, 255, 255, 0.03); color: var(--studio-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot.used { background: color-mix(in srgb, var(--studio-accent) 22%, transparent); }
  .slot.off { color: var(--studio-muted); text-decoration: line-through; background: rgba(255, 255, 255, 0.03); }
  .more { font-size: 8px; color: var(--studio-muted); }
  .eq { display: grid; grid-template-columns: 1fr 1fr; gap: 2px 4px; }
  .sends { display: flex; gap: 2px; }
  .eq :global(.knob-wrap), .sends :global(.knob-wrap) { min-width: 0; gap: 0; }
  .eq :global(.knob-label), .sends :global(.knob-label) { font-size: 8px; }
  .readout { display: flex; gap: 6px; font-family: var(--ga-font-mono, ui-monospace); font-size: 9px; font-variant-numeric: tabular-nums; padding: 1px 4px; border-radius: 2px; background: var(--studio-slot, #050608); box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7); }
  .pk { color: var(--studio-muted); }
  .pk.hot { color: var(--ga-rec, #ff3b30); }
  .throw { flex: 1; min-height: 140px; width: 100%; display: flex; gap: 2px; justify-content: center; }
  .buttons { display: flex; gap: 3px; }
  /* Lit square buttons. */
  .lit {
    width: 22px;
    height: 18px;
    padding: 0;
    border: 1px solid rgba(0, 0, 0, 0.6);
    border-radius: 2px;
    background: linear-gradient(180deg, color-mix(in srgb, var(--studio-cell) 80%, #fff 8%), var(--studio-cell));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08), 0 1px 2px rgba(0, 0, 0, 0.5);
    color: var(--studio-muted);
    font: inherit;
    font-size: 9px;
    font-weight: 700;
    cursor: pointer;
  }
  .lit.small { width: auto; padding: 0 6px; font-size: 8px; text-transform: uppercase; letter-spacing: 0.06em; }
  .lit.on { color: var(--studio-on-accent); background: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent), inset 0 1px 0 rgba(255, 255, 255, 0.25); }
  .lit.mute.on { background: color-mix(in srgb, var(--ga-green, #46d18a) 45%, var(--ga-rec, #ff3b30)); box-shadow: 0 0 6px color-mix(in srgb, var(--ga-green, #46d18a) 45%, var(--ga-rec, #ff3b30)); color: #000; }
  .lit.arm.on { background: var(--ga-rec, #ff3b30); box-shadow: 0 0 6px var(--ga-rec, #ff3b30); color: #fff; }
  /* The scribble strip: a lit name plate, coloured by family. */
  .scribble {
    align-self: stretch;
    padding: 3px 4px;
    border-radius: 2px;
    background: var(--studio-slot, #050608);
    box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.7);
    color: var(--fam);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-align: center;
    text-transform: uppercase;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .return-note { flex: 0 0 auto; font-size: 8px; line-height: 1.3; text-align: center; color: var(--studio-muted); }
</style>
