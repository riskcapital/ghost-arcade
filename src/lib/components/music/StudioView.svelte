<script lang="ts">
  /**
   * The Studio view: VJ mode as one full-screen instrument. The live output
   * stays in the middle and the modules sit around it, so a set never needs
   * a panel opened or closed. The native renderer draws the output into the
   * frame this view hands it; everything else here is opaque.
   */
  import { get } from 'svelte/store';
  import { nativePreviewHostEl } from '../../stores/nativePreviewHost';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { macros } from '../../stores/macros';
  import { launchClockTempo } from '../../stores/launchClock';
  import { showToast } from '../../stores/errorToast';
  import { INSTRUMENTS, noteName } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from '../../music/instruments';
  import { KEYBOARD_SIZES, keyboardRange, octaveBaseNote } from '../../music/keyboardLayout';
  import { PATTERN_LENGTHS, patternHasHits, type PatternLength } from '../../music/drumPattern';
  import { NOTE_SHADERS, addNoteShaderToDeck } from '../../music/noteShaders';
  import { STUDIO_SKINS, musicStudio } from '../../music/musicStudioStore';
  import { musicMidiDevices, musicMidiStatus } from '../../music/midiNotes';
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
  import StudioKnob from './StudioKnob.svelte';
  import PianoKeys from './PianoKeys.svelte';
  import DrumPads from './DrumPads.svelte';
  import StepGrid from './StepGrid.svelte';
  import TakeList from './TakeList.svelte';

  let { nativePreview = false }: { nativePreview?: boolean } = $props();

  let hole = $state<HTMLElement | null>(null);
  let elapsed = $state(0);
  let tempo = $state(120);

  const s = $derived($musicStudio);
  const open = $derived(s.isOpen && s.studioView && $vjClipLauncher.isOpen);
  const visual = $derived(s.visuals[s.instrument]);
  const range = $derived(keyboardRange(s.keyboardSize, s.octave));
  const wideKeys = $derived(s.instrument !== 'drums' && s.keyboardSize !== 'compact');
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

  function onPatch(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    if (s.instrument === 'synth') musicStudio.setSynthPatch(value as SynthPatch);
    else musicStudio.setKeysPatch(value as KeysPatch);
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

  function macroDetail(effects: number): string {
    return effects === 0 ? 'no FX' : effects === 1 ? '1 FX' : `${effects} FX`;
  }
</script>

{#if open}
  <div class="studio-view skin-{s.skin}" role="region" aria-label="Studio view">
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
      <div class="scene-status">
        {#if queuedScene}
          {playingScene ? playingScene.name : 'Now'} → <strong>{queuedScene.name}</strong> on the next bar
        {:else if playingScene}
          Scene <strong>{playingScene.name}</strong>
        {/if}
      </div>
      <div class="seg" role="group" aria-label="Panel style">
        {#each STUDIO_SKINS as skin}
          <button class:on={s.skin === skin.id} onclick={() => musicStudio.setSkin(skin.id)}>{skin.label}</button>
        {/each}
      </div>
      <button class="text-btn" onclick={panic} title="Stop every sounding note">ALL OFF</button>
      <button class="text-btn" onclick={() => musicStudio.setStudioView(false)} title="Back to the music tray; the music keeps playing">TRAY VIEW</button>
      <button class="text-btn" onclick={() => musicStudio.close()} title="Close the studio and stop the music">EXIT</button>
    </header>

    <!-- Left rack -->
    <div class="rack left">
      <section class="module">
        <div class="head">
          <span class="led on"></span>
          <h2>INSTRUMENT</h2>
          <div class="seg small" role="group" aria-label="Instrument">
            {#each INSTRUMENTS as id}
              <button class:on={s.instrument === id} onclick={() => musicStudio.setInstrument(id)}>{INSTRUMENT_LABELS[id]}</button>
            {/each}
          </div>
        </div>
        <div class="body">
          {#if s.instrument !== 'drums'}
            <label class="field">
              <span>Sound</span>
              <select value={s.instrument === 'synth' ? s.synthPatch : s.keysPatch} onchange={onPatch}>
                {#each s.instrument === 'synth' ? SYNTH_PATCHES : KEYS_PATCHES as patch}
                  <option value={patch.id}>{patch.label}</option>
                {/each}
              </select>
            </label>
          {/if}
          <div class="knobs">
            <StudioKnob label="Level" value={s.volumes[s.instrument]} defaultValue={0.8} onchange={(v) => musicStudio.setVolume(s.instrument, v)} title="{INSTRUMENT_LABELS[s.instrument]} level" />
            <StudioKnob label="Velocity" value={s.velocity} min={0.05} defaultValue={0.8} onchange={(v) => musicStudio.setVelocity(v)} title="Velocity for keys and pads (C / V)" />
            <StudioKnob label="Master" value={s.masterVolume} defaultValue={0.85} onchange={(v) => musicStudio.setMasterVolume(v)} />
          </div>
          <div class="field-row">
            <label class="check" title="Play with the computer keyboard: A–' are the keys, Z X shift octave, C V set velocity">
              <input type="checkbox" checked={s.keysArmed} onchange={() => musicStudio.setKeysArmed(!s.keysArmed)} />
              Letter keys
            </label>
            <div class="stepper" title="Octave of the letter keys (Z / X)">
              <button onclick={() => musicStudio.shiftOctave(-1)} aria-label="Octave down">‹</button>
              <span>{noteName(octaveBaseNote(s.octave))}</span>
              <button onclick={() => musicStudio.shiftOctave(1)} aria-label="Octave up">›</button>
            </div>
          </div>
          <label class="field">
            <span>MIDI</span>
            <select value={s.midiInput} onchange={(e) => musicStudio.setMidiInput((e.target as HTMLSelectElement).value)} title="MIDI input. Channel 10 always plays the drums.">
              <option value="">{$musicMidiStatus === 'unavailable' ? 'MIDI unavailable' : $musicMidiDevices.length ? 'All MIDI inputs' : 'No MIDI device'}</option>
              {#each $musicMidiDevices as device (device.id)}
                <option value={device.id}>{device.name}</option>
              {/each}
            </select>
          </label>
        </div>
      </section>

      <section class="module">
        <div class="head">
          <span class="led" class:on={visual.mode === 'build'}></span>
          <h2>NOTE VISUALS</h2>
          <div class="seg small" role="group" aria-label="Visual behaviour">
            <button class:on={visual.mode === 'fade'} onclick={() => musicStudio.setVisualMode(s.instrument, 'fade')} title="Visuals linger, then fade away">Fade</button>
            <button class:on={visual.mode === 'build'} onclick={() => musicStudio.setVisualMode(s.instrument, 'build')} title="Visuals keep building while you play">Build</button>
          </div>
        </div>
        <div class="body">
          <div class="knobs">
            <StudioKnob label="Attack" value={visual.attack} min={0.002} max={2} defaultValue={0.02} format={(v) => `${v.toFixed(2)} s`} onchange={(v) => musicStudio.setVisual(s.instrument, { attack: v })} />
            {#if visual.mode === 'fade'}
              <StudioKnob label="Fade" value={visual.release} min={0.05} max={6} defaultValue={0.9} format={(v) => `${v.toFixed(1)} s`} onchange={(v) => musicStudio.setVisual(s.instrument, { release: v })} />
            {:else}
              <StudioKnob label="Linger" value={visual.linger} min={1} max={40} defaultValue={8} format={(v) => `${Math.round(v)} s`} onchange={(v) => musicStudio.setVisual(s.instrument, { linger: v })} />
            {/if}
            <StudioKnob label="Growth" value={visual.growth} defaultValue={0.06} onchange={(v) => musicStudio.setVisual(s.instrument, { growth: v })} title="How much each note builds up" />
          </div>
          <div class="shader-list">
            <span class="muted">Add to deck</span>
            {#each NOTE_SHADERS as shader}
              <button class="link" onclick={() => addNoteShaderToDeck(shader.file, shader.name)}>{shader.name}</button>
            {/each}
          </div>
        </div>
      </section>
    </div>

    <!-- Centre: the output, then the scenes -->
    <div class="centre">
      <div class="frame" bind:this={hole}>
        <span class="frame-label">LIVE OUTPUT</span>
        {#if !nativePreview}
          <span class="frame-note">The live output appears here when the native renderer is running.</span>
        {/if}
      </div>

      <section class="module scenes">
        <div class="head">
          <h2>SCENES</h2>
          <span class="hint">Beat, loop and visuals change together, on the bar</span>
          <button class="text-btn small" onclick={captureCurrentScene} title="Save what is playing now as a scene">+ CAPTURE</button>
        </div>
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
      </section>
    </div>

    <!-- Right rack -->
    <div class="rack right">
      <section class="module">
        <div class="head">
          <h2>MACROS</h2>
          <span class="hint">Sound and picture</span>
        </div>
        <div class="body macro-grid">
          {#each $macros.macros as m (m.id)}
            <div class="macro">
              <StudioKnob label={m.name} value={m.value} size={40} format={(v) => `${Math.round(v * 100)}%`} onchange={(v) => macros.setMacroValue(m.id, v)} midiPath="vj:macro:{m.id.replace('macro-', '')}:value" />
              <span class="muted small">{macroDetail(m.effects.length)}</span>
            </div>
          {/each}
        </div>
      </section>

      <section class="module grow">
        <div class="head">
          <span class="led rec" class:on={s.recording}></span>
          <h2>TAKES</h2>
          <button class="text-btn small" class:armed={s.recording} onclick={toggleRecord}>{s.recording ? `STOP ${seconds(elapsed)}` : 'REC'}</button>
        </div>
        <div class="body scroll">
          <TakeList />
        </div>
      </section>
    </div>

    <!-- Bottom: beat and the playing surface -->
    <section class="module beat">
      <div class="head">
        <span class="led" class:on={s.sequencerPlaying}></span>
        <h2>BEAT</h2>
        <select value={s.pattern.steps} onchange={(e) => musicStudio.setPatternLength(+(e.target as HTMLSelectElement).value as PatternLength)} aria-label="Steps">
          {#each PATTERN_LENGTHS as n}<option value={n}>{n} steps</option>{/each}
        </select>
        <span class="hint grow">Runs on the VJ clock</span>
        <StudioKnob label="Swing" value={s.pattern.swing} max={0.5} size={26} format={(v) => `${Math.round(v * 200)}%`} onchange={(v) => musicStudio.setSwing(v)} />
        <button class="text-btn small" onclick={() => musicStudio.clearPattern()}>CLEAR</button>
      </div>
      <div class="body">
        <StepGrid rowHeight={16} />
      </div>
    </section>

    <section class="module play">
      <div class="head">
        <h2>{s.instrument === 'drums' || wideKeys ? 'PADS' : 'KEYS'}</h2>
        {#if s.instrument !== 'drums'}
          <div class="seg small" role="group" aria-label="Keyboard size">
            {#each KEYBOARD_SIZES as size}
              <button class:on={s.keyboardSize === size.id} onclick={() => musicStudio.setKeyboardSize(size.id)} title={size.title}>{size.label}</button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="body fill">
        {#if s.instrument === 'drums' || wideKeys}
          <DrumPads />
        {:else}
          <PianoKeys low={range.low} high={range.high} />
        {/if}
      </div>
    </section>

    {#if wideKeys}
      <section class="module keys-wide">
        <div class="body fill">
          <PianoKeys low={range.low} high={range.high} />
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  /* VJ mode stays mounted under the Studio view (its preview sync keeps
     running) but hides, so only the output shows through the frame. */
  :global(.vj-overlay.studio-view-open > :not(.studio-view)) {
    visibility: hidden;
  }

  .studio-view {
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
    --mk-white: var(--studio-white-key);
    --mk-black: var(--studio-black-key);

    position: fixed;
    inset: 0;
    z-index: 60;
    display: grid;
    grid-template-columns: 340px minmax(0, 1fr) 340px;
    grid-template-rows: 52px minmax(0, 1fr) 214px;
    gap: 12px;
    padding: 0 14px 14px;
    box-sizing: border-box;
    color: var(--studio-ink);
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-size: 12px;
    user-select: none;
  }
  .studio-view:has(.keys-wide) { grid-template-rows: 52px minmax(0, 1fr) 190px 132px; }

  .skin-bath {
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
    --studio-white-key: #e8e1cf;
    --studio-black-key: #1a1815;
    --studio-radius: 4px;
    --studio-cheek: repeating-linear-gradient(176deg, #4a2c19 0px, #5a361f 3px, #3d2414 7px, #533220 11px);
  }
  .skin-berlin {
    --studio-ground: #050505;
    --studio-panel: #0d0d0d;
    --studio-edge: #3a3a3a;
    --studio-edge-soft: #262626;
    --studio-slot: #000000;
    --studio-cell: #161616;
    --studio-ink: #f2f2f2;
    --studio-muted: #9e9e9e;
    --studio-accent: #f2f2f2;
    --studio-accent-soft: rgba(242, 242, 242, 0.1);
    --studio-on-accent: #000000;
    --studio-knob-face: #1c1c1c;
    --studio-knob-edge: #5a5a5a;
    --studio-white-key: #f2f2f2;
    --studio-black-key: #111111;
    --studio-radius: 0px;
    --studio-cheek: #050505;
  }

  /* The output frame lets the native preview show through; its shadow paints the ground everywhere else. */
  .frame {
    position: relative;
    z-index: 0;
    flex: 1;
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

  .bar, .rack, .centre > .module, .beat, .play, .keys-wide { position: relative; z-index: 1; }

  /* ── Top bar ── */
  .bar {
    grid-column: 1 / -1;
    margin: 0 -14px;
    padding: 0 18px;
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
  .scene-status { flex: 1; text-align: center; color: var(--studio-muted); font-size: 13px; overflow: hidden; text-overflow: ellipsis; }
  .scene-status strong { color: var(--studio-ink); }

  /* ── Racks and modules ── */
  .rack { display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .rack.left::before, .rack.right::after {
    content: '';
    position: absolute;
    top: 0;
    bottom: -226px;
    width: 6px;
    background: var(--studio-cheek);
  }
  .rack.left::before { left: -12px; }
  .rack.right::after { right: -12px; }
  .centre { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; }
  .module {
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--studio-panel);
    border: 1px solid var(--studio-edge-soft);
    border-radius: var(--studio-radius);
  }
  .module.grow { flex: 1; }
  .head {
    flex: 0 0 auto;
    height: 34px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    border-bottom: 1px solid var(--studio-edge-soft);
  }
  h2 { margin: 0; font-size: 12px; font-weight: 800; letter-spacing: 0.16em; margin-right: auto; }
  .head .seg, .head .text-btn { margin-left: auto; }
  .head h2 + .seg { margin-left: 0; }
  .hint { color: var(--studio-muted); }
  .hint.grow { flex: 1; }
  .led { width: 8px; height: 8px; border-radius: 50%; background: var(--studio-edge); flex: 0 0 auto; }
  .led.on { background: var(--studio-accent); box-shadow: 0 0 8px var(--studio-accent); }
  .led.rec.on { background: #c9503c; box-shadow: 0 0 8px #c9503c; }
  .body { padding: 12px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
  .body.fill { flex: 1; padding: 10px 12px 12px; }
  .body.scroll { overflow: auto; flex: 1; padding-top: 4px; }
  .knobs { display: flex; justify-content: space-around; padding: 4px 0; }
  .muted { color: var(--studio-muted); }
  .small { font-size: 10px; }
  .empty { margin: 4px 0; color: var(--studio-muted); grid-column: 1 / -1; line-height: 1.5; }

  .field { display: flex; align-items: center; gap: 10px; }
  .field > span { width: 46px; color: var(--studio-muted); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; font-size: 10px; }
  .field select { flex: 1; }
  .field-row { display: flex; align-items: center; justify-content: space-between; }
  select {
    height: 26px;
    border: 1px solid var(--studio-edge);
    background: var(--studio-slot);
    color: var(--studio-ink);
    border-radius: var(--studio-radius);
    font: inherit;
    font-size: 12px;
  }
  .check { display: inline-flex; align-items: center; gap: 6px; color: var(--studio-muted); }
  .check input { accent-color: var(--studio-accent); }
  .stepper { display: inline-flex; align-items: center; gap: 4px; }
  .stepper span { min-width: 30px; text-align: center; font-family: var(--ga-font-mono, ui-monospace); }
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
    height: 26px;
    padding: 0 10px;
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
  .text-btn.armed { border-color: #c9503c; color: #e8806e; }
  .link {
    padding: 2px 4px;
    border: 0;
    background: transparent;
    color: var(--studio-ink);
    font: inherit;
    text-decoration: underline;
    text-decoration-color: var(--studio-edge);
    text-underline-offset: 3px;
    cursor: pointer;
  }
  .link:hover { text-decoration-color: var(--studio-accent); }
  .shader-list { display: flex; flex-wrap: wrap; align-items: center; gap: 2px 6px; padding-top: 8px; border-top: 1px solid var(--studio-edge-soft); }

  .macro-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px 4px; }
  .macro { display: flex; flex-direction: column; align-items: center; gap: 2px; }

  /* ── Scenes ── */
  .scenes { flex: 0 0 auto; max-height: 40%; }
  .scene-grid {
    display: grid;
    grid-template-columns: minmax(130px, 1.2fr) repeat(3, minmax(0, 1fr)) 26px;
    gap: 6px;
    padding: 10px 12px 12px;
    overflow: auto;
    align-items: center;
  }
  .col { font-size: 10px; font-weight: 800; letter-spacing: 0.14em; color: var(--studio-muted); }
  .launch {
    height: 38px;
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
    height: 32px;
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
    height: 38px;
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

  /* ── Bottom ── */
  .beat { grid-column: 1 / 3; }
  .beat .body { overflow: auto; padding-top: 8px; }
  .play { grid-column: 3; }
  .keys-wide { grid-column: 1 / -1; background: var(--studio-panel); border: 1px solid var(--studio-edge-soft); border-radius: var(--studio-radius); display: flex; }
</style>
