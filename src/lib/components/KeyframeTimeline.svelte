<script lang="ts">
  import { KEYFRAME_EASINGS } from '../keyframes/easing';
  import { keyframeTimeline } from '../stores/keyframeTimeline';
  import { project, selectedLayer } from '../stores/layers';
  import { vjClipLauncher, vjOutputLayers } from '../stores/vjClipLauncher';
  import { discoverKeyframeableParams, type KeyframeableParam } from '../keyframes/paramDiscovery';
  import TimelineTransport from './timeline/TimelineTransport.svelte';
  import TimelineTrackList from './timeline/TimelineTrackList.svelte';
  import TimelineGrid from './timeline/TimelineGrid.svelte';

  export let embedded=false;
  export let targetId:string|null=null;
  $: isOpen = $keyframeTimeline.isOpen;

  // Hide the keyframe timeline entirely when the user is in VJ Mode.
  // The keyframe surface is a content-creation tool that belongs to
  // mapping mode — VJ mode is for live performance and the timeline
  // tray was eating screen real estate that's needed for the dual-deck,
  // macro, and snapshot UIs we layered in. Auto-close the tray if it
  // happens to be open when the user enters VJ mode so users don't get
  // stuck with a tray they can't toggle.
  $: hiddenInVJ = !embedded && $vjClipLauncher.isOpen;
  $: if (hiddenInVJ && isOpen) keyframeTimeline.setOpen(false);

  // Scroll sync between TrackList and TimelineGrid
  let trackListScrollEl: HTMLDivElement | undefined;
  let gridScrollEl: HTMLDivElement | undefined;
  let syncing = false;
  function syncFromList() {
    if (syncing || !trackListScrollEl || !gridScrollEl) return;
    syncing = true;
    gridScrollEl.scrollTop = trackListScrollEl.scrollTop;
    requestAnimationFrame(() => { syncing = false; });
  }
  function syncFromGrid() {
    if (syncing || !trackListScrollEl || !gridScrollEl) return;
    syncing = true;
    trackListScrollEl.scrollTop = gridScrollEl.scrollTop;
    requestAnimationFrame(() => { syncing = false; });
  }
  $: if (trackListScrollEl) trackListScrollEl.onscroll = syncFromList;
  $: if (gridScrollEl) gridScrollEl.onscroll = syncFromGrid;

  // Confirm modal for Clear All
  let showClearConfirm = false;

  function confirmClearAll() {
    console.log('[KF Timeline] clearAll confirmed');
    keyframeTimeline.clearAll();
    showClearConfirm = false;
  }

  // Spacebar play/pause when timeline is open
  function handleKeydown(e: KeyboardEvent) {
    if (!isOpen) return;
    // Ignore if typing in an input
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    if (e.code === 'Space') {
      e.preventDefault();
      if ($keyframeTimeline.config.isPlaying) keyframeTimeline.pause();
      else keyframeTimeline.play();
    }
  }
  $: layerId = $keyframeTimeline.selectedLayerId;
  $: currentTime = $keyframeTimeline.config.currentTime;

  // Determine VJ mode: use VJ layer selection when VJ panel is open and a layer is selected
  $: vjMode = $vjClipLauncher.isOpen;
  $: vjSelectedIdx = $vjClipLauncher.selectedLayerIndex;
  // Active clip on the currently selected VJ layer
  $: vjActiveClip = (vjMode && vjSelectedIdx !== null)
    ? $vjClipLauncher.layerStates[vjSelectedIdx]?.activeClip ?? null
    : null;

  // Auto-select layer when selected layer changes (mapping mode OR VJ mode)
  // In VJ mode, keyframes are keyed per-clip (not per-layer) so switching clips shows
  // each clip's own keyframes independently.
  $: {
    if(embedded&&targetId){if($keyframeTimeline.selectedLayerId!==targetId)keyframeTimeline.selectLayer(targetId);}
    else if (vjMode && vjActiveClip) {
      const vjLayerId = `vj-${vjActiveClip.id}`;
      if ($keyframeTimeline.selectedLayerId !== vjLayerId) {
        keyframeTimeline.selectLayer(vjLayerId);
      }
    } else if (vjMode && vjSelectedIdx !== null && !vjActiveClip) {
      // Layer selected but no active clip — clear selection
      if ($keyframeTimeline.selectedLayerId !== null) {
        keyframeTimeline.selectLayer(null);
      }
    } else if (!vjMode && $selectedLayer && $keyframeTimeline.selectedLayerId !== $selectedLayer.id) {
      keyframeTimeline.selectLayer($selectedLayer.id);
    }
  }

  // Discover params for the selected layer (VJ or mapping)
  $: targetLayer = (() => {
    if (!layerId) return null;
    if (layerId.startsWith('vj-')) {
      // VJ clip: find the output layer whose source.id matches the clip id
      const clipId = layerId.slice(3);
      return $vjOutputLayers?.find(l => l.source?.id === clipId) || null;
    }
    return $project.layers.find(l => l.id === layerId) || null;
  })();
  $: params = targetLayer ? discoverKeyframeableParams(targetLayer) : [];

  // Group params
  $: groups = params.reduce((acc, p) => {
    if (!acc[p.group]) acc[p.group] = [];
    acc[p.group].push(p);
    return acc;
  }, {} as Record<string, KeyframeableParam[]>);

  // Shared expand state
  let expandedGroups: Record<string, boolean> = {};
  function toggleGroup(group: string) {
    expandedGroups[group] = !(expandedGroups[group] ?? true);
    expandedGroups = expandedGroups;
  }

  // ── Keyframe inspector: resolve current selection to a concrete keyframe
  // record (time, value, easing, type + label) for the inspector panel. ──
  $: selectedKf = (() => {
    const sel = $keyframeTimeline.selectedKeyframe;
    if (!sel) return null;
    const timeline = $keyframeTimeline.timelines[sel.layerId];
    if (!timeline) return null;
    const track = timeline.tracks.find(t => t.key === sel.trackKey);
    if (!track) return null;
    const param = params.find(p => p.key === sel.trackKey);
    if (track.type === 'number') {
      const kf = track.keyframes.find(k => Math.abs(k.time - sel.time) < 0.001);
      if (!kf) return null;
      return {
        layerId: sel.layerId,
        trackKey: sel.trackKey,
        time: kf.time,
        value: kf.value as number | boolean,
        easing: kf.easing,
        type: 'number' as const,
        label: param?.label || track.label || sel.trackKey,
      };
    }
    const kf = track.boolKeyframes.find(k => Math.abs(k.time - sel.time) < 0.001);
    if (!kf) return null;
    return {
      layerId: sel.layerId,
      trackKey: sel.trackKey,
      time: kf.time,
      value: kf.value as number | boolean,
      easing: undefined as any,
      type: 'boolean' as const,
      label: param?.label || track.label || sel.trackKey,
    };
  })();
  $: selectedKfLabel = selectedKf?.label || '';

  function handleTimeChange(newTime: number) {
    if (!selectedKf) return;
    if (!Number.isFinite(newTime)) return;
    const clamped = Math.max(0, Math.min(newTime, $keyframeTimeline.config.duration));
    if (Math.abs(clamped - selectedKf.time) < 0.001) return;
    keyframeTimeline.moveKeyframe(selectedKf.layerId, selectedKf.trackKey, selectedKf.time, clamped);
  }

  // Build flat row list shared by both TrackList and Grid
  type FlatRow = { kind: 'group'; group: string; expanded: boolean } | { kind: 'param'; param: KeyframeableParam };
  $: flatRows = (() => {
    const rows: FlatRow[] = [];
    for (const [group, groupParams] of Object.entries(groups)) {
      const expanded = expandedGroups[group] ?? true;
      rows.push({ kind: 'group', group, expanded });
      if (expanded) {
        for (const p of groupParams) {
          rows.push({ kind: 'param', param: p });
        }
      }
    }
    return rows;
  })();

  // Get current value for a param from the live layer
  function getCurrentValue(param: KeyframeableParam): number | boolean {
    if (!targetLayer) return param.defaultValue;
    const l = targetLayer;
    if (param.key === 'layer:opacity') return l.opacity;
    if(param.key.startsWith('interactive:')){const [,id,key]=param.key.split(':');const e=l.source?.effectSource?.interactiveScene?.effects?.find(e=>e.id===id);return (key==='enabled'?e?.enabled:e?.params[key])??param.defaultValue;}
    if (param.key.startsWith('shader:')) {
      const v = l.source?.shaderValues?.[param.key.slice(7)] ?? param.defaultValue;
      // Vector-valued uniforms can't be keyframed as a scalar — fall back to default.
      return Array.isArray(v) ? param.defaultValue : v;
    }
    if (param.key.startsWith('fx:')) {
      const parts = param.key.split(':');
      const fx = l.effects?.find(e => e.id === parts[1]);
      if (!fx) return param.defaultValue;
      if (parts[2] === 'enabled') return fx.enabled;
      if (parts[2] === 'opacity') return fx.opacity ?? 1;
      return (fx.params as any)?.[parts[2]] ?? param.defaultValue;
    }
    if (param.key.startsWith('edge:')) {
      const parts = param.key.split(':');
      const edge = l.edgeEffects?.effects?.find(e => e.id === parts[1]);
      if (!edge) return param.defaultValue;
      if (parts[2] === 'enabled') return edge.enabled;
      if (parts[2] === 'opacity') return edge.opacity ?? 1;
      const [top, nested] = (parts[2] ?? '').split('.');
      const v = nested ? (edge as any)[top]?.[nested] : (edge as any)[top];
      return typeof v === 'number' ? v : param.defaultValue;
    }
    if (param.key.startsWith('model3d:') && l.model3dContent) {
      // Walk the dot path: model3d:echo.count → l.model3dContent.echo?.count
      let cur: any = l.model3dContent;
      for (const part of param.key.slice('model3d:'.length).split('.')) {
        if (cur == null) return param.defaultValue;
        cur = cur[part];
      }
      return typeof cur === 'number' || typeof cur === 'boolean' ? cur : param.defaultValue;
    }
    return param.defaultValue;
  }

  function addKeyframeForParam(param: KeyframeableParam) {
    if (!layerId) return;
    const value = getCurrentValue(param);
    keyframeTimeline.addKeyframe(layerId, param.key, currentTime, value, 'linear', param.label, param.type);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Toggle button + tray are hidden in VJ mode (content-creation tool,
     not a live-performance one). See `hiddenInVJ` reactive above. -->
{#if !hiddenInVJ && !embedded}
  <button data-help-page="show-timeline"
    class="kf-toggle"
    class:active={isOpen}
    onclick={() => keyframeTimeline.toggleOpen()}
    title="Keyframe timeline"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <line x1="2" y1="12" x2="22" y2="12"/>
      <line x1="2" y1="6" x2="22" y2="6"/>
      <line x1="2" y1="18" x2="22" y2="18"/>
      <circle cx="8" cy="6" r="2" fill="currentColor"/>
      <circle cx="16" cy="12" r="2" fill="currentColor"/>
      <circle cx="12" cy="18" r="2" fill="currentColor"/>
    </svg>
    <span>Keyframes</span>
  </button>
{/if}

<!-- Slide-up panel -->
{#if isOpen && !hiddenInVJ}
  <div data-help-page="show-timeline" class="kf-tray" class:embedded>
    <div class="kf-header-btns">
      <button class="kf-clear" onclick={() => { console.log('[KF Timeline] Clear All clicked'); showClearConfirm = true; }} title="Clear all keyframes">
        Clear all
      </button>
      <button class="kf-close" onclick={() => keyframeTimeline.setOpen(false)} title="Close timeline">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <TimelineTransport />
    <div class="kf-body">
      <TimelineTrackList {flatRows} {layerId} {toggleGroup} {addKeyframeForParam} bind:scrollEl={trackListScrollEl} />
      <TimelineGrid {flatRows} {layerId} bind:scrollEl={gridScrollEl} />
    </div>

    <!-- Keyframe Inspector (appears when a keyframe is selected) -->
    {#if selectedKf}
      <div class="kf-inspector">
        <div class="kfi-label">
          <span class="kfi-label-title">{selectedKfLabel}</span>
        </div>
        <label class="kfi-field">
          <span>Time</span>
          <input
            type="number" min="0" max={$keyframeTimeline.config.duration} step="0.01"
            value={selectedKf.time.toFixed(2)}
            onchange={(e) => handleTimeChange(parseFloat((e.target as HTMLInputElement).value))}
          />
          <span class="kfi-unit">s</span>
        </label>
        {#if selectedKf.type === 'number'}
          <label class="kfi-field kfi-field-wide">
            <span>Value</span>
            <input
              type="number" step="0.01"
              value={(selectedKf.value as number).toFixed(3)}
              onchange={(e) => keyframeTimeline.updateKeyframeValue(selectedKf!.layerId, selectedKf!.trackKey, selectedKf!.time, parseFloat((e.target as HTMLInputElement).value))}
            />
          </label>
        {:else}
          <label class="kfi-field kfi-field-bool">
            <span>Value</span>
            <input
              type="checkbox"
              checked={!!selectedKf.value}
              onchange={(e) => keyframeTimeline.updateKeyframeValue(selectedKf!.layerId, selectedKf!.trackKey, selectedKf!.time, (e.target as HTMLInputElement).checked)}
            />
          </label>
        {/if}
        {#if selectedKf.type === 'number'}
          <label class="kfi-field">
            <span>Easing</span>
            <select
              value={selectedKf.easing || 'linear'}
              onchange={(e) => keyframeTimeline.updateKeyframeEasing(selectedKf!.layerId, selectedKf!.trackKey, selectedKf!.time, (e.target as HTMLSelectElement).value as any)}
            >
              {#each KEYFRAME_EASINGS as easing}
                <option value={easing.value} title={easing.hint}>{easing.label}</option>
              {/each}
            </select>
          </label>
        {/if}
        <button class="kfi-delete"
          onclick={() => keyframeTimeline.removeKeyframe(selectedKf!.layerId, selectedKf!.trackKey, selectedKf!.time)}
          title="Delete keyframe">
          Delete
        </button>
        <button class="kfi-close"
          onclick={() => keyframeTimeline.clearSelection()}
          title="Close inspector">×</button>
      </div>
    {/if}

    {#if showClearConfirm}
      <div class="kf-modal-backdrop" onclick={() => showClearConfirm = false}>
        <div class="kf-modal" onclick={(e) => e.stopPropagation()}>
          <h3>Clear all keyframes?</h3>
          <p>This will remove all keyframes from all layers. This cannot be undone.</p>
          <div class="kf-modal-btns">
            <button class="kf-modal-cancel" onclick={() => showClearConfirm = false}>Cancel</button>
            <button class="kf-modal-confirm" onclick={confirmClearAll}>Clear all</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .kf-toggle {
    position: fixed;
    bottom: 24px;
    left: calc(50% + 200px);
    transform: translateX(-50%);
    z-index: 1002;
    display: flex;
    align-items: center;
    gap: 8px;
    background: var(--ga-bar, #111114);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #ddd);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    height: var(--ga-control-h, 26px);
    padding: 0 12px;
    border-radius: var(--ga-r-pill, 999px);
    cursor: pointer;
    transition: all 0.2s ease;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
    font-family: inherit;
  }
  .kf-toggle:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
  .kf-toggle.active {
    border-color: var(--ga-selection-line, #5278ff);
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
  }

  .kf-tray {
    position: fixed;
    bottom: var(--ga-bottom-rail-offset, 74px);
    left: 0;
    right: 0;
    height: 300px;
    z-index: 90;
    background: var(--ga-panel, #0a0a0e);
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    display: flex;
    flex-direction: column;
    animation: slideUp 0.2s ease-out;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
  }

  .kf-tray.embedded{position:relative;bottom:auto;left:auto;right:auto;flex:0 0 280px;height:280px;min-height:200px;z-index:2;}
  .kf-header-btns {
    position: absolute;
    top: 6px;
    right: 10px;
    z-index: 10;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .kf-clear {
    height: var(--ga-control-h, 26px);
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 4px);
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .kf-clear:hover {
    border-color: color-mix(in srgb, var(--ga-rec, #ff4438) 55%, transparent);
    color: var(--ga-rec, #ff4438);
  }
  .kf-close {
    width: var(--ga-control-h, 26px);
    height: var(--ga-control-h, 26px);
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    border-radius: var(--ga-r-hard, 4px);
    cursor: pointer;
    transition: all 0.15s;
  }
  .kf-close:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
    color: var(--ga-ink-0, #fff);
  }

  .kf-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .kf-inspector {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 36px;
    padding: 4px 12px;
    background: var(--ga-card, #121217);
    border-top: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
    flex: 0 0 auto;
  }
  .kfi-label {
    flex: 0 0 auto;
    padding-right: 12px;
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  /* Gold matches the keyframe diamonds on the grid. */
  .kfi-label-title {
    color: #FFD96B;
    font-weight: var(--ga-weight-control, 600);
    font-size: var(--ga-text-control, 12px);
  }
  .kfi-field {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .kfi-field > span { color: var(--ga-ink-2, #888); }
  .kfi-field input[type="number"],
  .kfi-field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    width: 72px;
    outline: none;
  }
  .kfi-field input[type="number"] { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .kfi-field-wide input[type="number"] { width: 96px; }
  .kfi-field select { width: auto; }
  .kfi-field input:focus,
  .kfi-field select:focus { border-color: var(--ga-focus, #8aa4ff); }
  .kfi-field input[type="checkbox"] {
    width: 14px;
    height: 14px;
    cursor: pointer;
  }
  .kfi-unit { color: var(--ga-ink-2, #888); }
  .kfi-delete {
    margin-left: auto;
    height: var(--ga-control-h-sm, 22px);
    background: transparent;
    border: 1px solid color-mix(in srgb, var(--ga-rec, #ff4757) 40%, transparent);
    color: var(--ga-rec, #FF4757);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
  }
  .kfi-delete:hover { background: color-mix(in srgb, var(--ga-rec, #ff4757) 14%, transparent); }
  .kfi-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .kfi-close:hover { color: var(--ga-ink-0, #fff); }

  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .kf-modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .kf-modal {
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 8px);
    padding: 16px 20px;
    max-width: 380px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.8);
  }
  .kf-modal h3 {
    margin: 0 0 8px 0;
    color: var(--ga-ink-0, #fff);
    font-size: var(--ga-text-heading, 16px);
    font-weight: var(--ga-weight-title, 650);
  }
  .kf-modal p {
    margin: 0 0 16px 0;
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-body, 13px);
    line-height: 1.5;
  }
  .kf-modal-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .kf-modal-cancel {
    height: var(--ga-control-h, 26px);
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #ccc);
    padding: 0 12px;
    border-radius: var(--ga-r-soft, 6px);
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
    font-family: inherit;
    font-weight: var(--ga-weight-control, 600);
  }
  .kf-modal-cancel:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .kf-modal-confirm {
    /* Destructive: record red on purpose. */
    height: var(--ga-control-h, 26px);
    background: var(--ga-rec, #FF4757);
    border: 1px solid var(--ga-rec, #FF4757);
    color: #fff;
    padding: 0 12px;
    border-radius: var(--ga-r-soft, 6px);
    font-size: var(--ga-text-control, 12px);
    cursor: pointer;
    font-family: inherit;
    font-weight: 700;
  }
  .kf-modal-confirm:hover {
    filter: brightness(1.1);
  }
</style>
