<script lang="ts">
  /**
   * The Studio view: VJ mode as one full-screen instrument. The live output
   * stays in the middle and the set's modules sit around it, patched together
   * with cables, so a set never needs a panel opened or closed. The native
   * renderer draws the output into the frame this view hands it; everything
   * else here is opaque.
   */
  import { get } from 'svelte/store';
  import { nativePreviewHostEl } from '../../stores/nativePreviewHost';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { launchClockPosition, launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { patternHasHits } from '../../music/drumPattern';
  import { LOOP_ROLES, loopById } from '../../music/loops';
  import { scanPosition } from '../../music/scanSynth';
  import { musicStudio } from '../../music/musicStudioStore';
  import { ROOT_NAMES, SCALES, STUDIO_SETS, keyLabel, type ScaleId } from '../../music/studioSets';
  import { loadAnalogPatch, loadBerlinJam, loadDubJam } from '../../music/jams';
  import {
    captureCurrentScene,
    launchScene,
    panic,
    recordingElapsed,
    startRecording,
    startSequencer,
    stopRecording,
    stopSequencer,
  } from '../../music/musicRuntime';
  import './studioTokens.css';
  import StudioModule from './StudioModule.svelte';
  import BathModules from './BathModules.svelte';
  import BerlinModules from './BerlinModules.svelte';
  import DubModules from './DubModules.svelte';
  import AnalogModules from './AnalogModules.svelte';
  import RackModules from './RackModules.svelte';
  import VisualRack from './VisualRack.svelte';
  import MacroStrip from './MacroStrip.svelte';
  import OutputStrip from './OutputStrip.svelte';
  import LoopBrowser from './LoopBrowser.svelte';
  import LoopRecorderBar from './LoopRecorderBar.svelte';
  import PadsModule from './PadsModule.svelte';
  import PlayModule from './PlayModule.svelte';
  import BeatModule from './BeatModule.svelte';
  import CableLayer from './CableLayer.svelte';
  import MacroEditor from './MacroEditor.svelte';
  import TakeList from './TakeList.svelte';

  let { nativePreview = false }: { nativePreview?: boolean } = $props();

  let root = $state<HTMLElement | null>(null);
  let hole = $state<HTMLElement | null>(null);
  let elapsed = $state(0);
  let tempo = $state(120);
  let scanX = $state(0);
  let lowerTab = $state<'scenes' | 'loops' | 'takes'>('loops');

  const s = $derived($musicStudio);
  const open = $derived(s.isOpen && s.studioView && $vjClipLauncher.isOpen);
  const queuedScene = $derived(s.scenes.find((sc) => sc.id === s.queuedSceneId) ?? null);
  const playingScene = $derived(s.scenes.find((sc) => sc.id === s.sceneId) ?? null);
  const jam = $derived(s.set === 'berlin' ? loadBerlinJam : s.set === 'dub' ? loadDubJam : s.set === 'analog' ? loadAnalogPatch : null);
  const lowerSubtitle = $derived(
    lowerTab === 'scenes'
      ? queuedScene
        ? `${queuedScene.name} on the next bar`
        : playingScene
          ? `Playing ${playingScene.name}`
          : 'Beat, loops, take and visuals change together, on the bar'
      : lowerTab === 'loops'
        ? `In ${keyLabel(s.key)}`
        : 'Recorded performances',
  );

  // The live output draws into the frame while the view is up.
  $effect(() => {
    if (!open || !nativePreview || !hole) return;
    const el = hole;
    nativePreviewHostEl.set(el);
    return () => {
      if (get(nativePreviewHostEl) === el) nativePreviewHostEl.set(null);
    };
  });

  // The record timer and the tempo readout tick while the view is up.
  $effect(() => {
    if (!open) return;
    const timer = setInterval(() => {
      tempo = launchClockTempo();
      elapsed = get(musicStudio).recording ? recordingElapsed() : 0;
    }, 250);
    return () => clearInterval(timer);
  });

  // The scan line glides across the output in time with the beat.
  $effect(() => {
    if (!open || !s.scanOn) return;
    let frame = 0;
    const tick = () => {
      scanX = scanPosition(launchClockPosition().beat, get(musicStudio).params['scan.speed'] ?? 0.5);
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  });

  function toggleBeat() {
    if (s.sequencerPlaying) stopSequencer();
    else startSequencer();
  }

  function toggleRecord() {
    if (s.recording) {
      if (!stopRecording()) showToast('Nothing was played, so no take was kept.', 'info');
    } else {
      startRecording();
    }
  }

  function seconds(sec: number): string {
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }

  function takeName(id: string | null): string {
    if (!id) return '';
    return s.takes.find((t) => t.id === id)?.name ?? 'Missing take';
  }

  function loopNames(loops: Partial<Record<string, string>>): string {
    return LOOP_ROLES.map((role) => loops[role] && loopById(loops[role]!)?.name).filter(Boolean).join(', ');
  }

  function columnLabel(column: number | null): string {
    if (column === null) return '';
    const clip = $vjClipLauncher.clipGrid.find((row) => row[column])?.[column];
    return clip ? `${column + 1} · ${clip.name}` : `Column ${column + 1}`;
  }
</script>

{#snippet frame()}
  <div class="frame" bind:this={hole}>
    <span class="frame-label">LIVE OUTPUT</span>
    {#if s.scanOn}
      <span class="scan-line" style="left: {scanX * 100}%"></span>
    {/if}
    {#if !nativePreview}
      <span class="frame-note">The live output appears here when the native renderer is running.</span>
    {/if}
  </div>
{/snippet}

{#snippet lower()}
  <StudioModule title={lowerTab.toUpperCase()} subtitle={lowerSubtitle} class="lower">
    {#snippet lead()}
      <div class="seg small" role="tablist" aria-label="Scenes, loops or takes">
        <button role="tab" aria-selected={lowerTab === 'loops'} class:on={lowerTab === 'loops'} onclick={() => (lowerTab = 'loops')}>Loops</button>
        <button role="tab" aria-selected={lowerTab === 'scenes'} class:on={lowerTab === 'scenes'} onclick={() => (lowerTab = 'scenes')}>Scenes{s.scenes.length ? ` ${s.scenes.length}` : ''}</button>
        <button role="tab" aria-selected={lowerTab === 'takes'} class:on={lowerTab === 'takes'} onclick={() => (lowerTab = 'takes')}>Takes{s.takes.length ? ` ${s.takes.length}` : ''}</button>
      </div>
    {/snippet}
    {#snippet head()}
      {#if lowerTab === 'scenes'}
        {#if jam}
          <button class="text-btn small" onclick={() => void jam()} title="Load the set's ready-made jam: a groove, loops, its visuals and the cables between them">LOAD JAM</button>
        {/if}
        <button class="text-btn small" onclick={captureCurrentScene} title="Save what is playing now as a scene">+ SAVE SCENE</button>
      {:else if lowerTab === 'loops'}
        <LoopRecorderBar />
      {/if}
    {/snippet}
    {#if lowerTab === 'loops'}
      <LoopBrowser />
    {:else if lowerTab === 'takes'}
      <div class="scroll"><TakeList /></div>
    {:else}
      <div class="scene-grid">
        <span></span><span class="col">BEAT</span><span class="col">LOOPS</span><span class="col">TAKE</span><span class="col">VISUALS</span><span></span>
        {#each s.scenes as scene (scene.id)}
          {@const playing = s.sceneId === scene.id}
          {@const queued = s.queuedSceneId === scene.id}
          <div class="launch" class:playing class:queued>
            <button class="go" onclick={() => launchScene(scene.id)} aria-label="Launch {scene.name}" title={queued ? 'Launch now' : 'Launch on the next bar'}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4l14 8-14 8z"/></svg>
            </button>
            <input value={scene.name} onchange={(e) => musicStudio.updateScene(scene.id, { name: (e.target as HTMLInputElement).value.trim() || scene.name })} aria-label="Scene name" />
          </div>
          <span class="cell" class:playing>{scene.beat ? (scene.pattern && patternHasHits(scene.pattern) ? `${scene.pattern.steps} steps` : 'On') : 'Off'}</span>
          <span class="cell" class:playing>{loopNames(scene.loops) || '—'}</span>
          <span class="cell" class:playing>{takeName(scene.takeId) || '—'}</span>
          <span class="cell" class:playing>{columnLabel(scene.vjColumn) || '—'}</span>
          <button class="icon-btn" onclick={() => musicStudio.removeScene(scene.id)} aria-label="Delete scene {scene.name}" title="Delete scene">×</button>
        {:else}
          <p class="empty">Start a beat and some loops, launch a VJ column, then Save scene. Each scene brings it all back on the bar.</p>
        {/each}
      </div>
    {/if}
  </StudioModule>
{/snippet}

{#if open}
  <div class="studio-view studio-tokens set-{s.set}" role="region" aria-label="Studio view" bind:this={root}>
    <header class="bar">
      <span class="mode">STUDIO</span>
      <span class="sep"></span>
      <button class="transport" class:on={s.sequencerPlaying} onclick={toggleBeat} title={s.sequencerPlaying ? 'Stop the beat' : 'Play the beat on the VJ clock'} aria-label={s.sequencerPlaying ? 'Stop the beat' : 'Play the beat'}>
        {#if s.sequencerPlaying}
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>
        {/if}
      </button>
      <button class="transport rec" class:on={s.recording} onclick={toggleRecord} title={s.recording ? 'Stop recording and keep the take' : 'Record a take'} aria-label={s.recording ? 'Stop recording' : 'Record'}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>
      </button>
      <div class="readouts">
        <span><span class="muted">BPM</span> {tempo.toFixed(1)}</span>
        {#if s.recording}<span class="rec-time">{seconds(elapsed)}</span>{/if}
      </div>
      <span class="sep"></span>
      <div class="key">
        <span class="muted">KEY</span>
        <select value={s.key.root} onchange={(e) => musicStudio.setKey({ ...s.key, root: +(e.target as HTMLSelectElement).value })} aria-label="Key root">
          {#each ROOT_NAMES as name, i}<option value={i}>{name}</option>{/each}
        </select>
        <select value={s.key.scale} onchange={(e) => musicStudio.setKey({ ...s.key, scale: (e.target as HTMLSelectElement).value as ScaleId })} aria-label="Scale">
          {#each Object.entries(SCALES) as [id, scale]}<option value={id}>{scale.label}</option>{/each}
        </select>
        <label class="check" title="Keep what the keys play in the key">
          <input type="checkbox" checked={s.scaleLock} onchange={() => musicStudio.setScaleLock(!s.scaleLock)} />
          Lock
        </label>
      </div>
      <span class="sep"></span>
      <MacroStrip />
      <span class="spacer"></span>
      <div class="seg" role="group" aria-label="Instrument set">
        {#each STUDIO_SETS as set}
          <button class:on={s.set === set.id} onclick={() => musicStudio.setSet(set.id)}>{set.label}</button>
        {/each}
      </div>
      <span class="sep"></span>
      <button class="icon-btn" onclick={panic} title="Stop every sounding note" aria-label="All notes off">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 4v8M7 7a7 7 0 1 0 10 0" /></svg>
      </button>
      <button class="text-btn" onclick={() => musicStudio.setStudioView(false)} title="Back to the music tray; the music keeps playing">TRAY</button>
      <button class="text-btn" onclick={() => musicStudio.close()} title="Close the studio and stop the music">EXIT</button>
    </header>

    <div class="centre">
      {@render frame()}
      <OutputStrip layers={false} />
      {@render lower()}
    </div>

    {#if s.set === 'bath'}
      <div class="rack left face">
        <BathModules part="drone" />
        <BathModules part="bowls" />
        <BathModules part="xy" />
      </div>
      <div class="rack right face">
        <VisualRack />
        <RackModules />
      </div>
      <div class="slot b1 face"><BathModules part="chords" /></div>
      <div class="slot b2 face"><PlayModule /></div>
      <div class="slot b3 face"><BeatModule /></div>
    {:else if s.set === 'berlin'}
      <div class="rack left face">
        <BerlinModules part="drums" />
        <BerlinModules part="acid" />
      </div>
      <div class="rack right face">
        <VisualRack />
        <RackModules />
      </div>
      <div class="slot b12 face"><BeatModule /></div>
      <div class="slot b3 face"><PadsModule /></div>
    {:else if s.set === 'dub'}
      <div class="rack left face">
        <DubModules part="bass" />
        <DubModules part="siren" />
        <PadsModule />
      </div>
      <div class="rack right face">
        <VisualRack />
        <RackModules />
      </div>
      <div class="slot b12 face"><PlayModule size="wide" /></div>
      <div class="slot b3 face"><BeatModule /></div>
    {:else}
      <div class="rack left face">
        <PlayModule />
        <PadsModule />
      </div>
      <div class="rack right face">
        <VisualRack />
        <RackModules />
      </div>
      <div class="slot b12 face"><AnalogModules /></div>
      <div class="slot b3 face"><BeatModule /></div>
    {/if}

    <CableLayer {root} />
    <MacroEditor />
  </div>
{/if}

<style>
  /* VJ mode stays mounted under the Studio view (its preview sync keeps
     running) but hides, so only the output shows through the frame. */
  :global(.vj-overlay.studio-view-open > :not(.studio-view)) {
    visibility: hidden;
  }

  .studio-view {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    grid-template-columns: 336px minmax(0, 1fr) 356px;
    grid-template-rows: 56px minmax(0, 1fr) 196px;
    grid-template-areas:
      'bar bar bar'
      'left centre right'
      'b1 b2 b3';
    gap: var(--studio-gap);
    padding: 0 14px 12px;
    box-sizing: border-box;
    user-select: none;
  }
  .set-analog { grid-template-rows: 56px minmax(0, 1fr) 214px; }

  /* The output frame lets the native preview show through; its shadow paints the ground everywhere else. */
  .frame {
    position: relative;
    z-index: 0;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border: 1px solid var(--studio-edge);
    border-radius: var(--studio-radius);
    background: transparent;
    box-shadow: 0 0 0 200vmax var(--studio-ground);
  }
  .frame-label {
    position: absolute;
    left: 10px;
    top: 8px;
    padding: 2px 6px;
    background: var(--studio-ground);
    border-radius: 3px;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.14em;
    color: var(--studio-muted);
  }
  .frame-note { position: absolute; inset: 0; display: grid; place-items: center; color: var(--studio-muted); }
  .scan-line {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    margin-left: -1px;
    background: var(--studio-accent);
    box-shadow: 0 0 10px var(--studio-accent), 0 0 2px #fff;
    pointer-events: none;
  }

  .bar, .rack, .slot, .centre > :global(.module) { position: relative; z-index: 1; }

  /* ── Top bar ── */
  .bar {
    grid-area: bar;
    margin: 0 -14px;
    padding: 0 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
  }
  .mode { font-weight: 700; letter-spacing: 0.22em; font-size: 11px; color: var(--studio-ink); }
  .sep { flex: 0 0 auto; width: 1px; height: 26px; background: var(--studio-edge-soft); }
  .spacer { flex: 1; min-width: 4px; }
  .readouts { display: flex; gap: 12px; font-family: var(--ga-font-mono, ui-monospace); font-size: 12px; font-variant-numeric: tabular-nums; }
  .rec-time { color: var(--ga-rec, #ff3b30); }
  .key { display: flex; align-items: center; gap: 6px; }

  /* ── Layout ── */
  .rack { display: flex; flex-direction: column; gap: var(--studio-gap); min-height: 0; }
  .rack.left { grid-area: left; }
  .rack.right { grid-area: right; }
  .rack > :global(.module) { flex: 0 0 auto; }
  .rack > :global(.module.grow), .rack > :global(.play), .rack > :global(.beat) { flex: 1 1 0; }
  .centre { grid-area: centre; display: flex; flex-direction: column; gap: var(--studio-gap); min-width: 0; min-height: 0; }
  .centre > :global(.lower) { flex: 0 0 auto; height: 36%; min-height: 200px; }
  .slot { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .slot > :global(.module) { flex: 1; }
  .b1 { grid-area: b1; }
  .b2 { grid-area: b2; }
  .b3 { grid-area: b3; }
  .b12 { grid-column: 1 / 3; grid-row: 3; }
  .b123 { grid-column: 1 / -1; grid-row: 3; }

  /* ── Lower panel ── */
  .scroll { min-height: 0; overflow: auto; flex: 1; display: flex; flex-direction: column; }
  .empty { margin: 4px 0; color: var(--studio-muted); grid-column: 1 / -1; line-height: 1.5; }

  /* ── Scenes ── */
  .scene-grid {
    display: grid;
    grid-template-columns: minmax(130px, 1.2fr) minmax(0, 0.6fr) minmax(0, 1.2fr) repeat(2, minmax(0, 1fr)) 22px;
    gap: 5px;
    overflow: auto;
    align-items: center;
  }
  .col { font-size: 9px; font-weight: 700; letter-spacing: 0.12em; color: var(--studio-muted); }
  .launch {
    height: 30px;
    box-sizing: border-box;
    padding: 0 6px 0 2px;
    display: flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-cell);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
  }
  .go {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .go svg { width: 10px; height: 10px; fill: currentColor; }
  .launch input {
    min-width: 0;
    flex: 1;
    height: 22px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 650;
    border-radius: var(--studio-radius);
  }
  .launch input:focus { border-color: var(--studio-edge); background: var(--studio-slot); }
  .launch.playing { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); }
  .launch.queued { border-color: var(--studio-accent); color: var(--studio-accent); }
  .cell {
    height: 30px;
    padding: 0 8px;
    display: flex;
    align-items: center;
    border: 1px solid var(--studio-edge-soft);
    background: var(--studio-slot);
    border-radius: var(--studio-radius);
    color: var(--studio-muted);
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }
  .cell.playing { border-color: var(--studio-accent); color: var(--studio-ink); }
</style>
