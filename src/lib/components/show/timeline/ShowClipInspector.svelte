<script lang="ts">
  /**
   * The selected block in the side column's Inspector: a title row (its
   * picture, name, where it is, ⋯ for the block menu), Replace and Show in
   * Media, then titled groups: Timing (start and length in bars and
   * seconds, fades, what happens at the media's end), Where (the row it
   * plays on, one picture or each piece, the travel pattern), Colour, and
   * Control lines (each with on/off, + Line, and the selected point's value
   * and curve). The footer splits, duplicates or deletes it.
   *
   * What the block looks like (shader parameters, sketch controls, opacity,
   * blend mode) is edited in the normal panels, which show the block while
   * it is selected (see showBlockEdit). With several blocks selected it says
   * how many and offers Delete.
   */
  import type { ShowClipEndBehaviour, ShowClipMedia, ShowLayerClip, ShowLayerTrack } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { showToast } from '../../../stores/errorToast';
  import { findJunctionPredecessor } from '../../../show/showJunctions';
  import { mediaEnd, SHOW_MAX_RATE, SHOW_MIN_RATE } from '../../../show/tracks/showTrackEval';
  import { maxClipDurationForMedia } from '../../../show/tracks/showTrackEdit';
  import { barBeatAt, formatBarsBeats } from '../../../show/tempoMap';
  import { clipMediaFromFile, clipMediaFromTrayPayload, clipThumbnails, MEDIA_SOURCE_DRAG_TYPE, thumbKey } from './clipMedia';
  import { revealClipInMediaTray } from './clipMenuActions';
  import { duplicateSelection, splitAtPlayhead } from './trackCommands';
  import { shortcutLabels } from './keyLabels';
  import { showSlice } from './timelineSlices';
  import { rowColor } from './trackLayout';
  import { sideColumn } from './sideColumn';
  import WhereEditor from './WhereEditor.svelte';
  import LinePicker from './LinePicker.svelte';
  import LinePointInfo from './LinePointInfo.svelte';
  import ShowClipContextMenu from './ShowClipContextMenu.svelte';
  import TimelineIcon from './TimelineIcon.svelte';
  import { lineSelection } from '../../../timeline/lines/timelineLines';
  import { rowLineTarget } from '../../../timeline/lines/laneConversion';

  interface Props {
    clip: ShowLayerClip | null;
    track: ShowLayerTrack | null;
    count: number;
    ondelete: () => void;
    onclose: () => void;
  }

  let { clip, track, count, ondelete, onclose }: Props = $props();

  const KEYS = shortcutLabels();
  const END_OPTIONS: Array<{ value: ShowClipEndBehaviour; label: string; hint: string }> = [
    { value: 'stop', label: 'Stop', hint: 'The block ends with its media' },
    { value: 'loop', label: 'Loop the media', hint: 'Plays the media again from the start' },
    { value: 'hold', label: 'Hold the last frame', hint: 'Freezes on the last frame' },
  ];
  /** The row's colour first, then the block colours. */
  const SWATCHES = ['', '#f0c674', '#ff6f5e', '#e2c9a0', '#5fdc76', '#5ce1e6', '#5278ff', '#c77dff'];

  const tempoSlice = showSlice('tempo');
  const ordersSlice = showSlice('whereOrders');
  const linesSlice = showSlice('lines');
  const playheadSlice = showSlice('currentTime');
  const tempo = $derived($tempoSlice);

  const locked = $derived(!!track?.locked);
  const isVideo = $derived(clip?.media.kind === 'video');
  const prev = $derived(clip && track ? findJunctionPredecessor(track.clips, clip) : null);
  const maxXfade = $derived(clip && prev ? Math.min(prev.duration, clip.duration) : 0);
  const xfadeOn = $derived(clip?.transitionIn === 'dissolve' && maxXfade > 0);
  const mediaLength = $derived(clip ? mediaEnd(clip.media) : Infinity);
  const thumb = $derived(clip ? $clipThumbnails[thumbKey(clip.media)] ?? null : null);
  const pieces = $derived.by(() => {
    if (!track?.group) return 1;
    const order = $ordersSlice.find((o) => o.id === track!.group!.orderId);
    return order?.slots ? order.slots.reduce((n, slot) => n + slot.length, 0) : 0;
  });
  const rowKind = $derived(track?.group ? 'group row' : track?.subRow ? 'layer on a piece' : 'piece row');
  const blockLines = $derived(clip ? $linesSlice.filter((l) => l.target.scope === 'block' && l.target.id === clip!.id) : []);

  function bars(start: number, end: number): string {
    if (!tempo) return '';
    const pos = (t: number) => { const b = barBeatAt(tempo!, t); return b.bar + (b.beat - 1 + b.fraction) / b.beatsPerBar; };
    const r = Math.round((pos(end) - pos(start)) * 4) / 4;
    return `${r} ${r === 1 ? 'bar' : 'bars'}`;
  }

  function num(e: Event): number {
    return parseFloat((e.currentTarget as HTMLInputElement).value);
  }

  /**
   * Apply a typed number, then show what the clip really has. When the show
   * refuses the value (an overlap) or clamps it, the clip's value does not
   * change, so Svelte would leave the refused number standing in the box.
   */
  function commit(e: Event, apply: (v: number) => void, shown: (c: ShowLayerClip) => number | undefined) {
    const input = e.currentTarget as HTMLInputElement;
    apply(num(e));
    const id = clip?.id;
    const live = id ? showTimeline.findLayerClip(id)?.clip : undefined;
    const v = live ? shown(live) : undefined;
    if (v !== undefined && Number.isFinite(v)) input.value = v.toFixed(2);
  }

  function setStart(v: number) {
    if (!clip || !Number.isFinite(v)) return;
    showTimeline.moveLayerClipsAcross([clip.id], Math.max(0, v) - clip.startTime, 0);
  }
  function setDuration(v: number) {
    if (!clip || !Number.isFinite(v)) return;
    showTimeline.trimLayerClip(clip.id, 'end', clip.startTime + Math.max(0.1, v), { snap: false });
  }
  /** Typed and picked values are one undo step each. */
  function patch(p: Partial<ShowLayerClip>, continuous = false) {
    if (!clip) return;
    showTimeline.updateLayerClip(clip.id, p, { discrete: !continuous });
  }
  function setEnd(value: ShowClipEndBehaviour) {
    if (!clip) return;
    const next = { ...clip, endBehaviour: value };
    // A clip switched to 'stop' cannot outlast its media.
    const room = maxClipDurationForMedia(next);
    patch({ endBehaviour: value, duration: Math.min(clip.duration, room) });
  }
  function setXfade(on: boolean, duration?: number) {
    if (!clip) return;
    if (!on) return patch({ transitionIn: 'cut', transitionDuration: undefined });
    const d = Math.max(0.1, Math.min(maxXfade, duration ?? clip.transitionDuration ?? 1));
    patch({ transitionIn: 'dissolve', transitionDuration: d });
  }
  function toggleLine(id: string) {
    showTimeline.editLines((list) => list.map((l) => (l.id === id ? (l.enabled === false ? (({ enabled: _e, ...rest }) => rest)(l) : { ...l, enabled: false }) : l)));
  }

  // ── Replace ──────────────────────────────────────────────────────────
  let fileInput: HTMLInputElement | undefined = $state();
  let replaceHover = $state(false);

  async function replaceFromFile(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !clip) return;
    try {
      const media = await clipMediaFromFile(file);
      patch({ media });
    } catch (err) {
      showToast(`${file.name}: ${err instanceof Error ? err.message : String(err)}`, 'warning');
    }
  }
  function replaceDragOver(e: DragEvent) {
    if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(MEDIA_SOURCE_DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    replaceHover = true;
  }
  function replaceDrop(e: DragEvent) {
    replaceHover = false;
    const raw = e.dataTransfer?.getData(MEDIA_SOURCE_DRAG_TYPE);
    if (!raw) return;
    e.preventDefault();
    e.stopPropagation();
    let media: ShowClipMedia | null;
    try { media = clipMediaFromTrayPayload(JSON.parse(raw)); } catch { media = null; }
    if (media) patch({ media });
  }
  function showInMedia() {
    if (!clip) return;
    sideColumn.send({ kind: 'show', tab: 'media' });
    const media = clip.media;
    // The Media tab mounts first, then finds the card.
    setTimeout(() => {
      if (!revealClipInMediaTray(media)) showToast('This block\'s media is not a Media Library card.', 'info');
    }, 120);
  }

  // ── Menus ────────────────────────────────────────────────────────────
  let menu: { x: number; y: number } | null = $state(null);
  function openMenu(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    menu = menu ? null : { x: r.left - 160, y: r.bottom + 4 };
  }
  let picker: { x: number; y: number } | null = $state(null);
  function openPicker(e: MouseEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = picker ? null : { x: r.left - 200, y: r.top - 4 };
  }
  const pickerTargets = $derived(clip && track
    ? [{ target: { scope: 'block' as const, id: clip.id }, label: `Block: ${clip.media.name || 'block'}` }, { target: rowLineTarget(track), label: track.layerName }]
    : []);
</script>

{#if count > 1 || !clip}
  <div class="ci" data-clip-inspector>
    <div class="ci-title"><div class="ci-nm"><b>Blocks</b><small>{count} selected</small></div></div>
    <div class="ci-foot">
      <button class="ci-btn" onclick={() => duplicateSelection()}><TimelineIcon name="dup" size={14} />Duplicate<span class="ci-key">{KEYS.duplicate}</span></button>
      <button class="ci-btn danger" onclick={ondelete}><TimelineIcon name="trash" size={14} />Delete</button>
    </div>
  </div>
{:else}
  <div class="ci" data-clip-inspector>
    <div class="ci-title">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="ci-thumb" class:hover={replaceHover} style:background-image={thumb ? `url("${thumb}")` : undefined}
        ondragover={replaceDragOver} ondragleave={() => (replaceHover = false)} ondrop={replaceDrop}
        title="Drop a Media Library card here to replace the media"></div>
      <div class="ci-nm">
        <input
          type="text"
          class="ci-name clip-name"
          value={clip.label ?? ''}
          placeholder={clip.media.name}
          disabled={locked}
          onchange={(e) => patch({ label: (e.currentTarget as HTMLInputElement).value || undefined })}
          aria-label="Block name"
          data-clip-label
        />
        <small>Block on <span class="layer-name">{track?.layerName ?? ''}</span> · {rowKind}</small>
      </div>
      <button class="ci-icon" onclick={openMenu} title="Block menu: split, duplicate, group, colour, at the end, delete…" aria-label="Block menu" data-clip-inspector-menu><TimelineIcon name="more" /></button>
      <button class="ci-icon" onclick={onclose} title="Let go of the block" aria-label="Close block inspector"><TimelineIcon name="close" size={14} /></button>
    </div>
    <div class="ci-two">
      <button class="ci-btn" disabled={locked} onclick={() => fileInput?.click()} title="Replace the media with a file from this computer (or drop a Media Library card on the picture)"><TimelineIcon name="media" size={14} />Replace…</button>
      <button class="ci-btn" disabled={!clip.media.libraryId} onclick={showInMedia} title="Find this block's card in the Media tab"><TimelineIcon name="out" size={14} />Show in Media</button>
      <input class="hidden-file" type="file" accept="video/*,image/*,.fs,.isf,.mov,.mkv,.mxf,.hap" bind:this={fileInput} onchange={replaceFromFile} />
    </div>

    <section class="ci-sec">
      <h4 class="ci-eyebrow">Timing</h4>
      <div class="ci-pair">
        <label class="ci-f">
          <span class="ci-l">Start</span>
          <span class="ci-field">
            <input type="number" min="0" step="0.1" value={clip.startTime.toFixed(2)} disabled={locked} onchange={(e) => commit(e, setStart, (c) => c.startTime)} data-clip-start />
            <span class="ci-u">{tempo ? formatBarsBeats(tempo, clip.startTime) : 's'}</span>
          </span>
        </label>
        <label class="ci-f">
          <span class="ci-l">Length</span>
          <span class="ci-field">
            <input type="number" min="0.1" step="0.1" value={clip.duration.toFixed(2)} disabled={locked} onchange={(e) => commit(e, setDuration, (c) => c.duration)} data-clip-duration />
            <span class="ci-u">{tempo ? bars(clip.startTime, clip.startTime + clip.duration) : 's'}</span>
          </span>
        </label>
        <label class="ci-f">
          <span class="ci-l">Fade in</span>
          <span class="ci-field">
            <input type="number" min="0" step="0.1" value={clip.fadeIn.toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ fadeIn: Math.max(0, v || 0) }), (c) => c.fadeIn)} data-clip-fade-in />
            <span class="ci-u">s</span>
          </span>
        </label>
        <label class="ci-f">
          <span class="ci-l">Fade out</span>
          <span class="ci-field">
            <input type="number" min="0" step="0.1" value={clip.fadeOut.toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ fadeOut: Math.max(0, v || 0) }), (c) => c.fadeOut)} data-clip-fade-out />
            <span class="ci-u">s</span>
          </span>
        </label>
      </div>
      {#if isVideo}
        <div class="ci-row">
          <span class="ci-l">At the end</span>
          <select value={clip.endBehaviour} disabled={locked} onchange={(e) => setEnd((e.currentTarget as HTMLSelectElement).value as ShowClipEndBehaviour)} data-clip-end>
            {#each END_OPTIONS as opt (opt.value)}<option value={opt.value} title={opt.hint}>{opt.label}</option>{/each}
          </select>
        </div>
        <div class="ci-pair">
          <label class="ci-f" title={Number.isFinite(mediaLength) ? `The media is ${mediaLength.toFixed(2)} s long` : ''}>
            <span class="ci-l">In point</span>
            <span class="ci-field">
              <input type="number" min="0" step="0.1" value={clip.inPoint.toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ inPoint: Math.max(0, v || 0) }), (c) => c.inPoint)} data-clip-in />
              <span class="ci-u">s</span>
            </span>
          </label>
          <label class="ci-f">
            <span class="ci-l">Speed</span>
            <span class="ci-field">
              <input type="number" min={SHOW_MIN_RATE} max={SHOW_MAX_RATE} step="0.05" value={(clip.rate ?? 1).toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => patch({ rate: Math.max(SHOW_MIN_RATE, Math.min(SHOW_MAX_RATE, v || 1)) }), (c) => c.rate ?? 1)} data-clip-rate />
              <span class="ci-u">×</span>
            </span>
          </label>
        </div>
      {/if}
      {#if prev}
        <div class="ci-row" title="Crossfade from the block before, centred on the cut">
          <span class="ci-l">Crossfade</span>
          <span class="ci-inline">
            <input type="checkbox" checked={xfadeOn} disabled={locked} onchange={(e) => setXfade((e.currentTarget as HTMLInputElement).checked)} data-clip-xfade />
            {#if xfadeOn}
              <span class="ci-field ci-short">
                <input type="number" min="0.1" max={maxXfade} step="0.1" value={Math.min(maxXfade, clip.transitionDuration ?? 1).toFixed(2)} disabled={locked} onchange={(e) => commit(e, (v) => setXfade(true, v), (c) => Math.min(maxXfade, c.transitionDuration ?? 1))} data-clip-xfade-duration />
                <span class="ci-u">s</span>
              </span>
            {/if}
          </span>
        </div>
      {/if}
    </section>

    <section class="ci-sec">
      <h4 class="ci-eyebrow">Where</h4>
      <div class="ci-row">
        <span class="ci-l">Plays on</span>
        <span class="ci-plays"><TimelineIcon name={track?.group ? 'group' : 'piece'} size={14} /><span class="layer-name">{track?.layerName ?? ''}</span>{#if track?.group}<small>{pieces} {pieces === 1 ? 'piece' : 'pieces'}</small>{/if}</span>
      </div>
      {#if track?.group}
        <div class="ci-row">
          <span class="ci-l">Picture</span>
          <span class="ci-seg" role="group" aria-label="Picture">
            <button class:on={track.group.unified} disabled={locked} onclick={() => showTimeline.setGroupRowUnified(track!.id, true)} title="One picture spread across the pieces, each showing its part of it" data-picture-unified>One across them</button>
            <button class:on={!track.group.unified} disabled={locked} onclick={() => showTimeline.setGroupRowUnified(track!.id, false)} title="Every piece shows the whole picture" data-picture-each>Each piece</button>
          </span>
        </div>
      {/if}
      {#if !locked}
        <div class="ci-row"><span class="ci-l">Travel</span><WhereEditor where={clip.where} target={{ scope: 'block', id: clip.id }} /></div>
      {/if}
    </section>

    <section class="ci-sec">
      <h4 class="ci-eyebrow">Colour</h4>
      <span class="ci-swatches" role="group" aria-label="Block colour">
        {#each SWATCHES as sw (sw)}
          <button
            class="ci-swatch"
            class:on={(clip.color ?? '') === sw}
            style:background={sw || (track ? rowColor(track) : 'transparent')}
            class:row={!sw}
            disabled={locked}
            onclick={() => patch({ color: sw || undefined })}
            title={sw ? 'Block colour' : 'The row\'s colour'}
            aria-label={sw ? 'Block colour' : 'The row\'s colour'}
          ></button>
        {/each}
      </span>
      <p class="ci-hint">Look, opacity and blend are in Properties and Shader parameters: they show this block while it is selected.</p>
    </section>

    <section class="ci-sec">
      <h4 class="ci-eyebrow ci-head">Control lines
        <button class="ci-add" onclick={openPicker} disabled={locked} title="Add a control line: any parameter of this block or of its row" data-clip-line-add><TimelineIcon name="plus" size={12} />Line</button>
      </h4>
      {#each blockLines as line (line.id)}
        <div class="ci-line">
          <TimelineIcon name="control" size={14} />
          <button class="ci-line-name" onclick={() => lineSelection.set({ lineId: line.id, points: [] })} title="Select this line">{line.label ?? line.key}</button>
          <small>{line.follow ? 'follows' : 'drawn'}, {line.points.length} {line.points.length === 1 ? 'point' : 'points'}</small>
          <button class="ci-toggle" class:on={line.enabled !== false} onclick={() => toggleLine(line.id)} disabled={locked} aria-pressed={line.enabled !== false}
            title={line.enabled === false ? 'Off: kept, drives nothing. Click to turn it on' : 'On: click to turn this line off without deleting it'} aria-label="Line on"></button>
        </div>
      {:else}
        <p class="ci-hint">None yet. A line moves one setting over time.</p>
      {/each}
      <LinePointInfo />
    </section>

    {#if locked}<p class="ci-warn">This row is locked: unlock it to edit the block.</p>{/if}

    <div class="ci-foot">
      <button class="ci-btn" disabled={locked || $playheadSlice <= clip.startTime || $playheadSlice >= clip.startTime + clip.duration} onclick={() => splitAtPlayhead()} title="Split at the playhead"><TimelineIcon name="split" size={14} />Split<span class="ci-key">{KEYS.split}</span></button>
      <button class="ci-btn" disabled={locked} onclick={() => duplicateSelection()}><TimelineIcon name="dup" size={14} />Duplicate<span class="ci-key">{KEYS.duplicate}</span></button>
      <button class="ci-btn danger" disabled={locked} onclick={ondelete}><TimelineIcon name="trash" size={14} />Delete</button>
    </div>
  </div>
  {#if menu && track}
    <ShowClipContextMenu x={menu.x} y={menu.y} {track} {clip} ids={[clip.id]} playhead={$playheadSlice} onclose={() => (menu = null)} />
  {/if}
  {#if picker}
    <LinePicker targets={pickerTargets} x={picker.x} y={picker.y} onclose={() => (picker = null)} />
  {/if}
{/if}

<style>
  .ci { display: flex; flex-direction: column; gap: 10px; min-height: 100%; font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #ada9a2); }
  .ci-title { display: flex; align-items: flex-start; gap: 10px; }
  .ci-thumb {
    flex: 0 0 64px; height: 40px; border-radius: 5px; background: var(--ga-raise, #26221c) center / cover no-repeat;
    box-shadow: inset 0 0 0 1px rgba(245, 236, 222, 0.1);
  }
  .ci-thumb.hover { box-shadow: inset 0 0 0 2px var(--tl-on, #ff725f); }
  .ci-nm { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ci-nm b { font-size: var(--ga-text-title, 14px); font-weight: 650; color: var(--ga-ink-0, #f2ede4); }
  .ci-nm small { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ci-name {
    width: 100%; height: 22px; padding: 0 4px; margin-left: -4px; box-sizing: border-box;
    background: transparent; border: 1px solid transparent; border-radius: 4px;
    color: var(--ga-ink-0, #f2ede4); font: inherit; font-size: var(--ga-text-title, 14px); font-weight: 650;
  }
  .ci-name:hover, .ci-name:focus { border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13)); background: var(--ga-slot, #060504); outline: none; }
  .ci-name::placeholder { color: var(--ga-ink-0, #f2ede4); opacity: 1; }
  .ci-icon {
    flex: 0 0 24px; width: 24px; height: 24px; display: grid; place-items: center; padding: 0;
    border: 0; border-radius: 4px; background: transparent; color: var(--ga-ink-1, #ada9a2); cursor: pointer;
  }
  .ci-icon:hover { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .ci-two { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .ci-btn {
    height: var(--ga-control-h, 26px); display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 8px;
    background: var(--ga-card, #16140f); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-0, #f2ede4); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap;
  }
  .ci-btn :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .ci-btn:hover:not(:disabled) { background: var(--ga-raise, #26221c); }
  .ci-btn:disabled { opacity: 0.4; cursor: default; }
  .ci-btn.danger { color: var(--tl-on, #ff725f); }
  .ci-btn.danger :global(.tl-icon) { color: var(--tl-on, #ff725f); }
  .ci-key { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: 10px; color: var(--ga-ink-2, #89857e); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-bottom-width: 2px; border-radius: 3px; padding: 0 3px; line-height: 13px; }
  .ci-sec { display: flex; flex-direction: column; gap: 7px; padding-top: 9px; border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .ci-eyebrow { margin: 0 0 2px; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #89857e); }
  .ci-head { display: flex; align-items: center; justify-content: space-between; }
  .ci-add {
    display: inline-flex; align-items: center; gap: 3px; height: 20px; padding: 0 6px; border: 0; border-radius: 4px; background: transparent;
    color: var(--ga-ink-1, #ada9a2); font: inherit; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; cursor: pointer;
  }
  .ci-add :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .ci-add:hover:not(:disabled) { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .ci-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .ci-f { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .ci-l { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .ci-row { display: grid; grid-template-columns: 76px minmax(0, 1fr); align-items: center; gap: 8px; }
  .ci-row > .ci-l { font-size: var(--ga-text-control, 12px); color: var(--ga-ink-1, #ada9a2); }
  .ci-field {
    height: var(--ga-control-h, 26px); display: flex; align-items: center; gap: 6px; padding: 0 8px; box-sizing: border-box; min-width: 0;
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: 4px;
  }
  .ci-field:focus-within { border-color: var(--ga-selection-line, #5278ff); }
  .ci-field input {
    flex: 1; min-width: 0; width: 100%; padding: 0; border: 0; background: transparent; outline: none;
    color: var(--ga-ink-0, #f2ede4); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); font-size: var(--ga-text-control, 12px);
  }
  .ci-u { margin-left: auto; flex: 0 0 auto; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .ci-short { width: 90px; }
  .ci-inline { display: flex; align-items: center; gap: 8px; }
  .ci-row select {
    height: var(--ga-control-h, 26px); padding: 0 6px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    border-radius: 4px; color: var(--ga-ink-0, #f2ede4); font: inherit;
  }
  .ci-plays {
    height: var(--ga-control-h, 26px); display: flex; align-items: center; gap: 6px; padding: 0 8px; box-sizing: border-box; min-width: 0;
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: 4px; color: var(--ga-ink-0, #f2ede4);
  }
  .ci-plays :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .ci-plays small { margin-left: auto; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); }
  .ci-seg {
    display: grid; grid-template-columns: 1fr 1fr; gap: 2px; padding: 2px; height: var(--ga-control-h, 26px); box-sizing: border-box;
    background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: 4px;
  }
  .ci-seg button { border: 0; border-radius: 3px; background: transparent; color: var(--ga-ink-1, #ada9a2); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ci-seg button.on { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .ci-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
  .ci-swatch { width: 20px; height: 20px; padding: 0; border: 0; border-radius: 4px; cursor: pointer; }
  .ci-swatch.row { box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.4); opacity: 0.85; }
  .ci-swatch.on { box-shadow: 0 0 0 2px var(--ga-panel, #100f0d), 0 0 0 3px var(--ga-ink-0, #f2ede4); }
  .ci-hint { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); line-height: 1.45; }
  .ci-warn { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--tl-on, #ff725f); }
  .ci-line { display: flex; align-items: center; gap: 6px; min-height: 24px; }
  .ci-line :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .ci-line-name { border: 0; background: transparent; padding: 0; color: var(--ga-ink-0, #f2ede4); font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ci-line small { flex: 1; min-width: 0; color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ci-toggle { flex: 0 0 26px; width: 26px; height: 14px; padding: 0; border: 0; border-radius: 7px; background: var(--ga-raise, #26221c); position: relative; cursor: pointer; }
  .ci-toggle::after { content: ''; position: absolute; left: 2px; top: 2px; width: 10px; height: 10px; border-radius: 50%; background: var(--ga-ink-2, #89857e); transition: left 0.12s; }
  .ci-toggle.on { background: var(--tl-on-line, rgba(255, 114, 95, 0.46)); }
  .ci-toggle.on::after { left: 14px; background: var(--tl-on, #ff725f); }
  .ci-foot { margin-top: auto; display: flex; gap: 6px; padding-top: 10px; border-top: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); }
  .ci-foot .ci-btn { flex: 1; }
  .hidden-file { display: none; }
</style>
