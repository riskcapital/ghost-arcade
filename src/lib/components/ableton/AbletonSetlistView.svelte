<script lang="ts">
  /**
   * Setlist — every song in the Live set as one list, in the DJ's order.
   * Play any song in any order; it lands on the bar with its visuals, and in
   * deck mode the crossfader mixes over to it. Drag rows to reorder; Next
   * plays the next song that hasn't played yet.
   */
  import { abletonBridge, setlist, songBeat, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { launchBeat, linksForClip, linksForScene, liveColor, quantizeBeats, samePlace, type AbletonSource } from '../../ableton/abletonLinks';
  import { nextSong, type SetlistSong } from '../../ableton/abletonSetlist';
  import { actionLabel, actionTag, actionThumb, type VisualContext } from '../../ableton/abletonVisuals';

  export let bridge: AbletonBridgeState;
  export let ctx: VisualContext;
  export let beat: number;
  export let selected: AbletonSource | null = null;
  export let onSelect: (source: AbletonSource) => void;

  const MIX_CHOICES = [0, 4, 8, 16];
  const DRAG_TYPE = 'application/x-ghost-setlist';

  let query = '';
  let dragKey: string | null = null;
  let dropKey: string | null = null;

  $: songs = setlist(bridge);
  $: shown = query.trim() ? songs.filter(s => s.title.toLowerCase().includes(query.trim().toLowerCase())) : songs;
  $: played = new Set(bridge.played);
  $: perBar = bridge.numerator * (4 / bridge.denominator);
  $: step = quantizeBeats(bridge.quantize, bridge.numerator, bridge.denominator);
  $: current = songs.find(s => s.key === bridge.currentSong && isPlaying(bridge, s)) ?? null;
  $: upNext = nextSong(songs, bridge.currentSong, played);
  $: cued = songs.find(s => isCued(bridge, s)) ?? null;
  $: mixProgress = bridge.mix ? Math.max(0, Math.min(1, (beat - bridge.mix.startBeat) / Math.max(0.001, bridge.mix.beats))) : 0;

  // Helpers take the state they read, so the template re-renders with it.
  function isPlaying(state: AbletonBridgeState, song: SetlistSong): boolean {
    if (song.kind === 'clip') return state.tracks[song.track]?.playing === song.slot;
    return song.sections.some(sec => state.tracks.some(t => t.playing === sec.scene));
  }

  function isCued(state: AbletonBridgeState, song: SetlistSong): boolean {
    if (song.kind === 'clip') return state.tracks[song.track]?.fired === song.slot;
    const first = song.sections[0]?.scene ?? -1;
    return !!state.scenes[first]?.queued || state.tracks.some(t => t.fired === first);
  }

  function cueCountdown(state: AbletonBridgeState, song: SetlistSong, at: number): string {
    const fired = song.kind === 'clip'
      ? state.tracks[song.track]?.firedBeat
      : state.tracks.find(t => t.fired === song.sections[0]?.scene)?.firedBeat;
    const left = launchBeat(fired ?? at, step) - at;
    if (!state.playing || left <= 0) return '';
    return left >= 1 ? String(Math.ceil(left)) : '•';
  }

  function barsIn(state: AbletonBridgeState, song: SetlistSong, at: number): number {
    const track = song.kind === 'clip'
      ? state.tracks[song.track]
      : state.tracks.find(t => song.sections.some(sec => sec.scene === t.playing));
    return track ? Math.floor(Math.max(0, at - track.startedBeat) / perBar) + 1 : 0;
  }

  function songLinks(state: AbletonBridgeState, song: SetlistSong) {
    return song.kind === 'clip' ? linksForClip(state.links, song.track, song.slot) : linksForScene(state.links, song.sections[0]?.scene ?? -1);
  }

  function songSource(state: AbletonBridgeState, song: SetlistSong): AbletonSource {
    if (song.kind === 'clip') {
      const t = state.tracks[song.track];
      return { kind: 'clip', track: song.track, slot: song.slot, trackName: t?.name ?? '', name: t?.slots[song.slot]?.name ?? '' };
    }
    const scene = song.sections[0]?.scene ?? 0;
    return { kind: 'scene', scene, name: state.scenes[scene]?.name ?? '' };
  }

  function deckLabel(song: SetlistSong): string {
    return song.kind === 'clip' ? (song.side ?? '–') : `${song.sections.length} parts`;
  }

  // ── Reordering ───────────────────────────────────────────────────────

  function onDragStart(event: DragEvent, song: SetlistSong) {
    dragKey = song.key;
    event.dataTransfer?.setData(DRAG_TYPE, song.key);
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onDragOver(event: DragEvent, song: SetlistSong) {
    if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
    event.preventDefault();
    dropKey = song.key;
  }

  function onDrop(event: DragEvent, target: SetlistSong) {
    event.preventDefault();
    const key = event.dataTransfer?.getData(DRAG_TYPE) || dragKey;
    dragKey = dropKey = null;
    if (!key || key === target.key) return;
    const keys = songs.map(s => s.key).filter(k => k !== key);
    keys.splice(keys.indexOf(target.key), 0, key);
    abletonBridge.setSetlistOrder(keys);
  }

  function play(song: SetlistSong) {
    abletonBridge.playSong(song);
    onSelect(songSource(bridge, song));
  }
</script>

<div class="setlist">
  <div class="deck-strip">
    <div class="now">
      <span class="label">Now playing</span>
      {#if current}
        <span class="title" style="--live: {liveColor(current.color)}">{current.title}</span>
        <span class="meta">
          {#if current.kind === 'clip' && current.side}<b>Deck {current.side}</b>{/if}
          {#if current.bpm}{current.bpm} BPM{/if}
          · bar {barsIn(bridge, current, beat)}
        </span>
      {:else}
        <span class="title idle">Nothing yet — pick a song or press Next</span>
      {/if}
    </div>

    <div class="next">
      <span class="label">{cued ? 'Cued' : 'Up next'}</span>
      {#if cued}
        <span class="title">{cued.title}</span>
        {#if cueCountdown(bridge, cued, beat)}<span class="countdown">{cueCountdown(bridge, cued, beat)}</span>{/if}
      {:else if upNext}
        <span class="title">{upNext.title}</span>
      {:else}
        <span class="title idle">End of set</span>
      {/if}
      <button class="next-btn" disabled={!upNext} onclick={() => abletonBridge.playNext()} title="Play the next unplayed song in your order">Next ▶</button>
    </div>

    <div class="mixer">
      <span class="label">Auto-mix</span>
      <div class="seg">
        {#each MIX_CHOICES as bars}
          <button class:active={bridge.autoMixBars === bars} onclick={() => abletonBridge.setAutoMixBars(bars)}>{bars === 0 ? 'Cut' : `${bars} bars`}</button>
        {/each}
      </div>
      {#if bridge.mix}
        <span class="mixing">Mixing to {bridge.mix.to === 0 ? 'A' : 'B'} · {bridge.mix.title}<span class="bar"><span style="transform: scaleX({mixProgress})"></span></span></span>
      {:else if !bridge.deckMode}
        <span class="hint">Turn on Link decks (Decks tab) to mix the crossfader</span>
      {/if}
    </div>
  </div>

  <div class="tools">
    <input type="search" placeholder="Find a song" bind:value={query} aria-label="Find a song" />
    <span class="count">{bridge.played.length} of {songs.length} played</span>
    {#if bridge.played.length}<button class="ghost" onclick={() => abletonBridge.resetPlayed()}>Clear played</button>{/if}
  </div>

  {#if !songs.length}
    <div class="intro">
      <b>Your set shows up here.</b>
      <p>Songs come from Live: clips on deck tracks (tracks assigned to the A or B side of the crossfader), or blocks of scenes where the first scene of each song has its tempo in its name, like "Deep Hours 122 BPM".</p>
    </div>
  {/if}

  <div class="rows">
    {#each shown as song, index (song.key)}
      {@const links = songLinks(bridge, song)}
      {@const thumb = links[0] ? actionThumb(ctx, links[0].action) : undefined}
      {@const playing = isPlaying(bridge, song)}
      {@const queued = isCued(bridge, song)}
      {@const src = songSource(bridge, song)}
      <div
        class="row"
        class:playing
        class:queued
        class:played={played.has(song.key) && !playing}
        class:selected={selected && samePlace(src, selected)}
        class:drop={dropKey === song.key}
        style="--live: {liveColor(song.color)}"
        role="button"
        draggable={!query.trim()}
        ondragstart={(e) => onDragStart(e, song)}
        ondragover={(e) => onDragOver(e, song)}
        ondragleave={() => (dropKey = null)}
        ondrop={(e) => onDrop(e, song)}
        onclick={() => onSelect(src)}
        ondblclick={() => play(song)}
        onkeydown={(e) => e.key === 'Enter' && play(song)}
        tabindex="0"
      >
        <span class="num">{index + 1}</span>
        <button class="play" onclick={(e) => { e.stopPropagation(); play(song); }} title="Play — lands on the bar" aria-label="Play {song.title}">
          <svg width="11" height="11" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
        </button>
        <span class="name">
          <span class="song-title">{song.title}</span>
          {#if song.kind === 'scenes' && song.sections.length > 1}
            <span class="sections">
              {#each song.sections as section (section.scene)}
                <button class="section" onclick={(e) => { e.stopPropagation(); abletonBridge.launchScene(section.scene); }} title="Launch {section.label}">{section.label}</button>
              {/each}
            </span>
          {/if}
        </span>
        <span class="status">
          {#if playing}<b class="on">{bridge.currentSong === song.key ? 'NOW' : 'PLAYING'}</b> <small>bar {barsIn(bridge, song, beat)}</small>
          {:else if queued}<span class="countdown">{cueCountdown(bridge, song, beat) || '•'}</span>
          {:else if played.has(song.key)}<small>played</small>{/if}
        </span>
        <span class="bpm">{song.bpm ?? '—'}</span>
        <span class="deck" class:a={song.kind === 'clip' && song.side === 'A'} class:b={song.kind === 'clip' && song.side === 'B'}>{deckLabel(song)}</span>
        <span class="visual" title={links[0] ? actionLabel(ctx, links[0].action) : 'No visual linked — pick one on the right'}>
          <span class="vis">{#if thumb}<img src={thumb} alt="" />{:else if links[0]}<i>{actionTag(links[0].action)}</i>{:else}<i class="none">+</i>{/if}</span>
          <span class="vis-label">{links[0] ? actionLabel(ctx, links[0].action) : 'No visual'}</span>
        </span>
      </div>
    {/each}
  </div>
</div>

<style>
  .setlist { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .deck-strip { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr) auto; gap: 10px; }
  .now, .next, .mixer { display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; background: rgba(255, 255, 255, 0.02); min-width: 0; }
  .now { border-color: color-mix(in srgb, var(--ga-live, #46d18a) 40%, transparent); }
  .label { font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ga-ink-2, #8a909b); }
  .title { font-size: 15px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .now .title { border-left: 3px solid var(--live, transparent); padding-left: 6px; }
  .title.idle { font-size: 12px; font-weight: 400; color: var(--ga-ink-2, #8a909b); border: none; padding: 0; }
  .meta { color: var(--ga-ink-1, #b8bdc6); font-size: 11px; }
  .meta b { color: var(--ga-live, #46d18a); font-weight: 600; margin-right: 4px; }
  .next { position: relative; padding-right: 92px; }
  .next-btn { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); height: 32px; padding: 0 14px; border-radius: 4px; border: none; background: var(--ga-ink-0, #eef0f4); color: #07090d; font: inherit; font-weight: 700; cursor: pointer; }
  .next-btn:disabled { opacity: 0.35; cursor: default; }
  .mixer { justify-content: center; }
  .seg { display: flex; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 3px; }
  .seg button { padding: 4px 9px; background: transparent; border: none; color: var(--ga-ink-2, #8a909b); font: inherit; cursor: pointer; white-space: nowrap; }
  .seg button.active { background: rgba(255, 255, 255, 0.12); color: var(--ga-ink-0, #eef0f4); }
  .mixing { display: flex; align-items: center; gap: 6px; font-size: 11px; color: #c9c4ff; white-space: nowrap; }
  .mixing .bar { width: 70px; height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
  .mixing .bar span { display: block; height: 100%; background: #c9c4ff; transform-origin: left center; }
  .hint { font-size: 10px; color: var(--ga-ink-2, #8a909b); }
  .tools { display: flex; align-items: center; gap: 10px; }
  .tools input { width: 240px; height: 26px; background: #000; color: var(--ga-ink-0, #eef0f4); border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 3px; padding: 0 8px; font: inherit; }
  .count { color: var(--ga-ink-2, #8a909b); font-size: 11px; }
  .ghost { height: 24px; padding: 0 9px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.14); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; font-size: 11px; cursor: pointer; }
  .intro { padding: 10px 12px; border: 1px solid rgba(127, 119, 221, 0.35); background: rgba(127, 119, 221, 0.08); border-radius: 4px; }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .countdown { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #e0a33a; color: #1a1204; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); }
  .rows { display: flex; flex-direction: column; gap: 2px; }
  .row {
    display: grid;
    grid-template-columns: 26px 26px minmax(0, 1fr) 96px 46px 62px 200px;
    align-items: center;
    gap: 8px;
    min-height: 36px;
    padding: 3px 8px 3px 4px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.04);
    border-left: 3px solid var(--live);
    background: rgba(255, 255, 255, 0.02);
    cursor: pointer;
    outline: none;
  }
  .row:hover { background: color-mix(in srgb, var(--live) 12%, #0c0f14); }
  .row.selected { box-shadow: inset 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  .row.playing { background: color-mix(in srgb, var(--ga-live, #46d18a) 12%, #0c0f14); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-live, #46d18a) 70%, transparent); }
  .row.queued { animation: queued 0.5s steps(2) infinite; }
  .row.played { opacity: 0.5; }
  .row.drop { box-shadow: inset 0 2px 0 #c9c4ff; }
  @keyframes queued { 50% { box-shadow: inset 0 0 0 1px #e0a33a; } }
  .num { color: var(--ga-ink-2, #8a909b); font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 11px; text-align: right; }
  .play { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.15); background: transparent; color: var(--ga-ink-1, #b8bdc6); cursor: pointer; padding: 0; }
  .play:hover, .row.playing .play { color: #07090d; background: var(--ga-live, #46d18a); border-color: transparent; }
  .name { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .song-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sections { display: flex; gap: 3px; flex-wrap: nowrap; overflow: hidden; }
  .section { height: 20px; padding: 0 7px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.12); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; font-size: 10px; cursor: pointer; white-space: nowrap; }
  .section:hover { border-color: var(--live); color: var(--ga-ink-0, #eef0f4); }
  .status { display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--ga-ink-2, #8a909b); }
  .status .on { color: var(--ga-live, #46d18a); font-size: 10px; letter-spacing: 0.08em; }
  .bpm { font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 11px; color: var(--ga-ink-1, #b8bdc6); }
  .deck { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; color: var(--ga-ink-2, #8a909b); }
  .deck.a, .deck.b { width: 22px; height: 20px; display: flex; align-items: center; justify-content: center; border-radius: 3px; color: #07090d; }
  .deck.a { background: #5dcaa5; }
  .deck.b { background: #f0997b; }
  .visual { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .vis { width: 44px; height: 25px; border-radius: 2px; overflow: hidden; background: #000; border: 1px solid rgba(201, 196, 255, 0.4); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .vis img { width: 100%; height: 100%; object-fit: cover; }
  .vis i { font-style: normal; font-size: 9px; font-weight: 700; color: #c9c4ff; }
  .vis i.none { color: var(--ga-ink-3, #555a63); font-size: 13px; }
  .vis-label { font-size: 11px; color: var(--ga-ink-1, #b8bdc6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style>
