<script lang="ts">
  /**
   * The full mixer: a strip for every sound the studio makes, whatever the
   * set, then each band input, the shared returns and, pinned at the right,
   * the master. Top to bottom a strip has its insert effects (click to edit
   * the chain), its sends to the reverb, echo and spring, pan, the fader's dB
   * and the peak, the fader beside a meter with a clip light, mute and solo,
   * and its name. It is the same state as the Mixer tab: one mixer.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { CHANNEL_LABELS, INPUT_CHANNELS, formatPan, isInputChannel, liveInputLabel, stripFor, type ChannelId } from '../../music/mixer';
  import { INSTRUMENTS, type InstrumentId } from '../../music/noteEvents';
  import { channelLevels } from '../../music/musicRuntime';
  import { macroFxDef } from '../../music/macroFx';
  import { RETURN_IDS, RETURN_LABELS, type ReturnId } from '../../music/sendReturns';
  import { insertEditorChannel } from '../../music/studioUi';
  import StudioKnob from './StudioKnob.svelte';
  import StudioFader from './StudioFader.svelte';

  let { onclose }: { onclose: () => void } = $props();

  const s = $derived($musicStudio);
  /** Every instrument, then the band inputs in use. */
  const channels = $derived<ChannelId[]>([...INSTRUMENTS, ...INPUT_CHANNELS.slice(0, Math.max(1, s.liveInputs.length))]);

  /** A family colour from the studio's own tokens: drums, bass, melodic, effects, band. */
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

  function volumeOf(id: ChannelId): number {
    const i = isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1;
    return i >= 0 ? (s.liveInputs[i]?.volume ?? 0.5) : s.volumes[id as InstrumentId];
  }

  function setVolume(id: ChannelId, v: number) {
    const i = isInputChannel(id) ? INPUT_CHANNELS.indexOf(id) : -1;
    if (i >= 0) musicStudio.setLiveInput(i, { volume: v });
    else musicStudio.setVolume(id as InstrumentId, v);
  }

  const db = (v: number) => (v <= 0.0005 ? '-∞' : `${(20 * Math.log10(v)).toFixed(1)}`);

  function setSend(id: ChannelId, r: ReturnId, v: number) {
    const st = stripFor(s.mixer, id);
    musicStudio.setStrip(id, { sends: { reverb: 0, echo: 0, spring: 0, ...st.sends, [r]: v } });
  }

  // One meter tick for every strip: about thirty times a second, with a falling peak hold and a clip light.
  let levels = $state<Partial<Record<ChannelId, number>>>({});
  let peaks = $state<Partial<Record<ChannelId, number>>>({});
  let clipped = $state<Partial<Record<ChannelId, boolean>>>({});
  onMount(() => {
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 33) {
        last = t;
        const next = channelLevels(channels);
        const p = { ...peaks };
        const c = { ...clipped };
        for (const id of channels) {
          const v = next[id] ?? 0;
          p[id] = Math.max(v, (p[id] ?? 0) - 0.012);
          if (v > 0.98) c[id] = true;
        }
        levels = next;
        peaks = p;
        clipped = c;
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

  /** The meter's level (0-1, -60 to 0 dB) as dB. */
  const meterDb = (v: number) => (v <= 0.001 ? '-∞' : `${Math.round(v * 60 - 60)}`);
</script>

{#snippet inserts(channel: string)}
  {@const chain = s.inserts[channel] ?? []}
  <button class="inserts" class:open={$insertEditorChannel === channel} onclick={() => insertEditorChannel.set($insertEditorChannel === channel ? null : channel)} title="Insert effects: click to add, reorder, bypass and edit">
    {#each chain.slice(0, 4) as fx (fx.id)}<span class="slot" class:off={!fx.enabled}>{macroFxDef(fx.type).label}</span>{/each}
    {#if chain.length > 4}<span class="slot more">+{chain.length - 4}</span>{/if}
    {#if !chain.length}<span class="slot empty">Add effect</span>{/if}
  </button>
{/snippet}

<div class="desk studio-tokens" role="dialog" aria-label="Mixer">
  <header>
    <h2>Mixer</h2>
    <span class="note">Every sound, its effects, sends, pan and level. The same mixer as the Mixer tab.</span>
    <span class="spacer"></span>
    <button class="close" onclick={onclose} aria-label="Close the mixer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
  </header>
  <div class="body">
    <div class="strips">
      {#each channels as id (id)}
        {@const st = stripFor(s.mixer, id)}
        {@const vol = volumeOf(id)}
        <div class="strip">
          {@render inserts(id)}
          <div class="sends">
            {#each RETURN_IDS as r (r)}
              <StudioKnob label={RETURN_LABELS[r]} value={st.sends?.[r] ?? 0} size={20} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => setSend(id, r, v)} title="{labelOf(id)} to the {RETURN_LABELS[r].toLowerCase()}" midiPath="studio:mix.{id}.send.{r}" />
            {/each}
          </div>
          <div class="out" title="Output: the master">→ Master</div>
          <StudioKnob label="Pan" value={st.pan} min={-1} max={1} defaultValue={0} size={26} format={formatPan} onchange={(v) => musicStudio.setStrip(id, { pan: Math.abs(v) < 0.02 ? 0 : v })} midiPath="studio:mix.{id}.pan" />
          <div class="readout"><span title="Fader">{db(vol)}</span><span class="peak" class:clip={clipped[id]} title="Peak, dB (click to clear the clip light)" onclick={() => (clipped = { ...clipped, [id]: false })} role="button" tabindex="-1" onkeydown={() => {}}>{meterDb(peaks[id] ?? 0)}</span></div>
          <div class="level" data-midi-path="studio:mix.{id}.volume" data-midi-label="{labelOf(id)} level">
            <StudioFader label="{labelOf(id)} level" value={vol} defaultValue={isInputChannel(id) ? 0.5 : 0.8} onchange={(v) => setVolume(id, v)} />
            <span class="meter" aria-hidden="true">
              <span class="fill" class:hot={(levels[id] ?? 0) > 0.95} style="height: {(levels[id] ?? 0) * 100}%"></span>
              <span class="hold" style="bottom: {(peaks[id] ?? 0) * 100}%"></span>
              <span class="cliplight" class:on={clipped[id]}></span>
            </span>
          </div>
          <div class="ms">
            <button class="chip" class:on={st.mute} aria-pressed={st.mute} onclick={() => musicStudio.setStrip(id, { mute: !st.mute })} data-midi-path="studio:mix.{id}.mute" data-midi-label="{labelOf(id)} mute" data-midi-mode="toggle">M</button>
            <button class="chip" class:on={st.solo} aria-pressed={st.solo} onclick={() => musicStudio.setStrip(id, { solo: !st.solo })} data-midi-path="studio:mix.{id}.solo" data-midi-label="{labelOf(id)} solo" data-midi-mode="toggle">S</button>
          </div>
          <span class="name" style="color: {family(id)}">{labelOf(id)}</span>
        </div>
      {/each}
      {#each RETURN_IDS as r (r)}
        <div class="strip return">
          <div class="inserts static"><span class="slot empty">Shared return</span></div>
          <div class="out">→ Master</div>
          <div class="readout"><span>{db(s.returns[r])}</span></div>
          <div class="level" data-midi-path="studio:mix.return.{r}" data-midi-label="{RETURN_LABELS[r]} return level">
            <StudioFader label="{RETURN_LABELS[r]} return" value={s.returns[r]} defaultValue={0.7} onchange={(v) => musicStudio.setReturn(r, v)} />
          </div>
          <span class="name">{RETURN_LABELS[r]} return</span>
        </div>
      {/each}
    </div>
    <div class="strip master">
      {@render inserts('master')}
      <div class="readout"><span>{db(s.masterVolume)}</span></div>
      <div class="level" data-midi-path="studio:mix.master" data-midi-label="Master level">
        <StudioFader label="Master level" value={s.masterVolume} defaultValue={0.85} onchange={(v) => musicStudio.setMasterVolume(v)} />
      </div>
      <span class="name">Master</span>
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
  .note { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .spacer { flex: 1; }
  .close { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); cursor: pointer; }
  .close svg { width: 14px; height: 14px; }
  .body { flex: 1; min-height: 0; display: flex; gap: 6px; }
  .strips { flex: 1; min-width: 0; display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
  .strip {
    flex: 0 0 84px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 6px 4px;
    background: var(--studio-cell);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
    min-height: 0;
  }
  .strip.master { flex-basis: 96px; border-color: var(--studio-edge); }
  .inserts {
    width: 100%;
    min-height: 62px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-slot);
    border-radius: 3px;
    cursor: pointer;
    font: inherit;
    text-align: left;
  }
  .inserts.static { cursor: default; }
  .inserts.open, .inserts:hover:not(.static) { border-color: var(--studio-accent); }
  .slot { display: block; padding: 1px 4px; font-size: 10px; color: var(--studio-ink); background: var(--studio-cell); border-radius: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .slot.off { color: var(--studio-muted); text-decoration: line-through; }
  .slot.empty, .slot.more { background: transparent; color: var(--studio-muted); }
  .sends { display: flex; flex-direction: column; gap: 2px; align-items: center; }
  .sends :global(.knob-wrap) { flex-direction: row; gap: 4px; }
  .out { font-size: 9px; color: var(--studio-muted); }
  .readout { display: flex; gap: 6px; font-family: var(--ga-font-mono, ui-monospace); font-size: 10px; font-variant-numeric: tabular-nums; }
  .peak { color: var(--studio-muted); cursor: pointer; }
  .peak.clip { color: var(--ga-rec, #ff3b30); }
  .level { flex: 1; min-height: 90px; display: flex; gap: 4px; align-items: stretch; }
  .meter { position: relative; width: 6px; background: var(--studio-slot); border-radius: 2px; overflow: hidden; }
  .fill { position: absolute; left: 0; right: 0; bottom: 0; background: var(--ga-green, #46d18a); }
  .fill.hot { background: var(--ga-rec, #ff3b30); }
  .hold { position: absolute; left: 0; right: 0; height: 2px; background: var(--studio-ink); }
  .cliplight { position: absolute; left: 0; right: 0; top: 0; height: 4px; background: transparent; }
  .cliplight.on { background: var(--ga-rec, #ff3b30); }
  .ms { display: flex; gap: 3px; }
  .chip { width: 24px; height: 20px; padding: 0; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-muted); border-radius: 3px; font: inherit; font-size: 10px; font-weight: 700; cursor: pointer; }
  .chip.on { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; }
</style>
