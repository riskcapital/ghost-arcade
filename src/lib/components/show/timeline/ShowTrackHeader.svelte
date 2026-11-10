<script lang="ts">
  /**
   * A layer track's header in the show's label column: colour, fold, name
   * (with an "off stage" badge when the current preset has no such layer
   * and the track injects its own copy), Mute / Solo / Lock and the "◆+"
   * picker that folds a keyframe lane open under the track. Lane headers
   * follow underneath when the track is unfolded.
   */
  import { get } from 'svelte/store';
  import type { Layer, ShowLayerTrack } from '../../../types';
  import { showTimeline } from '../../../stores/showTimeline';
  import { evaluateTrack } from '../../../keyframes/easing';
  import { LANE_ROW_HEIGHT, TRACK_ROW_HEIGHT, laneKeySelection, portal } from './trackLayout';
  import { trackLaneParams } from './trackParams';

  interface Props {
    track: ShowLayerTrack;
    onStage: boolean;
    soloed: boolean;
    otherSoloed: boolean;
    selected: boolean;
    live: Layer | null;
    inactiveLanes: ReadonlySet<string>;
  }

  let { track, onStage, soloed, otherSoloed, selected, live, inactiveLanes }: Props = $props();

  const color = $derived(track.color || '#8b7cff');

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

<div class="th" class:selected style:--track-color={color} data-track-header={track.id}>
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="th-main" style:height="{TRACK_ROW_HEIGHT}px" onclick={selectTrack}>
    <span class="th-color" aria-hidden="true"></span>
    <div class="th-col">
      <div class="th-line">
        <button
          class="th-fold"
          class:open={!track.collapsed}
          disabled={!track.lanes.length}
          onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { collapsed: !track.collapsed }); }}
          title={track.collapsed ? 'Show keyframe lanes' : 'Hide keyframe lanes'}
          aria-label={track.collapsed ? 'Show keyframe lanes' : 'Hide keyframe lanes'}
        >▸</button>
        <span class="th-name layer-name" title={track.layerName}>{track.layerName}</span>
        {#if !onStage}
          <span class="th-badge" title="The current preset has no such layer: the track plays its own copy of it above the stage.">off stage</span>
        {/if}
      </div>
      <div class="th-line th-buttons">
        <button
          class="th-btn"
          class:on={track.muted}
          onclick={(e) => { e.stopPropagation(); showTimeline.updateLayerTrack(track.id, { muted: !track.muted }); }}
          title="Mute: hide this layer for the whole show"
          aria-pressed={track.muted}
        >M</button>
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
        <button class="th-btn lanes" onmousedown={(e) => e.stopPropagation()} onclick={openPicker} title="Add a keyframe lane under this track" data-lane-picker>◆+</button>
        {#if track.gap === 'hide'}
          <span class="th-gap" title="Between clips the layer is hidden">gaps hidden</span>
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

{#if picker}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="th-picker" use:portal style:left="{picker.x}px" style:top="{picker.y}px" onmousedown={(e) => e.stopPropagation()} data-lane-picker-menu>
    <div class="th-picker-head">Keyframe lane</div>
    {#if groups.length === 0}
      <div class="th-picker-empty">Every parameter already has a lane.</div>
    {/if}
    {#each groups as [group, list]}
      <div class="th-picker-group">{group}</div>
      {#each list as p}
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
  .th-color { flex: 0 0 4px; background: var(--track-color); }
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
