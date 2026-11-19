<script lang="ts">
  /**
   * A sound clip's visuals (music/clipStack.ts): a stack of layers, each a
   * curated audio shader or anything from the library (video, image, shader,
   * sketch), with its blend, opacity, settings and effects; the stack's own
   * blend, opacity, effects and mood. Opens on a studio session clip or an
   * Ableton Live clip, like the clip editor.
   *
   * While it is open the stack plays on top of the output (Solo: on its
   * own). The editor's panels sit around the studio's own output frame, so
   * the output stays in view and every change is seen at once (the native
   * picture shows only where nothing on the page covers it).
   */
  import { get } from 'svelte/store';
  import { musicStudio } from '../../music/musicStudioStore';
  import { stackEditor, visualPicker } from '../../music/studioUi';
  import { findClip } from '../../music/session';
  import { emptyStack, mediaItem, voiceItem, MAX_STACK_ITEMS, type ClipStack, type StackItem } from '../../music/clipStack';
  import { auditionStack } from '../../music/stackRuntime';
  import { studioCodeTick, studioVoiceCode } from '../../music/studioPlugin';
  import { shaderInputs, type ShaderInput } from '../../music/visualScenes';
  import { isVoiceDrivenInput, liveSource, LIVE_DRUMS, voiceSourcesFor } from '../../music/visualVoices';
  import { liveTrackKeys, isDrumTrack } from '../../music/liveControl';
  import { abletonBridge } from '../../ableton/abletonBridge';
  import { STUDIO_PALETTE_LIST } from '../../music/studioPalettes';
  import { DEFAULT_FINISH, STUDIO_GRADES, type StudioGrade } from '../../music/studioFinish';
  import { BLEND_MODE_ORDER, blendModeLabel, generateUUID, type BlendMode, type Effect, type ShowClipMedia } from '../../types';
  import { MEDIA_SOURCE_DRAG_TYPE, clipMediaFromFile, clipMediaFromTrayPayload, isTrackMediaFile } from '../show/timeline/clipMedia';
  import StudioKnob from './StudioKnob.svelte';
  import StackEffects from './StackEffects.svelte';
  import StackLibrary from './StackLibrary.svelte';

  const target = $derived($stackEditor);
  const s = $derived($musicStudio);
  const stack = $derived.by<ClipStack>(() => {
    if (!target) return emptyStack();
    if (target.kind === 'clip') return findClip(s.session, target.clipId)?.clip.stack ?? emptyStack();
    return s.liveStacks[target.key] ?? emptyStack();
  });
  let selectedId = $state<string | null>(null);
  const selected = $derived(stack.items.find((i) => i.id === selectedId) ?? stack.items[0] ?? null);
  let library = $state(false);
  let solo = $state(false);
  let error = $state('');
  /** The studio's output frame on screen: the editor's panels go round it. */
  let frame = $state<{ left: number; right: number; bottom: number } | null>(null);
  function measure() {
    const r = document.querySelector('.studio-view .frame')?.getBoundingClientRect();
    frame = r && r.width > 120 ? { left: r.left, right: r.right, bottom: r.bottom } : null;
  }

  function save(next: ClipStack) {
    const t = get(stackEditor);
    if (!t) return;
    if (t.kind === 'clip') musicStudio.setClipStack(t.clipId, next);
    else musicStudio.setLiveStack(t.key, next);
  }
  const patchStack = (patch: Partial<ClipStack>) => save({ ...stack, ...patch });
  const patchItem = (id: string, patch: Partial<StackItem>) => save({ ...stack, items: stack.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) });

  function addItem(item: StackItem | null) {
    if (!item) return;
    if (stack.items.length >= MAX_STACK_ITEMS) {
      error = `A clip takes up to ${MAX_STACK_ITEMS} layers.`;
      return;
    }
    error = '';
    // New layers go on top.
    save({ ...stack, items: [item, ...stack.items] });
    selectedId = item.id;
  }
  const defaultFollow = () => {
    const t = get(stackEditor);
    return t?.kind === 'live' ? t.follow : 'all';
  };
  function addVoice() {
    visualPicker.set({ current: null, none: false, title: 'An audio shader for this clip', pick: (file) => file && addItem(voiceItem(generateUUID(), file, defaultFollow())) });
  }
  const addMedia = (media: ShowClipMedia | null) => media && addItem(mediaItem(generateUUID(), media));
  function move(index: number, by: number) {
    const items = [...stack.items];
    const [it] = items.splice(index, 1);
    items.splice(index + by, 0, it);
    save({ ...stack, items });
  }
  function remove(id: string) {
    save({ ...stack, items: stack.items.filter((i) => i.id !== id) });
    if (selectedId === id) selectedId = null;
  }

  // Media Library cards and files from the computer.
  function dragOver(e: DragEvent) {
    const types = [...(e.dataTransfer?.types ?? [])];
    if (types.includes(MEDIA_SOURCE_DRAG_TYPE) || types.includes('Files')) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
  }
  async function drop(e: DragEvent) {
    const raw = e.dataTransfer?.getData(MEDIA_SOURCE_DRAG_TYPE);
    if (raw) {
      e.preventDefault();
      try {
        const media = clipMediaFromTrayPayload(JSON.parse(raw));
        if (!media) error = 'That card is not a picture a clip can show (live inputs and plugins stay on the decks).';
        addMedia(media);
      } catch {
        error = 'Could not read that card.';
      }
      return;
    }
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isTrackMediaFile(f));
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) addMedia(await clipMediaFromFile(file));
  }
  async function pickFiles(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    for (const file of [...(input.files ?? [])].filter((f) => isTrackMediaFile(f))) addMedia(await clipMediaFromFile(file));
    input.value = '';
  }

  // The stack plays on top while the editor is open; the output shows in the middle.
  $effect(() => {
    if (!target) return;
    const t = target;
    auditionStack(() => {
      const st = get(musicStudio);
      return t.kind === 'clip' ? findClip(st.session, t.clipId)?.clip.stack : st.liveStacks[t.key];
    }, solo);
    return () => auditionStack(null);
  });
  $effect(() => {
    if (!target) return;
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });

  function close() {
    stackEditor.set(null);
    library = false;
    selectedId = null;
    error = '';
  }
  function onKey(e: KeyboardEvent) {
    if (!target || e.key !== 'Escape') return;
    if (library) library = false;
    else close();
    e.stopPropagation();
  }

  // ── The selected layer's settings ──
  const SKIP = new Set(['vxSource', 'vxAuto', 'ink', 'accent']);
  function inputsOf(item: StackItem): ShaderInput[] {
    void $studioCodeTick;
    if (item.voice) {
      const code = studioVoiceCode(item.voice.file);
      return code ? shaderInputs(code).filter((i) => (i.TYPE === 'float' || i.TYPE === 'long') && !SKIP.has(i.NAME) && !isVoiceDrivenInput(i.NAME)) : [];
    }
    if (item.media?.kind === 'shader') return ((item.media.shaderInputs ?? []) as ShaderInput[]).filter((i) => i.TYPE === 'float' || i.TYPE === 'long');
    return [];
  }
  const numberOf = (item: StackItem, input: ShaderInput) => Number(item.params[input.NAME] ?? input.DEFAULT ?? input.MIN ?? 0);
  const kindLabel = (item: StackItem) => (item.voice ? 'Audio shader' : ({ video: 'Video', image: 'Image', shader: 'Shader', sketch: 'Sketch' } as Record<string, string>)[item.media?.kind ?? ''] ?? 'Layer');
  const percent = (v: number) => `${Math.round(v * 100)}%`;

  // What an audio shader can follow: the studio's sounds, and Live's tracks while Live is in control.
  const liveTracks = $derived.by(() => {
    if (!s.liveControl || !$abletonBridge.connected) return [];
    const keys = liveTrackKeys($abletonBridge.tracks);
    return $abletonBridge.tracks.map((t, i) => ({ name: keys[i], drums: isDrumTrack(t, s.liveRoles[keys[i]] ?? null) }));
  });

  const finish = $derived(stack.mood?.finish);
  const setFinish = (patch: Partial<typeof DEFAULT_FINISH>) => patchStack({ mood: { ...stack.mood, finish: { ...(finish ?? DEFAULT_FINISH), ...patch } } });
</script>

<svelte:window onkeydown={onKey} />

{#if target}
  <div
    class="stack-editor"
    class:framed={!!frame}
    role="dialog"
    aria-label="Visuals for {target.title}"
    tabindex="-1"
    ondragover={dragOver}
    ondrop={drop}
    style={frame ? `--fl: ${frame.left}px; --fr: ${frame.right}px; --fb: ${frame.bottom}px` : undefined}
  >
    <header class="bar">
      <div class="title">
        <span class="ga-eyebrow">Visuals</span>
        <strong>{target.title}</strong>
      </div>
      <label class="check" title="Only this clip's visuals on the output while you edit">
        <input type="checkbox" bind:checked={solo} /> Solo
      </label>
      <button class="studio-btn" onclick={close}>Done</button>
    </header>

    <section class="layers panel" aria-label="Layers">
      {#if library}
        <StackLibrary onpick={(media) => { addMedia(media); }} onclose={() => (library = false)} />
      {:else}
        <div class="panel-head">
          <span class="ga-eyebrow">Layers</span>
          <span class="count">{stack.items.length} / {MAX_STACK_ITEMS}</span>
        </div>
        <ol class="list">
          {#each stack.items as item, i (item.id)}
            <li class:on={selected?.id === item.id}>
              <button class="pick" onclick={() => (selectedId = item.id)} aria-pressed={selected?.id === item.id}>
                <span class="name">{item.name}</span>
                <span class="kind">{kindLabel(item)}</span>
              </button>
              <button class="icon" disabled={i === 0} onclick={() => move(i, -1)} aria-label="Move {item.name} up" title="Up (draws over more)">↑</button>
              <button class="icon" disabled={i === stack.items.length - 1} onclick={() => move(i, 1)} aria-label="Move {item.name} down" title="Down (draws under more)">↓</button>
              <button class="icon" onclick={() => remove(item.id)} aria-label="Remove {item.name}" title="Remove">×</button>
            </li>
          {:else}
            <li class="empty">No layers yet. Add an audio shader, or anything from the library: a video, an image, a shader, a sketch. You can also drop Media Library cards or files here.</li>
          {/each}
        </ol>
        <div class="adds">
          <button class="studio-btn" onclick={addVoice}>+ Audio shader</button>
          <button class="studio-btn" onclick={() => (library = true)}>+ Library</button>
          <label class="studio-btn file">+ File<input type="file" multiple accept="video/*,image/*,.fs,.frag,.glsl" onchange={pickFiles} /></label>
        </div>
        {#if error}<p class="error" role="status">{error}</p>{/if}
      {/if}
    </section>

    <section class="middle" aria-label="The whole stack">
      <div class="panel whole">
        <div class="panel-head"><span class="ga-eyebrow">Whole stack</span></div>
        <div class="row">
          <label>Blend
            <select value={stack.blend} onchange={(e) => patchStack({ blend: (e.target as HTMLSelectElement).value as BlendMode })}>
              {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
            </select>
          </label>
          <StudioKnob label="Opacity" value={stack.opacity} defaultValue={1} size={22} format={percent} onchange={(v) => patchStack({ opacity: v })} />
          <label>Colors
            <select value={stack.mood?.palette ?? ''} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; patchStack({ mood: { ...stack.mood, palette: v || undefined } }); }} title="The palette its audio shaders take their colors from">
              <option value="">The studio's</option>
              {#each STUDIO_PALETTE_LIST as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
            </select>
          </label>
          <label class="check" title="Its own glow, trails, grade and grain over the stack">
            <input type="checkbox" checked={!!finish} onchange={(e) => patchStack({ mood: { ...stack.mood, finish: (e.target as HTMLInputElement).checked ? { ...DEFAULT_FINISH } : undefined } })} /> Own look
          </label>
        </div>
        {#if finish}
          <div class="row">
            <StudioKnob label="Glow" value={finish.glow} size={22} format={percent} onchange={(v) => setFinish({ glow: v })} />
            <StudioKnob label="Trails" value={finish.trails} size={22} format={percent} onchange={(v) => setFinish({ trails: v })} />
            <StudioKnob label="Grain" value={finish.grain} size={22} format={percent} onchange={(v) => setFinish({ grain: v })} />
            <label>Grade
              <select value={finish.grade} onchange={(e) => setFinish({ grade: (e.target as HTMLSelectElement).value as StudioGrade })}>
                {#each STUDIO_GRADES as g (g.id)}<option value={g.id}>{g.label}</option>{/each}
              </select>
            </label>
          </div>
        {/if}
        <StackEffects effects={stack.effects} note="Over the whole stack, after its layers are mixed." onchange={(effects: Effect[]) => patchStack({ effects })} />
      </div>
    </section>

    <section class="inspector panel" aria-label="Selected layer">
      {#if selected}
        {@const inputs = inputsOf(selected)}
        <div class="panel-head">
          <span class="ga-eyebrow">{kindLabel(selected)}</span>
          <strong class="sel-name">{selected.name}</strong>
        </div>
        <div class="row">
          <label>Blend
            <select value={selected.voice?.clear ? 'cut-out' : selected.blend} onchange={(e) => {
              const v = (e.target as HTMLSelectElement).value;
              if (v === 'cut-out' && selected.voice) patchItem(selected.id, { blend: 'normal', voice: { ...selected.voice, clear: true } });
              else patchItem(selected.id, { blend: v as BlendMode, ...(selected.voice ? { voice: { ...selected.voice, clear: false } } : {}) });
            }}>
              {#if selected.voice}<option value="cut-out">Cut out</option>{/if}
              {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
            </select>
          </label>
          <StudioKnob label="Opacity" value={selected.opacity} defaultValue={1} size={22} format={percent} onchange={(v) => patchItem(selected.id, { opacity: v })} />
        </div>
        {#if selected.voice}
          {@const voice = selected.voice}
          <label class="wide">Follows
            <select value={voice.follow} onchange={(e) => patchItem(selected.id, { voice: { ...voice, follow: (e.target as HTMLSelectElement).value } })}>
              {#if liveTracks.length}
                <optgroup label="Ableton Live">
                  {#each liveTracks as t (t.name)}
                    <option value={liveSource(t.name)}>{t.name}</option>
                    {#if t.drums}{#each LIVE_DRUMS as d (d.id)}<option value={liveSource(t.name, d.id)}>{t.name}: {d.label}</option>{/each}{/if}
                  {/each}
                </optgroup>
              {/if}
              <optgroup label="Audio Lab">
                {#each voiceSourcesFor(s.set, voice.follow) as src (src.id)}<option value={src.id}>{src.label}</option>{/each}
              </optgroup>
              {#if voice.follow.startsWith('live:') && !liveTracks.some((t) => voice.follow === liveSource(t.name) || voice.follow.startsWith(`${liveSource(t.name)}/`))}
                <option value={voice.follow}>{voice.follow.slice(5)} (Live track)</option>
              {/if}
            </select>
          </label>
        {/if}
        {#if inputs.length}
          <div class="panel-head"><span class="ga-eyebrow">Settings</span></div>
          <div class="knobs">
            {#each inputs as input (input.NAME)}
              <StudioKnob
                label={input.LABEL ?? input.NAME}
                value={numberOf(selected, input)}
                min={input.MIN ?? 0}
                max={input.MAX ?? 1}
                defaultValue={Number(input.DEFAULT ?? input.MIN ?? 0)}
                size={22}
                onchange={(v) => patchItem(selected.id, { params: { ...selected.params, [input.NAME]: input.TYPE === 'long' ? Math.round(v) : v } })}
              />
            {/each}
          </div>
        {/if}
        <div class="panel-head"><span class="ga-eyebrow">Effects</span></div>
        <StackEffects effects={selected.effects} note="On this layer before it is mixed with the others." onchange={(effects: Effect[]) => patchItem(selected.id, { effects })} />
      {:else}
        <p class="empty">Pick a layer to set it up.</p>
      {/if}
    </section>
  </div>
{/if}

<style>
  /* Panels round the studio's output frame (framed); without one, a plain dialog. */
  .stack-editor {
    position: fixed;
    inset: 4vh 3vw;
    /* Over the patch cables (96, earlier in the page), under the visual picker (97). */
    z-index: 96;
    display: grid;
    grid-template-columns: 280px minmax(0, 1fr) 320px;
    grid-template-rows: auto minmax(0, 1fr);
    grid-template-areas: 'bar bar bar' 'layers middle inspector';
    gap: 8px;
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-control, 12px);
  }
  .stack-editor.framed { display: block; inset: 0; pointer-events: none; }
  .framed > * { position: absolute; pointer-events: auto; }
  .framed .layers { left: 8px; top: 8px; bottom: 8px; width: calc(var(--fl) - 16px); }
  .framed .inspector { left: calc(var(--fr) + 8px); right: 8px; top: 8px; bottom: 8px; }
  .framed .bar { left: var(--fl); width: calc(var(--fr) - var(--fl)); top: calc(var(--fb) + 8px); box-sizing: border-box; }
  .framed .middle { left: var(--fl); width: calc(var(--fr) - var(--fl)); top: calc(var(--fb) + 60px); bottom: 8px; }
  .panel, .bar {
    background: var(--ga-panel, #12110e);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  }
  .bar { grid-area: bar; display: flex; align-items: center; gap: 12px; padding: 8px 12px; }
  .title { flex: 1; display: flex; align-items: baseline; gap: 10px; min-width: 0; }
  .title strong { font-size: var(--ga-text-body, 13px); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .layers { grid-area: layers; display: flex; flex-direction: column; min-height: 0; padding: 10px; gap: 8px; box-sizing: border-box; }
  .inspector { grid-area: inspector; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
  .middle { grid-area: middle; display: flex; flex-direction: column; min-height: 0; }
  .whole { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
  .panel-head { display: flex; align-items: baseline; gap: 8px; }
  .count { margin-left: auto; color: var(--ga-ink-2, #89857e); font-variant-numeric: tabular-nums; }
  .sel-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .list { list-style: none; margin: 0; padding: 0; flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .list li { display: flex; align-items: center; gap: 2px; border-radius: var(--ga-r-hard, 5px); }
  .list li.on { background: var(--ga-selection-bg, #1f3170); }
  .pick { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 5px 6px; background: none; border: 0; color: inherit; text-align: left; cursor: pointer; font: inherit; }
  .pick .name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .pick .kind { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); }
  .icon { width: 22px; height: 22px; padding: 0; background: none; border: 0; color: var(--ga-ink-1, #ada9a2); cursor: pointer; }
  .icon:disabled { opacity: 0.3; cursor: default; }
  .icon:hover:not(:disabled) { color: var(--ga-ink-0, #f2ede4); }
  .empty { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); line-height: 1.5; padding: 6px; }
  .adds { display: flex; flex-wrap: wrap; gap: 6px; }
  .file { position: relative; overflow: hidden; }
  .file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .error { margin: 0; color: #e4ba7b; font-size: var(--ga-text-meta, 11px); }
  .row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; }
  label { display: flex; flex-direction: column; gap: 3px; color: var(--ga-ink-1, #ada9a2); font-size: var(--ga-text-meta, 11px); }
  label.check { flex-direction: row; align-items: center; gap: 6px; }
  label.wide select { width: 100%; }
  select { height: var(--ga-control-h-sm, 22px); background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); font: inherit; font-size: var(--ga-text-control, 12px); }
  .knobs { display: grid; grid-template-columns: repeat(auto-fill, minmax(64px, 1fr)); gap: 10px 6px; }
</style>
