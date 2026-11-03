<script lang="ts">
  /**
   * The studio's visuals: the voices of the Music Studio instance it plays
   * to (a studio clip in a VJ cell, or a mapping layer showing the studio).
   * Each voice shows which visual it is, which sound it follows and its main
   * controls; open it for the rest. Scenes load a whole stack at once. With
   * no instance yet, one is put on the deck (or the selected layer).
   */
  import { onDestroy, tick as nextTick, untrack } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { STUDIO_SETS } from '../../music/studioSets';
  import { voiceSourcesFor, isVoiceDrivenInput, isLiveSource, liveSource, LIVE_DRUMS, type LiveDrum, type LiveSourceId, type VoiceSourceId } from '../../music/visualVoices';
  import { abletonBridge } from '../../ableton/abletonBridge';
  import { guessRole, isDrumTrack, liveMatchFor, liveTrackKeys } from '../../music/liveControl';
  import { VISUAL_SCENES, VOICE_SHADERS, shaderInputs, voiceShaderByFile, type ShaderInput } from '../../music/visualScenes';
  import { visualPicker } from '../../music/studioUi';
  import VisualPickButton from './VisualPickButton.svelte';
  import { BLEND_MODE_ORDER, blendModeLabel, type BlendMode } from '../../types';
  import { MIX_BAR_OPTIONS, MIX_MODES, mixAt, normalizeMix, type MixMode } from '../../music/studioMix';
  import { DEFAULT_TEXT_EVERY, TEXT_EVERY, normalizePhrases } from '../../music/shaderText';
  import { followedMix, studioCodeTick, studioVoiceBlend, studioRenderInputs, studioVoiceCode, type StudioVoice } from '../../music/studioPlugin';
  import {
    addStudioVoice,
    editStudio,
    loadSceneIntoStudio,
    moveStudioVoice,
    placeStudio,
    removeStudioVoice,
    replaceStudioVoice,
    setStudioMix,
    setStudioVoice,
    studioTarget,
  } from '../../music/studioTarget';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { stepVoiceLook, toggledVoiceLevel } from '../../music/studioMidiControls';
  import StudioModule from './StudioModule.svelte';
  import StudioKnob from './StudioKnob.svelte';

  /** Main controls shown on each voice; the rest open under it. */
  const MAIN_CONTROLS = 4;
  const LOOK_SKIP = new Set(['vxSource', 'vxAuto', 'ink', 'accent']);

  const s = $derived($musicStudio);
  const target = $derived($studioTarget);
  const voices = $derived(target?.source.musicVoices ?? []);
  const mix = $derived(normalizeMix(target?.source.musicMix));
  let open = $state<number | null>(null);
  let activity = $state<number[]>([]);
  let codeTick = $state(0);

  const familyLabel = (id: string) => STUDIO_SETS.find((set) => set.id === id)?.label ?? id;
  const families = STUDIO_SETS.map((set) => ({ id: set.id, label: set.label, voices: VOICE_SHADERS.filter((v) => v.family === set.id) }));
  const ownScenes = $derived(VISUAL_SCENES.filter((sc) => sc.set === s.set));
  const otherScenes = $derived(VISUAL_SCENES.filter((sc) => sc.set !== s.set));

  // ── Ableton Live ──
  // While the studio plays with Live, each Live track (and each drum of a drum
  // track) is a sound a voice can follow, and the tracks with what they play
  // now are listed here to put visuals on.
  const liveOn = $derived(s.isOpen && s.liveControl && $abletonBridge.connected);
  const liveTracks = $derived.by(() => {
    if (!liveOn) return [];
    const keys = liveTrackKeys($abletonBridge.tracks);
    return $abletonBridge.tracks.map((t, i) => {
      const role = s.liveRoles[t.name] ?? null;
      const playing = t.playing >= 0 ? t.slots[t.playing] : null;
      const queued = t.fired >= 0 && t.fired !== t.playing ? t.slots[t.fired] : null;
      // `name` is the track's unique key (numbered when Live repeats a name).
      return { name: keys[i], color: t.color, midi: t.midi, drums: isDrumTrack(t, role), role, playing: playing?.name ?? null, queued: queued?.name ?? null };
    });
  });
  let liveListOpen = $state(true);
  const liveColor = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  /** A voice's follow value in the menu: its Live source while Live leads, its studio sound otherwise. */
  const followValue = (v: StudioVoice) => (liveOn && v.live ? v.live : v.source);
  const following = (src: LiveSourceId) => voices.filter((v) => v.live === src || (v.live?.startsWith(`${src}/`) ?? false)).length;

  /** A Live source's track colour, for the swatch on the visuals following it. */
  const liveColorOf = (src: LiveSourceId | undefined) => {
    if (!src) return null;
    const t = liveTracks.find((x) => src === liveSource(x.name) || src.startsWith(`${liveSource(x.name)}/`));
    return t ? liveColor(t.color) : null;
  };

  // When Live connects (or its tracks change), the visuals still following
  // the studio's own sounds move onto the matching Live tracks: Hats to the
  // Hats track, Kick to Kick (or a drum track's kick). Once per set of
  // tracks, so a visual put back on a studio sound by hand stays there.
  const matchedFor = new Set<string>();
  $effect(() => {
    if (!liveOn || !liveTracks.length || !target) return;
    const key = `${target.kind === 'layer' ? target.layerId : `${target.deck}:${target.layer}:${target.column}`}|${liveTracks.map((t) => t.name).join('\u0001')}`;
    if (matchedFor.has(key)) return;
    matchedFor.add(key);
    const tracks = liveTracks;
    untrack(() => editStudio((src) => {
      let changed = false;
      const musicVoices = src.musicVoices.map((v) => {
        if (v.live) return v;
        const live = liveMatchFor(v.source, tracks);
        if (!live) return v;
        changed = true;
        return { ...v, live };
      });
      return changed ? { ...src, musicVoices } : src;
    }));
  });

  /** Show the visuals on a Live track: scroll to the first and open its controls. */
  function showVisualsFor(src: LiveSourceId) {
    const i = voices.findIndex((v) => v.live === src || (v.live?.startsWith(`${src}/`) ?? false));
    if (i < 0) return;
    open = i;
    void nextTick().then(() => document.querySelectorAll<HTMLElement>('.voices .voice')[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  function setFollow(i: number, value: string) {
    if (isLiveSource(value)) setStudioVoice(i, { live: value });
    else setStudioVoice(i, { source: value as VoiceSourceId, live: undefined });
  }

  /** The studio sound a voice on a Live track falls back to without Live. */
  function fallbackFor(track: { name: string; role: VoiceSourceId | null }, drum?: LiveDrum): VoiceSourceId {
    return drum ?? track.role ?? guessRole(track.name) ?? 'all';
  }

  function addForTrack(track: (typeof liveTracks)[number], drum?: LiveDrum) {
    const live = liveSource(track.name, drum);
    const what = drum ? `${track.name}: ${LIVE_DRUMS.find((d) => d.id === drum)?.label}` : track.name;
    visualPicker.set({ current: null, none: false, title: `A visual for ${what}`, pick: (f) => { const at = voices.length; if (f && addStudioVoice(f, fallbackFor(track, drum), live)) { open = at; void nextTick().then(() => document.querySelectorAll<HTMLElement>('.voices .voice')[at]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })); } } });
  }

  function addFromMenu(track: (typeof liveTracks)[number], e: Event) {
    const el = e.target as HTMLSelectElement;
    const value = el.value;
    el.value = '';
    if (value === 'track') addForTrack(track);
    else if (value) addForTrack(track, value as LiveDrum);
  }

  const where = $derived(
    !target ? '' : target.kind === 'vj' ? `Deck ${target.deck}, row ${target.layer + 1}${target.playing ? '' : ' (stopped)'}` : `Layer: ${target.name}`,
  );

  function looks(file: string): ShaderInput[] {
    void codeTick;
    const code = studioVoiceCode(file);
    return code ? shaderInputs(code).filter((i) => (i.TYPE === 'float' || i.TYPE === 'long') && !LOOK_SKIP.has(i.NAME) && !isVoiceDrivenInput(i.NAME)) : [];
  }

  /**
   * Cut out: a transparent background, stacked over the voices below with
   * plain source-over, like drawings on acetate. Picking a blend mode turns it off.
   */
  const CUT_OUT = 'cut-out';
  function setVoiceBlend(i: number, value: string) {
    if (value === CUT_OUT) setStudioVoice(i, { clear: true, blend: 'normal' });
    else setStudioVoice(i, { clear: false, blend: value as BlendMode });
  }

  /** True for a visual that draws lettering, so it takes your own text. */
  function takesText(file: string): boolean {
    void codeTick;
    const code = studioVoiceCode(file);
    return !!code && shaderInputs(code).some((i) => i.NAME === 'vxTxtLen');
  }

  // Your phrases, one a line. What you type stays as typed while the box has
  // focus (the saved text is cleaned: capitals, 12 characters).
  let textDraft = $state<Record<number, string>>({});
  function editText(i: number, raw: string) {
    textDraft = { ...textDraft, [i]: raw };
    setStudioVoice(i, { text: normalizePhrases(raw.split('\n')) }, `voice:${i}:text`);
  }
  function endText(i: number) {
    const { [i]: _, ...rest } = textDraft;
    textDraft = rest;
  }

  // How strongly each voice's sound plays now, for its light.
  let frame = 0;
  function tick() {
    const driven = voices.map((v) => studioRenderInputs.driven(v.source, v.auto, v.live));
    // With auto-mix on, a visual sitting out shows a dark light.
    const clock = driven[0];
    const followed = mix.follow ? followedMix() : [];
    const mixed = followed.length === voices.length ? followed : mixAt(mix, clock ? (clock.vxBars ?? 0) + (clock.vxBar ?? 0) : 0, voices.map((v) => v.level <= 0));
    const next = driven.map((d, i) => Math.min(1, (0.25 + 0.75 * (d.vxEnv ?? 0)) * (d.vxPresence ?? 1) * (mixed[i]?.gain ?? 1)));
    // Only repaint the lights when one has visibly changed.
    if (next.length !== activity.length || next.some((a, i) => Math.abs(a - activity[i]) > 0.01)) activity = next;
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  const unsub = studioCodeTick.subscribe((n) => (codeTick = n));
  onDestroy(() => {
    cancelAnimationFrame(frame);
    unsub();
  });

  function pickScene(e: Event) {
    const el = e.target as HTMLSelectElement;
    const scene = VISUAL_SCENES.find((sc) => sc.id === el.value);
    el.value = '';
    // A scene loads in the studio's own palette.
    if (scene) loadSceneIntoStudio({ ...scene, set: s.set });
  }

  /** A new instance starts with this set's first scene, in its palette. */
  function putInPlace() {
    if (!placeStudio()) return;
    const scene = VISUAL_SCENES.find((sc) => sc.set === s.set);
    if (scene) loadSceneIntoStudio(scene);
  }

  // Reordering: the voice being dragged, and the gap it would land in (0 = before the first).
  let dragFrom = $state<number | null>(null);
  let dropAt = $state<number | null>(null);
  function dropVoice() {
    if (dragFrom !== null && dropAt !== null) {
      const to = dropAt > dragFrom ? dropAt - 1 : dropAt;
      if (to !== dragFrom) {
        moveStudioVoice(dragFrom, to);
        if (open === dragFrom) open = to;
      }
    }
    dragFrom = null;
    dropAt = null;
  }

  function addVoice() {
    visualPicker.set({ current: null, none: false, title: 'Add a voice', pick: (f) => { const at = voices.length; if (f && addStudioVoice(f, 'all')) open = at; } });
  }

  const numberOf = (voice: StudioVoice, input: ShaderInput) => Number(voice.params[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0);
  const levelFormat = (v: number) => `${Math.round(v * 100)}%`;
  const valueFormat = (input: ShaderInput) => (v: number) => {
    const min = input.MIN ?? 0;
    const max = input.MAX ?? 1;
    return max - min > 4 ? String(Math.round(v)) : `${Math.round(((v - min) / (max - min || 1)) * 100)}%`;
  };
</script>

{#snippet knob(i: number, voice: StudioVoice, input: ShaderInput)}
  <StudioKnob
    label={input.LABEL ?? input.NAME}
    title={input.LABEL ?? input.NAME}
    value={numberOf(voice, input)}
    min={input.MIN ?? 0}
    max={input.MAX ?? 1}
    defaultValue={Number(input.DEFAULT ?? input.MIN ?? 0)}
    size={20}
    format={valueFormat(input)}
    onchange={(v) => setStudioVoice(i, { params: { [input.NAME]: input.TYPE === 'long' || (input.MAX ?? 1) - (input.MIN ?? 0) > 4 ? Math.round(v) : v } }, `voice:${i}:${input.NAME}`)}
  />
{/snippet}

<StudioModule title="Visuals" subtitle={where} grow>
  {#snippet head()}
    <select class="scene" value="" onchange={pickScene} aria-label="Load a visual scene" title="Load a stack of voices for this set" data-midi-path="studio:visuals.scene-next" data-midi-label="Next visual scene" data-midi-mode="toggle">
      <option value="" disabled>Load scene…</option>
      {#each ownScenes as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
      {#if otherScenes.length}
        <optgroup label="Other sets">
          {#each otherScenes as sc (sc.id)}<option value={sc.id}>{familyLabel(sc.set)} · {sc.name}</option>{/each}
        </optgroup>
      {/if}
    </select>
  {/snippet}
  {#if liveOn}
    <section class="live" aria-label="Live tracks">
      <button class="live-head" onclick={() => (liveListOpen = !liveListOpen)} aria-expanded={liveListOpen} title={liveListOpen ? 'Fold the Live tracks away' : 'Show the Live tracks'}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d={liveListOpen ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} /></svg>
        <span class="ga-eyebrow">In Live now</span>
        <span class="live-count">{liveTracks.length} tracks</span>
      </button>
      {#if liveListOpen}
        <div class="live-tracks">
          {#each liveTracks as t, ti (ti)}
            <div class="live-track" class:quiet={!t.playing}>
              <span class="swatch" style="background: {liveColor(t.color)}"></span>
              <span class="live-name" title={t.name}>{t.name}</span>
              <span class="live-clip" title={t.playing ? `Playing ${t.playing}${t.queued ? `, ${t.queued} next` : ''}` : 'Nothing playing'}>{t.playing ?? '—'}{#if t.queued} → {t.queued}{/if}</span>
              {#if following(liveSource(t.name))}<button class="live-n" onclick={() => showVisualsFor(liveSource(t.name))} title="Show the visuals following this track">{following(liveSource(t.name))}</button>{/if}
              {#if t.drums}
                <select class="live-add" value="" onchange={(e) => addFromMenu(t, e)} aria-label="Add a visual for {t.name}" title="Add a visual that follows this track, or one of its drums">
                  <option value="" disabled>+ Visual</option>
                  <option value="track">Whole track</option>
                  {#each LIVE_DRUMS as d (d.id)}<option value={d.id}>{d.label}</option>{/each}
                </select>
              {:else}
                <button class="live-add studio-btn" onclick={() => addForTrack(t)} title="Add a visual that follows this track">+ Visual</button>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
  {#if !target}
    <div class="none">
      <p>The studio's visuals play in a Music Studio clip, so they never take over your deck rows. Drag Music Studio from Plugins onto a cell, or put one here.</p>
      <button class="studio-btn" onclick={putInPlace}>{$vjClipLauncher.isOpen ? 'Put it on the deck' : 'Show it on the selected layer'}</button>
    </div>
  {:else}
    <div class="automix">
      <span class="ga-eyebrow">Auto-mix</span>
      <select value={mix.mode} onchange={(e) => setStudioMix({ mode: (e.target as HTMLSelectElement).value as MixMode })} aria-label="Auto-mix" title={MIX_MODES.find((m) => m.id === mix.mode)?.title} data-midi-path="studio:visuals.automix-next" data-midi-label="Next auto-mix mode" data-midi-mode="toggle">
        {#each MIX_MODES as m (m.id)}<option value={m.id} title={m.title}>{m.label}</option>{/each}
      </select>
      <select value={String(mix.bars)} onchange={(e) => setStudioMix({ bars: Number((e.target as HTMLSelectElement).value) })} disabled={mix.mode === 'all'} aria-label="Auto-mix changes every" title={mix.follow ? 'The usual pace; the music speeds it up or slows it down' : 'How often the mix changes, on the beat grid'}>
        {#each MIX_BAR_OPTIONS as o (o.bars)}<option value={String(o.bars)}>{o.label}</option>{/each}
      </select>
      <button class="text-btn small follow" class:on={mix.follow} aria-pressed={mix.follow} disabled={mix.mode === 'all'} onclick={() => setStudioMix({ follow: !mix.follow })} title="Follow the music: busy, loud playing changes faster (and shuffle shows more at once); sparse, quiet playing changes slower. Up to two steps either side of the pace you set." data-midi-path="studio:visuals.automix-follow" data-midi-label="Auto-mix follows the music" data-midi-mode="toggle">Follow</button>
    </div>
    <p class="order">Top of the list draws on top · drag ⋮⋮ or Alt+↑↓ to reorder</p>
    <div class="voices">
      {#each voices as voice, i (i)}
        {@const all = looks(voice.file)}
        <div
          class="voice"
          class:dragging={dragFrom === i}
          class:drop-before={dropAt === i && dragFrom !== null && dragFrom !== i && dragFrom !== i - 1}
          class:drop-after={dropAt === voices.length && i === voices.length - 1 && dragFrom !== null && dragFrom !== i}
          role="listitem"
          ondragover={(e) => { if (dragFrom === null) return; e.preventDefault(); const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); dropAt = e.clientY < r.top + r.height / 2 ? i : i + 1; }}
          ondrop={(e) => { e.preventDefault(); dropVoice(); }}
        >
          <div class="line">
            <span
              class="grip"
              draggable="true"
              role="button"
              tabindex="0"
              aria-label="Move voice {i + 1} (Alt+Up or Alt+Down)"
              title="Drag to reorder: the top of the list draws on top"
              ondragstart={(e) => { dragFrom = i; e.dataTransfer?.setData('text/plain', `voice ${i + 1}`); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
              ondragend={() => { dragFrom = null; dropAt = null; }}
              onkeydown={(e) => { if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return; e.preventDefault(); const to = i + (e.key === 'ArrowUp' ? -1 : 1); if (to >= 0 && to < voices.length && moveStudioVoice(i, to)) void nextTick().then(() => document.querySelectorAll<HTMLElement>('.voices .grip')[to]?.focus()); }}
            >⋮⋮</span>
            <button
              class="led"
              class:on={voice.level > 0}
              style="--a: {activity[i] ?? 0}"
              onclick={() => setStudioVoice(i, { level: toggledVoiceLevel(i, voice.level) })}
              aria-pressed={voice.level === 0}
              aria-label="Mute voice {i + 1}"
              title={voice.level > 0 ? 'Mute this voice' : 'Bring this voice back'}
              data-midi-path="studio:voice.{i + 1}.mute"
              data-midi-label="Voice {i + 1} mute"
              data-midi-mode="toggle"
            ></button>
            <button class="icon step" onclick={() => stepVoiceLook(i, -1)} aria-label="Previous look for voice {i + 1}" title="Previous look" data-midi-path="studio:voice.{i + 1}.look-prev" data-midi-label="Voice {i + 1} previous look" data-midi-mode="toggle">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M7.5 3 4.5 6l3 3" /></svg>
            </button>
            <span class="pick"><VisualPickButton file={voice.file} label="Voice {i + 1}" title="Visual for voice {i + 1}" onpick={(f) => { if (f) replaceStudioVoice(i, f); }} /></span>
            <button class="icon step" onclick={() => stepVoiceLook(i, 1)} aria-label="Next look for voice {i + 1}" title="Next look" data-midi-path="studio:voice.{i + 1}.look-next" data-midi-label="Voice {i + 1} next look" data-midi-mode="toggle">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3 7.5 6l-3 3" /></svg>
            </button>
            {#if liveOn && liveColorOf(voice.live)}<span class="follow-swatch" style="background: {liveColorOf(voice.live)}" aria-hidden="true"></span>{/if}
            <select class="follows" class:live={liveOn && !!voice.live} value={followValue(voice)} onchange={(e) => setFollow(i, (e.target as HTMLSelectElement).value)} aria-label="Sound voice {i + 1} follows" title={liveOn && voice.live ? 'The Live track this voice follows' : 'The sound this voice follows'} data-midi-path="studio:voice.{i + 1}.follow-next" data-midi-label="Voice {i + 1} next sound to follow" data-midi-mode="toggle">
              {#if liveOn}
                <optgroup label="Ableton Live">
                  {#each liveTracks as t, ti (ti)}
                    <option value={liveSource(t.name)}>{t.name}</option>
                    {#if t.drums}{#each LIVE_DRUMS as d (d.id)}<option value={liveSource(t.name, d.id)}>{t.name}: {d.label}</option>{/each}{/if}
                  {/each}
                  {#if voice.live && !liveTracks.some((t) => voice.live === liveSource(t.name) || voice.live?.startsWith(`${liveSource(t.name)}/`))}
                    <option value={voice.live}>{voice.live.slice(5)} (not in this set)</option>
                  {/if}
                </optgroup>
                <optgroup label="Studio">
                  {#each voiceSourcesFor($musicStudio.set, voice.source) as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
                </optgroup>
              {:else}
                {#each voiceSourcesFor($musicStudio.set, voice.source) as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
              {/if}
            </select>
            <button class="auto studio-btn" class:on={voice.auto} onclick={() => setStudioVoice(i, { auto: !voice.auto })} aria-pressed={voice.auto} title={voice.auto ? 'Shows only while its sound plays' : 'Always shows'}>Auto</button>
            <button class="icon" onclick={() => removeStudioVoice(i)} aria-label="Remove voice {i + 1}" title="Remove this voice">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
            </button>
          </div>
          <div class="controls">
            {#each all.slice(0, MAIN_CONTROLS) as input (input.NAME)}{@render knob(i, voice, input)}{/each}
            <select class="blend" class:cut={voice.clear} value={voice.clear ? CUT_OUT : studioVoiceBlend(voice.blend)} onchange={(e) => setVoiceBlend(i, (e.target as HTMLSelectElement).value)} aria-label="Blend mode for voice {i + 1}" title={voice.clear ? 'Cut out: only its picture draws, over the voices below like a drawing; its empty space shows them through' : 'How this voice blends over the ones below it'} data-midi-path="studio:voice.{i + 1}.blend-next" data-midi-label="Voice {i + 1} next blend mode" data-midi-mode="toggle">
              <option value={CUT_OUT}>Cut out</option>
              <optgroup label="Blend">
                {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
              </optgroup>
            </select>
            <StudioKnob label="Opacity" title="How much of this voice shows" value={voice.level} defaultValue={1} size={20} format={levelFormat} midiPath="studio:voice.{i + 1}.level" onchange={(v) => setStudioVoice(i, { level: v }, `voice:${i}:level`)} />
            {#if all.length > MAIN_CONTROLS || takesText(voice.file)}
              <button class="icon more" class:on={open === i} onclick={() => (open = open === i ? null : i)} aria-expanded={open === i} aria-label="All controls for voice {i + 1}" title="All controls">
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d={open === i ? 'M3 7.5L6 4.5 9 7.5' : 'M3 4.5L6 7.5 9 4.5'} /></svg>
              </button>
            {/if}
          </div>
          {#if open === i && takesText(voice.file)}
            <div class="text-edit">
              <label class="ga-eyebrow" for="voice-text-{i}">Text</label>
              <textarea
                id="voice-text-{i}"
                rows="3"
                spellcheck="false"
                placeholder="One phrase a line"
                value={textDraft[i] ?? (voice.text ?? []).join('\n')}
                oninput={(e) => editText(i, (e.target as HTMLTextAreaElement).value)}
                onblur={() => endText(i)}
                onkeydown={(e) => e.stopPropagation()}
                title="Your own words for this visual, one phrase a line: up to 12 letters, numbers and . ! ? - + ' : / &. Empty shows its own."
              ></textarea>
              <div class="text-row">
                <select value={String(voice.textEvery ?? DEFAULT_TEXT_EVERY)} onchange={(e) => setStudioVoice(i, { textEvery: Number((e.target as HTMLSelectElement).value) })} disabled={(voice.text?.length ?? 0) < 2} aria-label="Change phrase" title="How often it moves on to the next phrase">
                  {#each TEXT_EVERY as o (o.id)}<option value={String(o.id)}>{o.label}</option>{/each}
                </select>
                {#if !voice.text?.length}<span class="text-note">Shows its own words</span>{/if}
              </div>
            </div>
          {/if}
          {#if open === i}
            <div class="all">
              {#each all.slice(MAIN_CONTROLS) as input (input.NAME)}{@render knob(i, voice, input)}{/each}
            </div>
          {/if}
        </div>
      {/each}
      <button class="add studio-btn dashed" onclick={addVoice} title="Add a voice to this studio">+ Voice</button>
    </div>
  {/if}
</StudioModule>

<style>
  .automix { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; }
  .automix .ga-eyebrow { color: var(--studio-muted); flex: 0 0 auto; }
  .automix select { flex: 1 1 0; min-width: 0; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .automix .follow { flex: 0 0 auto; height: 22px; padding: 0 7px; }
  .live { flex: 0 0 auto; margin-bottom: 6px; border-bottom: 1px solid var(--studio-edge-soft); padding-bottom: 4px; }
  .live-head { display: flex; align-items: center; gap: 6px; width: 100%; padding: 2px 0; border: 0; background: none; color: var(--studio-ink); cursor: pointer; text-align: left; }
  .live-head svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; flex: 0 0 auto; }
  .live-count { margin-left: auto; font-size: var(--ga-text-micro, 9px); color: var(--studio-muted); }
  /* A long set scrolls here rather than pushing the visuals away. */
  .live-tracks { max-height: 168px; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; padding-top: 2px; }
  .live-track { display: flex; align-items: center; gap: 6px; min-width: 0; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .live-track.quiet .live-name, .live-track.quiet .live-clip { color: var(--studio-muted); }
  .swatch { flex: 0 0 auto; width: 8px; height: 8px; border-radius: 2px; }
  .live-name { flex: 0 1 38%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--studio-ink); }
  .live-clip { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--studio-muted); }
  .follow-swatch { flex: 0 0 auto; width: 6px; align-self: stretch; margin: 3px -2px 3px 0; border-radius: 2px; }
  .live-n { cursor: pointer; border: 0; flex: 0 0 auto; min-width: 14px; height: 14px; padding: 0 3px; border-radius: 7px; background: var(--studio-accent-soft, rgba(255,255,255,0.1)); color: var(--studio-accent); font-size: 9px; line-height: 14px; text-align: center; }
  .live-add { flex: 0 0 auto; height: 20px; padding: 0 6px; font-size: var(--ga-text-meta, 11px); }
  select.live-add { width: 74px; }
  .follows.live { color: var(--studio-accent); }
  .voices { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .voice { padding: 4px 0; border-bottom: 1px solid var(--studio-edge-soft); }
  .voice.dragging { opacity: 0.4; }
  /* Where a dragged voice will land: a line in the gap. */
  .voice.drop-before { box-shadow: inset 0 2px 0 var(--studio-accent); }
  .voice.drop-after { box-shadow: inset 0 -2px 0 var(--studio-accent); }
  .grip { flex: 0 0 auto; cursor: grab; color: var(--studio-muted); font-size: 10px; letter-spacing: -2px; padding: 0 2px; user-select: none; }
  .grip:focus-visible { outline: 1px solid var(--studio-accent); border-radius: 2px; }
  .order { margin: 0 0 4px; font-size: var(--ga-text-micro, 9px); color: var(--studio-muted); }
  .voice:last-of-type { border-bottom: 0; }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .led {
    position: relative;
    flex: 0 0 auto;
    width: 9px;
    height: 9px;
    padding: 0;
    border-radius: 50%;
    border: 1px solid var(--studio-edge);
    background: transparent;
    cursor: pointer;
  }
  /* A finger-sized target around the light; it mutes the voice. */
  .led::after { content: ''; position: absolute; inset: -6px; }
  .led.on {
    border-color: var(--studio-accent);
    background: color-mix(in srgb, var(--studio-accent) calc(25% + var(--a) * 75%), transparent);
    box-shadow: 0 0 calc(var(--a) * 8px) var(--studio-accent);
  }
  .pick { flex: 1 1 0; min-width: 0; }
  .follows { flex: 1 1 0; min-width: 0; color: var(--studio-muted); }
  /* The blend sits with the knobs, as narrow as a knob column. */
  .blend { flex: 0 0 74px; min-width: 0; height: 20px; padding: 0 4px; align-self: center; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .line .auto { flex: 0 0 auto; padding: 0 7px; font-size: var(--ga-text-meta, 11px); }
  .line .auto:not(.on) { color: var(--studio-muted); }
  .controls { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; padding: 3px 0 0 15px; }
  .controls :global(.knob-wrap), .all :global(.knob-wrap) { gap: 1px; min-width: 0; flex: 1 1 0; }
  .all :global(.knob-wrap) { flex: 0 0 52px; }
  /* Shader parameter names run long: two lines, centred, before any cut. */
  /* Shader parameter names run long: they wrap between words onto a second
     line, never inside a word ("OPACIT Y"); a single word too long for the
     column is clipped rather than split (its full name is the knob's tooltip). */
  .controls :global(.knob-label), .all :global(.knob-label) {
    max-width: 100%;
    overflow: hidden;
    white-space: normal;
    text-align: center;
    font-size: 8.5px;
    letter-spacing: 0;
    line-height: 1.1;
    min-height: 2.2em;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    overflow-wrap: normal;
    word-break: keep-all;
  }
  .icon {
    flex: 0 0 auto;
    width: 22px;
    height: 22px;
    padding: 0;
    display: grid;
    place-items: center;
    border: 1px solid var(--studio-edge-soft);
    background: transparent;
    color: var(--studio-muted);
    border-radius: var(--studio-radius);
    cursor: pointer;
  }
  .more { align-self: center; }
  .line .step { width: 16px; }
  .icon svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .icon.on, .icon:hover { color: var(--studio-ink); border-color: var(--studio-edge); }
  .blend.cut { color: var(--studio-accent); }
  .text-edit { display: flex; flex-direction: column; gap: 4px; padding: 8px 0 0 15px; }
  .text-edit textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 52px; padding: 5px 7px; font: 12px/1.35 var(--ga-font-mono, ui-monospace); text-transform: uppercase; color: var(--studio-ink); background: var(--studio-well, rgba(0,0,0,0.35)); border: 1px solid var(--studio-edge); border-radius: 6px; user-select: text; }
  .text-edit textarea:focus { outline: none; border-color: var(--studio-accent); }
  .text-row { display: flex; align-items: center; gap: 8px; }
  .text-row select { flex: 0 1 auto; min-width: 0; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .text-note { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .all { display: flex; flex-wrap: wrap; gap: 8px 6px; padding: 8px 0 2px 15px; }
  .add { align-self: flex-start; margin-top: 6px; }
  .none { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 4px 2px; }
  .none p { margin: 0; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--studio-muted); }
</style>
