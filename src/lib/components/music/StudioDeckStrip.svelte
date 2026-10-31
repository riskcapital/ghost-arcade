<script lang="ts">
  /**
   * The studio on the VJ deck: one strip under the deck while the music
   * plays, so the clip grid keeps its room. Back to the Studio view, the
   * songs, the band's throw, wash and freeze, and the level of each look on
   * the studio's instance. It also listens for the key that switches between
   * the Studio view and the deck, for as long as VJ mode is open.
   */
  import { onMount } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { bandState, prepareBand, setBandThrow, setBandWash, toggleFreeze } from '../../music/musicRuntime';
  import { setStudioVoice, studioTarget } from '../../music/studioTarget';
  import { voiceShaderByFile } from '../../music/visualScenes';
  import { VOICE_SOURCES } from '../../music/visualVoices';
  import { STUDIO_VIEW_KEY_LABEL, attachStudioViewKey, showStudioView, showTray, studioOnDeck } from '../../music/studioDeck';
  import './studioTokens.css';
  import StudioKnob from './StudioKnob.svelte';
  import SongStrip from './SongStrip.svelte';

  const s = $derived($musicStudio);
  const shown = $derived(s.isOpen && !s.studioView && $studioOnDeck);
  const voices = $derived($studioTarget?.source.musicVoices ?? []);
  let throwing = $state(false);
  let washing = $state(false);

  onMount(() => attachStudioViewKey());

  // Keep the last moment while the strip is up, so the first freeze has one.
  $effect(() => {
    if (shown) prepareBand();
  });

  // Nothing stays thrown or washed once the strip goes.
  $effect(() => {
    if (!shown) return;
    return () => {
      if (throwing) setBandThrow(false);
      if (washing) setBandWash(false);
      throwing = false;
      washing = false;
    };
  });

  function hold(e: PointerEvent, set: (on: boolean) => void, mark: (on: boolean) => void) {
    if (e.button !== 0) return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    mark(true);
    set(true);
  }

  function letGo(on: boolean, set: (on: boolean) => void, mark: (on: boolean) => void) {
    if (!on) return;
    mark(false);
    set(false);
  }

  const voiceName = (file: string) => voiceShaderByFile(file)?.name ?? file.replace(/^VX-|\.fs$/g, '');
  const sourceName = (id: string) => VOICE_SOURCES.find((v) => v.id === id)?.label ?? id;
  const percent = (v: number) => `${Math.round(v * 100)}%`;
</script>

{#if shown}
  <div class="deck-strip studio-tokens" role="toolbar" aria-label="Studio on the deck">
    <div class="group">
      <button class="text-btn small" onclick={showStudioView} title="Back to the Studio view; the music keeps playing ({STUDIO_VIEW_KEY_LABEL})" data-midi-path="studio:studio.view" data-midi-label="Studio view or VJ deck" data-midi-mode="toggle">Studio</button>
      <button class="text-btn small" onclick={showTray} title="Show the music tray under the deck">Tray</button>
    </div>
    <span class="sep" aria-hidden="true"></span>
    <SongStrip />
    <span class="sep" aria-hidden="true"></span>
    <div class="group" role="group" aria-label="The band's sound">
      <button
        class="text-btn small hold"
        class:on={throwing || $bandState.throwing}
        onpointerdown={(e) => hold(e, setBandThrow, (on) => (throwing = on))}
        onpointerup={() => letGo(throwing, setBandThrow, (on) => (throwing = on))}
        onpointercancel={() => letGo(throwing, setBandThrow, (on) => (throwing = on))}
        onlostpointercapture={() => letGo(throwing, setBandThrow, (on) => (throwing = on))}
        title="Hold to throw the band into the echo; the repeats run on after"
        data-midi-path="studio:band.throw"
        data-midi-label="Echo throw"
        data-midi-mode="toggle"
      >Throw</button>
      <button
        class="text-btn small hold"
        class:on={washing || $bandState.washing}
        onpointerdown={(e) => hold(e, setBandWash, (on) => (washing = on))}
        onpointerup={() => letGo(washing, setBandWash, (on) => (washing = on))}
        onpointercancel={() => letGo(washing, setBandWash, (on) => (washing = on))}
        onlostpointercapture={() => letGo(washing, setBandWash, (on) => (washing = on))}
        title="Hold to wash the band into a long reverb"
        data-midi-path="studio:band.wash"
        data-midi-label="Reverb wash"
        data-midi-mode="toggle"
      >Wash</button>
      <button class="text-btn small hold" class:on={$bandState.frozen} aria-pressed={$bandState.frozen} onclick={() => void toggleFreeze()} title={$bandState.freezeError ?? ($bandState.frozen ? 'Let the frozen moment go' : 'Hold the last moment of sound as a texture')} data-midi-path="studio:band.freeze" data-midi-label="Freeze the band" data-midi-mode="toggle">{$bandState.frozen ? 'Frozen' : 'Freeze'}</button>
    </div>
    <span class="sep" aria-hidden="true"></span>
    <div class="voices" role="group" aria-label="Studio looks">
      {#each voices as voice, i (i)}
        <div class="voice" title="{voiceName(voice.file)}, following {sourceName(voice.source).toLowerCase()}">
          <StudioKnob
            label="Voice {i + 1} level"
            title="How much of {voiceName(voice.file)} shows"
            midiPath="studio:voice.{i + 1}.level"
            value={voice.level}
            defaultValue={1}
            size={16}
            hideLabel
            format={percent}
            onchange={(v) => setStudioVoice(i, { level: v }, `voice:${i}:level`)}
          />
          <span class="voice-name">{voiceName(voice.file)}</span>
        </div>
      {:else}
        <span class="muted none">No studio looks on the deck</span>
      {/each}
    </div>
  </div>
{/if}

<style>
  .deck-strip {
    flex: 0 0 auto;
    height: 38px;
    padding: 0 12px;
    display: flex;
    align-items: center;
    gap: 10px;
    background: var(--ga-bar, #100f0d);
    border-top: 1px solid var(--studio-edge-soft);
    white-space: nowrap;
    overflow: hidden;
    user-select: none;
  }
  .group { display: flex; align-items: center; gap: 4px; flex: 0 0 auto; }
  .sep { flex: 0 0 1px; height: 18px; background: var(--studio-edge-soft); }
  .hold { min-width: 52px; touch-action: none; }
  .hold.on { background: var(--studio-accent); border-color: var(--studio-accent); color: var(--studio-on-accent); }
  .voices { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; overflow: hidden; }
  .voice { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
  .voice :global(.knob-wrap) { min-width: 0; }
  .voice-name { max-width: 80px; overflow: hidden; text-overflow: ellipsis; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .none { font-size: var(--ga-text-meta, 11px); }
</style>
