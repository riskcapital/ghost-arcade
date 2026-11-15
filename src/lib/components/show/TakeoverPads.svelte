<script lang="ts">
  /**
   * Pads, in the Timeline's Perform tab: the active VJ block's grid (click
   * a pad to launch it; a row's button takes the target row over with that
   * row), and one line of takeover settings: the overlay level and blend
   * over the whole show, the show underneath, and markers during a takeover.
   * Pads latch or hold is in the header.
   */
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { showSlice } from './timeline/timelineSlices';
  import { BLEND_MODE_ORDER, type BlendMode } from '../../types';
  import { liveTakeover } from '../../show/takeover/liveTakeover';
  import { takeOverTrack } from '../../show/takeover/takeoverRuntime';
  import { focusedTrackId } from './timeline/trackLayout';
  import { showToast } from '../../stores/errorToast';

  let deck = $state<'A' | 'B'>('A');
  const vj = $derived($vjClipLauncher);
  const showDeck: 'A' | 'B' = $derived(vj.crossfaderEnabled ? deck : 'A');
  const grid = $derived(showDeck === 'A' ? vj.clipGrid : vj.bankBClipGrid);
  const rows = $derived(showDeck === 'A' ? vj.layerStates : vj.bankBLayerStates);
  const tk = $derived($liveTakeover);
  const overlayLevel = $derived(tk.overlay?.level ?? 0);
  const overlayBlend = $derived(tk.overlay?.blend ?? 'normal');

  // Slices, not $showTimeline: the store publishes every playhead frame.
  const selectionStore = showSlice('selection');
  const layerTracksStore = showSlice('layerTracks');
  const target = $derived.by(() => {
    const selection = $selectionStore;
    const layerTracks = $layerTracksStore;
    const selectedId = selection?.kind === 'track' ? selection.id : null;
    return layerTracks.find((t) => t.id === $focusedTrackId)
      ?? layerTracks.find((t) => t.id === selectedId)
      ?? (layerTracks.length === 1 ? layerTracks[0] : null);
  });

  function liveRow(row: number) {
    if (!target) return;
    takeOverTrack(target, { kind: 'vjRow', deck: showDeck, row });
  }

  function setUnderneath(mode: 'run' | 'pause') {
    if (!liveTakeover.setUnderneath(mode)) showToast('The show follows an outside clock, so it cannot pause under a takeover.', 'info');
  }
</script>

<div class="tp" data-takeover-pads>
  <div class="tp-head">
    {#if vj.crossfaderEnabled}
      <span class="tp-seg" role="group" aria-label="Deck">
        <button class:active={showDeck === 'A'} onclick={() => (deck = 'A')}>A</button>
        <button class:active={showDeck === 'B'} onclick={() => (deck = 'B')}>B</button>
      </span>
    {:else}
      <span class="tp-title">Deck A</span>
    {/if}
    <span class="tp-target" title="The row a pad row's button and Shift+L take over: click a row on the Timeline to choose it">
      Take over
      {#if target}<b class="layer-name">{target.layerName}</b>{:else}<i>click a row</i>{/if}
    </span>
    <span class="tp-grow"></span>
    <span class="tp-label">Pads</span>
    <span class="tp-seg" role="group" aria-label="Pads">
      <button class:active={tk.padMode === 'latch'} onclick={() => liveTakeover.setPadMode('latch')} title="A press takes over until the next press or Return">Latch</button>
      <button class:active={tk.padMode === 'momentary'} onclick={() => liveTakeover.setPadMode('momentary')} title="Takes over only while a mapped pad or note is held">Hold</button>
    </span>
  </div>
  <div class="tp-grid">
    {#each grid as cells, r (r)}
      <div class="tp-row" data-pad-row={r}>
        <button
          class="tp-live"
          class:on={!!target && tk.surfaces[target.layerId]?.source?.kind === 'vjRow' && (tk.surfaces[target.layerId]?.source as any)?.row === r && (tk.surfaces[target.layerId]?.source as any)?.deck === showDeck}
          disabled={!target}
          onclick={() => liveRow(r)}
          title={target ? `Take “${target.layerName}” over with row ${showDeck}${r + 1}` : 'Click a row first'}
          data-pad-live={r}
        >{showDeck}{r + 1}</button>
        {#each cells as clip, c (c)}
          <button
            class="tp-pad"
            class:active={!!clip && rows[r]?.activeColumn === c}
            class:empty={!clip}
            disabled={!clip}
            style:background-image={clip?.thumbnail ? `url("${clip.thumbnail}")` : undefined}
            onclick={() => vjClipLauncher.triggerClip(r, c, showDeck)}
            title={clip ? clip.name : ''}
            data-pad={`${r}:${c}`}
          ><span class="clip-name">{clip?.name ?? ''}</span></button>
        {/each}
      </div>
    {:else}
      <p class="tp-none">The VJ deck has no clips yet: fill it in VJ mode, then play its rows here.</p>
    {/each}
  </div>

  <div class="tp-side">
    <label class="tp-field" title="The VJ mix over the whole show">
      <span>Overlay</span>
      <input
        type="range" min="0" max="1" step="0.01"
        value={overlayLevel}
        oninput={(e) => liveTakeover.setOverlay({ level: parseFloat((e.currentTarget as HTMLInputElement).value) })}
        aria-label="Overlay level"
        data-takeover-overlay
      />
      <span class="tp-num">{Math.round(overlayLevel * 100)}%</span>
    </label>
    <label class="tp-field">
      <span>Blend</span>
      <select value={overlayBlend} onchange={(e) => liveTakeover.setOverlay({ blend: (e.currentTarget as HTMLSelectElement).value as BlendMode })} aria-label="Overlay blend">
        {#each BLEND_MODE_ORDER as mode (mode)}<option value={mode}>{mode}</option>{/each}
      </select>
    </label>
    <div class="tp-field">
      <span>Show</span>
      <span class="tp-seg" role="group" aria-label="Show underneath">
        <button class:active={tk.underneath === 'run'} onclick={() => setUnderneath('run')} title="The show keeps running underneath: the hand-back lands wherever it has got to">Runs on</button>
        <button class:active={tk.underneath === 'pause'} onclick={() => setUnderneath('pause')} title="The show pauses while anything is taken over and carries on at the hand-back">Pauses</button>
      </span>
    </div>
    <div class="tp-field">
      <span>Markers</span>
      <span class="tp-seg" role="group" aria-label="Markers during a takeover">
        <button class:active={tk.markerPolicy === 'fire'} onclick={() => liveTakeover.setMarkerPolicy('fire')} title="Marker cues fire as normal during a takeover">Fire</button>
        <button class:active={tk.markerPolicy === 'hold'} onclick={() => liveTakeover.setMarkerPolicy('hold')} title="VJ and blackout actions of marker cues wait for the hand-back">Hold</button>
      </span>
      {#if tk.deferredCount > 0}<span class="tp-held" data-takeover-held>{tk.deferredCount} held</span>{/if}
    </div>
  </div>
</div>

<style>
  .tp { display: flex; flex-direction: column; gap: 8px; min-height: 0; font-size: var(--ga-text-control, 12px); }
  .tp-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .tp-title { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; text-transform: uppercase; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); color: var(--ga-ink-2, #89857e); }
  .tp-target { display: inline-flex; gap: 6px; align-items: center; min-width: 0; color: var(--ga-ink-2, #89857e); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-target b { color: var(--ga-ink-0, #f2ede4); font-weight: 650; overflow: hidden; text-overflow: ellipsis; }
  .tp-target i { font-style: normal; color: var(--ga-ink-1, #ada9a2); }
  .tp-grow { flex: 1; }
  .tp-label { color: var(--ga-ink-2, #89857e); font-size: var(--ga-text-meta, 11px); }
  .tp-grid { display: flex; flex-direction: column; gap: 4px; min-height: 0; overflow: auto; }
  .tp-row { display: flex; gap: 4px; }
  .tp-live, .tp-pad {
    flex: 0 0 auto;
    height: 32px;
    box-sizing: border-box;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    border-radius: 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-live {
    width: 32px;
    font-weight: 750;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--ga-ink-1, #ada9a2);
    background: var(--ga-card, #16140f);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .tp-live.on { color: #1a0a06; background: var(--tl-on, #ff725f); border-color: var(--tl-on, #ff725f); }
  .tp-live:disabled { opacity: 0.4; cursor: default; }
  .tp-pad {
    position: relative;
    flex: 1 1 0;
    min-width: 54px;
    max-width: 96px;
    padding: 0;
    text-align: left;
    color: var(--ga-ink-0, #f2ede4);
    background: var(--ga-raise, #26221c) center / cover no-repeat;
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .tp-pad .clip-name { position: absolute; left: 4px; right: 4px; bottom: 2px; overflow: hidden; text-overflow: ellipsis; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9); }
  .tp-pad:hover:not(:disabled) { border-color: var(--ga-line-3, rgba(245, 236, 222, 0.24)); }
  .tp-pad.active { box-shadow: inset 0 0 0 2px var(--tl-on, #ff725f); border-color: var(--tl-on, #ff725f); }
  .tp-pad.empty { background: var(--ga-slot, #060504); border-style: dashed; opacity: 0.45; cursor: default; }
  .tp-none { margin: 0; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .tp-side { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; padding-top: 4px; }
  .tp-field { display: flex; align-items: center; gap: 6px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #89857e); }
  .tp-field input[type='range'] { width: 72px; accent-color: var(--ga-ink-1, #ada9a2); }
  .tp-num { width: 30px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); color: var(--ga-ink-1, #ada9a2); }
  .tp-field select {
    height: 22px;
    background: var(--ga-slot, #060504);
    border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
    color: var(--ga-ink-0, #f2ede4);
    font: inherit;
    border-radius: 4px;
  }
  .tp-seg { display: inline-flex; padding: 2px; gap: 2px; background: var(--ga-slot, #060504); border: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13)); border-radius: 5px; }
  .tp-seg button {
    height: 18px;
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    color: var(--ga-ink-1, #ada9a2);
    background: none;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
  }
  .tp-seg button.active { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); box-shadow: inset 0 0 0 1px var(--ga-selection-line, #5278ff); }
  .tp-held { color: var(--tl-on, #ff725f); font-weight: 700; }
</style>
