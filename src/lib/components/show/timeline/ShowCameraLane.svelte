<script lang="ts">
  /**
   * The Stage camera lane: Demo Reel shots laid out in show time. The Stage
   * Sim window moves its camera along them while the show plays (and the
   * rehearsal render films them). Double-click an empty stretch to add the
   * first shot there; drag a shot to move it, its edges to trim it; select
   * one to pick its shot or delete it (Delete).
   */
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { showSlice } from './timelineSlices';
  import { demoReel, DEMO_REEL_STORAGE_KEY, moveTemplate } from '../../../stage3d/demoReel';
  import {
    moveCameraClip,
    removeCameraClips,
    setCameraClipShot,
    trimCameraClip,
  } from '../../../show/rehearsal/cameraLaneEdit';
  import { CAMERA_LANE_HEIGHT, placeCameraShot, selectedCameraClipId } from './cameraLaneUi';
  import { portal } from './trackLayout';

  interface Props {
    zoom: number;
  }
  let { zoom }: Props = $props();


  // Slices, not $showTimeline: the store publishes every playhead frame.
  const cameraLaneStore = showSlice('cameraLane');
  const selectionStore = showSlice('selection');
  const selectedClipIdsStore = showSlice('selectedClipIds');
  const lane = $derived($cameraLaneStore);
  const shots = $derived($demoReel.shots);
  const shotById = $derived(new Map(shots.map((s) => [s.id, s])));
  const selected = $derived(lane.find((c) => c.id === $selectedCameraClipId) ?? null);

  let laneEl = $state<HTMLDivElement | undefined>();
  let popEl = $state<HTMLDivElement | undefined>();

  // Shots are saved in the Stage Sim window; pick them up here.
  onMount(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEMO_REEL_STORAGE_KEY) demoReel.syncFromStorage();
    };
    window.addEventListener('storage', onStorage);
    demoReel.syncFromStorage();
    return () => window.removeEventListener('storage', onStorage);
  });

  function timeAt(clientX: number): number {
    if (!laneEl) return 0;
    return Math.max(0, (clientX - laneEl.getBoundingClientRect().left) / zoom);
  }

  function select(id: string | null) {
    selectedCameraClipId.set(id);
    if (id) {
      // One selection in the tray at a time: keys act on the camera clip.
      showTimeline.select(null);
      showTimeline.selectLayerClips([]);
    }
  }

  // Selecting anything else in the show drops the camera clip selection.
  $effect(() => {
    if (($selectionStore || $selectedClipIdsStore.length > 0) && $selectedCameraClipId) selectedCameraClipId.set(null);
  });

  function onLaneDblClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.cam-block')) return;
    if (shots[0]) placeCameraShot(shots[0].id, timeAt(e.clientX));
  }

  function startDrag(e: PointerEvent, id: string, mode: 'move' | 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    select(id);
    const clip = lane.find((c) => c.id === id);
    if (!clip) return;
    const x0 = e.clientX;
    const origin = mode === 'move' ? clip.startTime : mode === 'start' ? clip.startTime : clip.startTime + clip.duration;
    const key = `${mode}:${id}`;
    let moved = false;
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 3) return;
      moved = true;
      const raw = origin + dx / zoom;
      const t = ev.metaKey || ev.ctrlKey ? raw : showTimeline.snapTime(raw);
      const current = get(showTimeline).cameraLane;
      const next = mode === 'move' ? moveCameraClip(current, id, t) : trimCameraClip(current, id, mode, t);
      if (next !== current) showTimeline.setCameraLane(next, key);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  function removeSelected() {
    if (!selected) return;
    showTimeline.setCameraLane(removeCameraClips(lane, [selected.id]));
    select(null);
  }

  /** The show tray is where the user works: the pointer is over it, or the
   *  keyboard is in it or in this clip's inspector. Like the tray's own keys,
   *  Delete elsewhere (a layer, a mapping point) is not the camera clip's. */
  function trayEngaged(): boolean {
    const tray = laneEl?.closest('.show-tray');
    const active = document.activeElement;
    if (tray?.matches(':hover')) return true;
    if (active && active !== document.body && (tray?.contains(active) || popEl?.contains(active))) return true;
    return !!popEl?.matches(':hover');
  }

  // Delete / Backspace / Escape on the selected camera clip. The tray's own
  // key handler has nothing selected then, so it leaves these keys alone.
  onMount(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!$selectedCameraClipId) return;
      if (!trayEngaged()) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        e.stopPropagation();
        removeSelected();
      } else if (e.key === 'Escape') {
        e.stopPropagation();
        select(null);
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  });

  // ── Inspector popover ─────────────────────────────────────────────────
  let popPos = $state<{ x: number; y: number } | null>(null);
  $effect(() => {
    void lane;
    void zoom;
    if (!selected || !laneEl) { popPos = null; return; }
    const r = laneEl.getBoundingClientRect();
    popPos = { x: Math.max(8, Math.min(window.innerWidth - 268, r.left + selected.startTime * zoom)), y: r.top - 6 };
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="lane cam-lane"
  style:height="{CAMERA_LANE_HEIGHT}px"
  bind:this={laneEl}
  ondblclick={onLaneDblClick}
  data-show-camera-lane
>
  {#if lane.length === 0}
    <span class="cam-empty">
      {#if shots.length === 0}
        Save shots in the Stage Sim's Demo reel, then double-click here to place them.
      {:else}
        Double-click to place a shot here.
      {/if}
    </span>
  {/if}
  {#each lane as clip (clip.id)}
    {@const shot = shotById.get(clip.shotId)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="show-block cam-block"
      class:selected={clip.id === $selectedCameraClipId}
      class:missing={!shot}
      style:left="{clip.startTime * zoom}px"
      style:width="{Math.max(6, clip.duration * zoom)}px"
      onpointerdown={(e) => startDrag(e, clip.id, 'move')}
      title={shot ? `${shot.name} · ${moveTemplate(shot.moveId).label}` : 'This shot is not in the Demo reel any more'}
      data-camera-clip={clip.id}
    >
      <div class="cam-edge left" onpointerdown={(e) => startDrag(e, clip.id, 'start')}></div>
      {#if shot?.thumbnail}<img class="cam-thumb" src={shot.thumbnail} alt="" draggable="false" />{/if}
      <span class="cam-label">{shot ? shot.name : 'Missing shot'}</span>
      <div class="cam-edge right" onpointerdown={(e) => startDrag(e, clip.id, 'end')}></div>
    </div>
  {/each}
</div>

{#if selected && popPos}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="cam-pop" bind:this={popEl} use:portal style:left="{popPos.x}px" style:top="{popPos.y}px" onpointerdown={(e) => e.stopPropagation()} data-camera-clip-inspector>
    <label class="cam-row">
      <span>Shot</span>
      <select
        value={selected.shotId}
        onchange={(e) => showTimeline.setCameraLane(setCameraClipShot(lane, selected.id, (e.currentTarget as HTMLSelectElement).value))}
        data-camera-clip-shot
      >
        {#if !shotById.has(selected.shotId)}<option value={selected.shotId}>Missing shot</option>{/if}
        {#each shots as shot (shot.id)}
          <option value={shot.id}>{shot.name}</option>
        {/each}
      </select>
    </label>
    <span class="cam-meta">{selected.startTime.toFixed(2)} s · {selected.duration.toFixed(2)} s</span>
    <button class="cam-del" onclick={removeSelected} title="Remove this shot from the lane (Delete)" data-camera-clip-delete>Remove</button>
    <button class="cam-close" onclick={() => select(null)} aria-label="Close shot inspector">×</button>
  </div>
{/if}

<style>
  .cam-lane {
    position: relative;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line-1, rgba(255, 255, 255, 0.06));
    background: rgba(92, 225, 230, 0.03);
  }
  .cam-empty {
    position: absolute;
    left: 10px;
    top: 50%;
    transform: translateY(-50%);
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #7a7a86);
    pointer-events: none;
    white-space: nowrap;
  }
  .cam-block {
    position: absolute;
    top: 4px;
    bottom: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    box-sizing: border-box;
    overflow: hidden;
    border-radius: 4px;
    background: linear-gradient(180deg, rgba(92, 225, 230, 0.22), rgba(92, 225, 230, 0.1));
    border: 1px solid rgba(92, 225, 230, 0.5);
    cursor: grab;
    user-select: none;
    touch-action: none;
  }
  .cam-block.selected { border-color: #fff; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.5); }
  .cam-block.missing { background: rgba(255, 71, 87, 0.12); border-color: rgba(255, 71, 87, 0.5); }
  .cam-thumb { height: 100%; aspect-ratio: 16 / 9; object-fit: cover; flex: none; pointer-events: none; }
  .cam-label {
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-0, #eee);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-right: 8px;
    pointer-events: none;
  }
  .cam-edge { position: absolute; top: 0; bottom: 0; width: 6px; cursor: ew-resize; z-index: 1; }
  .cam-edge.left { left: 0; }
  .cam-edge.right { right: 0; }
  .cam-pop {
    position: fixed;
    z-index: 10000;
    transform: translateY(-100%);
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 6px);
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.6);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #ddd);
  }
  .cam-row { display: flex; align-items: center; gap: 6px; }
  .cam-meta { color: var(--ga-ink-2, #888); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .cam-del, .cam-close {
    background: none;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
    color: var(--ga-ink-1, #ccc);
    font: inherit;
    padding: 2px 8px;
    cursor: pointer;
  }
  .cam-close { border: 0; padding: 0 4px; }
</style>
