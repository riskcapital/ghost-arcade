<script lang="ts">
  /**
   * The record panel: one row per loop track, its button and header on the
   * left (name, what it plays, its layers, Undo) and its loop across the
   * bars on the right (notes, or the audio's shape) with the playhead. Save
   * opens a name field at the foot, filled in; Enter keeps it in My loops.
   * Edit docks the quick MIDI editor under the rows.
   */
  import { tick } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import {
    clearLoopTrack,
    loopStationView,
    redoLoopLayer,
    saveLoopTrack,
    selectLoopTrack,
    setLoopTrackSound,
    suggestedLoopName,
    undoLoopLayer,
    audioPeaks,
    liveTakeNotes,
    type LiveNote,
    type TrackView,
  } from '../../music/loopStation';
  import { beatNow, stateLine, trackProgress } from '../../music/loopUi';
  import { parseSoundValue, setTrackKind, wrapBeat, type LoopTrackKind } from '../../music/loopTrack';
  import { SOURCE_MENU_LABELS, trackSoundLabel, type LoopSource } from '../../music/loopSources';
  /** The tab instruments a MIDI track can record. */
  const TAB_SOURCES: LoopSource[] = ['xy', 'dub', 'pads'];
  /** What the track's menu shows: a tab instrument, an instrument, or This tab. */
  const pickValue = (t: { source?: LoopSource; instrument: InstrumentId | null }) => (t.source ? `src:${t.source}` : t.instrument ? `inst:${t.instrument}` : '');
  function pick(i: number, value: string) {
    const sound = parseSoundValue(value);
    if (sound) setLoopTrackSound(i, sound);
  }
  import { musicMidiDevices } from '../../music/midiNotes';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { INSTRUMENTS, type InstrumentId } from '../../music/noteEvents';
  import { showToast } from '../../stores/errorToast';
  import LoopTrackButton from './LoopTrackButton.svelte';
  import QuickClipEditor from './QuickClipEditor.svelte';

  const s = $derived($musicStudio);
  const view = $derived($loopStationView);
  const tracks = $derived(s.loopStation.tracks);

  let editing = $state<number | null>(null);
  let saving = $state<number | null>(null);
  let saveName = $state('');
  let saveInput = $state<HTMLInputElement | null>(null);

  async function openSave(i: number) {
    saving = i;
    saveName = suggestedLoopName(i);
    await tick();
    saveInput?.focus();
    saveInput?.select();
  }

  async function doSave() {
    if (saving === null) return;
    const i = saving;
    saving = null;
    try {
      const id = await saveLoopTrack(i, saveName.trim() || suggestedLoopName(i));
      if (!id) showToast('Nothing to save on this track yet.', 'info');
      else showToast(`Saved to My loops: ${saveName}`, 'info');
    } catch (err) {
      showToast(`Could not save to My loops (it stays in the session): ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }

  function setKind(i: number, kind: LoopTrackKind) {
    musicStudio.updateLoopStation((d) => ({ ...d, tracks: d.tracks.map((t, k) => (k === i ? setTrackKind(t, i, kind, view.tracks[i].phase === 'empty') : t)) }));
  }

  /** A device or channel that always plays this track. */
  function setLock(i: number, value: string) {
    musicStudio.updateLoopStation((d) => {
      const locks = d.locks.filter((l) => l.track !== i);
      if (value.startsWith('ch:')) locks.push({ track: i, channel: Number(value.slice(3)), device: '' });
      else if (value.startsWith('dev:')) locks.push({ track: i, channel: -1, device: value.slice(4) });
      return { ...d, locks };
    });
  }
  const lockValue = (i: number) => {
    const l = s.loopStation.locks.find((x) => x.track === i);
    return !l ? '' : l.device ? `dev:${l.device}` : `ch:${l.channel}`;
  };

  /** The beats a lane spans: the loop, or while a first take records, its length (a free one grows bar by bar). */
  function laneBeats(v: TrackView, beat: number): number {
    if (v.phase === 'record' && !(v.beats > 0)) {
      if (v.endBeat !== null && v.endBeat > v.startBeat) return v.endBeat - v.startBeat;
      return Math.max(16, Math.ceil(Math.max(0, beat - v.startBeat) / 4 + 1e-6) * 4);
    }
    return v.beats;
  }

  /**
   * Notes as thin bars, high notes higher, coral for the newest layer while
   * overdubbing and for the notes being recorded now (`live`), drawn as they
   * are played.
   */
  function noteRects(i: number, v: TrackView, live: LiveNote[], span: number) {
    const t = tracks[i];
    if (!(span > 0)) return [];
    const all = [...t.layers.flat(), ...live];
    if (!all.length) return [];
    const lo = Math.min(...all.map((n) => n.note));
    const hi = Math.max(lo + 12, ...all.map((n) => n.note));
    const y = (note: number) => 88 - ((note - lo) / (hi - lo)) * 76;
    const kept = t.beats > 0
      ? t.layers.flatMap((layer, li) =>
          layer.map((n) => ({
            x: (n.beat / t.beats) * 100,
            y: y(n.note),
            w: Math.max(0.6, (n.dur / t.beats) * 100),
            newest: li === t.layers.length - 1 && t.layers.length > 1,
          })),
        )
      : [];
    const pos = (at: number) => (v.phase === 'record' && !(v.beats > 0) ? at - v.startBeat : wrapBeat(at - v.origin, span));
    const now = live.map((n) => ({ x: (pos(n.at) / span) * 100, y: y(n.note), w: Math.max(0.6, (Math.min(n.dur, span) / span) * 100), newest: true }));
    return [...kept, ...now];
  }

  /** The playhead while a free first take records: through the bars it has so far. */
  function headAt(v: TrackView, beat: number, span: number): number {
    if (v.phase === 'record' && !(v.beats > 0) && v.endBeat === null && span > 0) return Math.max(0, Math.min(1, (beat - v.startBeat) / span));
    return trackProgress(v, beat);
  }

  function wavePath(i: number): string {
    const peaks = audioPeaks(i, 200);
    if (!peaks.length) return '';
    const top = peaks.map((p, k) => `${k === 0 ? 'M' : 'L'}${((k / (peaks.length - 1)) * 200).toFixed(1)} ${(10 - p * 9).toFixed(2)}`).join(' ');
    const bottom = [...peaks].reverse().map((p, k) => `L${(((peaks.length - 1 - k) / (peaks.length - 1)) * 200).toFixed(1)} ${(10 + p * 9).toFixed(2)}`).join(' ');
    return `${top} ${bottom} Z`;
  }

  function key(e: KeyboardEvent) {
    if (saving === null) return;
    if (e.key === 'Escape') saving = null;
  }
</script>

<div class="rows">
  {#each { length: $musicStudio.loopStation.trackCount } as _, i}
    {@const t = tracks[i]}
    {@const v = view.tracks[i]}
    {@const recording = t.kind === 'midi' && (v.phase === 'record' || v.phase === 'overdub')}
    {@const span = recording ? laneBeats(v, $beatNow) : v.beats}
    {@const live = recording ? liveTakeNotes(i, $beatNow) : []}
    {@const bars = Math.max(1, Math.round((span || 16) / 4))}
    <div class="tr" class:sel={view.selected === i}>
      <div class="hd" role="presentation" onpointerdown={() => selectLoopTrack(i, true)}>
        <LoopTrackButton index={i} />
        <div class="info">
          {#if v.phase === 'empty'}
            <div class="name empty">Empty</div>
            <div class="ga-eyebrow sub">Press to record · {s.loopStation.length ? `${s.loopStation.length} bars` : 'Free'}</div>
            <div class="pick">
              <div class="ga-segmented small" role="group" aria-label="Track kind">
                <button class:active={t.kind === 'midi'} onclick={() => setKind(i, 'midi')}>MIDI</button>
                <button class:active={t.kind === 'audio'} onclick={() => setKind(i, 'audio')}>Audio</button>
              </div>
              {#if t.kind === 'midi'}
                <select value={pickValue(t)} onchange={(e) => pick(i, (e.target as HTMLSelectElement).value)} aria-label="Instrument" title="What it records and plays: what you play on the tab showing, or a fixed instrument">
                  <option value="">This tab</option>
                  <optgroup label="Tab instruments">
                    {#each TAB_SOURCES as id}<option value="src:{id}">{SOURCE_MENU_LABELS[id]}</option>{/each}
                  </optgroup>
                  <optgroup label="Instruments">
                    {#each INSTRUMENTS.filter((id) => (id !== 'xy' && id !== 'shots') || (!t.source && t.instrument === id)) as id}<option value="inst:{id}">{INSTRUMENT_LABELS[id]}</option>{/each}
                  </optgroup>
                </select>
              {:else}
                <select value={t.input} onchange={(e) => musicStudio.updateLoopTrack(i, { input: Number((e.target as HTMLSelectElement).value) })} aria-label="Input" title="The band input it records">
                  {#each s.liveInputs as input, k}<option value={k}>Input {k + 1}{input.name ? ` · ${input.name}` : ''}</option>{/each}
                </select>
              {/if}
            </div>
          {:else}
            <div class="name">{t.name || (t.kind === 'audio' ? `Audio ${i + 1}` : trackSoundLabel(t, s.instrument))}</div>
            <div class="ga-eyebrow sub">{t.kind === 'audio' ? `Input ${t.input + 1}` : trackSoundLabel(t, s.instrument)} · {bars} bar{bars === 1 ? '' : 's'}{v.phase === 'overdub' ? ` · pass ${v.layers + 1}` : ''}</div>
            {#if stateLine(v, $beatNow)}<div class="state" class:wait={v.waiting}>{stateLine(v, $beatNow)}</div>{/if}
            <div class="chips">
              {#each { length: v.layers } as _, li}<b class:new={v.phase === 'overdub' && li === v.layers - 1}>L{li + 1}</b>{/each}
              <button onclick={() => undoLoopLayer(i)} disabled={!v.layers} title="Undo the last layer (Cmd+Z)">Undo</button>
              <button onclick={() => redoLoopLayer(i)} disabled={!v.redo} title="Redo the layer (Shift+Cmd+Z)">Redo</button>
              {#if t.kind === 'midi'}
                <select class="lock" value={lockValue(i)} onchange={(e) => setLock(i, (e.target as HTMLSelectElement).value)} aria-label="MIDI lock for track {i + 1}" title="Always play this track from one device or channel, whichever track is selected">
                  <option value="">Any MIDI (selected)</option>
                  {#each { length: 16 } as _, c}<option value={`ch:${c}`}>Channel {c + 1}{c === 9 ? ' (drums)' : ''}</option>{/each}
                  {#each $musicMidiDevices as dev (dev.id)}<option value={`dev:${dev.id}`}>{dev.name}</option>{/each}
                </select>
              {/if}
              {#if t.kind === 'midi'}<button class:on={editing === i} onclick={() => (editing = editing === i ? null : i)} title="Edit the notes under the tracks">Edit</button>{/if}
              <button onclick={() => openSave(i)} title="Save it to My loops">Save</button>
              <button onclick={() => clearLoopTrack(i)} title="Empty the track (Undo brings it back)">Clear</button>
            </div>
          {/if}
        </div>
      </div>
      <div class="lane" class:rec={v.phase === 'record' || v.phase === 'overdub' || v.phase === 'armed'}>
        <div class="bars" style="grid-template-columns: repeat({Math.min(16, bars)}, 1fr)">{#each { length: Math.min(16, bars) } as _}<i></i>{/each}</div>
        {#if v.phase !== 'empty'}
          <div class="clip" class:b={t.kind === 'audio' || v.phase === 'play' || v.phase === 'stopped'} class:stopped={v.phase === 'stopped'}>
            {#if t.kind === 'midi'}
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                {#each noteRects(i, v, live, span) as r}<rect x={r.x} y={r.y} width={r.w} height="3" class:newest={r.newest} />{/each}
              </svg>
            {:else}
              <svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d={v.layers ? wavePath(i) : ''} /></svg>
            {/if}
          </div>
          {#if v.phase === 'play' || v.phase === 'overdub' || v.phase === 'record' || (v.phase === 'armed' && v.waitBeats > 0)}
            <div class="ph" style="left: {headAt(v, $beatNow, span) * 100}%"></div>
          {/if}
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if editing !== null && tracks[editing]?.kind === 'midi' && tracks[editing].beats > 0}
  <QuickClipEditor index={editing} onclose={() => (editing = null)} onsave={() => openSave(editing!)} />
{/if}

<svelte:window onkeydown={key} />

<div class="save">
  {#if saving !== null}
    <span class="ga-eyebrow">Save to library</span>
    <input bind:this={saveInput} bind:value={saveName} aria-label="Loop name" onkeydown={(e) => e.key === 'Enter' && doSave()} />
    <button class="text-btn small pri" onclick={doSave}>Save</button>
    <button class="text-btn small" onclick={() => (saving = null)}>Cancel</button>
  {/if}
  <span class="sp"></span>
  <span class="hint">Space records the selected track · Shift+S saves it · Cmd+Z undoes a layer</span>
</div>

<style>
  .rows { display: flex; flex-direction: column; overflow: auto; min-height: 0; }
  .tr { display: grid; grid-template-columns: 240px 1fr; border-bottom: 1px solid var(--studio-edge-soft); min-height: 84px; }
  .hd { padding: 10px 14px; border-right: 1px solid var(--studio-edge); display: flex; gap: 12px; align-items: center; background: var(--studio-panel); }
  .tr.sel .hd { box-shadow: inset 2px 0 0 var(--studio-accent); }
  .info { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .name { font-weight: 600; font-size: var(--ga-text-control, 12px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name.empty { color: var(--studio-muted); font-weight: 500; }
  .sub { margin: 0; }
  .state { font-size: var(--ga-text-meta, 11px); color: var(--studio-loop-dub); }
  .state.wait { color: var(--studio-loop-rec); }
  .pick { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
  .pick select { height: 22px; max-width: 120px; }
  .chips { display: flex; gap: 4px; margin-top: 4px; flex-wrap: wrap; }
  .chips b, .chips button { font-weight: 500; font-size: 10px; padding: 1px 6px; border: 1px solid var(--studio-edge); border-radius: 3px; color: var(--studio-ink); background: transparent; font-family: inherit; line-height: 16px; }
  .chips button { cursor: pointer; }
  .chips button:disabled { opacity: 0.4; cursor: default; }
  .chips select.lock { height: 18px; font-size: 10px; max-width: 120px; }
  .chips button.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .chips b.new { border-color: var(--studio-rec); color: var(--studio-rec); }
  .lane { position: relative; background: var(--studio-slot); min-height: 84px; }
  .bars { position: absolute; inset: 0; display: grid; }
  .bars i { border-left: 1px solid var(--studio-edge-soft); }
  .clip { position: absolute; top: 8px; bottom: 8px; left: 0; right: 0; border-radius: 4px; background: var(--studio-rec-soft); border: 1px solid var(--studio-rec); overflow: hidden; }
  .clip.b { background: var(--studio-accent-soft); border-color: var(--studio-accent); }
  .clip.stopped { opacity: 0.5; }
  .clip svg { width: 100%; height: 100%; display: block; }
  .clip rect { fill: var(--studio-ink); opacity: 0.8; }
  .clip rect.newest { fill: var(--studio-rec); opacity: 1; }
  .clip path { fill: var(--studio-accent); opacity: 0.7; }
  .ph { position: absolute; top: 0; bottom: 0; width: 1px; background: var(--studio-ink); pointer-events: none; }
  .save { display: flex; gap: 8px; align-items: center; padding: 8px 14px; background: var(--studio-panel); border-top: 1px solid var(--studio-edge); min-height: 40px; }
  .save input { background: var(--studio-slot); border: 1px solid var(--studio-accent); color: var(--studio-ink); border-radius: var(--studio-radius); padding: 4px 8px; width: 320px; font: inherit; }
  .pri { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .sp { flex: 1; }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
</style>
