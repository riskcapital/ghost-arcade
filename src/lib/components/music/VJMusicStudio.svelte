<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { showToast } from '../../stores/errorToast';
  import { INSTRUMENTS, noteName } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from '../../music/instruments';
  import { KEYBOARD_SIZES, keyboardRange, octaveBaseNote } from '../../music/keyboardLayout';
  import { PATTERN_LENGTHS, type PatternLength } from '../../music/drumPattern';
  import { NOTE_SHADERS, addNoteShaderToDeck } from '../../music/noteShaders';
  import { musicStudio } from '../../music/musicStudioStore';
  import { musicMidiDevices, musicMidiStatus } from '../../music/midiNotes';
  import {
    ensureMusicRuntime,
    panic,
    recordingElapsed,
    startRecording,
    startSequencer,
    stopRecording,
    stopSequencer,
  } from '../../music/musicRuntime';
  import PianoKeys from './PianoKeys.svelte';
  import DrumPads from './DrumPads.svelte';
  import StepGrid from './StepGrid.svelte';
  import TakeList from './TakeList.svelte';

  let minimized = false;
  let elapsed = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  $: s = $musicStudio;
  $: base = octaveBaseNote(s.octave);
  $: range = keyboardRange(s.keyboardSize, s.octave);
  // Four octaves and the full piano take the whole width of the panel.
  $: pianoWide = s.instrument !== 'drums' && s.keyboardSize !== 'compact';
  $: visual = s.visuals[s.instrument];
  $: stepCell = s.pattern.steps > 16 ? 16 : 22;

  $: if (s.recording && !elapsedTimer) {
    elapsedTimer = setInterval(() => { elapsed = recordingElapsed(); }, 200);
  } else if (!s.recording && elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
    elapsed = 0;
  }

  onMount(() => {
    ensureMusicRuntime();
  });

  onDestroy(() => {
    if (elapsedTimer) clearInterval(elapsedTimer);
    // Leaving VJ mode closes the studio, which stops it and frees the letter keys.
    musicStudio.close();
  });

  function toggleBeat() {
    if (s.sequencerPlaying) stopSequencer();
    else startSequencer();
  }

  function toggleRecord() {
    if (s.recording) {
      const take = stopRecording();
      if (!take) showToast('Nothing was played, so no take was kept.', 'info');
    } else {
      startRecording();
    }
  }

  function formatSeconds(sec: number): string {
    const m = Math.floor(sec / 60);
    const r = Math.floor(sec % 60);
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function onPatchChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value;
    if (s.instrument === 'synth') musicStudio.setSynthPatch(value as SynthPatch);
    else if (s.instrument === 'keys') musicStudio.setKeysPatch(value as KeysPatch);
  }
</script>

{#if s.isOpen && !s.studioView}
  <div class="music-tray" class:minimized data-help-page="clip-launcher">
    <div class="music-head">
      <span class="music-title">MUSIC</span>

      <div class="seg" role="group" aria-label="Instrument">
        {#each INSTRUMENTS as id}
          <button class:on={s.instrument === id} onclick={() => musicStudio.setInstrument(id)}>{INSTRUMENT_LABELS[id]}</button>
        {/each}
      </div>
      {#if s.instrument !== 'drums'}
        <select value={s.instrument === 'synth' ? s.synthPatch : s.keysPatch} onchange={onPatchChange} title="Sound">
          {#each s.instrument === 'synth' ? SYNTH_PATCHES : KEYS_PATCHES as patch}
            <option value={patch.id}>{patch.label}</option>
          {/each}
        </select>
      {/if}
      <label class="inline" title="{INSTRUMENT_LABELS[s.instrument]} volume">
        Vol
        <input type="range" min="0" max="1" step="0.01" value={s.volumes[s.instrument]}
          oninput={(e) => musicStudio.setVolume(s.instrument, +(e.target as HTMLInputElement).value)} />
      </label>

      <span class="divider"></span>

      <button class="tool" class:on={s.sequencerPlaying} onclick={toggleBeat} title={s.sequencerPlaying ? 'Stop the beat' : 'Play the beat on the VJ clock'}>
        {#if s.sequencerPlaying}
          <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
        {:else}
          <svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>
        {/if}
        Beat
      </button>
      <button class="tool rec" class:on={s.recording} onclick={toggleRecord} title={s.recording ? 'Stop recording and keep the take' : 'Record a take'}>
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6"/></svg>
        {s.recording ? formatSeconds(elapsed) : 'Rec'}
      </button>

      <span class="spacer"></span>

      <label class="inline check" title="Play with the computer keyboard: A–' are the keys, Z X shift octave, C V set velocity">
        <input type="checkbox" checked={s.keysArmed} onchange={() => musicStudio.setKeysArmed(!s.keysArmed)} />
        Letter keys
      </label>
      <label class="inline" title="Velocity for keys and pads (C / V)">
        Vel
        <input type="range" min="0.05" max="1" step="0.05" value={s.velocity}
          oninput={(e) => musicStudio.setVelocity(+(e.target as HTMLInputElement).value)} />
      </label>
      <select value={s.midiInput} onchange={(e) => musicStudio.setMidiInput((e.target as HTMLSelectElement).value)} title="MIDI input. Channel 10 always plays the drums.">
        <option value="">{$musicMidiStatus === 'unavailable' ? 'MIDI unavailable' : $musicMidiDevices.length ? 'All MIDI inputs' : 'No MIDI device'}</option>
        {#each $musicMidiDevices as device (device.id)}
          <option value={device.id}>{device.name}</option>
        {/each}
      </select>
      <button class="tool" onclick={() => musicStudio.setStudioView(true)} title="Open the full-screen Studio view">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="1.5"/><rect x="8" y="8" width="8" height="6"/></svg>
        Studio
      </button>
      <button class="icon" onclick={panic} title="Stop every sounding note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 4v8M7 7a7 7 0 1 0 10 0"/></svg>
      </button>
      <button class="icon" onclick={() => (minimized = !minimized)} title={minimized ? 'Expand' : 'Minimize'} aria-label={minimized ? 'Expand music studio' : 'Minimize music studio'}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          {#if minimized}<path d="M6 15l6-6 6 6"/>{:else}<path d="M6 9l6 6 6-6"/>{/if}
        </svg>
      </button>
      <button class="icon" onclick={() => musicStudio.close()} title="Close the music studio" aria-label="Close music studio">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>

    {#if !minimized}
      <div class="music-body" class:wide={pianoWide}>
        <section class="play">
          {#if s.instrument !== 'drums'}
            <div class="row-head">
              <span class="label">Keys</span>
              <div class="stepper" title="Octave of the letter keys (Z / X)">
                <button onclick={() => musicStudio.shiftOctave(-1)} aria-label="Octave down">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6"/></svg>
                </button>
                <span>{noteName(base)}</span>
                <button onclick={() => musicStudio.shiftOctave(1)} aria-label="Octave up">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg>
                </button>
              </div>
              <div class="seg small" role="group" aria-label="Keyboard size">
                {#each KEYBOARD_SIZES as size}
                  <button class:on={s.keyboardSize === size.id} onclick={() => musicStudio.setKeyboardSize(size.id)} title={size.title}>{size.label}</button>
                {/each}
              </div>
            </div>
          {/if}
          {#if s.instrument === 'drums'}
            <DrumPads />
          {:else}
            <PianoKeys low={range.low} high={range.high} />
          {/if}
        </section>

        <section class="beat">
          <div class="row-head">
            <span class="label">Beat</span>
            <select value={s.pattern.steps} onchange={(e) => musicStudio.setPatternLength(+(e.target as HTMLSelectElement).value as PatternLength)} title="Steps">
              {#each PATTERN_LENGTHS as n}<option value={n}>{n} steps</option>{/each}
            </select>
            <label class="inline" title="Swing">
              Swing
              <input type="range" min="0" max="0.5" step="0.01" value={s.pattern.swing}
                oninput={(e) => musicStudio.setSwing(+(e.target as HTMLInputElement).value)} />
            </label>
            <button class="text" onclick={() => musicStudio.clearPattern()} title="Clear the pattern">Clear</button>
          </div>
          <StepGrid cell={stepCell} />
        </section>

        <section class="side">
          <div class="row-head">
            <span class="label">{INSTRUMENT_LABELS[s.instrument]} visuals</span>
            <div class="seg small" role="group" aria-label="Visual behaviour">
              <button class:on={visual.mode === 'fade'} onclick={() => musicStudio.setVisualMode(s.instrument, 'fade')} title="Visuals linger, then fade away">Fade</button>
              <button class:on={visual.mode === 'build'} onclick={() => musicStudio.setVisualMode(s.instrument, 'build')} title="Visuals keep building while you play">Build</button>
            </div>
          </div>
          <div class="row">
            {#if visual.mode === 'fade'}
              <label class="inline grow" title="How long a note's visual takes to fade after release">
                Fade
                <input type="range" min="0.05" max="6" step="0.05" value={visual.release}
                  oninput={(e) => musicStudio.setVisual(s.instrument, { release: +(e.target as HTMLInputElement).value })} />
                <span class="value">{visual.release.toFixed(1)}s</span>
              </label>
            {:else}
              <label class="inline grow" title="How long a note's visual lingers after release">
                Linger
                <input type="range" min="1" max="40" step="0.5" value={visual.linger}
                  oninput={(e) => musicStudio.setVisual(s.instrument, { linger: +(e.target as HTMLInputElement).value })} />
                <span class="value">{Math.round(visual.linger)}s</span>
              </label>
            {/if}
          </div>
          <div class="row shaders">
            <span class="hint">Add to deck</span>
            {#each NOTE_SHADERS as shader}
              <button class="text" onclick={() => addNoteShaderToDeck(shader.file, shader.name)}>{shader.name}</button>
            {/each}
          </div>

          <div class="row-head takes-head">
            <span class="label">Takes</span>
          </div>
          <TakeList />
        </section>
      </div>
    {/if}
  </div>
{/if}

<style>
  .music-tray {
    flex: 0 0 258px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-top: 1px solid var(--ga-coral-line, rgba(255, 111, 94, .4));
    background: var(--ga-panel, #0b0d11);
    color: var(--ga-ink-0, #eef0f4);
    font-size: 12px;
    user-select: none;
  }
  .music-tray.minimized { flex: 0 0 auto; }
  .music-tray:has(.music-body.wide) { flex-basis: 400px; }

  .music-head {
    height: 40px;
    padding: 6px 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    border-bottom: 1px solid var(--ga-line, rgba(255,255,255,.07));
    white-space: nowrap;
  }
  .music-title {
    color: var(--ga-coral, #ff6f5e);
    font-size: 12px;
    font-weight: 800;
    letter-spacing: .08em;
    margin-right: 4px;
  }
  .spacer { flex: 1; }
  .divider { width: 1px; height: 18px; background: var(--ga-line-2, rgba(255,255,255,.12)); }

  select {
    height: 24px;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: var(--ga-slot, #050607);
    color: var(--ga-ink-0, #eef0f4);
    border-radius: var(--ga-r-hard, 2px);
    font: inherit;
    font-size: 12px;
  }
  input[type="range"] { width: 72px; accent-color: var(--ga-coral, #ff6f5e); }
  .inline { display: inline-flex; align-items: center; gap: 6px; color: var(--ga-ink-1, #9aa0ac); }
  .inline.grow { flex: 1; }
  .inline.grow input { flex: 1; width: auto; }
  .check input { width: 12px; height: 12px; accent-color: var(--ga-coral, #ff6f5e); }
  .value { min-width: 32px; text-align: right; font-family: var(--ga-font-mono, ui-monospace); color: var(--ga-ink-1, #9aa0ac); }

  button { font: inherit; cursor: pointer; }
  .seg { display: inline-flex; border: 1px solid var(--ga-line-2, rgba(255,255,255,.12)); border-radius: var(--ga-r-hard, 2px); }
  .seg button {
    height: 22px;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: var(--ga-ink-1, #9aa0ac);
    font-weight: 700;
  }
  .seg button + button { border-left: 1px solid var(--ga-line-2, rgba(255,255,255,.12)); }
  .seg button.on { background: var(--ga-coral-soft, rgba(255,111,94,.11)); color: var(--ga-coral, #ff6f5e); }
  .seg.small button { height: 20px; padding: 0 8px; }

  .tool {
    height: 24px;
    padding: 0 9px 0 7px;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: var(--ga-slot, #050607);
    color: var(--ga-ink-1, #9aa0ac);
    border-radius: var(--ga-r-hard, 2px);
    font-weight: 700;
  }
  .tool svg { width: 12px; height: 12px; fill: currentColor; }
  .tool.on { border-color: var(--ga-coral, #ff6f5e); background: var(--ga-coral-soft, rgba(255,111,94,.11)); color: var(--ga-coral, #ff6f5e); }
  .tool.rec svg { fill: var(--ga-coral, #ff6f5e); }
  .tool.rec.on { font-family: var(--ga-font-mono, ui-monospace); }

  .stepper { display: inline-flex; align-items: center; gap: 2px; }
  .stepper svg { width: 13px; height: 13px; }
  .stepper span { min-width: 30px; text-align: center; font-family: var(--ga-font-mono, ui-monospace); color: var(--ga-ink-0, #eef0f4); }
  .stepper button, .icon {
    width: 24px;
    height: 24px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: transparent;
    color: var(--ga-ink-1, #9aa0ac);
    border-radius: var(--ga-r-hard, 2px);
  }
  .icon svg { width: 13px; height: 13px; fill: currentColor; }
  .icon svg[fill="none"] { fill: none; }
  .stepper button:hover, .icon:hover { color: var(--ga-ink-0, #eef0f4); border-color: var(--ga-coral-line, rgba(255,111,94,.4)); }
  .icon.on { color: var(--ga-coral, #ff6f5e); border-color: var(--ga-coral, #ff6f5e); }
  .text {
    height: 22px;
    padding: 0 6px;
    border: 0;
    background: transparent;
    color: var(--ga-ink-1, #9aa0ac);
    text-decoration: underline;
    text-decoration-color: var(--ga-line-2, rgba(255,255,255,.12));
    text-underline-offset: 3px;
  }
  .text:hover { color: var(--ga-ink-0, #eef0f4); text-decoration-color: currentColor; }

  .music-body {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(300px, 1.1fr) auto minmax(280px, 1fr);
  }
  .music-body > section {
    min-width: 0;
    min-height: 0;
    padding: 10px 12px;
    overflow: auto;
  }
  .music-body > section + section { border-left: 1px solid var(--ga-line, rgba(255,255,255,.07)); }
  /* Wide keyboards get their own row across the panel, beat and visuals below. */
  .music-body.wide { grid-template-columns: auto minmax(280px, 1fr); grid-template-rows: 150px minmax(0, 1fr); }
  .music-body.wide > .play { grid-column: 1 / -1; display: flex; flex-direction: column; border-bottom: 1px solid var(--ga-line, rgba(255,255,255,.07)); }
  .music-body.wide > .play + section { border-left: 0; }
  .play { display: flex; flex-direction: column; }

  .label { color: var(--ga-ink-2, #5e6571); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .row-head { display: flex; align-items: center; gap: 10px; height: 24px; margin-bottom: 8px; }
  .row-head .label { margin-right: auto; }
  .row { display: flex; align-items: center; gap: 8px; min-height: 28px; }
  .hint { color: var(--ga-ink-2, #5e6571); margin-right: 2px; }
  .shaders { flex-wrap: wrap; gap: 2px 4px; padding: 4px 0 8px; border-bottom: 1px solid var(--ga-line, rgba(255,255,255,.07)); }
  .takes-head { margin-top: 8px; }
</style>
