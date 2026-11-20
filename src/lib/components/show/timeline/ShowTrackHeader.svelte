<script lang="ts">
  /**
   * A row's header in the show's label column: colour, the piece's name
   * (indented under its group; a group folds its children), the eye (hide
   * the piece for the whole show), Solo / Lock, "+ layer" (a layer of the
   * show's own on this piece, drawn over it) and the "⌇+" picker that adds a
   * control line under the row (for the piece, or a block on it). The lines'
   * headers follow underneath when the row is unfolded. Double-click the name to rename the piece (or an added
   * layer); an added layer can be dragged up or down among its piece's.
   *
   * LIVE takes the track's surface over (a VJ row, the mix, a group, black,
   * or media dropped on the button). While it is taken over the header is
   * orange, says what is playing, and ↩ hands it back (Shift: instantly).
   */
  import { selectRow } from './rowSelect';
  import type { Layer, ShowLayerTrack } from '../../../types';
  import TimelineIcon from './TimelineIcon.svelte';
  import { showTimeline } from '../../../stores/showTimeline';
  import { TRACK_ROW_HEIGHT, rowColor } from './trackLayout';
  import { lineLayout } from './lineUi';
  import { rowLineTarget } from '../../../timeline/lines/laneConversion';
  import { activeBlock } from '../../../show/tracks/showBlockEdit';
  import LineHeaders from './LineHeaders.svelte';
  import LinePicker from './LinePicker.svelte';
  import { renameShowTrack } from './trackHeaderActions';
  import { liveTakeover, takeoverSourceLabel, type SurfaceOverride } from '../../../show/takeover/liveTakeover';
  import { takeOverTrack } from '../../../show/takeover/takeoverRuntime';
  import ShowTakeoverMenu from './ShowTakeoverMenu.svelte';
  import { mayCarryTakeoverMedia, takeoverMediaFromDrop } from './takeoverUi';
  import { editGroupRowPieces } from './groupRowUi';
  import { showSlice } from './timelineSlices';
  import { CLIP_SWATCHES } from './clipMenuActions';
  import TlPopover from './TlPopover.svelte';

  interface Props {
    track: ShowLayerTrack;
    onStage: boolean;
    soloed: boolean;
    otherSoloed: boolean;
    selected: boolean;
    live: Layer | null;
    inactiveLanes: ReadonlySet<string>;
    /** Press on the header (not a button): the start of a reorder drag. */
    onpress?: (e: MouseEvent) => void;
    /** True while the header is being dragged to another row. */
    dragging?: boolean;
    /** The live takeover of this track's surface, if any. */
    takeover?: SurfaceOverride | null;
    /** Layers added on this piece (its meta line says so). */
    layersOn?: number;
  }

  let { track, onStage, soloed, otherSoloed, selected, live, inactiveLanes, onpress, dragging = false, takeover = null, layersOn = 0 }: Props = $props();

  // A slice: the whole store publishes every playhead frame.
  const ordersSlice = showSlice('whereOrders');
  /** The group row's piece count. */
  const pieces = $derived.by(() => {
    if (!track.group) return 0;
    const order = $ordersSlice.find((o) => o.id === track.group!.orderId);
    return order?.slots ? order.slots.reduce((n, slot) => n + slot.length, 0) : 0;
  });
  /** The line under the name: what the row is doing. */
  // Whole phrases, so each language pack has the sentence to translate
  // (named …Text so the extractor reads them).
  const metaText = $derived.by(() => {
    if (track.group) {
      if (track.group.unified) return pieces === 1 ? '1 piece · one picture' : `${pieces} pieces · one picture`;
      return pieces === 1 ? '1 piece · each piece' : `${pieces} pieces · each piece`;
    }
    if (kind === 'missing') return 'missing piece';
    if (track.muted) return 'hidden for the whole show';
    if (kind === 'sub') return live?.name ? `layer on ${live.name}` : 'layer on its piece';
    if (kind === 'group') return 'a group of layers';
    if (!onStage) return 'not in the current look';
    if (layersOn > 0) return layersOn === 1 ? '1 layer on it' : `${layersOn} layers on it`;
    if (track.gap === 'layer' && track.clips.length > 0) return 'look between blocks';
    if (!track.clips.length) return 'shows its look';
    return track.clips.length === 1 ? '1 block' : `${track.clips.length} blocks`;
  });


  // ── ⋯ menu ───────────────────────────────────────────────────────────
  let moreAnchor: HTMLButtonElement | undefined = $state();
  let moreOpen = $state(false);
  function more(fn: () => void) {
    moreOpen = false;
    fn();
  }
  function takeOverFromMenu() {
    const r = moreAnchor?.getBoundingClientRect();
    moreOpen = false;
    if (r) liveMenu = { x: r.left, y: r.top - 4 };
  }
  function addLineFromMenu() {
    const r = moreAnchor?.getBoundingClientRect();
    moreOpen = false;
    if (r) picker = { x: r.left, y: r.top - 4 };
  }

  // ── Live takeover ────────────────────────────────────────────────────
  const taken = $derived(!!takeover && takeover.phase !== 'releasing');
  let liveMenu: { x: number; y: number } | null = $state(null);
  let liveDrop = $state(false);
  function openLiveMenu(e: MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    liveMenu = liveMenu ? null : { x: r.left, y: r.top - 4 };
  }
  function returnLive(e: MouseEvent) {
    e.stopPropagation();
    liveTakeover.release(track.layerId, e.shiftKey ? { mode: 'instant' } : undefined);
  }
  function liveDragOver(e: DragEvent) {
    if (!mayCarryTakeoverMedia(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) e.dataTransfer.dropEffect = e.dataTransfer.effectAllowed === 'move' ? 'move' : 'copy';
    liveDrop = true;
  }
  async function liveDropMedia(e: DragEvent) {
    liveDrop = false;
    if (!e.dataTransfer || !mayCarryTakeoverMedia(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    const media = await takeoverMediaFromDrop(e.dataTransfer);
    if (media) takeOverTrack(track, { kind: 'media', media });
  }

  // ── Rename ───────────────────────────────────────────────────────────
  let editing = $state(false);
  let draft = $state('');
  function startRename(e?: MouseEvent) {
    e?.stopPropagation();
    if (!canRename) return;
    draft = track.layerName;
    editing = true;
  }
  function focusInput(node: HTMLInputElement) {
    node.focus();
    node.select();
  }
  function commitRename() {
    if (!editing) return;
    editing = false;
    renameShowTrack(track, draft, kind === 'sub' ? null : live);
  }

  const color = $derived(rowColor(track));
  const kind = $derived(track.row?.kind ?? (track.subRow ? 'sub' : 'piece'));
  const depth = $derived(track.row?.depth ?? 0);
  const canRename = $derived(kind === 'sub' || !!live);

  /** The row, and the Media Library (or the piece's panel) beside the canvas. */
  function selectTrack() {
    selectRow(track);
  }

  // ── Control lines ────────────────────────────────────────────────────
  const rowLines = $derived($lineLayout.lines.get(track.id) ?? []);
  const linesExpanded = $derived($lineLayout.expanded.has(track.id));
  const blockNames = $derived(Object.fromEntries(track.clips.map((c) => [c.id, c.media.name || 'Block'])));
  let picker: { x: number; y: number } | null = $state(null);
  /** What the picker offers: the piece (or this added layer), then the
   *  blocks on the row, the selected block first. */
  const pickerTargets = $derived.by(() => {
    if (!picker) return [];
    const selectedClip = $activeBlock?.clipId;
    const blocks = track.clips
      .filter((c) => c.media.kind === 'shader' || c.media.kind === 'video' || !!c.media.jsAnimation)
      .sort((a, b) => (a.id === selectedClip ? -1 : b.id === selectedClip ? 1 : a.startTime - b.startTime))
      .map((c) => ({ target: { scope: 'block' as const, id: c.id }, label: `Block: ${c.media.name || 'block'}` }));
    const own = { target: rowLineTarget(track), label: kind === 'sub' ? track.layerName : `Piece: ${track.layerName}` };
    return selectedClip && blocks[0]?.target.id === selectedClip ? [blocks[0], own, ...blocks.slice(1)] : [own, ...blocks];
  });

  function openPicker(e: MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = picker ? null : { x: r.left, y: r.top - 4 };
  }
</script>

<div class="th" class:selected class:dragging class:live={taken} class:returning={takeover?.phase === 'pendingRelease'} class:sub={kind === 'sub' && !track.group} class:grouprow={!!track.group} class:missing={kind === 'missing'} class:hidden-row={track.muted} class:menu-open={moreOpen} style:--track-color={color} style:--row-indent="{track.group ? 0 : depth * 12}px" data-track-header={track.id} data-row-kind={kind} data-row-layer={track.layerId}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="th-main"
    style:height="{TRACK_ROW_HEIGHT}px"
    onclick={selectTrack}
    onmousedown={(e) => {
      const target = e.target as HTMLElement;
      if (e.button !== 0 || editing || target.closest('button') || target.closest('input')) return;
      onpress?.(e);
    }}
  >
    <span class="th-color" aria-hidden="true"></span>
    {#if kind === 'group'}
      <button
        class="th-fold"
        class:open={!track.foldChildren}
        onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { foldChildren: !track.foldChildren }); }}
        title={track.foldChildren ? 'Show the rows of the layers in this group' : 'Fold the rows of the layers in this group'}
        aria-label={track.foldChildren ? 'Show the rows of the layers in this group' : 'Fold the rows of the layers in this group'}
        data-group-fold
      ><TimelineIcon name="chevron" size={12} /></button>
    {:else}
      <button
        class="th-fold"
        class:open={!track.collapsed}
        class:none={!rowLines.length}
        disabled={!rowLines.length}
        onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { collapsed: !track.collapsed }); }}
        title={track.collapsed ? 'Show the control lines' : 'Hide the control lines'}
        aria-label={track.collapsed ? 'Show the control lines' : 'Hide the control lines'}
      ><TimelineIcon name="chevron" size={12} /></button>
    {/if}
    {#if track.group}
      <button class="th-type th-group-mark" onmousedown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); editGroupRowPieces(track); }} title="A group row: its blocks play across a group of pieces. Click to choose the pieces on the canvas" aria-label="Edit the group's pieces" data-group-row-pieces><TimelineIcon name="group" size={15} /></button>
    {:else}
      <span class="th-type" aria-hidden="true"><TimelineIcon name={kind === 'sub' ? 'layers' : kind === 'group' ? 'layers' : 'piece'} size={15} /></span>
    {/if}
    <div class="th-col">
      {#if editing}
        <input
          class="th-rename"
          type="text"
          bind:value={draft}
          use:focusInput
          onclick={(e) => e.stopPropagation()}
          onmousedown={(e) => e.stopPropagation()}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitRename();
            else if (e.key === 'Escape') editing = false;
          }}
          onblur={commitRename}
          aria-label="Track name"
          data-track-rename
        />
      {:else}
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span
          class="th-name layer-name"
          title={track.group
            ? `${track.layerName}: a group row. Its blocks play across the group's pieces (${track.group.unified ? 'one picture across them' : 'the whole picture on each'}). Double-click to rename.`
            : kind === 'sub'
            ? `${track.layerName}: a layer of the show's own on this piece, drawn over it. Double-click to rename.`
            : kind === 'missing'
              ? `${track.layerName}: this mapping layer is gone from the stage and from every look the show uses.`
              : canRename ? `${track.layerName}: double-click to rename the layer` : `${track.layerName}: rename it in the look it belongs to`}
          ondblclick={startRename}
          data-track-name
        >{track.layerName}</span>
      {/if}
      <span class="th-meta">
        {#if taken}
          <span class="th-taken" title={takeover?.phase === 'pendingRelease' ? 'Taken over live: going back to the Timeline' : `Taken over live by ${takeoverSourceLabel(takeover!.source)}: the Timeline plays on underneath`} data-takeover-badge>Taken over</span>
          <button class="th-ret" onmousedown={(e) => e.stopPropagation()} onclick={returnLive} title="Return to the Timeline (Shift: instantly)" data-takeover-return><TimelineIcon name="ret" size={11} />Return</button>
        {:else if track.group}
          <button class="th-meta-btn" disabled={track.locked} onmousedown={(e) => e.stopPropagation()}
            onclick={(e) => { e.stopPropagation(); showTimeline.setGroupRowUnified(track.id, !track.group!.unified); }}
            title={track.group.unified ? 'One picture across the pieces. Click for each piece (the whole picture on each)' : 'The whole picture on each piece. Click for one picture across them'}
            aria-pressed={track.group.unified} data-group-row-mode>{metaText}</button>
        {:else}
          <span class:warn={kind === 'missing'}>{metaText}</span>
        {/if}
      </span>
    </div>
    <div class="th-ctl">
      <button class="th-btn hov lanes" onmousedown={(e) => e.stopPropagation()} onclick={openPicker} title="Add a control line under this row: any parameter of the piece or of a block on it" aria-label="Add a control line" data-line-picker><TimelineIcon name="line-add" size={14} /></button>
      {#if kind !== 'sub' || track.group}
        <button
          class="th-btn hov th-live"
          class:on={taken}
          class:drop={liveDrop}
          onmousedown={(e) => e.stopPropagation()}
          onclick={openLiveMenu}
          ondragover={liveDragOver}
          ondragleave={() => (liveDrop = false)}
          ondrop={liveDropMedia}
          title="Take this row over live: a VJ row, the mix, a group or black. Drop media here to play it."
          aria-label="Take this track over live"
          aria-pressed={taken}
          data-takeover-live
        ><TimelineIcon name="live" size={14} /></button>
      {/if}
      <button
        class="th-btn th-eye"
        class:on={track.muted}
        onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { muted: !track.muted }); }}
        title={track.muted ? 'Hidden for the whole show: click to show it again' : 'Visible: click to hide this piece for the whole show'}
        aria-label={track.muted ? 'Show this piece' : 'Hide this piece for the whole show'}
        aria-pressed={track.muted}
        data-row-eye
      ><TimelineIcon name={track.muted ? 'eye-off' : 'eye'} size={14} /></button>
      <button
        class="th-btn solo"
        class:on={soloed}
        class:dim={otherSoloed}
        onclick={(e) => { e.stopPropagation(); showTimeline.setSoloTrack(soloed ? null : track.id); }}
        title="Solo: hide every other row (not saved)"
        aria-label="Solo this piece"
        aria-pressed={soloed}
      ><TimelineIcon name="solo" size={14} /></button>
      <button
        class="th-btn lock"
        class:on={track.locked}
        onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { locked: !track.locked }); }}
        title={track.locked ? 'Locked: no edits on this row. Click to unlock' : 'Lock: no edits on this row'}
        aria-label={track.locked ? 'Unlock this track' : 'Lock this track'}
        aria-pressed={track.locked}
      ><TimelineIcon name={track.locked ? 'lock' : 'unlock'} size={14} /></button>
      <button class="th-btn hov th-more" bind:this={moreAnchor} onmousedown={(e) => e.stopPropagation()} onclick={(e) => { e.stopPropagation(); moreOpen = !moreOpen; }} title="More for this row" aria-label="More for this row" aria-expanded={moreOpen} data-row-more><TimelineIcon name="more" size={14} /></button>
    </div>
  </div>
  {#if !track.collapsed && rowLines.length}
    <LineHeaders groupId={track.id} lines={rowLines} expanded={linesExpanded} locked={track.locked} {blockNames} />
  {/if}
</div>

{#if moreOpen}
  <TlPopover anchor={moreAnchor} onclose={() => (moreOpen = false)} width={230} label="Row">
    <button class="tl-mi" onclick={addLineFromMenu} data-row-menu-line><TimelineIcon name="line-add" size={14} />Add control line</button>
    {#if kind === 'piece' || kind === 'group'}
      <button class="tl-mi" onclick={() => more(() => showTimeline.addSubRow(track.layerId))} data-add-sub-row><TimelineIcon name="layer-add" size={14} />Add a layer on this piece</button>
    {/if}
    {#if kind !== 'sub' || track.group}
      <button class="tl-mi" onclick={takeOverFromMenu}><TimelineIcon name="live" size={14} />Take over<span class="tl-mi-key">▸</span></button>
    {/if}
    {#if track.group}
      <button class="tl-mi" onclick={() => more(() => editGroupRowPieces(track))}><TimelineIcon name="group" size={14} />Edit pieces</button>
      <button class="tl-mi" class:on={track.group.unified} disabled={track.locked} onclick={() => more(() => showTimeline.setGroupRowUnified(track.id, true))}>{#if track.group.unified}<TimelineIcon name="check" size={14} />{:else}<span class="th-gap14"></span>{/if}One picture across them</button>
      <button class="tl-mi" class:on={!track.group.unified} disabled={track.locked} onclick={() => more(() => showTimeline.setGroupRowUnified(track.id, false))}>{#if !track.group.unified}<TimelineIcon name="check" size={14} />{:else}<span class="th-gap14"></span>{/if}Each piece</button>
    {/if}
    {#if track.gap === 'layer' && track.clips.length > 0}
      <div class="tl-pop-row th-note">Between blocks this piece shows what the current look gives it.</div>
    {/if}
    <div class="tl-mi-head">Colour</div>
    <div class="tl-pop-row th-swatches">
      {#each ['', ...CLIP_SWATCHES] as sw (sw)}
        <button class="th-sw" class:on={(track.color ?? '') === sw} style:background={sw || 'transparent'} onclick={() => more(() => showTimeline.updateLayerTrack(track.id, { color: sw || undefined }))}
          title={sw ? 'Row colour' : 'The piece\'s own colour'} aria-label={sw ? 'Row colour' : 'The piece\'s own colour'}></button>
      {/each}
    </div>
    <div class="tl-mi-sep"></div>
    <button class="tl-mi" disabled={!canRename} onclick={() => more(() => startRename())}><TimelineIcon name="pen" size={14} />Rename</button>
    {#if kind === 'sub' || kind === 'missing'}
      <button class="tl-mi danger" onclick={() => more(() => showTimeline.removeLayerTrack(track.id))} data-remove-row><TimelineIcon name="trash" size={14} />{kind === 'sub' ? 'Remove this row and its blocks' : 'Delete this row and its blocks'}</button>
    {/if}
  </TlPopover>
{/if}

{#if liveMenu}
  <ShowTakeoverMenu x={liveMenu.x} y={liveMenu.y} {track} onclose={() => (liveMenu = null)} />
{/if}

{#if picker}
  <LinePicker targets={pickerTargets} x={picker.x} y={picker.y} onclose={() => (picker = null)} />
{/if}

<style>
  .th { --track-color: #8b7cff; }
  .th-main {
    position: relative;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 4px 0 calc(8px + var(--row-indent, 0px));
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07));
    cursor: pointer;
  }
  .th.sub .th-main { padding-left: calc(22px + var(--row-indent, 0px)); }
  .th-main:hover { background: rgba(245, 236, 222, 0.035); }
  .th.selected .th-main { background: rgba(255, 114, 95, 0.07); }
  .th.selected .th-main::after { content: ''; position: absolute; right: 0; top: 0; bottom: 0; width: 2px; background: var(--tl-on, #ff725f); }
  .th.dragging .th-main { opacity: 0.55; cursor: grabbing; }
  .th-color { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: color-mix(in srgb, var(--track-color) 85%, transparent); }
  .th.sub .th-color { opacity: 0.55; }
  .th-fold {
    flex: 0 0 16px;
    width: 16px;
    height: 22px;
    margin-left: -4px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 3px;
    background: transparent;
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
  }
  .th-fold :global(.tl-icon) { transform: rotate(-90deg); transition: transform 0.12s; }
  .th-fold.open :global(.tl-icon) { transform: none; }
  .th-fold.none { visibility: hidden; }
  .th-fold:hover:not(:disabled) { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .th-type { flex: 0 0 auto; display: inline-flex; color: var(--ga-icon, #5278ff); }
  .th-group-mark { padding: 2px; border: 0; border-radius: 4px; background: none; cursor: pointer; }
  .th-group-mark:hover { background: var(--ga-raise, #26221c); }
  .th-col { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .th-name {
    font-size: var(--ga-text-body, 13px);
    font-weight: 600;
    color: var(--ga-ink-0, #f2ede4);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 16px;
  }
  .th.sub .th-name { font-weight: 500; }
  .th.missing .th-name { color: var(--ga-ink-2, #89857e); text-decoration: line-through; }
  .th.hidden-row .th-name { opacity: 0.55; }
  .th-meta { display: flex; align-items: center; gap: 4px; min-width: 0; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); white-space: nowrap; overflow: hidden; line-height: 14px; }
  .th-meta > span { overflow: hidden; text-overflow: ellipsis; }
  .th-meta .warn { color: var(--tl-on, #ff725f); }
  .th-meta-btn { padding: 0; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; overflow: hidden; text-overflow: ellipsis; }
  .th-meta-btn:hover:not(:disabled) { color: var(--ga-ink-0, #f2ede4); text-decoration: underline; }
  .th-taken { flex: 0 0 auto; height: 15px; padding: 0 6px; border-radius: 8px; background: var(--tl-on, #ff725f); color: #1a0a06; font-size: 10px; font-weight: 750; line-height: 15px; }
  .th.returning .th-taken { background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); color: var(--tl-on-ink, #ffd9d2); }
  .th-ret { display: inline-flex; align-items: center; gap: 2px; padding: 0 2px; border: 0; background: none; color: var(--tl-on, #ff725f); font: inherit; font-weight: 600; cursor: pointer; }
  .th-ret:hover { text-decoration: underline; }
  .th-rename {
    width: 100%;
    min-width: 0;
    height: 18px;
    box-sizing: border-box;
    padding: 0 4px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    color: var(--ga-ink-0, #fff);
    background: var(--ga-slot, rgba(255, 255, 255, 0.06));
    border: 1px solid var(--ga-selection-line, #5278ff);
    border-radius: 3px;
    outline: none;
  }
  .th-ctl { flex: 0 0 auto; display: flex; align-items: center; }
  .th-btn {
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: var(--ga-ink-2, #89857e);
    cursor: pointer;
  }
  .th-btn:hover:not(:disabled) { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .th-btn.solo:not(.on), .th-btn.lock:not(.on) { color: var(--ga-ink-3, #39342c); }
  .th-main:hover .th-btn.solo:not(.on), .th-main:hover .th-btn.lock:not(.on) { color: var(--ga-ink-2, #89857e); }
  .th-btn.on { color: var(--tl-on, #ff725f); background: var(--tl-on-soft, rgba(255, 114, 95, 0.13)); }
  .th-btn.dim { opacity: 0.45; }
  .th-btn.hov { display: none; }
  .th-main:hover .th-btn.hov, .th.selected .th-btn.hov, .th.menu-open .th-btn.hov, .th-btn.hov.on, .th-btn.hov.drop { display: grid; }
  .th-btn.th-live.drop { box-shadow: inset 0 0 0 1px var(--tl-on, #ff725f); }
  .th-gap14 { width: 14px; flex: 0 0 auto; }
  :global(.tl-pop) .th-note { white-space: normal; font-size: 11px; color: var(--ga-ink-2, #89857e); }
  :global(.tl-pop) .th-swatches { gap: 6px; }
  :global(.tl-pop) .th-sw { width: 18px; height: 18px; padding: 0; border-radius: 4px; border: 1px solid var(--ga-line-3, rgba(245, 236, 222, 0.24)); cursor: pointer; }
  :global(.tl-pop) .th-sw.on { box-shadow: 0 0 0 2px var(--ga-card, #16140f), 0 0 0 3px var(--ga-ink-0, #f2ede4); }
</style>
