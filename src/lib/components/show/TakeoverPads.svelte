<script lang="ts">
  /**
   * Live pads, folded open under the show transport: the active VJ block's
   * grid (click a pad to launch it; a row's LIVE takes the focused track over
   * with that row), the overlay fader and blend over the whole show, and the
   * takeover settings (pads latch or hold, the show underneath, markers).
   */
  import { vjClipLauncher } from '../../stores/vjClipLauncher';
  import { showTimeline } from '../../stores/showTimeline';
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

  const target = $derived.by(() => {
    const s = $showTimeline;
    const selectedId = s.selection?.kind === 'track' ? s.selection.id : null;
    return s.layerTracks.find((t) => t.id === $focusedTrackId)
      ?? s.layerTracks.find((t) => t.id === selectedId)
      ?? (s.layerTracks.length === 1 ? s.layerTracks[0] : null);
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
  <div class="tp-grid-wrap">
    <div class="tp-grid-head">
      {#if vj.crossfaderEnabled}
        <span class="tp-seg" role="group" aria-label="Deck">
          <button class:active={showDeck === 'A'} onclick={() => (deck = 'A')}>A</button>
          <button class:active={showDeck === 'B'} onclick={() => (deck = 'B')}>B</button>
        </span>
      {:else}
        <span class="tp-title">Deck A</span>
      {/if}
      <span class="tp-target" title="The track a row's LIVE and the L key take over: click a track to choose it">
        {#if target}→ {target.layerName}{:else}Click a track to choose what LIVE takes over{/if}
      </span>
    </div>
    <div class="tp-grid">
      {#each grid as cells, r}
        <div class="tp-row" data-pad-row={r}>
          <button
            class="tp-live"
            class:on={!!target && tk.surfaces[target.layerId]?.source?.kind === 'vjRow' && (tk.surfaces[target.layerId]?.source as any)?.row === r && (tk.surfaces[target.layerId]?.source as any)?.deck === showDeck}
            disabled={!target}
            onclick={() => liveRow(r)}
            title={target ? `Take “${target.layerName}” over with row ${showDeck}${r + 1}` : 'Click a track first'}
            data-pad-live={r}
          >{showDeck}{r + 1}</button>
          {#each cells as clip, c}
            <button
              class="tp-pad"
              class:active={!!clip && rows[r]?.activeColumn === c}
              class:empty={!clip}
              disabled={!clip}
              onclick={() => vjClipLauncher.triggerClip(r, c, showDeck)}
              title={clip ? clip.name : ''}
              data-pad={`${r}:${c}`}
            >{clip?.name ?? ''}</button>
          {/each}
        </div>
      {/each}
    </div>
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
        {#each BLEND_MODE_ORDER as mode}<option value={mode}>{mode}</option>{/each}
      </select>
    </label>
    <div class="tp-field">
      <span>Pads</span>
      <span class="tp-seg" role="group" aria-label="Pads">
        <button class:active={tk.padMode === 'latch'} onclick={() => liveTakeover.setPadMode('latch')} title="A press takes over until the next press or Return">Latch</button>
        <button class:active={tk.padMode === 'momentary'} onclick={() => liveTakeover.setPadMode('momentary')} title="Takes over only while a mapped pad or note is held">Hold</button>
      </span>
    </div>
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
  .tp {
    display: flex;
    gap: 12px;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 140, 40, 0.35);
    background: color-mix(in srgb, #ff8c28 4%, transparent);
    max-height: 168px;
    box-sizing: border-box;
    min-height: 0;
  }
  .tp-grid-wrap { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .tp-grid-head { display: flex; align-items: center; gap: 8px; }
  .tp-title { font-size: var(--ga-text-eyebrow, 10px); text-transform: uppercase; letter-spacing: 0.08em; color: #ff8c28; }
  .tp-target { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1, #aaa); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .tp-grid { overflow: auto; display: flex; flex-direction: column; gap: 2px; min-height: 0; }
  .tp-row { display: flex; gap: 2px; }
  .tp-live, .tp-pad {
    flex: 0 0 auto;
    height: 22px;
    box-sizing: border-box;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    border-radius: 3px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-live {
    width: 34px;
    font-weight: 800;
    color: #ff8c28;
    background: rgba(255, 140, 40, 0.06);
    border: 1px solid rgba(255, 140, 40, 0.45);
  }
  .tp-live.on { color: #1a0d02; background: #ff8c28; border-color: #ff8c28; }
  .tp-live:disabled { opacity: 0.35; cursor: default; }
  .tp-pad {
    width: 78px;
    padding: 0 5px;
    text-align: left;
    color: var(--ga-ink-0, #ddd);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }
  .tp-pad:hover:not(:disabled) { border-color: rgba(255, 140, 40, 0.7); }
  .tp-pad.active { background: rgba(95, 220, 118, 0.22); border-color: #5fdc76; color: #fff; }
  .tp-pad.empty { background: transparent; border-style: dashed; opacity: 0.35; cursor: default; }
  .tp-side { flex: 0 0 auto; display: flex; flex-direction: column; gap: 5px; justify-content: flex-start; }
  .tp-field { display: flex; align-items: center; gap: 6px; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #888); }
  .tp-field > span:first-child { width: 52px; }
  .tp-field input[type='range'] { width: 110px; accent-color: #ff8c28; }
  .tp-num { width: 34px; font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); color: var(--ga-ink-1, #aaa); }
  .tp-field select {
    height: 22px;
    background: var(--ga-slot, rgba(0, 0, 0, 0.4));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #ddd);
    font: inherit;
    border-radius: 3px;
  }
  .tp-seg { display: inline-flex; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); border-radius: 3px; overflow: hidden; }
  .tp-seg button {
    height: 20px;
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-1, #aaa);
    background: none;
    border: 0;
    cursor: pointer;
  }
  .tp-seg button + button { border-left: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
  .tp-seg button.active { color: #1a0d02; background: #ff8c28; }
  .tp-held { color: #ff8c28; font-weight: 700; }
</style>
