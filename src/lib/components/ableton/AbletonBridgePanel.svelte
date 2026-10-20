<script lang="ts">
  /**
   * Ableton bridge panel — the Live session grid mirrored beside Ghost
   * Arcade's visuals. Drag a column, clip or snapshot onto a scene or clip
   * to link them; the visual then fires whenever Live launches it.
   *
   * Opens over VJ mode so the output keeps running while links are made.
   */
  import { onDestroy, onMount } from 'svelte';
  import { get } from 'svelte/store';
  import { abletonBridge } from '../../ableton/abletonBridge';
  import {
    linksForClip,
    linksForScene,
    liveColor,
    quantizeLabel,
    samePlace,
    type AbletonLink,
    type AbletonSource,
    type VisualAction,
  } from '../../ableton/abletonLinks';
  import { vjClipLauncher, type VJClip, type VJDeck } from '../../stores/vjClipLauncher';
  import { snapshots, type Snapshot } from '../../stores/snapshots';
  import { nativePreviewHostEl } from '../../stores/nativePreviewHost';

  export let onClose: () => void;
  /** The render core's presenter shows through a transparent box here. */
  export let nativePreview = false;

  let previewEl: HTMLDivElement | null = null;

  type PaletteTab = 'columns' | 'clips' | 'snapshots';
  interface PaletteItem { key: string; label: string; hint: string; thumbnail?: string; action: VisualAction }

  let deck: VJDeck = 'A';
  let tab: PaletteTab = 'columns';
  let selected: AbletonSource | null = null;
  let dropTarget: string | null = null;
  let installMessage = '';

  $: bridge = $abletonBridge;
  $: grid = deck === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
  $: sceneCount = bridge.scenes.length;
  $: palette = buildPalette(tab, deck, grid, $vjClipLauncher.numColumns, $snapshots.snapshots);
  $: selectedLinks = selected ? bridge.links.filter(l => samePlace(l.source, selected!)) : [];
  $: selectedLabel = selected ? sourceLabel(selected) : '';
  $: scriptReady = !!bridge.script?.installed && !!bridge.script?.current;
  // Claim the presenter for the preview box while it exists.
  $: if (nativePreview) {
    if (previewEl) {
      if ($nativePreviewHostEl !== previewEl) nativePreviewHostEl.set(previewEl);
    } else if ($nativePreviewHostEl && !$nativePreviewHostEl.isConnected) {
      nativePreviewHostEl.set(null);
    }
  }

  onDestroy(() => {
    if (previewEl && get(nativePreviewHostEl) === previewEl) nativePreviewHostEl.set(null);
  });

  onMount(() => {
    void abletonBridge.enable();
    void abletonBridge.refreshScript();
  });

  function buildPalette(kind: PaletteTab, d: VJDeck, clipGrid: (VJClip | null)[][], columns: number, snaps: Snapshot[]): PaletteItem[] {
    if (kind === 'snapshots') {
      return snaps.flatMap((snap, slot) => snap.capturedAt ? [{
        key: `snap-${slot}`, label: snap.name || `Snapshot ${slot + 1}`, hint: `Slot ${slot + 1}`,
        action: { kind: 'snapshot', slot } as VisualAction,
      }] : []);
    }
    if (kind === 'columns') {
      return Array.from({ length: columns }, (_, column) => {
        const clips = clipGrid.map(row => row?.[column]).filter(Boolean);
        return {
          key: `col-${d}-${column}`, label: `Column ${column + 1}`,
          hint: clips.length ? clips.map(c => c!.name).join(', ') : 'Empty',
          thumbnail: clips[0]?.thumbnail,
          action: { kind: 'column', deck: d, column } as VisualAction,
        };
      });
    }
    return clipGrid.flatMap((row, layer) => (row ?? []).flatMap((clip, column) => clip ? [{
      key: `clip-${d}-${layer}-${column}`, label: clip.name, hint: `Layer ${layer + 1} · Column ${column + 1}`,
      thumbnail: clip.thumbnail,
      action: { kind: 'clip', deck: d, layer, column } as VisualAction,
    }] : []));
  }

  function actionLabel(action: VisualAction): string {
    if (action.kind === 'snapshot') {
      const snap = $snapshots.snapshots[action.slot];
      return snap?.capturedAt ? `Snapshot ${action.slot + 1} · ${snap.name}` : `Snapshot ${action.slot + 1} (empty)`;
    }
    const deckLabel = $vjClipLauncher.crossfaderEnabled || action.deck === 'B' ? ` · Deck ${action.deck}` : '';
    if (action.kind === 'column') return `Column ${action.column + 1}${deckLabel}`;
    const clipGrid = action.deck === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
    const clip = clipGrid[action.layer]?.[action.column];
    return `${clip?.name ?? 'Empty slot'} · L${action.layer + 1}${deckLabel}`;
  }

  function shortLabel(action: VisualAction): string {
    if (action.kind === 'snapshot') return `Snap ${action.slot + 1}`;
    if (action.kind === 'column') return `Col ${action.column + 1}${action.deck === 'B' ? 'B' : ''}`;
    const clipGrid = action.deck === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
    return clipGrid[action.layer]?.[action.column]?.name ?? `L${action.layer + 1} C${action.column + 1}`;
  }

  function sourceLabel(source: AbletonSource): string {
    if (source.kind === 'scene') return `Scene ${source.scene + 1}${source.name ? ` · ${source.name}` : ''}`;
    return `${source.trackName || `Track ${source.track + 1}`} · ${source.name || `Clip ${source.slot + 1}`}`;
  }

  function sceneSource(scene: number): AbletonSource {
    return { kind: 'scene', scene, name: bridge.scenes[scene]?.name ?? '' };
  }

  function clipSource(track: number, slot: number): AbletonSource {
    const t = bridge.tracks[track];
    return { kind: 'clip', track, slot, trackName: t?.name ?? '', name: t?.slots[slot]?.name ?? '' };
  }

  function isSelected(source: AbletonSource, current: AbletonSource | null) {
    return !!current && samePlace(source, current);
  }

  function link(source: AbletonSource, action: VisualAction) {
    abletonBridge.addLink(source, action);
    selected = source;
  }

  function cellKey(source: AbletonSource) {
    return source.kind === 'scene' ? `s${source.scene}` : `c${source.track}-${source.slot}`;
  }

  function onDragStart(event: DragEvent, item: PaletteItem) {
    event.dataTransfer?.setData('application/x-ghost-visual', JSON.stringify(item.action));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
  }

  function onDragOver(event: DragEvent, source: AbletonSource) {
    if (!event.dataTransfer?.types.includes('application/x-ghost-visual')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'link';
    dropTarget = cellKey(source);
  }

  function onDrop(event: DragEvent, source: AbletonSource) {
    event.preventDefault();
    dropTarget = null;
    const raw = event.dataTransfer?.getData('application/x-ghost-visual');
    if (!raw) return;
    try {
      link(source, JSON.parse(raw) as VisualAction);
    } catch { /* not ours */ }
  }

  function pickPaletteItem(item: PaletteItem) {
    if (selected) link(selected, item.action);
  }

  function badge(links: AbletonLink[]): string {
    if (!links.length) return '';
    return links.length > 1 ? `${shortLabel(links[0].action)} +${links.length - 1}` : shortLabel(links[0].action);
  }

  function lastFired(links: AbletonLink[], fired: Record<string, number>): number {
    return links.reduce((latest, l) => Math.max(latest, fired[l.id] ?? 0), 0);
  }

  async function install(chooseFolder = false) {
    installMessage = '';
    const result = await abletonBridge.installScript(chooseFolder);
    if (!result || result.canceled) return;
    installMessage = result.ok ? `Installed to ${result.path}` : `Couldn't install: ${result.error}`;
  }

  function linkScenes() {
    const existing = bridge.links.filter(l => l.source.kind === 'scene').length;
    if (existing && !confirm('Replace the existing scene links with Scene N → Column N?')) return;
    abletonBridge.linkScenesToColumns(deck);
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      if (selected) selected = null;
      else onClose();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="ab-root" class:see-through={nativePreview && bridge.connected} role="dialog" aria-label="Ableton bridge">
  <header class="ab-top">
    <button class="ab-icon" onclick={onClose} title="Back to VJ" aria-label="Back to VJ">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>
    </button>
    <div class="ab-brand">ABLETON<b>BRIDGE</b></div>
    <div class="ab-status" class:on={bridge.connected}>
      <span class="dot"></span>
      {#if bridge.connected}Live connected{:else if bridge.listening}Waiting for Live{:else}{bridge.error ?? 'Starting…'}{/if}
    </div>
    {#if bridge.connected}
      <div class="ab-chip">{Math.round(bridge.tempo * 10) / 10} BPM</div>
      <div class="ab-chip">{bridge.numerator}/{bridge.denominator}</div>
      <div class="ab-chip" title="Live's launch quantization">Launch: {quantizeLabel(bridge.quantize)}</div>
    {/if}
    <div class="ab-spacer"></div>
    {#if bridge.connected}
      <button class="ab-btn" onclick={linkScenes} disabled={!sceneCount} title="Link Scene 1 to Column 1, Scene 2 to Column 2, and so on">Scenes → columns</button>
      <button class="ab-btn" onclick={() => abletonBridge.resync()} title="Ask Live for the whole set again">Resync</button>
    {/if}
    <button class="ab-btn" onclick={() => install(false)} title={bridge.script?.path ?? ''}>
      {bridge.script?.installed ? (bridge.script.current ? 'Reinstall Live script' : 'Update Live script') : 'Install Live script'}
    </button>
  </header>

  {#if !bridge.connected}
    <section class="ab-setup">
      <h2>Connect Ableton Live</h2>
      <ol>
        <li class:done={scriptReady}>
          <div class="step-title">Install the Ghost Arcade script</div>
          <p>Copies a small control surface into your Ableton User Library.</p>
          <div class="step-actions">
            <button class="ab-btn primary" onclick={() => install(false)}>
              {bridge.script?.installed && !bridge.script.current ? 'Update script' : scriptReady ? 'Installed' : 'Install script'}
            </button>
            <button class="ab-btn" onclick={() => install(true)}>Choose folder…</button>
            {#if bridge.script?.installed}
              <button class="ab-btn" onclick={() => abletonBridge.revealScript()}>Show in folder</button>
            {/if}
          </div>
          {#if installMessage}<p class="note">{installMessage}</p>{/if}
          {#if bridge.script && !bridge.script.libraryFound && !bridge.script.installed}
            <p class="note">No Ableton User Library at the usual place. If you moved it, use Choose folder… and pick its "Remote Scripts" folder.</p>
          {/if}
        </li>
        <li>
          <div class="step-title">Turn it on in Live</div>
          <p>Restart Live, open Preferences (Settings in Live 12), go to the Link / MIDI tab, and set a Control Surface to <b>GhostArcade</b>. Input and Output can stay on None.</p>
        </li>
        <li class:done={bridge.connected}>
          <div class="step-title">{bridge.listening ? 'Waiting for Live…' : 'Listening is off'}</div>
          <p>Your session grid shows up here as soon as Live says hello. Turn on Link in both apps to share the tempo.</p>
          {#if bridge.error}<p class="note error">{bridge.error}</p>{/if}
        </li>
      </ol>
    </section>
  {:else}
    <div class="ab-body">
      <div class="ab-grid-wrap">
        {#if !bridge.tracks.length}
          <div class="ab-empty">This Live set has no tracks yet.</div>
        {:else}
          <div class="ab-grid" style="grid-template-columns: 150px repeat({bridge.tracks.length}, 120px)">
            <div class="corner">Scenes</div>
            {#each bridge.tracks as track, t}
              <div class="track-head" style="--live: {liveColor(track.color)}" title={track.name}>{track.name || `Track ${t + 1}`}</div>
            {/each}
            {#each bridge.scenes as scene, s}
              {@const source = sceneSource(s)}
              {@const links = linksForScene(bridge.links, s)}
              <div
                class="cell scene"
                class:selected={isSelected(source, selected)}
                class:queued={scene.queued}
                class:drop={dropTarget === cellKey(source)}
                style="--live: {liveColor(scene.color)}"
                role="button"
                tabindex="0"
                onclick={() => (selected = source)}
                onkeydown={(e) => e.key === 'Enter' && (selected = source)}
                ondragover={(e) => onDragOver(e, source)}
                ondragleave={() => (dropTarget = null)}
                ondrop={(e) => onDrop(e, source)}
              >
                <button class="launch" onclick={(e) => { e.stopPropagation(); abletonBridge.launchScene(s); }} title="Launch scene in Live" aria-label="Launch scene in Live">
                  <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                </button>
                <span class="name">{scene.name || `Scene ${s + 1}`}</span>
                {#if links.length}
                  {#key lastFired(links, bridge.fired)}
                    <span class="badge" class:fired={lastFired(links, bridge.fired) > 0}>{badge(links)}</span>
                  {/key}
                {/if}
              </div>
              {#each bridge.tracks as track, t}
                {@const clip = track.slots[s]}
                {#if clip}
                  {@const source = clipSource(t, s)}
                  {@const clipLinks = linksForClip(bridge.links, t, s)}
                  <div
                    class="cell clip"
                    class:selected={isSelected(source, selected)}
                    class:playing={track.playing === s}
                    class:queued={track.fired === s}
                    class:drop={dropTarget === cellKey(source)}
                    style="--live: {liveColor(clip.color)}"
                    role="button"
                    tabindex="0"
                    onclick={() => (selected = source)}
                    onkeydown={(e) => e.key === 'Enter' && (selected = source)}
                    ondragover={(e) => onDragOver(e, source)}
                    ondragleave={() => (dropTarget = null)}
                    ondrop={(e) => onDrop(e, source)}
                  >
                    <button class="launch" onclick={(e) => { e.stopPropagation(); abletonBridge.launchClip(t, s); }} title="Launch clip in Live" aria-label="Launch clip in Live">
                      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                    </button>
                    <span class="name">{clip.name || 'Clip'}</span>
                    {#if clipLinks.length}
                      {#key lastFired(clipLinks, bridge.fired)}
                        <span class="badge" class:fired={lastFired(clipLinks, bridge.fired) > 0}>{badge(clipLinks)}</span>
                      {/key}
                    {/if}
                  </div>
                {:else}
                  <div class="cell empty"></div>
                {/if}
              {/each}
            {/each}
          </div>
        {/if}
      </div>

      <aside class="ab-side">
        <div class="ab-preview" class:hole={nativePreview} bind:this={previewEl}>
          {#if !nativePreview}<span>Output preview</span>{/if}
        </div>
        <section class="ab-links">
          {#if selected}
            <div class="side-title">{selectedLabel}</div>
            {#if selectedLinks.length}
              {#each selectedLinks as l (l.id)}
                <div class="link-row" class:missing={bridge.missing.includes(l.id)}>
                  <span class="link-label">{actionLabel(l.action)}</span>
                  <button class="ab-icon small" onclick={() => abletonBridge.preview(l)} title="Fire this visual now" aria-label="Fire this visual now">
                    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                  </button>
                  <button class="ab-icon small" onclick={() => abletonBridge.removeLink(l.id)} title="Remove link" aria-label="Remove link">
                    <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9"/></svg>
                  </button>
                </div>
              {/each}
            {:else}
              <p class="hint">Nothing linked. Click a visual below, or drag one onto any scene or clip.</p>
            {/if}
          {:else}
            <div class="side-title">{bridge.links.length} link{bridge.links.length === 1 ? '' : 's'}</div>
            <p class="hint">Drag a visual onto a scene or clip in your Live set. It fires the moment Live launches it, on the same bar.</p>
            {#if bridge.missing.length}
              <p class="hint warn">{bridge.missing.length} link{bridge.missing.length === 1 ? '' : 's'} point at scenes or clips that aren't in this set.</p>
            {/if}
          {/if}
        </section>

        <section class="ab-palette">
          <div class="palette-head">
            <div class="seg">
              <button class:active={tab === 'columns'} onclick={() => (tab = 'columns')}>Columns</button>
              <button class:active={tab === 'clips'} onclick={() => (tab = 'clips')}>Clips</button>
              <button class:active={tab === 'snapshots'} onclick={() => (tab = 'snapshots')}>Snapshots</button>
            </div>
            {#if tab !== 'snapshots'}
              <div class="seg small">
                <button class:active={deck === 'A'} onclick={() => (deck = 'A')}>A</button>
                <button class:active={deck === 'B'} onclick={() => (deck = 'B')}>B</button>
              </div>
            {/if}
          </div>
          <div class="palette-list">
            {#each palette as item (item.key)}
              <button
                class="visual"
                class:armed={!!selected}
                draggable="true"
                ondragstart={(e) => onDragStart(e, item)}
                onclick={() => pickPaletteItem(item)}
                title={selected ? `Link to ${selectedLabel}` : 'Drag onto a scene or clip'}
              >
                {#if item.thumbnail}
                  <img src={item.thumbnail} alt="" />
                {:else}
                  <span class="thumb-blank"></span>
                {/if}
                <span class="visual-text">
                  <span class="visual-label">{item.label}</span>
                  <span class="visual-hint">{item.hint}</span>
                </span>
              </button>
            {:else}
              <p class="hint">{tab === 'snapshots' ? 'No snapshots saved yet.' : 'No clips on this deck yet.'}</p>
            {/each}
          </div>
        </section>
      </aside>
    </div>
  {/if}
</div>

<style>
  .ab-root {
    position: fixed;
    inset: 0;
    z-index: 1200;
    display: flex;
    flex-direction: column;
    background: #05070b;
    color: var(--ga-ink-0, #eef0f4);
    font-family: var(--ga-font-ui, Inter, system-ui, sans-serif);
    font-size: 12px;
  }
  /* With the native presenter, only the preview box is left unpainted. */
  .ab-root.see-through { background: transparent; }
  .ab-root.see-through .ab-top,
  .ab-root.see-through .ab-grid-wrap,
  .ab-root.see-through .ab-links,
  .ab-root.see-through .ab-palette { background: #05070b; }
  .ab-top {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    -webkit-app-region: no-drag;
  }
  .ab-brand { font-weight: 600; letter-spacing: 0.12em; font-size: 12px; }
  .ab-brand b { color: var(--ga-coral, #ff6b4a); margin-left: 4px; font-weight: 600; }
  .ab-status { display: flex; align-items: center; gap: 6px; color: var(--ga-ink-2, #8a909b); }
  .ab-status .dot { width: 7px; height: 7px; border-radius: 50%; background: #6b7280; }
  .ab-status.on { color: var(--ga-ink-0, #eef0f4); }
  .ab-status.on .dot { background: var(--ga-live, #46d18a); }
  .ab-chip {
    padding: 3px 8px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #b8bdc6);
    font-family: var(--ga-font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
  }
  .ab-spacer { flex: 1; }
  .ab-btn {
    height: 28px;
    padding: 0 10px;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18));
    color: var(--ga-ink-1, #b8bdc6);
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .ab-btn:hover:not(:disabled) { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.32); background: rgba(255, 255, 255, 0.05); }
  .ab-btn:disabled { opacity: 0.4; cursor: default; }
  .ab-btn.primary { border-color: color-mix(in srgb, var(--ga-coral, #ff6b4a) 70%, transparent); color: var(--ga-ink-0, #eef0f4); }
  .ab-icon {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18));
    color: var(--ga-ink-1, #b8bdc6);
    cursor: pointer;
    flex: 0 0 auto;
  }
  .ab-icon:hover { color: var(--ga-ink-0, #eef0f4); background: rgba(255, 255, 255, 0.06); }
  .ab-icon.small { width: 22px; height: 22px; }

  .ab-setup { max-width: 560px; margin: 8vh auto 0; padding: 0 20px; }
  .ab-setup h2 { font-size: 18px; font-weight: 600; margin: 0 0 18px; }
  .ab-setup ol { list-style: none; margin: 0; padding: 0; counter-reset: step; }
  .ab-setup li {
    position: relative;
    padding: 14px 16px 14px 48px;
    margin-bottom: 10px;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: rgba(255, 255, 255, 0.02);
    counter-increment: step;
  }
  .ab-setup li::before {
    content: counter(step);
    position: absolute;
    left: 16px;
    top: 14px;
    width: 20px;
    height: 20px;
    border: 1px solid var(--ga-line-3, rgba(255, 255, 255, 0.3));
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
  }
  .ab-setup li.done::before { content: '✓'; border-color: var(--ga-live, #46d18a); color: var(--ga-live, #46d18a); }
  .step-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; }
  .ab-setup p { margin: 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .step-actions { display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap; }
  .note { margin-top: 8px !important; font-size: 11px; color: var(--ga-ink-2, #8a909b) !important; word-break: break-all; }
  .note.error { color: #ff7a6b !important; }

  .ab-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; }
  .ab-grid-wrap { overflow: auto; padding: 12px; }
  .ab-empty { color: var(--ga-ink-2, #8a909b); padding: 40px; text-align: center; }
  .ab-grid { display: grid; gap: 3px; width: max-content; }
  .corner, .track-head {
    position: sticky;
    top: 0;
    z-index: 2;
    background: #05070b;
    padding: 6px 8px;
    color: var(--ga-ink-1, #b8bdc6);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .corner { left: 0; z-index: 3; color: var(--ga-ink-2, #8a909b); }
  .track-head { border-top: 2px solid var(--live); }
  .cell {
    position: relative;
    min-height: 44px;
    padding: 6px 8px 6px 26px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: color-mix(in srgb, var(--live, #888) 16%, #0b0d11);
    border-left: 3px solid var(--live, #888);
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 3px;
    cursor: pointer;
    outline: none;
    min-width: 0;
  }
  .cell.empty { background: rgba(255, 255, 255, 0.015); border-left-color: transparent; cursor: default; }
  .cell.scene { position: sticky; left: 0; z-index: 1; background: color-mix(in srgb, var(--live, #888) 10%, #10131a); }
  .cell:hover:not(.empty) { border-color: rgba(255, 255, 255, 0.22); border-left-color: var(--live, #888); }
  .cell.selected { box-shadow: inset 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  .cell.drop { box-shadow: inset 0 0 0 2px var(--ga-coral, #ff6b4a); }
  .cell.playing { box-shadow: inset 0 0 0 2px var(--ga-live, #46d18a); }
  .cell.queued { animation: queued 0.5s steps(2) infinite; }
  @keyframes queued { 50% { box-shadow: inset 0 0 0 2px #e0a33a; } }
  .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .launch {
    position: absolute;
    left: 5px;
    top: 50%;
    transform: translateY(-50%);
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--ga-ink-2, #8a909b);
    cursor: pointer;
  }
  .launch:hover { color: var(--ga-ink-0, #eef0f4); }
  .cell.playing .launch { color: var(--ga-live, #46d18a); }
  .badge {
    align-self: flex-start;
    max-width: 100%;
    padding: 1px 5px;
    font-size: 10px;
    color: #c9c4ff;
    background: rgba(127, 119, 221, 0.22);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge.fired { animation: fired 0.6s ease-out; }
  @keyframes fired { from { background: rgba(127, 119, 221, 0.95); color: #fff; } }

  .ab-side { border-left: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); display: flex; flex-direction: column; min-height: 0; }
  .ab-preview {
    flex: 0 0 auto;
    aspect-ratio: 16 / 9;
    margin: 12px 12px 0;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    background: #000;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--ga-ink-2, #8a909b);
  }
  .ab-preview.hole { background: transparent; }
  .ab-links { padding: 12px; border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
  .side-title { font-weight: 600; font-size: 13px; margin-bottom: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { margin: 0; color: var(--ga-ink-2, #8a909b); line-height: 1.5; }
  .hint.warn { margin-top: 8px; color: #e0a33a; }
  .link-row { display: flex; align-items: center; gap: 6px; padding: 5px 0; border-top: 1px solid rgba(255, 255, 255, 0.06); }
  .link-row.missing .link-label { color: #e0a33a; }
  .link-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .ab-palette { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .palette-head { display: flex; gap: 8px; padding: 10px 12px; }
  .seg { display: flex; border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.18)); }
  .seg button {
    padding: 4px 9px;
    background: transparent;
    border: none;
    color: var(--ga-ink-2, #8a909b);
    font: inherit;
    cursor: pointer;
  }
  .seg button.active { background: rgba(255, 255, 255, 0.1); color: var(--ga-ink-0, #eef0f4); }
  .palette-list { flex: 1; overflow: auto; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 4px; }
  .visual {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: grab;
  }
  .visual:hover { border-color: rgba(255, 255, 255, 0.24); }
  .visual.armed:hover { border-color: var(--ga-coral, #ff6b4a); cursor: pointer; }
  .visual img, .thumb-blank { width: 44px; height: 26px; object-fit: cover; flex: 0 0 auto; background: rgba(255, 255, 255, 0.05); }
  .visual-text { display: flex; flex-direction: column; min-width: 0; }
  .visual-label, .visual-hint { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .visual-hint { color: var(--ga-ink-2, #8a909b); font-size: 11px; }
</style>
