<script lang="ts">
  /**
   * Ableton tray — the Live session grid, mirrored over the VJ deck area so
   * the main output stays in view. Live's clips and scenes show the visuals
   * they launch; drop a column, clip or snapshot onto any of them to link
   * it. Live's transport, launch countdowns and clip playheads run here too,
   * so the set can be driven from Ghost Arcade.
   */
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { abletonBridge, songBeat } from '../../ableton/abletonBridge';
  import {
    barBeat,
    launchBeat,
    linksForClip,
    linksForScene,
    liveColor,
    quantizeBeats,
    quantizeLabel,
    samePlace,
    type AbletonLink,
    type AbletonSource,
    type VisualAction,
  } from '../../ableton/abletonLinks';
  import { vjClipLauncher, type VJClip, type VJDeck } from '../../stores/vjClipLauncher';
  import { snapshots, type Snapshot } from '../../stores/snapshots';

  export let onClose: () => void;

  type ShelfTab = 'columns' | 'clips' | 'snapshots';
  type View = 'session' | 'links';
  interface ShelfItem { key: string; label: string; hint: string; thumbnail?: string; action: VisualAction }

  let view: View = 'session';
  let deck: VJDeck = 'A';
  let tab: ShelfTab = 'columns';
  let selected: AbletonSource | null = null;
  let dropTarget: string | null = null;
  let mapMenuOpen = false;
  /** "Clear all links" asks again inline rather than with a blocking dialog. */
  let confirmClear = false;
  let installMessage = '';
  let now = performance.now();
  let frame = 0;

  $: bridge = $abletonBridge;
  $: grid = deck === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
  $: shelf = buildShelf(tab, deck, grid, $vjClipLauncher.numColumns, $snapshots.snapshots);
  $: selectedLinks = selected ? bridge.links.filter(l => samePlace(l.source, selected!)) : [];
  $: scriptReady = !!bridge.script?.installed && !!bridge.script?.current;
  $: beat = songBeat(bridge, now);
  $: step = quantizeBeats(bridge.quantize, bridge.numerator, bridge.denominator);
  $: latest = bridge.activity[0];

  onMount(() => {
    void abletonBridge.enable();
    void abletonBridge.refreshScript();
    const tick = () => { now = performance.now(); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
  });
  onDestroy(() => cancelAnimationFrame(frame));

  // ── Labels and thumbnails ─────────────────────────────────────────────

  function gridFor(d: VJDeck) {
    return d === 'B' ? $vjClipLauncher.bankBClipGrid : $vjClipLauncher.clipGrid;
  }

  function actionThumb(action: VisualAction): string | undefined {
    if (action.kind === 'snapshot') return undefined;
    const g = gridFor(action.deck);
    if (action.kind === 'clip') return g[action.layer]?.[action.column]?.thumbnail;
    return g.map(row => row?.[action.column]).find(c => c?.thumbnail)?.thumbnail;
  }

  function actionLabel(action: VisualAction): string {
    if (action.kind === 'snapshot') {
      const snap = $snapshots.snapshots[action.slot];
      return snap?.capturedAt ? snap.name || `Snapshot ${action.slot + 1}` : `Snapshot ${action.slot + 1} (empty)`;
    }
    const deckSuffix = action.deck === 'B' ? ' · B' : '';
    if (action.kind === 'column') return `Column ${action.column + 1}${deckSuffix}`;
    return `${gridFor(action.deck)[action.layer]?.[action.column]?.name ?? 'Empty slot'}${deckSuffix}`;
  }

  function actionHint(action: VisualAction): string {
    if (action.kind === 'snapshot') return `Snapshot slot ${action.slot + 1}`;
    if (action.kind === 'column') return 'Whole column';
    return `Layer ${action.layer + 1} · Column ${action.column + 1}`;
  }

  function sourceLabel(source: AbletonSource): string {
    if (source.kind === 'scene') return source.name || `Scene ${source.scene + 1}`;
    return `${source.trackName || `Track ${source.track + 1}`} · ${source.name || `Clip ${source.slot + 1}`}`;
  }

  function sourceColor(source: AbletonSource): string {
    if (source.kind === 'scene') return liveColor(bridge.scenes[source.scene]?.color ?? 0x888888);
    return liveColor(bridge.tracks[source.track]?.slots[source.slot]?.color ?? 0x888888);
  }

  function buildShelf(kind: ShelfTab, d: VJDeck, clipGrid: (VJClip | null)[][], columns: number, snaps: Snapshot[]): ShelfItem[] {
    if (kind === 'snapshots') {
      return snaps.flatMap((snap, slot) => snap.capturedAt ? [{
        key: `snap-${slot}`, label: snap.name || `Snapshot ${slot + 1}`, hint: `Slot ${slot + 1}`,
        action: { kind: 'snapshot', slot } as VisualAction,
      }] : []);
    }
    if (kind === 'columns') {
      return Array.from({ length: columns }, (_, column) => {
        const clips = clipGrid.map(row => row?.[column]).filter(Boolean) as VJClip[];
        return {
          key: `col-${d}-${column}`, label: `Column ${column + 1}`,
          hint: clips.length ? clips.map(c => c.name).join(', ') : 'Empty',
          thumbnail: clips.find(c => c.thumbnail)?.thumbnail,
          action: { kind: 'column', deck: d, column } as VisualAction,
        };
      });
    }
    return clipGrid.flatMap((row, layer) => (row ?? []).flatMap((clip, column) => clip ? [{
      key: `clip-${d}-${layer}-${column}`, label: clip.name, hint: `L${layer + 1} · C${column + 1}`,
      thumbnail: clip.thumbnail,
      action: { kind: 'clip', deck: d, layer, column } as VisualAction,
    }] : []));
  }

  // ── Timing ────────────────────────────────────────────────────────────

  /** Fraction through the playing clip's loop. */
  function progress(track: number, slot: number, at: number): number {
    const t = bridge.tracks[track];
    const length = t?.slots[slot]?.length || 4;
    if (!bridge.playing || !t) return 0;
    const elapsed = Math.max(0, at - t.startedBeat);
    return (elapsed % length) / length;
  }

  /** Beats until something fired at `firedBeat` launches. */
  function countdown(firedBeat: number, at: number): string {
    const left = launchBeat(firedBeat, step) - at;
    if (!bridge.playing || left <= 0) return '';
    return left >= 1 ? String(Math.ceil(left)) : '•';
  }

  function recent(links: AbletonLink[], at: number): boolean {
    return links.some(l => at - (bridge.fired[l.id] ?? -1e9) < 450);
  }

  // ── Linking ───────────────────────────────────────────────────────────

  function sceneSource(scene: number): AbletonSource {
    return { kind: 'scene', scene, name: bridge.scenes[scene]?.name ?? '' };
  }

  function clipSource(track: number, slot: number): AbletonSource {
    const t = bridge.tracks[track];
    return { kind: 'clip', track, slot, trackName: t?.name ?? '', name: t?.slots[slot]?.name ?? '' };
  }

  function cellKey(source: AbletonSource) {
    return source.kind === 'scene' ? `s${source.scene}` : `c${source.track}-${source.slot}`;
  }

  function select(source: AbletonSource) {
    selected = selected && samePlace(selected, source) ? null : source;
  }

  function link(source: AbletonSource, action: VisualAction) {
    abletonBridge.addLink(source, action);
    selected = source;
  }

  function onDragStart(event: DragEvent, action: VisualAction) {
    event.dataTransfer?.setData('application/x-ghost-visual', JSON.stringify(action));
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
    try { link(source, JSON.parse(raw) as VisualAction); } catch { /* not ours */ }
  }

  function autoMap(kind: 'scenes' | 'tracks' | 'clear') {
    if (kind === 'clear') {
      if (!confirmClear) { confirmClear = true; return; }
      for (const l of bridge.links) abletonBridge.removeLink(l.id);
    }
    mapMenuOpen = false;
    confirmClear = false;
    if (kind === 'clear') return;
    if (kind === 'scenes') abletonBridge.linkScenesToColumns(deck);
    else abletonBridge.linkTracksToLayers(deck);
  }

  async function install(chooseFolder = false) {
    installMessage = '';
    const result = await abletonBridge.installScript(chooseFolder);
    if (!result || result.canceled) return;
    installMessage = result.ok ? `Installed to ${result.path}` : `Couldn't install: ${result.error}`;
  }

  function age(at: number, t: number): string {
    const s = Math.round((t - at) / 1000);
    return s < 2 ? 'now' : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (mapMenuOpen) { mapMenuOpen = false; confirmClear = false; }
    else if (selected) selected = null;
    else onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section class="tray" transition:fly={{ y: 24, duration: 180 }} aria-label="Ableton Live">
  <header class="bar">
    <div class="brand" class:on={bridge.connected} title={bridge.connected ? 'Live connected' : bridge.error ?? 'Waiting for Live'}>
      <span class="dot"></span>LIVE
    </div>

    {#if bridge.connected}
      <div class="transport">
        <button class="tp" class:active={bridge.playing} onclick={() => abletonBridge.play()} title="Play Live" aria-label="Play Live">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 1.5 10.5 6l-8 4.5z" fill="currentColor"/></svg>
        </button>
        <button class="tp" onclick={() => abletonBridge.stop()} title="Stop Live" aria-label="Stop Live">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="2.5" width="7" height="7" fill="currentColor"/></svg>
        </button>
        <div class="position" class:playing={bridge.playing}>{barBeat(beat, bridge.numerator, bridge.denominator)}</div>
        <div class="meta">{Math.round(bridge.tempo * 10) / 10}<small>BPM</small></div>
        <div class="meta">{bridge.numerator}/{bridge.denominator}</div>
        <div class="meta" title="Live's launch quantization — linked visuals land on the same step">Q {quantizeLabel(bridge.quantize)}</div>
      </div>

      <div class="views" role="tablist">
        <button role="tab" aria-selected={view === 'session'} class:active={view === 'session'} onclick={() => (view = 'session')}>Session</button>
        <button role="tab" aria-selected={view === 'links'} class:active={view === 'links'} onclick={() => (view = 'links')}>Links <span class="count">{bridge.links.length}</span></button>
      </div>

      <div class="map">
        <button class="ghost" onclick={() => { mapMenuOpen = !mapMenuOpen; confirmClear = false; }} aria-expanded={mapMenuOpen}>Auto-map ▾</button>
        {#if mapMenuOpen}
          <div class="menu" role="menu">
            <button role="menuitem" onclick={() => autoMap('scenes')}><b>Scenes → columns</b><span>Scene 1 fires column 1, and so on</span></button>
            <button role="menuitem" onclick={() => autoMap('tracks')}><b>Tracks → layers</b><span>Live's grid drives the VJ grid cell for cell</span></button>
            <button role="menuitem" class="danger" disabled={!bridge.links.length} onclick={() => autoMap('clear')}>
              <b>{confirmClear ? `Click again to remove ${bridge.links.length} links` : 'Clear all links'}</b>
            </button>
          </div>
        {/if}
      </div>

      <div class="activity" class:fresh={latest && now - latest.at < 1500}>
        {#if latest}
          <span class="pulse"></span>{latest.text}<em>{age(latest.at, now)}</em>
        {:else}
          <span class="idle">Launch something in Live</span>
        {/if}
      </div>
    {:else}
      <div class="spacer"></div>
    {/if}

    <button class="close" onclick={onClose} title="Back to the decks" aria-label="Close Ableton tray">
      <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M2 2l8 8M10 2 2 10"/></svg>
    </button>
  </header>

  {#if !bridge.connected}
    <div class="setup">
      <div class="step" class:done={scriptReady}>
        <span class="num">1</span>
        <div>
          <b>Install the Live script</b>
          <p>A small control surface in your Ableton User Library.</p>
          <div class="row">
            <button class="solid" onclick={() => install(false)}>
              {bridge.script?.installed ? (bridge.script.current ? 'Reinstall' : 'Update script') : 'Install script'}
            </button>
            <button class="ghost" onclick={() => install(true)}>Choose folder…</button>
            {#if bridge.script?.installed}<button class="ghost" onclick={() => abletonBridge.revealScript()}>Show</button>{/if}
          </div>
          {#if installMessage}<p class="note">{installMessage}</p>{/if}
        </div>
      </div>
      <div class="step">
        <span class="num">2</span>
        <div>
          <b>Turn it on in Live</b>
          <p>Restart Live. In Preferences (Settings in Live 12) → Link / MIDI, set a Control Surface to <b>GhostArcade</b>.</p>
        </div>
      </div>
      <div class="step" class:done={bridge.connected}>
        <span class="num">3</span>
        <div>
          <b>{bridge.listening ? 'Waiting for Live…' : 'Starting…'}</b>
          <p>Your session grid appears here the moment Live says hello.</p>
          {#if bridge.error}<p class="note error">{bridge.error}</p>{/if}
        </div>
      </div>
    </div>
  {:else}
    <div class="body">
      {#if view === 'session'}
        <div class="session">
          {#if !bridge.tracks.length}
            <div class="empty">This Live set has no tracks yet.</div>
          {:else}
            <div class="grid" style="--tracks: {bridge.tracks.length}">
              <div class="corner">
                <button class="tp small" onclick={() => abletonBridge.stopAllClips()} title="Stop all clips in Live" aria-label="Stop all clips">
                  <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>
                </button>
                Scenes
              </div>
              {#each bridge.tracks as track, t}
                <div class="track-head" style="--live: {liveColor(track.color)}">
                  <span class="track-name" title={track.name}>{track.name || `Track ${t + 1}`}</span>
                  <button class="tp small" onclick={() => abletonBridge.stopTrack(t)} title="Stop {track.name}" aria-label="Stop {track.name}">
                    <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>
                  </button>
                </div>
              {/each}

              {#each bridge.scenes as scene, s}
                {@const source = sceneSource(s)}
                {@const links = linksForScene(bridge.links, s)}
                {@const firing = bridge.tracks.some(tr => tr.fired === s)}
                <div
                  class="cell scene"
                  class:selected={selected && samePlace(source, selected)}
                  class:queued={scene.queued || firing}
                  class:drop={dropTarget === cellKey(source)}
                  class:flash={recent(links, now)}
                  style="--live: {liveColor(scene.color || 0x5f5e5a)}"
                  role="button"
                  tabindex="0"
                  onclick={() => select(source)}
                  onkeydown={(e) => e.key === 'Enter' && select(source)}
                  ondragover={(e) => onDragOver(e, source)}
                  ondragleave={() => (dropTarget = null)}
                  ondrop={(e) => onDrop(e, source)}
                >
                  <button class="launch" onclick={(e) => { e.stopPropagation(); abletonBridge.launchScene(s); }} title="Launch scene in Live" aria-label="Launch scene in Live">
                    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                  </button>
                  <span class="name">{scene.name || `Scene ${s + 1}`}</span>
                  {#if (scene.queued || firing) && countdown(bridge.tracks.find(tr => tr.fired === s)?.firedBeat ?? beat, beat)}
                    <span class="countdown">{countdown(bridge.tracks.find(tr => tr.fired === s)?.firedBeat ?? beat, beat)}</span>
                  {/if}
                  {#if links.length}
                    <span class="visuals">
                      {#each links.slice(0, 3) as l (l.id)}
                        {@const thumb = actionThumb(l.action)}
                        <span class="vis" class:missing={bridge.missing.includes(l.id)} title={actionLabel(l.action)}>
                          {#if thumb}<img src={thumb} alt="" />{:else}<i>{l.action.kind === 'snapshot' ? `S${l.action.slot + 1}` : '·'}</i>{/if}
                        </span>
                      {/each}
                      {#if links.length > 3}<span class="more">+{links.length - 3}</span>{/if}
                    </span>
                  {/if}
                </div>

                {#each bridge.tracks as track, t}
                  {@const clip = track.slots[s]}
                  {#if clip}
                    {@const source = clipSource(t, s)}
                    {@const clipLinks = linksForClip(bridge.links, t, s)}
                    {@const playing = track.playing === s}
                    {@const queued = track.fired === s}
                    <div
                      class="cell clip"
                      class:selected={selected && samePlace(source, selected)}
                      class:playing
                      class:queued
                      class:drop={dropTarget === cellKey(source)}
                      class:flash={recent(clipLinks, now)}
                      style="--live: {liveColor(clip.color)}"
                      role="button"
                      tabindex="0"
                      onclick={() => select(source)}
                      onkeydown={(e) => e.key === 'Enter' && select(source)}
                      ondragover={(e) => onDragOver(e, source)}
                      ondragleave={() => (dropTarget = null)}
                      ondrop={(e) => onDrop(e, source)}
                    >
                      <button class="launch" onclick={(e) => { e.stopPropagation(); abletonBridge.launchClip(t, s); }} title="Launch clip in Live" aria-label="Launch clip in Live">
                        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                      </button>
                      <span class="name">{clip.name || 'Clip'}</span>
                      {#if queued && countdown(track.firedBeat, beat)}
                        <span class="countdown">{countdown(track.firedBeat, beat)}</span>
                      {/if}
                      {#if clipLinks.length}
                        <span class="visuals">
                          {#each clipLinks.slice(0, 2) as l (l.id)}
                            {@const thumb = actionThumb(l.action)}
                            <span class="vis" class:missing={bridge.missing.includes(l.id)} title={actionLabel(l.action)}>
                              {#if thumb}<img src={thumb} alt="" />{:else}<i>{l.action.kind === 'snapshot' ? `S${l.action.slot + 1}` : '·'}</i>{/if}
                            </span>
                          {/each}
                          {#if clipLinks.length > 2}<span class="more">+{clipLinks.length - 2}</span>{/if}
                        </span>
                      {/if}
                      {#if playing}<span class="playhead" style="transform: scaleX({progress(t, s, beat)})"></span>{/if}
                    </div>
                  {:else}
                    <div class="cell empty"></div>
                  {/if}
                {/each}
              {/each}
            </div>
          {/if}
        </div>
      {:else}
        <div class="links-view">
          {#if !bridge.links.length}
            <div class="empty">No links yet. Drag a visual onto a scene or clip, or try Auto-map.</div>
          {:else}
            {#each bridge.links as l (l.id)}
              {@const thumb = actionThumb(l.action)}
              <div class="link-line" class:missing={bridge.missing.includes(l.id)} class:flash={now - (bridge.fired[l.id] ?? -1e9) < 450}>
                <span class="swatch" style="background: {sourceColor(l.source)}"></span>
                <span class="from">{sourceLabel(l.source)}<small>{l.source.kind === 'scene' ? 'Scene' : 'Clip'}</small></span>
                <span class="arrow">→</span>
                <span class="to">
                  <span class="vis big">{#if thumb}<img src={thumb} alt="" />{:else}<i>{l.action.kind === 'snapshot' ? `S${l.action.slot + 1}` : '·'}</i>{/if}</span>
                  {actionLabel(l.action)}
                </span>
                {#if bridge.missing.includes(l.id)}<span class="warn">Not in this set</span>{/if}
                <button class="tp small" onclick={() => abletonBridge.preview(l)} title="Fire this visual now" aria-label="Fire this visual now">
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                </button>
                <button class="tp small" onclick={() => abletonBridge.removeLink(l.id)} title="Remove link" aria-label="Remove link">
                  <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
                </button>
              </div>
            {/each}
          {/if}
        </div>
      {/if}

      <aside class="side">
        {#if selected}
          <div class="inspect" style="--live: {sourceColor(selected)}">
            <div class="inspect-head">
              <span class="kind">{selected.kind === 'scene' ? 'Scene' : 'Clip'}</span>
              <span class="title">{sourceLabel(selected)}</span>
              <button class="tp small" onclick={() => (selected = null)} aria-label="Deselect">
                <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
              </button>
            </div>
            {#each selectedLinks as l (l.id)}
              {@const thumb = actionThumb(l.action)}
              <div class="linked" class:missing={bridge.missing.includes(l.id)}>
                <span class="vis big">{#if thumb}<img src={thumb} alt="" />{:else}<i>{l.action.kind === 'snapshot' ? `S${l.action.slot + 1}` : '·'}</i>{/if}</span>
                <span class="linked-text"><b>{actionLabel(l.action)}</b><small>{actionHint(l.action)}</small></span>
                <button class="tp small" onclick={() => abletonBridge.preview(l)} title="Fire now" aria-label="Fire this visual now">
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                </button>
                <button class="tp small" onclick={() => abletonBridge.removeLink(l.id)} title="Remove link" aria-label="Remove link">
                  <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
                </button>
              </div>
            {:else}
              <p class="hint">Pick a visual below to fire with this {selected.kind}.</p>
            {/each}
          </div>
        {/if}

        <div class="shelf">
          <div class="shelf-head">
            <div class="seg">
              <button class:active={tab === 'columns'} onclick={() => (tab = 'columns')}>Columns</button>
              <button class:active={tab === 'clips'} onclick={() => (tab = 'clips')}>Clips</button>
              <button class:active={tab === 'snapshots'} onclick={() => (tab = 'snapshots')}>Snaps</button>
            </div>
            {#if tab !== 'snapshots'}
              <div class="seg">
                <button class:active={deck === 'A'} onclick={() => (deck = 'A')}>A</button>
                <button class:active={deck === 'B'} onclick={() => (deck = 'B')}>B</button>
              </div>
            {/if}
          </div>
          {#if !selected}<p class="hint">Drag onto a scene or clip.</p>{/if}
          <div class="shelf-grid">
            {#each shelf as item (item.key)}
              <button
                class="tile"
                class:armed={!!selected}
                draggable="true"
                ondragstart={(e) => onDragStart(e, item.action)}
                onclick={() => selected && link(selected, item.action)}
                title={selected ? `Link to ${sourceLabel(selected)}` : `${item.label} — ${item.hint}`}
              >
                <span class="tile-thumb">{#if item.thumbnail}<img src={item.thumbnail} alt="" />{:else}<i>{item.action.kind === 'snapshot' ? `S${item.action.slot + 1}` : ''}</i>{/if}</span>
                <span class="tile-label">{item.label}</span>
              </button>
            {:else}
              <p class="hint">{tab === 'snapshots' ? 'Save a snapshot from SNAPS first.' : 'No clips on this deck yet.'}</p>
            {/each}
          </div>
        </div>
      </aside>
    </div>
  {/if}
</section>

<style>
  .tray {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: #07090d;
    border-top: 1px solid color-mix(in srgb, var(--ga-live, #46d18a) 35%, transparent);
    color: var(--ga-ink-0, #eef0f4);
    font-family: var(--ga-font-ui, Inter, system-ui, sans-serif);
    font-size: 12px;
    min-height: 0;
  }

  /* ── Top bar ── */
  .bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.07);
    flex: 0 0 auto;
  }
  .brand { display: flex; align-items: center; gap: 6px; font-weight: 700; letter-spacing: 0.14em; font-size: 11px; color: var(--ga-ink-2, #8a909b); }
  .brand .dot { width: 7px; height: 7px; border-radius: 50%; background: #555; }
  .brand.on { color: var(--ga-ink-0, #eef0f4); }
  .brand.on .dot { background: var(--ga-live, #46d18a); box-shadow: 0 0 8px var(--ga-live, #46d18a); }
  .transport { display: flex; align-items: center; gap: 6px; }
  .tp {
    width: 28px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: var(--ga-ink-1, #b8bdc6);
    cursor: pointer;
    flex: 0 0 auto;
    padding: 0;
  }
  .tp:hover { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.25); }
  .tp.active { color: var(--ga-live, #46d18a); border-color: color-mix(in srgb, var(--ga-live, #46d18a) 55%, transparent); background: color-mix(in srgb, var(--ga-live, #46d18a) 12%, transparent); }
  .tp.small { width: 20px; height: 20px; }
  .position {
    min-width: 64px;
    padding: 0 8px;
    height: 26px;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--ga-font-mono, 'JetBrains Mono', monospace);
    font-size: 15px;
    font-weight: 600;
    background: #000;
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: var(--ga-ink-2, #8a909b);
  }
  .position.playing { color: var(--ga-ink-0, #eef0f4); }
  .meta { font-family: var(--ga-font-mono, 'JetBrains Mono', monospace); font-size: 11px; color: var(--ga-ink-1, #b8bdc6); white-space: nowrap; }
  .meta small { font-size: 9px; margin-left: 3px; color: var(--ga-ink-2, #8a909b); }
  .views { display: flex; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px; margin-left: 6px; }
  .views button, .seg button {
    padding: 4px 10px;
    background: transparent;
    border: none;
    color: var(--ga-ink-2, #8a909b);
    font: inherit;
    cursor: pointer;
  }
  .views button.active, .seg button.active { background: rgba(255, 255, 255, 0.1); color: var(--ga-ink-0, #eef0f4); }
  .count { font-size: 10px; color: var(--ga-ink-2, #8a909b); margin-left: 3px; }
  .map { position: relative; }
  .ghost, .solid {
    height: 26px;
    padding: 0 10px;
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
    white-space: nowrap;
  }
  .ghost { background: transparent; border: 1px solid rgba(255, 255, 255, 0.12); color: var(--ga-ink-1, #b8bdc6); }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); border-color: rgba(255, 255, 255, 0.28); }
  .solid { background: var(--ga-ink-0, #eef0f4); border: 1px solid transparent; color: #07090d; font-weight: 600; }
  .menu {
    position: absolute;
    top: 30px;
    left: 0;
    z-index: 5;
    width: 260px;
    padding: 4px;
    background: #11141a;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
  .menu button {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    width: 100%;
    padding: 7px 9px;
    background: transparent; border: none; border-radius: 3px;
    color: var(--ga-ink-0, #eef0f4);
    font: inherit; text-align: left; cursor: pointer;
  }
  .menu button:hover { background: rgba(255, 255, 255, 0.07); }
  .menu b { font-weight: 600; }
  .menu span { color: var(--ga-ink-2, #8a909b); font-size: 11px; }
  .menu .danger b { color: #ff8a7a; }
  .menu button:disabled { opacity: 0.4; cursor: default; }
  .activity {
    flex: 1;
    min-width: 0;
    display: flex; align-items: center; justify-content: flex-end; gap: 7px;
    color: var(--ga-ink-1, #b8bdc6);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .activity em { font-style: normal; color: var(--ga-ink-2, #8a909b); font-size: 11px; }
  .activity .pulse { width: 6px; height: 6px; border-radius: 50%; background: #7f77dd; flex: 0 0 auto; }
  .activity.fresh { color: var(--ga-ink-0, #eef0f4); }
  .activity.fresh .pulse { background: #c9c4ff; box-shadow: 0 0 10px #7f77dd; }
  .activity .idle { color: var(--ga-ink-2, #8a909b); }
  .spacer { flex: 1; }
  .close { width: 26px; height: 26px; display: inline-flex; align-items: center; justify-content: center; background: transparent; border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 3px; color: var(--ga-ink-1, #b8bdc6); cursor: pointer; }
  .close:hover { color: var(--ga-ink-0, #eef0f4); }

  /* ── Setup ── */
  .setup { flex: 1; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 16px; align-content: start; }
  .step { display: flex; gap: 12px; padding: 14px; border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; background: rgba(255, 255, 255, 0.02); }
  .step .num { width: 22px; height: 22px; flex: 0 0 auto; border-radius: 50%; border: 1px solid rgba(255, 255, 255, 0.25); display: flex; align-items: center; justify-content: center; font-size: 11px; }
  .step.done .num { border-color: var(--ga-live, #46d18a); color: var(--ga-live, #46d18a); }
  .step b { font-weight: 600; }
  .step p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .step .row { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
  .note { font-size: 11px; color: var(--ga-ink-2, #8a909b) !important; word-break: break-all; }
  .note.error { color: #ff7a6b !important; }

  /* ── Body ── */
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 290px; }
  .session, .links-view { overflow: auto; padding: 8px 10px 12px; min-width: 0; }
  .empty { padding: 32px; text-align: center; color: var(--ga-ink-2, #8a909b); }
  .grid {
    display: grid;
    grid-template-columns: 136px repeat(var(--tracks), minmax(112px, 1fr));
    gap: 3px;
    min-width: max-content;
  }
  .corner, .track-head {
    position: sticky; top: 0; z-index: 2;
    background: #07090d;
    display: flex; align-items: center; gap: 6px;
    padding: 4px 6px;
    color: var(--ga-ink-2, #8a909b);
    font-size: 11px;
  }
  .corner { left: 0; z-index: 3; }
  .track-head { color: var(--ga-ink-1, #b8bdc6); border-top: 2px solid var(--live); justify-content: space-between; }
  .track-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell {
    position: relative;
    display: flex; align-items: center; gap: 6px;
    min-height: 40px;
    padding: 4px 6px 4px 4px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--live, #888) 14%, #0c0f14);
    border: 1px solid rgba(255, 255, 255, 0.05);
    border-left: 3px solid var(--live, #888);
    cursor: pointer;
    outline: none;
    overflow: hidden;
    min-width: 0;
    transition: background 0.15s;
  }
  .cell:hover:not(.empty) { background: color-mix(in srgb, var(--live, #888) 24%, #0c0f14); }
  .cell.empty { background: rgba(255, 255, 255, 0.015); border-left-color: transparent; cursor: default; }
  .cell.scene { position: sticky; left: 0; z-index: 1; background: color-mix(in srgb, var(--live, #888) 12%, #11141b); }
  .cell.selected { box-shadow: inset 0 0 0 1px var(--ga-ink-0, #eef0f4); }
  .cell.drop { box-shadow: inset 0 0 0 2px #c9c4ff; background: color-mix(in srgb, #7f77dd 30%, #0c0f14); }
  .cell.playing { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-live, #46d18a) 80%, transparent); }
  .cell.queued { animation: queued 0.5s steps(2) infinite; }
  .cell.flash::after { content: ''; position: absolute; inset: 0; background: #c9c4ff; opacity: 0; animation: flash 0.45s ease-out; pointer-events: none; }
  @keyframes queued { 50% { box-shadow: inset 0 0 0 1px #e0a33a; background: color-mix(in srgb, #e0a33a 18%, #0c0f14); } }
  @keyframes flash { from { opacity: 0.45; } to { opacity: 0; } }
  .launch {
    width: 18px; height: 18px; flex: 0 0 auto;
    display: flex; align-items: center; justify-content: center;
    padding: 0; border: none; background: transparent;
    color: var(--ga-ink-2, #8a909b);
    cursor: pointer;
  }
  .launch:hover { color: var(--ga-ink-0, #eef0f4); }
  .cell.playing .launch { color: var(--ga-live, #46d18a); }
  .name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .countdown {
    flex: 0 0 auto;
    min-width: 18px; height: 18px;
    padding: 0 5px;
    border-radius: 9px;
    background: #e0a33a;
    color: #1a1204;
    font-size: 10px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--ga-font-mono, 'JetBrains Mono', monospace);
  }
  .visuals { display: flex; gap: 3px; flex: 0 0 auto; align-items: center; }
  .vis {
    width: 38px; height: 22px;
    border-radius: 2px;
    overflow: hidden;
    background: #000;
    border: 1px solid rgba(201, 196, 255, 0.45);
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .vis img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .vis i { font-style: normal; font-size: 9px; font-weight: 700; color: #c9c4ff; }
  .vis.missing { border-color: #e0a33a; opacity: 0.6; }
  .vis.big { width: 52px; height: 30px; }
  .more { font-size: 10px; color: #c9c4ff; }
  .playhead {
    position: absolute; left: 0; right: 0; bottom: 0;
    height: 2px;
    background: var(--ga-live, #46d18a);
    transform-origin: left center;
  }

  /* ── Links view ── */
  .link-line {
    display: flex; align-items: center; gap: 10px;
    padding: 6px 8px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.05);
    position: relative;
  }
  .link-line.flash { background: rgba(127, 119, 221, 0.18); }
  .swatch { width: 4px; align-self: stretch; border-radius: 2px; }
  .from { width: 200px; display: flex; flex-direction: column; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .from small, .linked-text small { color: var(--ga-ink-2, #8a909b); font-size: 10px; }
  .arrow { color: var(--ga-ink-2, #8a909b); }
  .to { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .warn { color: #e0a33a; font-size: 11px; }

  /* ── Side: inspector + shelf ── */
  .side { border-left: 1px solid rgba(255, 255, 255, 0.07); display: flex; flex-direction: column; min-height: 0; }
  .inspect { padding: 10px; border-bottom: 1px solid rgba(255, 255, 255, 0.07); border-top: 2px solid var(--live); flex: 0 0 auto; max-height: 50%; overflow: auto; }
  .inspect-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .kind { font-size: 9px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ga-ink-2, #8a909b); }
  .title { flex: 1; min-width: 0; font-weight: 600; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .linked { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .linked.missing .linked-text b { color: #e0a33a; }
  .linked-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .linked-text b { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { margin: 0 0 6px; color: var(--ga-ink-2, #8a909b); line-height: 1.45; }
  .shelf { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8px 10px 10px; }
  .shelf-head { display: flex; gap: 6px; margin-bottom: 8px; }
  .seg { display: flex; border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 3px; }
  .seg button { padding: 3px 8px; }
  .shelf-grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; align-content: start; }
  .tile {
    display: flex; flex-direction: column; gap: 3px;
    padding: 3px;
    background: rgba(255, 255, 255, 0.02);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 3px;
    color: inherit; font: inherit; text-align: left;
    cursor: grab;
  }
  .tile:hover { border-color: rgba(255, 255, 255, 0.25); }
  .tile.armed:hover { border-color: #c9c4ff; cursor: pointer; }
  .tile-thumb { aspect-ratio: 16 / 9; background: #000; border-radius: 2px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .tile-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .tile-thumb i { font-style: normal; font-weight: 700; color: #c9c4ff; }
  .tile-label { font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 2px 1px; }
</style>
