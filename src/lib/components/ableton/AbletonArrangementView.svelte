<script lang="ts">
  /**
   * Arrangement — Live's locators on a timeline. Drop a visual on a
   * locator and it fires whenever the song reaches it; double-click a
   * locator to jump Live there.
   */
  import { abletonBridge, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { barBeat, linksForLocator, samePlace, type AbletonSource, type VisualAction } from '../../ableton/abletonLinks';
  import { actionLabel, actionTag, actionThumb, VISUAL_DRAG_TYPE, type VisualContext } from '../../ableton/abletonVisuals';

  export let bridge: AbletonBridgeState;
  export let ctx: VisualContext;
  export let beat: number;
  export let now: number;
  export let selected: AbletonSource | null = null;
  export let onSelect: (source: AbletonSource) => void;
  export let onDrop: (source: AbletonSource, action: VisualAction) => void;

  let dropIndex: number | null = null;

  // The timeline covers the locators (or 64 bars), not wherever Live's
  // position has run to: playing clips in Session View keeps the song
  // position climbing, and following it would squash every locator into
  // the first pixels. Past the end, the playhead waits at the edge.
  $: perBar = bridge.numerator * (4 / bridge.denominator);
  $: lastCue = bridge.cues.length ? bridge.cues[bridge.cues.length - 1].time : 0;
  $: span = Math.max(lastCue + 16 * perBar, 64 * perBar);
  $: rulerStep = niceStep(span / perBar);
  $: ruler = Array.from({ length: Math.floor(span / (perBar * rulerStep)) + 1 }, (_, i) => i * rulerStep * perBar);
  $: beyond = beat > span;

  /** Bars between ruler labels: a power of two that keeps about twelve. */
  function niceStep(bars: number): number {
    let step = 1;
    while (bars / step > 12) step *= 2;
    return step;
  }

  function source(index: number): AbletonSource {
    return { kind: 'locator', index, name: bridge.cues[index]?.name ?? '' };
  }

  function onDragOver(event: DragEvent, index: number) {
    if (!event.dataTransfer?.types.includes(VISUAL_DRAG_TYPE)) return;
    event.preventDefault();
    dropIndex = index;
  }

  function drop(event: DragEvent, index: number) {
    event.preventDefault();
    dropIndex = null;
    const raw = event.dataTransfer?.getData(VISUAL_DRAG_TYPE);
    if (raw) try { onDrop(source(index), JSON.parse(raw)); } catch { /* not ours */ }
  }
</script>

<div class="arrangement">
  <div class="toolbar">
    <button class="ghost" onclick={() => abletonBridge.toggleLocator()} title="Adds a locator at Live's song position (or removes the one there)">+ Locator at playhead</button>
    <span class="hint">Locators fire their visuals as the song passes them. Double-click one to jump Live there.</span>
  </div>

  {#if !bridge.cues.length}
    <div class="intro">
      <b>Script a whole song.</b>
      <p>Add locators in Live's Arrangement View (right-click the timeline → Add Locator, or use the button above) at each section — Intro, Verse, Drop. They appear here; drop a visual on each and the show plays itself with the arrangement.</p>
    </div>
  {/if}

  <div class="timeline">
    <div class="ruler">
      {#each ruler as at}
        <span class="tick" style="left: {(at / span) * 100}%">{Math.round(at / perBar) + 1}</span>
      {/each}
    </div>
    <div class="track">
      {#each bridge.cues as cue, index (index + cue.name)}
        {@const links = linksForLocator(bridge.links, index)}
        {@const src = source(index)}
        {@const flash = links.some(l => now - (bridge.fired[l.id] ?? -1e9) < 450)}
        {@const passed = beat >= cue.time}
        <button
          class="marker"
          class:selected={selected && samePlace(src, selected)}
          class:drop={dropIndex === index}
          class:flash
          class:passed
          style="left: {(cue.time / span) * 100}%"
          onclick={() => onSelect(src)}
          ondblclick={() => abletonBridge.jump(cue.time)}
          ondragover={(e) => onDragOver(e, index)}
          ondragleave={() => (dropIndex = null)}
          ondrop={(e) => drop(e, index)}
          title="{cue.name || 'Locator'} at {barBeat(cue.time, bridge.numerator, bridge.denominator)}"
        >
          <span class="flag" translate={cue.name ? 'no' : 'yes'}>{cue.name || `Locator ${index + 1}`}</span>
          <span class="visuals">
            {#each links.slice(0, 3) as l (l.id)}
              {@const thumb = actionThumb(ctx, l.action)}
              <span class="vis" title={actionLabel(ctx, l.action)}>{#if thumb}<img src={thumb} alt="" />{:else}<i>{actionTag(l.action)}</i>{/if}</span>
            {/each}
            {#if !links.length}<span class="empty-vis">Drop a visual</span>{/if}
          </span>
        </button>
      {/each}
      <span class="playhead" class:moving={bridge.playing} class:beyond style="left: {(Math.min(beat, span) / span) * 100}%">
        {#if beyond}<span class="beyond-label">bar {Math.floor(beat / perBar) + 1} ▸</span>{/if}
      </span>
    </div>
  </div>
</div>

<style>
  .arrangement { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
  .toolbar { display: flex; align-items: center; gap: 12px; }
  .hint { color: var(--ga-ink-2, #8a909b); }
  .ghost { height: 24px; padding: 0 10px; border-radius: 3px; border: 1px dashed rgba(255, 255, 255, 0.2); background: transparent; color: var(--ga-ink-1, #b8bdc6); font: inherit; cursor: pointer; white-space: nowrap; }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.4); }
  .intro { padding: 10px 12px; border: 1px solid rgba(127, 119, 221, 0.35); background: rgba(127, 119, 221, 0.08); border-radius: 4px; }
  .intro b { font-weight: 600; }
  .intro p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .timeline { position: relative; padding: 0 60px 0 4px; }
  .ruler { position: relative; height: 18px; border-bottom: 1px solid rgba(255, 255, 255, 0.1); }
  .tick { position: absolute; bottom: 2px; transform: translateX(-1px); font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: var(--ga-ink-2, #8a909b); border-left: 1px solid rgba(255, 255, 255, 0.15); padding-left: 3px; }
  .track {
    position: relative;
    height: 120px;
    background: repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.025) 0 1px, transparent 1px 40px);
  }
  .marker {
    position: absolute; top: 6px;
    display: flex; flex-direction: column; gap: 5px;
    padding: 0 0 0 7px;
    border: none; border-left: 2px solid #e0a33a;
    background: transparent;
    color: inherit; font: inherit; text-align: left;
    cursor: pointer;
    height: 104px;
    max-width: 180px;
  }
  .marker.passed { border-left-color: color-mix(in srgb, #e0a33a 55%, transparent); }
  .flag { padding: 2px 7px; background: #e0a33a; color: #1a1204; font-weight: 600; font-size: 11px; border-radius: 0 3px 3px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px; }
  .marker.selected .flag { box-shadow: 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  .marker.drop .flag { background: #c9c4ff; }
  .marker.flash .flag { animation: flash 0.45s ease-out; }
  @keyframes flash { from { background: #fff; } }
  .visuals { display: flex; gap: 3px; flex-wrap: wrap; }
  .vis { width: 46px; height: 26px; border-radius: 2px; overflow: hidden; background: #000; border: 1px solid rgba(201, 196, 255, 0.45); display: flex; align-items: center; justify-content: center; }
  .vis img { width: 100%; height: 100%; object-fit: cover; }
  .vis i { font-style: normal; font-size: 9px; font-weight: 700; color: #c9c4ff; }
  .empty-vis { font-size: 10px; color: var(--ga-ink-2, #8a909b); border: 1px dashed rgba(255, 255, 255, 0.15); padding: 4px 6px; border-radius: 2px; }
  .playhead { position: absolute; top: -18px; bottom: 0; width: 2px; background: var(--ga-ink-2, #8a909b); pointer-events: none; }
  .playhead.moving { background: var(--ga-live, #46d18a); }
  .playhead.beyond { opacity: 0.6; }
  .beyond-label { position: absolute; top: 22px; right: 6px; padding: 1px 6px; border-radius: 3px; background: #0c0f14; border: 1px solid rgba(255, 255, 255, 0.12); font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 10px; color: var(--ga-ink-1, #b8bdc6); white-space: nowrap; }
</style>
