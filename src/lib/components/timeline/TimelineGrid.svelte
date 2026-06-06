<script lang="ts">
  import { keyframeTimeline } from '../../stores/keyframeTimeline';
  import type { KeyframeableParam } from '../../keyframes/paramDiscovery';
  import type { KeyframeEasing } from '../../types';
  import { onMount, onDestroy } from 'svelte';

  // Keyframe clipboard — persists across component instances via module scope
  type KeyframeClipboard = {
    trackKey: string;
    type: 'number' | 'boolean';
    value: number | boolean;
    easing?: KeyframeEasing;
  };
  let kfClipboard: KeyframeClipboard | null = null;

  // Tracks the last-focused keyframe (right-clicked) so keyboard shortcuts
  // know what to copy without needing the menu open.
  let activeKeyframe: { paramKey: string; time: number; layerId: string } | null = null;
  // True while the pointer is inside this grid — gates keyboard shortcuts
  // so they don't fight with layer copy/paste elsewhere in the app.
  let mouseOverGrid = false;

  type FlatRow = { kind: 'group'; group: string; expanded: boolean } | { kind: 'param'; param: KeyframeableParam };

  export let flatRows: FlatRow[] = [];
  export let layerId: string | null = null;
  export let scrollEl: HTMLDivElement | undefined = undefined;

  const ROW_HEIGHT = 22;
  const GROUP_HEIGHT = 22;

  $: config = $keyframeTimeline.config;
  $: timelines = $keyframeTimeline.timelines;
  $: timeline = layerId ? timelines[layerId] : null;
  $: zoom = config.zoom;
  $: totalWidth = config.duration * zoom;
  $: playheadX = config.currentTime * zoom;

  // Reactive map: paramKey -> keyframe list. Rebuilds when timeline or timelines change.
  $: kfByParam = (() => {
    const map: Record<string, { time: number; isBool: boolean }[]> = {};
    if (!timeline) return map;
    for (const track of timeline.tracks) {
      if (track.type === 'boolean') {
        map[track.key] = track.boolKeyframes.map(k => ({ time: k.time, isBool: true }));
      } else {
        map[track.key] = track.keyframes.map(k => ({ time: k.time, isBool: false }));
      }
    }
    return map;
  })();

  $: rulerTicks = (() => {
    const ticks: { x: number; label: string; major: boolean }[] = [];
    const step = zoom >= 40 ? 1 : zoom >= 20 ? 2 : zoom >= 10 ? 5 : 10;
    for (let t = 0; t <= config.duration; t += step) {
      const m = Math.floor(t / 60);
      const s = t % 60;
      ticks.push({ x: t * zoom, label: `${m}:${String(s).padStart(2, '0')}`, major: t % (step * 5) === 0 || step >= 5 });
    }
    return ticks;
  })();

  let gridEl: HTMLDivElement;
  $: scrollEl = gridEl;
  let suppressNextClick = false;

  function getRelativeX(e: MouseEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    return e.clientX - rect.left + gridEl.scrollLeft;
  }

  // ── Event delegation: find keyframe at mouse position ──
  function findKfElement(target: EventTarget | null): HTMLElement | null {
    let el = target as HTMLElement | null;
    while (el && el !== gridEl) {
      if (el.classList?.contains('kf-mark')) return el;
      el = el.parentElement;
    }
    return null;
  }

  // ── Main mousedown handler (delegation) ──
  function handleMouseDown(e: MouseEvent) {
    const kfEl = findKfElement(e.target);
    const isPlayhead = (e.target as HTMLElement).closest('.playhead');

    console.log('[KF Grid] mousedown button=', e.button, 'kfEl=', !!kfEl, 'isPlayhead=', !!isPlayhead, 'layerId=', layerId);

    if (isPlayhead) {
      startPlayheadDrag(e);
      return;
    }

    if (kfEl) {
      const paramKey = kfEl.dataset.paramKey || '';
      const time = parseFloat(kfEl.dataset.time || '0');
      const kfLayerId = kfEl.dataset.layerId || layerId || '';
      if (e.button === 2) {
        e.preventDefault();
        e.stopPropagation();
        const menuHeight = 220;
        const y = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
        const menuWidth = 130;
        const x = e.clientX + menuWidth > window.innerWidth ? e.clientX - menuWidth : e.clientX;
        contextMenu = { x, y, paramKey, time, layerId: kfLayerId, kind: 'keyframe' };
        activeKeyframe = { paramKey, time, layerId: kfLayerId };
        return;
      }
      if (e.button === 0) {
        activeKeyframe = { paramKey, time, layerId: kfLayerId };
        // Select the keyframe immediately — if it turns out to be a drag,
        // the selection simply follows the moved keyframe via the store.
        keyframeTimeline.selectKeyframe(kfLayerId, paramKey, time);
        startKfDrag(e, paramKey, time, kfLayerId);
        return;
      }
    }
  }

  // Walk up the DOM to find the nearest track-row and return its paramKey.
  function findTrackRow(target: EventTarget | null): HTMLElement | null {
    let el = target as HTMLElement | null;
    while (el && el !== gridEl) {
      if (el.classList?.contains('track-row')) return el;
      el = el.parentElement;
    }
    return null;
  }

  function handleContextMenu(e: MouseEvent) {
    const kfEl = findKfElement(e.target);
    if (kfEl) {
      e.preventDefault();
      e.stopPropagation();
      const paramKey = kfEl.dataset.paramKey || '';
      const time = parseFloat(kfEl.dataset.time || '0');
      const kfLayerId = kfEl.dataset.layerId || layerId || '';
      // Flip menu up if near bottom of viewport
      const menuHeight = 220;
      const y = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
      const menuWidth = 130;
      const x = e.clientX + menuWidth > window.innerWidth ? e.clientX - menuWidth : e.clientX;
      contextMenu = { x, y, paramKey, time, layerId: kfLayerId, kind: 'keyframe' };
      activeKeyframe = { paramKey, time, layerId: kfLayerId };
      return;
    }
    // Right-click on empty track area → "Paste Here" menu (when clipboard has content)
    const trackRow = findTrackRow(e.target);
    if (trackRow) {
      const paramKey = trackRow.dataset.paramKey || '';
      if (!paramKey || !layerId) return;
      e.preventDefault();
      e.stopPropagation();
      const clickX = getRelativeX(e);
      const time = Math.max(0, clickX / zoom);
      const menuHeight = 60;
      const y = e.clientY + menuHeight > window.innerHeight ? e.clientY - menuHeight : e.clientY;
      const menuWidth = 160;
      const x = e.clientX + menuWidth > window.innerWidth ? e.clientX - menuWidth : e.clientX;
      contextMenu = { x, y, paramKey, time, layerId, kind: 'empty-track' };
    }
  }

  function seekFromClick(e: MouseEvent) {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const target = e.target as HTMLElement;
    if (target.closest('.kf-mark') || target.closest('.playhead')) return;
    // Clicking empty space clears the current keyframe selection
    if ($keyframeTimeline.selectedKeyframe) keyframeTimeline.clearSelection();
    const x = getRelativeX(e);
    keyframeTimeline.seek(Math.max(0, Math.min(x / zoom, config.duration)));
  }

  // ── Playhead drag ──
  function startPlayheadDrag(e: MouseEvent) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const capturedZoom = zoom;
    const capturedDuration = config.duration;
    const onMove = (ev: MouseEvent) => {
      const x = getRelativeX(ev);
      keyframeTimeline.seek(Math.max(0, Math.min(x / capturedZoom, capturedDuration)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // ── Keyframe drag ──
  function startKfDrag(e: MouseEvent, paramKey: string, time: number, kfLayerId: string) {
    e.stopPropagation();
    e.preventDefault();

    const capturedLayerId = kfLayerId || layerId;
    const capturedZoom = zoom;
    const capturedDuration = config.duration;
    let currentTrackTime = time;
    let moved = false;

    console.log('[KF Grid] startKfDrag: layerId=', capturedLayerId, 'paramKey=', paramKey, 'time=', time);

    const onMove = (ev: MouseEvent) => {
      if (!capturedLayerId) { console.warn('[KF Grid] drag onMove: no layerId'); return; }
      const x = getRelativeX(ev);
      const newTime = Math.max(0, Math.min(x / capturedZoom, capturedDuration));
      if (Math.abs(newTime - currentTrackTime) < 0.01) return;
      console.log('[KF Grid] drag move: newTime=', newTime, 'from', currentTrackTime);
      moved = true;
      keyframeTimeline.moveKeyframe(capturedLayerId, paramKey, currentTrackTime, newTime);
      currentTrackTime = newTime;
    };
    const onUp = () => {
      console.log('[KF Grid] drag end, moved=', moved);
      if (moved) suppressNextClick = true;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  // kfByParam is the reactive keyframe map used in the template

  // ── Context menu ──
  // kind='keyframe' when opened by right-clicking an existing keyframe;
  // kind='empty-track' when opened on empty track area (paste-only menu).
  let contextMenu: {
    x: number; y: number; paramKey: string; time: number; layerId: string;
    kind: 'keyframe' | 'empty-track';
  } | null = null;

  function setEasing(easing: KeyframeEasing) {
    if (!contextMenu) return;
    keyframeTimeline.updateKeyframeEasing(contextMenu.layerId, contextMenu.paramKey, contextMenu.time, easing);
    contextMenu = null;
  }

  function deleteKeyframe() {
    console.log('[KF Grid] deleteKeyframe called, contextMenu=', JSON.stringify(contextMenu));
    if (!contextMenu) { console.warn('[KF Grid] deleteKeyframe: no contextMenu'); return; }
    if (!contextMenu.layerId) { console.warn('[KF Grid] deleteKeyframe: no layerId in contextMenu'); return; }
    keyframeTimeline.removeKeyframe(contextMenu.layerId, contextMenu.paramKey, contextMenu.time);
    contextMenu = null;
    console.log('[KF Grid] deleteKeyframe done');
  }

  // Core copy: reads a keyframe out of the store and stashes it in the module clipboard.
  // Works from either the context menu or keyboard shortcuts.
  function copyKeyframeByRef(ref: { paramKey: string; time: number; layerId: string }): boolean {
    const track = keyframeTimeline.getTrack(ref.layerId, ref.paramKey);
    if (!track) return false;
    if (track.type === 'number') {
      const kf = track.keyframes.find(k => k.time === ref.time);
      if (kf) { kfClipboard = { trackKey: ref.paramKey, type: 'number', value: kf.value, easing: kf.easing }; return true; }
    } else {
      const kf = track.boolKeyframes.find(k => k.time === ref.time);
      if (kf) { kfClipboard = { trackKey: ref.paramKey, type: 'boolean', value: kf.value }; return true; }
    }
    return false;
  }

  // Core paste: adds a keyframe at `time` on (layerId, paramKey) from the clipboard.
  // Verifies track type matches. Returns true on success.
  function pasteKeyframeAt(layerId: string, paramKey: string, time: number): boolean {
    if (!kfClipboard) return false;
    const track = keyframeTimeline.getTrack(layerId, paramKey);
    if (!track || track.type !== kfClipboard.type) return false;
    keyframeTimeline.addKeyframe(
      layerId,
      paramKey,
      Math.max(0, time),
      kfClipboard.value as any,
      kfClipboard.easing || 'linear',
      track.label,
      track.type,
    );
    return true;
  }

  function copyKeyframe() {
    if (!contextMenu) return;
    copyKeyframeByRef({ paramKey: contextMenu.paramKey, time: contextMenu.time, layerId: contextMenu.layerId });
    activeKeyframe = { paramKey: contextMenu.paramKey, time: contextMenu.time, layerId: contextMenu.layerId };
    contextMenu = null;
  }

  function pasteAtPlayhead() {
    if (!contextMenu) return;
    const t = $keyframeTimeline.config.currentTime;
    pasteKeyframeAt(contextMenu.layerId, contextMenu.paramKey, t);
    contextMenu = null;
  }

  function pasteAtCursor() {
    if (!contextMenu) return;
    pasteKeyframeAt(contextMenu.layerId, contextMenu.paramKey, contextMenu.time);
    contextMenu = null;
  }

  // True when clipboard is compatible with the track under the context menu
  $: canPasteHere = !!(contextMenu && kfClipboard &&
    (() => {
      const track = keyframeTimeline.getTrack(contextMenu.layerId, contextMenu.paramKey);
      return track && track.type === kfClipboard.type;
    })());

  // ── Keyboard shortcuts ────────────────────────────────────────────
  // Ctrl/Cmd+C copies the active (last-focused) keyframe.
  // Ctrl/Cmd+V pastes at playhead onto the active track.
  // Only intercepted when the mouse is over this timeline grid, so layer
  // copy/paste elsewhere in the app remains unaffected.
  function handleGlobalKeydown(e: KeyboardEvent) {
    if (!mouseOverGrid) return;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.shiftKey || e.altKey) return;
    // Ignore when typing in an input/textarea
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (target && target.isContentEditable)) return;

    if (e.key === 'c' || e.key === 'C') {
      if (!activeKeyframe) return;
      if (copyKeyframeByRef(activeKeyframe)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    if (e.key === 'v' || e.key === 'V') {
      if (!kfClipboard || !activeKeyframe) return;
      const t = $keyframeTimeline.config.currentTime;
      if (pasteKeyframeAt(activeKeyframe.layerId, activeKeyframe.paramKey, t)) {
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
  }

  onMount(() => {
    // capture:true so we run BEFORE App.svelte's global layer copy/paste handler
    window.addEventListener('keydown', handleGlobalKeydown, true);
  });
  onDestroy(() => {
    window.removeEventListener('keydown', handleGlobalKeydown, true);
  });

  function closeContext(e: MouseEvent) {
    if (!contextMenu) return;
    if (e.button === 2) return;
    const target = e.target as HTMLElement;
    if (target.closest('.context-menu')) return;
    contextMenu = null;
  }
</script>

<svelte:window onclick={closeContext} />

<div class="grid-container" bind:this={gridEl}
  onclick={seekFromClick}
  onmousedown={handleMouseDown}
  oncontextmenu={handleContextMenu}
  onmouseenter={() => mouseOverGrid = true}
  onmouseleave={() => mouseOverGrid = false}>
  <!-- Ruler -->
  <div class="ruler" style="width: {totalWidth}px">
    {#each rulerTicks as tick}
      <div class="ruler-tick" class:major={tick.major} style="left: {tick.x}px">
        <span class="ruler-label">{tick.label}</span>
      </div>
    {/each}
  </div>

  <!-- Track rows -->
  <div class="tracks-area" style="width: {totalWidth}px">
    {#each flatRows as row}
      {#if row.kind === 'group'}
        <div class="group-spacer" style="height: {GROUP_HEIGHT}px"></div>
      {:else}
        <div class="track-row" style="height: {ROW_HEIGHT}px" data-param-key={row.param.key}>
          {#each (kfByParam[row.param.key] || []) as kf}
            <div class="kf-mark"
              class:bool={kf.isBool}
              class:selected={$keyframeTimeline.selectedKeyframe
                && $keyframeTimeline.selectedKeyframe.layerId === layerId
                && $keyframeTimeline.selectedKeyframe.trackKey === row.param.key
                && Math.abs($keyframeTimeline.selectedKeyframe.time - kf.time) < 0.001}
              style="left: {kf.time * zoom}px"
              data-param-key={row.param.key}
              data-time={kf.time}
              data-layer-id={layerId || ''}>
              ◆
            </div>
          {/each}
        </div>
      {/if}
    {/each}

    <!-- Playhead -->
    <div class="playhead" style="left: {playheadX}px">
      <div class="playhead-handle"></div>
      <div class="playhead-line"></div>
    </div>
  </div>
</div>

<!-- Context menu -->
{#if contextMenu && contextMenu.kind === 'keyframe'}
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    onclick={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}>
    <button class="ctx-item" onclick={(e) => { e.stopPropagation(); setEasing('linear'); }}>Linear</button>
    <button class="ctx-item" onclick={(e) => { e.stopPropagation(); setEasing('ease-in'); }}>Ease In</button>
    <button class="ctx-item" onclick={(e) => { e.stopPropagation(); setEasing('ease-out'); }}>Ease Out</button>
    <button class="ctx-item" onclick={(e) => { e.stopPropagation(); setEasing('ease-in-out'); }}>Ease In-Out</button>
    <button class="ctx-item" onclick={(e) => { e.stopPropagation(); setEasing('step'); }}>Step</button>
    <div class="ctx-sep"></div>
    <button class="ctx-item" onclick={(e) => { e.stopPropagation(); copyKeyframe(); }}>
      Copy Keyframe <span class="ctx-shortcut">Ctrl+C</span>
    </button>
    <button class="ctx-item" disabled={!canPasteHere}
      onclick={(e) => { e.stopPropagation(); if (canPasteHere) pasteAtPlayhead(); }}>
      Paste at Playhead <span class="ctx-shortcut">Ctrl+V</span>
    </button>
    <div class="ctx-sep"></div>
    <button class="ctx-item ctx-delete" onclick={(e) => { e.stopPropagation(); deleteKeyframe(); }}>Delete</button>
  </div>
{:else if contextMenu && contextMenu.kind === 'empty-track'}
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px"
    onclick={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
    oncontextmenu={(e) => e.preventDefault()}>
    <button class="ctx-item" disabled={!canPasteHere}
      onclick={(e) => { e.stopPropagation(); if (canPasteHere) pasteAtCursor(); }}>
      Paste Keyframe Here
    </button>
    <button class="ctx-item" disabled={!canPasteHere}
      onclick={(e) => { e.stopPropagation(); if (canPasteHere) pasteAtPlayhead(); }}>
      Paste at Playhead <span class="ctx-shortcut">Ctrl+V</span>
    </button>
  </div>
{/if}

<style>
  .grid-container {
    flex: 1;
    overflow-x: auto;
    overflow-y: auto;
    position: relative;
    background: rgba(8, 8, 12, 0.98);
    cursor: crosshair;
  }
  .ruler {
    height: 20px;
    position: sticky;
    top: 0;
    z-index: 2;
    background: rgba(14, 14, 18, 0.98);
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  .ruler-tick {
    position: absolute;
    top: 0;
    height: 100%;
    border-left: 1px solid rgba(255,255,255,0.08);
  }
  .ruler-tick.major { border-left-color: rgba(255,255,255,0.15); }
  .ruler-label {
    position: absolute;
    top: 4px;
    left: 3px;
    font-size: 8px;
    color: #555;
    font-family: var(--font-jetbrains), monospace;
    white-space: nowrap;
  }
  .tracks-area {
    position: relative;
    min-height: 100%;
  }
  .group-spacer {
    border-bottom: 1px solid rgba(255,255,255,0.04);
    box-sizing: border-box;
  }
  .track-row {
    position: relative;
    border-bottom: 1px solid rgba(255,255,255,0.02);
    box-sizing: border-box;
  }
  .track-row:hover { background: rgba(255,255,255,0.015); }
  .kf-mark {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    color: #FF6B6B;
    font-size: 16px;
    cursor: grab;
    padding: 2px 4px;
    z-index: 5;
    line-height: 1;
    user-select: none;
    pointer-events: auto;
  }
  .kf-mark:hover { color: #FF8585; font-size: 18px; }
  .kf-mark:active { cursor: grabbing; color: #FFAAAA; }
  .kf-mark.bool { color: #7EC8E3; }
  .kf-mark.selected {
    color: #FFD96B;
    text-shadow: 0 0 6px rgba(255, 217, 107, 0.9);
    transform: translate(-50%, -50%) scale(1.25);
  }
  .kf-mark.selected.bool { color: #FFD96B; }
  .playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    z-index: 3;
    cursor: col-resize;
    pointer-events: auto;
  }
  .playhead-handle {
    position: absolute;
    top: 0;
    left: -5px;
    width: 11px;
    height: 10px;
    background: #FF6B6B;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
  .playhead-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: #FF6B6B;
    opacity: 0.8;
  }
  .context-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-tertiary, #1a1a22);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 4px;
    padding: 4px 0;
    box-shadow: 0 4px 16px rgba(0,0,0,0.5);
    min-width: 110px;
  }
  .ctx-item {
    display: block;
    width: 100%;
    padding: 4px 12px;
    background: none;
    border: none;
    color: var(--text-primary, #ccc);
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .ctx-item:hover:not(:disabled) { background: rgba(255,107,107,0.15); color: #fff; }
  .ctx-item:disabled { opacity: 0.4; cursor: default; }
  .ctx-delete { color: #FF4757; }
  .ctx-sep { height: 1px; background: rgba(255,255,255,0.06); margin: 2px 0; }
  .ctx-shortcut { float: right; color: rgba(255,255,255,0.35); font-size: 10px; padding-left: 8px; }
</style>
