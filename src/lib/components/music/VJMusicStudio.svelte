<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { vjClipLauncher, type VJDeck } from '../../stores/vjClipLauncher';
  import { generateUUID } from '../../utils/uuid';
  import { showToast } from '../../stores/errorToast';
  import {
    DRUM_LABELS,
    DRUM_NOTES,
    DRUM_VOICES,
    INSTRUMENTS,
    isBlackKey,
    noteName,
    type DrumVoice,
    type InstrumentId,
  } from '../../music/noteEvents';
  import { INSTRUMENT_LABELS, KEYS_PATCHES, SYNTH_PATCHES, type KeysPatch, type SynthPatch } from '../../music/instruments';
  import { DRUM_PAD_KEYS, PIANO_KEY_LABELS, keyForNote, octaveBaseNote } from '../../music/keyboardLayout';
  import { PATTERN_LENGTHS, type PatternLength } from '../../music/drumPattern';
  import { takeNoteCount } from '../../music/recording';
  import { musicStudio, musicTransport } from '../../music/musicStudioStore';
  import { musicMidiDevices, musicMidiStatus } from '../../music/midiNotes';
  import {
    ensureMusicRuntime,
    hitDrum,
    panic,
    playTake,
    recordingElapsed,
    screenNoteOff,
    screenNoteOn,
    startRecording,
    startSequencer,
    stopRecording,
    stopSequencer,
    stopTake,
  } from '../../music/musicRuntime';

  /** The note-reactive shaders the studio offers to put on a deck. */
  const NOTE_SHADERS = [
    { file: 'NR-NoteBloom.fs', name: 'Note Bloom' },
    { file: 'NR-ChordRings.fs', name: 'Chord Rings' },
    { file: 'NR-NoteInk.fs', name: 'Note Ink' },
    { file: 'NR-BeatGrid.fs', name: 'Beat Grid' },
  ];

  /** Two octaves of on-screen keys from the keyboard's octave. */
  const KEY_SPAN = 25;

  let minimized = false;
  let elapsed = 0;
  let elapsedTimer: ReturnType<typeof setInterval> | null = null;

  $: s = $musicStudio;
  $: transport = $musicTransport;
  $: base = octaveBaseNote(s.octave);
  $: pianoNotes = Array.from({ length: KEY_SPAN }, (_, i) => base + i).filter((n) => n <= 127);
  $: whiteNotes = pianoNotes.filter((n) => !isBlackKey(n));
  $: visual = s.visuals[s.instrument];
  $: steps = Array.from({ length: s.pattern.steps }, (_, i) => i);
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
  });

  function held(instrument: InstrumentId, note: number): boolean {
    return transport.held.has(`${instrument}:${note}`);
  }

  /** Left offset of a black key, between the white keys either side. */
  function blackKeyLeft(note: number): number {
    const whitesBefore = whiteNotes.filter((n) => n < note).length;
    return (whitesBefore / whiteNotes.length) * 100;
  }

  function keyLabel(note: number): string {
    const code = keyForNote(note, s.octave);
    return code ? PIANO_KEY_LABELS[code] : '';
  }

  // ── On-screen keys: press, slide across, let go ──
  function noteUnder(e: PointerEvent): number | null {
    const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    const n = el?.closest<HTMLElement>('[data-note]')?.dataset.note;
    return n === undefined ? null : Number(n);
  }

  const pressed = new Map<number, number>();

  function onKeysDown(e: PointerEvent) {
    const note = noteUnder(e);
    if (note === null) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    pressed.set(e.pointerId, note);
    screenNoteOn(e.pointerId, note);
  }

  function onKeysMove(e: PointerEvent) {
    if (!pressed.has(e.pointerId)) return;
    const note = noteUnder(e);
    if (note === null || note === pressed.get(e.pointerId)) return;
    pressed.set(e.pointerId, note);
    screenNoteOn(e.pointerId, note);
  }

  function onKeysUp(e: PointerEvent) {
    if (!pressed.has(e.pointerId)) return;
    pressed.delete(e.pointerId);
    screenNoteOff(e.pointerId);
  }

  function onPad(e: PointerEvent, voice: DrumVoice) {
    e.preventDefault();
    hitDrum(voice, s.velocity);
  }

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

  function toggleTake(id: string, loop: boolean) {
    if (s.playingTakeId === id && s.loopTake === loop) stopTake();
    else playTake(id, loop);
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

  function onRename(id: string, e: Event) {
    musicStudio.renameTake(id, (e.target as HTMLInputElement).value);
  }

  /** Put a note shader in the next free slot of the selected layer and play it. */
  async function addShaderToDeck(file: string, name: string) {
    const launcher = $vjClipLauncher;
    const deck: VJDeck = launcher.crossfaderEnabled ? launcher.selectedDeck : 'A';
    const grid = deck === 'B' ? launcher.bankBClipGrid : launcher.clipGrid;
    const first = launcher.selectedLayerIndex ?? 0;
    const order = [first, ...grid.map((_, i) => i).filter((i) => i !== first)];
    let target: { layer: number; column: number } | null = null;
    for (const layer of order) {
      const column = grid[layer]?.findIndex((c) => !c) ?? -1;
      if (column >= 0) { target = { layer, column }; break; }
    }
    if (!target) {
      showToast('No empty VJ deck slot available.', 'warning');
      return;
    }
    try {
      const response = await fetch(`./ISF/${encodeURIComponent(file)}`);
      if (!response.ok) throw new Error(String(response.status));
      const shaderCode = await response.text();
      vjClipLauncher.setClip(target.layer, target.column, {
        id: generateUUID(),
        type: 'shader',
        name,
        src: `ISF/${file}`,
        shaderCode,
        shaderValues: {},
      }, deck);
      vjClipLauncher.triggerClipNow(target.layer, target.column, deck);
    } catch (err) {
      console.warn('[Music] could not load', file, err);
      showToast(`Could not load ${name}.`, 'error');
    }
  }
</script>

{#if s.isOpen}
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
      <div class="stepper" title="Octave (Z / X)">
        <button onclick={() => musicStudio.shiftOctave(-1)} aria-label="Octave down">−</button>
        <span>{noteName(base)}</span>
        <button onclick={() => musicStudio.shiftOctave(1)} aria-label="Octave up">+</button>
      </div>
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
      <div class="music-body">
        <section class="play">
          {#if s.instrument === 'drums'}
            <div class="pads">
              {#each DRUM_VOICES as voice, i}
                <button class="pad" class:lit={held('drums', DRUM_NOTES[voice])} onpointerdown={(e) => onPad(e, voice)}>
                  <span>{DRUM_LABELS[voice]}</span>
                  <kbd>{PIANO_KEY_LABELS[DRUM_PAD_KEYS[i]]}</kbd>
                </button>
              {/each}
            </div>
          {:else}
            <div class="piano" role="group" aria-label="On-screen keys"
              onpointerdown={onKeysDown} onpointermove={onKeysMove} onpointerup={onKeysUp} onpointercancel={onKeysUp}>
              {#each whiteNotes as note (note)}
                <div class="white" class:lit={held(s.instrument, note)} data-note={note}>
                  <kbd>{keyLabel(note)}</kbd>
                  {#if note % 12 === 0}<span class="c">{noteName(note)}</span>{/if}
                </div>
              {/each}
              {#each pianoNotes.filter(isBlackKey) as note (note)}
                <div class="black" class:lit={held(s.instrument, note)} data-note={note}
                  style="left: calc({blackKeyLeft(note)}% - var(--black-w) / 2)">
                  <kbd>{keyLabel(note)}</kbd>
                </div>
              {/each}
            </div>
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
          <div class="steps" style="grid-template-columns: 64px repeat({s.pattern.steps}, {stepCell}px);">
            {#each DRUM_VOICES as voice}
              <button class="voice" class:lit={held('drums', DRUM_NOTES[voice])} onpointerdown={(e) => onPad(e, voice)} title="Play {DRUM_LABELS[voice]}">{DRUM_LABELS[voice]}</button>
              {#each steps as step}
                <button
                  class="step"
                  class:on={s.pattern.tracks[voice][step] > 0}
                  class:bar={step % 4 === 0}
                  class:playhead={step === transport.step}
                  onclick={() => musicStudio.toggleStep(voice, step)}
                  aria-label="{DRUM_LABELS[voice]} step {step + 1}"
                ></button>
              {/each}
            {/each}
          </div>
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
              <button class="text" onclick={() => addShaderToDeck(shader.file, shader.name)}>{shader.name}</button>
            {/each}
          </div>

          <div class="row-head takes-head">
            <span class="label">Takes</span>
          </div>
          <div class="takes">
            {#each s.takes as take (take.id)}
              <div class="take" class:playing={s.playingTakeId === take.id}>
                <input class="name" value={take.name} onchange={(e) => onRename(take.id, e)} aria-label="Take name" />
                <span class="meta">{formatSeconds(take.length)} · {takeNoteCount(take)} notes</span>
                {#if s.playingTakeId === take.id}
                  <span class="progress"><span style="width: {transport.takeProgress * 100}%"></span></span>
                {/if}
                <button class="icon" class:on={s.playingTakeId === take.id && !s.loopTake} onclick={() => toggleTake(take.id, false)} title={s.playingTakeId === take.id && !s.loopTake ? 'Stop' : 'Play'}>
                  {#if s.playingTakeId === take.id && !s.loopTake}
                    <svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
                  {:else}
                    <svg viewBox="0 0 24 24"><path d="M8 5l11 7-11 7z"/></svg>
                  {/if}
                </button>
                <button class="icon" class:on={s.playingTakeId === take.id && s.loopTake} onclick={() => toggleTake(take.id, true)} title={s.playingTakeId === take.id && s.loopTake ? 'Stop looping' : 'Loop'}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>
                </button>
                {#if take.pattern}
                  <button class="icon" onclick={() => take.pattern && musicStudio.setPattern(take.pattern)} title="Load this take's beat into the pattern">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg>
                  </button>
                {/if}
                <button class="icon" onclick={() => musicStudio.removeTake(take.id)} title="Delete take">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 7h16M9 7V5h6v2M8 10v8M16 10v8"/></svg>
                </button>
              </div>
            {:else}
              <p class="empty">Press Rec, play, then Rec again. Takes save with the project.</p>
            {/each}
          </div>
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

  select, .name {
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

  .label { color: var(--ga-ink-2, #5e6571); font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .row-head { display: flex; align-items: center; gap: 10px; height: 24px; margin-bottom: 8px; }
  .row-head .label { margin-right: auto; }
  .row { display: flex; align-items: center; gap: 8px; min-height: 28px; }
  .hint { color: var(--ga-ink-2, #5e6571); margin-right: 2px; }
  .shaders { flex-wrap: wrap; gap: 2px 4px; padding: 4px 0 8px; border-bottom: 1px solid var(--ga-line, rgba(255,255,255,.07)); }
  .takes-head { margin-top: 8px; }

  /* ── On-screen keys ── */
  .piano {
    --black-w: 4.2%;
    position: relative;
    height: 100%;
    min-height: 120px;
    display: flex;
    touch-action: none;
  }
  .white {
    flex: 1;
    position: relative;
    margin-right: 2px;
    border-radius: 0 0 3px 3px;
    background: #d9dce2;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: center;
    padding-bottom: 6px;
    gap: 2px;
  }
  /* Pressed white keys darken toward the accent; the accent can be near white. */
  .white.lit { background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 45%, #2a313c); }
  .black {
    position: absolute;
    top: 0;
    width: var(--black-w);
    height: 60%;
    border-radius: 0 0 3px 3px;
    background: #15181e;
    border: 1px solid #000;
    display: flex;
    justify-content: center;
    align-items: flex-end;
    padding-bottom: 5px;
    z-index: 1;
  }
  .black.lit { background: var(--ga-coral, #ff6f5e); border-color: var(--ga-coral, #ff6f5e); }
  .piano kbd, .pad kbd {
    font-family: inherit;
    font-size: 10px;
    font-weight: 700;
    pointer-events: none;
  }
  .white kbd { color: #5e6571; }
  .black kbd { color: #9aa0ac; }
  .white .c { color: #8a909c; font-size: 9px; pointer-events: none; }
  .white.lit kbd, .white.lit .c { color: #fff; }
  .black.lit kbd { color: var(--ga-panel, #0b0d11); }

  .pads { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; height: 100%; min-height: 120px; }
  .pad {
    border: 1px solid var(--ga-line-2, rgba(255,255,255,.12));
    background: var(--ga-slot, #050607);
    color: var(--ga-ink-0, #eef0f4);
    border-radius: var(--ga-r-hard, 2px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    touch-action: none;
  }
  .pad kbd { color: var(--ga-ink-2, #5e6571); }
  .pad.lit { background: var(--ga-coral, #ff6f5e); border-color: var(--ga-coral, #ff6f5e); color: var(--ga-panel, #0b0d11); }
  .pad.lit kbd { color: var(--ga-panel, #0b0d11); }

  /* ── Step grid ── */
  .steps { display: grid; gap: 2px; width: max-content; }
  .voice {
    height: 18px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--ga-ink-1, #9aa0ac);
    text-align: left;
    font-weight: 700;
    font-size: 11px;
  }
  .voice.lit { color: var(--ga-coral, #ff6f5e); }
  .step {
    height: 18px;
    padding: 0;
    border: 1px solid var(--ga-line, rgba(255,255,255,.07));
    background: var(--ga-card, #13161c);
    border-radius: var(--ga-r-hard, 2px);
  }
  .step.bar { border-color: var(--ga-line-2, rgba(255,255,255,.12)); }
  .step:hover { border-color: var(--ga-coral-line, rgba(255,111,94,.4)); }
  .step.on { background: var(--ga-coral, #ff6f5e); border-color: var(--ga-coral, #ff6f5e); }
  .step.playhead { box-shadow: inset 0 0 0 1px var(--ga-ink-0, #eef0f4); }

  /* ── Takes ── */
  .takes { display: flex; flex-direction: column; }
  .take {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    border-bottom: 1px solid var(--ga-line, rgba(255,255,255,.07));
  }
  .take .name { width: 96px; padding: 0 6px; background: transparent; border-color: transparent; }
  .take .name:hover, .take .name:focus { border-color: var(--ga-line-2, rgba(255,255,255,.12)); }
  .take .meta { color: var(--ga-ink-2, #5e6571); font-family: var(--ga-font-mono, ui-monospace); margin-right: auto; font-size: 11px; }
  .take.playing .name { color: var(--ga-coral, #ff6f5e); }
  .progress { width: 48px; height: 2px; background: var(--ga-line-2, rgba(255,255,255,.12)); }
  .progress span { display: block; height: 100%; background: var(--ga-coral, #ff6f5e); }
  .empty { margin: 6px 0; color: var(--ga-ink-2, #5e6571); }
</style>
