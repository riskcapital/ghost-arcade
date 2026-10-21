<script lang="ts">
  /**
   * Setlist — every song in the Live set as one list, in the DJ's order.
   * Play any song in any order; it lands on the bar with its visuals, and in
   * deck mode the crossfader mixes over to it. Drag rows to reorder; Next
   * plays the next song that hasn't played yet. A song made of sections
   * (Intro, Build, Drop…) gets a pad per section: each loops until the
   * next is picked, so the intro runs as long as the room needs.
   *
   * Play mode decides who moves things along: Live leaves every section to
   * the DJ, Song follows each song's plan (bars per section), and Set plays
   * the whole setlist, mixing into each song as the last one ends. Hold
   * keeps the current section looping in either automatic mode.
   */
  import { abletonBridge, abletonCrossfader, setlist, songBeat, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { launchBeat, linksForClip, linksForScene, liveColor, quantizeBeats, samePlace, type AbletonSource } from '../../ableton/abletonLinks';
  import { autoEvents, nextPlanBars, nextSong, playingSection, queuedSection, sectionPlan, type PlayMode, type SetlistSong } from '../../ableton/abletonSetlist';
  import { actionLabel, actionTag, actionThumb, type VisualContext } from '../../ableton/abletonVisuals';
  import AbletonCrossfader from './AbletonCrossfader.svelte';

  export let bridge: AbletonBridgeState;
  export let ctx: VisualContext;
  export let beat: number;
  export let selected: AbletonSource | null = null;
  export let onSelect: (source: AbletonSource) => void;

  const MIX_CHOICES = [0, 4, 8, 16];
  const MODES: { id: PlayMode; label: string; hint: string }[] = [
    { id: 'live', label: 'Live', hint: 'You pick every section and song' },
    { id: 'song', label: 'Song', hint: "Sections follow each song's plan; the last one loops until Next" },
    { id: 'set', label: 'Set', hint: 'The whole setlist plays itself, mixing into each next song' },
  ];
  const DRAG_TYPE = 'application/x-ghost-setlist';

  let query = '';
  let dragKey: string | null = null;
  let dropKey: string | null = null;

  $: songs = setlist(bridge);
  $: shown = query.trim() ? songs.filter(s => s.title.toLowerCase().includes(query.trim().toLowerCase())) : songs;
  $: played = new Set(bridge.played);
  $: perBar = bridge.numerator * (4 / bridge.denominator);
  $: step = quantizeBeats(bridge.quantize, bridge.numerator, bridge.denominator);
  $: current = nowPlaying(bridge, songs, $abletonCrossfader);
  $: upNext = nextSong(songs, bridge.currentSong, played);
  $: cued = songs.find(s => isCued(bridge, s)) ?? null;
  $: mixProgress = bridge.mix ? Math.max(0, Math.min(1, (beat - bridge.mix.startBeat) / Math.max(0.001, bridge.mix.beats))) : 0;

  // Helpers take the state they read, so the template re-renders with it.
  function isPlaying(state: AbletonBridgeState, song: SetlistSong): boolean {
    return playingSection(song, state.tracks) >= 0;
  }

  /** The song on air: the last one launched while it plays; otherwise
   *  (songs started before Ghost Arcade was watching) the playing song on
   *  the side the crossfader favours, or any playing song. */
  function nowPlaying(state: AbletonBridgeState, list: SetlistSong[], fader: number): SetlistSong | null {
    const playing = list.filter(s => isPlaying(state, s));
    const side = fader < 0.5 ? 'A' : 'B';
    return playing.find(s => s.key === state.currentSong)
      ?? playing.find(s => s.kind === 'clip' && s.side === side)
      ?? playing[0]
      ?? null;
  }

  /** Waiting to start: a section is queued and the song isn't playing yet. */
  function isCued(state: AbletonBridgeState, song: SetlistSong): boolean {
    return !isPlaying(state, song) && queuedSection(song, state.tracks, state.scenes) >= 0;
  }

  /** The track a section plays on, for its timing. */
  function sectionTrack(state: AbletonBridgeState, song: SetlistSong, index: number) {
    if (song.kind === 'clip') return state.tracks[song.track];
    const scene = song.sections[index]?.scene;
    return state.tracks.find(t => t.playing === scene || t.fired === scene);
  }

  function cueCountdown(state: AbletonBridgeState, song: SetlistSong, at: number): string {
    const index = queuedSection(song, state.tracks, state.scenes);
    const fired = sectionTrack(state, song, Math.max(0, index))?.firedBeat;
    const left = launchBeat(fired ?? at, step) - at;
    if (!state.playing || left <= 0) return '';
    return left >= 1 ? String(Math.ceil(left)) : '•';
  }

  function barsIn(state: AbletonBridgeState, song: SetlistSong, at: number): number {
    const track = sectionTrack(state, song, playingSection(song, state.tracks));
    return track ? Math.floor(Math.max(0, at - track.startedBeat) / perBar) + 1 : 0;
  }

  /** How far through its loop the playing section is, 0..1. */
  function loopAt(state: AbletonBridgeState, song: SetlistSong, index: number, at: number): number {
    const track = sectionTrack(state, song, index);
    if (!state.playing || !track || track.playing < 0) return 0;
    const length = track.slots[track.playing]?.length || perBar;
    return (Math.max(0, at - track.startedBeat) % length) / length;
  }

  /** How far through its planned bars the playing section is, 0..1. */
  function planAt(state: AbletonBridgeState, song: SetlistSong, index: number, at: number): number {
    const track = sectionTrack(state, song, index);
    if (!state.playing || !track) return 0;
    const bars = sectionPlan(state.songPlans, song)[index] ?? 8;
    return Math.max(0, Math.min(1, (at - track.startedBeat) / (bars * perBar)));
  }

  /** What autoplay does next and when, in words. */
  function autoStatus(state: AbletonBridgeState, song: SetlistSong, at: number): string {
    if (state.playMode === 'live') return '';
    const index = playingSection(song, state.tracks);
    const track = sectionTrack(state, song, index);
    if (index < 0 || !track) return '';
    const label = song.sections[index]?.label ?? 'This section';
    if (state.hold) return `Holding ${label}. Release Hold to carry on`;
    const upcoming = nextSong(setlist(state), song.key, new Set(state.played));
    const mixBars = state.deckMode && upcoming?.kind === 'clip' && song.kind === 'clip' && upcoming.track !== song.track ? state.autoMixBars : 0;
    const [event] = autoEvents({
      mode: state.playMode, hold: false, plan: sectionPlan(state.songPlans, song), index,
      startedBeat: track.startedBeat, perBar, hasNext: !!upcoming, mixBars,
    });
    if (!event) return `${song.sections.length > 1 ? label : song.title} loops until you press Next`;
    const bars = Math.ceil((event.at - at) / perBar);
    const when = bars <= 0 ? 'now' : `in ${bars} bar${bars === 1 ? '' : 's'}`;
    if (event.kind === 'section') return `${song.sections[event.index].label} ${when}`;
    if (event.kind === 'next') return `${upcoming?.title} ${mixBars ? 'mixes in' : 'starts'} ${when}`;
    return `Set ends ${when}`;
  }

  /** A song's planned length in bars. */
  function songBars(state: AbletonBridgeState, song: SetlistSong): number {
    return sectionPlan(state.songPlans, song).reduce((sum, bars) => sum + bars, 0);
  }

  function cycleBars(event: MouseEvent, song: SetlistSong, index: number, step: number) {
    event.preventDefault();
    event.stopPropagation();
    abletonBridge.setSectionBars(song, index, nextPlanBars(sectionPlan(bridge.songPlans, song)[index], step));
  }

  function sectionLabel(state: AbletonBridgeState, song: SetlistSong): string {
    const index = playingSection(song, state.tracks);
    return index >= 0 && song.sections.length > 1 ? song.sections[index].label : '';
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
    return song.kind === 'clip' ? (song.side ?? '–') : '';
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

  /** Drop below the last row: move the song to the end of the set. */
  function onDropEnd(event: DragEvent) {
    event.preventDefault();
    const key = event.dataTransfer?.getData(DRAG_TYPE) || dragKey;
    dragKey = dropKey = null;
    if (!key) return;
    abletonBridge.setSetlistOrder([...songs.map(s => s.key).filter(k => k !== key), key]);
  }

  function play(song: SetlistSong) {
    abletonBridge.playSong(song);
    onSelect(songSource(bridge, song));
  }
</script>

<div class="setlist">
  <div class="deck-strip">
    <div class="now">
      <div class="now-head">
        <span class="label">Now playing</span>
        <div class="modes" role="radiogroup" aria-label="Play mode">
          {#each MODES as mode (mode.id)}
            <button role="radio" aria-checked={bridge.playMode === mode.id} class:active={bridge.playMode === mode.id} onclick={() => abletonBridge.setPlayMode(mode.id)} title={mode.hint}>{mode.label}</button>
          {/each}
        </div>
        {#if bridge.playMode !== 'live'}
          <button class="hold" class:on={bridge.hold} aria-pressed={bridge.hold} onclick={() => abletonBridge.setHold(!bridge.hold)} title="Keep the section playing now looping; autoplay waits">Hold</button>
        {/if}
      </div>
      {#if current}
        <span class="title" style="--live: {liveColor(current.color)}">{current.title}</span>
        <span class="meta">
          {#if current.kind === 'clip' && current.side}<b>Deck {current.side}</b>{/if}
          {#if current.bpm}{current.bpm} BPM{/if}
          · {sectionLabel(bridge, current) ? `${sectionLabel(bridge, current)} · ` : ''}bar {barsIn(bridge, current, beat)}
        </span>
        {#if current.sections.length > 1}
          {@const on = playingSection(current, bridge.tracks)}
          {@const waiting = queuedSection(current, bridge.tracks, bridge.scenes)}
          <div class="pads" role="group" aria-label="Sections of {current.title}">
            {#each current.sections as section, i (i)}
              {@const plan = sectionPlan(bridge.songPlans, current)}
              <div class="pad-cell">
                <button
                  class="pad"
                  class:on={on === i}
                  class:waiting={waiting === i}
                  class:next={on >= 0 && waiting < 0 && i === on + 1}
                  onclick={() => current && abletonBridge.playSection(current, i)}
                  title={on === i ? `${section.label} is playing` : `Go to ${section.label}, landing on Live's launch quantization`}
                >
                  <span class="pad-label">{section.label}</span>
                  {#if waiting === i && cueCountdown(bridge, current, beat)}<span class="pad-count">{cueCountdown(bridge, current, beat)}</span>{/if}
                  {#if on === i}<span class="pad-loop" style="transform: scaleX({bridge.playMode === 'live' ? loopAt(bridge, current, i, beat) : planAt(bridge, current, i, beat)})"></span>{/if}
                </button>
                <button
                  class="pad-bars"
                  class:dim={bridge.playMode === 'live'}
                  onclick={(e) => current && cycleBars(e, current, i, 1)}
                  oncontextmenu={(e) => current && cycleBars(e, current, i, -1)}
                  title="Autoplay gives {section.label} {plan[i]} bars. Click for longer, right-click for shorter"
                >{plan[i]} bars</button>
              </div>
            {/each}
          </div>
        {:else if bridge.playMode !== 'live'}
          {@const plan = sectionPlan(bridge.songPlans, current)}
          <div class="pads">
            <button class="pad-bars solo" onclick={(e) => current && cycleBars(e, current, 0, 1)} oncontextmenu={(e) => current && cycleBars(e, current, 0, -1)} title="How long autoplay plays this song. Click for longer, right-click for shorter">Plays {plan[0]} bars</button>
          </div>
        {/if}
        {#if autoStatus(bridge, current, beat)}
          <span class="auto-status" class:held={bridge.hold}>{autoStatus(bridge, current, beat)}</span>
        {/if}
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
      <button class="next-btn" disabled={!upNext} onclick={() => abletonBridge.playNext()} title="Play the next unplayed song in your order">{bridge.playMode === 'set' && !current ? 'Start set ▶' : 'Next ▶'}</button>
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
      {/if}
      <AbletonCrossfader compact value={$abletonCrossfader} linked={bridge.deckMode} onChange={(v) => abletonBridge.setCrossfader(v)} onToggleLink={(on) => abletonBridge.setDeckMode(on)} />
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
        ondragend={() => (dragKey = dropKey = null)}
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
          {#if song.sections.length > 1}
            {@const on = playingSection(song, bridge.tracks)}
            {@const waiting = queuedSection(song, bridge.tracks, bridge.scenes)}
            <span class="sections">
              {#each song.sections as section, i (i)}
                <button
                  class="section"
                  class:on={on === i}
                  class:waiting={waiting === i}
                  onclick={(e) => { e.stopPropagation(); abletonBridge.playSection(song, i); }}
                  title="Play {section.label}"
                >{section.label}</button>
              {/each}
            </span>
          {/if}
        </span>
        <span class="status">
          {#if playing}<b class="on">{bridge.currentSong === song.key ? 'NOW' : 'PLAYING'}</b> <small>bar {barsIn(bridge, song, beat)}</small>
          {:else if queued}<span class="countdown">{cueCountdown(bridge, song, beat) || '•'}</span>
          {:else if played.has(song.key)}<small>played</small>
          {:else if bridge.playMode !== 'live'}<small>{songBars(bridge, song)} bars</small>{/if}
        </span>
        <span class="bpm">{song.bpm ?? '—'}</span>
        <span class="deck" class:a={song.kind === 'clip' && song.side === 'A'} class:b={song.kind === 'clip' && song.side === 'B'}>{deckLabel(song)}</span>
        <span class="visual" title={links[0] ? actionLabel(ctx, links[0].action) : 'No visual linked — pick one on the right'}>
          <span class="vis">{#if thumb}<img src={thumb} alt="" />{:else if links[0]}<i>{actionTag(links[0].action)}</i>{:else}<i class="none">+</i>{/if}</span>
          <span class="vis-label">{links[0] ? actionLabel(ctx, links[0].action) : 'No visual'}{links.length > 1 ? ` +${links.length - 1}` : ''}</span>
        </span>
      </div>
    {/each}
    {#if dragKey}
      <div
        class="end-drop"
        class:drop={dropKey === '__end'}
        role="presentation"
        ondragover={(e) => { if (e.dataTransfer?.types.includes(DRAG_TYPE)) { e.preventDefault(); dropKey = '__end'; } }}
        ondragleave={() => (dropKey = null)}
        ondrop={onDropEnd}
      >Drop here to play last</div>
    {/if}
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
  .mixer { justify-content: center; width: 250px; }
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
  .end-drop { height: 30px; display: flex; align-items: center; justify-content: center; border: 1px dashed rgba(255, 255, 255, 0.15); border-radius: 3px; color: var(--ga-ink-2, #8a909b); font-size: 11px; }
  .end-drop.drop { border-color: #c9c4ff; color: #c9c4ff; }
  @keyframes queued { 50% { box-shadow: inset 0 0 0 1px #e0a33a; } }
  .num { color: var(--ga-ink-2, #8a909b); font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 11px; text-align: right; }
  .play { width: 24px; height: 24px; display: flex; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.15); background: transparent; color: var(--ga-ink-1, #b8bdc6); cursor: pointer; padding: 0; }
  .play:hover, .row.playing .play { color: #07090d; background: var(--ga-live, #46d18a); border-color: transparent; }
  .name { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .song-title { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sections { display: flex; gap: 3px; flex-wrap: nowrap; overflow: hidden; }
  .section { height: 20px; padding: 0 7px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.12); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; font-size: 10px; cursor: pointer; white-space: nowrap; }
  .section:hover { border-color: var(--live); color: var(--ga-ink-0, #eef0f4); }
  .section.on { background: var(--ga-live, #46d18a); border-color: transparent; color: #07090d; font-weight: 600; }
  .section.waiting { animation: waiting 0.5s steps(2) infinite; }
  @keyframes waiting { 50% { border-color: #e0a33a; color: #e0a33a; } }
  .pads { display: flex; gap: 4px; margin-top: 6px; flex-wrap: wrap; }
  .now-head { display: flex; align-items: center; gap: 8px; }
  .now-head .label { flex: 1; }
  .modes { display: flex; border: 1px solid rgba(255, 255, 255, 0.14); border-radius: 3px; overflow: hidden; }
  .modes button { padding: 3px 10px; background: transparent; border: none; color: var(--ga-ink-2, #8a909b); font: inherit; font-size: 11px; font-weight: 600; cursor: pointer; }
  .modes button + button { border-left: 1px solid rgba(255, 255, 255, 0.08); }
  .modes button.active { background: var(--ga-ink-0, #eef0f4); color: #07090d; }
  .hold { padding: 3px 10px; border-radius: 3px; border: 1px solid rgba(224, 163, 58, 0.5); background: transparent; color: #e0a33a; font: inherit; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; cursor: pointer; }
  .hold.on { background: #e0a33a; color: #1a1204; }
  .pad-cell { display: flex; flex-direction: column; gap: 2px; }
  .pad-bars { height: 16px; padding: 0 6px; border: none; border-radius: 2px; background: transparent; color: var(--ga-ink-2, #8a909b); font: inherit; font-size: 10px; font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); cursor: pointer; }
  .pad-bars:hover { color: var(--ga-ink-0, #eef0f4); background: rgba(255, 255, 255, 0.06); }
  .pad-bars.dim { opacity: 0.55; }
  .pad-bars.solo { height: 24px; padding: 0 10px; border: 1px solid rgba(255, 255, 255, 0.14); font-size: 11px; }
  .auto-status { margin-top: 6px; font-size: 11px; color: #c9c4ff; }
  .auto-status::before { content: '▸ '; }
  .auto-status.held { color: #e0a33a; }
  .pad {
    position: relative;
    overflow: hidden;
    min-width: 74px;
    height: 34px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.04);
    color: var(--ga-ink-1, #b8bdc6);
    font: inherit;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
  }
  .pad:hover { border-color: rgba(255, 255, 255, 0.35); color: var(--ga-ink-0, #eef0f4); }
  .pad.next { border-color: color-mix(in srgb, var(--ga-live, #46d18a) 45%, transparent); }
  .pad.on { background: color-mix(in srgb, var(--ga-live, #46d18a) 22%, #0c0f14); border-color: var(--ga-live, #46d18a); color: var(--ga-ink-0, #eef0f4); }
  .pad.waiting { animation: pad-waiting 0.5s steps(2) infinite; }
  @keyframes pad-waiting { 50% { border-color: #e0a33a; background: rgba(224, 163, 58, 0.18); } }
  .pad-loop { position: absolute; left: 0; right: 0; bottom: 0; height: 3px; background: var(--ga-live, #46d18a); transform-origin: left center; }
  .pad-count { min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px; background: #e0a33a; color: #1a1204; font-size: 10px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); }
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
