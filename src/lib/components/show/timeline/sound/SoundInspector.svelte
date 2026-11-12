<script lang="ts">
  /**
   * The Timeline's sound inspector: a sound row (its Music Studio effects,
   * ducking, or the Live track it plays), an audio block (timing, fades,
   * level), a Live clip block (which clip) or a build block (its style).
   * Every effect knob has a ◆: a point at the playhead on that knob's line.
   */
  import { get } from 'svelte/store';
  import { showTimeline, type ShowTimelineSelection } from '../../../../stores/showTimeline';
  import { abletonBridge } from '../../../../ableton/abletonBridge';
  import { MACRO_FX, macroFxDef, type MacroFxType } from '../../../../music/macroFx';
  import { BUILD_FILTERS, BUILD_ROLLS, BUILD_STYLES, type BuildStyle } from '../../../../music/buildDrop';
  import { soundGroups } from '../../../../music/sounds/library';
  import { addLineWithPoint } from '../../../../timeline/lines/timelineLines';
  import { LIVE_TIMELINE_PROTOCOL, resolveLiveTrack } from '../../../../timeline/sound/liveSchedule';
  import type { SoundRow } from '../../../../timeline/sound/soundModel';
  import {
    addBuildBlock,
    addFx,
    addLibrarySound,
    addLiveBlock,
    bindLiveTrack,
    clipSeconds,
    moveAudioBlock,
    moveFx,
    removeBuildBlock,
    removeFx,
    removeLiveBlock,
    removeRow,
    renameRow,
    setAudioFade,
    setDuck,
    setFxParam,
    setLiveBlockClip,
    setLiveBlockTiming,
    setLiveOptions,
    toggleFx,
    trimAudioBlock,
    updateBuildBlock,
  } from '../../../../timeline/sound/soundCommands';
  import { formatPrecise } from '../timeFormat';
  import { showSlice } from '../timelineSlices';
  import { liveColor, soundLayout } from './soundRowLayout';

  interface Props {
    selection: ShowTimelineSelection;
    onclose: () => void;
  }
  let { selection, onclose }: Props = $props();

  const tracksStore = showSlice('audioTracks');
  const soundStore = showSlice('sound');
  const tempoStore = showSlice('tempo');
  const layout = $derived($soundLayout);
  const bridge = $derived($abletonBridge);

  const row = $derived(selection.kind === 'soundRow' ? layout.rows.find((r) => r.id === selection.id) ?? null : null);
  const track = $derived(selection.kind === 'audio' ? $tracksStore.find((t) => t.id === selection.id) ?? null : null);
  const live = $derived(selection.kind === 'liveClip' ? $soundStore.live.find((b) => b.id === selection.id) ?? null : null);
  const build = $derived(selection.kind === 'build' ? $soundStore.builds.find((b) => b.id === selection.id) ?? null : null);
  const liveRow = $derived(live ? layout.rows[live.lane] ?? null : null);
  const scriptOld = $derived(bridge.connected && bridge.protocol > 0 && bridge.protocol < LIVE_TIMELINE_PROTOCOL);
  const rowOptions = $derived(row ? layout.rows.filter((r) => r.id !== row.id && r.kind === 'audio') : []);
  const groups = soundGroups((s) => s.kind !== 'loop');

  function clipsOf(r: SoundRow | null) {
    if (!r) return [];
    const ti = resolveLiveTrack(r.live, bridge.tracks);
    if (ti === null) return [];
    return bridge.tracks[ti].slots.flatMap((c, slot) => (c ? [{ slot, name: c.name, color: c.color, length: c.length }] : []));
  }

  function commit(e: Event, apply: (v: number) => void) {
    const v = parseFloat((e.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(v)) apply(v);
  }
  const playhead = () => get(showTimeline).currentTime;

  function addEffect(e: Event, r: SoundRow) {
    const sel = e.currentTarget as HTMLSelectElement;
    if (sel.value) addFx(r.id, sel.value as MacroFxType);
    sel.value = '';
  }
  function addSound(e: Event, r: SoundRow) {
    const sel = e.currentTarget as HTMLSelectElement;
    if (sel.value) void addLibrarySound(r.id, sel.value, playhead());
    sel.value = '';
  }
  function duckChoice(e: Event, r: SoundRow) {
    const v = (e.currentTarget as HTMLSelectElement).value;
    setDuck(r.id, v ? { source: v, depth: r.duck?.depth ?? 0.6, release: r.duck?.release ?? 0.25 } : null);
  }
  function pickTrack(e: Event, r: SoundRow) {
    const i = Number((e.currentTarget as HTMLSelectElement).value);
    if (Number.isInteger(i) && i >= 0 && bridge.tracks[i]) bindLiveTrack(r.id, i, bridge.tracks[i].name);
  }
  function applyStyle(id: string, style: BuildStyle) {
    const preset = BUILD_STYLES.find((s) => s.id === style);
    if (preset) updateBuildBlock(id, { style, roll: preset.settings.roll, filter: preset.settings.filter, riser: preset.settings.riser, sends: preset.settings.sends, gap: preset.settings.gap, impact: preset.settings.impact });
  }
</script>

<div class="show-inspector sound-inspector" data-sound-inspector>
  {#if row}
    <span class="insp-title">{row.kind === 'live' ? 'Live row' : 'Sound row'}</span>
    <label class="insp-field">
      <span>Name</span>
      <input class="insp-text" type="text" value={row.name} onchange={(e) => renameRow(row.id, (e.currentTarget as HTMLInputElement).value)} />
    </label>
    {#if row.kind === 'audio'}
      <div class="fx-chain" data-sound-fx-chain>
        {#each row.fx as fx, i (fx.id)}
          {@const def = macroFxDef(fx.type)}
          <div class="fx-unit" class:off={!fx.enabled} data-sound-fx={fx.type}>
            <div class="fx-head">
              <button class="fx-power" class:on={fx.enabled} onclick={() => toggleFx(row.id, fx.id)} title="Effect on / off">⏻</button>
              <span class="fx-name">{def.label}</span>
              <button class="fx-mini" disabled={i === 0} onclick={() => moveFx(row.id, fx.id, -1)} title="Earlier in the chain">↑</button>
              <button class="fx-mini" disabled={i === row.fx.length - 1} onclick={() => moveFx(row.id, fx.id, 1)} title="Later in the chain">↓</button>
              <button class="fx-mini" onclick={() => removeFx(row.id, fx.id)} title="Remove the effect">×</button>
            </div>
            {#each def.params as p (p.key)}
              {@const v = fx.params[p.key]?.value ?? p.value}
              <div class="fx-param">
                <button class="fx-diamond" onclick={() => addLineWithPoint({ scope: 'sound', id: row.id }, `sfx:${fx.id}:${p.key}`, playhead(), v)} title={`◆ ${p.label}: a point at the playhead on this knob's line, at the knob's value`} data-line-key={`sfx:${fx.id}:${p.key}`}>◆</button>
                <span class="fx-label" title={p.label}>{p.label}</span>
                <input type="range" min="0" max="1" step="0.01" value={v} oninput={(e) => setFxParam(row.id, fx.id, p.key, +(e.currentTarget as HTMLInputElement).value)} data-sound-fx-param={p.key} />
                <span class="fx-value" title={p.format(v, 120)}>{p.format(v, 120)}</span>
              </div>
            {/each}
          </div>
        {/each}
        <label class="insp-field fx-add">
          <select onchange={(e) => addEffect(e, row)} data-sound-add-fx>
            <option value="">+ Effect…</option>
            <optgroup label="Studio">
              {#each MACRO_FX.filter((d) => d.group !== 'wild') as d (d.type)}<option value={d.type}>{d.label}</option>{/each}
            </optgroup>
            <optgroup label="Wild">
              {#each MACRO_FX.filter((d) => d.group === 'wild') as d (d.type)}<option value={d.type} title={d.blurb}>{d.label}</option>{/each}
            </optgroup>
          </select>
        </label>
      </div>
      <label class="insp-field">
        <span>Duck</span>
        <select value={row.duck?.source ?? ''} onchange={(e) => duckChoice(e, row)} data-sound-duck>
          <option value="">Off</option>
          <option value="beat">On every beat</option>
          {#each rowOptions as r (r.id)}<option value={r.id}>Under {r.name}'s kick</option>{/each}
        </select>
      </label>
      {#if row.duck}
        <label class="insp-field">
          <button class="fx-diamond" onclick={() => addLineWithPoint({ scope: 'sound', id: row.id }, 'duck:depth', playhead(), row.duck!.depth)} title="◆ Duck depth: a point at the playhead on its line" data-line-key="duck:depth">◆</button>
          <span>Depth</span>
          <input type="range" min="0" max="1" step="0.01" value={row.duck.depth} oninput={(e) => setDuck(row.id, { ...row.duck!, depth: +(e.currentTarget as HTMLInputElement).value })} />
        </label>
        <label class="insp-field">
          <span>Release</span>
          <input type="range" min="0.05" max="1.2" step="0.01" value={row.duck.release} oninput={(e) => setDuck(row.id, { ...row.duck!, release: +(e.currentTarget as HTMLInputElement).value })} />
          <span class="insp-unit">{Math.round(row.duck.release * 1000)} ms</span>
        </label>
      {/if}
      <label class="insp-field">
        <select onchange={(e) => addSound(e, row)} data-sound-add-library>
          <option value="">+ Sound at the playhead…</option>
          {#each groups as g}
            <optgroup label={g.label}>
              {#each g.sounds as s (s.id)}<option value={s.id} title={s.blurb}>{s.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
      </label>
      <button class="insp-btn" onclick={() => addBuildBlock(row.id, playhead())} data-sound-add-build>+ Build → drop</button>
      <span class="insp-hint">Render to Video plays this row's sound as you hear it: files, levels, fades and effects.</span>
    {:else}
      <label class="insp-field">
        <span>Live track</span>
        <select value={String(resolveLiveTrack(row.live, bridge.tracks) ?? '')} onchange={(e) => pickTrack(e, row)} disabled={!bridge.tracks.length} data-live-track>
          <option value="">{bridge.tracks.length ? 'Pick a track…' : 'Live not connected'}</option>
          {#each bridge.tracks as t, i}<option value={String(i)}>{t.name}</option>{/each}
        </select>
      </label>
      <label class="insp-field">
        <span>Starts</span>
        <select value={row.live?.launch ?? 'beat'} onchange={(e) => setLiveOptions(row.id, { launch: (e.currentTarget as HTMLSelectElement).value as 'beat' | 'bar' | 'set' })} data-live-launch>
          <option value="beat">On the beat</option>
          <option value="bar">On the bar</option>
          <option value="set">On the set's launch quantize</option>
        </select>
      </label>
      <label class="insp-field">
        <span>Latency</span>
        <input type="number" min="0" max="500" step="1" value={row.live?.latencyMs ?? 20} onchange={(e) => commit(e, (v) => setLiveOptions(row.id, { latencyMs: Math.max(0, Math.min(500, v)) }))} data-live-latency />
        <span class="insp-unit">ms</span>
      </label>
      <span class="live-clips" role="group" aria-label="Clips on the Live track">
        {#each clipsOf(row) as c (c.slot)}
          <button class="live-chip" style="--clip: {liveColor(c.color)}" onclick={() => addLiveBlock(row.id, c, playhead())} title="Place this clip at the playhead" data-live-chip={c.slot}>{c.name || `Slot ${c.slot + 1}`}</button>
        {/each}
      </span>
      {#if scriptOld}
        <span class="insp-warn">Update the Ghost Arcade script in Live (Ableton panel) to start clips exactly on the beat and part way through.</span>
      {/if}
      <span class="insp-hint">Live clips play in Live and can't be rendered: Render to Video uses the Timeline's own audio only.</span>
    {/if}
    <button class="insp-delete" onclick={() => { removeRow(row.id); onclose(); }} data-sound-remove-row>Delete row</button>
  {:else if track}
    <span class="insp-title">{track.sound ? 'Sound' : 'Audio block'}</span>
    <span class="insp-name" title={track.name}>{track.name}</span>
    <label class="insp-field">
      <span>Start</span>
      <input type="number" min="0" step="0.1" value={track.startTime.toFixed(2)} onchange={(e) => commit(e, (v) => moveAudioBlock(track.id, v))} />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Length</span>
      <input type="number" min="0.25" step="0.1" value={track.duration.toFixed(2)} onchange={(e) => commit(e, (v) => trimAudioBlock(track.id, 'end', track.startTime + v))} />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Fade in</span>
      <input type="number" min="0" step="0.1" value={(track.fadeIn ?? 0).toFixed(2)} onchange={(e) => commit(e, (v) => setAudioFade(track.id, 'in', v))} data-sound-fade-in-input />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Fade out</span>
      <input type="number" min="0" step="0.1" value={(track.fadeOut ?? 0).toFixed(2)} onchange={(e) => commit(e, (v) => setAudioFade(track.id, 'out', v))} data-sound-fade-out-input />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Level</span>
      <input type="range" min="0" max="1" step="0.01" value={track.volume} oninput={(e) => showTimeline.setAudioTrackVolume(track.id, +(e.currentTarget as HTMLInputElement).value)} />
    </label>
    <button class="insp-btn" class:on={track.muted} onclick={() => showTimeline.setAudioTrackMuted(track.id, !track.muted)}>{track.muted ? 'Muted' : 'Mute'}</button>
    <span class="insp-hint">Overlap two blocks on a row to crossfade them; drag a block's top corner to fade it.</span>
    <button class="insp-delete" onclick={() => showTimeline.removeAudioTrack(track.id)}>Delete</button>
  {:else if live}
    {@const clips = clipsOf(liveRow)}
    <span class="insp-title">Live clip</span>
    <label class="insp-field">
      <span>Clip</span>
      <select value={String(live.slot)} onchange={(e) => { const c = clips.find((x) => x.slot === Number((e.currentTarget as HTMLSelectElement).value)); if (c) setLiveBlockClip(live.id, c); }} disabled={!clips.length} data-live-block-clip>
        {#if !clips.some((c) => c.slot === live.slot)}<option value={String(live.slot)}>{live.clipName || `Slot ${live.slot + 1}`} (missing)</option>{/if}
        {#each clips as c (c.slot)}<option value={String(c.slot)}>{c.name || `Slot ${c.slot + 1}`}</option>{/each}
      </select>
    </label>
    <label class="insp-field">
      <span>Start</span>
      <input type="number" min="0" step="0.1" value={live.startTime.toFixed(2)} onchange={(e) => commit(e, (v) => setLiveBlockTiming(live.id, v, live.duration))} />
      <span class="insp-unit">s</span>
    </label>
    <label class="insp-field">
      <span>Length</span>
      <input type="number" min="0.25" step="0.1" value={live.duration.toFixed(2)} onchange={(e) => commit(e, (v) => setLiveBlockTiming(live.id, live.startTime, v))} />
      <span class="insp-unit">s</span>
    </label>
    {#if clips.some((c) => c.slot === live.slot)}
      <button class="insp-btn" onclick={() => { const c = clips.find((x) => x.slot === live.slot)!; setLiveBlockTiming(live.id, live.startTime, clipSeconds(c.length, live.startTime)); }}>Length of the clip</button>
    {/if}
    <span class="insp-hint">Fired in Live at {formatPrecise(live.startTime)}, stopped at {formatPrecise(live.startTime + live.duration)} unless the next clip on the row starts there.</span>
    <button class="insp-delete" onclick={() => removeLiveBlock(live.id)}>Delete</button>
  {:else if build}
    <span class="insp-title">Build → drop</span>
    <label class="insp-field">
      <span>Style</span>
      <select value={build.style} onchange={(e) => applyStyle(build.id, (e.currentTarget as HTMLSelectElement).value as BuildStyle)} data-build-style>
        {#each BUILD_STYLES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
      </select>
    </label>
    <label class="insp-field">
      <span>Roll</span>
      <select value={build.roll} onchange={(e) => updateBuildBlock(build.id, { roll: (e.currentTarget as HTMLSelectElement).value as typeof build.roll })}>
        {#each BUILD_ROLLS as r (r.id)}<option value={r.id}>{r.label}</option>{/each}
      </select>
    </label>
    <label class="insp-field">
      <span>Filter</span>
      <select value={build.filter} onchange={(e) => updateBuildBlock(build.id, { filter: (e.currentTarget as HTMLSelectElement).value as typeof build.filter })}>
        {#each BUILD_FILTERS as f (f.id)}<option value={f.id}>{f.label}</option>{/each}
      </select>
    </label>
    {#each [['riser', 'Riser'], ['sends', 'Echo + reverb'], ['impact', 'Impact']] as [key, label]}
      <label class="insp-field">
        <span>{label}</span>
        <input type="range" min="0" max="1" step="0.01" value={build[key as 'riser']} oninput={(e) => updateBuildBlock(build.id, { [key]: +(e.currentTarget as HTMLInputElement).value }, `build:${build.id}:${key}`)} />
      </label>
    {/each}
    <label class="insp-field">
      <input type="checkbox" checked={build.gap} onchange={(e) => updateBuildBlock(build.id, { gap: (e.currentTarget as HTMLInputElement).checked })} />
      <span>Gap before the drop</span>
    </label>
    <span class="insp-hint">Lands on the block's end{$tempoStore ? '' : ' (no tempo map: 120 BPM)'}.</span>
    <button class="insp-delete" onclick={() => removeBuildBlock(build.id)}>Delete</button>
  {/if}
  <button aria-label="Close sound inspector" class="insp-close" onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex;
    align-items: center;
    gap: 8px 12px;
    min-height: 36px;
    padding: 4px 12px;
    background: var(--ga-card, #121217);
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
    flex: 0 0 auto;
    flex-wrap: wrap;
  }
  .insp-title {
    color: #FFD96B;
    font-weight: var(--ga-weight-control, 600);
    padding-right: 12px;
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .insp-name { max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--ga-ink-0, #e8e8ee); }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input[type="number"],
  .insp-field input[type="text"],
  .insp-field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    width: 64px;
    outline: none;
    font-family: inherit;
  }
  .insp-field input.insp-text { width: 120px; }
  .insp-field select { width: auto; max-width: 200px; }
  .insp-field input[type="range"] { width: 90px; accent-color: #5ce1e6; }
  .insp-unit { color: var(--ga-ink-2, #888); white-space: nowrap; }
  .insp-hint { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .insp-warn { font-size: var(--ga-text-meta, 11px); color: #ffb86b; }
  .insp-btn {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font: inherit;
    padding: 0 8px;
    cursor: pointer;
  }
  .insp-btn.on { background: #ff4757; border-color: #ff4757; }
  .fx-chain { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 6px; width: 100%; max-height: 150px; overflow-y: auto; }
  .fx-unit {
    border: 1px solid rgba(167, 139, 250, 0.35);
    border-radius: 4px;
    padding: 3px 6px 4px;
    background: rgba(167, 139, 250, 0.06);
    min-width: 190px;
  }
  .fx-unit.off { opacity: 0.5; }
  .fx-head { display: flex; align-items: center; gap: 4px; margin-bottom: 2px; }
  .fx-name { flex: 1 1 auto; font-weight: 600; color: #d6c9ff; }
  .fx-power, .fx-mini {
    background: none;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 3px;
    color: var(--ga-ink-1, #b8b8c2);
    font: inherit;
    font-size: 10px;
    padding: 0 4px;
    height: 16px;
    cursor: pointer;
  }
  .fx-power.on { color: #7ae582; border-color: rgba(122, 229, 130, 0.5); }
  .fx-mini:disabled { opacity: 0.3; cursor: default; }
  .fx-param { display: flex; align-items: center; gap: 4px; font-size: 11px; }
  .fx-label { width: 64px; color: var(--ga-ink-2, #888); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fx-param input[type="range"] { width: 80px; height: 12px; margin: 0; accent-color: #a78bfa; }
  .fx-value { width: 64px; color: var(--ga-ink-1, #b8b8c2); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .fx-diamond {
    background: none;
    border: 0;
    color: rgba(255, 217, 107, 0.7);
    font-size: 10px;
    padding: 0 2px;
    cursor: pointer;
  }
  .fx-diamond:hover { color: #FFD96B; }
  .fx-add { align-self: center; }
  .live-clips { display: inline-flex; flex-wrap: wrap; gap: 3px; }
  .live-chip {
    border: 1px solid var(--clip);
    background: color-mix(in srgb, var(--clip) 30%, transparent);
    color: #fff;
    border-radius: 3px;
    font: inherit;
    font-size: 11px;
    padding: 1px 6px;
    cursor: pointer;
  }
  .insp-delete {
    margin-left: auto;
    height: var(--ga-control-h-sm, 22px);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    font-family: inherit;
  }
  .insp-close { background: none; border: none; color: var(--ga-ink-2, #888); font-size: 16px; cursor: pointer; padding: 2px 6px; line-height: 1; }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }
</style>
