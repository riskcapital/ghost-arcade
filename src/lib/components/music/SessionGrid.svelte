<script lang="ts">
  /**
   * The session: a track of clip slots per part, launched like a DAW's
   * session view. Click a clip to start it on the next bar (it takes over its
   * track); a row's play button launches the whole row; a track's square stops
   * it. An empty slot's menu fills it from the factory presets or your own.
   * Double-click a clip, or its pencil, to edit its notes.
   */
  import { get } from 'svelte/store';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { ROLE_INSTRUMENTS } from '../../music/loops';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { TRACKS, clipFromPreset, duplicateClip, presetsFor, sessionRows, type SessionClip, type TrackId } from '../../music/session';
  import { userPresets } from '../../music/presetLibrary';
  import { launchClip, launchRow, saveBeat, stopTrack } from '../../music/musicRuntime';
  import { clipTrack, downloadMidi } from '../../music/midiExport';
  import { clipEditorId } from '../../music/studioUi';
  import { launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { generateUUID } from '../../utils/uuid';

  /** `compact`: the tray's narrower grid. */
  let { compact = false }: { compact?: boolean } = $props();

  const s = $derived($musicStudio);
  const t = $derived($musicTransport);
  const rows = $derived(Array.from({ length: sessionRows(s.session) }, (_, i) => i));

  function voiceLabel(track: TrackId): string {
    if (track === 'beats') return 'Drums';
    return INSTRUMENT_LABELS[ROLE_INSTRUMENTS[s.set][track]];
  }

  function playing(track: TrackId, clip: SessionClip): boolean {
    if (track === 'beats') return s.sequencerPlaying && t.beatLoop === clip.id;
    return s.playingLoops[track] === clip.id;
  }

  function queued(track: TrackId, clip: SessionClip): boolean {
    if (track === 'beats') return t.queuedBeat === clip.id;
    return s.queuedLoops[track] === clip.id;
  }

  function trackActive(track: TrackId): boolean {
    if (track === 'beats') return s.sequencerPlaying;
    return !!s.playingLoops[track] || !!s.queuedLoops[track];
  }

  /** Fill an empty slot from a preset menu. */
  function fill(track: TrackId, row: number, e: Event) {
    const el = e.target as HTMLSelectElement;
    const value = el.value;
    el.value = '';
    let clip: SessionClip | null = null;
    if (value.startsWith('preset:')) clip = clipFromPreset(value.slice(7), s.key, generateUUID());
    else if (value.startsWith('mine:')) {
      const preset = userPresets.byId(value.slice(5));
      if (preset) clip = duplicateClip(preset.clip, generateUUID(), preset.name);
    }
    if (clip) musicStudio.setSessionClip(track, row, clip);
  }

  function act(track: TrackId, row: number, clip: SessionClip, e: Event) {
    const el = e.target as HTMLSelectElement;
    const action = el.value;
    el.value = '';
    if (action === 'edit') clipEditorId.set(clip.id);
    else if (action === 'duplicate') {
      const rowsNow = get(musicStudio).session[track];
      const below = rowsNow.findIndex((c, i) => i > row && !c);
      musicStudio.setSessionClip(track, below >= 0 ? below : rowsNow.length, duplicateClip(clip, generateUUID()));
    } else if (action === 'preset') {
      userPresets.add(track, clip, generateUUID());
      showToast(`Added "${clip.name}" to your presets.`, 'info');
    } else if (action === 'midi') {
      downloadMidi({ bpm: Math.round(launchClockTempo() * 10) / 10, tracks: [clipTrack(clip, s.key)] }, clip.name);
    } else if (action === 'remove') {
      if (playing(track, clip)) stopTrack(track);
      musicStudio.setSessionClip(track, row, null);
    }
  }
</script>

<div class="session" class:compact role="grid" aria-label="Session" style="--tracks: {TRACKS.length}">
  <div class="corner"></div>
  {#each TRACKS as track (track.id)}
    <div class="head" role="columnheader">
      <span class="name">{track.label}</span>
      {#if !compact}<span class="voice">{voiceLabel(track.id)}</span>{/if}
      {#if track.id === 'beats' && !compact}
        <button class="mini-btn" onclick={saveBeat} title="Keep the beat in the grid as a new clip">SAVE</button>
      {/if}
      <button class="stop" disabled={!trackActive(track.id)} onclick={() => stopTrack(track.id)} aria-label="Stop {track.label}" title="Stop {track.label.toLowerCase()}">
        <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" rx="1" /></svg>
      </button>
    </div>
  {/each}

  {#each rows as row (row)}
    <button class="row-go" onclick={() => launchRow(row)} aria-label="Launch row {row + 1}" title="Launch row {row + 1} on the next bar">
      <span>{row + 1}</span>
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" /></svg>
    </button>
    {#each TRACKS as track (track.id)}
      {@const clip = s.session[track.id][row]}
      {#if clip}
        {@const on = playing(track.id, clip)}
        {@const next = queued(track.id, clip)}
        <div class="slot" class:on class:next role="gridcell">
          <button class="clip" onclick={() => launchClip(track.id, row)} ondblclick={() => clipEditorId.set(clip.id)} aria-pressed={on} title={next ? 'Starts on the next bar' : on ? 'Playing · double-click to edit' : 'Start on the next bar · double-click to edit'}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 2l7 4-7 4z" /></svg>
            <span>{clip.name}</span>
          </button>
          <button class="edit" onclick={() => clipEditorId.set(clip.id)} aria-label="Edit {clip.name}" title="Edit the notes">
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 10l1-3 5-5 2 2-5 5zM7 3l2 2" /></svg>
          </button>
          <select class="more" value="" onchange={(e) => act(track.id, row, clip, e)} aria-label="More for {clip.name}" title="More">
            <option value="" disabled>⋯</option>
            <option value="edit">Edit notes…</option>
            <option value="duplicate">Duplicate</option>
            <option value="preset">Add to my presets</option>
            <option value="midi">Save as MIDI</option>
            <option value="remove">Remove</option>
          </select>
        </div>
      {:else}
        <div class="slot empty" role="gridcell">
          <select value="" onchange={(e) => fill(track.id, row, e)} aria-label="Add a {track.label.toLowerCase()} clip to row {row + 1}" title="Add a clip">
            <option value="" disabled>+</option>
            <optgroup label="Presets">
              {#each presetsFor(track.id) as p (p.id)}<option value="preset:{p.id}">{p.name}</option>{/each}
            </optgroup>
            {#if $userPresets.some((p) => p.track === track.id)}
              <optgroup label="My presets">
                {#each $userPresets.filter((p) => p.track === track.id) as p (p.id)}<option value="mine:{p.id}">{p.name}</option>{/each}
              </optgroup>
            {/if}
          </select>
        </div>
      {/if}
    {/each}
  {/each}
  <button class="add-row" onclick={() => musicStudio.addSessionRow()} title="Add a row">+ ROW</button>
</div>

<style>
  .session {
    flex: 1;
    min-height: 0;
    overflow: auto;
    display: grid;
    grid-template-columns: 30px repeat(var(--tracks), minmax(0, 1fr));
    grid-auto-rows: 25px;
    gap: 3px 6px;
    align-content: start;
  }
  .corner { position: sticky; top: 0; z-index: 2; background: var(--studio-panel); }
  .head {
    position: sticky;
    top: 0;
    z-index: 2;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    background: var(--studio-panel);
    border-bottom: 1px solid var(--studio-edge-soft);
  }
  .name { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
  .voice { flex: 1; min-width: 0; font-size: 10px; color: var(--studio-muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .compact .name { flex: 1; }
  .stop,
  .edit,
  .row-go {
    flex: 0 0 auto;
    padding: 0;
    display: inline-grid;
    place-items: center;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .stop { width: 20px; height: 20px; }
  .stop:disabled { color: var(--studio-edge); border-color: var(--studio-edge-soft); cursor: default; }
  .stop svg { width: 9px; height: 9px; fill: currentColor; }
  .mini-btn {
    height: 20px;
    padding: 0 6px;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .row-go {
    gap: 0;
    grid-template-columns: 1fr 1fr;
    padding: 0 3px;
    border-color: var(--studio-edge-soft);
    color: var(--studio-muted);
    font-family: var(--ga-font-mono, ui-monospace);
    font-size: 9px;
  }
  .row-go svg { width: 7px; height: 7px; fill: currentColor; }
  .row-go:hover { color: var(--studio-ink); border-color: var(--studio-edge); }
  .slot { position: relative; min-width: 0; display: flex; gap: 2px; }
  .clip {
    flex: 1;
    min-width: 0;
    padding: 0 6px;
    display: flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .clip svg { flex: 0 0 auto; width: 8px; height: 8px; fill: var(--studio-muted); }
  .clip span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .clip:hover { border-color: var(--studio-edge); }
  .next .clip { border-color: var(--studio-accent); color: var(--studio-accent); }
  .next .clip svg { fill: var(--studio-accent); }
  .on .clip { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); }
  .on .clip svg { fill: var(--studio-on-accent); }
  .edit { width: 20px; border-color: var(--studio-edge-soft); color: var(--studio-muted); display: none; }
  .edit svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
  .more {
    width: 20px;
    height: auto;
    padding: 0;
    border-color: var(--studio-edge-soft);
    background: transparent;
    color: var(--studio-muted);
    text-align: center;
    display: none;
    appearance: none;
    cursor: pointer;
  }
  .slot:hover .edit, .slot:hover .more, .edit:focus-visible, .more:focus-visible { display: inline-grid; }
  .empty select {
    flex: 1;
    min-width: 0;
    height: auto;
    border: 1px dashed var(--studio-edge-soft);
    background: transparent;
    color: var(--studio-muted);
    text-align: center;
    appearance: none;
    cursor: pointer;
  }
  .empty select:hover { border-color: var(--studio-edge); color: var(--studio-ink); }
  .add-row {
    grid-column: 1 / -1;
    justify-self: start;
    height: 22px;
    padding: 0 8px;
    border: 1px dashed var(--studio-edge);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .compact { grid-template-columns: 24px repeat(var(--tracks), minmax(0, 1fr)); gap: 3px 4px; grid-auto-rows: 23px; }
  .compact .clip { font-size: 10px; padding: 0 4px; }
  .compact .clip svg { display: none; }
</style>
