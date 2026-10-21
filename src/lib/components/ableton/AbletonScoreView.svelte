<script lang="ts">
  /**
   * Visual score — open any MIDI clip in the Live set and see its notes as
   * lanes, one per pitch, each labelled with the visual it fires. On a drum
   * track the lanes are the kit (Kick, Snare, Closed Hat… or the Drum Rack's
   * own pad names) and start empty; drop a visual, or a Scramble, on a lane
   * and that drum drives it on the exact beat.
   */
  import { abletonBridge, abletonScoreHits, loopProgress, scoreAction, scoreTrackIndices, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { liveColor, type LiveClip, type LiveTrack, type VisualAction } from '../../ableton/abletonLinks';
  import { drumName, isDrumTrack, isScoreTrackName, noteName, SCORE_COLUMN_BASE, SCORE_SNAPSHOT_BASE } from '../../ableton/abletonScore';
  import { actionLabel, actionTag, actionThumb, VISUAL_DRAG_TYPE, type VisualContext } from '../../ableton/abletonVisuals';

  export let bridge: AbletonBridgeState;
  export let ctx: VisualContext;
  export let beat: number;
  export let now: number;
  export let selectedPitch: number | null = null;
  /** The clip opened for a closer look, or null to follow what's playing. */
  export let drill: { track: number; slot: number } | null = null;
  export let onDrill: (track: number, slot: number) => void;
  export let onSelectLane: (pitch: number, track: number | null) => void;
  export let onDropLane: (pitch: number, action: VisualAction, track: number | null) => void;

  let dropPitch: number | null = null;

  $: scoreIndices = scoreTrackIndices(bridge);
  $: midiTracks = bridge.tracks.map((t, i) => ({ track: t, index: i })).filter(x => x.track.midi);
  $: active = shownClip(bridge, scoreIndices, drill);
  $: laneTrack = active ? bridge.tracks[active.track] : undefined;
  $: drums = !!laneTrack && isDrumTrack(laneTrack);
  $: lanes = laneList(bridge, active, laneTrack, drums, ctx.numColumns);
  $: progress = active?.playing ? loopProgress(bridge, active.track, beat) : 0;

  type Shown = { track: number; slot: number; clip: LiveClip; playing: boolean; trackName: string };

  /** The clip to draw: the one opened, else the first score clip playing,
   *  else the first score clip with notes. */
  function shownClip(state: AbletonBridgeState, indices: number[], opened: typeof drill): Shown | null {
    if (opened) {
      const track = state.tracks[opened.track];
      const clip = track?.midi ? track.slots[opened.slot] : null;
      if (track && clip) return { track: opened.track, slot: opened.slot, clip, playing: track.playing === opened.slot, trackName: track.name };
    }
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

  /** The pitches to show: the clip's notes and the track's mapped lanes;
   *  with nothing open, the shared map or the default lanes. */
  function laneList(state: AbletonBridgeState, shown: Shown | null, track: LiveTrack | undefined, drumTrack: boolean, columns: number): number[] {
    const pitches = new Set<number>();
    for (const n of shown?.clip.notes ?? []) pitches.add(n[0]);
    if (track) for (const p of Object.keys(state.trackScoreMaps[track.name] ?? {})) pitches.add(Number(p));
    if (!drumTrack && !pitches.size) {
      for (const p of Object.keys(state.scoreMap)) pitches.add(Number(p));
      if (!pitches.size) {
        for (let i = 0; i < Math.min(columns, 8); i++) pitches.add(SCORE_COLUMN_BASE + i);
        for (let i = 0; i < 4; i++) pitches.add(SCORE_SNAPSHOT_BASE + i);
      }
    }
    return [...pitches].sort((a, b) => b - a);
  }

  function laneName(pitch: number, track: LiveTrack | undefined, drumTrack: boolean): string {
    return drumTrack ? drumName(pitch, track?.pads) : noteName(pitch);
  }

  function ownLane(state: AbletonBridgeState, track: LiveTrack | undefined, pitch: number): boolean {
    return track ? pitch in (state.trackScoreMaps[track.name] ?? {}) : pitch in state.scoreMap;
  }

  function notesOn(clip: LiveClip, pitch: number) {
    return (clip.notes ?? []).filter(n => n[0] === pitch);
  }

  function hitCount(clip: LiveClip, pitch: number): number {
    return notesOn(clip, pitch).length;
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
    if (raw) try { onDropLane(pitch, JSON.parse(raw), active?.track ?? null); } catch { /* not ours */ }
  }
</script>

<div class="score">
  <div class="clips">
    {#each midiTracks as { track, index } (index)}
      {@const auto = isScoreTrackName(track.name)}
      {@const on = scoreIndices.includes(index)}
      <div class="clip-group" style="--live: {liveColor(track.color)}">
        <button
          class="track-chip"
          class:on
          disabled={auto}
          title={auto ? 'Named for Ghost Arcade, so its notes always drive visuals' : on ? "Stop this track's notes driving visuals" : "Let this track's notes drive visuals"}
          onclick={() => abletonBridge.setScoreTrack(track.name, !on)}
        >
          <span class="led" aria-hidden="true"></span>{track.name || `Track ${index + 1}`}{#if isDrumTrack(track)}<em>drums</em>{/if}
        </button>
        {#each track.slots as clip, s}
          {#if clip}
            <button
              class="clip-chip"
              class:open={active?.track === index && active.slot === s}
              class:playing={track.playing === s}
              style="--clip: {liveColor(clip.color)}"
              onclick={() => onDrill(index, s)}
              title="Open {clip.name || 'this clip'} to see its notes"
            >{clip.name || `Clip ${s + 1}`}</button>
          {/if}
        {/each}
      </div>
    {:else}
      <span class="muted">No MIDI tracks in this set.</span>
    {/each}
    <button class="ghost" onclick={() => abletonBridge.createScoreTrack()} title="Adds a MIDI track named Ghost Arcade to your Live set">+ Ghost Arcade track in Live</button>
  </div>

  {#if !active && !scoreIndices.length}
    <div class="intro">
      <b>Let the beat drive the visuals.</b>
      <p>Open any MIDI clip above to see its notes as lanes. On a drum track every drum gets a lane: drop a visual or a Scramble on Kick, Snare or the hats and it fires on every hit, on the exact beat. A track named <em>Ghost Arcade</em> drives visuals from the default lanes: C1 and up fire columns, C3 and up fire snapshots.</p>
    </div>
  {/if}

  <div class="head">
    <span class="clip-name">
      {#if active}
        <span class="dot" style="background: {liveColor(active.clip.color)}"></span>
        {active.trackName} · {active.clip.name || 'Clip'}
        <small>
          {Math.round(active.clip.length / 4 * 10) / 10} bars
          {#if active.clip.notes}· {active.clip.notes.length} notes{/if}
          {#if active.playing}· playing{/if}
        </small>
      {:else}
        <small>Open a clip to see its notes.</small>
      {/if}
    </span>
    {#if active && !scoreIndices.includes(active.track)}
      <span class="warn">Its notes reach Ghost Arcade once the track drives visuals.</span>
    {:else if active && !active.clip.notes}
      <span class="muted">Reading notes from Live…</span>
    {:else if drums}
      <span class="muted">Drum lanes start empty. Drop a visual or a Scramble on a drum.</span>
    {/if}
  </div>

  <div class="lanes" class:drums>
    {#each lanes as pitch (pitch)}
      {@const action = scoreAction(bridge, pitch, ctx.numColumns, laneTrack)}
      {@const thumb = action ? actionThumb(ctx, action) : undefined}
      {@const hit = now - ($abletonScoreHits[pitch] ?? -1e9) < 160}
      <div class="lane" class:selected={selectedPitch === pitch} class:hit class:idle={!action}>
        <button
          class="lane-head"
          class:drop={dropPitch === pitch}
          class:custom={ownLane(bridge, laneTrack, pitch)}
          onclick={() => onSelectLane(pitch, active?.track ?? null)}
          ondragover={(e) => onDragOver(e, pitch)}
          ondragleave={() => (dropPitch = null)}
          ondrop={(e) => onDrop(e, pitch)}
          title="Click, then pick a visual — or drop one here"
        >
          <span class="note">
            <b>{laneName(pitch, laneTrack, drums)}</b>
            {#if drums}<small>{noteName(pitch)}{#if active} · {hitCount(active.clip, pitch)}×{/if}</small>{/if}
          </span>
          <span class="vis">{#if thumb}<img src={thumb} alt="" />{:else}<i>{action ? actionTag(action) : '+'}</i>{/if}</span>
          <span class="what">{action ? actionLabel(ctx, action) : 'Drop a visual'}</span>
        </button>
        <div class="roll">
          {#if active}
            {#each notesOn(active.clip, pitch) as n}
              <span class="n" style="left: {(n[1] / active.clip.length) * 100}%; width: {Math.max(0.6, (n[2] / active.clip.length) * 100)}%; opacity: {0.45 + (n[3] / 127) * 0.55}"></span>
            {/each}
          {/if}
        </div>
      </div>
    {:else}
      <p class="muted">{active ? 'No notes in this clip yet.' : ''}</p>
    {/each}
    {#if active?.playing}
      <span class="playhead" style="left: calc(var(--head) + (100% - var(--head)) * {progress})"></span>
    {/if}
  </div>
</div>

<style>
  .score { display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .muted { color: var(--ga-ink-2, #8a909b); font-size: 11px; }
  .warn { color: #e0a33a; font-size: 11px; }
  .clips { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .clip-group { display: flex; align-items: center; gap: 3px; padding: 3px; border-radius: 4px; border: 1px solid rgba(255, 255, 255, 0.06); border-left: 3px solid var(--live); background: rgba(255, 255, 255, 0.02); }
  .track-chip {
    display: inline-flex; align-items: center; gap: 6px;
    height: 24px; padding: 0 9px;
    border: none; border-radius: 3px;
    background: transparent;
    color: var(--ga-ink-1, #b8bdc6);
    font: inherit; font-weight: 600; cursor: pointer;
  }
  .track-chip:disabled { cursor: default; }
  .track-chip .led { width: 7px; height: 7px; border-radius: 50%; background: #3a3f47; }
  .track-chip.on .led { background: var(--ga-live, #46d18a); box-shadow: 0 0 6px var(--ga-live, #46d18a); }
  .track-chip em { font-style: normal; font-size: 9px; letter-spacing: 0.08em; text-transform: uppercase; color: #c9c4ff; }
  .clip-chip {
    height: 24px; padding: 0 9px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-left: 3px solid var(--clip);
    background: color-mix(in srgb, var(--clip) 10%, #0c0f14);
    color: var(--ga-ink-1, #b8bdc6);
    font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap;
  }
  .clip-chip:hover { color: var(--ga-ink-0, #eef0f4); }
  .clip-chip.playing { box-shadow: inset 0 -2px 0 var(--ga-live, #46d18a); }
  .clip-chip.open { background: color-mix(in srgb, var(--clip) 30%, #0c0f14); color: var(--ga-ink-0, #eef0f4); border-color: #c9c4ff; }
  .ghost { height: 24px; padding: 0 10px; border-radius: 3px; border: 1px dashed rgba(255, 255, 255, 0.2); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; cursor: pointer; }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.4); }
  .intro { padding: 10px 12px; border: 1px solid rgba(127, 119, 221, 0.35); background: rgba(127, 119, 221, 0.08); border-radius: 4px; }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .intro em { font-style: normal; color: #c9c4ff; }
  .head { display: flex; align-items: center; gap: 12px; }
  .clip-name { display: flex; align-items: center; gap: 6px; font-weight: 500; }
  .clip-name small { color: var(--ga-ink-2, #8a909b); font-weight: 400; }
  .dot { width: 8px; height: 8px; border-radius: 2px; }
  .lanes { --head: 240px; position: relative; display: flex; flex-direction: column; gap: 2px; }
  .lane { display: grid; grid-template-columns: var(--head) minmax(0, 1fr); min-height: 28px; }
  .lanes.drums .lane { min-height: 32px; }
  .lane-head {
    display: flex; align-items: center; gap: 7px;
    padding: 2px 6px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-radius: 3px 0 0 3px;
    color: inherit; font: inherit; text-align: left; cursor: pointer;
    min-width: 0;
  }
  .lane-head.custom { border-left: 2px solid #7f77dd; }
  .lane-head.drop { box-shadow: inset 0 0 0 2px #c9c4ff; }
  .lane.selected .lane-head { box-shadow: inset 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  .note { width: 78px; display: flex; flex-direction: column; line-height: 1.15; flex: 0 0 auto; }
  .note b { font-weight: 600; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .note small { font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 9px; color: var(--ga-ink-2, #8a909b); }
  .lanes:not(.drums) .note b { font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-weight: 400; color: var(--ga-ink-2, #8a909b); }
  .vis { width: 36px; height: 20px; border-radius: 2px; overflow: hidden; background: #000; border: 1px solid rgba(201, 196, 255, 0.4); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .lane.idle .vis { border-style: dashed; border-color: rgba(255, 255, 255, 0.18); }
  .vis img { width: 100%; height: 100%; object-fit: cover; }
  .vis i { font-style: normal; font-size: 9px; font-weight: 700; color: #c9c4ff; }
  .lane.idle .vis i { color: var(--ga-ink-3, #555a63); font-size: 12px; }
  .what { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lane.idle .what { color: var(--ga-ink-2, #8a909b); }
  .roll {
    position: relative;
    background:
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 25%),
      rgba(255, 255, 255, 0.015);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-left: none;
    border-radius: 0 3px 3px 0;
  }
  .n { position: absolute; top: 4px; bottom: 4px; background: #7f77dd; border-radius: 2px; }
  .lane.idle .n { background: #4a4672; }
  .lane.hit .n { background: #c9c4ff; }
  .lane.hit .lane-head { background: rgba(127, 119, 221, 0.3); }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--ga-live, #46d18a); pointer-events: none; }
</style>
