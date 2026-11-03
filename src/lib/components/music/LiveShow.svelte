<script lang="ts">
  /**
   * The Scenes tab while the studio plays with Ableton Live: the show in the
   * Live set, as songs and their sections. A section launches its Live scene
   * (on Live's own quantize) and brings the studio look kept on it: its
   * visuals and sound. "Keep look" keeps what the studio shows now on a
   * section. "Set up for the Studio" adds the role lanes the set lacks and
   * "New song" adds a block of scenes, both through the Ghost Arcade script.
   * See liveShow.ts for the conventions.
   */
  import { onMount } from 'svelte';
  import { abletonBridge } from '../../ableton/abletonBridge';
  import { songsFromScenes } from '../../ableton/abletonSetlist';
  import { liveColor } from '../../ableton/abletonLinks';
  import { musicStudio } from '../../music/musicStudioStore';
  import { studioSceneForLive } from '../../music/scenes';
  import { captureLiveLook, clearLiveLook, liveCurrentScene } from '../../music/musicRuntime';
  import { hasSongs, lanePlan, missingLanes, SECTION_NAMES, songOfScene, songPlan, type Lane } from '../../music/liveShow';

  const s = $derived($musicStudio);
  const live = $derived($abletonBridge);
  const current = $derived($liveCurrentScene);
  const names = $derived(live.scenes.map((sc) => sc.name));
  const songs = $derived(songsFromScenes(live.scenes, live.tracks).flatMap((song) => (song.kind === 'scenes' ? [song] : [])));
  const songNow = $derived(current >= 0 ? songOfScene(songs, current) : -1);
  const canSetUp = $derived(live.protocol >= 4);
  const scriptOld = $derived(live.connected && !canSetUp);

  let setupOpen = $state(false);
  let lanesChosen = $state<Record<string, boolean>>({});
  const missing = $derived(missingLanes(live.tracks));
  let newOpen = $state(false);
  let title = $state('');
  let bpm = $state(120);
  let sections = $state<Record<string, boolean>>(Object.fromEntries(SECTION_NAMES.map((n) => [n, n !== 'Break'])));
  let busy = $state(false);
  let note = $state('');

  onMount(() => {
    void abletonBridge.refreshScript();
  });

  function look(scene: number): string | null {
    const id = studioSceneForLive(s.scenes, scene, names);
    return id ? (s.scenes.find((sc) => sc.id === id)?.name ?? null) : null;
  }

  function launchSong(index: number) {
    const song = songs[index];
    if (song?.sections[0]) abletonBridge.launchScene(song.sections[0].scene);
  }

  function report(result: { tracks: number; scenes: number; errors: string[] } | null, what: string) {
    if (!result) note = "Live didn't answer. Is the updated Ghost Arcade script running in Live?";
    else if (result.errors.length) note = `${what}, but Live refused some of it (Live Intro and Lite cap tracks and scenes): ${result.errors[0]}`;
    else note = what;
  }

  async function addLanes() {
    const chosen: Lane[] = missing.filter((l) => lanesChosen[l.id] !== false);
    if (!chosen.length) return;
    busy = true;
    const result = await abletonBridge.setupSet(lanePlan(chosen));
    busy = false;
    // Each new lane plays as its studio sound, so visuals already following that sound pick it up.
    if (result) for (const lane of chosen.slice(0, result.tracks)) musicStudio.setLiveRole(lane.name, lane.role);
    report(result, result ? `Added ${result.tracks} lane${result.tracks === 1 ? '' : 's'}` : '');
    if (result && !result.errors.length) setupOpen = false;
  }

  async function addSong() {
    const list = SECTION_NAMES.filter((n) => sections[n]);
    busy = true;
    const result = await abletonBridge.setupSet(songPlan(title || `Song ${songs.length + 1}`, bpm, list, songs.length));
    busy = false;
    report(result, result ? `Added ${result.scenes} scene${result.scenes === 1 ? '' : 's'}` : '');
    if (result && !result.errors.length) {
      newOpen = false;
      title = '';
    }
  }

  async function updateScript() {
    busy = true;
    const result = await abletonBridge.installScript();
    busy = false;
    note = result?.ok ? 'Script updated. Restart Live (or choose GhostArcade again as the Control Surface) to load it.' : (result?.error ?? "Couldn't update the script.");
  }
</script>

<div class="show">
  <div class="tools">
    <button class="btn" onclick={() => launchSong(songNow - 1)} disabled={songNow <= 0} title="Launch the previous song's first section in Live" aria-label="Previous song">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>
    </button>
    <button class="btn" onclick={() => launchSong(songNow + 1)} disabled={songNow < 0 ? !songs.length : songNow >= songs.length - 1} title="Launch the next song's first section in Live" aria-label="Next song">
      <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6l-3 3" /></svg>
    </button>
    <span class="now">{songNow >= 0 ? songs[songNow].title : songs.length ? `${songs.length} song${songs.length === 1 ? '' : 's'}` : 'No songs yet'}</span>
    <span class="spacer"></span>
    <button class="btn" class:on={newOpen} onclick={() => { newOpen = !newOpen; setupOpen = false; bpm = Math.round(live.tempo) || 120; }} disabled={!canSetUp} title="Add a song to the end of the set: a block of scenes, the first carrying its tempo">New song</button>
    <button class="btn" class:on={setupOpen} onclick={() => { setupOpen = !setupOpen; newOpen = false; }} disabled={!canSetUp} title="Add the role lanes this set lacks (Drums, Bass, Chords, Lead, Pads & FX, Vocals). Nothing in the set is renamed, moved or deleted">Set up for the Studio</button>
  </div>

  {#if scriptOld}
    <p class="hint warn">
      The Ghost Arcade script in Live is older than this version: songs play, but setting the set up needs the new one.
      <button class="btn small" onclick={updateScript} disabled={busy}>Update script</button>
    </p>
  {/if}

  {#if setupOpen}
    <div class="drawer">
      {#if missing.length}
        <p class="hint">Lanes to add at the end of the set, each named and coloured, playing as its studio sound:</p>
        <div class="chips">
          {#each missing as lane (lane.id)}
            <label class="chip" style="--lane: #{lane.color.toString(16).padStart(6, '0')}">
              <input type="checkbox" checked={lanesChosen[lane.id] !== false} onchange={(e) => (lanesChosen = { ...lanesChosen, [lane.id]: (e.target as HTMLInputElement).checked })} />
              {lane.name}<span class="kind">{lane.midi ? 'MIDI' : 'Audio'}</span>
            </label>
          {/each}
        </div>
        <button class="btn primary" onclick={addLanes} disabled={busy}>Add lanes</button>
      {:else}
        <p class="hint">This set has a track for every role. Name a scene with its tempo ("Night Drive Intro 124 BPM") to start a song, or add one with New song.</p>
      {/if}
    </div>
  {/if}

  {#if newOpen}
    <div class="drawer">
      <div class="row">
        <input class="title" placeholder="Song name" bind:value={title} aria-label="Song name" />
        <input class="bpm" type="number" min="40" max="300" step="1" bind:value={bpm} aria-label="Tempo" title="Live sets this tempo when the song starts" />
        <span class="unit">BPM</span>
      </div>
      <div class="chips">
        {#each SECTION_NAMES as name (name)}
          <label class="chip"><input type="checkbox" bind:checked={sections[name]} />{name}</label>
        {/each}
      </div>
      <button class="btn primary" onclick={addSong} disabled={busy}>Add song</button>
    </div>
  {/if}

  {#if note}<p class="hint">{note}</p>{/if}

  <div class="songs">
    {#if !songs.length}
      <p class="hint">
        {#if hasSongs(live.scenes)}Reading the set…{:else}No songs in this set yet. A scene named with its tempo ("Night Drive Intro 124 BPM") starts a song; the scenes after it are its sections. New song adds one.{/if}
      </p>
    {/if}
    {#each songs as song, si (si)}
      <div class="song" class:now={si === songNow}>
        <div class="song-head">
          <span class="song-title">{song.title}</span>
          {#if song.bpm}<span class="song-bpm">{song.bpm} BPM</span>{/if}
        </div>
        <div class="sections">
          {#each song.sections as section (section.scene)}
            {@const scene = live.scenes[section.scene]}
            {@const kept = look(section.scene)}
            <div class="section" class:current={current === section.scene} class:queued={scene?.queued} style="--scene: {liveColor(scene?.color ?? 0)}">
              <button class="launch" onclick={() => abletonBridge.launchScene(section.scene)} title="Launch {scene?.name || section.label} in Live{kept ? `; brings the look ${kept}` : ''}">
                <span class="label">{section.label}</span>
                {#if kept}<span class="kept" aria-label="Has a studio look">◆</span>{/if}
              </button>
              <button class="keep" onclick={() => captureLiveLook(section.scene, section.label)} title={kept ? 'Keep what the studio shows now on this section (replaces its look)' : "Keep what the studio shows now (visuals and sound) on this section: launching it brings it back"} aria-label="Keep the look on {section.label}">
                <svg viewBox="0 0 12 12" aria-hidden="true"><circle cx="6" cy="6" r="3.2" /></svg>
              </button>
              {#if kept}
                <button class="keep" onclick={() => clearLiveLook(section.scene)} title="Let this section go without a look" aria-label="Clear the look on {section.label}">
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.5 3.5l5 5M8.5 3.5l-5 5" /></svg>
                </button>
              {/if}
            </div>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>

<style>
  .show { display: flex; flex-direction: column; gap: 6px; height: 100%; min-height: 0; }
  .tools { display: flex; align-items: center; gap: 6px; flex: 0 0 auto; }
  .spacer { flex: 1; }
  .now { font-size: var(--ga-text-control, 12px); color: var(--studio-ink); font-weight: var(--ga-weight-control, 600); }
  .btn {
    height: var(--ga-control-h, 26px);
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: var(--studio-cell);
    color: var(--studio-ink);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn.on, .btn.primary { border-color: var(--studio-accent); color: var(--studio-accent); background: var(--studio-accent-soft); }
  .btn.small { height: 20px; padding: 0 6px; margin-left: 6px; }
  .btn svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .hint { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); line-height: 1.45; }
  .hint.warn { color: var(--studio-ink); }
  .drawer { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; padding: 8px; border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); background: var(--studio-slot); flex: 0 0 auto; }
  .row { display: flex; align-items: center; gap: 6px; }
  .title { width: 220px; height: 24px; }
  .bpm { width: 64px; height: 24px; }
  .unit { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip { display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 8px; border: 1px solid var(--studio-edge-soft); border-left: 3px solid var(--lane, var(--studio-edge)); border-radius: var(--studio-radius); font-size: var(--ga-text-meta, 11px); color: var(--studio-ink); cursor: pointer; }
  .kind { color: var(--studio-muted); font-size: 9px; }
  .songs { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
  .song { padding: 6px; border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); }
  .song.now { border-color: var(--studio-accent); }
  .song-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 5px; }
  .song-title { font-size: var(--ga-text-control, 12px); font-weight: var(--ga-weight-title, 650); color: var(--studio-ink); }
  .song-bpm { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); font-variant-numeric: tabular-nums; }
  .sections { display: flex; flex-wrap: wrap; gap: 4px; }
  .section { display: inline-flex; align-items: stretch; height: 30px; border: 1px solid var(--studio-edge-soft); border-left: 3px solid var(--scene); border-radius: var(--studio-radius); background: var(--studio-cell); overflow: hidden; }
  .section.current { border-color: var(--studio-accent); background: var(--studio-accent-soft); }
  .section.queued { animation: blink 0.5s steps(2, start) infinite; }
  @keyframes blink { to { border-color: var(--studio-accent); } }
  .launch { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; border: 0; background: none; color: var(--studio-ink); font: inherit; font-size: var(--ga-text-control, 12px); cursor: pointer; }
  .kept { font-size: 8px; color: var(--studio-accent); }
  .keep { width: 22px; border: 0; border-left: 1px solid var(--studio-edge-soft); background: none; color: var(--studio-muted); cursor: pointer; display: grid; place-items: center; }
  .keep:hover { color: var(--studio-accent); }
  .keep svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; }
</style>
