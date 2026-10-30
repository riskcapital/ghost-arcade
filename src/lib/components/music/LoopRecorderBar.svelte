<script lang="ts">
  /**
   * The loop recorder's controls: record the next bars, or capture what was
   * just played; how many bars and how notes snap; and MIDI in and out.
   */
  import { get } from 'svelte/store';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { QUANTIZE_GRIDS, RECORD_LENGTHS, type QuantizeId, type RecordLength } from '../../music/loopRecorder';
  import { captureLoop, toggleLoopRecord } from '../../music/musicRuntime';
  import { downloadMidi, importMidi, playingSong } from '../../music/midiExport';
  import { readMidiFile } from '../../music/midiFile';
  import { TRACK_IDS, type SessionClip } from '../../music/session';
  import { launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';

  let { compact = false }: { compact?: boolean } = $props();

  const s = $derived($musicStudio);
  const rec = $derived($musicTransport.loopRec);
  let fileInput = $state<HTMLInputElement | null>(null);

  const barsLeft = $derived.by(() => {
    if (rec.phase === 'count') return Math.max(1, Math.ceil(rec.startBeat - rec.beat));
    if (rec.phase === 'rec' && rec.endBeat !== null) return Math.max(1, Math.ceil((rec.endBeat - rec.beat) / 4));
    return 0;
  });

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

<div class="bar" class:compact>
  <button
    class="loop-rec"
    class:on={rec.phase === 'rec'}
    class:count={rec.phase === 'count'}
    onclick={toggleLoopRecord}
    aria-pressed={rec.phase !== 'off'}
    title={rec.phase === 'off' ? 'Record a loop from the next bar' : rec.phase === 'count' ? 'Cancel the recording' : 'Stop on the next bar line and keep the loop'}
  >
    <span class="dot"></span>
    {#if rec.phase === 'count'}In {barsLeft}{:else if rec.phase === 'rec'}Rec{rec.endBeat !== null ? ` ${barsLeft}` : ''}{:else}Rec{/if}
  </button>
  <div class="ga-segmented small" role="group" aria-label="Bars to record">
    {#each RECORD_LENGTHS as bars}
      <button class:active={s.recordLength === bars} aria-pressed={s.recordLength === bars} onclick={() => musicStudio.setRecordLength(bars as RecordLength)} title={bars ? `Record ${bars} bar${bars === 1 ? '' : 's'}` : 'Record until stopped'}>{bars || 'Free'}</button>
    {/each}
  </div>
  {#if !compact}
    <select value={s.quantize} onchange={(e) => musicStudio.setQuantize((e.target as HTMLSelectElement).value as QuantizeId)} aria-label="Quantize" title="Snap recorded notes to">
      {#each QUANTIZE_GRIDS as g}<option value={g.id}>{g.id === 'off' ? 'No snap' : `Snap ${g.label}`}</option>{/each}
    </select>
  {/if}
  <button class="text-btn small" onclick={capture} title="Keep what you just played as a loop, without having recorded it">Capture</button>
  <span class="divider"></span>
  <button class="text-btn small" onclick={exportPlaying} title="Save the beat and the playing loops as a MIDI file">MIDI out</button>
  <button class="text-btn small" onclick={() => fileInput?.click()} title="Add clips to the session from a MIDI file">MIDI in</button>
  <input bind:this={fileInput} type="file" accept=".mid,.midi,audio/midi" hidden onchange={importFile} />
</div>

<style>
  .bar { display: flex; align-items: center; gap: 6px; white-space: nowrap; }
  .divider { width: 1px; height: 16px; margin: 0 2px; background: var(--studio-edge-soft); }
  /* Wide enough for "Rec 4" and "In 2", so the bar does not shift while recording. */
  .loop-rec { min-width: 60px; }
</style>
