<script lang="ts">
  /**
   * Visual score — the notes of a Live MIDI track drawn as lanes, one per
   * pitch, each labelled with the visual it fires. Drop a visual on a lane
   * to remap that pitch.
   */
  import { abletonBridge, abletonScoreHits, loopProgress, scoreAction, scoreTrackIndices, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { liveColor, type LiveClip, type VisualAction } from '../../ableton/abletonLinks';
  import { isScoreTrackName, noteName, SCORE_COLUMN_BASE, SCORE_SNAPSHOT_BASE } from '../../ableton/abletonScore';
  import { actionLabel, actionTag, actionThumb, VISUAL_DRAG_TYPE, type VisualContext } from '../../ableton/abletonVisuals';

  export let bridge: AbletonBridgeState;
  export let ctx: VisualContext;
  export let beat: number;
  export let now: number;
  export let selectedPitch: number | null = null;
  export let onSelectLane: (pitch: number) => void;
  export let onDropLane: (pitch: number, action: VisualAction) => void;

  let dropPitch: number | null = null;

  $: scoreIndices = scoreTrackIndices(bridge);
  $: midiTracks = bridge.tracks.map((t, i) => ({ track: t, index: i })).filter(x => x.track.midi);
  $: active = activeClip(bridge, scoreIndices);
  $: lanes = laneList(bridge, scoreIndices, ctx.numColumns);
  $: progress = active?.playing ? loopProgress(bridge, active.track, beat) : 0;

  /** The score clip to draw: the first one playing, else the first with notes. */
  function activeClip(state: AbletonBridgeState, indices: number[]) {
    for (const playingOnly of [true, false]) {
      for (const t of indices) {
        const track = state.tracks[t];
        const slots = playingOnly ? [track.playing] : track.slots.map((_, i) => i);
        for (const s of slots) {
          const clip = s >= 0 ? track.slots[s] : null;
          if (clip?.notes?.length) return { track: t, slot: s, clip, playing: track.playing === s, trackName: track.name };
        }
      }
    }
    return null;
  }

  function laneList(state: AbletonBridgeState, indices: number[], columns: number): number[] {
    const pitches = new Set<number>(Object.keys(state.scoreMap).map(Number));
    for (const t of indices) {
      for (const clip of state.tracks[t].slots) for (const n of clip?.notes ?? []) pitches.add(n[0]);
    }
    if (!pitches.size) {
      for (let i = 0; i < Math.min(columns, 8); i++) pitches.add(SCORE_COLUMN_BASE + i);
      for (let i = 0; i < 4; i++) pitches.add(SCORE_SNAPSHOT_BASE + i);
    }
    return [...pitches].sort((a, b) => b - a);
  }

  function notesOn(clip: LiveClip, pitch: number) {
    return (clip.notes ?? []).filter(n => n[0] === pitch);
  }

  function onDragOver(event: DragEvent, pitch: number) {
    if (!event.dataTransfer?.types.includes(VISUAL_DRAG_TYPE)) return;
    event.preventDefault();
    dropPitch = pitch;
  }

  function onDrop(event: DragEvent, pitch: number) {
    event.preventDefault();
    dropPitch = null;
    const raw = event.dataTransfer?.getData(VISUAL_DRAG_TYPE);
    if (raw) try { onDropLane(pitch, JSON.parse(raw)); } catch { /* not ours */ }
  }
</script>

<div class="score">
  <div class="tracks">
    <span class="label">Score tracks</span>
    {#each midiTracks as { track, index } (index)}
      {@const auto = isScoreTrackName(track.name)}
      {@const on = scoreIndices.includes(index)}
      <button
        class="chip"
        class:on
        style="--live: {liveColor(track.color)}"
        disabled={auto}
        title={auto ? 'Named for Ghost Arcade, so it always drives visuals' : on ? 'Stop using this track as a visual score' : 'Use this track as a visual score'}
        onclick={() => abletonBridge.setScoreTrack(track.name, !on)}
      >{track.name || `Track ${index + 1}`}{#if auto}<em>auto</em>{/if}</button>
    {:else}
      <span class="muted">No MIDI tracks in this set.</span>
    {/each}
    <button class="ghost" onclick={() => abletonBridge.createScoreTrack()} title="Adds a MIDI track named Ghost Arcade to your Live set">+ Ghost Arcade track in Live</button>
  </div>

  {#if !scoreIndices.length}
    <div class="intro">
      <b>Play your visuals from Live's piano roll.</b>
      <p>Add a MIDI track named <em>Ghost Arcade</em> (or mark one above) and draw notes in its clips. Each note fires a visual on the exact beat, follows tempo changes, and can be edited like any part. C1 and up fire columns, C3 and up fire snapshots; drop a visual on a lane to change it.</p>
    </div>
  {/if}

  <div class="head">
    <span class="clip-name">
      {#if active}
        <span class="dot" style="background: {liveColor(active.clip.color)}"></span>
        {active.trackName} · {active.clip.name || 'Clip'} <small>{Math.round(active.clip.length / 4 * 10) / 10} bars{active.playing ? ' · playing' : ''}</small>
      {:else}
        <small>No notes yet — lanes show the default map.</small>
      {/if}
    </span>
  </div>

  <div class="lanes">
    {#each lanes as pitch (pitch)}
      {@const action = scoreAction(bridge, pitch, ctx.numColumns)}
      {@const thumb = action ? actionThumb(ctx, action) : undefined}
      {@const hit = now - ($abletonScoreHits[pitch] ?? -1e9) < 160}
      <div class="lane" class:selected={selectedPitch === pitch} class:hit>
        <button
          class="lane-head"
          class:drop={dropPitch === pitch}
          class:custom={pitch in bridge.scoreMap}
          onclick={() => onSelectLane(pitch)}
          ondragover={(e) => onDragOver(e, pitch)}
          ondragleave={() => (dropPitch = null)}
          ondrop={(e) => onDrop(e, pitch)}
          title="Click, then pick a visual — or drop one here"
        >
          <span class="note">{noteName(pitch)}</span>
          <span class="vis">{#if thumb}<img src={thumb} alt="" />{:else}<i>{action ? actionTag(action) : ''}</i>{/if}</span>
          <span class="what">{action ? actionLabel(ctx, action) : 'Nothing'}</span>
        </button>
        <div class="roll">
          {#if active}
            {#each notesOn(active.clip, pitch) as n}
              <span class="n" style="left: {(n[1] / active.clip.length) * 100}%; width: {Math.max(0.6, (n[2] / active.clip.length) * 100)}%; opacity: {0.45 + (n[3] / 127) * 0.55}"></span>
            {/each}
          {/if}
        </div>
      </div>
    {/each}
    {#if active?.playing}
      <span class="playhead" style="left: calc(var(--head) + (100% - var(--head)) * {progress})"></span>
    {/if}
  </div>
</div>

<style>
  .score { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .tracks { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .label { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #8a909b); margin-right: 4px; }
  .muted { color: var(--ga-ink-2, #8a909b); }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    height: var(--ga-control-h, 26px); padding: 0 9px;
    border-radius: var(--ga-r-hard, 5px);
    border: 1px solid var(--ga-line-2);
    border-left: 3px solid var(--live);
    background: transparent;
    color: var(--ga-ink-1, #b8bdc6);
    font: inherit; cursor: pointer;
  }
  .chip.on { background: color-mix(in srgb, var(--live) 22%, transparent); color: var(--ga-ink-0, #eef0f4); border-color: color-mix(in srgb, var(--live) 70%, transparent); }
  .chip:disabled { cursor: default; }
  .chip em { font-style: normal; font-size: var(--ga-text-eyebrow, 10px); font-weight: 600; color: var(--ga-live, #46d18a); }
  .ghost { height: var(--ga-control-h, 26px); padding: 0 10px; font-weight: var(--ga-weight-control, 600); border-radius: var(--ga-r-hard, 5px); border: 1px dashed var(--ga-line-3); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; cursor: pointer; }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); border-color: var(--ga-line-3); }
  .intro { padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--ga-selection-line) 45%, transparent); background: color-mix(in srgb, var(--ga-selection-bg) 45%, transparent); border-radius: var(--ga-r-hard, 5px); }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .intro em { font-style: normal; color: var(--ga-selection-ink); }
  .head { display: flex; align-items: center; }
  .clip-name { display: flex; align-items: center; gap: 6px; font-weight: 500; }
  .clip-name small { color: var(--ga-ink-2, #8a909b); font-weight: 400; }
  .dot { width: 8px; height: 8px; border-radius: 2px; }
  .lanes { --head: 220px; position: relative; display: flex; flex-direction: column; gap: 2px; }
  .lane { display: grid; grid-template-columns: var(--head) minmax(0, 1fr); min-height: 28px; }
  .lane-head {
    display: flex; align-items: center; gap: 7px;
    padding: 2px 6px;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard, 5px) 0 0 3px;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
    min-width: 0;
  }
  .lane-head.custom { border-left: 2px solid var(--ga-selection-line); }
  .lane-head.drop { box-shadow: inset 0 0 0 2px var(--ga-selection-line); }
  .lane.selected .lane-head { box-shadow: inset 0 0 0 1px var(--ga-selection-line); }
  .note { width: 34px; font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: 11px; color: var(--ga-ink-2, #8a909b); }
  .vis { width: 36px; height: 20px; border-radius: 2px; overflow: hidden; background: #000; border: 1px solid color-mix(in srgb, var(--ga-selection-line) 60%, transparent); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .vis img { width: 100%; height: 100%; object-fit: cover; }
  .vis i { font-style: normal; font-size: 9px; font-weight: 700; color: var(--ga-ink-1); }
  .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .roll {
    position: relative;
    background:
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 25%),
      rgba(255, 255, 255, 0.015);
    border: 1px solid var(--ga-line-1);
    border-left: none;
    border-radius: 0 3px 3px 0;
  }
  .n { position: absolute; top: 4px; bottom: 4px; background: var(--ga-selection-line); border-radius: 2px; }
  .lane.hit .n { background: var(--ga-selection-ink); }
  .lane.hit .lane-head { background: var(--ga-selection-bg); }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ga-live, #46d18a); pointer-events: none; }
</style>
