<script lang="ts">
  /**
   * The studio's visuals as one list, the top drawing on top: the audio
   * shaders of the instance it plays to (a studio clip in a VJ cell, or a
   * mapping layer showing the studio) and the visuals of the clips playing
   * now (clip stacks, studio and Ableton Live clips alike), in any order
   * (visualOrder.ts). Each audio shader shows what it follows and its main
   * controls; a clip opens to its layers, and Edit opens the clip visuals
   * editor. Look sets the colors and finish over everything; auto-mix, under
   * the list, lets the visuals take turns (a clip's visuals as one). With no instance yet, one is
   * put on the deck (or the selected layer).
   */
  import { onDestroy, tick as nextTick, untrack } from 'svelte';
  import { musicStudio } from '../../music/musicStudioStore';
  import { STUDIO_SETS } from '../../music/studioSets';
  import { voiceSourcesFor, isVoiceDrivenInput, isLiveSource, liveSource, loopTrackOfSource, loopTrackSource, LIVE_DRUMS, type LiveSourceId, type VoiceSourceId } from '../../music/visualVoices';
  import { abletonBridge } from '../../ableton/abletonBridge';
  import { isDrumTrack, liveMatchFor, liveTrackKeys } from '../../music/liveControl';
  import { VISUAL_SCENES, VOICE_SHADERS, shaderInputs, voiceShaderByFile, type ShaderInput } from '../../music/visualScenes';
  import { visualPicker } from '../../music/studioUi';
  import { BLEND_MODE_ORDER, blendModeLabel, type BlendMode } from '../../types';
  import { MIX_BAR_OPTIONS, MIX_MODES, mixAt, normalizeMix, type MixMode } from '../../music/studioMix';
  import { DEFAULT_TEXT_EVERY, TEXT_EVERY, normalizePhrases } from '../../music/shaderText';
  import EngineScanPicker from './EngineScanPicker.svelte';
  import { engineInstrumentOf } from '../../music/engineVoices';
  import { lastStudioMix, studioCodeTick, studioVoiceBlend, studioRenderInputs, studioVoiceCode, type StudioVoice } from '../../music/studioPlugin';
  import {
    addStudioVoice,
    editStudio,
    loadSceneIntoStudio,
    arrangeStudioVisuals,
    setStackOff,
    placeStudio,
    removeStudioVoice,
    showStudioVisuals,
    replaceStudioVoice,
    setStudioFinish,
    setStudioPalette,
    setStudioMix,
    setStudioVoice,
    studioTarget,
  } from '../../music/studioTarget';
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { toggledVoiceLevel } from '../../music/studioMidiControls';
  import { playingStacks, stayingStacks, type StackEntry } from '../../music/stackRuntime';
  import { hasVisuals, type ClipStack, type StackItem } from '../../music/clipStack';
  import { stackEditor } from '../../music/studioUi';
  import { arrangeVisuals, moveVisualRow, visualOrder } from '../../music/visualOrder';
  import { DRIFT_DEFAULTS, driftCycleSeconds, driftRanges, toggledDrift, toggledHold } from '../../music/visualDrift';
  import StudioModule from './StudioModule.svelte';
  import NumericInput from '../NumericInput.svelte';
  import StudioKnob from './StudioKnob.svelte';
  import VoiceThumb from './VoiceThumb.svelte';
  import { STUDIO_GRADES, normalizeFinish, type StudioGrade } from '../../music/studioFinish';
  import { AUTO_PALETTE, CLASSIC_PALETTE, KEY_PALETTE, SET_PALETTE, STUDIO_PALETTE_LIST } from '../../music/studioPalettes';

  /** Main controls shown on each voice; the rest open under it. */
  const LOOK_SKIP = new Set(['vxSource', 'vxAuto', 'ink', 'accent']);

  const s = $derived($musicStudio);
  const target = $derived($studioTarget);
  const voices = $derived(target?.source.musicVoices ?? []);
  const mix = $derived(normalizeMix(target?.source.musicMix));
  const finish = $derived(normalizeFinish(target?.source.musicFinish));
  const paletteId = $derived(target?.source.musicPalette ?? CLASSIC_PALETTE);
  const autoName = $derived(STUDIO_PALETTE_LIST.find((p) => p.id === SET_PALETTE[s.set])?.name ?? '');
  /** Voices whose own settings are showing (by row), kept while the rack is open. */
  let openRows = $state<Set<number>>(new Set());
  function toggleOpen(i: number) {
    const next = new Set(openRows);
    if (next.has(i)) next.delete(i); else next.add(i);
    openRows = next;
  }
  let activity = $state<number[]>([]);
  /** Each track's clip visuals' light: dark while auto-mix has them sitting out. */
  let clipActivity = $state<Record<string, number>>({});
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
  const liveColor = (c: number) => `#${(c & 0xffffff).toString(16).padStart(6, '0')}`;
  /** A voice's follow value in the menu: its Live source while Live leads, its studio sound otherwise. */
  const followValue = (v: StudioVoice) => ((liveOn && v.live) || loopTrackOfSource(v.live) >= 0 ? v.live! : v.source);

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

  function setFollow(i: number, value: string) {
    if (isLiveSource(value)) setStudioVoice(i, { live: value });
    else setStudioVoice(i, { source: value as VoiceSourceId, live: undefined });
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
    // With auto-mix on, a visual sitting out shows a dark light: the mix the
    // renderer worked out last (voices and clips take turns together), or,
    // before it has drawn this instance, the voices' turns on their own.
    const rendered = lastStudioMix();
    const clock = driven[0];
    const gains = rendered.voices.length === voices.length
      ? rendered.voices
      : mixAt(mix, clock ? (clock.vxBars ?? 0) + (clock.vxBar ?? 0) : 0, voices.map((v) => v.level <= 0)).map((m) => m.gain);
    const next = driven.map((d, i) => Math.min(1, (0.25 + 0.75 * (d.vxEnv ?? 0)) * (d.vxPresence ?? 1) * (gains[i] ?? 1)));
    // Only repaint the lights when one has visibly changed.
    if (next.length !== activity.length || next.some((a, i) => Math.abs(a - activity[i]) > 0.01)) activity = next;
    const clipNext: Record<string, number> = {};
    for (const { entry } of stacks) clipNext[entry.track] = 0.6 * (rendered.tracks.get(entry.track) ?? 1);
    if (Object.keys(clipNext).length !== Object.keys(clipActivity).length || Object.entries(clipNext).some(([t, a]) => Math.abs(a - (clipActivity[t] ?? -1)) > 0.01)) clipActivity = clipNext;
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
  const unsub = studioCodeTick.subscribe((n) => (codeTick = n));
  onDestroy(() => {
    cancelAnimationFrame(frame);
    unsub();
  });

  const ADD_VOICE = '__voice';
  function pickAdd(e: Event) {
    const el = e.target as HTMLSelectElement;
    const value = el.value;
    el.value = '';
    if (value === ADD_VOICE) {
      addVoice();
      return;
    }
    const scene = VISUAL_SCENES.find((sc) => sc.id === value);
    // A scene loads in the studio's own palette.
    if (scene) loadSceneIntoStudio({ ...scene, set: s.set });
  }

  /** A new instance starts with this set's first scene, in its palette. */
  function putInPlace() {
    if (target) {
      showStudioVisuals();
      return;
    }
    if (!placeStudio()) return;
    const scene = VISUAL_SCENES.find((sc) => sc.set === s.set);
    if (scene) loadSceneIntoStudio(scene);
  }

  // ── The playing clips' visuals ──
  // Read through the studio store so an edit shows here at once.
  const stacks = $derived(stayingStacks($playingStacks).map((entry) => {
    void s;
    return { entry, stack: entry.resolve() };
  }).filter((x): x is { entry: StackEntry; stack: ClipStack } => hasVisuals(x.stack)));
  const places = $derived(target?.source.musicStackPlace ?? {});
  const stacksOff = $derived(new Set(target?.source.musicStackOff ?? []));
  /** The whole list, top first. */
  const rows = $derived(visualOrder(voices.length, stacks.map((x) => x.entry), places));
  let openStack = $state<string | null>(null);
  let itemFrom = $state<{ uid: string; k: number } | null>(null);

  function saveStack(entry: StackEntry, stack: ClipStack) {
    if (entry.clipId) musicStudio.setClipStack(entry.clipId, stack);
    else if (entry.liveKey) musicStudio.setLiveStack(entry.liveKey, stack);
  }
  function edit(entry: StackEntry) {
    const title = `${entry.trackName} · ${entry.clipName}`;
    if (entry.clipId) stackEditor.set({ kind: 'clip', clipId: entry.clipId, title });
    else if (entry.liveKey) stackEditor.set({ kind: 'live', key: entry.liveKey, title, follow: liveSource(entry.track.replace(/^live:/, '')) });
  }
  function moveItem(entry: StackEntry, stack: ClipStack, from: number, to: number) {
    if (from === to) return;
    const items = [...stack.items];
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    saveStack(entry, { ...stack, items });
  }
  const itemKind = (item: StackItem) => (item.voice ? 'Audio shader' : ({ video: 'Video', image: 'Image', shader: 'Shader', sketch: 'Sketch' } as Record<string, string>)[item.media?.kind ?? ''] ?? 'Layer');

  // ── Look ──
  let lookOpen = $state(false);
  const paletteName = $derived(
    paletteId === AUTO_PALETTE ? autoName : paletteId === KEY_PALETTE ? 'Key color' : paletteId === CLASSIC_PALETTE ? 'Classic' : (STUDIO_PALETTE_LIST.find((p) => p.id === paletteId)?.name ?? 'Look'),
  );
  const lookSummary = $derived(`${paletteName} · ${STUDIO_GRADES.find((g) => g.id === finish.grade)?.label ?? ''}`);

  // ── Reordering the list: the row being dragged, and the gap it would land in (0 = before the first). ──
  let dragFrom = $state<number | null>(null);
  let dropAt = $state<number | null>(null);
  function reorder(from: number, to: number) {
    if (to === from || from < 0 || from >= rows.length) return false;
    const next = moveVisualRow(rows, from, to);
    const { voices: order, places: placed } = arrangeVisuals(next, stacks.map((x) => x.entry));
    // Open audio shaders stay open under their new numbers.
    const opened = [...openRows];
    if (!arrangeStudioVisuals(order, placed)) return false;
    openRows = new Set(opened.map((k) => order.indexOf(k)).filter((k) => k >= 0));
    return true;
  }
  function dropRow() {
    if (dragFrom !== null && dropAt !== null) reorder(dragFrom, dropAt > dragFrom ? dropAt - 1 : dropAt);
    dragFrom = null;
    dropAt = null;
  }
  function nudge(r: number, by: number) {
    const to = r + by;
    if (to < 0 || to >= rows.length || !reorder(r, to)) return;
    void nextTick().then(() => document.querySelectorAll<HTMLElement>('.list .grip')[to]?.focus());
  }

  function addVoice() {
    if (!target && !placeStudio()) return;
    visualPicker.set({ current: null, none: false, title: 'Add an audio shader', pick: (f) => { const at = voices.length; if (f && addStudioVoice(f, 'all')) openRows = new Set([...openRows, at]); } });
  }

  // ── Drift: its settings slowly wander on their own (visualDrift.ts) ──
  function toggleDrift(i: number, voice: StudioVoice) {
    const next = toggledDrift(voice.drift);
    setStudioVoice(i, { drift: next });
    // Turned on: show its amount, speed and which settings drift.
    if (next.on) openRows = new Set([...openRows, i]);
  }
  /** The settings of a visual that can drift (decimal settings, not counts or what the sound drives). */
  function driftNames(file: string): Set<string> {
    void codeTick;
    return new Set(driftRanges(studioVoiceCode(file)).map((r) => r.name));
  }
  /** Speed as the time of one swing, m:ss. */
  const cycleFormat = (v: number) => {
    const sec = Math.round(driftCycleSeconds(v));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  const numberOf = (voice: StudioVoice, input: ShaderInput) => Number(voice.params[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0);
  const levelFormat = (v: number) => `${Math.round(v * 100)}%`;
  const valueFormat = (input: ShaderInput) => (v: number) => {
    const min = input.MIN ?? 0;
    const max = input.MAX ?? 1;
    return max - min > 4 ? String(Math.round(v)) : `${Math.round(((v - min) / (max - min || 1)) * 100)}%`;
  };
</script>

{#snippet driftEdit(i: number, voice: StudioVoice, all: ShaderInput[])}
  {@const d = voice.drift!}
  {@const free = driftNames(voice.file)}
  <div class="drift-edit" role="group" aria-label="Drift for voice {i + 1}">
    <span class="ga-eyebrow">Drift</span>
    <div class="drift-sliders">
      <NumericInput label="Amount" title="How far its settings wander from where you set them" value={d.amount} min={0} max={1} step={0.01} defaultValue={DRIFT_DEFAULTS.amount} displayValue={levelFormat} on:input={(e) => setStudioVoice(i, { drift: { ...d, amount: e.detail } }, `voice:${i}:drift-amount`)} />
      <NumericInput label="Speed" title="How fast they wander: the time for one slow swing, in minutes and seconds" value={d.speed} min={0} max={1} step={0.01} defaultValue={DRIFT_DEFAULTS.speed} displayValue={cycleFormat} on:input={(e) => setStudioVoice(i, { drift: { ...d, speed: e.detail } }, `voice:${i}:drift-speed`)} />
    </div>
    {#if free.size}
      <div class="drift-params" role="group" aria-label="Settings that drift">
        {#each all.filter((input) => free.has(input.NAME)) as input (input.NAME)}
          {@const held = d.hold?.includes(input.NAME) ?? false}
          <button class="drift-chip" class:on={!held} aria-pressed={!held} onclick={() => setStudioVoice(i, { drift: toggledHold(d, input.NAME) })} title={held ? 'Kept where you set it. Click to let it drift.' : 'Drifts. Click to keep it where you set it.'}>{input.LABEL ?? input.NAME}</button>
        {/each}
      </div>
    {:else}
      <span class="text-note">This visual has no settings that can drift.</span>
    {/if}
  </div>
{/snippet}

{#snippet slider(i: number, voice: StudioVoice, input: ShaderInput)}
  {@const whole = input.TYPE === 'long' || (input.MAX ?? 1) - (input.MIN ?? 0) > 4}
  <NumericInput
    label={input.LABEL ?? input.NAME}
    title="{input.LABEL ?? input.NAME} (double-click: default)"
    value={numberOf(voice, input)}
    min={input.MIN ?? 0}
    max={input.MAX ?? 1}
    step={whole ? 1 : 0.01}
    defaultValue={Number(input.DEFAULT ?? input.MIN ?? 0)}
    displayValue={valueFormat(input)}
    on:input={(e) => setStudioVoice(i, { params: { [input.NAME]: whole ? Math.round(e.detail) : e.detail } }, `voice:${i}:${input.NAME}`)}
  />
{/snippet}

{#snippet grip(r: number, name: string)}
  <span
    class="grip"
    draggable="true"
    role="button"
    tabindex="0"
    aria-label="Move {name} (Alt+Up or Alt+Down)"
    title="Drag to reorder: the top of the list draws on top"
    ondragstart={(e) => { dragFrom = r; e.dataTransfer?.setData('text/plain', name); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
    ondragend={() => { dragFrom = null; dropAt = null; }}
    onkeydown={(e) => { if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return; e.preventDefault(); nudge(r, e.key === 'ArrowUp' ? -1 : 1); }}
  >⋮⋮</span>
{/snippet}

<StudioModule title="Visuals" subtitle={where} grow>
  {#snippet head()}
    {#if target}
      <button class="text-btn small look-btn" class:on={lookOpen} aria-expanded={lookOpen} onclick={() => (lookOpen = !lookOpen)} title="Colors, glow, trails, grain and grade over all the visuals">
        <span class="look-name">{lookSummary}</span>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d={lookOpen ? 'M3 7.5L6 4.5 9 7.5' : 'M3 4.5L6 7.5 9 4.5'} /></svg>
      </button>
    {/if}
    <select class="add-menu" value="" onchange={pickAdd} aria-label="Add visuals" title="Add an audio shader, or load a scene of them" data-midi-path="studio:visuals.scene-next" data-midi-label="Next visual scene" data-midi-mode="toggle">
      <option value="" disabled>+ Add</option>
      <option value={ADD_VOICE}>Audio shader…</option>
      <optgroup label="Load a scene">
        {#each ownScenes as sc (sc.id)}<option value={sc.id}>{sc.name}</option>{/each}
      </optgroup>
      {#if otherScenes.length}
        <optgroup label="Scenes from other sets">
          {#each otherScenes as sc (sc.id)}<option value={sc.id}>{familyLabel(sc.set)} · {sc.name}</option>{/each}
        </optgroup>
      {/if}
    </select>
  {/snippet}
  {#if target && lookOpen}
    <div class="look" role="group" aria-label="Look">
      <label class="look-row">
        <span class="ga-eyebrow">Color</span>
        <select value={paletteId} onchange={(e) => setStudioPalette((e.target as HTMLSelectElement).value)} title="The colors every audio shader takes, each by the role of what it follows">
          <option value={AUTO_PALETTE}>Auto · {autoName}</option>
          <option value={KEY_PALETTE}>Key color</option>
          {#each STUDIO_PALETTE_LIST as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
          <option value={CLASSIC_PALETTE}>Classic</option>
        </select>
      </label>
      <div class="look-row finish">
        <NumericInput label="Glow" title="Bloom around bright things" value={finish.glow} min={0} max={1} step={0.01} defaultValue={0.5} displayValue={levelFormat} midiPath="studio:visuals.glow" on:input={(e) => setStudioFinish({ glow: e.detail }, 'finish:glow')} />
        <NumericInput label="Trails" title="How long each hit leaves a fading tail" value={finish.trails} min={0} max={1} step={0.01} defaultValue={0.35} displayValue={levelFormat} midiPath="studio:visuals.trails" on:input={(e) => setStudioFinish({ trails: e.detail }, 'finish:trails')} />
        <NumericInput label="Grain" title="Film grain and a soft vignette" value={finish.grain} min={0} max={1} step={0.01} defaultValue={0.3} displayValue={levelFormat} midiPath="studio:visuals.grain" on:input={(e) => setStudioFinish({ grain: e.detail }, 'finish:grain')} />
        <label class="grade-wrap">
          <span class="ga-eyebrow">Grade</span>
          <select class="grade" value={finish.grade} onchange={(e) => setStudioFinish({ grade: (e.target as HTMLSelectElement).value as StudioGrade })} title="One look over every visual">
            {#each STUDIO_GRADES as g (g.id)}<option value={g.id}>{g.label}</option>{/each}
          </select>
        </label>
      </div>
    </div>
  {/if}
  <div class="body">
  {#if !target}
    <div class="none">
      <p>{$vjClipLauncher.isOpen ? 'The visuals go on a free deck row when the music starts.' : 'The visuals play on the selected layer.'}</p>
      <button class="studio-btn" onclick={putInPlace}>{$vjClipLauncher.isOpen ? 'Start the visuals now' : 'Put them on the selected layer'}</button>
    </div>
  {:else}
    <div class="list" role="list" aria-label="Visuals, top drawing on top">
      {#each rows as row, r (row.kind === 'voice' ? `v${row.index}` : stacks[row.index].entry.uid)}
        <div
          class="row"
          class:off={row.kind === 'stack' && stacksOff.has(stacks[row.index].entry.track)}
          class:dragging={dragFrom === r}
          class:drop-before={dropAt === r && dragFrom !== null && dragFrom !== r && dragFrom !== r - 1}
          class:drop-after={dropAt === rows.length && r === rows.length - 1 && dragFrom !== null && dragFrom !== r}
          role="listitem"
          ondragover={(e) => { if (dragFrom === null) return; e.preventDefault(); const box = (e.currentTarget as HTMLElement).getBoundingClientRect(); dropAt = e.clientY < box.top + box.height / 2 ? r : r + 1; }}
          ondrop={(e) => { if (dragFrom === null) return; e.preventDefault(); dropRow(); }}
        >
        {#if row.kind === 'stack'}
          {@const { entry, stack } = stacks[row.index]}
          <div class="line">
            {@render grip(r, `${entry.trackName} visuals`)}
            <button
              class="led"
              class:on={!stacksOff.has(entry.track)}
              style="--a: {clipActivity[entry.track] ?? 0.6}"
              onclick={() => setStackOff(entry.track, !stacksOff.has(entry.track))}
              aria-pressed={stacksOff.has(entry.track)}
              aria-label="Turn {entry.trackName}'s clip visuals on or off"
              title={stacksOff.has(entry.track) ? "Bring this track's clip visuals back" : "Switch this track's clip visuals off (its next clips stay off too)"}
            ></button>
            <button class="fold" onclick={() => (openStack = openStack === entry.uid ? null : entry.uid)} aria-expanded={openStack === entry.uid} aria-label="Layers of {entry.clipName}" title="Its layers">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d={openStack === entry.uid ? 'M3 4.5l3 3 3-3' : 'M4.5 3l3 3-3 3'} /></svg>
            </button>
            <span class="who" title="{entry.trackName} · {entry.clipName}: this clip's own visuals, while it plays"><span class="track">{entry.trackName}</span> {entry.clipName}</span>
            <button class="studio-btn edit" onclick={() => edit(entry)} title="Edit this clip's visuals">Edit</button>
          </div>
          <div class="controls stack-controls">
            <span class="clip-note">{stack.items.length === 1 ? 'Clip · 1 layer' : `Clip · ${stack.items.length} layers`}</span>
            <select class="blend" value={stack.blend} onchange={(e) => saveStack(entry, { ...stack, blend: (e.target as HTMLSelectElement).value as BlendMode })} aria-label="Blend of {entry.clipName}'s visuals" title="How this clip's visuals blend over the rows below">
              {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
            </select>
            <span class="opacity"><NumericInput label="Opacity" title="How much of this clip's visuals show" value={stack.opacity} min={0} max={1} step={0.01} defaultValue={1} displayValue={levelFormat} on:input={(e) => saveStack(entry, { ...stack, opacity: e.detail })} /></span>
          </div>
          {#if openStack === entry.uid}
            <ul class="layers">
              {#each stack.items as item, k (item.id)}
                <li
                  class:dragging={itemFrom?.uid === entry.uid && itemFrom.k === k}
                  draggable="true"
                  ondragstart={(e) => { e.stopPropagation(); itemFrom = { uid: entry.uid, k }; e.dataTransfer?.setData('text/plain', item.name); if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; }}
                  ondragend={() => (itemFrom = null)}
                  ondragover={(e) => { if (itemFrom?.uid !== entry.uid) return; e.preventDefault(); e.stopPropagation(); }}
                  ondrop={(e) => { if (!itemFrom || itemFrom.uid !== entry.uid) return; e.preventDefault(); e.stopPropagation(); moveItem(entry, stack, itemFrom.k, k); itemFrom = null; }}
                  title="Drag to reorder this clip's layers"
                >
                  <button class="eye" class:off={item.hidden} onclick={() => saveStack(entry, { ...stack, items: stack.items.map((x) => (x.id === item.id ? { ...x, hidden: !x.hidden } : x)) })} aria-pressed={!item.hidden} aria-label={item.hidden ? `Show ${item.name}` : `Hide ${item.name}`} title={item.hidden ? 'Show this layer' : 'Hide this layer'}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">{#if item.hidden}<path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4zM3 13 13 3" />{:else}<path d="M2 8s2.2-4 6-4 6 4 6 4-2.2 4-6 4-6-4-6-4z" /><circle cx="8" cy="8" r="1.8" />{/if}</svg>
                  </button>
                  <span class="kind">{itemKind(item)}</span>
                  <span class="item-name">{item.name}</span>
                  <input class="item-level" type="range" min="0" max="1" step="0.01" value={item.opacity} ondblclick={() => saveStack(entry, { ...stack, items: stack.items.map((x) => (x.id === item.id ? { ...x, opacity: 1 } : x)) })} oninput={(e) => { const v = Number((e.target as HTMLInputElement).value); saveStack(entry, { ...stack, items: stack.items.map((x) => (x.id === item.id ? { ...x, opacity: v } : x)) }); }} aria-label="How much of {item.name} shows" title="How much of {item.name} shows (double-click: full)" />
                </li>
              {/each}
            </ul>
          {/if}
        {:else}
          {@const i = row.index}
          {@const voice = voices[i]}
          {@const all = looks(voice.file)}
          {@const open = openRows.has(i)}
          {@const name = voiceShaderByFile(voice.file)?.name ?? voice.file.replace(/^VX-/, '').replace(/\.fs$/, '')}
          <div class="voice">
            {@render grip(r, `voice ${i + 1}`)}
            <button
              class="onoff"
              class:on={voice.level > 0}
              style="--a: {activity[i] ?? 0}"
              onclick={() => setStudioVoice(i, { level: toggledVoiceLevel(i, voice.level) })}
              aria-pressed={voice.level === 0}
              aria-label="Mute voice {i + 1}"
              title={voice.level > 0 ? 'Mute this voice' : 'Bring this voice back'}
              data-midi-path="studio:voice.{i + 1}.mute"
              data-midi-label="Voice {i + 1} mute"
              data-midi-mode="toggle"
            ><span class="led" aria-hidden="true"></span></button>
            <VoiceThumb file={voice.file} label="Voice {i + 1}" onclick={() => visualPicker.set({ current: voice.file, none: false, title: `Visual for voice ${i + 1}`, pick: (f) => { if (f) replaceStudioVoice(i, f); } })} />
            <span class="vname" title={name}>{name}</span>
            <StudioKnob label="Opacity" title="How much of this voice shows" value={voice.level} defaultValue={1} size={22} format={levelFormat} midiPath="studio:voice.{i + 1}.level" onchange={(v) => setStudioVoice(i, { level: v }, `voice:${i}:level`)} />
            <button class="icon fold-btn" class:open onclick={() => toggleOpen(i)} aria-expanded={open} aria-label="Settings of voice {i + 1}" title="This visual's own settings">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5L6 7.5 9 4.5" /></svg>
            </button>
            <button class="icon" onclick={() => removeStudioVoice(i)} aria-label="Remove voice {i + 1}" title="Remove this voice">
              <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
            </button>
            <div class="pair">
                <select class="follows" class:swatch={liveOn && !!liveColorOf(voice.live)} style:--follow={liveOn ? liveColorOf(voice.live) : undefined} class:live={liveOn && !!voice.live} class:loop={loopTrackOfSource(voice.live) >= 0} value={followValue(voice)} onchange={(e) => setFollow(i, (e.target as HTMLSelectElement).value)} aria-label="Sound voice {i + 1} follows" title={liveOn && voice.live ? 'The Live track this voice follows' : 'The sound this voice follows'} data-midi-path="studio:voice.{i + 1}.follow-next" data-midi-label="Voice {i + 1} next sound to follow" data-midi-mode="toggle">
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
                <optgroup label="Audio Lab">
                  {#each voiceSourcesFor($musicStudio.set, voice.source) as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
                </optgroup>
              {:else}
                {#each voiceSourcesFor($musicStudio.set, voice.source) as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
                <optgroup label="Live looper">
                  {#each { length: $musicStudio.loopStation.trackCount } as _, lt}<option value={loopTrackSource(lt)}>Loop {lt + 1}</option>{/each}
                </optgroup>
              {/if}
            </select>
                <select class="blend" class:cut={voice.clear} value={voice.clear ? CUT_OUT : studioVoiceBlend(voice.blend)} onchange={(e) => setVoiceBlend(i, (e.target as HTMLSelectElement).value)} aria-label="Blend mode for voice {i + 1}" title={voice.clear ? 'Cut out: only its picture draws, over the voices below like a drawing; its empty space shows them through' : 'How this voice blends over the ones below it'} data-midi-path="studio:voice.{i + 1}.blend-next" data-midi-label="Voice {i + 1} next blend mode" data-midi-mode="toggle">
              <option value={CUT_OUT}>Cut out</option>
              <optgroup label="Blend">
                {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
              </optgroup>
            </select>
            </div>
          </div>
          {#if open}
            <div class="expanded">
              <div class="toggles" role="group" aria-label="Voice {i + 1} behaviour">
                <button class="auto studio-btn" class:on={voice.auto} onclick={() => setStudioVoice(i, { auto: !voice.auto })} aria-pressed={voice.auto} title={voice.auto ? 'Shows only while its sound plays' : 'Always shows'}>Auto</button>
                <button class="drift-btn studio-btn" class:on={!!voice.drift?.on} onclick={() => toggleDrift(i, voice)} aria-pressed={!!voice.drift?.on} title={voice.drift?.on ? 'Drift is on: its settings slowly wander on their own, under the sound. Click to ease back to your settings.' : 'Drift: let its settings slowly wander on their own, so it keeps changing while it plays'}>Drift</button>
              </div>
              {#if voice.drift?.on}{@render driftEdit(i, voice, all)}{/if}
              {#if all.length}
                <div class="params">
                  {#each all as input (input.NAME)}{@render slider(i, voice, input)}{/each}
                </div>
              {/if}
          {#if takesText(voice.file)}
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
          {#if engineInstrumentOf(voice.file)?.cloud}
            <EngineScanPicker scan={voice.scan} layerSuffix=":{i}" onpick={(scan) => setStudioVoice(i, { scan })} />
          {/if}
            </div>
          {/if}
        {/if}
        </div>
      {/each}
      {#if !rows.length}<p class="empty">Nothing here yet. Add an audio shader, load a scene, or give a clip visuals with its picture button in the session grid.</p>{/if}
    </div>
    <p class="order">Top draws on top · drag ⋮⋮ or Alt+↑↓ to reorder</p>
  {/if}
  </div>
  {#if target}
    <div class="automix" role="group" aria-label="Auto-mix">
      <span class="ga-eyebrow" title="Let the visuals take turns on the beat: a clip's visuals take their turn together">Auto-mix</span>
      <select value={mix.mode} onchange={(e) => setStudioMix({ mode: (e.target as HTMLSelectElement).value as MixMode })} aria-label="Auto-mix" title={MIX_MODES.find((m) => m.id === mix.mode)?.title} data-midi-path="studio:visuals.automix-next" data-midi-label="Next auto-mix mode" data-midi-mode="toggle">
        {#each MIX_MODES as m (m.id)}<option value={m.id} title={m.title}>{m.label}</option>{/each}
      </select>
      <select value={String(mix.bars)} onchange={(e) => setStudioMix({ bars: Number((e.target as HTMLSelectElement).value) })} disabled={mix.mode === 'all'} aria-label="Auto-mix changes every" title={mix.follow ? 'The usual pace; the music speeds it up or slows it down' : 'How often the mix changes, on the beat grid'}>
        {#each MIX_BAR_OPTIONS as o (o.bars)}<option value={String(o.bars)}>{o.label}</option>{/each}
      </select>
      <button class="text-btn small follow" class:on={mix.follow} aria-pressed={mix.follow} disabled={mix.mode === 'all'} onclick={() => setStudioMix({ follow: !mix.follow })} title="Follow the music: busy, loud playing changes faster (and shuffle shows more at once); sparse, quiet playing changes slower. Up to two steps either side of the pace you set." data-midi-path="studio:visuals.automix-follow" data-midi-label="Auto-mix follows the music" data-midi-mode="toggle">Follow</button>
    </div>
  {/if}
</StudioModule>

<style>
  /* Head: Look (a summary of the colors and grade) and + Add. */
  .look-btn { display: inline-flex; align-items: center; gap: 4px; max-width: 150px; min-width: 0; }
  .look-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .look-btn svg { flex: 0 0 auto; width: 9px; height: 9px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .add-menu { flex: 0 0 auto; width: 74px; height: 22px; font-size: var(--ga-text-meta, 11px); }
  /* The Look drawer, under the head, over the list. */
  .look { flex: 0 0 auto; display: flex; flex-direction: column; gap: 6px; padding: 2px 0 8px; margin-bottom: 4px; border-bottom: 1px solid var(--studio-edge-soft); }
  .look-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .look-row .ga-eyebrow { color: var(--studio-muted); flex: 0 0 auto; }
  .look-row select { flex: 1 1 0; min-width: 0; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .grade-wrap { flex: 1 1 0; min-width: 0; display: flex; align-items: center; gap: 6px; }
  /* Auto-mix: a line under the list, since it decides which audio shaders show. */
  .automix { flex: 0 0 auto; display: flex; align-items: center; gap: 6px; padding-top: 6px; margin-top: 2px; border-top: 1px solid var(--studio-edge-soft); }
  .automix .ga-eyebrow { color: var(--studio-muted); flex: 0 0 auto; }
  .automix select { flex: 1 1 0; min-width: 0; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .automix .follow { flex: 0 0 auto; height: 22px; padding: 0 7px; }
  /* A clip's row: its track and name, Edit, then its blend and opacity; open, its layers. */
  .fold { flex: 0 0 auto; width: 16px; height: 18px; padding: 0; border: 0; background: none; color: var(--studio-muted); cursor: pointer; }
  .fold svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .who { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); color: var(--studio-ink); }
  .track { color: var(--studio-muted); font-size: var(--ga-text-micro, 9px); text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); margin-right: 2px; }
  .edit { flex: 0 0 auto; height: 22px; padding: 0 9px; font-size: var(--ga-text-meta, 11px); }
  /* Same columns as an audio shader's row: the blend and opacity line up. */
  .controls.stack-controls { align-items: flex-end; }
  .clip-note { flex: 1 1 0; min-width: 0; align-self: center; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .layers { list-style: none; margin: 4px 0 0 15px; padding: 0; display: flex; flex-direction: column; }
  .layers li { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 2px 0; font-size: var(--ga-text-meta, 11px); color: var(--studio-ink); cursor: grab; }
  .layers li.dragging { opacity: 0.4; }
  .kind { flex: 0 0 auto; color: var(--studio-muted); font-size: var(--ga-text-micro, 9px); text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); }
  .item-name { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .eye { flex: 0 0 auto; width: 20px; height: 20px; padding: 0; display: grid; place-items: center; border: 0; background: none; color: var(--studio-ink); cursor: pointer; }
  .eye.off { color: var(--studio-muted); }
  .eye svg { width: 13px; height: 13px; fill: none; stroke: currentColor; stroke-width: 1.4; stroke-linecap: round; stroke-linejoin: round; }
  .empty { margin: 4px 2px; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--studio-muted); }
  .follows.live { color: var(--studio-accent); }
  /* Following a loop track: tagged like the Looper page's Loop N. */
  .follows.loop { color: var(--studio-accent); border-color: var(--studio-accent); }
  /* Everything under the head scrolls as one, so no row is ever squeezed. */
  .body { flex: 1 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto; display: flex; flex-direction: column; }
  .list { flex: 0 0 auto; display: flex; flex-direction: column; }
  .row { padding: 5px 0; border-bottom: 1px solid var(--studio-edge-soft); }
  .row.dragging { opacity: 0.4; }
  /* A track's clip visuals switched off: the row stays, dimmed. */
  .row.off .who, .row.off .controls, .row.off .layers { opacity: 0.45; }
  /* Where a dragged row will land: a line in the gap. */
  .row.drop-before { box-shadow: inset 0 2px 0 var(--studio-accent); }
  .row.drop-after { box-shadow: inset 0 -2px 0 var(--studio-accent); }
  .grip { flex: 0 0 auto; cursor: grab; color: var(--studio-muted); font-size: 10px; letter-spacing: -2px; padding: 0 2px; user-select: none; }
  .grip:focus-visible { outline: 1px solid var(--studio-accent); border-radius: 2px; }
  .order { margin: 6px 0 2px; font-size: var(--ga-text-micro, 9px); color: var(--studio-muted); }
  .row:last-of-type { border-bottom: 0; }
  .line { display: flex; align-items: center; gap: 6px; min-width: 0; }
  /*
   * An audio shader's row, on one grid so every row's columns line up. The
   * right rack is 356px (--studio-right-w) less the module's border and
   * padding: about 334px of content, ~326px with a scrollbar.
   *   handle 12 · on/off 20 · picture 96 · name 1fr (~62-70px) · opacity 48 · fold 20 · remove 20, gaps 8
   * (48 holds the knob and its OPACITY label, about 46px wide.)
   * The two selects do not fit beside the knob, so they take their own line
   * under the picture, from its left edge to the row's right edge.
   */
  .voice {
    display: grid;
    grid-template-columns: 12px 20px 96px minmax(0, 1fr) 48px 20px 20px;
    column-gap: 8px;
    row-gap: 8px;
    align-items: center;
    padding: 8px 0;
    min-width: 0;
  }
  .voice .grip { opacity: 0; transition: opacity 0.12s; justify-self: center; }
  .row:hover .grip, .grip:focus-visible { opacity: 1; }
  .onoff { width: 20px; height: 28px; padding: 0; border: 0; background: none; display: grid; place-items: center; cursor: pointer; }
  .onoff .led { pointer-events: none; }
  .led.on, .onoff.on .led {
    border-color: var(--studio-accent);
    background: color-mix(in srgb, var(--studio-accent) calc(25% + var(--a) * 75%), transparent);
    box-shadow: 0 0 calc(var(--a) * 8px) var(--studio-accent);
  }
  .vname { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-control, 12px); color: var(--studio-ink); }
  .voice :global(.knob-wrap) { min-width: 0; width: 48px; justify-self: center; }
  .voice .icon { width: 20px; height: 28px; justify-self: center; }
  .fold-btn svg { transition: transform 0.15s; }
  .fold-btn.open svg { transform: rotate(180deg); }
  .pair { grid-column: 3 / -1; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 8px; }
  .pair select.swatch { border-left: 3px solid var(--follow); }
  .pair select { width: 100%; min-width: 0; height: 28px; font-size: var(--ga-text-control, 12px); }
  /* Opened: its left edge on the picture's (handle 12 + 8 + on/off 20 + 8). */
  .expanded { display: flex; flex-direction: column; gap: 8px; padding: 0 0 8px 48px; }
  .toggles { display: flex; gap: 8px; }
  .toggles .studio-btn { height: 28px; padding: 0 12px; font-size: var(--ga-text-meta, 11px); }
  .toggles .auto:not(.on), .toggles .drift-btn:not(.on) { color: var(--studio-muted); }
  .toggles .drift-btn.on { color: var(--tl-on, #ff725f); border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); }
  /* The visual's own settings: panel sliders, columns of at least 200px (one column in the rack). */
  .params { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 8px 16px; }
  .drift-sliders { flex: 1 1 100%; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
  .look-row.finish > :global(.ni) { flex: 1 1 0; min-width: 0; }
  .controls .opacity { flex: 0 1 180px; }
  .item-level { width: 90px; flex: 0 0 auto; }
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
  .follows { flex: 1 1 0; min-width: 0; color: var(--studio-muted); }
  /* The blend sits with the knobs, as narrow as a knob column. */
  .blend { flex: 0 0 74px; min-width: 0; height: 20px; padding: 0 4px; align-self: center; font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  /* Drift: on is coral, like the app's other "running on its own" states. */
  .drift-edit { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .drift-edit .ga-eyebrow { color: var(--tl-on, #ff725f); flex: 0 0 auto; }
  .drift-edit :global(.knob-wrap) { flex: 0 0 52px; }
  .drift-params { flex: 1 1 100%; display: flex; flex-wrap: wrap; gap: 4px; }
  .drift-chip { height: 20px; padding: 0 7px; border: 1px solid var(--studio-edge-soft); border-radius: var(--ga-r-hard, 5px); background: none; color: var(--studio-muted); font: inherit; font-size: var(--ga-text-meta, 11px); cursor: pointer; }
  .drift-chip:hover { color: var(--studio-ink); }
  .drift-chip.on { color: var(--tl-on, #ff725f); border-color: var(--tl-on-line, rgba(255, 114, 95, 0.46)); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); }
  .controls { display: flex; align-items: flex-end; justify-content: space-between; gap: 4px; padding: 3px 0 0 15px; }
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
  .icon svg { width: 10px; height: 10px; fill: none; stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
  .icon:hover { color: var(--studio-ink); border-color: var(--studio-edge); }
  .blend.cut { color: var(--studio-accent); }
  .text-edit { display: flex; flex-direction: column; gap: 4px; }
  .text-edit textarea { width: 100%; box-sizing: border-box; resize: vertical; min-height: 52px; padding: 5px 7px; font: 12px/1.35 var(--ga-font-mono, ui-monospace); text-transform: uppercase; color: var(--studio-ink); background: var(--studio-well, rgba(0,0,0,0.35)); border: 1px solid var(--studio-edge); border-radius: 6px; user-select: text; }
  .text-edit textarea:focus { outline: none; border-color: var(--studio-accent); }
  .text-row { display: flex; align-items: center; gap: 8px; }
  .text-row select { flex: 0 1 auto; min-width: 0; height: 22px; font-size: var(--ga-text-meta, 11px); }
  .text-note { font-size: var(--ga-text-meta, 11px); color: var(--studio-muted); }
  .none { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; padding: 4px 2px; }
  .none p { margin: 0; font-size: var(--ga-text-meta, 11px); line-height: 1.45; color: var(--studio-muted); }
</style>
