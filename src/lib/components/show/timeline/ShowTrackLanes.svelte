<script lang="ts">
  /**
   * The show's rows in the grid (one per mapping layer, and the layers the
   * show adds on a piece), between the Looks lane and the audio lanes.
   *
   * Owns every pointer edit on tracks: moving clips (also onto other
   * tracks; Alt-drag drops copies), trimming, fades, crossfades, marquee
   * selection, the clip menu, keys on the lanes, and drops of media-tray
   * cards and files. All edits go through the show store; this component
   * keeps only the drag in flight.
   *
   * Reads the store with $derived values that keep their identity while
   * only the playhead moves, so a playing show re-renders none of this.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { layers as liveLayersStore } from '../../../stores/layers';
  import { showDropEffect } from '../../../show/showDrop';
  import { placeOnTrack } from '../../../show/tracks/showTrackEdit';
  import { clipEnd } from '../../../show/tracks/showTrackEval';
  import { findJunctionPredecessor } from '../../../show/showJunctions';
  import type { KeyframeEasing, ShowLayerClip, ShowLayerTrack } from '../../../types';
  import ShowLayerTrackLane from './ShowLayerTrackLane.svelte';
  import ShowClipContextMenu from './ShowClipContextMenu.svelte';
  import { clipThumbnails } from './clipMedia';
  import { carriesTrackMedia, dropTrackMedia, mayCarryTrackMedia } from './trackDrops';
  import {
    ADD_TRACK_ROW_HEIGHT,
    TRACK_ROW_HEIGHT,
    addsToSelection,
    dragRowOffset,
    movesFreely,
    focusedTrackId,
    laneKeySelection,
    showSnapGuide,
    snapGuideAt,
    trackIndexAt,
    trackTops,
    type ClipPart,
    type TrackLaneController,
  } from './trackLayout';
  import { trackLaneInfo } from './trackParams';
  import { showSlice } from './timelineSlices';
  import { dragSnapper, snapMovingClip } from './dragSnap';
  import { followPointer } from './dragSession';
  import { liveTakeover } from '../../../show/takeover/liveTakeover';
  import ShowTakeoverHatch from './ShowTakeoverHatch.svelte';
  import { editBlock } from '../../../show/tracks/showBlockEdit';

  interface Props {
    zoom: number;
    viewStart: number;
    viewEnd: number;
    width: number;
  }

  let { zoom, viewStart, viewEnd, width }: Props = $props();

  // Slices, not $showTimeline: the store publishes every playhead frame.
  const layerTracksStore = showSlice('layerTracks');
  const selectedClipIdsStore = showSlice('selectedClipIds');
  const currentTimeStore = showSlice('currentTime');
  const tracks = $derived($layerTracksStore);
  const selectedArr = $derived($selectedClipIdsStore);
  const selectedIds = $derived(new Set(selectedArr));
  const keySel = $derived($laneKeySelection);
  const thumbs = $derived($clipThumbnails);
  const liveLayers = $derived($liveLayersStore);

  const laneInfo = $derived.by(() => {
    const byId = new Map(liveLayers.map((l) => [l.id, l]));
    const out: Record<string, ReturnType<typeof trackLaneInfo>> = {};
    for (const t of tracks) out[t.id] = trackLaneInfo(t, byId.get(t.layerId));
    return out;
  });

  let stackEl: HTMLDivElement | undefined = $state();
  let drop: { trackId: string; time: number } | null = $state(null);
  let marquee: { x: number; y: number; w: number; h: number } | null = $state(null);
  /** Alt-drag: where the copies would land. */
  let ghosts: { left: number; top: number; width: number }[] = $state([]);
  let menu: { x: number; y: number; trackId: string; clipId: string; ids: string[] } | null = $state(null);
  const menuTrack = $derived(menu ? tracks.find((t) => t.id === menu!.trackId) ?? null : null);
  const menuClip = $derived(menu && menuTrack ? menuTrack.clips.find((c) => c.id === menu!.clipId) ?? null : null);

  /**
   * Where the stack sits on screen during a drag: measured once when the
   * drag starts and moved by the grid's scroll since, so a pointer move does
   * not force a layout right after the last move's DOM writes. Null outside
   * a drag (and after a window resize), when it is measured live.
   */
  let dragOrigin: { left: number; top: number; scrollLeft: number; scrollTop: number; scroller: HTMLElement | null } | null = null;
  function stackOrigin(): { left: number; top: number } {
    if (!stackEl) return { left: 0, top: 0 };
    if (dragOrigin) {
      const sc = dragOrigin.scroller;
      return sc
        ? { left: dragOrigin.left - (dragScroll.left - dragOrigin.scrollLeft), top: dragOrigin.top - (dragScroll.top - dragOrigin.scrollTop) }
        : dragOrigin;
    }
    const r = stackEl.getBoundingClientRect();
    return { left: r.left, top: r.top };
  }
  /** The grid's scroll position, kept from its scroll events during a drag. */
  const dragScroll = { left: 0, top: 0 };
  function beginDragGeometry(): () => void {
    if (!stackEl) return () => {};
    const scroller = stackEl.closest<HTMLElement>('.show-grid');
    const r = stackEl.getBoundingClientRect();
    dragScroll.left = scroller?.scrollLeft ?? 0;
    dragScroll.top = scroller?.scrollTop ?? 0;
    dragOrigin = { left: r.left, top: r.top, scrollLeft: dragScroll.left, scrollTop: dragScroll.top, scroller };
    const onScroll = () => {
      dragScroll.left = scroller!.scrollLeft;
      dragScroll.top = scroller!.scrollTop;
    };
    const onResize = () => { dragOrigin = null; };
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      dragOrigin = null;
      scroller?.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }

  function timeAt(clientX: number): number {
    if (!stackEl) return 0;
    return Math.max(0, (clientX - stackOrigin().left) / zoom);
  }
  function yInStack(clientY: number): number {
    if (!stackEl) return 0;
    return clientY - stackOrigin().top;
  }
  function currentTracks(): ShowLayerTrack[] {
    return get(showTimeline).layerTracks;
  }
  function trackIndexOf(trackId: string): number {
    return currentTracks().findIndex((t) => t.id === trackId);
  }

  /** The grid seeks on click; a drag that ends here is not a click. */
  function swallowClick() {
    const stop = (ev: Event) => { ev.stopPropagation(); };
    window.addEventListener('click', stop, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 0);
  }

  function track(id: string): ShowLayerTrack | undefined {
    return currentTracks().find((t) => t.id === id);
  }
  function liveClip(id: string): ShowLayerClip | undefined {
    return showTimeline.findLayerClip(id)?.clip;
  }

  /** The show as it was when a drag started, put back if it is cancelled. */
  function showRestorer(): () => void {
    const before = showTimeline.exportArrangement();
    return () => showTimeline.restoreArrangement(before);
  }

  /**
   * Follow the pointer until release. Esc or the window losing focus
   * cancels: `onCancel` (by default, the show as it was at the press) is put
   * back, and only if the drag had moved.
   */
  function follow(
    e: MouseEvent,
    onMove: (ev: MouseEvent) => void,
    onUp: (moved: boolean, ev: MouseEvent) => void,
    threshold = 3,
    onCancel: (() => void) | null = showRestorer(),
  ) {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const endGeometry = beginDragGeometry();
    const finish = () => {
      endGeometry();
      showSnapGuide.set(null);
    };
    followPointer({
      move: (ev) => {
        if (!moved && Math.abs(ev.clientX - sx) < threshold && Math.abs(ev.clientY - sy) < threshold) return;
        moved = true;
        onMove(ev);
      },
      end: (ev) => {
        finish();
        if (moved) swallowClick();
        onUp(moved, ev);
      },
      cancel: () => {
        finish();
        if (moved) onCancel?.();
      },
    });
  }

  // ── Clips ────────────────────────────────────────────────────────────

  function pressClip(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip, part: ClipPart) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusedTrackId.set(tr.id);
    laneKeySelection.set(null);
    // Shift adds a clip; on a clip already selected it takes it out again,
    // but only on release, so Shift-dragging a selection still moves it.
    // Cmd/Ctrl is only "move without snapping": a Cmd-drag of a clip that is
    // not selected moves that clip alone.
    const additive = addsToSelection(e);
    const before = get(showTimeline).selectedClipIds;
    const wasSelected = before.includes(clip.id);
    if (additive && part === 'body') {
      if (!wasSelected) showTimeline.selectLayerClips([...before, clip.id]);
    } else if (!wasSelected) {
      showTimeline.selectLayerClips([clip.id]);
    }
    // A block is edited in the normal panels: its piece is selected and
    // they show the block's own values.
    if (!additive) editBlock(tr, clip);
    if (tr.locked) {
      if (additive && wasSelected) showTimeline.selectLayerClips(before.filter((id) => id !== clip.id));
      return;
    }
    if (part === 'body' && e.altKey) dragCopies(e, tr, clip);
    else if (part === 'body') dragClips(e, tr, clip, wasSelected ? (additive ? 'remove' : 'only') : null);
    else if (part === 'start' || part === 'end') dragTrim(e, clip, part);
    else dragFade(e, clip, part);
  }

  function dragClips(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip, onClick: 'only' | 'remove' | null) {
    const ids = [...get(showTimeline).selectedClipIds];
    const idSet = new Set(ids);
    const startIndex = trackIndexOf(tr.id);
    const origStart = clip.startTime;
    const duration = clip.duration;
    const grab = timeAt(e.clientX) - origStart;
    const rows: number[] = [];
    const selectedClips = currentTracks().flatMap((t, i) => {
      const own = t.clips.filter((c) => idSet.has(c.id));
      if (own.length) rows.push(i);
      return own;
    });
    const minIndex = rows.length ? Math.min(...rows) : startIndex;
    const maxIndex = rows.length ? Math.max(...rows) : startIndex;
    // The edges a moving selection snaps to do not move with it.
    const snapper = dragSnapper(ids);
    const minStart = Math.min(...selectedClips.map((c) => c.startTime));
    let applied = { delta: 0, offset: 0 };
    follow(e, (ev) => {
      const list = currentTracks();
      const row = trackIndexAt(list, yInStack(ev.clientY));
      const offset = dragRowOffset(row, startIndex, minIndex, maxIndex, list.length);
      const raw = Math.max(0, timeAt(ev.clientX) - grab);
      const start = movesFreely(ev) ? raw : snapMovingClip(snapper, raw, duration);
      let delta = Math.max(start - origStart, -minStart);
      if (ids.length === 1 && offset === 0) {
        // One clip on its own track slides into the free space it is
        // pushed against rather than refusing.
        const own = list[startIndex];
        const placed = own ? placeOnTrack(own.clips, origStart + delta, duration, idSet) : null;
        if (placed === null) return;
        delta = placed - origStart;
      }
      if (Math.abs(delta - applied.delta) > 1e-9 || offset !== applied.offset) {
        if (showTimeline.moveLayerClipsAcross(ids, delta - applied.delta, offset - applied.offset)) {
          applied = { delta, offset };
          focusedTrackId.set(list[startIndex + offset]?.id ?? tr.id);
        }
      }
      const s = origStart + applied.delta;
      showSnapGuide.set(movesFreely(ev) ? null : snapGuideAt({ start: s, end: s + duration }, snapper.edges(), raw, s));
    }, (moved) => {
      if (moved) return;
      if (onClick === 'only' && ids.length > 1) showTimeline.selectLayerClips([clip.id]);
      else if (onClick === 'remove') showTimeline.selectLayerClips(get(showTimeline).selectedClipIds.filter((id) => id !== clip.id));
    });
  }

  /**
   * Alt-drag: the selection stays where it is and copies land where it is
   * dropped (on other tracks too), as one undo step. A drop where the copies
   * would overlap a clip is refused.
   */
  function dragCopies(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip) {
    const ids = [...get(showTimeline).selectedClipIds];
    const list0 = currentTracks();
    const startIndex = trackIndexOf(tr.id);
    const origStart = clip.startTime;
    const duration = clip.duration;
    const grab = timeAt(e.clientX) - origStart;
    const idSet = new Set(ids);
    const picked = list0.flatMap((t, i) => t.clips.filter((c) => idSet.has(c.id)).map((c) => ({ c, i, trackId: t.id })));
    if (!picked.length) return;
    const minStart = Math.min(...picked.map((p) => p.c.startTime));
    const minIndex = Math.min(...picked.map((p) => p.i));
    const maxIndex = Math.max(...picked.map((p) => p.i));
    let drop = { delta: 0, offset: 0 };
    // The originals stay put until the drop, so their edges hold still.
    const snapper = dragSnapper();
    const place = () => {
      const tops = trackTops(currentTracks());
      ghosts = picked.map((p) => ({
        left: (p.c.startTime + drop.delta) * zoom,
        top: (tops[p.i + drop.offset] ?? 0) + 4,
        width: Math.max(4, p.c.duration * zoom),
      }));
    };
    follow(e, (ev) => {
      const list = currentTracks();
      const row = trackIndexAt(list, yInStack(ev.clientY));
      const offset = dragRowOffset(row, startIndex, minIndex, maxIndex, list.length);
      const raw = Math.max(0, timeAt(ev.clientX) - grab);
      const start = movesFreely(ev) ? raw : snapMovingClip(snapper, raw, duration);
      drop = { delta: Math.max(start - origStart, -minStart), offset };
      place();
      const s0 = origStart + drop.delta;
      showSnapGuide.set(movesFreely(ev) ? null : snapGuideAt({ start: s0, end: s0 + duration }, snapper.edges(), raw, s0));
    }, (moved) => {
      ghosts = [];
      if (!moved) return;
      const list = currentTracks();
      const byTrack = new Map<string, string[]>();
      for (const p of picked) {
        const target = list[p.i + drop.offset];
        if (!target) return;
        byTrack.set(target.id, [...(byTrack.get(target.id) ?? []), p.c.id]);
      }
      const groups = [...byTrack.entries()].map(([trackId, clipIds]) => ({ trackId, clips: showTimeline.copyLayerClips(clipIds) }));
      const created = showTimeline.pasteLayerClipGroups(groups, minStart + drop.delta);
      if (created.length) focusedTrackId.set(list[startIndex + drop.offset]?.id ?? tr.id);
    }, 3, () => {
      // Nothing is pasted until the drop: cancelling only clears the ghosts.
      ghosts = [];
    });
  }

  // ── Clip menu ────────────────────────────────────────────────────────

  function contextClip(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip) {
    focusedTrackId.set(tr.id);
    laneKeySelection.set(null);
    const selected = get(showTimeline).selectedClipIds;
    const ids = selected.includes(clip.id) ? [...selected] : [clip.id];
    if (!selected.includes(clip.id)) showTimeline.selectLayerClips([clip.id]);
    menu = { x: e.clientX, y: e.clientY, trackId: tr.id, clipId: clip.id, ids };
  }

  function dragTrim(e: MouseEvent, clip: ShowLayerClip, edge: 'start' | 'end') {
    // Trimming one clip moves only its own edge, which is left out.
    const snapper = dragSnapper([clip.id]);
    follow(e, (ev) => {
      const raw = timeAt(ev.clientX);
      const free = movesFreely(ev);
      // Snapped here against the edges held for the drag: the same answer
      // the store's own snap gives, without rebuilding them per move.
      showTimeline.trimLayerClip(clip.id, edge, free ? raw : snapper.snap(raw), { snap: false });
      const now = liveClip(clip.id);
      if (!now || free) return showSnapGuide.set(null);
      const at = edge === 'start' ? now.startTime : clipEnd(now);
      showSnapGuide.set(snapGuideAt({ start: at }, snapper.edges(), raw, at));
    }, () => {}, 1);
  }

  function dragFade(e: MouseEvent, clip: ShowLayerClip, which: 'fadeIn' | 'fadeOut') {
    const snapper = dragSnapper([clip.id]);
    follow(e, (ev) => {
      const now = liveClip(clip.id);
      if (!now) return;
      let t = timeAt(ev.clientX);
      if (!movesFreely(ev)) t = snapper.snap(t);
      const value = which === 'fadeIn' ? t - now.startTime : clipEnd(now) - t;
      const clamped = Math.max(0, Math.min(now.duration, Math.round(value * 1000) / 1000));
      showTimeline.updateLayerClip(clip.id, { [which]: clamped });
    }, () => {}, 1);
  }

  // ── Crossfades ───────────────────────────────────────────────────────

  function maxXfade(clips: readonly ShowLayerClip[], clip: ShowLayerClip): number {
    const prev = findJunctionPredecessor(clips, clip);
    return prev ? Math.min(prev.duration, clip.duration) : 0;
  }

  function pressXfade(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip, part: 'body' | 'edge') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusedTrackId.set(tr.id);
    showTimeline.selectLayerClips([clip.id]);
    if (part !== 'edge' || tr.locked) return;
    follow(e, (ev) => {
      const t = track(tr.id);
      const c = liveClip(clip.id);
      if (!t || !c) return;
      const want = Math.abs(timeAt(ev.clientX) - c.startTime) * 2;
      const d = Math.max(0.1, Math.min(maxXfade(t.clips, c), Math.round(want * 100) / 100));
      showTimeline.updateLayerClip(clip.id, { transitionIn: 'dissolve', transitionDuration: d });
    }, () => {}, 1);
  }

  function addXfade(tr: ShowLayerTrack, clip: ShowLayerClip) {
    const max = maxXfade(tr.clips, clip);
    if (max <= 0) return;
    showTimeline.updateLayerClip(clip.id, { transitionIn: 'dissolve', transitionDuration: Math.min(1, max) }, { discrete: true });
    showTimeline.selectLayerClips([clip.id]);
  }

  function removeXfade(_tr: ShowLayerTrack, clip: ShowLayerClip) {
    showTimeline.updateLayerClip(clip.id, { transitionIn: 'cut', transitionDuration: undefined }, { discrete: true });
  }

  // ── Marquee ──────────────────────────────────────────────────────────

  function pressEmpty(e: MouseEvent, tr: ShowLayerTrack | null) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (tr) focusedTrackId.set(tr.id);
    const additive = addsToSelection(e);
    const before = [...get(showTimeline).selectedClipIds];
    const base = additive ? before : [];
    const x0 = timeAt(e.clientX) * zoom;
    const y0 = yInStack(e.clientY);
    follow(e, (ev) => {
      const x1 = timeAt(ev.clientX) * zoom;
      const y1 = yInStack(ev.clientY);
      const box = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) };
      marquee = box;
      const list = currentTracks();
      const tops = trackTops(list);
      const t0 = box.x / zoom;
      const t1 = (box.x + box.w) / zoom;
      const hits: string[] = [];
      list.forEach((t, i) => {
        const top = tops[i] + 4;
        const bottom = tops[i] + TRACK_ROW_HEIGHT - 4;
        if (box.y > bottom || box.y + box.h < top) return;
        for (const c of t.clips) if (c.startTime < t1 && clipEnd(c) > t0) hits.push(c.id);
      });
      showTimeline.selectLayerClips([...new Set([...base, ...hits])]);
    }, (moved) => {
      marquee = null;
      if (!moved && !additive) {
        showTimeline.selectLayerClips([]);
        laneKeySelection.set(null);
      }
    }, 3, () => {
      // Cancelled: the selection from before the marquee.
      marquee = null;
      showTimeline.selectLayerClips(before);
    });
  }

  // ── Drops ────────────────────────────────────────────────────────────

  function dragOver(e: DragEvent, tr: ShowLayerTrack | null) {
    const dt = e.dataTransfer;
    if (!dt || !mayCarryTrackMedia(dt)) return;
    e.preventDefault();
    e.stopPropagation();
    if (tr?.locked) {
      dt.dropEffect = 'none';
      drop = null;
      return;
    }
    if (!tr) {
      // Off the rows: nothing lands here (a drop says where to put it).
      dt.dropEffect = 'none';
      drop = null;
      return;
    }
    dt.dropEffect = showDropEffect(dt.effectAllowed);
    drop = { trackId: tr.id, time: showTimeline.snapTime(timeAt(e.clientX)) };
  }

  function dragLeave(e: DragEvent) {
    const next = e.relatedTarget as Node | null;
    if (next && stackEl?.contains(next)) return;
    drop = null;
  }

  function dropOn(e: DragEvent, tr: ShowLayerTrack | null) {
    const dt = e.dataTransfer;
    const at = drop?.time ?? showTimeline.snapTime(timeAt(e.clientX));
    drop = null;
    // Audio files and preset cards: the grid handles those.
    if (!dt || !carriesTrackMedia(dt)) return;
    e.preventDefault();
    e.stopPropagation();
    if (tr?.locked) return;
    void dropTrackMedia(dt, tr?.id ?? null, at);
  }

  // ── Keys on lanes ────────────────────────────────────────────────────

  function selectKeys(tr: ShowLayerTrack, key: string, times: number[]) {
    laneKeySelection.set(times.length ? { trackId: tr.id, key, times } : null);
    if (times.length) {
      showTimeline.selectLayerClips([]);
      // The keys are now what Delete and the arrows act on: let go of a
      // preset clip, audio track, transition or tempo picked before. The
      // track's own selection (its inspector) stays.
      const sel = get(showTimeline).selection;
      if (sel && sel.kind !== 'track') showTimeline.select(null);
    }
    focusedTrackId.set(tr.id);
  }

  const ctl: TrackLaneController = {
    pressClip,
    pressEmpty: (e, tr) => pressEmpty(e, tr),
    contextClip,
    pressXfade,
    addXfade,
    removeXfade,
    dragOver,
    dragLeave,
    drop: (e, tr) => dropOn(e, tr),
    snap: (t) => showTimeline.snapTime(t),
    laneAddKey: (tr, key, time, value) => {
      showTimeline.setLaneKey(tr.id, key, time, value);
      selectKeys(tr, key, [time]);
    },
    laneMoveKey: (tr, key, from, to, value, dragId) => {
      showTimeline.moveLaneKey(tr.id, key, from, to, value, dragId);
      const sel = get(laneKeySelection);
      if (sel && sel.trackId === tr.id && sel.key === key) laneKeySelection.set({ ...sel, times: [to] });
    },
    laneShiftKeys: (tr, key, times, delta, dragId) => {
      showTimeline.shiftLaneKeys(tr.id, key, times, delta, dragId);
      laneKeySelection.set({ trackId: tr.id, key, times: times.map((t) => Math.max(0, t + delta)) });
    },
    laneSelectKeys: (tr, key, times) => selectKeys(tr, key, times),
    laneDeleteKeys: (tr, key, times) => {
      showTimeline.removeLaneKeys(tr.id, key, times);
      laneKeySelection.set(null);
    },
    laneEasing: (tr, key, times, easing: KeyframeEasing) => {
      showTimeline.setLaneKeyEasing(tr.id, key, times, easing);
    },
    snapshot: showRestorer,
  };

  const EMPTY_SET: ReadonlySet<string> = new Set();
  const EMPTY_RANGES: Record<string, { min: number; max: number }> = {};
</script>

<!-- data-help-disabled: the app's hover-help card would sit over the clip
     handles; the blocks keep their plain tooltips. -->
<div class="tl-stack" bind:this={stackEl} style:width="{width}px" data-show-tracks data-help-disabled>
  {#each tracks as tr, index (tr.id)}
    {#if !tr.row?.hidden}
    <ShowLayerTrackLane
      track={tr}
      {index}
      {zoom}
      {viewStart}
      {viewEnd}
      {selectedIds}
      keySelection={keySel}
      {thumbs}
      dropTime={drop && drop.trackId === tr.id ? drop.time : null}
      inactiveLanes={laneInfo[tr.id]?.inactive ?? EMPTY_SET}
      laneRanges={laneInfo[tr.id]?.ranges ?? EMPTY_RANGES}
      {ctl}
      live={!!$liveTakeover.surfaces[tr.layerId]}
    />
    {/if}
  {/each}
  <ShowTakeoverHatch {tracks} {zoom} />
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tl-new"
    style:height="{ADD_TRACK_ROW_HEIGHT}px"
    ondragover={(e) => dragOver(e, null)}
    ondragleave={dragLeave}
    ondrop={(e) => dropOn(e, null)}
    data-show-rows-foot
  >
    <span class="tl-new-hint">
      {tracks.length ? 'Drop video, images, shaders or sketches on a piece\'s row' : 'Add layers in Mapping: each one gets a row here'}
    </span>
  </div>
  {#each ghosts as g, i (i)}
    <div class="tl-ghost" style:left="{g.left}px" style:top="{g.top}px" style:width="{g.width}px" style:height="{TRACK_ROW_HEIGHT - 8}px" data-show-copy-ghost></div>
  {/each}
  {#if marquee}
    <div class="tl-marquee" style:left="{marquee.x}px" style:top="{marquee.y}px" style:width="{marquee.w}px" style:height="{marquee.h}px"></div>
  {/if}
</div>

{#if menu && menuTrack && menuClip}
  <ShowClipContextMenu
    x={menu.x}
    y={menu.y}
    track={menuTrack}
    clip={menuClip}
    ids={menu.ids}
    playhead={$currentTimeStore}
    onclose={() => (menu = null)}
  />
{/if}

<style>
  .tl-stack { position: relative; }
  .tl-new {
    position: relative;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.015) 0 1px, transparent 1px 24px);
  }
  .tl-new.drop {
    background: rgba(139, 124, 255, 0.12);
    box-shadow: inset 0 0 0 1px rgba(139, 124, 255, 0.6);
  }
  .tl-new-hint {
    position: sticky;
    left: 12px;
    display: inline-block;
    line-height: 27px;
    padding-left: 12px;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #55555f);
    pointer-events: none;
    white-space: nowrap;
  }
  .tl-ghost {
    position: absolute;
    z-index: 7;
    box-sizing: border-box;
    border: 1px dashed rgba(255, 217, 107, 0.9);
    border-radius: 4px;
    background: rgba(255, 217, 107, 0.12);
    pointer-events: none;
  }
  .tl-marquee {
    position: absolute;
    z-index: 8;
    border: 1px solid rgba(255, 217, 107, 0.85);
    background: rgba(255, 217, 107, 0.08);
    pointer-events: none;
  }
</style>
