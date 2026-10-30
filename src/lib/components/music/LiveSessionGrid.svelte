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
  import { livePlatform, liveSetupWords } from '../../ableton/liveSetup';
  import { VOICE_SOURCES, type VoiceSourceId } from '../../music/visualVoices';

  const s = $derived($musicStudio);
  const live = $derived($abletonBridge);
  const words = $derived(liveSetupWords(livePlatform(), live.script?.liveVersions));
  const rows = $derived(Math.max(live.scenes.length, ...live.tracks.map((t) => t.slots.length), 0));

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
    <div class="transport">
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
      <span class="corner">SCENES</span>
      {#each live.tracks as track, t (t)}
        <div class="head" style="--clip: {liveColor(track.color)}">
          <div class="head-top">
            <span class="track-name" title={track.name}>{track.name || `Track ${t + 1}`}</span>
            <button class="stop" onclick={() => abletonBridge.stopTrack(t)} aria-label="Stop {track.name}" title="Stop this track">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="7" width="10" height="10" /></svg>
            </button>
          </div>
          <select aria-label="What {track.name} feeds the visuals as" value={s.liveRoles[track.name] ?? ''} onchange={(e) => setRole(track.name, (e.target as HTMLSelectElement).value)} title={track.midi ? 'Its notes drive the visuals following this sound' : 'Its level drives the visuals following this sound'}>
            <option value="">No visuals</option>
            {#each VOICE_SOURCES as v (v.id)}<option value={v.id}>{v.label}</option>{/each}
          </select>
        </div>
      {/each}
      {#each Array.from({ length: rows }, (_, i) => i) as row (row)}
        {@const scene = live.scenes[row]}
        <button class="scene" class:queued={scene?.queued} disabled={!scene} onclick={() => abletonBridge.launchScene(row)} title={scene ? `Launch ${scene.name || `scene ${row + 1}`} in Live` : ''}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5l12 7-12 7z" /></svg>
          <span>{scene?.name || `Scene ${row + 1}`}</span>
        </button>
        {#each live.tracks as track, t (t)}
          {@const clip = track.slots[row]}
          {#if clip}
            <button
              class="clip"
              class:playing={track.playing === row}
              class:queued={track.fired === row}
              style="--clip: {liveColor(clip.color)}"
              onclick={() => abletonBridge.launchClip(t, row)}
              title="Launch {clip.name || 'clip'} in Live"
            >
              <span class="clip-state" aria-hidden="true"></span>
              <span class="clip-name">{clip.name || 'Clip'}</span>
            </button>
          {:else}
            <span class="empty"></span>
          {/if}
        {/each}
      {/each}
    </div>
  </div>
{/if}

<style>
  .waiting { padding: 18px 4px; color: var(--studio-muted); font-size: 12px; max-width: 520px; }
  .waiting p { margin: 0 0 6px; }
  .waiting .title { color: var(--studio-ink); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 11px; }
  .error { color: #e5483a; }
  .live { display: flex; flex-direction: column; gap: 8px; height: 100%; min-height: 0; }
  .transport { display: flex; align-items: center; gap: 6px; }
  .spacer { flex: 1; }
  .readout { font-size: 11px; color: var(--studio-muted); font-variant-numeric: tabular-nums; margin-left: 6px; }
  .btn {
    height: 24px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .btn.on { border-color: var(--studio-accent); color: var(--studio-accent); }
  .btn svg, .scene svg, .stop svg { width: 10px; height: 10px; fill: currentColor; flex: 0 0 auto; }
  .grid { flex: 1; min-height: 0; overflow: auto; display: grid; gap: 3px; align-content: start; }
  .corner { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: var(--studio-muted); align-self: end; padding: 0 0 4px 2px; }
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
  .track-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; font-weight: 600; }
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
    font-size: 10px;
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
  .empty { height: 28px; border: 1px dashed var(--studio-edge-soft); border-radius: var(--studio-radius); opacity: 0.5; }
  @keyframes blink { 50% { opacity: 0.2; } }
</style>
