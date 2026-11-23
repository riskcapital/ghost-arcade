<script lang="ts">
  /**
   * The live loop view: the six tracks as columns, RC-looper style. Each has
   * its big button with a ring for where the loop is, its name, a level
   * fader, and Mute, Stop, Clear and Save. Across the top: tempo and Tap,
   * the first loop's length, count-in, fade on stop, Start all, Stop all,
   * Undo and the pedal preset. Across the foot: sections, each a set of
   * tracks to play, snapshotted from what plays now.
   */
  import { musicStudio } from '../../music/musicStudioStore';
  import {
    clearLoopTrack,
    loopStationView,
    playLoopSection,
    quantizeLoopTrack,
    renameLoopTrack,
    saveLoopTrack,
    selectLoopTrack,
    setLoopLevel,
    setLoopTrackSound,
    startAllLoopTracks,
    stopAllLoopTracks,
    stopLoopTrack,
    toggleLoopMute,
    undoLoopLayer,
  } from '../../music/loopStation';
  import { beatNow } from '../../music/loopUi';
  import { COUNT_INS, LOOP_LENGTHS, LOOP_TRACK_COUNT, type LoopLength, PEDAL_PRESETS, type CountIn, type PedalPreset } from '../../music/loopTrack';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES } from '../../music/instruments';
  import { TONES, TONE_FAMILY_LABELS, type ToneFamily } from '../../music/tone/tones';
  import { insertEditorChannel } from '../../music/studioUi';
  import { loopFxChannel, parseSoundValue, soundValue } from '../../music/loopTrack';
  import { QUANTIZE_GRIDS, type QuantizeId } from '../../music/loopRecorder';
  import { launchClockTempo } from '../../stores/launchClock';
  import { audioStore } from '../../stores/audio';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';
  import LoopTrackButton from './LoopTrackButton.svelte';
  import { applyStationPreset, setTrackKind, type LoopTrackKind, type StationPreset } from '../../music/loopTrack';
  import { INSTRUMENTS } from '../../music/noteEvents';
  import { trackSoundLabel, type LoopSource } from '../../music/loopSources';

  /** A track's type changes only while it is empty (the selector shows only then); its sound changes any time. */
  function setKind(i: number, kind: LoopTrackKind) {
    musicStudio.updateLoopStation((d) => ({ ...d, tracks: d.tracks.map((t, k) => (k === i ? setTrackKind(t, i, kind, $loopStationView.tracks[i].phase === 'empty') : t)) }));
  }

  /** Click a loop's name to rename it: Enter or leaving the field keeps it, Escape leaves it as it was. */
  let renaming = $state<number | null>(null);
  let draft = $state('');
  function startRename(i: number, current: string) {
    renaming = i;
    draft = current;
  }
  function commitRename(i: number) {
    if (renaming !== i) return;
    renaming = null;
    renameLoopTrack(i, draft);
  }
  function focusSelect(el: HTMLInputElement) {
    el.focus();
    el.select();
  }

  /** Every sound the keyboard's menu offers: synth and keys patches, the other instruments, and the library tones. */
  const FAMILIES: ToneFamily[] = ['bass', 'lead', 'arp', 'pad'];
  // The XY tone and the shots are recorded from their tabs (Tab instruments), as played there.
  const OTHERS = INSTRUMENTS.filter((id) => id !== 'synth' && id !== 'keys' && id !== 'xy' && id !== 'shots');
  /** The tab instruments a MIDI track can record: what each is called in the menu. */
  const TAB_SOURCES: Array<{ id: LoopSource; label: string; title: string }> = [
    { id: 'xy', label: 'XY pad', title: 'The Sound bath XY pad: its notes and the puck as you move it' },
  ];
  function chooseSound(i: number, value: string) {
    const sound = parseSoundValue(value);
    if (sound) setLoopTrackSound(i, sound);
  }

  function quantize(i: number, id: QuantizeId) {
    if (!quantizeLoopTrack(i, id)) showToast('Nothing to quantize on this track yet.', 'info');
  }

  function setCount(n: number) {
    const keep = $loopStationView.tracks.findLastIndex((t) => t.phase !== 'empty') + 1;
    if (n < keep) {
      showToast(`Track ${keep} holds a loop: clear it first to show fewer tracks.`, 'info');
      return;
    }
    musicStudio.updateLoopStation((d) => ({ ...d, trackCount: n }));
  }

  function applyPreset(p: StationPreset) {
    if (!p) return;
    musicStudio.updateLoopStation((d) => applyStationPreset(d, p, (i) => $loopStationView.tracks[i]?.phase !== 'empty'));
    selectLoopTrack(0);
  }
  import { cancelProgramLearn, learnProgramSelect } from '../../music/loopControls';

  let pcLearning = $state(false);
  function learnPc() {
    if (pcLearning) {
      cancelProgramLearn();
      pcLearning = false;
      return;
    }
    pcLearning = true;
    learnProgramSelect(() => (pcLearning = false));
  }
  import { setStudioVoice, studioTarget } from '../../music/studioTarget';
  import { loopTrackSource } from '../../music/visualVoices';

  const voices = $derived($studioTarget?.source.musicVoices ?? []);
  /** The visual voice following loop track `i`, or -1. */
  const voiceFor = (i: number) => voices.findIndex((v) => v.live === loopTrackSource(i));
  const voiceName = (file: string) => file.replace(/^VX-/, '').replace(/\.fs$/, '').replace(/[-_]/g, ' ');

  /** Point voice `k` at loop track `i` (and any voice that followed it back at everything). */
  function assignVisual(i: number, k: number) {
    const was = voiceFor(i);
    if (was >= 0 && was !== k) setStudioVoice(was, { live: undefined });
    if (k >= 0) setStudioVoice(k, { live: loopTrackSource(i) });
  }

  /** compact: tray-height columns (ring beside the controls), no sections footer (the rail has them). */
  let { onpicktrack, compact = false }: { onpicktrack?: (i: number) => void; compact?: boolean } = $props();

  const s = $derived($musicStudio);
  const station = $derived(s.loopStation);
  const view = $derived($loopStationView);
  const playingNow = $derived(view.tracks.map((t, i) => (t.phase === 'play' || t.phase === 'overdub' ? i : -1)).filter((i) => i >= 0));
  const phrase = $derived((((($beatNow % 16) + 16) % 16) / 16) * 100);

  function snapshot() {
    if (!playingNow.length) {
      showToast('Start some loops first: a section keeps which tracks play.', 'info');
      return;
    }
    musicStudio.updateLoopStation((d) => ({ ...d, sections: [...d.sections, { id: generateUUID(), name: `Section ${d.sections.length + 1}`, tracks: [...playingNow] }].slice(-16) }));
  }

  function removeSection(id: string) {
    musicStudio.updateLoopStation((d) => ({ ...d, sections: d.sections.filter((x) => x.id !== id) }));
  }

  const isActive = (tracks: number[]) => tracks.length === playingNow.length && tracks.every((t) => playingNow.includes(t));

  async function save(i: number) {
    const id = await saveLoopTrack(i).catch(() => null);
    showToast(id ? 'Saved to My loops.' : 'Nothing to save on this track yet.', 'info');
  }
</script>

{#snippet soundOptions(current: string)}
  <option value="" title="What you play on the tab showing when it records: the XY pad, the dub shots, the drum pads, or the keys">This tab</option>
  <optgroup label="Tab instruments">
    {#each TAB_SOURCES as x (x.id)}<option value="src:{x.id}" title={x.title}>{x.label}</option>{/each}
  </optgroup>
  <optgroup label="Synth">
    {#each SYNTH_PATCHES as p (p.id)}<option value="synth:{p.id}">Synth · {p.label}</option>{/each}
  </optgroup>
  <optgroup label="Keys">
    {#each KEYS_PATCHES as p (p.id)}<option value="keys:{p.id}">Keys · {p.label}</option>{/each}
  </optgroup>
  <optgroup label="Instruments">
    {#each OTHERS as id (id)}<option value="inst:{id}">{INSTRUMENT_LABELS[id]}</option>{/each}
    {#if current === 'inst:xy' || current === 'inst:shots'}<option value={current}>{INSTRUMENT_LABELS[current === 'inst:xy' ? 'xy' : 'shots']}</option>{/if}
  </optgroup>
  {#each FAMILIES as fam (fam)}
    <optgroup label={TONE_FAMILY_LABELS[fam]}>
      {#each TONES.filter((x) => x.family === fam) as x (x.id)}<option value="tone:{x.id}" title={x.blurb}>{x.name}</option>{/each}
    </optgroup>
  {/each}
{/snippet}

<div class="live" class:compact>
  <div class="topbar">
    <span class="ga-eyebrow">Loop station</span>
    <b class="bpm">{launchClockTempo().toFixed(1)} BPM</b>
    <button class="text-btn small" onclick={() => audioStore.tapTempo()} title="Tap the tempo">Tap</button>
    <span class="ga-eyebrow">Length</span>
    <div class="ga-segmented small" role="group" aria-label="Loop length">
      {#each LOOP_LENGTHS as bars}
        <button class:active={station.length === bars} aria-pressed={station.length === bars} onclick={() => musicStudio.updateLoopStation((d) => ({ ...d, length: bars as LoopLength }))} title={bars ? `Record ${bars} bar${bars === 1 ? '' : 's'}` : 'Until pressed again; with nothing playing it sets the tempo'}>{bars || 'Free'}</button>
      {/each}
    </div>
    <span class="ga-eyebrow">Count-in</span>
    <select value={station.countIn} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, countIn: Number((e.target as HTMLSelectElement).value) as CountIn }))} aria-label="Count-in">
      {#each COUNT_INS as c}<option value={c}>{c === 0 ? 'Off' : c === 1 ? '1 bar' : '2 bars'}</option>{/each}
    </select>
    <span class="ga-eyebrow">Fade</span>
    <select value={station.fadeBars} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, fadeBars: Number((e.target as HTMLSelectElement).value) }))} aria-label="Fade out on stop" title="Audio loops fade out over this many bars when stopped">
      {#each [0, 1, 2, 4] as f}<option value={f}>{f === 0 ? 'Cut' : f === 1 ? '1 bar' : `${f} bars`}</option>{/each}
    </select>
    <span class="ga-eyebrow">Tracks</span>
    <select value={station.trackCount} onchange={(e) => setCount(Number((e.target as HTMLSelectElement).value))} aria-label="Number of loop tracks">
      {#each [4, 5, 6, 7, 8] as n}<option value={n}>{n}</option>{/each}
    </select>
    <select value="" onchange={(e) => { applyPreset((e.target as HTMLSelectElement).value as StationPreset); (e.target as HTMLSelectElement).value = ''; }} aria-label="Track setup" title="Set the empty tracks up for a way of playing; tracks holding a loop keep it">
      <option value="" disabled>Setup…</option>
      <option value="band">Live band</option>
      <option value="default">Default</option>
    </select>
    <span class="sp"></span>
    <button class="text-btn small" onclick={() => startAllLoopTracks()} title="Start every stopped loop on the next bar">Start all</button>
    <button class="text-btn small" onclick={() => stopAllLoopTracks()} title="Stop every loop on the next bar (Cmd+.)">Stop all</button>
    <button class="text-btn small" onclick={() => undoLoopLayer(view.selected)} title="Undo the selected track's last layer (Cmd+Z)">Undo</button>
    <label class="pedal">Pedal
      <select value={station.pedal} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, pedal: (e.target as HTMLSelectElement).value as PedalPreset }))} aria-label="Pedal preset" title="What footswitches learned onto Loop pedal 1–3 do">
        {#each PEDAL_PRESETS as p}<option value={p}>{p === 'off' ? 'Off' : p === '2-switch' ? '2-switch' : '3-switch'}</option>{/each}
      </select>
    </label>
    <label class="pedal" title="Program Change from a pedal selects a loop track: the first program selects track 1">
      <input type="checkbox" checked={station.pc.on} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, pc: { ...d.pc, on: (e.target as HTMLInputElement).checked } }))} /> PC select
    </label>
    {#if station.pc.on}
      <select value={station.pc.channel} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, pc: { ...d.pc, channel: Number((e.target as HTMLSelectElement).value) } }))} aria-label="Program Change channel">
        <option value={-1}>Any channel</option>
        {#each { length: 16 } as _, c}<option value={c}>Ch {c + 1}</option>{/each}
      </select>
      <label class="pedal">From PC <input class="pc-off" type="number" min="0" max="127" value={station.pc.offset} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, pc: { ...d.pc, offset: Math.max(0, Math.min(127, Number((e.target as HTMLInputElement).value) || 0)) } }))} /></label>
      <button class="text-btn small" class:on={pcLearning} onclick={learnPc} title="Press the pedal that should select track 1">{pcLearning ? 'Press a pedal…' : 'Learn'}</button>
    {/if}
    <span class="keys">Keys 1–{station.trackCount}</span>
  </div>
  <div class="phrase" aria-hidden="true"><i style="width: {phrase}%"></i></div>

  <div class="cols" style="grid-template-columns: repeat({station.trackCount}, minmax(0, 1fr))">
    {#each { length: $musicStudio.loopStation.trackCount } as _, i}
      {@const t = station.tracks[i]}
      {@const v = view.tracks[i]}
      {@const bars = Math.max(1, Math.round(v.beats / 4))}
      <div class="col" class:sel={view.selected === i} role="presentation" onpointerdown={() => selectLoopTrack(i)}>
        {#if compact}<span class="num">{i + 1}</span>{/if}
        <LoopTrackButton index={i} size={compact ? 74 : 96} ring />
        <div class="txt">
        {#if v.phase === 'empty'}
          <div class="name empty">{t.name || 'Empty'}</div>
          <div class="pick">
            <select value={t.kind} onchange={(e) => setKind(i, (e.target as HTMLSelectElement).value as LoopTrackKind)} aria-label="Track {i + 1} type" title="MIDI plays an instrument (drums, bass, keys, pads…); audio records a band input">
              <option value="midi">MIDI</option>
              <option value="audio">Audio</option>
            </select>
            {#if t.kind === 'midi'}
              <select class="sound" value={soundValue(t)} onchange={(e) => chooseSound(i, (e.target as HTMLSelectElement).value)} aria-label="Track {i + 1} instrument" title="What it plays and records; MIDI from any device plays it while the track is selected">
                {@render soundOptions(soundValue(t))}
              </select>
            {:else}
              <select value={t.input} onchange={(e) => musicStudio.updateLoopTrack(i, { input: Number((e.target as HTMLSelectElement).value) })} aria-label="Track {i + 1} input" title="The band input it records">
                {#each { length: Math.max(s.liveInputs.length, 2, t.input + 1) } as _, k}<option value={k}>Input {k + 1}{s.liveInputs[k]?.name ? ` · ${s.liveInputs[k].name}` : ''}</option>{/each}
              </select>
            {/if}
          </div>
        {:else}
          {@const label = t.name || (t.kind === 'audio' ? `Audio ${i + 1}` : trackSoundLabel(t, s.instrument))}
          {@const meta = `${t.kind === 'audio' ? `Input ${t.input + 1}` : trackSoundLabel(t, s.instrument)} · ${bars} bar${bars === 1 ? '' : 's'} · ${v.phase === 'overdub' ? `layer ${v.layers + 1} recording` : `${v.layers} layer${v.layers === 1 ? '' : 's'}`}`}
          {#if renaming === i}
            <input class="name rename" type="text" maxlength="80" bind:value={draft} use:focusSelect onpointerdown={(e) => e.stopPropagation()} onkeydown={(e) => { e.stopPropagation(); if (e.key === 'Enter') commitRename(i); else if (e.key === 'Escape') renaming = null; }} onblur={() => commitRename(i)} aria-label="Loop {i + 1} name" />
          {:else}
            <button class="name" onclick={() => startRename(i, label)} title="{label}. Click to rename">{label}</button>
          {/if}
          <div class="ga-eyebrow meta" title={meta}>{t.kind === 'audio' ? `Input ${t.input + 1}` : trackSoundLabel(t, s.instrument)} · {bars} bar{bars === 1 ? '' : 's'} · {v.phase === 'overdub' ? `layer ${v.layers + 1} recording` : `${v.layers} layer${v.layers === 1 ? '' : 's'}`}</div>
          {#if t.kind === 'midi'}
            <div class="pick">
              <select class="sound" value={soundValue(t)} onchange={(e) => chooseSound(i, (e.target as HTMLSelectElement).value)} aria-label="Track {i + 1} sound" title="The sound this loop plays: change it any time, the notes stay">
                {@render soundOptions(soundValue(t))}
              </select>
              <select value="" onchange={(e) => { quantize(i, (e.target as HTMLSelectElement).value as QuantizeId); (e.target as HTMLSelectElement).value = ''; }} aria-label="Quantize loop {i + 1}" title="Snap this loop's notes to a grid (Undo puts them back)">
                <option value="" disabled>Quantize…</option>
                {#each QUANTIZE_GRIDS.filter((g) => g.beats > 0) as g}<option value={g.id}>{g.label}</option>{/each}
              </select>
            </div>
          {/if}
        {/if}
        <input class="fader" type="range" min="0" max="1" step="0.01" value={t.level} oninput={(e) => setLoopLevel(i, Number((e.target as HTMLInputElement).value))} aria-label="Loop {i + 1} level" />
        <select class="visual" value={voiceFor(i)} onchange={(e) => assignVisual(i, Number((e.target as HTMLSelectElement).value))} aria-label="Visual for loop {i + 1}" title={voices.length ? 'The visual voice that follows this loop (pick the look in the visuals rack)' : 'Add a visual in the visuals rack first'}>
          <option value={-1}>No visual</option>
          {#each voices as voice, k}<option value={k}>Voice {k + 1}: {voiceName(voice.file)}</option>{/each}
        </select>
        <div class="btns">
          {#if v.phase === 'empty'}
            <button onclick={() => onpicktrack?.(i)} title="Choose what the track records">Input</button>
          {:else}
            <button class:on={t.muted} onclick={() => toggleLoopMute(i)} title="Mute (M)">M</button>
            <button onclick={() => stopLoopTrack(i)} title="Stop on the next bar (Shift+Space)" aria-label="Stop"><svg viewBox="0 0 10 10" aria-hidden="true"><rect x="2" y="2" width="6" height="6" /></svg></button>
            <button onclick={() => clearLoopTrack(i)} title="Empty the track (Undo brings it back)">Clear</button>
            <button onclick={() => save(i)} title="Save it to My loops (S)">Save</button>
            {#if t.kind === 'midi'}
              {@const fxCount = s.inserts[loopFxChannel(i)]?.length ?? 0}
              <button class:on={fxCount > 0} onclick={() => insertEditorChannel.set($insertEditorChannel === loopFxChannel(i) ? null : loopFxChannel(i))} title="Effects on this loop's sound">FX{fxCount ? ` ${fxCount}` : ''}</button>
            {/if}
          {/if}
        </div>
        </div>
      </div>
    {/each}
  </div>

  {#if !compact}
  <div class="foot">
    <span class="ga-eyebrow">Sections</span>
    {#each station.sections as sec (sec.id)}
      <span class="sec" class:on={isActive(sec.tracks)}>
        <button onclick={() => playLoopSection(sec.tracks)} title="Play these tracks from the next bar; the others stop">{sec.name} · {sec.tracks.length === $musicStudio.loopStation.trackCount ? 'all' : sec.tracks.map((x) => x + 1).join(' ')}</button>
        <button class="x" onclick={() => removeSection(sec.id)} aria-label="Remove section {sec.name}">×</button>
      </span>
    {/each}
    <button class="text-btn small" onclick={snapshot} title="Keep which tracks play now as a section">+ Snapshot</button>
    <span class="sp"></span>
    <span class="hint">Space = selected track · hold = undo layer · 1–{station.trackCount} select</span>
  </div>
  {/if}
</div>

<style>
  .live { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--studio-slot); }
  .topbar { display: flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--studio-panel); flex-wrap: wrap; }
  .topbar .ga-eyebrow { margin-left: 6px; }
  .bpm { font-variant-numeric: tabular-nums; font-size: var(--ga-text-control, 12px); }
  .pedal, .keys { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); display: inline-flex; align-items: center; gap: 4px; }
  .sp { flex: 1; }
  .pc-off { width: 46px; height: 22px; }
  .phrase { height: 3px; background: var(--studio-edge-soft); }
  .phrase i { display: block; height: 100%; background: var(--studio-accent); }
  .cols { flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); overflow: auto; }
  .col { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px 12px; border-right: 1px solid var(--studio-edge-soft); min-width: 120px; overflow: hidden; }
  .col:last-child { border-right: 0; }
  .col.sel { background: rgba(255, 255, 255, 0.025); }
  .name { margin-top: 6px; font-weight: 600; font-size: var(--ga-text-control, 12px); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button.name { border: 0; padding: 0; background: transparent; color: inherit; font-family: inherit; text-align: inherit; cursor: text; display: block; }
  button.name:hover { text-decoration: underline dotted; }
  .rename { width: 100%; box-sizing: border-box; height: 20px; padding: 0 4px; font-weight: 600; }
  .name.empty { color: var(--studio-muted); font-weight: 500; }
  .meta { margin: 0; text-align: center; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fader { width: 80%; margin: 10px 0; }
  .btns { display: flex; gap: 4px; flex-wrap: wrap; justify-content: center; }
  .visual { max-width: 100%; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .btns button { height: 22px; min-width: 24px; padding: 0 7px; border: 1px solid var(--studio-edge); background: transparent; color: var(--studio-ink); border-radius: var(--studio-radius); font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer; display: inline-grid; place-items: center; }
  .btns button.on { background: var(--studio-accent-soft); border-color: var(--studio-accent); }
  .btns svg { width: 9px; height: 9px; fill: currentColor; }
  .foot { display: flex; align-items: center; gap: 6px; padding: 8px 12px; background: var(--studio-panel); border-top: 1px solid var(--studio-edge); flex-wrap: wrap; }
  .sec { display: inline-flex; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .sec button { height: 24px; padding: 0 9px; border: 0; background: transparent; color: var(--studio-ink); font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer; }
  .sec .x { padding: 0 6px; color: var(--studio-muted); }
  .sec.on { border-color: var(--studio-accent); }
  .sec.on button:first-child { background: var(--studio-accent); color: var(--studio-on-accent); }
  .hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .txt { display: contents; }
  .compact .cols { flex: 0 0 auto; overflow: visible; }
  .compact .col { flex-direction: row; align-items: center; gap: 12px; padding: 14px 12px 12px; min-width: 0; position: relative; }
  .compact .col.sel { box-shadow: inset 0 -2px 0 var(--studio-rec); }
  .compact .txt { display: flex; overflow: hidden; flex-direction: column; align-items: flex-start; gap: 4px; min-width: 0; flex: 1; }
  .compact .name { margin-top: 0; }
  .compact .meta { text-align: left; }
  .compact .fader { width: 100%; margin: 4px 0; }
  .compact .visual { width: 100%; }
  .compact .btns { flex-wrap: wrap; }
  .num { position: absolute; top: 5px; left: 8px; font-size: 10px; color: var(--studio-muted); }
  .compact { height: auto; }
  .pick { display: flex; gap: 4px; flex-wrap: wrap; max-width: 100%; }
  .pick select { height: 22px; max-width: 120px; min-width: 0; font-size: var(--ga-text-meta, 11px); }
</style>
