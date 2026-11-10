<script lang="ts">
  /**
   * Label of the Stage camera lane: add a Demo Reel shot at the playhead,
   * or hide the lane while it is empty.
   */
  import { get } from 'svelte/store';
  import { showTimeline } from '../../../stores/showTimeline';
  import { showSlice } from './timelineSlices';
  import { demoReel } from '../../../stage3d/demoReel';
  import { CAMERA_LANE_HEIGHT, cameraLaneShown, placeCameraShot } from './cameraLaneUi';

  const shots = $derived($demoReel.shots);
  const cameraLaneStore = showSlice('cameraLane');
  const empty = $derived($cameraLaneStore.length === 0);

  function onPick(e: Event) {
    const el = e.currentTarget as HTMLSelectElement;
    const id = el.value;
    el.value = '';
    if (id) placeCameraShot(id, get(showTimeline).currentTime);
  }
</script>

<div class="cam-label-row" style:height="{CAMERA_LANE_HEIGHT}px" data-show-camera-label>
  <span class="cam-name" title="The Stage Sim's camera follows these shots while the show plays">Stage camera</span>
  <select class="cam-add" value="" onchange={onPick} disabled={shots.length === 0} title="Add a Demo reel shot at the playhead" aria-label="Add a shot at the playhead" data-show-camera-add>
    <option value="">+ Shot</option>
    {#each shots as shot (shot.id)}
      <option value={shot.id}>{shot.name}</option>
    {/each}
  </select>
  {#if empty}
    <button class="cam-hide" onclick={() => cameraLaneShown.set(false)} title="Hide the Stage camera lane" aria-label="Hide the Stage camera lane">×</button>
  {/if}
</div>

<style>
  .cam-label-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    box-sizing: border-box;
    border-bottom: 1px solid var(--ga-line-1, rgba(255, 255, 255, 0.06));
  }
  .cam-name {
    flex: 1;
    min-width: 0;
    font-size: var(--ga-text-meta, 11px);
    color: color-mix(in srgb, #5ce1e6 75%, #ffffff);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .cam-add {
    max-width: 76px;
    font-size: var(--ga-text-meta, 11px);
    background: transparent;
    color: var(--ga-ink-1, #ccc);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 4px;
  }
  .cam-hide {
    background: none;
    border: 0;
    color: var(--ga-ink-2, #888);
    cursor: pointer;
    font-size: 14px;
    padding: 0 2px;
  }
</style>
