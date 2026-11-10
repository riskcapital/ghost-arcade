<script lang="ts">
  /**
   * A row's header in the show's label column: colour, the piece's name
   * (indented under its group; a group folds its children), the eye (hide
   * the piece for the whole show), Solo / Lock, "+ layer" (a layer of the
   * show's own on this piece, drawn over it) and the "◆+" picker that folds a
   * keyframe lane open under the row. Lane headers follow underneath when the
   * row is unfolded. Double-click the name to rename the piece (or an added
   * layer); an added layer can be dragged up or down among its piece's.
   *
   * LIVE takes the track's surface over (a VJ row, the mix, a group, black,
   * or media dropped on the button). While it is taken over the header is
   * orange, says what is playing, and ↩ hands it back (Shift: instantly).
   */
  import { get } from 'svelte/store';
  import type { Layer, ShowLayerTrack } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { evaluateTrack } from '../../../keyframes/easing';
  import { LANE_ROW_HEIGHT, TRACK_ROW_HEIGHT, laneKeySelection, portal, rowColor } from './trackLayout';
  import { trackLaneParams } from './trackParams';
  import { renameShowTrack } from './trackHeaderActions';
  import { liveTakeover, takeoverSourceLabel, type SurfaceOverride } from '../../../show/takeover/liveTakeover';
  import { takeOverTrack } from '../../../show/takeover/takeoverRuntime';
  import ShowTakeoverMenu from './ShowTakeoverMenu.svelte';
  import { mayCarryTakeoverMedia, takeoverMediaFromDrop } from './takeoverUi';

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
  }

  let { track, onStage, soloed, otherSoloed, selected, live, inactiveLanes, onpress, dragging = false, takeover = null }: Props = $props();

  // ── Live takeover ────────────────────────────────────────────────────
  const taken = $derived(!!takeover && takeover.phase !== 'releasing');
  const liveText = $derived(takeover ? `LIVE · ${takeoverSourceLabel(takeover.source)}` : '');
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
  function startRename(e: MouseEvent) {
    e.stopPropagation();
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
  function addLayerOnPiece(e: MouseEvent) {
    e.stopPropagation();
    showTimeline.addSubRow(track.layerId);
  }
  function removeRow(e: MouseEvent) {
    e.stopPropagation();
    showTimeline.removeLayerTrack(track.id);
  }

  function selectTrack() {
    showTimeline.select({ kind: 'track', id: track.id });
  }

  // ── Lane picker ──────────────────────────────────────────────────────
  let picker: { x: number; y: number } | null = $state(null);
  const params = $derived(picker ? trackLaneParams(track, live) : []);
  const groups = $derived.by(() => {
    const used = new Set(track.lanes.map((l) => l.key));
    const out = new Map<string, typeof params>();
    for (const p of params) {
      if (used.has(p.key)) continue;
      const list = out.get(p.group) ?? [];
      list.push(p);
      out.set(p.group, list);
    }
    return [...out.entries()];
  });

  function openPicker(e: MouseEvent) {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    picker = picker ? null : { x: r.left, y: r.top - 4 };
  }

  $effect(() => {
    if (!picker) return;
    const close = () => { picker = null; };
    const t = setTimeout(() => window.addEventListener('mousedown', close), 0);
    return () => {
      clearTimeout(t);
      window.removeEventListener('mousedown', close);
    };
  });

  function addLane(p: { key: string; label: string; type: 'number' | 'boolean' }) {
    showTimeline.addTrackLane(track.id, { key: p.key, label: p.label, type: p.type });
    picker = null;
  }

  /** "◆": a key at the playhead holding the value the lane has there (or the layer's own). */
  function keyAtPlayhead(key: string) {
    const lane = track.lanes.find((l) => l.key === key);
    if (!lane) return;
    const t = get(showTimeline).currentTime;
    let value = evaluateTrack(lane, t);
    if (value === undefined) {
      const p = trackLaneParams(track, live).find((x) => x.key === key);
      value = p ? p.defaultValue : lane.type === 'boolean' ? true : 1;
    }
    showTimeline.setLaneKey(track.id, key, t, value);
    laneKeySelection.set({ trackId: track.id, key, times: [t] });
  }
</script>

<div class="th" class:selected class:dragging class:live={taken} class:returning={takeover?.phase === 'pendingRelease'} class:sub={kind === 'sub'} class:missing={kind === 'missing'} class:hidden-row={track.muted} style:--track-color={color} style:--row-indent="{depth * 10}px" data-track-header={track.id} data-row-kind={kind} data-row-layer={track.layerId}>
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
    <div class="th-col">
      <div class="th-line">
        {#if kind === 'group'}
          <button
            class="th-fold th-group"
            class:open={!track.foldChildren}
            onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { foldChildren: !track.foldChildren }); }}
            title={track.foldChildren ? 'Show the rows of the layers in this group' : 'Fold the rows of the layers in this group'}
            aria-label={track.foldChildren ? 'Show the rows of the layers in this group' : 'Fold the rows of the layers in this group'}
            data-group-fold
          >▸</button>
        {:else}
          <button
            class="th-fold"
            class:open={!track.collapsed}
            disabled={!track.lanes.length}
            onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { collapsed: !track.collapsed }); }}
            title={track.collapsed ? 'Show keyframe lanes' : 'Hide keyframe lanes'}
            aria-label={track.collapsed ? 'Show keyframe lanes' : 'Hide keyframe lanes'}
          >▸</button>
        {/if}
        {#if kind === 'sub'}<span class="th-sub-mark" aria-hidden="true">└</span>{/if}
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
            title={kind === 'sub'
              ? `${track.layerName}: a layer of the show's own on this piece, drawn over it. Double-click to rename.`
              : kind === 'missing'
                ? `${track.layerName}: this mapping layer is gone from the stage and from every look the show uses.`
                : canRename ? `${track.layerName}: double-click to rename the layer` : `${track.layerName}: rename it in the look it belongs to`}
            ondblclick={startRename}
            data-track-name
          >{track.layerName}</span>
        {/if}
        {#if taken}
          <span class="th-live-badge" title={takeover?.phase === 'pendingRelease' ? 'Taken over live: returning to the timeline' : 'Taken over live: the timeline plays on underneath'} data-takeover-badge>{liveText}</span>
        {:else if kind === 'missing'}
          <span class="th-badge" title="This mapping layer is gone. Its blocks are kept until you delete the row.">missing piece</span>
        {/if}
      </div>
      <div class="th-line th-buttons">
        <button
          class="th-btn th-eye"
          class:on={track.muted}
          onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { muted: !track.muted }); }}
          title={track.muted ? 'Hidden for the whole show: click to show it again' : 'Visible: click to hide this piece for the whole show'}
          aria-label={track.muted ? 'Show this piece' : 'Hide this piece for the whole show'}
          aria-pressed={track.muted}
          data-row-eye
        >
          <svg width="13" height="10" viewBox="0 0 24 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <path d="M1 8s4-7 11-7 11 7 11 7-4 7-11 7S1 8 1 8z" />
            {#if track.muted}<path d="M3 15L21 1" />{:else}<circle cx="12" cy="8" r="3" />{/if}
          </svg>
        </button>
        <button
          class="th-btn solo"
          class:on={soloed}
          class:dim={otherSoloed}
          onclick={(e) => { e.stopPropagation(); showTimeline.setSoloTrack(soloed ? null : track.id); }}
          title="Solo: hide every other tracked layer (not saved)"
          aria-pressed={soloed}
        >S</button>
        <button
          class="th-btn lock"
          class:on={track.locked}
          onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { locked: !track.locked }); }}
          title="Lock: no edits on this track"
          aria-pressed={track.locked}
        >L</button>
        <button class="th-btn lanes" onmousedown={(e) => e.stopPropagation()} onclick={openPicker} title="Add a keyframe lane under this row" data-lane-picker>◆+</button>
        {#if kind === 'piece' || kind === 'group'}
          <button class="th-btn th-addsub" onmousedown={(e) => e.stopPropagation()} onclick={addLayerOnPiece} title="Add a layer on this piece: a row of its own whose blocks draw over the piece (same shape), each with its own blend mode" data-add-sub-row>+ layer</button>
        {:else}
          <button class="th-btn th-remove" onmousedown={(e) => e.stopPropagation()} onclick={removeRow} title={kind === 'sub' ? 'Remove this layer and its blocks' : 'Delete this row and its blocks'} aria-label={kind === 'sub' ? 'Remove this layer and its blocks' : 'Delete this row and its blocks'} data-remove-row>×</button>
        {/if}
        {#if taken}
          <button
            class="th-btn th-return"
            onmousedown={(e) => e.stopPropagation()}
            onclick={returnLive}
            title="Return to the timeline (Shift: instantly)"
            data-takeover-return
          >↩</button>
        {/if}
        {#if kind !== 'sub'}
        <button
          class="th-btn th-live"
          class:on={taken}
          class:drop={liveDrop}
          onmousedown={(e) => e.stopPropagation()}
          onclick={openLiveMenu}
          ondragover={liveDragOver}
          ondragleave={() => (liveDrop = false)}
          ondrop={liveDropMedia}
          title="Take this track over live: a VJ row, the mix, a group or black. Drop media here to play it."
          aria-pressed={taken}
          data-takeover-live
        >LIVE</button>
        {/if}
        {#if track.gap === 'layer' && track.clips.length > 0}
          <span class="th-gap" title="Between blocks this piece shows what the current look gives it (the row's settings)">look between</span>
        {/if}
      </div>
    </div>
  </div>
  {#if !track.collapsed}
    {#each track.lanes as lane (lane.key)}
      <div class="th-lane" class:inactive={inactiveLanes.has(lane.key)} style:height="{LANE_ROW_HEIGHT}px" data-lane-header={lane.key}>
        <span class="th-lane-name" title={inactiveLanes.has(lane.key) ? `${lane.label}: not on this layer right now` : lane.label}>{lane.label}</span>
        <button class="th-lane-btn" disabled={track.locked} onclick={() => keyAtPlayhead(lane.key)} title="Add a key at the playhead" data-lane-key-here>◆</button>
        <button class="th-lane-btn" disabled={track.locked} onclick={() => showTimeline.removeTrackLane(track.id, lane.key)} title="Remove this lane and its keys" aria-label="Remove this lane and its keys">×</button>
      </div>
    {/each}
  {/if}
</div>

{#if liveMenu}
  <ShowTakeoverMenu x={liveMenu.x} y={liveMenu.y} {track} onclose={() => (liveMenu = null)} />
{/if}

{#if picker}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="th-picker" use:portal style:left="{picker.x}px" style:top="{picker.y}px" onmousedown={(e) => e.stopPropagation()} data-lane-picker-menu>
    <div class="th-picker-head">Keyframe lane</div>
    {#if groups.length === 0}
      <div class="th-picker-empty">Every parameter already has a lane.</div>
    {/if}
    {#each groups as [group, list] (group)}
      <div class="th-picker-group">{group}</div>
      {#each list as p (p.key)}
        <button class="th-picker-item" onclick={() => addLane(p)} data-param-key={p.key}>{p.label}</button>
      {/each}
    {/each}
  </div>
{/if}

<style>
  .th { --track-color: #8b7cff; }
  .th-main {
    display: flex;
    align-items: stretch;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    cursor: pointer;
  }
  .th.selected .th-main { background: color-mix(in srgb, var(--track-color) 12%, transparent); }
  .th.dragging .th-main { opacity: 0.55; cursor: grabbing; }
  .th-rename {
    flex: 1 1 auto;
    min-width: 0;
    height: 18px;
    box-sizing: border-box;
    padding: 0 4px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    color: var(--ga-ink-0, #fff);
    background: var(--ga-slot, rgba(255, 255, 255, 0.06));
    border: 1px solid #FFD96B;
    border-radius: 3px;
    outline: none;
  }
  .th-color { flex: 0 0 4px; background: var(--track-color); margin-left: var(--row-indent, 0px); }
  .th.sub .th-color { opacity: 0.55; }
  .th.sub .th-name { font-weight: 500; color: var(--ga-ink-1, #bbb); }
  .th.missing .th-name { color: var(--ga-ink-2, #888); text-decoration: line-through; }
  .th.hidden-row .th-name { opacity: 0.5; }
  .th-sub-mark { color: var(--ga-ink-2, #666); font-size: 10px; margin-right: -2px; }
  .th-btn.th-eye { display: inline-flex; align-items: center; justify-content: center; }
  .th-btn.th-eye.on { color: #1a1204; background: #9aa0aa; border-color: #9aa0aa; }
  .th-btn.th-addsub { color: color-mix(in srgb, var(--track-color) 70%, #ffffff); }
  .th-btn.th-remove { font-size: 12px; line-height: 1; }
  .th-col {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    padding: 0 6px 0 4px;
  }
  .th-line { display: flex; align-items: center; gap: 4px; min-width: 0; }
  .th-fold {
    width: 14px;
    height: 14px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--ga-ink-2, #7a7a86);
    font-size: 10px;
    cursor: pointer;
    transition: transform 0.12s ease;
  }
  .th-fold.open { transform: rotate(90deg); }
  .th-fold:disabled { opacity: 0.25; cursor: default; }
  .th-name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--ga-text-control, 12px);
    font-weight: 600;
    color: var(--ga-ink-0, #ddd);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .th-badge {
    flex: 0 0 auto;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: #f0c674;
    border: 1px solid rgba(240, 198, 116, 0.45);
    border-radius: 3px;
    padding: 0 4px;
    line-height: 14px;
  }
  .th-buttons { padding-left: 18px; gap: 3px; }
  .th-btn {
    height: 18px;
    min-width: 20px;
    padding: 0 4px;
    font: inherit;
    font-size: 10px;
    font-weight: 700;
    color: var(--ga-ink-1, #999);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 3px;
    cursor: pointer;
  }
  .th-btn:hover:not(.on) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .th-btn.on { color: #1a1204; background: #f0c674; border-color: #f0c674; }
  .th-btn.solo.on { background: #5fdc76; border-color: #5fdc76; }
  .th-btn.lock.on { background: #9aa0aa; border-color: #9aa0aa; }
  .th-btn.solo.dim { opacity: 0.5; }
  .th-btn.lanes { color: var(--ga-coral, #ff6f5e); }
  .th-btn.th-live { margin-left: auto; color: #ff8c28; border-color: rgba(255, 140, 40, 0.45); }
  .th-btn.th-live:hover:not(.on) { color: #ffb070; border-color: rgba(255, 140, 40, 0.8); }
  .th-btn.th-live.on { color: #1a0d02; background: #ff8c28; border-color: #ff8c28; }
  .th-btn.th-live.drop { background: rgba(255, 140, 40, 0.3); border-color: #ff8c28; }
  .th-btn.th-return { color: #ff8c28; border-color: rgba(255, 140, 40, 0.6); }
  .th.live .th-main {
    background: color-mix(in srgb, #ff8c28 16%, transparent);
    box-shadow: inset 3px 0 0 #ff8c28;
  }
  .th.live .th-color { background: #ff8c28; }
  .th-live-badge {
    flex: 0 1 auto;
    min-width: 0;
    font-size: 9px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: #1a0d02;
    background: #ff8c28;
    border-radius: 3px;
    padding: 0 4px;
    line-height: 14px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .th.returning .th-live-badge { animation: th-live-blink 0.6s ease-in-out infinite alternate; }
  @keyframes th-live-blink { from { opacity: 1; } to { opacity: 0.45; } }
  .th-gap { font-size: 9px; color: var(--ga-ink-2, #7a7a86); white-space: nowrap; margin-left: 2px; }
  .th-lane {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px 0 26px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.05));
    background: rgba(255, 255, 255, 0.015);
  }
  .th-lane.inactive { opacity: 0.45; }
  .th-lane-name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #aaa);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .th-lane-btn {
    width: 18px;
    height: 18px;
    padding: 0;
    font: inherit;
    font-size: 11px;
    color: var(--ga-ink-2, #888);
    background: none;
    border: 1px solid transparent;
    border-radius: 3px;
    cursor: pointer;
  }
  .th-lane-btn:first-of-type { color: var(--ga-coral, #ff6f5e); }
  .th-lane-btn:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .th-lane-btn:disabled { opacity: 0.3; cursor: default; }
  .th-picker {
    position: fixed;
    z-index: 10000;
    min-width: 190px;
    max-height: 320px;
    overflow-y: auto;
    padding: 4px;
    transform: translateY(-100%);
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
  }
  .th-picker-head, .th-picker-group {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    padding: 6px 8px 2px;
  }
  .th-picker-head { color: var(--ga-coral, #ff6f5e); }
  .th-picker-empty { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); padding: 4px 8px; }
  .th-picker-item {
    display: block;
    width: 100%;
    text-align: left;
    background: none;
    border: 0;
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    padding: 4px 8px;
    border-radius: 3px;
    cursor: pointer;
  }
  .th-picker-item:hover { background: var(--ga-selection-bg, #1f3170); color: var(--ga-selection-ink, #e0e8ff); }
</style>
