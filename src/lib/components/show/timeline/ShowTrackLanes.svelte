<script lang="ts">
  /**
   * The show's layer tracks in the grid, between the preset lane and the
   * audio lanes.
   *
   * Owns every pointer edit on tracks: moving clips (also onto other
   * tracks), trimming, fades, crossfades, marquee selection, keys on the
   * lanes, and drops of media-tray cards and files. All edits go through
   * the show store; this component keeps only the drag in flight.
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
  import { clipThumbnails } from './clipMedia';
  import { carriesTrackMedia, dropTrackMedia, mayCarryTrackMedia } from './trackDrops';
  import {
    ADD_TRACK_ROW_HEIGHT,
    TRACK_ROW_HEIGHT,
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

  interface Props {
    zoom: number;
    viewStart: number;
    viewEnd: number;
    width: number;
  }

  let { zoom, viewStart, viewEnd, width }: Props = $props();

  const tracks = $derived($showTimeline.layerTracks);
  const selectedArr = $derived($showTimeline.selectedClipIds);
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

  function timeAt(clientX: number): number {
    if (!stackEl) return 0;
    return Math.max(0, (clientX - stackEl.getBoundingClientRect().left) / zoom);
  }
  function yInStack(clientY: number): number {
    if (!stackEl) return 0;
    return clientY - stackEl.getBoundingClientRect().top;
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

  /** Follow the pointer until release. */
  function follow(e: MouseEvent, onMove: (ev: MouseEvent) => void, onUp: (moved: boolean, ev: MouseEvent) => void, threshold = 3) {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.abs(ev.clientX - sx) < threshold && Math.abs(ev.clientY - sy) < threshold) return;
      moved = true;
      onMove(ev);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      showSnapGuide.set(null);
      if (moved) swallowClick();
      onUp(moved, ev);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // ── Clips ────────────────────────────────────────────────────────────

  function pressClip(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip, part: ClipPart) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    focusedTrackId.set(tr.id);
    laneKeySelection.set(null);
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const before = get(showTimeline).selectedClipIds;
    const wasSelected = before.includes(clip.id);
    // Shift / Cmd-click adds a clip; on a clip already selected it takes it
    // out again, but only on release, so Cmd-dragging a selection (Cmd is
    // also "move without snapping") still moves it.
    if (additive && part === 'body') {
      if (!wasSelected) showTimeline.selectLayerClips([...before, clip.id]);
    } else if (!wasSelected) {
      showTimeline.selectLayerClips([clip.id]);
    }
    if (tr.locked) {
      if (additive && wasSelected) showTimeline.selectLayerClips(before.filter((id) => id !== clip.id));
      return;
    }
    if (part === 'body') dragClips(e, tr, clip, wasSelected ? (additive ? 'remove' : 'only') : null);
    else if (part === 'start' || part === 'end') dragTrim(e, clip, part);
    else dragFade(e, clip, part);
  }

  function dragClips(e: MouseEvent, tr: ShowLayerTrack, clip: ShowLayerClip, onClick: 'only' | 'remove' | null) {
    const ids = [...get(showTimeline).selectedClipIds];
    const startIndex = trackIndexOf(tr.id);
    const origStart = clip.startTime;
    const duration = clip.duration;
    const grab = timeAt(e.clientX) - origStart;
    const selectedClips = currentTracks().flatMap((t) => t.clips.filter((c) => ids.includes(c.id)));
    const minStart = Math.min(...selectedClips.map((c) => c.startTime));
    let applied = { delta: 0, offset: 0 };
    follow(e, (ev) => {
      const list = currentTracks();
      const row = trackIndexAt(list, yInStack(ev.clientY));
      const offset = Math.max(-startIndex, Math.min(list.length - 1 - startIndex, row - startIndex));
      const raw = Math.max(0, timeAt(ev.clientX) - grab);
      let start = raw;
      if (!(ev.metaKey || ev.ctrlKey)) {
        const a = showTimeline.snapTime(raw, ids);
        const b = showTimeline.snapTime(raw + duration, ids) - duration;
        const pull = (v: number) => (Math.abs(v - raw) < 1e-9 ? Number.POSITIVE_INFINITY : Math.abs(v - raw));
        start = pull(b) < pull(a) ? b : a;
      }
      let delta = Math.max(start - origStart, -minStart);
      if (ids.length === 1 && offset === 0) {
        // One clip on its own track slides into the free space it is
        // pushed against rather than refusing.
        const own = list[startIndex];
        const placed = own ? placeOnTrack(own.clips, origStart + delta, duration, new Set(ids)) : null;
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
      showSnapGuide.set(ev.metaKey || ev.ctrlKey ? null : snapGuideAt({ start: s, end: s + duration }, showTimeline.snapTargets(ids), raw, s));
    }, (moved) => {
      if (moved) return;
      if (onClick === 'only' && ids.length > 1) showTimeline.selectLayerClips([clip.id]);
      else if (onClick === 'remove') showTimeline.selectLayerClips(get(showTimeline).selectedClipIds.filter((id) => id !== clip.id));
    });
  }

  function dragTrim(e: MouseEvent, clip: ShowLayerClip, edge: 'start' | 'end') {
    follow(e, (ev) => {
      const raw = timeAt(ev.clientX);
      const free = ev.metaKey || ev.ctrlKey;
      showTimeline.trimLayerClip(clip.id, edge, raw, { snap: !free });
      const now = liveClip(clip.id);
      if (!now || free) return showSnapGuide.set(null);
      const at = edge === 'start' ? now.startTime : clipEnd(now);
      showSnapGuide.set(snapGuideAt({ start: at }, showTimeline.snapTargets([clip.id]), raw, at));
    }, () => {}, 1);
  }

  function dragFade(e: MouseEvent, clip: ShowLayerClip, which: 'fadeIn' | 'fadeOut') {
    follow(e, (ev) => {
      const now = liveClip(clip.id);
      if (!now) return;
      let t = timeAt(ev.clientX);
      if (!(ev.metaKey || ev.ctrlKey)) t = showTimeline.snapTime(t, [clip.id]);
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
    const additive = e.shiftKey || e.metaKey || e.ctrlKey;
    const base = additive ? [...get(showTimeline).selectedClipIds] : [];
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
    dt.dropEffect = showDropEffect(dt.effectAllowed);
    drop = { trackId: tr?.id ?? '', time: showTimeline.snapTime(timeAt(e.clientX)) };
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
    if (times.length) showTimeline.selectLayerClips([]);
    focusedTrackId.set(tr.id);
  }

  const ctl: TrackLaneController = {
    pressClip,
    pressEmpty: (e, tr) => pressEmpty(e, tr),
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
  };

  const EMPTY_SET: ReadonlySet<string> = new Set();
  const EMPTY_RANGES: Record<string, { min: number; max: number }> = {};
</script>

<div class="tl-stack" bind:this={stackEl} style:width="{width}px" data-show-tracks>
  {#each tracks as tr, index (tr.id)}
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
    />
  {/each}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="tl-new"
    class:drop={drop !== null && drop.trackId === ''}
    style:height="{ADD_TRACK_ROW_HEIGHT}px"
    ondragover={(e) => dragOver(e, null)}
    ondragleave={dragLeave}
    ondrop={(e) => dropOn(e, null)}
    data-show-new-track-drop
  >
    <span class="tl-new-hint">
      {tracks.length ? 'Drop media here for a new track' : 'Drop video, images or shaders here to make a layer track'}
    </span>
  </div>
  {#if marquee}
    <div class="tl-marquee" style:left="{marquee.x}px" style:top="{marquee.y}px" style:width="{marquee.w}px" style:height="{marquee.h}px"></div>
  {/if}
</div>

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
  .tl-marquee {
    position: absolute;
    z-index: 8;
    border: 1px solid rgba(255, 217, 107, 0.85);
    background: rgba(255, 217, 107, 0.08);
    pointer-events: none;
  }
</style>
