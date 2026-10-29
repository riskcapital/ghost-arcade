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
  import { launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { PLAYABLE_INSTRUMENTS, noteName, type InstrumentId } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS } from '../../music/instruments';
  import { octaveBaseNote, keyboardRange } from '../../music/keyboardLayout';
  import { PATTERN_LENGTHS, patternHasHits, type PatternLength } from '../../music/drumPattern';
  import { NOTE_SHADERS, addNoteShaderToDeck } from '../../music/noteShaders';
  import { musicStudio } from '../../music/musicStudioStore';
  import { ROOT_NAMES, SCALES, STUDIO_SETS, type ScaleId } from '../../music/studioSets';
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
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import BathModules from './BathModules.svelte';
  import BerlinModules from './BerlinModules.svelte';
  import RackModules from './RackModules.svelte';
  import CableLayer from './CableLayer.svelte';
  import PianoKeys from './PianoKeys.svelte';
  import DrumPads from './DrumPads.svelte';
  import StepGrid from './StepGrid.svelte';
  import TakeList from './TakeList.svelte';

  let { nativePreview = false }: { nativePreview?: boolean } = $props();

  let root = $state<HTMLElement | null>(null);
  let hole = $state<HTMLElement | null>(null);
  let elapsed = $state(0);
  let tempo = $state(120);
  let sceneTab = $state<'scenes' | 'takes'>('scenes');

  const s = $derived($musicStudio);
  const open = $derived(s.isOpen && s.studioView && $vjClipLauncher.isOpen);
  const visual = $derived(s.visuals[s.instrument]);
  const compactRange = $derived(keyboardRange('compact', s.octave));
  const queuedScene = $derived(s.scenes.find((sc) => sc.id === s.queuedSceneId) ?? null);
  const playingScene = $derived(s.scenes.find((sc) => sc.id === s.sceneId) ?? null);

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

  function columnLabel(column: number | null): string {
    if (column === null) return '';
    const clip = $vjClipLauncher.clipGrid.find((row) => row[column])?.[column];
    return clip ? `${column + 1} · ${clip.name}` : `Column ${column + 1}`;
  }
</script>

{#snippet frame()}
  <div class="frame" bind:this={hole}>
    <span class="frame-label">LIVE OUTPUT</span>
    {#if !nativePreview}
      <span class="frame-note">The live output appears here when the native renderer is running.</span>
    {/if}
  </div>
{/snippet}

{#snippet scenes()}
  <StudioModule title={sceneTab === 'scenes' ? 'SCENES' : 'TAKES'} subtitle={sceneTab === 'scenes' ? 'Beat, loop and visuals change together, on the bar' : 'Recorded performances'} class="scenes">
    {#snippet head()}
      <div class="seg small" role="tablist" aria-label="Scenes or takes">
        <button role="tab" aria-selected={sceneTab === 'scenes'} class:on={sceneTab === 'scenes'} onclick={() => (sceneTab = 'scenes')}>Scenes</button>
        <button role="tab" aria-selected={sceneTab === 'takes'} class:on={sceneTab === 'takes'} onclick={() => (sceneTab = 'takes')}>Takes {s.takes.length || ''}</button>
      </div>
      {#if sceneTab === 'scenes'}
        <button class="text-btn small" onclick={captureCurrentScene} title="Save what is playing now as a scene">+ CAPTURE</button>
      {/if}
    {/snippet}
    {#if sceneTab === 'takes'}
      <div class="scroll"><TakeList /></div>
    {:else}
      <div class="scene-grid">
        <span></span><span class="col">BEAT</span><span class="col">LOOP</span><span class="col">VISUALS</span><span></span>
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
          <span class="cell" class:playing>{takeName(scene.takeId) || '—'}</span>
          <span class="cell" class:playing>{columnLabel(scene.vjColumn) || '—'}</span>
          <button class="icon-btn" onclick={() => musicStudio.removeScene(scene.id)} aria-label="Delete scene {scene.name}" title="Delete scene">×</button>
        {:else}
          <p class="empty">Make a beat, loop a take and launch a VJ column, then Capture. Each scene brings all three back on the bar.</p>
        {/each}
      </div>
    {/if}
  </StudioModule>
{/snippet}

{#snippet beat()}
  <StudioModule title="BEAT" led={s.sequencerPlaying} class="beat">
    {#snippet head()}
      <select value={s.pattern.steps} onchange={(e) => musicStudio.setPatternLength(+(e.target as HTMLSelectElement).value as PatternLength)} aria-label="Steps">
        {#each PATTERN_LENGTHS as n}<option value={n}>{n} steps</option>{/each}
      </select>
      <StudioKnob label="Swing" value={s.pattern.swing} max={0.5} size={22} format={(v) => `${Math.round(v * 200)}%`} onchange={(v) => musicStudio.setSwing(v)} />
      <button class="text-btn small" onclick={() => musicStudio.clearPattern()}>CLEAR</button>
    {/snippet}
    <div class="scroll"><StepGrid rowHeight={s.set === 'bath' ? 12 : 14} /></div>
  </StudioModule>
{/snippet}

{#snippet play()}
  <StudioModule title="PLAY" class="play">
    {#snippet head()}
      <select value={s.instrument} onchange={(e) => musicStudio.setInstrument((e.target as HTMLSelectElement).value as InstrumentId)} aria-label="Keys play">
        {#each PLAYABLE_INSTRUMENTS as id}<option value={id}>{INSTRUMENT_LABELS[id]}</option>{/each}
      </select>
      <div class="stepper" title="Octave of the letter keys (Z / X)">
        <button onclick={() => musicStudio.shiftOctave(-1)} aria-label="Octave down">‹</button>
        <span>{noteName(octaveBaseNote(s.octave))}</span>
        <button onclick={() => musicStudio.shiftOctave(1)} aria-label="Octave up">›</button>
      </div>
    {/snippet}
    <div class="play-surface">
      {#if s.instrument === 'drums'}
        <DrumPads />
      {:else}
        <PianoKeys low={compactRange.low} high={compactRange.high} />
      {/if}
    </div>
    <div class="play-foot">
      <div class="seg small" role="group" aria-label="Visual behaviour">
        <button class:on={visual.mode === 'fade'} onclick={() => musicStudio.setVisualMode(s.instrument, 'fade')} title="Visuals linger, then fade away">Fade</button>
        <button class:on={visual.mode === 'build'} onclick={() => musicStudio.setVisualMode(s.instrument, 'build')} title="Visuals keep building while you play">Build</button>
      </div>
      <select
        class="add-visual"
        value=""
        aria-label="Add a note-reactive visual to the deck"
        onchange={(e) => {
          const el = e.target as HTMLSelectElement;
          const shader = NOTE_SHADERS.find((n) => n.file === el.value);
          if (shader) void addNoteShaderToDeck(shader.file, shader.name);
          el.value = '';
        }}
      >
        <option value="" disabled>Add visual…</option>
        {#each NOTE_SHADERS as shader}<option value={shader.file}>{shader.name}</option>{/each}
      </select>
    </div>
  </StudioModule>
{/snippet}

{#if open}
  <div class="studio-view set-{s.set}" role="region" aria-label="Studio view" bind:this={root}>
    <!-- Top bar -->
    <header class="bar">
      <div class="brand">
        <span class="wordmark">GHOST ARCADE</span>
        <span class="mode">STUDIO</span>
      </div>
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
        {#if s.recording}<span><span class="muted">REC</span> {seconds(elapsed)}</span>{/if}
      </div>
      <div class="key">
        <span class="muted">KEY</span>
        <select value={s.key.root} onchange={(e) => musicStudio.setKey({ ...s.key, root: +(e.target as HTMLSelectElement).value })} aria-label="Key root">
          {#each ROOT_NAMES as name, i}<option value={i}>{name}</option>{/each}
        </select>
        <select value={s.key.scale} onchange={(e) => musicStudio.setKey({ ...s.key, scale: (e.target as HTMLSelectElement).value as ScaleId })} aria-label="Scale">
          {#each Object.entries(SCALES) as [id, scale]}<option value={id}>{scale.label}</option>{/each}
        </select>
        <label class="check" title="Keep the drone and bowls in the key, whatever is played">
          <input type="checkbox" checked={s.scaleLock} onchange={() => musicStudio.setScaleLock(!s.scaleLock)} />
          Lock
        </label>
      </div>
      <div class="scene-status">
        {#if queuedScene}
          {playingScene ? playingScene.name : 'Now'} → <strong>{queuedScene.name}</strong> on the next bar
        {:else if playingScene}
          Scene <strong>{playingScene.name}</strong>
        {/if}
      </div>
      <div class="seg" role="group" aria-label="Instrument set">
        {#each STUDIO_SETS as set}
          <button class:on={s.set === set.id} onclick={() => musicStudio.setSet(set.id)}>{set.label}</button>
        {/each}
      </div>
      <button class="text-btn" onclick={panic} title="Stop every sounding note">ALL OFF</button>
      <button class="text-btn" onclick={() => musicStudio.setStudioView(false)} title="Back to the music tray; the music keeps playing">TRAY VIEW</button>
      <button class="text-btn" onclick={() => musicStudio.close()} title="Close the studio and stop the music">EXIT</button>
    </header>

    {#if s.set === 'bath'}
      <div class="rack left">
        <BathModules part="drone" />
        <BathModules part="bowls" />
        {@render play()}
      </div>
      <div class="centre">
        <div class="frame-row">
          {@render frame()}
          <RackModules part="bay" />
        </div>
        {@render scenes()}
      </div>
      <div class="rack right">
        <BathModules part="xy" />
        <RackModules part="fx" />
      </div>
      <div class="bottom chords"><BathModules part="chords" /></div>
      <div class="bottom macros"><RackModules part="macros" columns={8} /></div>
      <div class="bottom beat-slot">{@render beat()}</div>
    {:else}
      <div class="rack left">
        <BerlinModules part="drums" />
        <BerlinModules part="acid" />
      </div>
      <div class="centre">
        <div class="frame-row">{@render frame()}</div>
        {@render scenes()}
      </div>
      <div class="rack right">
        <BerlinModules part="layers" />
        <RackModules part="fx" />
      </div>
      <div class="bottom beat-wide">{@render beat()}</div>
      <div class="bottom macros"><RackModules part="macros" /></div>
    {/if}

    <CableLayer {root} />
  </div>
{/if}

<style>
  /* VJ mode stays mounted under the Studio view (its preview sync keeps
     running) but hides, so only the output shows through the frame. */
  :global(.vj-overlay.studio-view-open > :not(.studio-view)) {
    visibility: hidden;
  }

  .studio-view {
    --studio-ground: #0c0b0a;
    --studio-panel: #171614;
    --studio-edge: #3a3631;
    --studio-edge-soft: #2a2723;
    --studio-slot: #0e0d0c;
    --studio-cell: #1d1b18;
    --studio-ink: #e8e1cf;
    --studio-muted: #9a9384;
    --studio-accent: #f0a43a;
    --studio-accent-soft: rgba(240, 164, 58, 0.14);
    --studio-on-accent: #1a1206;
    --studio-knob-face: radial-gradient(circle at 35% 30%, #3a3631, #161412 70%);
    --studio-knob-edge: #4a453e;
    --studio-radius: 4px;
    --studio-cheek: repeating-linear-gradient(176deg, #4a2c19 0px, #5a361f 3px, #3d2414 7px, #533220 11px);
    /* The app's sliders fill with its accent; inside the Studio they fill amber. */
    --ga-slider-fill: var(--studio-accent);

    /* Shared parts (keys, pads, steps, takes) read the --mk tokens. */
    --mk-accent: var(--studio-accent);
    --mk-on-accent: var(--studio-on-accent);
    --mk-ink: var(--studio-ink);
    --mk-muted: var(--studio-muted);
    --mk-line: var(--studio-edge);
    --mk-line-soft: var(--studio-edge-soft);
    --mk-slot: var(--studio-slot);
    --mk-cell: var(--studio-cell);
    --mk-cell-edge: var(--studio-edge-soft);
    --mk-radius: var(--studio-radius);
    --mk-white: #e8e1cf;
    --mk-black: #1a1815;

    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    grid-template-columns: 360px minmax(0, 1fr) 380px;
    grid-template-rows: 52px minmax(0, 1fr) 196px;
    grid-template-areas:
      'bar bar bar'
      'left centre right'
      'b1 b2 b3';
    gap: 12px;
    padding: 0 18px 14px;
    box-sizing: border-box;
    color: var(--studio-ink);
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-size: 12px;
    user-select: none;
  }
  .set-berlin { grid-template-areas: 'bar bar bar' 'left centre right' 'b1 b1 b3'; }

  /* Walnut cheeks on the rack's sides. */
  .studio-view::before, .studio-view::after {
    content: '';
    position: absolute;
    top: 52px;
    bottom: 0;
    width: 8px;
    background: var(--studio-cheek);
    z-index: 1;
  }
  .studio-view::before { left: 0; }
  .studio-view::after { right: 0; }

  /* The output frame lets the native preview show through; its shadow paints the ground everywhere else. */
  .frame {
    position: relative;
    z-index: 0;
    flex: 1;
    min-width: 0;
    min-height: 0;
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
    font-size: 10px;
    font-weight: 800;
    letter-spacing: 0.14em;
    color: var(--studio-muted);
  }
  .frame-note { position: absolute; inset: 0; display: grid; place-items: center; color: var(--studio-muted); }

  .bar, .rack, .scenes-wrap, .bottom, .frame-row > :global(.bay), .centre > :global(.module) { position: relative; z-index: 1; }

  /* ── Top bar ── */
  .bar {
    grid-area: bar;
    margin: 0 -18px;
    padding: 0 20px;
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--studio-slot);
    border-bottom: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
  }
  .brand { display: flex; align-items: baseline; gap: 10px; }
  .wordmark { font-weight: 800; letter-spacing: 0.14em; font-size: 14px; }
  .mode { font-weight: 700; letter-spacing: 0.22em; font-size: 11px; color: var(--studio-accent); }
  .sep { width: 1px; height: 24px; background: var(--studio-edge-soft); }
  .transport {
    width: 34px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--studio-edge);
    background: var(--studio-panel);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .transport svg { width: 12px; height: 12px; fill: currentColor; }
  .transport.on { border-color: var(--studio-accent); background: var(--studio-accent-soft); color: var(--studio-accent); }
  .transport.rec svg { fill: #c9503c; }
  .transport.rec.on { border-color: #c9503c; }
  .readouts { display: flex; gap: 18px; font-family: var(--ga-font-mono, ui-monospace); font-size: 13px; }
  .key { display: flex; align-items: center; gap: 6px; }
  .scene-status { flex: 1; text-align: center; color: var(--studio-muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; }
  .scene-status strong { color: var(--studio-ink); }

  /* ── Layout ── */
  .rack { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .rack.left { grid-area: left; }
  .rack.right { grid-area: right; }
  .centre { grid-area: centre; display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
  .frame-row { flex: 1; min-height: 0; display: flex; gap: 12px; }
  .centre > :global(.scenes) { flex: 0 0 auto; max-height: 42%; }
  .bottom { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .bottom > :global(.module) { flex: 1; }
  .chords { grid-area: b1; }
  .macros { grid-area: b2; }
  .set-berlin .macros { grid-area: b3; }
  .beat-slot { grid-area: b3; }
  .beat-wide { grid-area: b1; }
  .rack.left > :global(.play) { flex: 1; }

  /* ── Controls ── */
  select {
    height: 26px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 12px;
  }
  .muted { color: var(--studio-muted); }
  .check { display: inline-flex; align-items: center; gap: 5px; color: var(--studio-muted); }
  .check input { accent-color: var(--studio-accent); }
  .stepper { display: inline-flex; align-items: center; gap: 4px; }
  .stepper span { min-width: 28px; text-align: center; font-family: var(--ga-font-mono, ui-monospace); }
  .stepper button, .icon-btn {
    width: 24px;
    height: 24px;
    padding: 0;
    border: 1px solid var(--studio-edge);
    background: transparent;
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .seg { display: inline-flex; border: 1px solid var(--studio-edge); border-radius: var(--studio-radius); overflow: hidden; }
  .seg button {
    height: 28px;
    padding: 0 12px;
    border: 0;
    background: transparent;
    color: var(--studio-muted);
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .seg.small button { height: 22px; padding: 0 8px; font-size: 11px; }
  .seg button + button { border-left: 1px solid var(--studio-edge); }
  .seg button.on { background: var(--studio-accent-soft); color: var(--studio-accent); }
  .text-btn {
    height: 30px;
    padding: 0 12px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-panel);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .text-btn.small { height: 24px; padding: 0 9px; font-size: 10px; }
  .scroll { min-height: 0; overflow: auto; flex: 1; }
  .empty { margin: 4px 0; color: var(--studio-muted); grid-column: 1 / -1; line-height: 1.5; }

  .play-surface { flex: 1; min-height: 70px; display: flex; }
  .play-foot { display: flex; align-items: center; gap: 8px; }
  .add-visual { flex: 1; min-width: 0; height: 24px; }

  /* ── Scenes ── */
  .scene-grid {
    display: grid;
    grid-template-columns: minmax(130px, 1.2fr) repeat(3, minmax(0, 1fr)) 26px;
    gap: 6px;
    overflow: auto;
    align-items: center;
  }
  .col { font-size: 10px; font-weight: 800; letter-spacing: 0.14em; color: var(--studio-muted); }
  .launch {
    height: 36px;
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
    width: 30px;
    height: 30px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .go svg { width: 11px; height: 11px; fill: currentColor; }
  .launch input {
    min-width: 0;
    flex: 1;
    height: 24px;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    font-weight: 800;
    border-radius: var(--studio-radius);
  }
  .launch input:focus { border-color: var(--studio-edge); background: var(--studio-slot); }
  .launch.playing { border-color: var(--studio-accent); background: var(--studio-accent); color: var(--studio-on-accent); }
  .launch.queued { border-color: var(--studio-accent); color: var(--studio-accent); }
  .cell {
    height: 36px;
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
