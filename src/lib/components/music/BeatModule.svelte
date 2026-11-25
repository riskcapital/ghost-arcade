<script lang="ts">
  /**
   * The beat in every set: the drum machine's beat, the same one its own tab
   * edits. Its parts, the steps of the part being edited (a row per pad on
   * the sequencer, and one for any pad with hits on the part), its kit, and
   * one Play and Stop: editing or stopping here does it to the beat everywhere.
   */
  import { onMount } from 'svelte';
  import { NOTE_GRIDS, noteGrid, stepsPerBeat, type NoteGrid } from '../../music/grid';
  import { musicStudio } from '../../music/musicStudioStore';
  import { PART_BARS, changePartGrid, emptyTrack, partSteps, resizePart, toggleStep, trackOf, type PartBars } from '../../music/drumMachine/machineBeat';
  import {
    editPart, ensureMachine, machineTransport, playPad, playingKit, savedKits, selectKit, selectPart, startMachine, stopBeat, userKits,
  } from '../../music/drumMachine/machineRuntime';
  import { KIT_FAMILY_LABELS, MACHINE_KITS, USER_FAMILY_LABEL, type KitFamily } from '../../music/drumMachine/machineKits';
  import { shownPads } from '../../music/drumMachine/machineRows';
  import StudioJack from './StudioJack.svelte';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  onMount(() => ensureMachine());

  const s = $derived($musicStudio);
  const beat = $derived(s.machine);
  const t = $derived($machineTransport);
  const playing = $derived(t.playing || s.sequencerPlaying);
  const kit = $derived.by(() => { void $savedKits; return playingKit(beat); });
  const mine = $derived.by(() => { void $savedKits; return userKits(beat); });
  const families = Object.keys(KIT_FAMILY_LABELS) as KitFamily[];
  const partIndex = $derived(Math.min(t.part, beat.parts.length - 1));
  const part = $derived(beat.parts[partIndex]);
  const perBar = $derived(noteGrid(part?.grid));
  const pads = $derived(part ? shownPads(beat.trackPads, part, beat.padCount) : []);

  /** The bar on screen: the one playing, else the one picked. */
  let page = $state(0);
  const pages = $derived(part ? part.bars : 1);
  const playingBar = $derived(t.playing && t.mode === 'part' && t.step >= 0 ? Math.floor(t.step / perBar) : -1);
  const bar = $derived(playingBar >= 0 ? playingBar : Math.min(page, pages - 1));
  const cells = $derived(Array.from({ length: perBar }, (_, k) => bar * perBar + k));

  function play() {
    if (playing) stopBeat();
    else startMachine();
  }

  function clearPart() {
    if (!part) return;
    const steps = partSteps(part);
    editPart((p) => ({ ...p, tracks: p.tracks.map(() => emptyTrack(steps)) }));
  }
</script>

<StudioModule title="Beat" led={playing} class="beat">
  {#snippet head()}
    <button
      class="transport mini"
      class:on={playing}
      onclick={play}
      aria-label={playing ? 'Stop the beat' : 'Play the beat'}
      title={playing ? 'Stop the beat (in every set)' : 'Play the beat: the drum machine, the same beat in every set'}
      data-midi-path="studio:machine.toggle"
      data-midi-label="Drum machine play or stop"
      data-midi-mode="toggle"
    >
      {#if playing}
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
      {/if}
    </button>
    {#if beat.parts.length > 1}
      <select value={partIndex} onchange={(e) => selectPart(+(e.target as HTMLSelectElement).value)} aria-label="Part" title="The part of the beat to play and edit (on the next bar while it plays)">
        {#each beat.parts as p, i (p.id)}<option value={i}>{p.name}</option>{/each}
      </select>
    {/if}
    {#if part}
      <select value={perBar} onchange={(e) => editPart((p) => changePartGrid(p, +(e.target as HTMLSelectElement).value as NoteGrid))} aria-label="Beat grid" title="Finer grids keep timing. Coarser grids quantize existing hits.">
        {#each NOTE_GRIDS as grid}<option value={grid}>1/{grid}</option>{/each}
      </select>
      <select value={part.bars} onchange={(e) => editPart((p) => resizePart(p, +(e.target as HTMLSelectElement).value as PartBars))} aria-label="Bars" title="How long the part is">
        {#each PART_BARS as n}<option value={n}>{n} bar{n === 1 ? '' : 's'}</option>{/each}
      </select>
    {/if}
    <select class="kit" value={kit.id} onchange={(e) => selectKit((e.target as HTMLSelectElement).value)} aria-label="Drum kit" title={kit.blurb ?? 'The drum machine kit'}>
      {#if mine.length}
        <optgroup label={USER_FAMILY_LABEL}>{#each mine as k (k.id)}<option value={k.id}>{k.name}</option>{/each}</optgroup>
      {/if}
      {#each families as f (f)}
        <optgroup label={KIT_FAMILY_LABELS[f]}>{#each MACHINE_KITS.filter((k) => k.family === f) as k (k.id)}<option value={k.id}>{k.name}</option>{/each}</optgroup>
      {/each}
    </select>
    {#if part}<StudioKnob label="Swing" hideLabel value={part.swing} max={0.5} size={16} format={(v) => `${Math.round(v * 200)}%`} onchange={(v) => editPart((p) => ({ ...p, swing: Math.max(0, Math.min(0.5, v)) }))} />{/if}
    {#if pages > 1 && playingBar < 0}
      <div class="ga-segmented small" role="group" aria-label="Bar shown">
        {#each { length: pages } as _, k}<button class:active={bar === k} onclick={() => (page = k)}>{k + 1}</button>{/each}
      </div>
    {/if}
    <button class="studio-btn" onclick={clearPart}>Clear</button>
    <StudioJack id="cv:inst.drums.level" title="Beat out: the whole kit's level, as a control signal" />
  {/snippet}
  <div class="grid">
    {#if part}
      <div class="steps" style="grid-template-columns: 72px repeat({perBar}, minmax(10px, 1fr)); grid-template-rows: repeat({pads.length}, minmax(12px, 1fr))">
        {#each pads as pad (pad)}
          {@const track = trackOf(part, pad)}
          <button class="voice" onpointerdown={(e) => { e.preventDefault(); playPad(pad, s.velocity); }} title="Play {kit.pads[pad]?.name ?? `Pad ${pad + 1}`}">{kit.pads[pad]?.name ?? `Pad ${pad + 1}`}</button>
          {#each cells as step (step)}
            <button
              class="step"
              class:on={track.vel[step] > 0}
              class:past={step >= track.length}
              class:bar={step % stepsPerBeat(part.grid) === 0}
              class:playhead={t.playing && t.mode === 'part' && step === t.step}
              style={track.vel[step] > 0 ? `opacity: ${0.45 + 0.55 * track.vel[step]}` : ''}
              onclick={() => editPart((p) => toggleStep(p, pad, step))}
              aria-label="{kit.pads[pad]?.name ?? `Pad ${pad + 1}`} step {step + 1}"
            ></button>
          {/each}
        {/each}
      </div>
    {/if}
  </div>
</StudioModule>

<style>
  .kit { min-width: 0; max-width: 112px; }
  .grid { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .steps { display: grid; gap: 2px; width: 100%; height: 100%; min-height: 0; }
  .voice {
    min-height: 12px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: var(--mk-muted, var(--ga-ink-1, #9aa0ac));
    text-align: left;
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    font-size: var(--ga-text-meta, 11px);
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .step {
    min-width: 0;
    min-height: 12px;
    padding: 0;
    border: 1px solid var(--mk-cell-edge, var(--ga-line, rgba(255,255,255,.07)));
    background: var(--mk-cell, var(--ga-card, #13161c));
    border-radius: var(--mk-radius, var(--ga-r-hard, 2px));
    cursor: pointer;
  }
  .step.bar { border-color: var(--mk-line, var(--ga-line-2, rgba(255,255,255,.12))); }
  .step.past { opacity: 0.35; }
  .step:hover { border-color: var(--mk-accent, var(--ga-coral-line, rgba(255,111,94,.4))); }
  .step.on { background: var(--mk-accent, var(--ga-coral, #ff6f5e)); border-color: var(--mk-accent, var(--ga-coral, #ff6f5e)); }
  .step.playhead { box-shadow: inset 0 0 0 1px var(--mk-ink, var(--ga-ink-0, #eef0f4)); }
</style>
