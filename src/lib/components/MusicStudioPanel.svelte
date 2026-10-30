<script lang="ts">
  /**
   * One Music Studio instance's visuals: its scene, its palette and its
   * stack of voices (the shader, the sound it follows, whether it comes and
   * goes with that sound, its level and its look). The same panel edits a
   * studio clip in a VJ cell, a mapping layer showing the studio, and the
   * instance the studio itself is playing to.
   */
  import { onDestroy } from 'svelte';
  import { musicStudio } from '../music/musicStudioStore';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { STUDIO_SETS, type StudioSet } from '../music/studioSets';
  import { VISUAL_SCENES, VOICE_SHADERS, shaderInputs, voiceShaderByFile } from '../music/visualScenes';
  import { VOICE_SOURCES, isVoiceDrivenInput, type VoiceSourceId } from '../music/visualVoices';
  import {
    MAX_STUDIO_VOICES,
    normalizeStudioSource,
    studioCodeTick,
    studioVoiceCode,
    studioVoicesFromScene,
    type StudioPluginSource,
    type StudioVoice,
  } from '../music/studioPlugin';

  let {
    source,
    onchange,
    showOpen = true,
  }: {
    source: unknown;
    /** `gesture` names a continuous edit (a slider drag), which is one undo step. */
    onchange: (next: Required<StudioPluginSource>, gesture?: string) => void;
    /** Offer to open the studio (not inside the studio itself). */
    showOpen?: boolean;
  } = $props();

  const studio = $derived(normalizeStudioSource(source));
  let open = $state<number | null>(null);

  // Look knobs appear once a voice's shader has loaded.
  let tick = $state(0);
  const unsub = studioCodeTick.subscribe((n) => (tick = n));
  onDestroy(unsub);

  const LOOK_SKIP = new Set(['vxSource', 'vxAuto', 'ink', 'accent']);
  function looks(file: string) {
    void tick;
    const code = studioVoiceCode(file);
    if (!code) return [];
    return shaderInputs(code).filter((i) => (i.TYPE === 'float' || i.TYPE === 'long') && !LOOK_SKIP.has(i.NAME) && !isVoiceDrivenInput(i.NAME));
  }

  function emit(next: Partial<Required<StudioPluginSource>>, gesture?: string) {
    onchange(normalizeStudioSource({ ...studio, ...next }), gesture);
  }

  function loadScene(id: string) {
    const scene = VISUAL_SCENES.find((s) => s.id === id);
    if (scene) emit({ musicSceneId: scene.id, musicSet: scene.set, musicVoices: studioVoicesFromScene(scene.voices) });
  }

  function setVoice(index: number, patch: Partial<StudioVoice>, gesture?: string) {
    emit({ musicVoices: studio.musicVoices.map((v, i) => (i === index ? { ...v, ...patch, params: { ...v.params, ...(patch.params ?? {}) } } : v)) }, gesture);
  }

  function replaceVoice(index: number, file: string) {
    emit({ musicSceneId: null, musicVoices: studio.musicVoices.map((v, i) => (i === index ? { ...v, file, params: {} } : v)) });
  }

  function removeVoice(index: number) {
    if (open === index) open = null;
    emit({ musicSceneId: null, musicVoices: studio.musicVoices.filter((_, i) => i !== index) });
  }

  function addVoice() {
    const family = VOICE_SHADERS.find((v) => v.family === studio.musicSet) ?? VOICE_SHADERS[0];
    emit({ musicSceneId: null, musicVoices: [...studio.musicVoices, { file: family.file, source: 'all', auto: true, level: 1, params: {} }] });
    open = studio.musicVoices.length;
  }

  const sceneGroups = STUDIO_SETS.map((set) => ({ ...set, scenes: VISUAL_SCENES.filter((s) => s.set === set.id) }));
  const voiceGroups = STUDIO_SETS.map((set) => ({ ...set, voices: VOICE_SHADERS.filter((v) => v.family === set.id) }));
</script>

<div class="msp" data-help-page="music-studio">
  <div class="msp-row">
    <label class="msp-field">
      <span class="msp-eyebrow">Scene</span>
      <select value={studio.musicSceneId ?? ''} onchange={(e) => loadScene((e.target as HTMLSelectElement).value)} aria-label="Load a scene">
        {#if !studio.musicSceneId}<option value="">Your own mix</option>{/if}
        {#each sceneGroups as group (group.id)}
          <optgroup label={group.label}>
            {#each group.scenes as scene (scene.id)}<option value={scene.id}>{scene.name}</option>{/each}
          </optgroup>
        {/each}
      </select>
    </label>
    <label class="msp-field msp-narrow">
      <span class="msp-eyebrow">Palette</span>
      <select value={studio.musicSet} onchange={(e) => emit({ musicSet: (e.target as HTMLSelectElement).value as StudioSet })} aria-label="Palette">
        {#each STUDIO_SETS as set (set.id)}<option value={set.id}>{set.label}</option>{/each}
      </select>
    </label>
  </div>

  <div class="msp-head">
    <span class="msp-eyebrow">Voices</span>
    <span class="msp-count">{studio.musicVoices.length} of {MAX_STUDIO_VOICES}</span>
  </div>

  {#each studio.musicVoices as voice, i (i)}
    <div class="msp-voice" class:open={open === i}>
      <div class="msp-voice-row">
        <select class="msp-shader" value={voice.file} onchange={(e) => replaceVoice(i, (e.target as HTMLSelectElement).value)} aria-label="Voice {i + 1}" title={voiceShaderByFile(voice.file)?.blurb ?? ''}>
          {#each voiceGroups as group (group.id)}
            <optgroup label={group.label}>
              {#each group.voices as v (v.file)}<option value={v.file}>{v.name}</option>{/each}
            </optgroup>
          {/each}
        </select>
        <select class="msp-follows" value={voice.source} onchange={(e) => setVoice(i, { source: (e.target as HTMLSelectElement).value as VoiceSourceId })} aria-label="Voice {i + 1} follows" title="The sound this voice follows">
          {#each VOICE_SOURCES as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
        </select>
        <button class="msp-chip" class:on={voice.auto} aria-pressed={voice.auto} onclick={() => setVoice(i, { auto: !voice.auto })} title={voice.auto ? 'Shows only while its sound plays' : 'Always shows'}>Auto</button>
        <button class="msp-icon" class:on={open === i} aria-expanded={open === i} onclick={() => (open = open === i ? null : i)} aria-label="Look for voice {i + 1}" title="Level and look">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></svg>
        </button>
        <button class="msp-icon" onclick={() => removeVoice(i)} aria-label="Remove voice {i + 1}" title="Remove this voice">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      {#if open === i}
        <div class="msp-look">
          <label class="msp-param">
            <span>Level</span>
            <input type="range" min="0" max="1" step="0.01" value={voice.level} oninput={(e) => setVoice(i, { level: +(e.target as HTMLInputElement).value }, `voice:${i}:level`)} />
            <span class="msp-val">{Math.round(voice.level * 100)}%</span>
          </label>
          {#each looks(voice.file) as input (input.NAME)}
            {@const min = input.MIN ?? 0}
            {@const max = input.MAX ?? 1}
            {@const value = voice.params[input.NAME] ?? Number(input.DEFAULT ?? min)}
            <label class="msp-param">
              <span>{input.LABEL ?? input.NAME}</span>
              <input type="range" {min} {max} step={input.TYPE === 'long' || max - min > 4 ? 1 : (max - min) / 100} {value}
                oninput={(e) => setVoice(i, { params: { [input.NAME]: +(e.target as HTMLInputElement).value } }, `voice:${i}:${input.NAME}`)} />
              <span class="msp-val">{Number.isInteger(value) ? value : value.toFixed(2)}</span>
            </label>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <p class="msp-empty">No voices. Load a scene or add one.</p>
  {/each}

  <div class="msp-actions">
    <button class="msp-btn" onclick={addVoice} disabled={studio.musicVoices.length >= MAX_STUDIO_VOICES}>+ Add voice</button>
    {#if showOpen && $vjClipLauncher.isOpen}
      <button class="msp-btn" onclick={() => musicStudio.setStudioView(true)} title="Open the music studio: play the instruments, or let Ableton Live drive these voices">Open studio</button>
    {/if}
  </div>
  {#if showOpen && !$vjClipLauncher.isOpen}
    <p class="msp-empty">The music comes from the studio in VJ mode, or Ableton Live through it. Until it plays, every voice shows at rest.</p>
  {/if}
</div>

<style>
  .msp { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-0); }
  .msp-row { display: flex; gap: 8px; }
  .msp-field { flex: 1; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .msp-narrow { flex: 0 0 104px; }
  .msp-eyebrow { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2); }
  .msp-head { display: flex; align-items: baseline; justify-content: space-between; margin-top: 4px; }
  .msp-count { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2); font-variant-numeric: tabular-nums; }
  select {
    height: var(--ga-control-h, 26px);
    min-width: 0;
    padding: 0 6px;
    background: var(--ga-slot, #060504);
    color: var(--ga-ink-0);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
  }
  .msp-voice { border: 1px solid var(--ga-line-1); border-radius: var(--ga-r-hard, 5px); background: var(--ga-card, #16140f); }
  .msp-voice.open { border-color: var(--ga-line-2); }
  .msp-voice-row { display: flex; align-items: center; gap: 4px; padding: 4px; }
  .msp-shader { flex: 1 1 0; }
  .msp-follows { flex: 1.15 1 0; }
  .msp-chip, .msp-icon, .msp-btn {
    height: var(--ga-control-h-sm, 22px);
    border: 1px solid var(--ga-line-2);
    background: var(--ga-sub, #1e1b16);
    color: var(--ga-ink-1);
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    cursor: pointer;
  }
  .msp-chip { padding: 0 7px; }
  .msp-icon { width: 22px; padding: 0; display: grid; place-items: center; flex: 0 0 auto; }
  .msp-icon svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; }
  .msp-chip:hover, .msp-icon:hover, .msp-btn:hover:not(:disabled) { border-color: var(--ga-line-3); color: var(--ga-ink-0); }
  .msp-chip.on, .msp-icon.on { background: var(--ga-selection-bg); border-color: var(--ga-selection-line); color: var(--ga-selection-ink); }
  .msp-look { display: flex; flex-direction: column; gap: 4px; padding: 6px 8px 8px; border-top: 1px solid var(--ga-line-1); }
  .msp-param { display: grid; grid-template-columns: 88px 1fr 40px; align-items: center; gap: 8px; color: var(--ga-ink-1); }
  .msp-param > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .msp-param input { width: 100%; }
  .msp-val { font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1); text-align: right; font-variant-numeric: tabular-nums; }
  .msp-empty { margin: 0; color: var(--ga-ink-2); font-size: var(--ga-text-meta, 11px); line-height: 1.45; }
  .msp-actions { display: flex; gap: 6px; margin-top: 2px; }
  .msp-btn { height: var(--ga-control-h, 26px); padding: 0 10px; color: var(--ga-ink-0); }
  .msp-btn:disabled { opacity: 0.45; cursor: default; }
</style>
