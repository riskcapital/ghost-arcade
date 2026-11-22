<script lang="ts">
  /**
   * The live looper's record bar: record (or overdub, or play) the selected
   * loop track, its length (1–16 bars or Free), the count-in, what the
   * track does after a recording, how notes snap, Capture for what was just
   * played, and MIDI in and out. Compact: just the button and the length.
   */
  import { get } from 'svelte/store';
  import { musicStudio } from '../../music/musicStudioStore';
  import { QUANTIZE_GRIDS, type QuantizeId } from '../../music/loopRecorder';
  import { captureLoop, ensureMusicRuntime } from '../../music/musicRuntime';
  import { COUNT_INS, LOOP_LENGTHS, type CountIn, type LoopLength } from '../../music/loopTrack';
  import { loopStationView, pressLoopTrack } from '../../music/loopStation';
  import { beatNow } from '../../music/loopUi';
  import { keyLabel } from '../../music/studioSets';
  import { downloadMidi, importMidi, playingSong } from '../../music/midiExport';
  import { readMidiFile } from '../../music/midiFile';
  import { TRACK_IDS, type SessionClip } from '../../music/session';
  import { launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';

  /** `split`: the record controls and the MIDI file controls pushed to either side, with `extra` after the MIDI ones. */
  let { compact = false, split = false, extra }: { compact?: boolean; split?: boolean; extra?: import('svelte').Snippet } = $props();

  const s = $derived($musicStudio);
  const station = $derived(s.loopStation);
  const sel = $derived($loopStationView.selected);
  const v = $derived($loopStationView.tracks[sel]);
  const selTrack = $derived(station.tracks[sel]);
  let fileInput = $state<HTMLInputElement | null>(null);

  const left = $derived(v.phase === 'armed' ? Math.max(1, Math.ceil(v.startBeat - $beatNow)) : v.phase === 'record' && v.endBeat !== null ? Math.max(1, Math.ceil((v.endBeat - $beatNow) / 4)) : 0);
  const position = $derived.by(() => {
    const b = Math.max(0, $beatNow);
    return `${Math.floor(b / 4) + 1}.${(Math.floor(b) % 4) + 1}.${Math.floor((b % 1) * 4) + 1}`;
  });

  function press() {
    ensureMusicRuntime();
    pressLoopTrack(sel);
  }

  function capture() {
    const made = captureLoop();
    if (!made) showToast('Play something first, then capture it.', 'info');
  }

  function exportPlaying() {
    const state = get(musicStudio);
    const song = playingSong({
      bpm: Math.round(launchClockTempo() * 10) / 10,
      key: state.key,
      set: state.set,
      pattern: state.sequencerPlaying ? state.pattern : null,
      playingLoops: state.playingLoops,
      session: state.session,
    });
    if (!song.tracks.length) {
      showToast('Start a beat or a loop to export it as MIDI.', 'info');
      return;
    }
    downloadMidi(song, 'Ghost Arcade session');
  }

  async function importFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const song = readMidiFile(new Uint8Array(await file.arrayBuffer()));
      const state = get(musicStudio);
      const existing = TRACK_IDS.flatMap((t) => state.session[t].filter((c): c is SessionClip => !!c));
      const clips = importMidi(song, file.name, existing, generateUUID);
      for (const { track, clip } of clips) musicStudio.addSessionClip(track, clip);
      showToast(clips.length ? `Added ${clips.length} clip${clips.length === 1 ? '' : 's'} from ${file.name} to the session.` : `${file.name} has no notes.`, 'info');
    } catch (err) {
      showToast(`Could not read ${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }
</script>

<div class="bar" class:compact class:split>
  <span class="grp">
  <span class="pair">
    {#if !compact}<span class="ga-eyebrow ey">Loop record</span>{/if}
    <button
      class="loop-rec"
      class:on={v.phase === 'record' || v.phase === 'overdub'}
      class:count={v.phase === 'armed'}
      onclick={press}
      aria-pressed={v.phase === 'record' || v.phase === 'overdub' || v.phase === 'armed'}
      aria-label="Loop record"
      title="Loop track {sel + 1}: record, overdub or play it (Space in the looper)"
    >
      <span class="dot"></span>
      {#if v.phase === 'armed'}In {left}{:else if v.phase === 'record'}{#if v.endBeat !== null}Rec {left}{:else}Rec{/if}{:else if v.phase === 'overdub'}Dub{:else if v.phase === 'play'}Overdub{:else if v.phase === 'stopped'}Play{:else}Rec{/if}
    </button>
  </span>
  <span class="pair">
    {#if !compact}<span class="ga-eyebrow ey">Length</span>{/if}
    <div class="ga-segmented small" role="group" aria-label="Loop length">
      {#each LOOP_LENGTHS as bars}
        <button class:active={station.length === bars} aria-pressed={station.length === bars} onclick={() => musicStudio.updateLoopStation((d) => ({ ...d, length: bars as LoopLength }))} title={bars ? `Record ${bars} bar${bars === 1 ? '' : 's'}` : 'Record until pressed again; with nothing playing, the first loop sets the tempo'}>{bars || 'Free'}</button>
      {/each}
    </div>
  </span>
  {#if !compact}
    <span class="pair">
      <span class="ga-eyebrow ey">Count-in</span>
      <select value={station.countIn} onchange={(e) => musicStudio.updateLoopStation((d) => ({ ...d, countIn: Number((e.target as HTMLSelectElement).value) as CountIn }))} aria-label="Count-in" title="Bars of clicks before a recording when nothing is playing">
        {#each COUNT_INS as c}<option value={c}>{c === 0 ? 'Off' : c === 1 ? '1 bar' : '2 bars'}</option>{/each}
      </select>
    </span>
    <span class="pair">
      <span class="ga-eyebrow ey">After record</span>
      <select value={selTrack?.afterRecord ?? 'play'} onchange={(e) => musicStudio.updateLoopTrack(sel, { afterRecord: (e.target as HTMLSelectElement).value as 'play' | 'overdub' })} aria-label="After record" title="When the recording closes: the track plays it, or keeps recording layers over it">
        <option value="play">Play</option>
        <option value="overdub">Overdub</option>
      </select>
    </span>
    <span class="pair">
      <span class="ga-eyebrow ey">Quantise</span>
      <select value={s.quantize} onchange={(e) => musicStudio.setQuantize((e.target as HTMLSelectElement).value as QuantizeId)} aria-label="Quantize" title="Snap recorded notes to">
        {#each QUANTIZE_GRIDS as g}<option value={g.id}>{g.id === 'off' ? 'No snap' : g.label}</option>{/each}
      </select>
    </span>
  {/if}
  {#if !compact && !split && station.length === 0 && !s.sequencerPlaying && !Object.keys(s.playingLoops).length && !$loopStationView.tracks.some((t) => t.phase === 'play' || t.phase === 'overdub')}<span class="tempo-hint" title="With nothing playing, a free first loop sets the tempo: its length is read as 1, 2, 4 or 8 bars between 80 and 160 BPM">First loop sets tempo</span>{/if}
  <button class="text-btn small" onclick={capture} title="Keep what you just played as a loop, without having recorded it">Capture</button>
  {#if !compact && !split}<span class="pos">{launchClockTempo().toFixed(1)} BPM · {keyLabel(s.key)} · {position}</span>{/if}
  </span>
  {#if !split}<span class="divider"></span>{/if}
  <span class="grp midi">
  <button class="text-btn small" onclick={exportPlaying} title="Save the beat and the playing loops as a MIDI file">MIDI out</button>
  <button class="text-btn small" onclick={() => fileInput?.click()} title="Add clips to the session from a MIDI file">MIDI in</button>
  <input bind:this={fileInput} type="file" accept=".mid,.midi,audio/midi" hidden onchange={importFile} />
  {#if extra}{@render extra()}{/if}
  </span>
</div>

<style>
  .bar { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .divider { width: 1px; height: 16px; margin: 0 2px; background: var(--studio-edge-soft); }
  .grp { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; row-gap: 4px; }
  .pair { display: inline-flex; align-items: center; gap: 6px; }
  .ey { margin-left: 4px; }
  .tempo-hint { font-size: var(--ga-text-meta, 11px); color: var(--studio-rec); }
  .pos { margin-left: 8px; font-variant-numeric: tabular-nums; font-size: var(--ga-text-meta, 11px); color: var(--studio-ink); }
  /*
   * Split (the session panel's second row): the record controls left, MIDI
   * out / in / Ableton Live right, on one line. Every control is 28px; a
   * label sits 8px from its control, groups 16px apart. When the line is too
   * short the labels go first (the controls keep their aria-labels), then the
   * MIDI group moves under as a whole, still on the right.
   */
  .bar.split { flex: 1 1 100%; flex-wrap: wrap; row-gap: 8px; column-gap: 16px; container-type: inline-size; }
  .split .grp { flex-wrap: nowrap; gap: 16px; }
  .split .grp:not(.midi) { flex-wrap: wrap; row-gap: 8px; }
  .split .grp.midi { gap: 8px; margin-left: auto; }
  .split .pair { gap: 8px; }
  .split .ey { margin-left: 0; line-height: 28px; }
  .split :is(button, select, .ga-segmented) { height: 28px; box-sizing: border-box; }
  .split select { padding-top: 0; padding-bottom: 0; }
  @container (max-width: 1290px) {
    .split .ey { display: none; }
  }
  /* Wide enough for "Rec 4" and "Overdub", so the bar does not shift while recording. */
  .loop-rec { min-width: 72px; }
  .loop-rec.on, .loop-rec.count { color: var(--studio-rec); border-color: var(--studio-rec); }
</style>
