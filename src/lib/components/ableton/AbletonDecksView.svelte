<script lang="ts">
  /**
   * Decks — Live set up as two DJ decks (tracks on the A and B sides of its
   * crossfader). With decks linked, each Live deck plays the matching Ghost
   * Arcade deck and Live's crossfader moves Ghost Arcade's, so mixing songs
   * mixes the visuals.
   */
  import { abletonBridge, abletonCrossfader, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { launchBeat, linksForClip, liveColor, quantizeBeats, samePlace, type AbletonSource } from '../../ableton/abletonLinks';
  import { deriveSongs, playingSection, queuedSection, type SetlistSong } from '../../ableton/abletonSetlist';
  import { actionLabel, actionTag, actionThumb, type VisualContext } from '../../ableton/abletonVisuals';
  import AbletonCrossfader from './AbletonCrossfader.svelte';

  export let bridge: AbletonBridgeState;
  export let ctx: VisualContext;
  export let beat: number;
  export let selected: AbletonSource | null = null;
  export let onSelect: (source: AbletonSource) => void;

  const SIDES = ['A', 'B'] as const;

  $: step = quantizeBeats(bridge.quantize, bridge.numerator, bridge.denominator);
  $: unassigned = bridge.tracks.map((t, i) => ({ t, i })).filter(x => !x.t.side && x.t.slots.some(Boolean));
  $: onAir = $abletonCrossfader < 0.45 ? 'A' : $abletonCrossfader > 0.55 ? 'B' : 'AB';
  $: songs = deriveSongs(bridge.scenes, bridge.tracks);

  // Helpers take the state they read, so the template re-renders with it.
  function decks(state: AbletonBridgeState, side: 'A' | 'B') {
    return state.tracks.map((t, i) => ({ t, i })).filter(x => x.t.side === side);
  }

  /** A track's songs: its clips, grouped into sections where named so. */
  function songsOn(all: SetlistSong[], track: number) {
    return all.filter((song): song is Extract<SetlistSong, { kind: 'clip' }> => song.kind === 'clip' && song.track === track);
  }

  function progress(state: AbletonBridgeState, track: number, at: number): number {
    const t = state.tracks[track];
    if (!state.playing || !t || t.playing < 0) return 0;
    const length = t.slots[t.playing]?.length || 4;
    return (Math.max(0, at - t.startedBeat) % length) / length;
  }

  function countdown(state: AbletonBridgeState, track: number, at: number): string {
    const t = state.tracks[track];
    const left = launchBeat(t.firedBeat, step) - at;
    if (!state.playing || left <= 0) return '';
    return left >= 1 ? String(Math.ceil(left)) : '•';
  }

  function source(state: AbletonBridgeState, track: number, slot: number): AbletonSource {
    const t = state.tracks[track];
    return { kind: 'clip', track, slot, trackName: t.name, name: t.slots[slot]?.name ?? '' };
  }
</script>

<div class="decks">
  <div class="toolbar">
    <label class="switch" title="Live's decks play Ghost Arcade's decks; Live's crossfader moves Ghost Arcade's">
      <input type="checkbox" checked={bridge.deckMode} onchange={(e) => abletonBridge.setDeckMode((e.target as HTMLInputElement).checked)} />
      <span class="track"><span class="knob"></span></span>
      Link decks
    </label>
    <button class="ghost" onclick={() => abletonBridge.linkDecks()} title="Song N on a Live deck plays column N on the matching Ghost Arcade deck">Songs → columns</button>
    <span class="hint">Mix songs in Live and the visuals mix with them — same bar, same crossfader.</span>
  </div>

  {#if !decks(bridge, 'A').length && !decks(bridge, 'B').length}
    <div class="intro">
      <b>Set Live up as two decks.</b>
      <p>Put songs as clips on two tracks and assign them to the A and B sides of Live's crossfader (the A | B buttons in the mixer), or assign them here. Cue the next song on the idle deck; it lands on the bar, and you blend with the crossfader.</p>
    </div>
  {/if}

  <div class="layout">
    {#each SIDES as side, sideIndex (side)}
      {#if sideIndex === 1}
        <div class="fader">
          <AbletonCrossfader value={$abletonCrossfader} linked={bridge.deckMode} onChange={(v) => abletonBridge.setCrossfader(v)} />
          {#if !bridge.deckMode}<small>Turn on Link decks to mix the visuals too</small>{/if}
        </div>
      {/if}
      <section class="deck" class:on-air={onAir === side || onAir === 'AB'}>
        <header>
          <span class="name">DECK {side}</span>
          <span class="tracks">{decks(bridge, side).map(d => d.t.name).join(', ') || 'No track'}</span>
        </header>
        {#each decks(bridge, side) as { t, i } (i)}
          {#each songsOn(songs, i) as song (song.key)}
            {@const links = linksForClip(bridge.links, i, song.slot)}
            {@const thumb = links[0] ? actionThumb(ctx, links[0].action) : undefined}
            {@const on = playingSection(song, bridge.tracks)}
            {@const waiting = queuedSection(song, bridge.tracks, bridge.scenes)}
            {@const src = source(bridge, i, song.slot)}
            <div
              class="song"
              class:playing={on >= 0}
              class:queued={on < 0 && waiting >= 0}
              class:selected={selected && samePlace(src, selected)}
              style="--live: {liveColor(song.color)}"
              role="button"
              tabindex="0"
              onclick={() => onSelect(src)}
              onkeydown={(e) => e.key === 'Enter' && onSelect(src)}
            >
              <div class="song-line">
                <button class="launch" onclick={(e) => { e.stopPropagation(); abletonBridge.launchClip(i, song.slot); }} title="Cue in Live — lands on the bar" aria-label="Cue {song.title}">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                </button>
                <span class="title">{song.title}{#if song.bpm}<small>{song.bpm}</small>{/if}</span>
                {#if waiting >= 0 && countdown(bridge, i, beat)}<span class="countdown">{countdown(bridge, i, beat)}</span>{/if}
                {#if on >= 0}<span class="badge">{onAir === side || onAir === 'AB' ? 'ON AIR' : 'PLAYING'}</span>{/if}
                <span class="vis" title={links[0] ? actionLabel(ctx, links[0].action) : 'No visual linked'}>
                  {#if thumb}<img src={thumb} alt="" />{:else if links[0]}<i>{actionTag(links[0].action)}</i>{:else}<i class="none">—</i>{/if}
                </span>
              </div>
              {#if song.sections.length > 1}
                <div class="sections">
                  {#each song.sections as section, n (n)}
                    <button
                      class="section"
                      class:on={on === n}
                      class:waiting={waiting === n}
                      onclick={(e) => { e.stopPropagation(); abletonBridge.playSection(song, n); }}
                      title="Play {section.label}; it loops until the next"
                    >{section.label}</button>
                  {/each}
                </div>
              {/if}
              {#if on >= 0}<span class="playhead" style="transform: scaleX({progress(bridge, i, beat)})"></span>{/if}
            </div>
          {/each}
          <button class="stop" onclick={() => abletonBridge.stopTrack(i)}>Stop {t.name}</button>
        {/each}
        {#if unassigned.length}
          <div class="assign">
            {#each unassigned as { t, i } (i)}
              <button class="ghost small" onclick={() => abletonBridge.assignTrack(i, side)}>Make {t.name} deck {side}</button>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
</div>

<style>
  .decks { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .hint { color: var(--ga-ink-2, #8a909b); }
  .switch { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; }
  .switch input { position: absolute; opacity: 0; pointer-events: none; }
  .switch .track { width: 30px; height: 16px; border-radius: 8px; background: rgba(255, 255, 255, 0.15); position: relative; transition: background 0.15s; }
  .switch .knob { position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  .switch input:checked + .track { background: var(--ga-live, #46d18a); }
  .switch input:checked + .track .knob { transform: translateX(14px); }
  .ghost { height: 26px; padding: 0 10px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.14); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; cursor: pointer; white-space: nowrap; }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.3); }
  .ghost.small { height: 22px; font-size: 11px; }
  .intro { padding: 10px 12px; border: 1px solid rgba(127, 119, 221, 0.35); background: rgba(127, 119, 221, 0.08); border-radius: 4px; }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .layout { display: grid; grid-template-columns: minmax(0, 1fr) 260px minmax(0, 1fr); gap: 12px; align-items: start; }
  .deck { border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 8px; display: flex; flex-direction: column; gap: 4px; transition: border-color 0.2s; }
  .deck.on-air { border-color: color-mix(in srgb, var(--ga-live, #46d18a) 55%, transparent); }
  .deck header { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .deck .name { font-weight: 700; letter-spacing: 0.14em; font-size: 12px; }
  .deck.on-air .name { color: var(--ga-live, #46d18a); }
  .deck .tracks { color: var(--ga-ink-2, #8a909b); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .song {
    position: relative;
    display: flex; flex-direction: column; gap: 4px;
    min-height: 34px;
    padding: 3px 6px 3px 4px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-left: 3px solid var(--live);
    background: color-mix(in srgb, var(--live) 12%, #0c0f14);
    cursor: pointer;
    overflow: hidden;
    outline: none;
  }
  .song:hover { background: color-mix(in srgb, var(--live) 22%, #0c0f14); }
  .song.selected { box-shadow: inset 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  .song.playing { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-live, #46d18a) 80%, transparent); }
  .song.queued { animation: queued 0.5s steps(2) infinite; }
  @keyframes queued { 50% { box-shadow: inset 0 0 0 1px #e0a33a; } }
  .launch { width: 20px; height: 20px; flex: 0 0 auto; display: flex; align-items: center; justify-content: center; padding: 0; border: none; background: transparent; color: var(--ga-ink-2, #8a909b); cursor: pointer; }
  .launch:hover, .song.playing .launch { color: var(--ga-live, #46d18a); }
  .song-line { display: flex; align-items: center; gap: 8px; min-height: 26px; }
  .title { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-weight: 500; }
  .title small { margin-left: 6px; font-weight: 400; font-size: 10px; color: var(--ga-ink-2, #8a909b); font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); }
  .sections { display: flex; gap: 3px; flex-wrap: wrap; padding: 0 0 3px 28px; }
  .section { height: 20px; padding: 0 8px; border-radius: 10px; border: 1px solid rgba(255, 255, 255, 0.14); background: rgba(0, 0, 0, 0.25); color: var(--ga-ink-1, #b8bdc6); font: inherit; font-size: 10px; cursor: pointer; white-space: nowrap; }
  .section:hover { border-color: var(--live); color: var(--ga-ink-0, #eef0f4); }
  .section.on { background: var(--ga-live, #46d18a); border-color: transparent; color: #07090d; font-weight: 600; }
  .section.waiting { animation: waiting 0.5s steps(2) infinite; }
  @keyframes waiting { 50% { border-color: #e0a33a; color: #e0a33a; } }
  .countdown { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: #e0a33a; color: #1a1204; font-size: 10px; font-weight: 700; display: flex; align-items: center; justify-content: center; font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); }
  .badge { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; color: var(--ga-live, #46d18a); }
  .vis { width: 44px; height: 25px; border-radius: 2px; overflow: hidden; background: #000; border: 1px solid rgba(201, 196, 255, 0.4); display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .vis img { width: 100%; height: 100%; object-fit: cover; }
  .vis i { font-style: normal; font-size: 9px; font-weight: 700; color: #c9c4ff; }
  .vis i.none { color: var(--ga-ink-3, #555a63); }
  .playhead { position: absolute; left: 0; right: 0; bottom: 0; height: 2px; background: var(--ga-live, #46d18a); transform-origin: left center; }
  .stop { align-self: flex-start; margin-top: 4px; height: 22px; padding: 0 8px; border-radius: 3px; border: 1px solid rgba(255, 255, 255, 0.1); background: transparent; color: var(--ga-ink-2, #8a909b); font: inherit; font-size: 11px; cursor: pointer; }
  .assign { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .fader { position: sticky; top: 0; display: flex; flex-direction: column; align-items: center; gap: 6px; padding-top: 30px; }
  .fader small { color: var(--ga-ink-2, #8a909b); font-size: 10px; text-align: center; }
</style>
