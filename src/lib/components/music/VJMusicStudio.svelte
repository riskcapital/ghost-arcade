<script lang="ts">
  /**
   * The music tray: a condensed copy of the current set under the VJ deck.
   * It plays the same instruments as the Studio view, with the set's main
   * modules and the loop library; patching lives in the Studio view.
   */
  import { onDestroy, onMount } from 'svelte';
  import { showToast } from '../../stores/errorToast';
  import { musicStudio } from '../../music/musicStudioStore';
  import { musicMidiDevices, musicMidiStatus } from '../../music/midiNotes';
  import { ROOT_NAMES, SCALES, STUDIO_SETS, type ScaleId } from '../../music/studioSets';
  import {
    ensureMusicRuntime,
    killAll,
    playAll,
    stopAll,
    recordingElapsed,
    startRecording,
    stopRecording,
  } from '../../music/musicRuntime';
  import './studioTokens.css';
  import StudioModule from './StudioModule.svelte';
  import PlayModule from './PlayModule.svelte';
  import BeatModule from './BeatModule.svelte';
  import SessionGrid from './SessionGrid.svelte';
  import ClipEditor from './ClipEditor.svelte';
  import LoopRecorderBar from './LoopRecorderBar.svelte';
  import PadsModule from './PadsModule.svelte';
  import BathModules from './BathModules.svelte';
  import BerlinModules from './BerlinModules.svelte';
  import DubModules from './DubModules.svelte';
  import AnalogModules from './AnalogModules.svelte';
  import { studioOnDeck } from '../../music/studioDeck';

  let minimized = $state(false);
  let elapsed = $state(0);

  const s = $derived($musicStudio);
  // On the deck the studio is one strip (StudioDeckStrip) instead.
  const shown = $derived(s.isOpen && !s.studioView && !$studioOnDeck);

  $effect(() => {
    if (!s.recording) {
      elapsed = 0;
      return;
    }
    const timer = setInterval(() => (elapsed = recordingElapsed()), 200);
    return () => clearInterval(timer);
  });

  onMount(() => {
    ensureMusicRuntime();
  });

  onDestroy(() => {
    // Leaving VJ mode closes the studio, which stops it and frees the letter keys.
    musicStudio.close();
  });

  const playing = $derived(s.sequencerPlaying || Object.keys(s.playingLoops).length > 0 || Object.keys(s.queuedLoops).length > 0 || !!s.playingTakeId);

  function toggleAll() {
    if (playing) stopAll();
    else playAll();
  }

  function toggleRecord() {
    if (s.recording) {
      if (!stopRecording()) showToast('Nothing was played, so no take was kept.', 'info');
    } else {
      startRecording();
    }
  }

  function formatSeconds(sec: number): string {
    return `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  }
</script>

{#snippet loops()}
  <StudioModule title="Session" class="loops">
    {#snippet head()}<LoopRecorderBar compact />{/snippet}
    <SessionGrid compact />
  </StudioModule>
{/snippet}

{#if shown}
  <div class="music-tray studio-tokens set-{s.set}" class:minimized data-help-page="clip-launcher">
    <div class="music-head">
      <span class="music-title">Music</span>
      <div class="ga-segmented compact" role="group" aria-label="Instrument set">
        {#each STUDIO_SETS as set}
          <button class:active={s.set === set.id} aria-pressed={s.set === set.id} onclick={() => musicStudio.setSet(set.id)}>{set.label}</button>
        {/each}
      </div>
      <div class="group">
        <button class="transport" class:on={playing} onclick={toggleAll} aria-label={playing ? 'Stop everything' : 'Play'} title={playing ? 'Stop everything (effects ring out)' : 'Play: the beat, or what was playing when you stopped'}>
          {#if playing}
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="1" /></svg>
          {:else}
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z" /></svg>
          {/if}
        </button>
        <button class="transport rec" class:on={s.recording} onclick={toggleRecord} aria-label={s.recording ? 'Stop recording' : 'Record'} title={s.recording ? 'Stop recording and keep the take' : 'Record a take'}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7" /></svg>
        </button>
        {#if s.recording}<span class="rec-time">{formatSeconds(elapsed)}</span>{/if}
      </div>
      <div class="group">
        <span class="head-label">Key</span>
        <select value={s.key.root} onchange={(e) => musicStudio.setKey({ ...s.key, root: +(e.target as HTMLSelectElement).value })} aria-label="Key root">
          {#each ROOT_NAMES as name, i}<option value={i}>{name}</option>{/each}
        </select>
        <select value={s.key.scale} onchange={(e) => musicStudio.setKey({ ...s.key, scale: (e.target as HTMLSelectElement).value as ScaleId })} aria-label="Scale">
          {#each Object.entries(SCALES) as [id, scale]}<option value={id}>{scale.label}</option>{/each}
        </select>
      </div>

      <span class="spacer"></span>

      <div class="group">
        <label class="check" title="Play with the computer keyboard: A–' are the keys, Z X shift octave, C V set velocity">
          <input type="checkbox" checked={s.keysArmed} onchange={() => musicStudio.setKeysArmed(!s.keysArmed)} />
          Letter keys
        </label>
        <label class="check" title="Velocity for keys and pads (C / V)">
          Vel
          <input class="vel" type="range" min="0.05" max="1" step="0.05" value={s.velocity} oninput={(e) => musicStudio.setVelocity(+(e.target as HTMLInputElement).value)} />
        </label>
        <select value={s.midiInput} onchange={(e) => musicStudio.setMidiInput((e.target as HTMLSelectElement).value)} title="MIDI input. Channel 10 always plays the drums.">
          <option value="">{$musicMidiStatus === 'unavailable' ? 'MIDI unavailable' : $musicMidiDevices.length ? 'All MIDI inputs' : 'No MIDI device'}</option>
          {#each $musicMidiDevices as device (device.id)}
            <option value={device.id}>{device.name}</option>
          {/each}
        </select>
      </div>
      <div class="group">
        <button class="text-btn" onclick={() => musicStudio.setStudioView(true)} title="Open the full-screen Studio view">Studio</button>
        <button class="kill-btn" onclick={killAll} title="Silence everything now, echoes and reverb included">Kill</button>
      </div>
      <div class="group window">
        <button class="icon-btn" onclick={() => (minimized = !minimized)} title={minimized ? 'Expand' : 'Minimize'} aria-label={minimized ? 'Expand music studio' : 'Minimize music studio'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            {#if minimized}<path d="M6 15l6-6 6 6" />{:else}<path d="M6 9l6 6 6-6" />{/if}
          </svg>
        </button>
        <button class="icon-btn" onclick={() => musicStudio.close()} title="Close the music studio and stop the music" aria-label="Close music studio">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>
    </div>

    {#if !minimized}
      <div class="music-body">
        {#if s.set === 'bath'}
          <div class="slot play face"><PlayModule size={null} patches /></div>
          <div class="slot face"><BathModules part="chords" /></div>
          <div class="slot face"><BathModules part="drone" /></div>
          <div class="slot loops">{@render loops()}</div>
        {:else if s.set === 'berlin'}
          <div class="slot wide face"><BeatModule /></div>
          <div class="slot play face"><PlayModule size={null} patches /></div>
          <div class="slot pads face"><PadsModule /></div>
          <div class="slot acid face"><BerlinModules part="acid" /></div>
          <div class="slot loops">{@render loops()}</div>
        {:else if s.set === 'dub'}
          <div class="slot play face"><PlayModule size={null} patches /></div>
          <div class="slot pads face"><PadsModule /></div>
          <div class="slot face"><DubModules part="siren" /></div>
          <div class="slot loops">{@render loops()}</div>
        {:else}
          <div class="slot play face"><PlayModule size={null} patches /></div>
          <div class="slot synth face"><AnalogModules bay={false} /></div>
          <div class="slot loops">{@render loops()}</div>
        {/if}
      </div>
    {/if}
  </div>
{/if}

{#if shown}<ClipEditor />{/if}

<style>
  .music-tray {
    flex: 0 0 272px;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: var(--studio-ground);
    border-top: 1px solid var(--studio-edge-soft);
    user-select: none;
  }
  .music-tray.minimized { flex: 0 0 auto; }

  /* A panel header: 26px controls, 12px text, groups 12px apart. */
  .music-head {
    height: 40px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: var(--ga-space-4, 12px);
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
  }
  .group { display: flex; align-items: center; gap: var(--ga-space-2, 6px); flex: 0 0 auto; }
  .group.window { gap: var(--ga-space-1, 4px); }
  .music-title { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); color: var(--studio-ink); }
  .head-label { color: var(--studio-muted); font-weight: var(--ga-weight-control, 600); }
  .spacer { flex: 1; }
  .music-head select { height: var(--ga-control-h, 26px); }
  .rec-time { font-family: var(--ga-font-mono, ui-monospace); font-variant-numeric: tabular-nums; color: var(--ga-rec, #ff3b30); }
  .vel { width: 72px; }
  .window .icon-btn { width: var(--ga-control-h, 26px); height: var(--ga-control-h, 26px); display: inline-flex; align-items: center; justify-content: center; }
  .window .icon-btn svg { width: 13px; height: 13px; }

  .music-body {
    flex: 1;
    min-height: 0;
    display: flex;
    gap: 10px;
    padding: 10px 12px;
    overflow-x: auto;
  }
  .slot { flex: 1 1 0; min-width: 240px; min-height: 0; display: flex; flex-direction: column; }
  .slot > :global(.module) { flex: 1; }
  .slot.play { flex: 1.3 1 0; min-width: 380px; }
  .slot.wide { flex: 1.6 1 0; min-width: 420px; }
  .slot.loops { flex: 2.2 1 0; min-width: 520px; }
  .slot.pads { flex: 0.9 1 0; min-width: 280px; }
  .slot.acid { flex: 1.3 1 0; min-width: 420px; }
  .slot.synth { flex: 0 0 auto; min-width: 0; }

  /* Patching lives in the Studio view; the tray hides the jacks. */
  .music-tray :global(.jack-wrap) { display: none; }
</style>
