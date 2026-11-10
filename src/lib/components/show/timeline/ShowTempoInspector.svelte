<script lang="ts">
  /**
   * The show's tempo map: BPM (typed or tapped), time signature, where bar 1
   * is, and seeding it from an audio track's analysis. The v1 map has one
   * tempo for the whole show.
   *
   * There is no downbeat detection, so after "Detect tempo" bar 1 may sit on
   * any beat of the bar: "Bar 1 here" puts it under the playhead, and the
   * beat arrows slide the grid a beat at a time.
   */
  import type { ShowAudioTrack, ShowTempoMap, ShowTempoSegment } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { createTempoMap, SHOW_DEFAULT_BPM, SHOW_MAX_BPM, SHOW_MIN_BPM } from '../../../show/tempoMap';
  import { detectShowTempo, tempoSourceTrack } from '../../../show/tempoDetect';

  interface Props {
    tempo: ShowTempoMap | null;
    playhead: number;
    audioTracks: ShowAudioTrack[];
    onclose: () => void;
  }

  let { tempo, playhead, audioTracks, onclose }: Props = $props();

  const seg = $derived(tempo?.segments[0] ?? null);
  const beatSeconds = $derived(seg ? (4 / seg.beatUnit) * (60 / seg.bpm) : 0.5);
  const usableAudio = $derived(audioTracks.filter((t) => t.url));
  const analysedName = $derived(
    tempo?.source === 'analysis' && tempo.analysedTrackId
      ? audioTracks.find((t) => t.id === tempo.analysedTrackId)?.name ?? null
      : null,
  );

  let detectTrackId = $state('');
  let detecting = $state(false);
  type DetectNote = { kind: 'ok'; bpm: number; name: string } | { kind: 'no-pulse' | 'undecodable' | 'no-audio' };
  let message: DetectNote | null = $state(null);

  function formatAt(t: number): string {
    const sign = t < 0 ? '-' : '';
    const a = Math.abs(t);
    const m = Math.floor(a / 60);
    const s = a - m * 60;
    return `${sign}${m}:${s.toFixed(3).padStart(6, '0')}`;
  }

  function setSegment(patch: Partial<ShowTempoSegment>) {
    if (!tempo || !seg) return;
    showTimeline.setTempo({ ...tempo, segments: [{ ...seg, ...patch }, ...tempo.segments.slice(1)] });
  }

  function setBpm(value: number) {
    if (!Number.isFinite(value) || value <= 0) return;
    setSegment({ bpm: Math.round(Math.max(SHOW_MIN_BPM, Math.min(SHOW_MAX_BPM, value)) * 100) / 100 });
  }

  function setOffset(offset: number) {
    if (!tempo) return;
    showTimeline.setTempo({ ...tempo, offset: Math.round(offset * 1e6) / 1e6 });
  }

  function addMap() {
    message = null;
    showTimeline.setTempo(createTempoMap(SHOW_DEFAULT_BPM, Math.max(0, playhead)));
  }

  async function detect() {
    if (detecting) return;
    detecting = true;
    message = null;
    const trackId = detectTrackId || tempoSourceTrack(audioTracks)?.id;
    const result = await detectShowTempo(trackId);
    detecting = false;
    message = result.ok
      ? { kind: 'ok', bpm: Math.round(result.bpm * 10) / 10, name: audioTracks.find((t) => t.id === result.trackId)?.name ?? '' }
      : { kind: result.reason };
  }

  // ── Tap tempo ─────────────────────────────────────────────────────────
  let taps: number[] = [];
  let tapCount = $state(0);
  function tap() {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
    taps = [...taps, now].slice(-9);
    tapCount = taps.length;
    if (taps.length < 3) return;
    const spans = taps.slice(1).map((t, i) => t - taps[i]);
    const avg = spans.reduce((a, b) => a + b, 0) / spans.length;
    const bpm = Math.round((60000 / avg) * 10) / 10;
    if (!tempo) {
      showTimeline.setTempo(createTempoMap(bpm, Math.max(0, playhead)));
      return;
    }
    // A tapped beat counts in the signature's beat; BPM is quarter notes.
    setBpm(bpm * (4 / (seg?.beatUnit ?? 4)));
  }
</script>

<div class="show-inspector" data-tempo-inspector>
  <span class="insp-title">Tempo</span>
  {#if tempo && seg}
    <label class="insp-field">
      <span>BPM</span>
      <input
        class="insp-num"
        type="number"
        min={SHOW_MIN_BPM}
        max={SHOW_MAX_BPM}
        step="0.1"
        value={seg.bpm}
        onchange={(e) => setBpm(parseFloat((e.currentTarget as HTMLInputElement).value))}
        title="Tempo in quarter notes per minute"
        data-tempo-bpm
      />
    </label>
    <button class="insp-chip" onclick={tap} title="Tap along with the music: three taps or more set the tempo" data-tempo-tap>
      Tap{tapCount >= 2 ? ` ×${tapCount}` : ''}
    </button>
    <label class="insp-field">
      <span>Time</span>
      <input
        class="insp-num narrow"
        type="number"
        min="1"
        max="32"
        step="1"
        value={seg.beatsPerBar}
        onchange={(e) => {
          const v = Math.round(parseFloat((e.currentTarget as HTMLInputElement).value));
          if (v >= 1 && v <= 32) setSegment({ beatsPerBar: v });
        }}
        title="Beats in a bar"
        aria-label="Beats in a bar"
        data-tempo-beats
      />
      <span>/</span>
      <select
        value={String(seg.beatUnit)}
        onchange={(e) => setSegment({ beatUnit: Number((e.currentTarget as HTMLSelectElement).value) as ShowTempoSegment['beatUnit'] })}
        title="The note that counts as one beat"
        aria-label="The note that counts as one beat"
        data-tempo-unit
      >
        {#each [2, 4, 8, 16] as unit (unit)}
          <option value={String(unit)}>{unit}</option>
        {/each}
      </select>
    </label>
    <span class="insp-group" role="group" aria-label="Bar 1">
      <button class="insp-chip" onclick={() => setOffset(tempo.offset - beatSeconds)} title="Move the grid one beat earlier" aria-label="Move the grid one beat earlier" data-tempo-shift="-1">◀</button>
      <button class="insp-chip" onclick={() => setOffset(playhead)} title="Make the playhead bar 1, beat 1" data-tempo-bar1>Bar 1 here</button>
      <button class="insp-chip" onclick={() => setOffset(tempo.offset + beatSeconds)} title="Move the grid one beat later" aria-label="Move the grid one beat later" data-tempo-shift="1">▶</button>
    </span>
    <span class="insp-meta" data-tempo-offset>Bar 1 at {formatAt(tempo.offset)}{analysedName ? ` · from ${analysedName}` : ''}</span>
  {:else}
    <span class="insp-meta">No tempo map: the grid is in seconds.</span>
    <button class="insp-chip" onclick={addMap} title="A 120 BPM grid with bar 1 at the playhead" data-tempo-add>Add a tempo map</button>
    <button class="insp-chip" onclick={tap} title="Tap along with the music: three taps or more set the tempo" data-tempo-tap>
      Tap{tapCount >= 2 ? ` ×${tapCount}` : ''}
    </button>
  {/if}
  {#if usableAudio.length}
    {#if usableAudio.length > 1}
      <select class="insp-select" bind:value={detectTrackId} title="Audio track to detect the tempo of" aria-label="Audio track to detect the tempo of">
        <option value="">Longest track</option>
        {#each usableAudio as track (track.id)}
          <option value={track.id}>{track.name}</option>
        {/each}
      </select>
    {/if}
    <button class="insp-chip" onclick={detect} disabled={detecting} title="Find the tempo and the beats of the song, and lay the grid on them" data-tempo-detect>
      {detecting ? 'Listening…' : 'Detect tempo'}
    </button>
  {/if}
  {#if message && !detecting}
    <span class="insp-meta" class:warn={message.kind !== 'ok'} data-tempo-message>
      {#if message.kind === 'ok'}{message.bpm} BPM from <span class="layer-name">{message.name}</span>. Check where bar 1 is.
      {:else if message.kind === 'no-pulse'}No steady beat found in that track.
      {:else if message.kind === 'undecodable'}That track could not be read.
      {:else}Add a song to the show first.{/if}
    </span>
  {/if}
  {#if tempo}
    <button class="insp-delete" onclick={() => showTimeline.setTempo(null)} title="Remove the tempo map: the ruler and snapping go back to seconds" data-tempo-remove>Remove map</button>
  {/if}
  <button aria-label="Close tempo inspector" class="insp-close" class:alone={!tempo} onclick={onclose}>×</button>
</div>

<style>
  .show-inspector {
    display: flex;
    align-items: center;
    gap: 8px 10px;
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
  .insp-field { display: flex; align-items: center; gap: 5px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-num, .insp-field select, .insp-select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    outline: none;
    font-family: inherit;
    box-sizing: border-box;
  }
  .insp-num { width: 64px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .insp-num.narrow { width: 44px; }
  .insp-select { max-width: 160px; }
  .insp-group { display: inline-flex; gap: 2px; }
  .insp-chip {
    height: var(--ga-control-h-sm, 22px);
    padding: 0 8px;
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .insp-chip:hover:not(:disabled) { border-color: rgba(255, 217, 107, 0.6); }
  .insp-chip:disabled { opacity: 0.5; cursor: default; }
  .insp-meta {
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .insp-meta.warn { color: #f0c674; font-family: inherit; }
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
  .insp-delete:hover { background: color-mix(in srgb, var(--ga-rec, #ff4757) 14%, transparent); }
  .insp-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .insp-close.alone { margin-left: auto; }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }
</style>
