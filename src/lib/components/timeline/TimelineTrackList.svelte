<script lang="ts">
  import { keyframeTimeline } from '../../stores/keyframeTimeline';
  import type { KeyframeableParam } from '../../keyframes/paramDiscovery';

  type FlatRow = { kind: 'group'; group: string; expanded: boolean } | { kind: 'param'; param: KeyframeableParam };

  export let flatRows: FlatRow[] = [];
  export let layerId: string | null = null;
  export let toggleGroup: (group: string) => void = () => {};
  export let addKeyframeForParam: (param: KeyframeableParam) => void = () => {};
  export let scrollEl: HTMLDivElement | undefined = undefined;

  $: currentTime = $keyframeTimeline.config.currentTime;
  $: timelines = $keyframeTimeline.timelines;
  $: timeline = layerId ? timelines[layerId] : null;
  $: armedTracks = $keyframeTimeline.armedTracks;

  // Reactive: keys that have any keyframes (for has-kf class) and at-current-time (for active diamond)
  $: trackKeysWithKfs = new Set(
    timeline ? timeline.tracks.filter(t => t.keyframes.length > 0 || t.boolKeyframes.length > 0).map(t => t.key) : []
  );
  $: trackKeysAtCurrentTime = new Set(
    timeline ? timeline.tracks.filter(t => {
      if (t.type === 'boolean') return t.boolKeyframes.some(k => Math.abs(k.time - currentTime) < 0.05);
      return t.keyframes.some(k => Math.abs(k.time - currentTime) < 0.05);
    }).map(t => t.key) : []
  );

  const ROW_HEIGHT = 22;
  const GROUP_HEIGHT = 22;

  function toggleArm(param: KeyframeableParam) {
    if (!layerId) return;
    const wasArmed = !!armedTracks[`${layerId}:${param.key}`];
    keyframeTimeline.toggleArmed(layerId, param.key);
    if (!wasArmed) {
      addKeyframeForParam(param);
    }
  }

  function isArmed(paramKey: string): boolean {
    if (!layerId) return false;
    return !!armedTracks[`${layerId}:${paramKey}`];
  }

  function hasKfAt(paramKey: string): boolean {
    return trackKeysAtCurrentTime.has(paramKey);
  }

  function trackHasKeyframes(paramKey: string): boolean {
    return trackKeysWithKfs.has(paramKey);
  }
</script>

<div data-help-page="show-timeline" class="track-list" bind:this={scrollEl}>
  <!-- Spacer to match the grid's ruler height -->
  <div class="ruler-spacer"></div>
  {#if !layerId}
    <div class="no-layer">Select a layer to keyframe its parameters</div>
  {:else if flatRows.length === 0}
    <div class="no-layer">No keyframeable parameters</div>
  {:else}
    {#each flatRows as row}
      {#if row.kind === 'group'}
        <button class="group-header" style="height: {GROUP_HEIGHT}px" onclick={() => toggleGroup(row.group)}>
          <span class="group-chevron">{row.expanded ? '▾' : '▸'}</span>
          <span class="group-name">{row.group}</span>
        </button>
      {:else}
        <div class="track-row" class:has-kf={trackHasKeyframes(row.param.key)}
          class:armed={isArmed(row.param.key)}
          style="height: {ROW_HEIGHT}px">
          <button class="kf-diamond" class:active={hasKfAt(row.param.key)} class:armed={isArmed(row.param.key)}
            onclick={() => toggleArm(row.param)}
            title="Click to arm auto-keyframe">
            ◆
          </button>
          <span class="track-label" title={row.param.key}>{row.param.label}</span>
        </div>
      {/if}
    {/each}
  {/if}
</div>


<style>
  .track-list {
    width: 200px;
    min-width: 200px;
    overflow-y: auto;
    overflow-x: hidden;
    border-right: 1px solid var(--ga-line, rgba(255,255,255,0.07));
    background: var(--ga-panel, #0a0a0e);
    font-size: var(--ga-text-meta, 11px);
  }
  .ruler-spacer {
    height: 20px;
    background: var(--ga-card, #0e0e12);
    border-bottom: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    position: sticky;
    top: 0;
    z-index: 2;
  }
  .no-layer {
    padding: 20px 10px;
    color: var(--ga-ink-2, #555);
    text-align: center;
  }
  .group-header {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 0 6px;
    background: rgba(255,255,255,0.03);
    border: none;
    border-bottom: 1px solid var(--ga-line, rgba(255,255,255,0.07));
    color: var(--ga-ink-1, #999);
    font-size: var(--ga-text-meta, 11px);
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    text-align: left;
    box-sizing: border-box;
  }
  .group-header:hover { background: rgba(255,255,255,0.06); color: var(--ga-ink-0, #fff); }
  .group-chevron { font-size: 9px; width: 10px; color: var(--ga-ink-2, #666); }
  .group-name { flex: 1; }
  .track-row {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 0 6px;
    border-bottom: 1px solid rgba(255,255,255,0.02);
    color: var(--ga-ink-2, #888);
    box-sizing: border-box;
  }
  .track-row.has-kf { color: var(--ga-ink-0, #bbb); }
  .track-row.armed { background: rgba(255, 32, 32, 0.04); }
  .kf-diamond {
    background: none;
    border: none;
    color: var(--ga-ink-3, #444);
    font-size: 9px;
    cursor: pointer;
    padding: 0;
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .kf-diamond:hover { color: var(--ga-coral, #ff6f5e); }
  .kf-diamond.active { color: var(--ga-coral, #ff6f5e); }
  .kf-diamond.armed { color: #FF2020; text-shadow: 0 0 6px rgba(255,32,32,0.6); }
  .track-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-size: var(--ga-text-meta, 11px);
  }
  .ctx-menu {
    position: fixed;
    z-index: 10000;
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255,255,255,0.12));
    border-radius: var(--ga-r-soft, 6px);
    padding: 4px 0;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.7);
    min-width: 180px;
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 6px 14px;
    background: none;
    border: none;
    color: var(--ga-ink-1, #ddd);
    font-size: var(--ga-text-body, 13px);
    text-align: left;
    cursor: pointer;
    font-family: inherit;
  }
  .ctx-item:hover { background: rgba(255,255,255,0.06); color: var(--ga-ink-0, #fff); }
  .ctx-delete { color: var(--ga-rec, #FF4757); }
  .ctx-sep { height: 1px; background: var(--ga-line, rgba(255,255,255,0.07)); margin: 4px 0; }
</style>
