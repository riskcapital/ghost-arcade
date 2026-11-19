<script lang="ts">
  /**
   * The session grid while Live is in control: Live's scenes and clips, fired
   * in Live, which plays the audio. Each track's header says which sound it
   * feeds the visual voices as; MIDI tracks send their notes, audio tracks
   * their level.
   */
  import { abletonBridge } from '../../ableton/abletonBridge';
  import { liveColor } from '../../ableton/abletonLinks';
  import { musicStudio } from '../../music/musicStudioStore';
  import { guessRole } from '../../music/liveControl';
  import { studioSceneForLive } from '../../music/scenes';
  import { livePlatform, liveSetupWords } from '../../ableton/liveSetup';
  import { PART_SOURCES, liveSource, type VoiceSourceId } from '../../music/visualVoices';
  import { liveStackKey } from '../../music/clipStack';
  import { liveTrackKeys } from '../../music/liveControl';
  import { stackEditor } from '../../music/studioUi';

  const s = $derived($musicStudio);
  const live = $derived($abletonBridge);
  const trackKeys = $derived(liveTrackKeys(live.tracks));
  /** A Live clip's visuals are kept by its track and name (or slot). */
  const stackKey = (t: number, row: number) => liveStackKey(trackKeys[t], row, live.tracks[t].slots.map((c) => c?.name));
  const layersOf = (t: number, row: number) => s.liveStacks[stackKey(t, row)]?.items.length ?? 0;
  function openVisuals(t: number, row: number) {
    const track = live.tracks[t];
    stackEditor.set({ kind: 'live', key: stackKey(t, row), title: `${track.name || `Track ${t + 1}`} · ${track.slots[row]?.name || `Clip ${row + 1}`}`, follow: liveSource(trackKeys[t]) });
  }
  const words = $derived(liveSetupWords(livePlatform(), live.script?.liveVersions));
  const rows = $derived(Math.max(live.scenes.length, ...live.tracks.map((t) => t.slots.length), 0));

  const liveNames = $derived(live.scenes.map((sc) => sc.name));
  /** The studio scene this Live scene brings (its visuals and sound), if any. */
  function studioSceneName(row: number): string | null {
    const id = studioSceneForLive(s.scenes, row, liveNames);
    return id ? (s.scenes.find((sc) => sc.id === id)?.name ?? null) : null;
  }

  function setRole(track: string, value: string) {
    musicStudio.setLiveRole(track, value ? (value as VoiceSourceId) : null);
  }

  /** Give every unmapped track the sound its name suggests. */
  function guessAll() {
    for (const t of live.tracks) {
      if (s.liveRoles[t.name]) continue;
      const role = guessRole(t.name);
      if (role) musicStudio.setLiveRole(t.name, role);
    }
  }
</script>

{#if !live.connected}
  <div class="waiting">
    <p class="title">Waiting for Live</p>
    <p>
      {#if !live.listening}
        Starting the connection…
      {:else}
        Open a set in Live with <span translate="no">GhostArcade</span> chosen as a Control Surface, in <span translate="no">{words.menu.join(' › ')}</span>, {words.tab} tab. If it isn't listed, install it from the Ableton button in the deck dock, then restart Live.
      {/if}
    </p>
    {#if live.error}<p class="error">{live.error}</p>{/if}
  </div>
{:else}
  <div class="live">
    <div class="live-transport">
      <button class="btn" class:on={live.playing} onclick={() => (live.playing ? abletonBridge.stop() : abletonBridge.play())} title={live.playing ? "Stop Live's transport" : "Start Live's transport"}>
        {#if live.playing}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" /></svg> Stop
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg> Play
        {/if}
      </button>
      <button class="btn" onclick={() => abletonBridge.stopAllClips()} title="Stop every clip in Live">Stop clips</button>
      <span class="readout">{Math.round(live.tempo * 10) / 10} BPM · {live.numerator}/{live.denominator}</span>
      <span class="spacer"></span>
      <button class="btn" onclick={guessAll} title="Give tracks without a sound the one their name suggests (Kick, Bass, Pads…)">Match by name</button>
    </div>
    <div class="grid" style="grid-template-columns: 132px repeat({live.tracks.length}, minmax(110px, 1fr));">
      <span class="corner ga-eyebrow">Scenes</span>
      {#each live.tracks as track, t (t)}
        <div class="head" style="--clip: {liveColor(track.color)}">
          <div class="head-top">
            <span class="track-name" title={track.name}>{track.name || `Track ${t + 1}`}</span>
            <button class="stop" onclick={() => abletonBridge.stopTrack(t)} aria-label="Stop {track.name}" title="Stop this track">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" /></svg>
            </button>
          </div>
          <select aria-label="{track.name}: also plays as an Audio Lab sound" value={s.liveRoles[track.name] ?? ''} onchange={(e) => setRole(track.name, (e.target as HTMLSelectElement).value)} title="Visuals can follow this track itself (Visuals panel); it can also play as one of Audio Lab's sounds, for visuals already following that sound">
            <option value="">Its own visuals</option>
            {#each PART_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
          </select>
        </div>
      {/each}
      {#each Array.from({ length: rows }, (_, i) => i) as row (row)}
        {@const scene = live.scenes[row]}
        {@const studioScene = scene ? studioSceneName(row) : null}
        <button class="scene" class:queued={scene?.queued} disabled={!scene} onclick={() => abletonBridge.launchScene(row)} title={scene ? `Launch ${scene.name || `scene ${row + 1}`} in Live${studioScene ? `; brings Audio Lab scene ${studioScene}` : ''}` : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          <span>{scene?.name || `Scene ${row + 1}`}</span>
          {#if studioScene}<span class="linked" aria-label="Brings Audio Lab scene {studioScene}">◆</span>{/if}
        </button>
        {#each live.tracks as track, t (t)}
          {@const clip = track.slots[row]}
          {#if clip}
            {@const layers = layersOf(t, row)}
            <div class="cell">
              <button
                class="clip"
                class:playing={track.playing === row}
                class:queued={track.fired === row}
                style="--clip: {liveColor(clip.color)}"
                onclick={() => abletonBridge.launchClip(t, row)}
                ondblclick={() => openVisuals(t, row)}
                title="Launch {clip.name || 'clip'} in Live · double-click for its visuals"
              >
                <span class="clip-state" aria-hidden="true"></span>
                <span class="clip-name">{clip.name || 'Clip'}</span>
              </button>
              <button class="visuals" class:has={layers > 0} onclick={() => openVisuals(t, row)} aria-label="Visuals for {clip.name || 'clip'}" title={!layers ? 'Give it visuals' : layers === 1 ? 'Its visuals: 1 layer' : `Its visuals: ${layers} layers`}>
                <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="2.5" width="9" height="7" rx="1" /><path d="M1.5 7.5l3-2.5 2.5 2 1.5-1 2 1.5" /></svg>
              </button>
            </div>
          {:else}
            <span class="empty"></span>
          {/if}
        {/each}
      {/each}
    </div>
  </div>
{/if}

<style>
  .scene .linked { margin-left: auto; font-size: 8px; color: var(--studio-accent); }
  .waiting { padding: 18px 4px; color: var(--studio-muted); font-size: var(--ga-text-control, 12px); line-height: 1.5; max-width: 520px; }
  .waiting p { margin: 0 0 6px; }
  .waiting .title { color: var(--studio-ink); font-weight: var(--ga-weight-title, 650); font-size: var(--ga-text-body, 13px); }
  .error { color: var(--ga-rec, #e5483a); }
  .live { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
  .live-transport { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .spacer { flex: 1; }
  .readout { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); font-variant-numeric: tabular-nums; margin-left: 6px; }
  .btn {
    height: var(--ga-control-h, 26px);
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .btn:hover { border-color: var(--studio-muted); }
  .btn.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .btn svg, .scene svg, .stop svg { width: 10px; height: 10px; fill: currentColor; flex: 0 0 auto; }
  .grid { flex: 1; min-height: 0; overflow: auto; display: grid; gap: 3px; align-content: start; }
  .corner { align-self: end; padding: 0 0 4px 2px; }
  .head {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 5px 6px;
    background: var(--studio-cell);
    border-top: 2px solid var(--clip);
    border-radius: var(--studio-radius);
    min-width: 0;
  }
  .head-top { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .track-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-control, 600); }
  .stop { width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: var(--studio-muted); cursor: pointer; display: grid; place-items: center; }
  .stop:hover { color: var(--studio-ink); }
  .head select {
    width: 100%;
    height: 22px;
    background: var(--studio-slot);
    color: var(--studio-ink);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
  }
  .scene, .clip {
    height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
    min-width: 0;
    text-align: left;
  }
  .scene:disabled { opacity: 0.35; cursor: default; }
  .scene span, .clip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scene.queued { border-color: var(--studio-accent); }
  .clip { border-left: 3px solid var(--clip); }
  .clip-state { width: 6px; height: 6px; border-radius: 50%; background: var(--studio-edge); flex: 0 0 auto; }
  .clip.playing { background: color-mix(in srgb, var(--clip) 22%, var(--studio-cell)); }
  .clip.playing .clip-state { background: var(--studio-accent); box-shadow: 0 0 6px var(--studio-accent); }
  .clip.queued .clip-state { background: var(--studio-accent); animation: blink 0.5s steps(2) infinite; }
  .cell { position: relative; display: flex; gap: 2px; min-width: 0; }
  .cell .clip { flex: 1; }
  .visuals { flex: 0 0 20px; display: none; place-items: center; padding: 0; border: 1px solid var(--studio-edge-soft); background: transparent; color: var(--studio-muted); border-radius: var(--studio-radius); cursor: pointer; }
  .visuals svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
  .cell:hover .visuals, .visuals:focus-visible, .visuals.has { display: inline-grid; }
  .visuals.has { color: var(--ga-icon, #5278ff); border-color: color-mix(in srgb, var(--ga-icon, #5278ff) 45%, var(--studio-edge-soft)); }
  .empty { height: 28px; border: 1px dashed var(--studio-edge-soft); border-radius: var(--studio-radius); opacity: 0.5; }
  @keyframes blink { 50% { opacity: 0.2; } }
</style>
