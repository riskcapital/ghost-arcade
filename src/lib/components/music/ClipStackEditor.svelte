<script lang="ts">
  /**
   * A sound clip's visuals (music/clipStack.ts): a few layers, each a curated
   * audio shader or anything from the Media Library (video, image, shader,
   * sketch), with blend, opacity, settings and effects; and the whole clip's
   * blend, opacity, effects and mood. Opens on a studio session clip or an
   * Ableton Live clip, like the clip editor.
   *
   * Laid out like the rest of the app: the layer list on the left (mapping
   * mode's rows), the selected layer (or the whole clip) in the middle, the
   * VJ Media Library on the right. While it is open the clip's visuals play
   * on top of the output (Solo: on their own).
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
  import { showToast } from '../../stores/errorToast';
  import { BLEND_MODE_ORDER, blendModeLabel, generateUUID, type BlendMode, type Effect, type ShowClipMedia } from '../../types';
  import { MEDIA_SOURCE_DRAG_TYPE, clipMediaFromFile, clipMediaFromTrayPayload, clipThumbnails, isTrackMediaFile, thumbnailFor } from '../show/timeline/clipMedia';
  import MediaTray from '../MediaTray.svelte';
  import StackEffects from './StackEffects.svelte';

  const target = $derived($stackEditor);
  const s = $derived($musicStudio);
  const stack = $derived.by<ClipStack>(() => {
    if (!target) return emptyStack();
    if (target.kind === 'clip') return findClip(s.session, target.clipId)?.clip.stack ?? emptyStack();
    return s.liveStacks[target.key] ?? emptyStack();
  });
  let selectedId = $state<string | null>(null);
  const selected = $derived(stack.items.find((i) => i.id === selectedId) ?? stack.items[0] ?? null);
  /** The middle shows the selected layer, or the whole clip. */
  let view = $state<'layer' | 'clip'>('layer');
  let solo = $state(false);
  let dragFrom = $state<number | null>(null);
  let dragOver = $state<{ index: number; below: boolean } | null>(null);

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
      showToast(`A clip takes up to ${MAX_STACK_ITEMS} layers.`, 'info');
      return;
    }
    // New layers go on top.
    save({ ...stack, items: [item, ...stack.items] });
    selectedId = item.id;
    view = 'layer';
  }
  function addVoice() {
    const t = get(stackEditor);
    const follow = t?.kind === 'live' ? t.follow : 'all';
    visualPicker.set({ current: null, none: false, title: 'An audio shader for this clip', pick: (file) => file && addItem(voiceItem(generateUUID(), file, follow)) });
  }
  function addMedia(media: ShowClipMedia | null) {
    if (!media) {
      showToast('A clip shows videos, images, shaders and sketches. Live inputs and plugins stay on the decks.', 'info');
      return;
    }
    addItem(mediaItem(generateUUID(), media));
  }
  function remove(id: string) {
    save({ ...stack, items: stack.items.filter((i) => i.id !== id) });
    if (selectedId === id) selectedId = null;
  }
  function moveTo(from: number, to: number) {
    if (from === to) return;
    const items = [...stack.items];
    const [it] = items.splice(from, 1);
    items.splice(to > from ? to - 1 : to, 0, it);
    save({ ...stack, items });
  }

  // Rows reorder by dragging, as in the mapping layer list.
  function rowDragOver(e: DragEvent, index: number) {
    if (dragFrom === null) return;
    e.preventDefault();
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    dragOver = { index, below: e.clientY > box.top + box.height / 2 };
  }
  function rowDrop(e: DragEvent) {
    e.preventDefault();
    if (dragFrom !== null && dragOver) moveTo(dragFrom, dragOver.index + (dragOver.below ? 1 : 0));
    dragFrom = null;
    dragOver = null;
  }

  // Media Library cards dragged in, and files from the computer.
  function dragOverEditor(e: DragEvent) {
    const types = [...(e.dataTransfer?.types ?? [])];
    if (types.includes(MEDIA_SOURCE_DRAG_TYPE) || types.includes('Files')) {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    }
  }
  async function dropOnEditor(e: DragEvent) {
    if (dragFrom !== null) return;
    const raw = e.dataTransfer?.getData(MEDIA_SOURCE_DRAG_TYPE);
    if (raw) {
      e.preventDefault();
      try {
        addMedia(clipMediaFromTrayPayload(JSON.parse(raw)));
      } catch {
        showToast('Could not read that card.', 'error');
      }
      return;
    }
    const files = [...(e.dataTransfer?.files ?? [])].filter((f) => isTrackMediaFile(f));
    if (!files.length) return;
    e.preventDefault();
    for (const file of files) addMedia(await clipMediaFromFile(file));
  }

  // The clip's visuals play on top while the editor is open.
  $effect(() => {
    if (!target) return;
    const t = target;
    auditionStack(() => {
      const st = get(musicStudio);
      return t.kind === 'clip' ? findClip(st.session, t.clipId)?.clip.stack : st.liveStacks[t.key];
    }, solo);
    return () => auditionStack(null);
  });

  function close() {
    stackEditor.set(null);
    selectedId = null;
    view = 'layer';
  }
  function onKey(e: KeyboardEvent) {
    if (!target || e.key !== 'Escape') return;
    const el = e.target as HTMLElement | null;
    if (el?.closest('input, textarea')) return;
    close();
    e.stopPropagation();
  }

  // ── The selected layer ──
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
  const thumbOf = (item: StackItem) => (item.voice ? `./ISF/voice-thumbs/${item.voice.file.replace(/\.fs$/, '.jpg')}` : item.media ? thumbnailFor($clipThumbnails, item.media) : null);
  const percent = (v: number) => `${Math.round(v * 100)}%`;
  const shown = (v: number, input: ShaderInput) => ((input.MAX ?? 1) - (input.MIN ?? 0) > 4 ? String(Math.round(v)) : v.toFixed(2));

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

{#snippet slider(label: string, value: number, min: number, max: number, text: string, onchange: (v: number) => void)}
  <label class="param">
    <span class="param-head"><span>{label}</span><output>{text}</output></span>
    <input type="range" {min} {max} step={(max - min) / 200} {value} oninput={(e) => onchange(+(e.target as HTMLInputElement).value)} />
  </label>
{/snippet}

{#if target}
  <div class="backdrop" role="presentation">
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Visuals for {target.title}" tabindex="-1" ondragover={dragOverEditor} ondrop={dropOnEditor}>
      <header class="head">
        <div class="title">
          <span class="ga-eyebrow">Clip visuals</span>
          <strong>{target.title}</strong>
        </div>
        <button class="btn" class:on={solo} aria-pressed={solo} onclick={() => (solo = !solo)} title="Only this clip's visuals on the output while you edit">Solo</button>
        <button class="btn primary" onclick={close}>Done</button>
        <button class="close" onclick={close} aria-label="Close" title="Close (Esc)">
          <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3 3 9" /></svg>
        </button>
      </header>

      <div class="body">
        <section class="layers" aria-label="Layers">
          <div class="col-head">
            <span class="ga-eyebrow">Layers</span>
            <span class="count">{stack.items.length} / {MAX_STACK_ITEMS}</span>
          </div>
          <div class="layer-list" role="list">
            {#each stack.items as item, i (item.id)}
              {@const thumb = thumbOf(item)}
              <div
                class="layer-item"
                class:selected={view === 'layer' && selected?.id === item.id}
                class:off={item.hidden}
                class:drag-over-above={dragOver?.index === i && !dragOver.below}
                class:drag-over-below={dragOver?.index === i && dragOver.below}
                role="listitem"
                draggable="true"
                ondragstart={(e) => { dragFrom = i; e.dataTransfer?.setData('text/plain', item.id); }}
                ondragend={() => { dragFrom = null; dragOver = null; }}
                ondragover={(e) => rowDragOver(e, i)}
                ondrop={rowDrop}
              >
                <span class="drag-handle" aria-hidden="true"><svg viewBox="0 0 8 12"><circle cx="2" cy="2" r="1" /><circle cx="6" cy="2" r="1" /><circle cx="2" cy="6" r="1" /><circle cx="6" cy="6" r="1" /><circle cx="2" cy="10" r="1" /><circle cx="6" cy="10" r="1" /></svg></span>
                <button class="pick" onclick={() => { selectedId = item.id; view = 'layer'; }}>
                  <span class="layer-thumbnail">{#if thumb}<img src={thumb} alt="" onerror={(e) => ((e.currentTarget as HTMLImageElement).style.visibility = 'hidden')} />{/if}</span>
                  <span class="names"><span class="layer-name">{item.name}</span><span class="layer-kind">{kindLabel(item)}</span></span>
                </button>
                <button class="icon-btn" onclick={() => patchItem(item.id, { hidden: !item.hidden })} aria-label={item.hidden ? `Show ${item.name}` : `Hide ${item.name}`} title={item.hidden ? 'Show' : 'Hide'}>
                  {#if item.hidden}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.4A9.7 9.7 0 0 1 12 5c5 0 9 5 10 7a14 14 0 0 1-3 3.8M6.2 6.2A14 14 0 0 0 2 12c1 2 5 7 10 7a9.7 9.7 0 0 0 4.2-.9" /></svg>
                  {:else}
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>
                  {/if}
                </button>
                <button class="icon-btn" onclick={() => remove(item.id)} aria-label="Remove {item.name}" title="Remove">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
                </button>
              </div>
            {:else}
              <p class="empty">No layers yet. Pick from the Media Library on the right, or add one of the audio shaders.</p>
            {/each}
          </div>
          <button class="btn wide" onclick={addVoice}>+ Audio shader</button>
        </section>

        <section class="props" aria-label="Settings">
          <div class="ga-segmented tabs" role="tablist" aria-label="What to set">
            <button role="tab" aria-selected={view === 'layer'} class:active={view === 'layer'} disabled={!selected} onclick={() => (view = 'layer')}>{selected ? selected.name : 'Layer'}</button>
            <button role="tab" aria-selected={view === 'clip'} class:active={view === 'clip'} onclick={() => (view = 'clip')}>Whole clip</button>
          </div>
          <div class="scroll">
            {#if view === 'layer' && selected}
              {@const inputs = inputsOf(selected)}
              <div class="group">
                <label class="field">Blend
                  <select value={selected.voice?.clear ? 'cut-out' : selected.blend} onchange={(e) => {
                    const v = (e.target as HTMLSelectElement).value;
                    if (v === 'cut-out' && selected.voice) patchItem(selected.id, { blend: 'normal', voice: { ...selected.voice, clear: true } });
                    else patchItem(selected.id, { blend: v as BlendMode, ...(selected.voice ? { voice: { ...selected.voice, clear: false } } : {}) });
                  }}>
                    {#if selected.voice}<option value="cut-out">Cut out</option>{/if}
                    {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
                  </select>
                </label>
                {@render slider('Opacity', selected.opacity, 0, 1, percent(selected.opacity), (v) => patchItem(selected.id, { opacity: v }))}
                {#if selected.voice}
                  {@const voice = selected.voice}
                  <label class="field">Follows
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
              </div>
              {#if inputs.length}
                <div class="group">
                  <span class="ga-eyebrow">Settings</span>
                  {#each inputs as input (input.NAME)}
                    {@const v = numberOf(selected, input)}
                    {@render slider(input.LABEL ?? input.NAME, v, input.MIN ?? 0, input.MAX ?? 1, shown(v, input), (nv) => patchItem(selected.id, { params: { ...selected.params, [input.NAME]: input.TYPE === 'long' ? Math.round(nv) : nv } }))}
                  {/each}
                </div>
              {/if}
              <div class="group">
                <span class="ga-eyebrow">Effects</span>
                <StackEffects effects={selected.effects} note="On this layer, before it is mixed with the others." onchange={(effects: Effect[]) => patchItem(selected.id, { effects })} />
              </div>
            {:else if view === 'layer'}
              <p class="empty">Add a layer to set it up.</p>
            {:else}
              <div class="group">
                <label class="field">Blend over the rest
                  <select value={stack.blend} onchange={(e) => patchStack({ blend: (e.target as HTMLSelectElement).value as BlendMode })}>
                    {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{blendModeLabel(mode)}</option>{/each}
                  </select>
                </label>
                {@render slider('Opacity', stack.opacity, 0, 1, percent(stack.opacity), (v) => patchStack({ opacity: v }))}
              </div>
              <div class="group">
                <span class="ga-eyebrow">Mood</span>
                <label class="field">Colors
                  <select value={stack.mood?.palette ?? ''} onchange={(e) => { const v = (e.target as HTMLSelectElement).value; patchStack({ mood: { ...stack.mood, palette: v || undefined } }); }} title="The palette its audio shaders take their colors from">
                    <option value="">The studio's</option>
                    {#each STUDIO_PALETTE_LIST as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
                  </select>
                </label>
                <label class="check" title="Its own glow, trails, grade and grain over the stack">
                  <input type="checkbox" checked={!!finish} onchange={(e) => patchStack({ mood: { ...stack.mood, finish: (e.target as HTMLInputElement).checked ? { ...DEFAULT_FINISH } : undefined } })} />
                  Own look
                </label>
                {#if finish}
                  {@render slider('Glow', finish.glow, 0, 1, percent(finish.glow), (v) => setFinish({ glow: v }))}
                  {@render slider('Trails', finish.trails, 0, 1, percent(finish.trails), (v) => setFinish({ trails: v }))}
                  {@render slider('Grain', finish.grain, 0, 1, percent(finish.grain), (v) => setFinish({ grain: v }))}
                  <label class="field">Grade
                    <select value={finish.grade} onchange={(e) => setFinish({ grade: (e.target as HTMLSelectElement).value as StudioGrade })}>
                      {#each STUDIO_GRADES as g (g.id)}<option value={g.id}>{g.label}</option>{/each}
                    </select>
                  </label>
                {/if}
              </div>
              <div class="group">
                <span class="ga-eyebrow">Effects</span>
                <StackEffects effects={stack.effects} note="Over the whole clip, after its layers are mixed." onchange={(effects: Effect[]) => patchStack({ effects })} />
              </div>
            {/if}
          </div>
        </section>

        <section class="library" aria-label="Media Library">
          <MediaTray embedded vjMode pickTitle="Click to add to this clip" onVJAddPayload={(p) => addMedia(clipMediaFromTrayPayload(p))} />
        </section>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    /* Over the patch cables (96, earlier in the page), under the visual picker (97). */
    z-index: 96;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.62);
  }
  .dialog {
    width: min(1180px, 96vw);
    height: min(700px, 90vh);
    display: flex;
    flex-direction: column;
    background: var(--ga-panel, #100f0d);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-soft, 8px);
    box-shadow: 0 18px 60px rgba(0, 0, 0, 0.6);
    color: var(--ga-ink-0, #f2ede4);
    font-size: var(--ga-text-control, 12px);
    overflow: hidden;
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-bottom: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .title { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 10px; }
  .title strong { font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .btn {
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .btn:hover { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .btn.on { border-color: var(--ga-icon, #5278ff); color: var(--ga-icon, #5278ff); }
  .btn.primary { background: var(--ga-icon, #5278ff); border-color: var(--ga-icon, #5278ff); color: #fff; }
  .btn.wide { width: 100%; }
  .close { width: 26px; height: 26px; padding: 0; display: grid; place-items: center; background: none; border: 0; color: var(--ga-ink-1, #ada9a2); cursor: pointer; border-radius: var(--ga-r-hard, 5px); }
  .close:hover { color: var(--ga-ink-0, #f2ede4); background: var(--ga-card, #16140f); }
  .close svg, .icon-btn svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: 250px minmax(0, 1fr) 360px; }
  .layers, .props { display: flex; flex-direction: column; gap: 8px; min-height: 0; padding: 10px; border-right: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .library { min-height: 0; overflow: hidden; display: flex; }
  .library > :global(*) { flex: 1; min-width: 0; }
  .col-head { display: flex; align-items: baseline; justify-content: space-between; }
  .count { color: var(--ga-ink-2, #89857e); font-variant-numeric: tabular-nums; }

  /* Rows as in the mapping layer list. */
  .layer-list { flex: 1; min-height: 0; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)) transparent; }
  .layer-item {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 6px;
    margin-bottom: 3px;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: var(--ga-r-hard, 5px);
    background: var(--ga-card, #16140f);
  }
  .layer-item.selected { border-color: var(--ga-icon, #5278ff); background: color-mix(in srgb, var(--ga-icon, #5278ff) 14%, var(--ga-card, #16140f)); }
  .layer-item.off .layer-name, .layer-item.off .layer-thumbnail { opacity: 0.4; }
  .layer-item.drag-over-above::after, .layer-item.drag-over-below::after { content: ''; position: absolute; left: 0; right: 0; height: 2px; background: var(--ga-icon, #5278ff); }
  .layer-item.drag-over-above::after { top: -3px; }
  .layer-item.drag-over-below::after { bottom: -3px; }
  .drag-handle { flex: 0 0 auto; width: 8px; color: var(--ga-ink-2, #89857e); cursor: grab; }
  .drag-handle svg { width: 8px; height: 12px; fill: currentColor; display: block; }
  .pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 0; background: none; border: 0; color: inherit; font: inherit; text-align: left; cursor: pointer; }
  .layer-thumbnail { flex: 0 0 auto; width: 40px; height: 25px; border-radius: var(--ga-r-hard, 5px); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); background: var(--ga-slot, #060504); overflow: hidden; }
  .layer-thumbnail img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .names { min-width: 0; display: flex; flex-direction: column; }
  .layer-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
  .layer-kind { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); }
  .icon-btn { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; display: grid; place-items: center; background: none; border: 0; border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-2, #89857e); cursor: pointer; }
  .icon-btn:hover { color: var(--ga-ink-0, #f2ede4); background: var(--ga-slot, #060504); }
  .empty { margin: 4px 2px; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); line-height: 1.5; }

  .tabs { display: flex; }
  .tabs button { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 4px; scrollbar-width: thin; scrollbar-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)) transparent; }
  .group { display: flex; flex-direction: column; gap: 8px; }
  .field { display: flex; align-items: center; justify-content: space-between; gap: 10px; color: var(--ga-ink-1, #ada9a2); }
  .field select { flex: 0 1 60%; min-width: 0; }
  select { height: var(--ga-control-h-sm, 22px); background: var(--ga-slot, #060504); color: var(--ga-ink-0, #f2ede4); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px); font: inherit; }
  .check { display: flex; align-items: center; gap: 6px; color: var(--ga-ink-1, #ada9a2); }
  .param { display: flex; flex-direction: column; gap: 3px; }
  .param-head { display: flex; justify-content: space-between; color: var(--ga-ink-1, #ada9a2); }
  .param-head output { color: var(--ga-ink-0, #f2ede4); font-variant-numeric: tabular-nums; }
  .param input[type='range'] { width: 100%; accent-color: var(--ga-icon, #5278ff); }
</style>
