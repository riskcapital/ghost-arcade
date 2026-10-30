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
  import { abletonBridge, scoreAction, setlist, songBeat, type AbletonBridgeState } from '../../ableton/abletonBridge';
  import { SCRAMBLE_EVERY, type ScrambleTarget } from '../../ableton/beatScramble';
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
  import { noteName, type SignalTarget } from '../../ableton/abletonScore';
  import { livePlatform, liveSetupWords } from '../../ableton/liveSetup';
  import {
    actionHint,
    actionLabel,
    actionTag,
    actionThumb,
    buildShelf,
    VISUAL_DRAG_TYPE,
    type ShelfTab,
    type VisualContext,
  } from '../../ableton/abletonVisuals';
  import { mediaPipeBus } from '../../mediapipe/mediaPipeBus';
  import { vjClipLauncher, type VJDeck } from '../../stores/vjClipLauncher';
  import { snapshots } from '../../stores/snapshots';
  import { stagePresets } from '../../stores/layers';
  import { globalStagePresets } from '../../stores/globalPresets';
  import AbletonScoreView from './AbletonScoreView.svelte';
  import AbletonArrangementView from './AbletonArrangementView.svelte';
  import AbletonSignalsView from './AbletonSignalsView.svelte';
  import AbletonDecksView from './AbletonDecksView.svelte';
  import AbletonSetlistView from './AbletonSetlistView.svelte';

  export let onClose: () => void;

  type View = 'setlist' | 'session' | 'decks' | 'score' | 'arrangement' | 'signals' | 'links';
  const VIEWS: { id: View; label: string }[] = [
    { id: 'setlist', label: 'Setlist' },
    { id: 'session', label: 'Session' },
    { id: 'decks', label: 'Decks' },
    { id: 'score', label: 'Score' },
    { id: 'arrangement', label: 'Arrangement' },
    { id: 'signals', label: 'Signals' },
    { id: 'links', label: 'Links' },
  ];

  let view: View = 'setlist';
  /** A score lane being edited, instead of a scene, clip or locator. */
  let selectedPitch: number | null = null;
  /** The tray steps aside while the user clicks a control to pick it. */
  let picking = false;
  let deck: VJDeck = 'A';
  let tab: ShelfTab = 'columns';
  let selected: AbletonSource | null = null;
  let dropTarget: string | null = null;
  let mapMenuOpen = false;
  let scrambleOpen = false;
  let mapEl: HTMLDivElement | undefined;
  const SCRAMBLE_TARGETS: { id: ScrambleTarget; label: string }[] = [
    { id: 'shader', label: 'Shader' },
    { id: 'fx', label: 'FX' },
    { id: 'both', label: 'Both' },
  ];
  const EVERY_LABELS: Record<number, string> = { 1: 'Beat', 2: '2 beats', 4: 'Bar', 8: '2 bars', 16: '4 bars' };
  /** The Ghost Arcade deck an auto-map fills. */
  let mapDeck: VJDeck = 'A';
  /** What the last auto-map did, shown briefly beside the button. */
  let mapMessage = '';
  let mapMessageTimer: ReturnType<typeof setTimeout> | undefined;
  /** "Clear all links" asks again inline rather than with a blocking dialog. */
  let confirmClear = false;
  let installMessage = '';
  let now = performance.now();
  let frame = 0;

  $: bridge = $abletonBridge;
  $: deckSet = bridge.tracks.some(t => t.side);
  $: sectioned = deckSet && setlist(bridge).some(song => song.sections.length > 1);
  $: ctx = {
    clipGrid: $vjClipLauncher.clipGrid,
    bankBClipGrid: $vjClipLauncher.bankBClipGrid,
    numColumns: $vjClipLauncher.numColumns,
    snapshots: $snapshots.snapshots,
    stagePresets: [
      ...$stagePresets.map(p => ({ id: p.id, name: p.name, thumbnail: p.thumbnail, scope: (p.scope || 'project') as 'project' | 'global' })),
      ...$globalStagePresets.map(p => ({ id: p.id, name: p.name, thumbnail: p.thumbnail, scope: 'global' as const })),
    ],
  } satisfies VisualContext;
  $: shelf = buildShelf(ctx, tab, deck);
  $: laneAction = selectedPitch === null ? null : scoreAction(bridge, selectedPitch, ctx.numColumns);
  $: selectedLinks = selected ? bridge.links.filter(l => samePlace(l.source, selected!)) : [];
  $: scriptReady = !!bridge.script?.installed && !!bridge.script?.current;
  // Where Live keeps the Control Surface setting, for this computer's OS and
  // the newest Live that has run here.
  $: liveWords = liveSetupWords(livePlatform(), bridge.script?.liveVersions);
  $: beat = songBeat(bridge, now);
  $: step = quantizeBeats(bridge.quantize, bridge.numerator, bridge.denominator);
  $: latest = bridge.activity[0];

  onMount(() => {
    void abletonBridge.enable();
    void abletonBridge.refreshScript();
    // Playheads and countdowns redraw at most 20 times a second, and only
    // while something moves, so the tray never competes with riding faders.
    const tick = (time: number) => {
      if (time - now >= 50 && moving($abletonBridge)) now = performance.now();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  });
  onDestroy(() => cancelAnimationFrame(frame));

  // ── Labels ────────────────────────────────────────────────────────────

  function sourceLabel(source: AbletonSource): string {
    if (source.kind === 'scene') return source.name || `Scene ${source.scene + 1}`;
    if (source.kind === 'locator') return source.name || `Locator ${source.index + 1}`;
    return `${source.trackName || `Track ${source.track + 1}`} · ${source.name || `Clip ${source.slot + 1}`}`;
  }

  function sourceKind(source: AbletonSource): string {
    return source.kind === 'scene' ? 'Scene' : source.kind === 'locator' ? 'Locator' : 'Clip';
  }

  // Helpers that read the set take it as an argument, so the template
  // re-renders when it changes.
  function sourceColor(state: AbletonBridgeState, source: AbletonSource): string {
    if (source.kind === 'scene') return liveColor(state.scenes[source.scene]?.color ?? 0x888888);
    if (source.kind === 'locator') return '#e0a33a';
    return liveColor(state.tracks[source.track]?.slots[source.slot]?.color ?? 0x888888);
  }

  // ── Timing ────────────────────────────────────────────────────────────

  /** Anything on screen that changes with time: playheads, countdowns,
   *  an auto-mix, or a launch flash or activity age still settling. */
  function moving(state: AbletonBridgeState): boolean {
    if (!state.connected) return false;
    const latestAt = state.activity[0]?.at ?? -Infinity;
    return state.playing || !!state.mix || performance.now() - latestAt < 60000
      || state.tracks.some(t => t.fired >= 0) || state.scenes.some(sc => sc.queued);
  }

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

  function sceneSource(state: AbletonBridgeState, scene: number): AbletonSource {
    return { kind: 'scene', scene, name: state.scenes[scene]?.name ?? '' };
  }

  function clipSource(state: AbletonBridgeState, track: number, slot: number): AbletonSource {
    const t = state.tracks[track];
    return { kind: 'clip', track, slot, trackName: t?.name ?? '', name: t?.slots[slot]?.name ?? '' };
  }

  function cellKey(source: AbletonSource) {
    if (source.kind === 'locator') return `l${source.index}`;
    return source.kind === 'scene' ? `s${source.scene}` : `c${source.track}-${source.slot}`;
  }

  function select(source: AbletonSource) {
    selectedPitch = null;
    selected = selected && samePlace(selected, source) ? null : source;
  }

  function selectLane(pitch: number) {
    selected = null;
    selectedPitch = selectedPitch === pitch ? null : pitch;
  }

  function link(source: AbletonSource, action: VisualAction) {
    abletonBridge.addLink(source, action);
    selectedPitch = null;
    selected = source;
  }

  function setLane(pitch: number, action: VisualAction | null) {
    abletonBridge.setScoreLane(pitch, action);
    selected = null;
    selectedPitch = pitch;
  }

  /** Give the shelf's pick to whatever is selected. */
  function assign(action: VisualAction) {
    if (selectedPitch !== null) setLane(selectedPitch, action);
    else if (selected) link(selected, action);
  }

  /** Step aside so the user can click any Ghost Arcade control. */
  async function pickTarget(): Promise<SignalTarget | null> {
    picking = true;
    try {
      const picked = await mediaPipeBus.pickTarget();
      if (!picked) return null;
      return { path: picked.path, label: picked.label || picked.path, min: picked.min ?? 0, max: picked.max ?? 1 };
    } finally {
      picking = false;
    }
  }

  /** Link a control hit (a strobe, a flash, a macro jump) to the selection. */
  async function pickControl() {
    const target = await pickTarget();
    if (target) assign({ kind: 'control', path: target.path, label: target.label, value: target.max, release: target.min });
  }

  function onDragStart(event: DragEvent, action: VisualAction) {
    event.dataTransfer?.setData(VISUAL_DRAG_TYPE, JSON.stringify(action));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'link';
  }

  function onDragOver(event: DragEvent, source: AbletonSource) {
    if (!event.dataTransfer?.types.includes(VISUAL_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'link';
    dropTarget = cellKey(source);
  }

  function onDrop(event: DragEvent, source: AbletonSource) {
    event.preventDefault();
    dropTarget = null;
    const raw = event.dataTransfer?.getData(VISUAL_DRAG_TYPE);
    if (!raw) return;
    try { link(source, JSON.parse(raw) as VisualAction); } catch { /* not ours */ }
  }

  function autoMap(kind: 'scenes' | 'tracks' | 'decks' | 'parts' | 'clear') {
    if (kind === 'clear') {
      if (!confirmClear) { confirmClear = true; return; }
      abletonBridge.clearLinks();
    }
    mapMenuOpen = false;
    confirmClear = false;
    let message = 'Cleared every link';
    if (kind === 'scenes') message = `Linked ${abletonBridge.linkScenesToColumns(mapDeck)} scenes to deck ${mapDeck} columns`;
    else if (kind === 'decks') message = `Linked ${abletonBridge.linkDecks()} songs to their decks' columns`;
    else if (kind === 'parts') message = `Gave ${abletonBridge.linkSections()} song parts a column each`;
    else if (kind === 'tracks') message = `Linked ${abletonBridge.linkTracksToLayers(mapDeck)} clips to deck ${mapDeck}`;
    mapMessage = message;
    clearTimeout(mapMessageTimer);
    mapMessageTimer = setTimeout(() => (mapMessage = ''), 4000);
  }

  async function install(chooseFolder = false) {
    installMessage = '';
    const result = await abletonBridge.installScript(chooseFolder);
    if (!result || result.canceled) return;
    // Live loads control surfaces at launch, so a new or updated script
    // needs Live restarted.
    installMessage = result.ok
      ? `Installed to ${result.path}${(result.paths?.length ?? 1) > 1 ? ` and ${result.paths!.length - 1} more` : ''}. Restart Live to load it.`
      : `Couldn't install: ${result.error}`;
  }

  function age(at: number, t: number): string {
    const s = Math.round((t - at) / 1000);
    return s < 2 ? 'now' : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
  }

  /** The Scramble and Auto-map menus close on a click anywhere else. */
  function onWindowPointerDown(event: PointerEvent) {
    if (!mapMenuOpen && !scrambleOpen) return;
    if (mapEl && event.target instanceof Node && mapEl.contains(event.target)) return;
    mapMenuOpen = false;
    scrambleOpen = false;
    confirmClear = false;
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    if (picking) return;
    if (mapMenuOpen || scrambleOpen) { mapMenuOpen = false; confirmClear = false; scrambleOpen = false; }
    else if (selected || selectedPitch !== null) { selected = null; selectedPitch = null; }
    else onClose();
  }
</script>

<svelte:window onkeydown={onKeydown} onpointerdown={onWindowPointerDown} />

{#if picking}
  <div class="picking" role="status">Click any slider, knob or button in Ghost Arcade · Esc cancels</div>
{/if}

<!-- The tray's controls carry their own tooltips; the generic VJ hover help
     would describe Live's songs and clips as VJ controls. -->
<section class="tray" class:stepped-aside={picking} transition:fly={{ y: 24, duration: 180 }} aria-label="Ableton Live" data-help-disabled>
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
        {#each VIEWS as v (v.id)}
          <button role="tab" aria-selected={view === v.id} class:active={view === v.id} onclick={() => (view = v.id)}>
            {v.label}
            {#if v.id === 'links'}<span class="count">{bridge.links.length}</span>{/if}
            {#if v.id === 'signals' && bridge.signals.length}<span class="count">{bridge.signals.length}</span>{/if}
            {#if v.id === 'arrangement' && bridge.cues.length}<span class="count">{bridge.cues.length}</span>{/if}
          </button>
        {/each}
      </div>

      <div class="map" bind:this={mapEl}>
        <button
          class="ghost scramble-btn"
          class:on={bridge.beatScramble.on}
          onclick={() => { scrambleOpen = !scrambleOpen; mapMenuOpen = false; }}
          aria-expanded={scrambleOpen}
          title="Scramble shader and FX params on the beat"
        >Scramble{#if bridge.beatScramble.on} · {EVERY_LABELS[bridge.beatScramble.every]}{/if} ▾</button>
        {#if scrambleOpen}
          <div class="menu scramble-menu" role="dialog" aria-label="Beat scramble">
            <label class="scramble-row switch-row">
              <input type="checkbox" checked={bridge.beatScramble.on} onchange={(e) => abletonBridge.setBeatScramble({ on: (e.target as HTMLInputElement).checked })} />
              <b>Beat scramble</b>
              <span>Throws the look somewhere new on Live's beat</span>
            </label>
            <div class="scramble-row">
              <span class="row-label">Every</span>
              <div class="seg">
                {#each SCRAMBLE_EVERY as every}
                  <button class:active={bridge.beatScramble.every === every} onclick={() => abletonBridge.setBeatScramble({ every })}>{EVERY_LABELS[every]}</button>
                {/each}
              </div>
            </div>
            <div class="scramble-row">
              <span class="row-label">Scramble</span>
              <div class="seg">
                {#each SCRAMBLE_TARGETS as t}
                  <button class:active={bridge.beatScramble.target === t.id} onclick={() => abletonBridge.setBeatScramble({ target: t.id })}>{t.label}</button>
                {/each}
              </div>
            </div>
            <div class="scramble-row">
              <span class="row-label">Amount</span>
              <input type="range" min="0.05" max="1" step="0.05" value={bridge.beatScramble.amount} oninput={(e) => abletonBridge.setBeatScramble({ amount: Number((e.target as HTMLInputElement).value) })} aria-label="Scramble amount" />
              <span class="amount">{Math.round(bridge.beatScramble.amount * 100)}%</span>
            </div>
            <div class="scramble-row">
              <button class="ghost" onclick={() => abletonBridge.scrambleNow()}>Scramble now</button>

            </div>
          </div>
        {/if}
        <button class="ghost" onclick={() => { mapMenuOpen = !mapMenuOpen; confirmClear = false; scrambleOpen = false; }} aria-expanded={mapMenuOpen}>Auto-map ▾</button>
        {#if mapMessage}<span class="map-message" role="status">{mapMessage}</span>{/if}
        {#if mapMenuOpen}
          <div class="menu" role="menu">
            {#if deckSet}
              {#if sectioned}
                <button role="menuitem" class="recommended" onclick={() => autoMap('parts')}><b>Parts → columns <em>For this set</em></b><span>Every part of every song plays its own column on the song's deck, so the visuals change with Build, Drop and Outro</span></button>
              {/if}
              <button role="menuitem" class:recommended={!sectioned} onclick={() => autoMap('decks')}><b>Songs → columns{#if !sectioned} <em>For this set</em>{/if}</b><span>Song N on each Live deck plays column N on the same Ghost Arcade deck; its visuals hold through the song</span></button>
            {/if}
            <div class="menu-deck">
              <span>Fill Ghost Arcade deck</span>
              <div class="seg">
                <button class:active={mapDeck === 'A'} onclick={() => (mapDeck = 'A')}>A</button>
                <button class:active={mapDeck === 'B'} onclick={() => (mapDeck = 'B')}>B</button>
              </div>
            </div>
            <button role="menuitem" class:recommended={!deckSet} onclick={() => autoMap('scenes')}>
              <b>Scenes → columns{#if !deckSet} <em>For this set</em>{/if}</b>
              <span>{deckSet ? "Fires only when a whole scene launches. Songs launched on a deck won't follow it" : 'Scene 1 fires column 1, and so on'}</span>
            </button>
            <button role="menuitem" onclick={() => autoMap('tracks')}><b>Tracks → layers</b><span>Live's grid drives the VJ grid cell for cell</span></button>
            {#if !deckSet}
              <button role="menuitem" disabled><b>Songs → columns</b><span>Needs tracks on the A and B sides of Live's crossfader</span></button>
            {/if}
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
      <div class="setup-hero">
        <svg class="hero-mark" viewBox="0 0 96 40" aria-hidden="true">
          <!-- Live's clip grid, a link, Ghost Arcade's ghost. -->
          <g class="hero-grid">
            <rect x="2" y="6" width="8" height="28" rx="1.5" />
            <rect x="13" y="12" width="8" height="22" rx="1.5" />
            <rect x="24" y="2" width="8" height="32" rx="1.5" />
          </g>
          <g class="hero-link" fill="none" stroke-width="2.2" stroke-linecap="round">
            <path d="M40 20h16" stroke-dasharray="2 4" />
            <path d="M44 14.5a5.5 5.5 0 0 0 0 11M52 14.5a5.5 5.5 0 0 1 0 11" />
          </g>
          <path class="hero-ghost" d="M78 4c-7.2 0-12.5 5.5-12.5 12.7V36l4.1-3 3.9 3.2 4.5-3.2 4.5 3.2 3.9-3.2 4.1 3V16.7C90.5 9.5 85.2 4 78 4Z" />
          <circle class="hero-eye" cx="73.5" cy="17" r="2.2" />
          <circle class="hero-eye" cx="82.5" cy="17" r="2.2" />
        </svg>
        <div class="hero-text">
          <h3>Connect Ableton Live</h3>
          <p>Three steps, once. After that Ghost Arcade connects whenever Live is open.</p>
        </div>
        <span class="live-found" class:none={!liveWords.version}>
          {#if liveWords.version}
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" /></svg>
            <span>Found</span> <span translate="no">{liveWords.version}</span>
          {:else}
            No Live found on this computer yet
          {/if}
        </span>
      </div>

      <ol class="steps">
        <li class="step" class:done={scriptReady}>
          <div class="step-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M4 9.5A2.5 2.5 0 0 1 6.5 7h6l2.5 3h10.5A2.5 2.5 0 0 1 28 12.5v11a2.5 2.5 0 0 1-2.5 2.5h-19A2.5 2.5 0 0 1 4 23.5z" /><path class="accent" d="M16 13.5v7.5M12.5 17.5 16 21l3.5-3.5" /></svg>
          </div>
          <div class="step-body">
            <span class="step-n">Step 1{#if scriptReady}<i>Done</i>{/if}</span>
            <b>Install the Live script</b>
            <p>A small control surface that Ghost Arcade copies into your Ableton User Library.</p>
            <div class="row">
              <button class="solid" onclick={() => install(false)}>
                {bridge.script?.installed ? (bridge.script.current ? 'Reinstall' : 'Update script') : 'Install script'}
              </button>
              <button class="ghost" onclick={() => install(true)}>Choose folder…</button>
              {#if bridge.script?.installed}<button class="ghost" onclick={() => abletonBridge.revealScript()}>Show</button>{/if}
            </div>
            {#if installMessage}<p class="note">{installMessage}</p>{/if}
          </div>
        </li>

        <li class="step">
          <div class="step-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32"><path d="M7 6v20M16 6v20M25 6v20" /><rect class="accent-fill" x="4" y="17" width="6" height="4" rx="1" /><rect class="accent-fill" x="13" y="9" width="6" height="4" rx="1" /><rect class="accent-fill" x="22" y="14" width="6" height="4" rx="1" /></svg>
          </div>
          <div class="step-body">
            <span class="step-n">Step 2</span>
            <b>Turn it on in Live</b>
            <ol class="sub">
              <li><span class="dot" aria-hidden="true"></span>Restart Live, so it finds the script.</li>
              <li>
                <span class="dot" aria-hidden="true"></span>
                <span>
                  <span class="sub-label">Open Live's settings:</span>
                  <span class="live-path" translate="no">{#each liveWords.menu as item, i}{#if i}<em aria-hidden="true">›</em>{/if}{item}{/each}</span>
                  <span class="keys" translate="no">{#each liveWords.shortcut as key}<kbd>{key}</kbd>{/each}</span>
                  {#if liveWords.menuAlternative}<small>({liveWords.menuAlternative})</small>{/if}
                </span>
              </li>
              <li>
                <span class="dot" aria-hidden="true"></span>
                <span><span class="sub-label">Tab:</span> <span class="live-path" translate="no">{liveWords.tab}</span>{#if liveWords.tabNote} <small>({liveWords.tabNote})</small>{/if}</span>
              </li>
              <li>
                <span class="dot" aria-hidden="true"></span>
                <span><span class="sub-label">Control Surface:</span> <span class="live-path" translate="no">GhostArcade</span> <small>Input and Output can stay on None.</small></span>
              </li>
            </ol>
          </div>
        </li>

        <li class="step" class:done={bridge.connected} class:listening={bridge.listening && !bridge.connected}>
          <div class="step-icon signal" aria-hidden="true">
            <svg viewBox="0 0 32 32"><circle class="accent-fill" cx="16" cy="20" r="2.6" /><path class="wave w1" d="M11.5 15.5a6.4 6.4 0 0 1 9 0" /><path class="wave w2" d="M8 12a11.3 11.3 0 0 1 16 0" /><path class="wave w3" d="M4.5 8.5a16.3 16.3 0 0 1 23 0" /></svg>
          </div>
          <div class="step-body">
            <span class="step-n">Step 3</span>
            <b>{bridge.listening ? 'Waiting for Live…' : 'Starting…'}</b>
            <p>Your session grid appears here the moment Live says hello.</p>
            {#if bridge.error}<p class="note error">{bridge.error}</p>{/if}
          </div>
        </li>
      </ol>
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
                  <span class="track-name" translate="no" title={track.name}>{track.name || `Track ${t + 1}`}</span>
                  <button class="tp small" onclick={() => abletonBridge.stopTrack(t)} title="Stop {track.name}" aria-label="Stop {track.name}">
                    <svg width="8" height="8" viewBox="0 0 12 12" aria-hidden="true"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>
                  </button>
                </div>
              {/each}

              {#each bridge.scenes as scene, s}
                {@const source = sceneSource(bridge, s)}
                {@const links = linksForScene(bridge.links, s)}
                {@const firing = scene.queued ? bridge.tracks.find(tr => tr.fired === s) : undefined}
                <div
                  class="cell scene"
                  class:selected={selected && samePlace(source, selected)}
                  class:queued={scene.queued}
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
                  <span class="name" translate={scene.name ? 'no' : 'yes'}>{scene.name || `Scene ${s + 1}`}</span>
                  {#if scene.queued && countdown(firing?.firedBeat ?? beat, beat)}
                    <span class="countdown">{countdown(firing?.firedBeat ?? beat, beat)}</span>
                  {/if}
                  {#if links.length}
                    <span class="visuals">
                      {#each links.slice(0, 3) as l (l.id)}
                        {@const thumb = actionThumb(ctx, l.action)}
                        <span class="vis" class:missing={bridge.missing.includes(l.id)} title={actionLabel(ctx, l.action)}>
                          {#if thumb}<img src={thumb} alt="" />{:else}<i>{actionTag(l.action)}</i>{/if}
                        </span>
                      {/each}
                      {#if links.length > 3}<span class="more">+{links.length - 3}</span>{/if}
                    </span>
                  {/if}
                </div>

                {#each bridge.tracks as track, t}
                  {@const clip = track.slots[s]}
                  {#if clip}
                    {@const source = clipSource(bridge, t, s)}
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
                      <span class="name" translate={clip.name ? 'no' : 'yes'}>{clip.name || 'Clip'}</span>
                      {#if queued && countdown(track.firedBeat, beat)}
                        <span class="countdown">{countdown(track.firedBeat, beat)}</span>
                      {/if}
                      {#if clipLinks.length}
                        <span class="visuals">
                          {#each clipLinks.slice(0, 2) as l (l.id)}
                            {@const thumb = actionThumb(ctx, l.action)}
                            <span class="vis" class:missing={bridge.missing.includes(l.id)} title={actionLabel(ctx, l.action)}>
                              {#if thumb}<img src={thumb} alt="" />{:else}<i>{actionTag(l.action)}</i>{/if}
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
      {:else if view === 'setlist'}
        <div class="pane">
          <AbletonSetlistView {bridge} {ctx} {beat} {selected} onSelect={select} />
        </div>
      {:else if view === 'decks'}
        <div class="pane">
          <AbletonDecksView {bridge} {ctx} {beat} {selected} onSelect={select} />
        </div>
      {:else if view === 'score'}
        <div class="pane">
          <AbletonScoreView {bridge} {ctx} {beat} {now} {selectedPitch} onSelectLane={selectLane} onDropLane={(pitch, action) => setLane(pitch, action)} />
        </div>
      {:else if view === 'arrangement'}
        <div class="pane">
          <AbletonArrangementView {bridge} {ctx} {beat} {now} {selected} onSelect={select} onDrop={link} />
        </div>
      {:else if view === 'signals'}
        <div class="pane">
          <AbletonSignalsView {bridge} {pickTarget} />
        </div>
      {:else}
        <div class="links-view">
          {#if !bridge.links.length}
            <div class="empty">No links yet. Drag a visual onto a scene or clip, or try Auto-map.</div>
          {:else}
            {#each bridge.links as l (l.id)}
              {@const thumb = actionThumb(ctx, l.action)}
              <div class="link-line" class:missing={bridge.missing.includes(l.id)} class:flash={now - (bridge.fired[l.id] ?? -1e9) < 450}>
                <span class="swatch" style="background: {sourceColor(bridge, l.source)}"></span>
                <span class="from">{sourceLabel(l.source)}<small>{sourceKind(l.source)}</small></span>
                <span class="arrow">→</span>
                <span class="to">
                  <span class="vis big">{#if thumb}<img src={thumb} alt="" />{:else}<i>{actionTag(l.action)}</i>{/if}</span>
                  {actionLabel(ctx, l.action)}
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
        {#if selectedPitch !== null}
          {@const thumb = laneAction ? actionThumb(ctx, laneAction) : undefined}
          <div class="inspect" style="--live: var(--ga-selection-line, #5278ff)">
            <div class="inspect-head">
              <span class="kind">Score lane</span>
              <span class="title">{noteName(selectedPitch)}</span>
              <button class="tp small" onclick={() => (selectedPitch = null)} aria-label="Deselect">
                <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
              </button>
            </div>
            {#if laneAction}
              <div class="linked">
                <span class="vis big">{#if thumb}<img src={thumb} alt="" />{:else}<i>{actionTag(laneAction)}</i>{/if}</span>
                <span class="linked-text"><b>{actionLabel(ctx, laneAction)}</b><small>{selectedPitch in bridge.scoreMap ? actionHint(laneAction) : 'Default lane'}</small></span>
                <button class="tp small" onclick={() => laneAction && abletonBridge.previewAction(laneAction)} title="Fire now" aria-label="Fire this visual now">
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                </button>
                {#if selectedPitch in bridge.scoreMap}
                  <button class="tp small" onclick={() => selectedPitch !== null && abletonBridge.setScoreLane(selectedPitch, null)} title="Back to the default" aria-label="Reset lane">
                    <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
                  </button>
                {/if}
              </div>
            {/if}
            <p class="hint">Pick a visual below, or a control hit.</p>
            <button class="ghost wide" onclick={pickControl}>Pick a control…</button>
          </div>
        {:else if selected}
          <div class="inspect" style="--live: {sourceColor(bridge, selected)}">
            <div class="inspect-head">
              <span class="kind">{sourceKind(selected)}</span>
              <span class="title">{sourceLabel(selected)}</span>
              <button class="tp small" onclick={() => (selected = null)} aria-label="Deselect">
                <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
              </button>
            </div>
            {#if selectedLinks.length > 1}
              <button class="clear-all" onclick={() => selected && abletonBridge.clearSource(selected)}>Clear all {selectedLinks.length}</button>
            {/if}
            {#each selectedLinks as l (l.id)}
              {@const thumb = actionThumb(ctx, l.action)}
              <div class="linked" class:missing={bridge.missing.includes(l.id)}>
                <span class="vis big">{#if thumb}<img src={thumb} alt="" />{:else}<i>{actionTag(l.action)}</i>{/if}</span>
                <span class="linked-text"><b>{actionLabel(ctx, l.action)}</b><small>{actionHint(l.action)}</small></span>
                <button class="tp small" onclick={() => abletonBridge.preview(l)} title="Fire now" aria-label="Fire this visual now">
                  <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor"/></svg>
                </button>
                <button class="tp small" onclick={() => abletonBridge.removeLink(l.id)} title="Remove link" aria-label="Remove link">
                  <svg width="9" height="9" viewBox="0 0 10 10" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1 1l8 8M9 1 1 9"/></svg>
                </button>
              </div>
            {:else}
              <p class="hint">Pick a visual below to fire with this {sourceKind(selected).toLowerCase()}.</p>
            {/each}
            {#if selectedLinks.length}<p class="hint">A new column replaces the one on the same deck.</p>{/if}
            <button class="ghost wide" onclick={pickControl} title="A strobe, a flash, a macro jump — any Ghost Arcade control">Pick a control…</button>
          </div>
        {/if}

        <div class="shelf">
          <div class="shelf-head">
            <div class="seg">
              <button class:active={tab === 'columns'} onclick={() => (tab = 'columns')}>Columns</button>
              <button class:active={tab === 'clips'} onclick={() => (tab = 'clips')}>Clips</button>
              <button class:active={tab === 'snapshots'} onclick={() => (tab = 'snapshots')}>Snaps</button>
              <button class:active={tab === 'stage'} onclick={() => (tab = 'stage')}>Stage</button>
            </div>
            {#if tab === 'columns' || tab === 'clips'}
              <div class="seg">
                <button class:active={deck === 'A'} onclick={() => (deck = 'A')}>A</button>
                <button class:active={deck === 'B'} onclick={() => (deck = 'B')}>B</button>
              </div>
            {/if}
          </div>
          {#if !selected && selectedPitch === null}<p class="hint">Drag onto a scene, clip, locator or score lane.</p>{/if}
          <div class="shelf-grid">
            {#each shelf as item (item.key)}
              <button
                class="tile"
                class:armed={!!selected || selectedPitch !== null}
                draggable="true"
                ondragstart={(e) => onDragStart(e, item.action)}
                onclick={() => assign(item.action)}
                title={selected ? `Link to ${sourceLabel(selected)}` : selectedPitch !== null ? `Play on ${noteName(selectedPitch)}` : `${item.label} — ${item.hint}`}
              >
                <span class="tile-thumb">{#if item.thumbnail}<img src={item.thumbnail} alt="" />{:else}<i>{actionTag(item.action)}</i>{/if}</span>
                <span class="tile-label">{item.label}</span>
              </button>
            {:else}
              <p class="hint">{tab === 'snapshots' ? 'Save a snapshot from Snaps first.' : tab === 'stage' ? 'Save a Stage preset from the Stage panel first.' : 'No clips on this deck yet.'}</p>
            {/each}
          </div>
        </div>
      </aside>
    </div>
  {/if}
</section>

<style>
  .tray {
    /* Linked visuals, drop targets and armed tiles use the selection blue. */
    --link: var(--ga-selection-line, #5278ff);
    --link-soft: var(--ga-selection-bg, #1f3170);
    --link-ink: var(--ga-selection-ink, #e0e8ff);
    --queued: #e0a33a;
    position: absolute;
    inset: 0;
    z-index: 40;
    display: flex;
    flex-direction: column;
    background: var(--ga-panel, #100f0d);
    border-top: 1px solid color-mix(in srgb, var(--ga-live, #46d18a) 35%, transparent);
    color: var(--ga-ink-0, #eef0f4);
    font-family: var(--ga-font-ui, system-ui, sans-serif);
    font-size: var(--ga-text-control, 12px);
    min-height: 0;
  }

  .tray.stepped-aside { visibility: hidden; }
  .picking {
    position: fixed;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 3000;
    padding: 8px 16px;
    border-radius: var(--ga-r-soft, 8px);
    background: var(--ga-selection-bg, #1f3170);
    border: 1px solid var(--ga-selection-line, #5278ff);
    color: var(--ga-selection-ink, #e0e8ff);
    font-weight: 600;
    font-size: var(--ga-text-control, 12px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    pointer-events: none;
  }

  /* ── Top bar ── */
  .bar {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 42px;
    box-sizing: border-box;
    padding: 0 10px;
    border-bottom: 1px solid var(--ga-line-2);
    flex: 0 0 auto;
  }
  /* Eyebrow (docs/DESIGN-SYSTEM.md). */
  .brand { display: flex; align-items: center; gap: 6px; font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); font-size: var(--ga-text-eyebrow, 10px); color: var(--ga-ink-2, #8a909b); margin-right: 4px; }
  .brand .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ga-ink-3, #555); }
  .brand.on { color: var(--ga-ink-0, #eef0f4); }
  .brand.on .dot { background: var(--ga-live, #46d18a); box-shadow: 0 0 8px var(--ga-live, #46d18a); }
  .transport { display: flex; align-items: center; gap: 6px; }
  .tp {
    width: var(--ga-control-h, 26px); height: var(--ga-control-h, 26px);
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-1, #b8bdc6);
    cursor: pointer;
    flex: 0 0 auto;
    padding: 0;
  }
  .tp:hover { color: var(--ga-ink-0, #eef0f4); border-color: var(--ga-line-3); }
  .tp.active { color: var(--ga-live, #46d18a); border-color: color-mix(in srgb, var(--ga-live, #46d18a) 55%, transparent); background: color-mix(in srgb, var(--ga-live, #46d18a) 12%, transparent); }
  .tp.small { width: 20px; height: 20px; }
  .position {
    min-width: 64px;
    padding: 0 8px;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
    font-size: var(--ga-text-body, 13px);
    font-weight: 600;
    background: var(--ga-slot, #000);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    color: var(--ga-ink-2, #8a909b);
  }
  .position.playing { color: var(--ga-ink-0, #eef0f4); }
  .meta { font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1, #b8bdc6); white-space: nowrap; }
  .meta small { font-size: var(--ga-text-micro, 9px); margin-left: 3px; color: var(--ga-ink-2, #8a909b); }
  /* Segmented tracks: the view tabs and every one-of-few choice. */
  .views, .seg {
    display: flex;
    gap: 2px;
    padding: 2px;
    box-sizing: border-box;
    background: var(--ga-slot);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
  }
  .views { height: var(--ga-control-h, 26px); margin-left: 6px; }
  .views button, .seg button {
    display: inline-flex;
    align-items: center;
    padding: 0 10px;
    min-height: 20px;
    background: transparent;
    border: none;
    border-radius: calc(var(--ga-r-hard, 5px) - 1px);
    color: var(--ga-ink-1, #8a909b);
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
  }
  .views button:hover:not(.active), .seg button:hover:not(.active) { color: var(--ga-ink-0); }
  .views button.active, .seg button.active {
    background: var(--ga-selection-bg, rgba(255, 255, 255, 0.1));
    color: var(--ga-selection-ink, #eef0f4);
    box-shadow: inset 0 0 0 1px var(--ga-selection-line, transparent);
  }
  .count { font-size: var(--ga-text-micro, 9px); font-family: var(--ga-font-mono, ui-monospace, monospace); color: var(--ga-ink-2, #8a909b); margin-left: 4px; }
  .views button.active .count { color: inherit; opacity: 0.75; }
  .map { position: relative; }
  .ghost, .solid {
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 5px);
    font: inherit;
    font-weight: var(--ga-weight-control, 600);
    cursor: pointer;
    white-space: nowrap;
  }
  .ghost { background: var(--ga-card); border: 1px solid var(--ga-line-2); color: var(--ga-ink-1, #b8bdc6); }
  .ghost:hover { color: var(--ga-ink-0, #eef0f4); border-color: var(--ga-line-3); }
  .solid { background: var(--ga-accent-gradient, var(--ga-ink-0, #eef0f4)); border: 1px solid var(--ga-violet-line, transparent); color: var(--ga-void, #07090d); border-radius: var(--ga-r-soft, 8px); }
  .menu {
    position: absolute;
    top: 30px;
    left: 0;
    z-index: 5;
    width: 260px;
    padding: 4px;
    background: var(--ga-card, #11141a);
    border: 1px solid var(--ga-line-2);
    border-radius: var(--ga-r-hard, 5px);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
  }
  .menu button {
    display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    width: 100%;
    padding: 6px 8px;
    background: transparent; border: none; border-radius: calc(var(--ga-r-hard, 5px) - 1px);
    color: var(--ga-ink-0, #eef0f4);
    font: inherit; text-align: left; cursor: pointer;
  }
  .menu button:hover { background: var(--ga-sub); }
  .menu b { font-weight: 600; }
  .menu span { color: var(--ga-ink-2, #8a909b); font-size: var(--ga-text-meta, 11px); }
  .menu .danger b { color: var(--ga-rec, #ff3b30); }
  .menu em { margin-left: 6px; padding: 1px 5px; border-radius: var(--ga-r-hard, 5px); background: color-mix(in srgb, var(--ga-live, #46d18a) 18%, transparent); color: var(--ga-live, #46d18a); font-style: normal; font-size: var(--ga-text-eyebrow, 10px); font-weight: 600; vertical-align: 1px; }
  .menu .recommended { box-shadow: inset 2px 0 0 var(--ga-live, #46d18a); }
  .menu-deck { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px 4px; margin-top: 2px; border-top: 1px solid var(--ga-line-2); }
  .menu-deck > span { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2); }
  .menu-deck .seg button { display: inline-flex; flex-direction: row; width: auto; padding: 0 10px; }
  .map { display: flex; align-items: center; gap: 6px; }
  .scramble-btn.on { border-color: var(--link); color: var(--link-ink); background: var(--link-soft); }
  .scramble-menu { width: 330px; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
  .scramble-row { display: flex; align-items: center; gap: 8px; }
  .scramble-row .row-label { width: 62px; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #8a909b); }
  .scramble-row input[type='range'] { flex: 1; }
  .scramble-row .amount { width: 34px; text-align: right; font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: var(--ga-text-meta, 11px); }
  .scramble-row .seg button { display: inline-flex; width: auto; padding: 0 8px; font-size: var(--ga-text-meta, 11px); }
  .scramble-row > .ghost { width: auto; flex-direction: row; padding: 0 10px; }
  .switch-row { display: grid; grid-template-columns: auto 1fr; column-gap: 8px; cursor: pointer; }
  .switch-row b { font-weight: 600; }
  .switch-row span { grid-column: 2; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #8a909b); }
  .map-message { margin-left: 8px; font-size: var(--ga-text-meta, 11px); color: var(--ga-live, #46d18a); white-space: nowrap; }
  .clear-all { align-self: flex-end; margin: -4px 0 4px auto; display: block; height: var(--ga-control-h-sm, 22px); padding: 0 8px; border-radius: var(--ga-r-hard, 5px); border: 1px solid color-mix(in srgb, var(--ga-rec, #ff3b30) 35%, transparent); background: transparent; color: var(--ga-rec, #ff3b30); font: inherit; font-size: var(--ga-text-meta, 11px); font-weight: 600; cursor: pointer; }
  .clear-all:hover { background: color-mix(in srgb, var(--ga-rec, #ff3b30) 10%, transparent); }
  .menu button:disabled { opacity: 0.4; cursor: default; }
  .activity {
    flex: 1;
    min-width: 0;
    display: flex; align-items: center; justify-content: flex-end; gap: 7px;
    color: var(--ga-ink-1, #b8bdc6);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .activity em { font-style: normal; color: var(--ga-ink-2, #8a909b); font-size: var(--ga-text-meta, 11px); }
  .activity .pulse { width: 6px; height: 6px; border-radius: 50%; background: var(--ga-ink-3); flex: 0 0 auto; }
  .activity.fresh { color: var(--ga-ink-0, #eef0f4); }
  .activity.fresh .pulse { background: var(--link); box-shadow: 0 0 10px var(--link); }
  .activity .idle { color: var(--ga-ink-2, #8a909b); }
  .spacer { flex: 1; }
  .close { width: var(--ga-control-h, 26px); height: var(--ga-control-h, 26px); display: inline-flex; align-items: center; justify-content: center; background: var(--ga-card); border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-hard, 5px); color: var(--ga-ink-1, #b8bdc6); cursor: pointer; }
  .close:hover { color: var(--ga-ink-0, #eef0f4); border-color: var(--ga-line-3); }

  /* ── Setup ── */
  .setup { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 12px; padding: 16px; }
  .setup-hero { display: flex; align-items: center; gap: 16px; padding: 12px 16px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-soft, 8px); background: linear-gradient(90deg, color-mix(in srgb, var(--ga-live, #46d18a) 7%, transparent), var(--ga-card) 55%); }
  .hero-mark { width: 92px; height: 38px; flex: 0 0 auto; }
  .hero-grid rect { fill: var(--ga-line-3); }
  .hero-grid rect:nth-child(2) { fill: var(--ga-live, #46d18a); opacity: 0.85; }
  .hero-link path { stroke: var(--ga-ink-2); }
  .hero-ghost { fill: var(--ga-ink-0, #eef0f4); }
  .hero-eye { fill: var(--ga-void, #0b0d11); }
  .hero-text { flex: 1; min-width: 0; }
  .hero-text h3 { margin: 0; font-size: var(--ga-text-title, 14px); font-weight: var(--ga-weight-title, 650); color: var(--ga-ink-0, #eef0f4); }
  .hero-text p { margin: 3px 0 0; color: var(--ga-ink-1, #b8bdc6); font-size: var(--ga-text-control, 12px); }
  .live-found { display: inline-flex; align-items: center; gap: 6px; height: var(--ga-control-h-sm, 22px); padding: 0 10px; border-radius: var(--ga-r-hard, 5px); font-size: var(--ga-text-meta, 11px); font-weight: 600; color: var(--ga-live, #46d18a); background: color-mix(in srgb, var(--ga-live, #46d18a) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ga-live, #46d18a) 28%, transparent); white-space: nowrap; }
  .live-found svg { width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .live-found.none { color: var(--ga-ink-2, #8a909b); background: var(--ga-card); border-color: var(--ga-line-2); }

  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  .step { position: relative; display: flex; gap: 14px; padding: 16px; border: 1px solid var(--ga-line-2); border-radius: var(--ga-r-soft, 8px); background: var(--ga-card); transition: border-color 0.2s, background 0.2s; }
  .step.done { border-color: color-mix(in srgb, var(--ga-live, #46d18a) 35%, transparent); background: color-mix(in srgb, var(--ga-live, #46d18a) 4%, var(--ga-card)); }
  .step-icon { width: 44px; height: 44px; flex: 0 0 auto; border-radius: var(--ga-r-soft, 8px); display: flex; align-items: center; justify-content: center; background: var(--ga-sub); border: 1px solid var(--ga-line-2); color: var(--ga-ink-1, #b8bdc6); }
  .step-icon svg { width: 26px; height: 26px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
  .step-icon .accent { stroke: var(--ga-live, #46d18a); }
  .step-icon .accent-fill { fill: var(--ga-live, #46d18a); stroke: none; }
  .step.done .step-icon { color: var(--ga-live, #46d18a); border-color: color-mix(in srgb, var(--ga-live, #46d18a) 30%, transparent); background: color-mix(in srgb, var(--ga-live, #46d18a) 8%, transparent); }
  .step-body { min-width: 0; flex: 1; }
  /* Eyebrow. */
  .step-n { display: flex; align-items: center; gap: 8px; font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #8a909b); margin-bottom: 4px; }
  .step-n i { font-style: normal; color: var(--ga-live, #46d18a); }
  .step b { font-weight: 600; font-size: var(--ga-text-body, 13px); color: var(--ga-ink-0, #eef0f4); }
  .step p { margin: 4px 0 0; color: var(--ga-ink-1, #b8bdc6); line-height: 1.5; }
  .step .row { display: flex; gap: 6px; margin-top: 12px; flex-wrap: wrap; }
  .sub { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 7px; color: var(--ga-ink-1, #b8bdc6); line-height: 1.55; }
  .sub li { display: flex; gap: 9px; align-items: baseline; }
  .sub .dot { width: 5px; height: 5px; flex: 0 0 auto; border-radius: 50%; background: var(--ga-line-3); transform: translateY(-2px); }
  .sub small { color: var(--ga-ink-2, #8a909b); font-size: var(--ga-text-meta, 11px); }
  .sub .sub-label { color: var(--ga-ink-1, #b8bdc6); margin-right: 2px; }
  .sub .keys { display: inline-flex; margin-left: 4px; }
  .live-path { display: inline-flex; align-items: center; gap: 4px; padding: 1px 7px; border-radius: var(--ga-r-hard, 5px); background: var(--ga-sub); border: 1px solid var(--ga-line-2); color: var(--ga-ink-0, #eef0f4); font-weight: 500; white-space: nowrap; }
  .live-path em { font-style: normal; color: var(--ga-ink-2, #8a909b); }
  kbd { display: inline-block; min-width: 18px; padding: 0 5px; margin: 0 2px; border-radius: var(--ga-r-hard, 5px); border: 1px solid var(--ga-line-3); border-bottom-width: 2px; background: var(--ga-sub); font-family: var(--ga-font-mono, ui-monospace, monospace); font-size: var(--ga-text-meta, 11px); text-align: center; color: var(--ga-ink-0, #eef0f4); }
  .signal .wave { stroke: var(--ga-ink-3); }
  .step.listening .signal .wave { animation: ga-live-wave 1.8s ease-in-out infinite; }
  .step.listening .signal .w2 { animation-delay: 0.2s; }
  .step.listening .signal .w3 { animation-delay: 0.4s; }
  .step.done .signal .wave { stroke: var(--ga-live, #46d18a); }
  @keyframes ga-live-wave { 0%, 100% { stroke: rgba(255, 255, 255, 0.18); } 40% { stroke: var(--ga-live, #46d18a); } }
  @media (prefers-reduced-motion: reduce) { .step.listening .signal .wave { animation: none; } }
  .note { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-2, #8a909b) !important; word-break: break-all; }
  .note.error { color: var(--ga-rec, #ff3b30) !important; }

  /* ── Body ── */
  .body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 290px; }
  .session, .links-view, .pane { overflow: auto; padding: 8px 10px 12px; min-width: 0; }
  .ghost.wide { width: 100%; margin-top: 6px; }
  .empty { padding: 32px; text-align: center; color: var(--ga-ink-2, #8a909b); }
  .grid {
    display: grid;
    grid-template-columns: 136px repeat(var(--tracks), minmax(112px, 1fr));
    gap: 3px;
    min-width: max-content;
  }
  .corner, .track-head {
    position: sticky; top: 0; z-index: 2;
    background: var(--ga-panel, #100f0d);
    display: flex; align-items: center; gap: 6px;
    padding: 4px 6px;
    color: var(--ga-ink-2, #8a909b);
    font-size: var(--ga-text-meta, 11px);
  }
  .corner { left: 0; z-index: 3; }
  .track-head { color: var(--ga-ink-1, #b8bdc6); border-top: 2px solid var(--live); justify-content: space-between; }
  .track-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .cell {
    position: relative;
    display: flex; align-items: center; gap: 6px;
    min-height: 40px;
    padding: 4px 6px 4px 4px;
    border-radius: var(--ga-r-hard, 5px);
    background: color-mix(in srgb, var(--live, #888) 14%, var(--ga-card, #0c0f14));
    border: 1px solid var(--ga-line-1);
    border-left: 3px solid var(--live, #888);
    cursor: pointer;
    outline: none;
    overflow: hidden;
    min-width: 0;
    transition: background 0.15s;
  }
  .cell:hover:not(.empty) { background: color-mix(in srgb, var(--live, #888) 24%, var(--ga-card, #0c0f14)); }
  .cell.empty { background: var(--ga-card); opacity: 0.4; border-left-color: transparent; cursor: default; }
  .cell.scene { position: sticky; left: 0; z-index: 1; background: color-mix(in srgb, var(--live, #888) 12%, var(--ga-sub, #11141b)); }
  .cell.selected { box-shadow: inset 0 0 0 1px var(--link); }
  .cell.drop { box-shadow: inset 0 0 0 2px var(--link); background: color-mix(in srgb, var(--link) 30%, var(--ga-card, #0c0f14)); }
  .cell.playing { box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-live, #46d18a) 80%, transparent); }
  .cell.queued { animation: queued 0.5s steps(2) infinite; }
  .cell.flash::after { content: ''; position: absolute; inset: 0; background: var(--link); opacity: 0; animation: flash 0.45s ease-out; pointer-events: none; }
  @keyframes queued { 50% { box-shadow: inset 0 0 0 1px #e0a33a; background: color-mix(in srgb, #e0a33a 18%, var(--ga-card, #0c0f14)); } }
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
    background: var(--queued);
    color: #1a1204;
    font-size: var(--ga-text-eyebrow, 10px); font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--ga-font-mono, ui-monospace, monospace);
  }
  .visuals { display: flex; gap: 3px; flex: 0 0 auto; align-items: center; }
  .vis {
    width: 38px; height: 22px;
    border-radius: 2px;
    overflow: hidden;
    background: #000;
    border: 1px solid color-mix(in srgb, var(--link) 60%, transparent);
    display: flex; align-items: center; justify-content: center;
    flex: 0 0 auto;
  }
  .vis img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .vis i { font-style: normal; font-size: var(--ga-text-micro, 9px); font-weight: 700; color: var(--ga-ink-1); }
  .vis.missing { border-color: var(--queued); opacity: 0.6; }
  .vis.big { width: 52px; height: 30px; }
  .more { font-size: var(--ga-text-eyebrow, 10px); color: var(--ga-ink-1); }
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
    border-bottom: 1px solid var(--ga-line-1);
    position: relative;
  }
  .link-line.flash { background: var(--link-soft); }
  .swatch { width: 4px; align-self: stretch; border-radius: 2px; }
  .from { width: 200px; display: flex; flex-direction: column; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .from small, .linked-text small { color: var(--ga-ink-2, #8a909b); font-size: var(--ga-text-meta, 11px); }
  .arrow { color: var(--ga-ink-2, #8a909b); }
  .to { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .warn { color: var(--queued); font-size: var(--ga-text-meta, 11px); }

  /* ── Side: inspector + shelf ── */
  .side { border-left: 1px solid var(--ga-line-2); display: flex; flex-direction: column; min-height: 0; }
  .inspect { padding: 10px; border-bottom: 1px solid var(--ga-line-2); border-top: 2px solid var(--live); flex: 0 0 auto; max-height: 50%; overflow: auto; }
  .inspect-head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  /* Eyebrow. */
  .kind { font-size: var(--ga-text-eyebrow, 10px); font-weight: 700; letter-spacing: var(--ga-eyebrow-tracking, 0.08em); text-transform: uppercase; color: var(--ga-ink-2, #8a909b); }
  .title { flex: 1; min-width: 0; font-weight: var(--ga-weight-title, 650); font-size: var(--ga-text-title, 14px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .linked { display: flex; align-items: center; gap: 8px; padding: 4px 0; }
  .linked.missing .linked-text b { color: var(--queued); }
  .linked-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .linked-text b { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .hint { margin: 0 0 6px; color: var(--ga-ink-2, #8a909b); font-size: var(--ga-text-meta, 11px); line-height: 1.45; }
  .shelf { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 8px 10px 10px; }
  .shelf-head { display: flex; gap: 6px; margin-bottom: 8px; }
  .seg { height: var(--ga-control-h, 26px); }
  .seg button { padding: 0 8px; }
  .shelf-grid { flex: 1; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; align-content: start; }
  .tile {
    display: flex; flex-direction: column; gap: 3px;
    padding: 3px;
    background: var(--ga-card);
    border: 1px solid var(--ga-line-1);
    border-radius: var(--ga-r-hard, 5px);
    color: inherit; font: inherit; text-align: left;
    cursor: grab;
  }
  .tile:hover { border-color: var(--ga-line-3); }
  .tile.armed:hover { border-color: var(--link); cursor: pointer; }
  .tile-thumb { aspect-ratio: 16 / 9; background: #000; border-radius: 2px; overflow: hidden; display: flex; align-items: center; justify-content: center; }
  .tile-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .tile-thumb i { font-style: normal; font-weight: 700; color: var(--ga-ink-1); }
  .tile-label { font-size: var(--ga-text-meta, 11px); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 0 2px 1px; }
</style>
