<script lang="ts">
  /**
   * New show from audio: pick (or drop) a song, choose how looks are laid
   * over it, and the Show timeline opens with the song at 0, zoomed to fit,
   * ready to play. The show runs for the length of the song.
   *
   * Also owns the workspace drop: a single audio file dropped anywhere in
   * the mapping workspace that no panel took is offered here.
   */
  import { onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { showFromAudioRequest } from '../show/showFromAudio';
  import { layoutSong, analyzeSong, type SongAnalysis, type SongLayoutMode } from '../show/songLayout';
  import { showTimeline } from '../stores/showTimeline';
  import { compositions } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { workspace } from '../stores/workspace';
  import { computeAudioPeaks, decodeShowAudio, type DecodedShowAudio } from '../audio/showAudio';
  import {
    isShowAudioFile,
    prepareShowAudioFile,
    probeMediaDuration,
    unplayableAudioMessage,
    type PreparedShowAudio,
  } from '../audio/showAudioImport';

  type Phase = 'closed' | 'loading' | 'ready' | 'creating';

  let phase: Phase = 'closed';
  let error = '';
  let fileInput: HTMLInputElement | undefined;
  let prepared: PreparedShowAudio | null = null;
  let decoded: DecodedShowAudio | null = null;
  let songDuration = 0;
  let peaks: number[] = [];
  let mode: SongLayoutMode = 'keep';
  let chosen = new Set<string>();
  let analysis: SongAnalysis | null = null;
  let analyzing = false;
  /** Bumped per song so a late decode or analysis of an earlier one is ignored. */
  let generation = 0;

  const unsubscribe = showFromAudioRequest.subscribe((request) => {
    if (!request) return;
    showFromAudioRequest.set(null);
    if (request.kind === 'pick') fileInput?.click();
    else void open(request.file);
  });
  onDestroy(unsubscribe);

  $: presetList = $compositions;
  $: chosenPresets = presetList.filter((c) => chosen.has(c.id)).map((c) => ({ id: c.id, name: c.name }));
  $: replacing = $showTimeline.audioTracks.length > 0 || $showTimeline.presetClips.length > 0;
  $: preview = songDuration > 0 ? layoutSong(mode, chosenPresets, songDuration, analysis?.sections ?? []) : [];
  $: needsPresets = mode !== 'keep' && chosenPresets.length === 0;
  $: if (phase === 'ready' && mode === 'sections' && !analysis && !analyzing && decoded) runAnalysis();

  async function open(file: File) {
    const mine = ++generation;
    phase = 'loading';
    error = '';
    prepared = null;
    decoded = null;
    songDuration = 0;
    peaks = [];
    analysis = null;
    analyzing = false;
    chosen = new Set(get(compositions).map((c) => c.id));
    mode = get(compositions).length >= 2 ? 'sections' : 'keep';

    const result = await prepareShowAudioFile(file);
    if (mine !== generation) return;
    if ('error' in result) {
      error = result.error;
      phase = 'ready';
      return;
    }
    prepared = result;
    decoded = await decodeShowAudio(result.url);
    if (mine !== generation) return;
    if (decoded) {
      songDuration = decoded.duration;
      peaks = computeAudioPeaks(decoded.mono, 240);
    } else {
      // The element may still play what the decoder cannot read: no
      // waveform and no section search then, but the song works.
      songDuration = (await probeMediaDuration(result.url)) ?? 0;
      if (mine !== generation) return;
      if (songDuration <= 0) error = unplayableAudioMessage(result.name);
      if (mode === 'sections') mode = get(compositions).length > 0 ? 'even' : 'keep';
    }
    phase = 'ready';
  }

  function runAnalysis() {
    if (!decoded) return;
    const mine = generation;
    const pcm = decoded;
    analyzing = true;
    // Let the dialog paint "Listening…" first; the analysis takes a moment on a long song.
    setTimeout(() => {
      if (mine !== generation) return;
      try {
        analysis = analyzeSong(pcm.mono, pcm.sampleRate);
      } catch (err) {
        console.warn('[ShowFromAudio] analysis failed:', err);
        analysis = { tempo: null, beats: [], sections: [], duration: pcm.duration };
      }
      analyzing = false;
    }, 30);
  }

  function close() {
    generation++;
    phase = 'closed';
    error = '';
    prepared = null;
    decoded = null;
    analysis = null;
  }

  function togglePreset(id: string) {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    chosen = next;
  }

  async function create() {
    if (!prepared || songDuration <= 0 || needsPresets || phase !== 'ready') return;
    phase = 'creating';
    const song = prepared;
    const clips = preview;
    showTimeline.stop();
    showTimeline.clear();
    const id = await showTimeline.addAudioTrack(
      { name: song.name, url: song.url, assetRef: song.assetRef, startTime: 0, lane: 0 },
      { removeIfUnplayable: true },
    );
    if (!id) {
      error = unplayableAudioMessage(song.name);
      phase = 'ready';
      return;
    }
    showTimeline.setPresetClips(clips);
    showTimeline.select(null);
    showTimeline.setOpen(true);
    // The lane labels take ~90 px of the tray, the margins a little more.
    showTimeline.zoomToFit(Math.max(400, window.innerWidth - 140));
    // Cue the opening look.
    showTimeline.seek(0);
    close();
  }

  async function handlePick(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await open(file);
  }

  // ── Workspace drop ─────────────────────────────────────────────────────
  // Bubble phase on the window: a panel that handles the drop itself
  // (media tray, layer list, the show timeline's own grid) has already
  // called preventDefault by the time it gets here.
  function workspaceTakesDrop(e: DragEvent): boolean {
    if (e.defaultPrevented || phase !== 'closed') return false;
    if (get(vjClipLauncher).isOpen || get(workspace) !== 'main') return false;
    return true;
  }

  function onWindowDragOver(e: DragEvent) {
    if (!workspaceTakesDrop(e)) return;
    const items = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file');
    if (items.length !== 1) return;
    // The name is hidden until the drop; the type is known for most audio.
    if (items[0].type && !items[0].type.startsWith('audio/')) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function onWindowDrop(e: DragEvent) {
    if (!workspaceTakesDrop(e)) return;
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length !== 1 || !isShowAudioFile(files[0].name, files[0].type)) return;
    e.preventDefault();
    void open(files[0]);
  }

  function onKey(e: KeyboardEvent) {
    if (phase === 'closed') return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.target as HTMLElement | null)?.tagName !== 'BUTTON') {
      e.preventDefault();
      void create();
    }
  }

  function formatTime(t: number): string {
    const safe = Math.max(0, t);
    return `${Math.floor(safe / 60)}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
  }

  function wavePath(values: number[]): string {
    if (values.length === 0) return '';
    const n = values.length;
    let top = '';
    let bottom = '';
    for (let i = 0; i < n; i++) {
      const x = (i / Math.max(1, n - 1)) * 1000;
      const amp = (values[i] / 255) * 22;
      top += `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${(24 - amp).toFixed(1)}`;
      bottom = `L${x.toFixed(1)},${(24 + amp).toFixed(1)}` + bottom;
    }
    return `${top}${bottom}Z`;
  }

  const LANE_COLORS = ['#ff725f', '#9b87f5', '#4fd1c5', '#f6c453', '#6ea8fe', '#f48fb1'];
</script>

<svelte:window onkeydown={onKey} ondragover={onWindowDragOver} ondrop={onWindowDrop} />

<input
  class="sfa-file"
  type="file"
  accept="audio/*,.aif,.aiff,.aifc,.wma,.flac,.m4a,.opus"
  bind:this={fileInput}
  onchange={handlePick}
/>

{#if phase !== 'closed'}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="sfa-backdrop" onclick={close}>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="sfa-dialog" role="dialog" aria-modal="true" aria-labelledby="sfa-title" tabindex="-1" onclick={(e) => e.stopPropagation()}>
      <h2 id="sfa-title">New show from audio</h2>

      {#if phase === 'loading'}
        <p class="sfa-muted">Reading the song…</p>
      {:else}
        {#if prepared}
          <div class="sfa-song">
            <span class="sfa-song-name file-name" translate="no" title={prepared.name}>{prepared.name}</span>
            {#if songDuration > 0}<span class="sfa-song-len">{formatTime(songDuration)}</span>{/if}
          </div>
          {#if songDuration > 0}
            <div class="sfa-wave" aria-hidden="true">
              <svg viewBox="0 0 1000 48" preserveAspectRatio="none">
                <path d={wavePath(peaks)} />
                {#each analysis?.sections ?? [] as cut}
                  {#if mode === 'sections'}<line x1={(cut / songDuration) * 1000} x2={(cut / songDuration) * 1000} y1="0" y2="48" />{/if}
                {/each}
              </svg>
              <div class="sfa-lane">
                {#each preview as clip, i}
                  <span
                    class="sfa-clip"
                    style="left: {(clip.startTime / songDuration) * 100}%; width: {(clip.duration / songDuration) * 100}%; --c: {LANE_COLORS[presetList.findIndex((c) => c.id === clip.compositionId) % LANE_COLORS.length] ?? LANE_COLORS[i % LANE_COLORS.length]}"
                    title="{clip.label ?? ''} · {formatTime(clip.startTime)}–{formatTime(clip.startTime + clip.duration)}"
                  ><span class="preset-name" translate="no">{clip.label ?? ''}</span></span>
                {:else}
                  <span class="sfa-clip sfa-keep">Current look</span>
                {/each}
              </div>
            </div>
          {/if}
        {/if}

        {#if error}
          <p class="sfa-error" role="alert">{error}</p>
        {/if}

        {#if prepared && songDuration > 0}
          <fieldset class="sfa-modes">
            <legend>Looks over the song</legend>
            <label class:on={mode === 'keep'}>
              <input type="radio" name="sfa-mode" value="keep" bind:group={mode} />
              <span><strong>Keep the current look</strong><small>The picture stays as it is while the song plays.</small></span>
            </label>
            <label class:on={mode === 'even'} class:off={presetList.length === 0}>
              <input type="radio" name="sfa-mode" value="even" bind:group={mode} disabled={presetList.length === 0} />
              <span><strong>Spread presets evenly</strong><small>Each chosen preset gets an equal part of the song.</small></span>
            </label>
            <label class:on={mode === 'sections'} class:off={presetList.length === 0 || !decoded}>
              <input type="radio" name="sfa-mode" value="sections" bind:group={mode} disabled={presetList.length === 0 || !decoded} />
              <span>
                <strong>Change on the music</strong>
                <small>
                  {#if mode === 'sections' && analyzing}Listening for sections and beats…
                  {:else if mode === 'sections' && analysis}{analysis.sections.length + 1} sections{analysis.tempo ? `, about ${Math.round(analysis.tempo)} BPM` : ''}, cuts on the beat.
                  {:else}A new preset where the song changes section, on the beat.{/if}
                </small>
              </span>
            </label>
          </fieldset>

          {#if presetList.length === 0}
            <p class="sfa-muted">Save presets in the Presets tray to lay them over a song.</p>
          {:else if mode !== 'keep'}
            <div class="sfa-presets" role="group" aria-label="Presets to use">
              {#each presetList as comp (comp.id)}
                <label class="sfa-preset" class:on={chosen.has(comp.id)}>
                  <input type="checkbox" checked={chosen.has(comp.id)} onchange={() => togglePreset(comp.id)} />
                  <span class="preset-name" translate="no">{comp.name}</span>
                </label>
              {/each}
            </div>
            {#if needsPresets}<p class="sfa-muted">Choose at least one preset.</p>{/if}
          {/if}

          {#if replacing}
            <p class="sfa-note">This replaces the current show.</p>
          {/if}
        {/if}
      {/if}

      <div class="sfa-actions">
        <button class="sfa-cancel" onclick={close}>Cancel</button>
        <button
          class="sfa-create"
          onclick={create}
          disabled={phase !== 'ready' || !prepared || songDuration <= 0 || needsPresets || (mode === 'sections' && analyzing)}
        >{phase === 'creating' ? 'Creating…' : 'Create show'}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sfa-file { display: none; }
  .sfa-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.6);
    -webkit-app-region: no-drag;
  }
  .sfa-dialog {
    width: min(560px, 100%);
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 20px 22px 18px;
    border-radius: 10px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: var(--ga-panel, #0f1116);
    color: var(--text-primary, #e8e8e8);
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
    font-family: var(--ga-font-ui, inherit);
    font-size: 13px;
    outline: none;
  }
  h2 { margin: 0 0 14px; font-size: 17px; font-weight: 650; }
  .sfa-muted { color: var(--text-secondary, #a0a0a0); margin: 8px 0; }
  .sfa-note { color: #f6c453; margin: 10px 0 0; font-size: 12px; }
  .sfa-error { color: #ff8a7a; margin: 10px 0; }
  .sfa-song { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .sfa-song-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sfa-song-len { color: var(--text-secondary, #a0a0a0); font-variant-numeric: tabular-nums; }
  .sfa-wave {
    margin: 10px 0 14px;
    border-radius: 6px;
    background: #0a0c10;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }
  .sfa-wave svg { display: block; width: 100%; height: 48px; }
  .sfa-wave path { fill: #8fb4ff; opacity: 0.75; }
  .sfa-wave line { stroke: #ffffff; stroke-opacity: 0.55; stroke-width: 1; vector-effect: non-scaling-stroke; }
  .sfa-lane { position: relative; height: 22px; border-top: 1px solid rgba(255, 255, 255, 0.08); }
  .sfa-clip {
    position: absolute;
    top: 3px;
    bottom: 3px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--c, #ff725f) 35%, transparent);
    border-left: 2px solid var(--c, #ff725f);
    font-size: 10px;
    line-height: 14px;
    padding: 0 4px;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    box-sizing: border-box;
  }
  .sfa-keep { left: 0; right: 0; background: rgba(255, 255, 255, 0.06); border-left-color: rgba(255, 255, 255, 0.3); color: var(--text-secondary, #a0a0a0); }
  .sfa-modes { border: 0; margin: 0; padding: 0; display: grid; gap: 6px; }
  .sfa-modes legend { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-secondary, #a0a0a0); margin-bottom: 6px; }
  .sfa-modes label {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 8px 10px;
    border-radius: 7px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    cursor: pointer;
  }
  .sfa-modes label.on { border-color: var(--ga-coral, #ff6f5e); background: color-mix(in srgb, var(--ga-coral, #ff6f5e) 8%, transparent); }
  .sfa-modes label.off { opacity: 0.45; cursor: default; }
  .sfa-modes input { margin-top: 3px; accent-color: var(--ga-coral, #ff6f5e); }
  .sfa-modes span { display: grid; gap: 2px; }
  .sfa-modes small { color: var(--text-secondary, #a0a0a0); font-size: 12px; }
  .sfa-presets {
    margin-top: 10px;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    max-height: 132px;
    overflow-y: auto;
  }
  .sfa-preset {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 9px;
    border-radius: 14px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    cursor: pointer;
    font-size: 12px;
  }
  .sfa-preset.on { border-color: var(--ga-coral, #ff6f5e); }
  .sfa-preset input { accent-color: var(--ga-coral, #ff6f5e); margin: 0; }
  .sfa-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 18px; }
  .sfa-actions button {
    min-height: 32px;
    padding: 0 14px;
    border-radius: 6px;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .sfa-cancel { background: transparent; border: 1px solid rgba(255, 255, 255, 0.16); color: var(--text-primary, #e8e8e8); }
  .sfa-create { background: var(--ga-coral, #ff6f5e); border: 1px solid var(--ga-coral, #ff6f5e); color: #14090a; }
  .sfa-create:disabled { opacity: 0.45; cursor: default; }
</style>
