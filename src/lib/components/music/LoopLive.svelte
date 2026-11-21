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
    saveLoopTrack,
    selectLoopTrack,
    setLoopLevel,
    startAllLoopTracks,
    stopAllLoopTracks,
    stopLoopTrack,
    toggleLoopMute,
    undoLoopLayer,
  } from '../../music/loopStation';
  import { beatNow } from '../../music/loopUi';
  import { COUNT_INS, LOOP_TRACK_COUNT, PEDAL_PRESETS, type CountIn, type PedalPreset } from '../../music/loopTrack';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { launchClockTempo } from '../../stores/launchClock';
  import { audioStore } from '../../stores/audio';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';
  import LoopTrackButton from './LoopTrackButton.svelte';
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

  let { onpicktrack }: { onpicktrack?: (i: number) => void } = $props();

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

<div class="live">
  <div class="topbar">
    <span class="ga-eyebrow">Loop station</span>
    <b class="bpm">{launchClockTempo().toFixed(1)} BPM</b>
    <button class="text-btn small" onclick={() => audioStore.tapTempo()} title="Tap the tempo">Tap</button>
    <span class="ga-eyebrow">First loop</span>
    <div class="ga-segmented small" role="group" aria-label="First loop">
      <button class:active={station.length !== 0} onclick={() => musicStudio.updateLoopStation((d) => ({ ...d, length: d.length === 0 ? 4 : d.length }))}>{station.length || 4} bars</button>
      <button class:active={station.length === 0} onclick={() => musicStudio.updateLoopStation((d) => ({ ...d, length: 0 }))} title="Until pressed again; with nothing playing it sets the tempo">Free</button>
    </div>
    <span class="ga-eyebrow">Count-in</span>
    <select value={station.countIn} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, countIn: Number((e.target as HTMLSelectElement).value) as CountIn }))} aria-label="Count-in">
      {#each COUNT_INS as c}<option value={c}>{c === 0 ? 'Off' : c === 1 ? '1 bar' : '2 bars'}</option>{/each}
    </select>
    <span class="ga-eyebrow">Fade</span>
    <select value={station.fadeBars} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, fadeBars: Number((e.target as HTMLSelectElement).value) }))} aria-label="Fade out on stop" title="Audio loops fade out over this many bars when stopped">
      {#each [0, 1, 2, 4] as f}<option value={f}>{f === 0 ? 'Cut' : f === 1 ? '1 bar' : `${f} bars`}</option>{/each}
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
    <span class="keys">Keys 1–6</span>
  </div>
  <div class="phrase" aria-hidden="true"><i style="width: {phrase}%"></i></div>

  <div class="cols">
    {#each { length: LOOP_TRACK_COUNT } as _, i}
      {@const t = station.tracks[i]}
      {@const v = view.tracks[i]}
      {@const bars = Math.max(1, Math.round(v.beats / 4))}
      <div class="col" class:sel={view.selected === i} role="presentation" onpointerdown={() => selectLoopTrack(i)}>
        <LoopTrackButton index={i} size={96} ring />
        {#if v.phase === 'empty'}
          <div class="name empty">Empty</div>
          <div class="ga-eyebrow meta">{t.kind === 'audio' ? `Input ${t.input + 1}` : t.instrument ? INSTRUMENT_LABELS[t.instrument] : 'Follows what you play'}</div>
        {:else}
          <div class="name">{t.name || (t.kind === 'audio' ? `Audio ${i + 1}` : INSTRUMENT_LABELS[t.instrument ?? s.instrument])}</div>
          <div class="ga-eyebrow meta">{t.kind === 'audio' ? `Input ${t.input + 1}` : INSTRUMENT_LABELS[t.instrument ?? s.instrument]} · {bars} bar{bars === 1 ? '' : 's'} · {v.layers} layer{v.layers === 1 ? '' : 's'}</div>
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
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <div class="foot">
    <span class="ga-eyebrow">Sections</span>
    {#each station.sections as sec (sec.id)}
      <span class="sec" class:on={isActive(sec.tracks)}>
        <button onclick={() => playLoopSection(sec.tracks)} title="Play these tracks from the next bar; the others stop">{sec.name} · {sec.tracks.length === LOOP_TRACK_COUNT ? 'all' : sec.tracks.map((x) => x + 1).join(' ')}</button>
        <button class="x" onclick={() => removeSection(sec.id)} aria-label="Remove section {sec.name}">×</button>
      </span>
    {/each}
    <button class="text-btn small" onclick={snapshot} title="Keep which tracks play now as a section">+ Snapshot</button>
    <span class="sp"></span>
    <span class="hint">Space = selected track · hold = undo layer · 1–6 select</span>
  </div>
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
  .col { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 14px 8px 12px; border-right: 1px solid var(--studio-edge-soft); min-width: 120px; }
  .col:last-child { border-right: 0; }
  .col.sel { background: rgba(255, 255, 255, 0.025); }
  .name { margin-top: 6px; font-weight: 600; font-size: var(--ga-text-control, 12px); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name.empty { color: var(--studio-muted); font-weight: 500; }
  .meta { margin: 0; text-align: center; }
  .fader { width: 80%; margin: 10px 0; }
  .btns { display: flex; gap: 4px; }
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
</style>
