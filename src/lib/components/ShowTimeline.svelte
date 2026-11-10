<script lang="ts">
  /**
   * Show Timeline panel — the mapping-mode arrangement surface.
   *
   * Audio lanes (with a peak-envelope waveform) above a single preset lane.
   * Drag a block to move it, drag its edges to trim, drop an audio file
   * anywhere on the grid to add a track, drag a card out of the Preset Tray
   * to drop a composition onto the preset lane. Scrub the playhead, zoom the
   * ruler, and the transport at the top plays the whole programmed show.
   * Spacebar is play/pause — bound in App.svelte's global keydown handler
   * alongside every other app-wide shortcut, not here.
   *
   * TRANSITIONS ARE OBJECTS, NOT FORM FIELDS. Drag the "Transition" chip in
   * the transport onto the junction between two touching preset clips (or
   * click the ghost marker that appears on one), and a bowtie element
   * straddling that boundary appears. Drag either of its edges to retime it,
   * click it to edit the type and exact duration in the inspector, Delete to
   * go back to a hard cut. They used to be a `transitionIn` dropdown and a
   * `Fade` number box inside the preset-clip inspector, which said nothing
   * about WHEN the blend happened.
   *
   * Every interaction goes through `showTimeline` — this component owns no
   * arrangement state of its own, which is what lets the offline renderer
   * drive the exact same evaluation with nothing mounted.
   *
   * Hidden in VJ mode for the same reason KeyframeTimeline is: it is a
   * content-programming tool, and VJ mode needs the screen. The TRANSPORT
   * is module-scoped in the store and deliberately keeps running when the
   * panel closes or unmounts — an operator who ducks into VJ mid-show, or
   * just collapses the tray to see the canvas, does not expect the show to
   * stop. `showTimeline.pause()` is the way to stop it.
   */
  import { onMount, tick, untrack } from 'svelte';
  import { get } from 'svelte/store';
  import {
    showTimeline,
    setShowTransportSink,
    type ShowEndAction,
    SHOW_MIN_RULER_SECONDS,
    SHOW_MIN_ZOOM,
    SHOW_MAX_ZOOM,
    SHOW_DEFAULT_PRESET_SECONDS,
    SHOW_MIN_TRANSITION_SECONDS,
    maxShowTransitionDuration,
    showTransitionWindow,
  } from '../stores/showTimeline';
  import { TRANSITION_OPTIONS } from '../stores/presetTransition';
  import type { CompositionTransitionStyle, ShowAudioTrack, ShowLayerClip, ShowLayerTrack, ShowPresetClip } from '../types';
  import { compositions } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { clipAudioBus, clipAudioMaster, CLIP_AUDIO_BLOCK_TEXT } from '../audio/clipAudioBus';
  import CueListPanel from './show/CueListPanel.svelte';
  import { cueList, cueLabel } from '../show/cueList';
  import { timecodeChase } from '../show/timecode/timecodeChase';
  import { settings } from '../stores/settings';
  import { audioOutput, selectAudioOutput, startAudioOutputSelection } from '../audio/audioOutputDevice';
  import { isShowAudioFile } from '../audio/showAudioImport';
  import { offerShowFromAudio, pickSongForShow } from '../show/showFromAudio';
  import { classifyShowKey, installShowKeyCapture, setShowKeyHandler } from '../show/showKeyboard';
  import { showDropEffect } from '../show/showDrop';
  import { setShowSnapEdgeProvider, showSectionStatus } from '../stores/showTimeline';
  import SectionLane from './show/timeline/sections/SectionLane.svelte';
  import SectionInspector from './show/timeline/sections/SectionInspector.svelte';
  import SectionCueList from './show/timeline/sections/SectionCueList.svelte';
  import ScoreDialog from './show/timeline/sections/ScoreDialog.svelte';
  import { goLabel, sectionStatusText } from './show/timeline/sections/sectionGoUi';
  import { makeSection, placeNewSection } from '../timeline/sections/sectionModel';
  import { layers as liveLayersStore } from '../stores/layers';
  import type { ShowSnapGrid } from '../types';
  import ShowTrackLanes from './show/timeline/ShowTrackLanes.svelte';
  import ShowTrackHeaders from './show/timeline/ShowTrackHeaders.svelte';
  import ShowClipInspector from './show/timeline/ShowClipInspector.svelte';
  import ShowTrackInspector from './show/timeline/ShowTrackInspector.svelte';
  import ShowRuler from './show/timeline/ShowRuler.svelte';
  import ShowTempoInspector from './show/timeline/ShowTempoInspector.svelte';
  import ShowTakeoverControls from './show/timeline/ShowTakeoverControls.svelte';
  import ShowPresetLane from './show/timeline/ShowPresetLane.svelte';
  import ShowAudioLane from './show/timeline/ShowAudioLane.svelte';
  import SoundRowHeaders from './show/timeline/sound/SoundRowHeaders.svelte';
  import SoundRowLanes from './show/timeline/sound/SoundRowLanes.svelte';
  import SoundInspector from './show/timeline/sound/SoundInspector.svelte';
  import { soundLayout, soundRowAt } from './show/timeline/sound/soundRowLayout';
  import { removeBuildBlock, removeLiveBlock } from '../timeline/sound/soundCommands';
  import { transportFit } from './show/timeline/transportFit';
  import TakeoverPads from './show/TakeoverPads.svelte';
  import { takeoverPadsOpen, toggleTakeoverOnTarget } from './show/timeline/takeoverUi';
  import { liveTakeover } from '../show/takeover/liveTakeover';
  import { detectShowTempo } from '../show/tempoDetect';
  import { formatBarsBeats, rulerTicks } from '../show/tempoMap';
  import ShowCameraLane from './show/timeline/ShowCameraLane.svelte';
  import ShowCameraLaneLabel from './show/timeline/ShowCameraLaneLabel.svelte';
  import { CAMERA_LANE_HEIGHT, cameraLaneShown } from './show/timeline/cameraLaneUi';
  import { TRACK_HEADER_WIDTH, TRACK_ROW_HEIGHT, laneKeySelection, showSnapGuide, tracksStackHeight } from './show/timeline/trackLayout';
  import { carriesTrackMedia, dropTrackMedia } from './show/timeline/trackDrops';
  import { presetJunctions, type PresetJunction } from './show/timeline/laneJunctions';
  import { distinct, showSlice } from './show/timeline/timelineSlices';
  import { watchShowSelection } from './show/timeline/selectionChecks';
  import { cancelActiveDrag, followPointer } from './show/timeline/dragSession';
  import { showPopoverOpen } from './show/timeline/keyLabels';
  import { anchoredScrollLeft, followScrollLeft, wheelPixels, wheelZoomFactor } from './show/timeline/gridView';
  import { devicePixel, formatPrecise } from './show/timeline/timeFormat';
  import ShowAudioDelayBadge from './show/timeline/ShowAudioDelayBadge.svelte';
  import ShowLookLane from './show/timeline/ShowLookLane.svelte';
  import LineLanes from './show/timeline/LineLanes.svelte';
  import LineHeaders from './show/timeline/LineHeaders.svelte';
  import LinePicker from './show/timeline/LinePicker.svelte';
  import LineRecordControls from './show/timeline/LineRecordControls.svelte';
  import LineDiamondOverlay from './show/timeline/LineDiamondOverlay.svelte';
  import { LOOKS_GROUP, STAGE_GROUP, STAGE_ROW_HEIGHT, LEDS_GROUP, lineLayout } from './show/timeline/lineUi';
  import LedRowHeaders from './show/timeline/LedRowHeaders.svelte';
  import LedRowLanes from './show/timeline/LedRowLanes.svelte';
  import LedBlockInspector from './show/timeline/LedBlockInspector.svelte';
  import { ledRows, ledGroupFolded, ledGroupHeight } from './show/timeline/ledRowsUi';
  import { ledClipName } from '../timeline/leds/ledClips';
  import { edgeLook } from '../looks/edgeLookCatalog';
  import ShowLookInspector from './show/timeline/ShowLookInspector.svelte';
  import { carriesEdgeLook, readEdgeLookDrag } from '../looks/edgeLookDrag';
  import { showToast } from '../stores/errorToast';
  import type { ShowDocKind } from '../stores/showTimeline';
  import {
    canPasteClips,
    clearTrackSelection,
    copySelection,
    cutSelection,
    deleteSelection as deleteTrackSelection,
    duplicateSelection,
    hasClipSelection,
    nudgeSelection,
    pasteAtPlayhead,
    splitAtPlayhead,
  } from './show/timeline/trackCommands';

  // ── Show state, field by field ──────────────────────────────────────────
  // The store publishes a new state object on every playhead frame. Reading
  // it through slices means each value below changes only when its own
  // field does, so a playing show updates the playhead and the time
  // readouts and nothing else (see timelineSlices.ts).
  const isOpenStore = showSlice('isOpen');
  const isPlayingStore = showSlice('isPlaying');
  const currentTimeStore = showSlice('currentTime');
  const durationStore = showSlice('duration');
  const loopStore = showSlice('loop');
  const audioTracksStore = showSlice('audioTracks');
  const presetClipsStore = showSlice('presetClips');
  const activeClipIdStore = showSlice('activeClipId');
  const zoomStore = showSlice('zoom');
  const snapEnabledStore = showSlice('snapEnabled');
  const selectionStore = showSlice('selection');
  const endActionStore = showSlice('endAction');
  const layerTracksStore = showSlice('layerTracks');
  const tempoStore = showSlice('tempo');
  const rulerModeStore = showSlice('rulerMode');
  const snapGridStore = showSlice('snapGrid');
  const selectedClipIdsStore = showSlice('selectedClipIds');
  const cameraLaneStore = showSlice('cameraLane');
  const docStore = showSlice('doc');
  const lookClipsStore = showSlice('lookClips');
  const sectionsStore = showSlice('sections');
  // A derived of the project: it re-publishes on every project update.
  const compositionsStore = distinct(compositions);

  const isOpen = $derived($isOpenStore);
  const isPlaying = $derived($isPlayingStore);
  const currentTime = $derived($currentTimeStore);
  const duration = $derived($durationStore);
  const loop = $derived($loopStore);
  const audioTracks = $derived($audioTracksStore);
  const presetClips = $derived($presetClipsStore);
  const activeClipId = $derived($activeClipIdStore);
  const zoom = $derived($zoomStore);
  const snapEnabled = $derived($snapEnabledStore);
  const selection = $derived($selectionStore);
  const endAction = $derived($endActionStore);
  const layerTracks = $derived($layerTracksStore);
  const tempo = $derived($tempoStore);
  const rulerMode = $derived($rulerModeStore);
  const snapGrid = $derived($snapGridStore);
  const selectedClipIds = $derived($selectedClipIdsStore);
  const cameraLane = $derived($cameraLaneStore);
  /** Which document the tray shows: the Show (presets and music) or the
   *  Timeline (rows, blocks, lanes, looks). One tray, two tabs. */
  const doc = $derived<ShowDocKind>($docStore);
  const isTimeline = $derived(doc === 'timeline');
  const lookClips = $derived($lookClipsStore);
  const sections = $derived($sectionsStore);
  const selectedSection = $derived(selection?.kind === 'section' ? sections.find((x) => x.id === selection!.id) ?? null : null);
  const goText = $derived(isTimeline && sections.length ? goLabel(sections, $showSectionStatus, currentTime, isPlaying) : '');
  const sectionText = $derived(isTimeline && sections.length ? sectionStatusText(sections, $showSectionStatus, currentTime, isPlaying) : '');
  /** The sections' cue list beside the Timeline (a view preference). */
  const SECTION_CUES_KEY = 'ghostarcade-timeline-section-cues-open';
  let sectionCuesOpen = $state((() => {
    try { return localStorage.getItem(SECTION_CUES_KEY) === '1'; } catch { return false; }
  })());
  function toggleSectionCues() {
    sectionCuesOpen = !sectionCuesOpen;
    try { localStorage.setItem(SECTION_CUES_KEY, sectionCuesOpen ? '1' : '0'); } catch { /* private mode */ }
  }
  let scoreOpen = $state(false);
  function addSectionAtPlayhead() {
    const s = get(showTimeline);
    const span = placeNewSection(s.sections, s.tempo, s.currentTime);
    if (!span) {
      showToast('The playhead is inside a section already: move it to an empty stretch first.', 'info');
      return;
    }
    showTimeline.addSection(makeSection(s.sections, span.start, span.end));
  }
  const ledClipsStore = showSlice('ledClips');
  const ledClipsAll = $derived($ledClipsStore);
  const comps = $derived($compositionsStore);

  // ── End of show + output device ─────────────────────────────────────────
  // The transport lives in the store and keeps running with this panel
  // closed (and in VJ mode), so the end-of-show blackout is wired here once
  // for the app's life rather than to the open tray.
  let blackoutFromShow = false;
  onMount(() => {
    startAudioOutputSelection();
    setShowTransportSink((event) => {
      if (event.type === 'end' && event.action === 'blackout') {
        blackoutFromShow = true;
        settings.update((s) => ({ ...s, output: { ...s.output, blackout: true } }));
      } else if (event.type === 'start' && blackoutFromShow) {
        // The show blacked out at its end; starting it again lifts that.
        blackoutFromShow = false;
        settings.update((s) => (s.output.blackout ? { ...s, output: { ...s.output, blackout: false } } : s));
      }
    });
    return () => setShowTransportSink(null);
  });

  const END_ACTION_LABELS: Record<ShowEndAction, string> = {
    hold: 'At end: hold last look',
    rewind: 'At end: back to start',
    blackout: 'At end: blackout',
  };

  // ── Cue list + markers ───────────────────────────────────────────────────
  // The cue list sits beside the lanes; whether it is showing is a per-user
  // view preference, not part of the show.
  const CUES_OPEN_KEY = 'ghostarcade-show-cues-open';
  let cuesOpen = $state((() => {
    try { return localStorage.getItem(CUES_OPEN_KEY) === '1'; } catch { return false; }
  })());
  function toggleCues() {
    cuesOpen = !cuesOpen;
    try { localStorage.setItem(CUES_OPEN_KEY, cuesOpen ? '1' : '0'); } catch { /* private mode */ }
  }
  const cues = $derived($cueList);
  const chaseStatus = timecodeChase.status;
  const tc = $derived($chaseStatus);
  let selectedMarkerId: string | null = $state(null);
  const selectedMarker = $derived(cues.markers.find((m) => m.id === selectedMarkerId) ?? null);
  // Selecting a clip or transition hands the inspector back to it.
  function clearMarkerSelection() { selectedMarkerId = null; }

  // ── Checks made after store updates ─────────────────────────────────────
  // From one plain subscription and a microtask (see selectionChecks.ts),
  // so they stay out of the render graph:
  //  - keys on a lane are let go when something else is selected (only when
  //    the selection changes, not on every update);
  //  - selecting a clip or transition hands the inspector back to it;
  //  - the tempo note belongs to the audio inspector.
  onMount(() => watchShowSelection(showTimeline, laneKeySelection, {
    onUpdate: (sel) => {
      if (sel) clearMarkerSelection();
      if (sel?.kind !== 'audio') tempoNote = null;
    },
  }));

  // Markers drawn: the ones near the visible stretch. A flag's label runs to
  // the right of its time, so the left edge keeps a wider margin.
  /** The active document's markers (each document has its own). */
  const docMarkers = $derived(cues.markers.filter((m) => (m.doc ?? 'show') === doc));
  const visibleMarkers = $derived(docMarkers.filter((m) => {
    const x = m.time * zoom;
    return x >= viewStart * zoom - 400 && x <= viewEnd * zoom + 24;
  }));

  function markerCueLabel(cueId: string | null): string {
    const cue = cues.cues.find((c) => c.id === cueId);
    return cue ? cue.number : '?';
  }

  /** Drop a marker under the playhead, pointing at the cue the list has
   *  selected (or standing by), so "mark here, fire that" is one click. */
  function addMarkerAtPlayhead() {
    const cueId = cues.selectedCueId ?? cues.standbyCueId ?? cues.cues[0]?.id ?? null;
    const id = cueList.addMarker(get(showTimeline).currentTime, cueId, '', doc);
    showTimeline.select(null);
    selectedMarkerId = id;
  }

  function startMarkerDrag(e: MouseEvent, id: string, time: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select(null);
    selectedMarkerId = id;
    const grab = timeAt(e) - time;
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        let t = Math.max(0, timeAt(ev) - grab);
        if (get(showTimeline).snapEnabled) t = Math.round(t / 0.25) * 0.25;
        cueList.updateMarker(id, { time: t });
      },
      end: () => { if (moved) suppressNextClick = true; },
      cancel: () => { if (moved) cueList.updateMarker(id, { time }); },
    });
  }

  const LOCK_TEXT: Record<string, string> = {
    searching: 'TC searching',
    locked: 'TC locked',
    freewheel: 'TC freewheel',
    lost: 'TC lost',
  };
  // MIDI clock and Link: the badge names the source, not timecode.
  const BEAT_LOCK_TEXT: Record<string, Record<string, string>> = {
    link: { searching: 'Link searching', locked: 'Link', freewheel: 'Link freewheel', lost: 'Link lost' },
    midiClock: { searching: 'Clock searching', locked: 'Clock', freewheel: 'Clock freewheel', lost: 'Clock lost' },
  };
  const chaseSettings = timecodeChase.settings;
  const tcSource = $derived($chaseSettings.source);
  const tcText = $derived((BEAT_LOCK_TEXT[tcSource] ?? LOCK_TEXT)[tc.lock] ?? tc.lock);
  const tcSourceName = $derived(tcSource === 'link' ? 'Link' : 'MIDI clock');
  const tcMismatchText = $derived(tc.mismatch && tc.sourceBpm !== null && tc.showBpm !== null
    ? `${tcSourceName} is at ${tc.sourceBpm.toFixed(1)} BPM, the show's map at ${tc.showBpm.toFixed(1)} BPM. Still following; the audio plays at ${tcSourceName}'s tempo.`
    : '');
  // Play while following the Link session's own start: say why nothing moved.
  const tcNoticeText = $derived(tc.notice === 'linkNoPeers'
    ? 'No Link peers: start Live or another Link app, or set Link to start on the show\'s Play (Settings > Show control > Timecode).'
    : tc.notice === 'linkStartsWithSession'
      ? 'The show starts with the Link session: press Play in Live or another Link app.'
      : '');

  // ── Audio output state ───────────────────────────────────────────────────
  // The clip-audio master is a persisted, APP-WIDE control whose only other UI
  // is a self-hiding button in the top bar. A mute set once (in VJ mode, weeks
  // ago) silenced the show timeline forever with no visible cause — and zeroed
  // the recording mixdown with it. Surface it here, where the audio is being
  // authored, so a silent show always names its own reason and is one click
  // from fixed.
  const audioBlocked = $derived(audioTracks.length > 0 ? $clipAudioMaster.blocked : null);
  const audioMuted = $derived($clipAudioMaster.muted);
  const audioVolumePct = $derived(Math.round($clipAudioMaster.volume * 100));
  const audioTitle = $derived(audioBlocked
    ? `${CLIP_AUDIO_BLOCK_TEXT[audioBlocked]} — click to fix`
    : `Show audio output — ${audioVolumePct}%`);

  /** One click clears whatever is silencing the show, in the order a user
   *  would try them by hand. */
  function fixAudioOutput() {
    if ($clipAudioMaster.muted) clipAudioBus.setMasterMuted(false);
    if ($clipAudioMaster.volume <= 0) clipAudioBus.setMasterVolume(1);
    clipAudioBus.resume();
  }

  function toggleAudioOutput() {
    if (audioBlocked) fixAudioOutput();
    else clipAudioBus.setMasterMuted(true);
  }

  // Content-creation tool: hide + auto-close in VJ mode, exactly like the
  // keyframe timeline does.
  const hiddenInVJ = $derived($vjClipLauncher.isOpen);
  $effect.pre(() => {
    if (hiddenInVJ && isOpen) showTimeline.setOpen(false);
  });

  const PRESET_LANE_HEIGHT = 46;
  /** The Timeline's Looks row. */
  const LOOK_LANE_HEIGHT = 40;
  const SECTION_LANE_HEIGHT = 28;
  const AUDIO_LANE_HEIGHT = 52;
  const RULER_HEIGHT = 20;

  // ── Tray height ────────────────────────────────────────────────────────
  // This is a bottom TRAY, not a takeover. It sizes to exactly the height its
  // own content needs — transport + the lanes that actually exist + the
  // inspector when one is showing — instead of reserving a fixed tall block
  // and leaving most of it empty grid. Past the ceiling the lane stack
  // scrolls rather than the panel growing.
  //
  // The ceiling is `min(260px, 38vh)` so a 13" laptop does not lose a third
  // of its screen to it. Dragging the top edge overrides the height (up to a
  // larger but still sane ceiling) and that override persists.
  /** Each tab keeps its own hand-set height. */
  const trayHeightKey = (d: ShowDocKind) => (d === 'timeline' ? 'ghostarcade-timeline-tray-height' : 'ghostarcade-show-tray-height');
  const TRAY_MIN_HEIGHT = 150;
  /** Space an always-on horizontal scrollbar would eat inside the grid.
   *  Zero on macOS overlay scrollbars, ~8–15 px on Windows. */
  const GRID_SCROLLBAR_ALLOWANCE = 10;

  /** The tray never goes past this share of the window, whatever it holds. */
  const TRAY_MAX_SHARE = 0.72;
  interface TrayLimits { floor: number; cap: number }
  function trayHeightLimits(vh: number, chrome: number, lanesMin: number): TrayLimits {
    const cap = Math.max(TRAY_MIN_HEIGHT, Math.round(vh * TRAY_MAX_SHARE));
    return { cap, floor: Math.min(cap, Math.max(TRAY_MIN_HEIGHT, Math.ceil(chrome + lanesMin))) };
  }
  function clampTray(h: number, limits: TrayLimits, ceiling: number): number {
    return Math.min(limits.cap, Math.max(limits.floor, Math.min(h, Math.max(ceiling, limits.floor))));
  }

  function autoCeiling(vh: number, withTracks = false): number {
    // Layer tracks need the room: up to about half the window with them.
    if (withTracks) return Math.max(TRAY_MIN_HEIGHT, Math.round(Math.min(400, vh * 0.48)));
    return Math.max(TRAY_MIN_HEIGHT, Math.round(Math.min(260, vh * 0.38)));
  }
  const CUE_PANEL_MIN_HEIGHT = 300;
  /** With the cue list open the tray may auto-grow a little further. */
  function cueCeiling(vh: number): number {
    return Math.max(TRAY_MIN_HEIGHT, Math.round(Math.min(360, vh * 0.45)));
  }
  /** A hand-dragged tray may be taller than the auto ceiling — the user
   *  asked for it — but never so tall the app underneath disappears. */
  function dragCeiling(vh: number): number {
    return Math.max(TRAY_MIN_HEIGHT, Math.round(Math.min(720, vh * 0.62)));
  }

  function loadUserHeight(d: ShowDocKind = get(showTimeline).doc): number | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = parseFloat(localStorage.getItem(trayHeightKey(d)) || '');
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch {
      return null;
    }
  }
  function saveUserHeight(h: number | null): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const key = trayHeightKey(get(showTimeline).doc);
      if (h === null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(Math.round(h)));
    } catch {
      /* private mode — the session still resizes fine */
    }
  }

  let viewportH = $state(typeof window !== 'undefined' ? window.innerHeight : 900);
  let userHeight: number | null = $state(loadUserHeight());
  // The other tab: its own height.
  let heightDoc: ShowDocKind | null = null;
  $effect.pre(() => {
    const d = doc;
    untrack(() => {
      if (heightDoc !== null && heightDoc !== d) userHeight = loadUserHeight(d);
      heightDoc = d;
    });
  });
  /** Measured, not assumed: both bars wrap at narrow widths, and a wrapped
   *  transport that the height maths did not know about is exactly how the
   *  inspector ends up hanging out of the bottom of the tray. */
  let transportH = $state(36);
  let inspectorH = $state(0);
  /** The takeover pads' own height, when they are open. */
  let padsH = $state(0);

  const tracksH = $derived(isTimeline ? tracksStackHeight(layerTracks, $lineLayout) : 0);
  // Control lines of the Looks row and the Stage row (Timeline only).
  const looksLines = $derived(isTimeline ? $lineLayout.lines.get(LOOKS_GROUP) ?? [] : []);
  const stageLines = $derived(isTimeline ? $lineLayout.lines.get(STAGE_GROUP) ?? [] : []);
  const looksLinesH = $derived(isTimeline ? ($lineLayout.heights.get(LOOKS_GROUP) ?? 0) : 0);
  const stageRowH = $derived(isTimeline ? STAGE_ROW_HEIGHT + ($lineLayout.heights.get(STAGE_GROUP) ?? 0) : 0);
  // The LEDs group (one row per WLED controller and range) and its blocks' lines.
  const ledLines = $derived(isTimeline ? $lineLayout.lines.get(LEDS_GROUP) ?? [] : []);
  const ledRowsH = $derived(isTimeline ? ledGroupHeight($ledRows, $ledGroupFolded) + ($ledRows.length ? $lineLayout.heights.get(LEDS_GROUP) ?? 0 : 0) : 0);
  const ledNames = $derived(Object.fromEntries(ledClipsAll.map((c) => [c.id, ledClipName(c)])));
  const ledSpans = $derived(Object.fromEntries(ledClipsAll.map((c) => [c.id, { start: c.startTime, end: c.startTime + c.duration }])));
  const lookSpans = $derived(Object.fromEntries(lookClips.map((c) => [c.id, { start: c.startTime, end: c.startTime + c.duration }])));
  const lookNames = $derived<Record<string, string>>({ '*': 'All looks', ...Object.fromEntries(lookClips.map((c) => [c.id, edgeLook(c.lookId)?.name ?? 'Look'])) });
  let linePicker: { x: number; y: number; group: 'looks' | 'stage' } | null = $state(null);
  const linePickerTargets = $derived.by(() => {
    if (!linePicker) return [];
    if (linePicker.group === 'stage') return [{ target: { scope: 'stage' as const }, label: 'Stage FX' }, { target: { scope: 'led' as const }, label: 'LEDs' }];
    const sel = selection?.kind === 'lookClip' ? selection.id : null;
    return [
      ...[...lookClips]
        .sort((a, b) => (a.id === sel ? -1 : b.id === sel ? 1 : a.startTime - b.startTime))
        .map((c) => ({ target: { scope: 'look' as const, id: c.id }, label: `${lookNames[c.id]} @ ${formatPrecise(c.startTime)}` })),
      { target: { scope: 'look' as const, id: '*' }, label: 'All looks' },
    ];
  });
  function openLinePicker(e: MouseEvent, group: 'looks' | 'stage') {
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    linePicker = linePicker ? null : { x: r.left, y: r.top - 4, group };
  }
  /** The lane under the ruler: Presets on the Show, Looks on the Timeline. */
  const topLaneH = $derived(isTimeline ? SECTION_LANE_HEIGHT + LOOK_LANE_HEIGHT : PRESET_LANE_HEIGHT);
  // The Stage camera lane sits under the audio lanes once it has shots (or was asked for).
  const cameraLaneH = $derived(cameraLane.length > 0 || $cameraLaneShown ? CAMERA_LANE_HEIGHT : 0);
  const audioLaneCount = $derived(Math.max(1, audioTracks.reduce((m, t) => Math.max(m, t.lane + 1), 0)));
  const audioLanes = $derived(Array.from({ length: audioLaneCount }, (_, i) => i));
  /** Each audio lane's tracks, in show order. */
  const audioByLane = $derived.by(() => {
    const out: ShowAudioTrack[][] = audioLanes.map(() => []);
    for (const t of audioTracks) out[t.lane]?.push(t);
    return out;
  });
  // The Timeline's audio is its sound rows (their own heights, lines and footer).
  const audioStackH = $derived(isTimeline ? $soundLayout.total : audioLaneCount * AUDIO_LANE_HEIGHT);
  const laneStackH = $derived(RULER_HEIGHT + topLaneH + looksLinesH + tracksH + stageRowH + ledRowsH + audioStackH + cameraLaneH);
  const hasTracks = $derived(isTimeline && layerTracks.length > 0);
  const labelWidth = $derived(isTimeline ? TRACK_HEADER_WIDTH : 108);
  // The bound clientHeight keeps its last value after the inspector
  // unmounts, so gate it on the selection rather than trusting the binding.
  const selectedTempo = $derived(selection?.kind === 'tempo');
  // "Detect tempo" on an audio track.
  let detectingTempo = $state(false);
  let tempoNote: { ok: true; bpm: number } | { ok: false; reason: string } | null = $state(null);
  async function detectTempoFrom(trackId: string) {
    detectingTempo = true;
    tempoNote = null;
    const result = await detectShowTempo(trackId);
    detectingTempo = false;
    tempoNote = result.ok ? { ok: true, bpm: Math.round(result.bpm * 10) / 10 } : { ok: false, reason: result.reason };
  }
  let resizingTray = $state(false);

  function startTrayResize(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const startH = trayHeight;
    const startUser = userHeight;
    resizingTray = true;
    followPointer({
      move: (ev) => {
        // Top edge: dragging UP (a negative delta) makes the tray taller.
        // The pads are on top of the tray's own height, not part of it.
        const next = startH - (ev.clientY - startY) - padsRoom;
        userHeight = Math.max(TRAY_MIN_HEIGHT, Math.min(Math.round(next), dragCeiling(viewportH)));
      },
      end: () => {
        resizingTray = false;
        saveUserHeight(userHeight);
      },
      cancel: () => {
        resizingTray = false;
        userHeight = startUser;
      },
    });
  }

  /** Double-click the grip to go back to auto-fit. */
  function resetTrayHeight() {
    userHeight = null;
    saveUserHeight(null);
  }


  const rulerSeconds = $derived(Math.max(duration, SHOW_MIN_RULER_SECONDS));
  const totalWidth = $derived(rulerSeconds * zoom);
  // Moved with a transform (on its own compositor layer), so a playing show
  // repaints nothing under it. Snapped to device pixels as `left` was.
  const playheadX = $derived(devicePixel(currentTime * zoom));

  // Visible stretch of the grid, for the ruler and the tracks (they draw
  // only what is on screen).
  let gridScrollLeft = $state(0);
  let gridWidth = $state(800);
  const viewStart = $derived(Math.max(0, gridScrollLeft / zoom - 2));
  const viewEnd = $derived((gridScrollLeft + gridWidth) / zoom + 2);

  /** Composition names by id (the first composition with an id wins, as a
   *  `find` would). */
  const compositionNames = $derived.by(() => {
    const map = new Map<string, string | undefined>();
    for (const c of comps) if (!map.has(c.id)) map.set(c.id, c.name);
    return map;
  });
  function compositionName(id: string, fallback?: string): string {
    return compositionNames.get(id) ?? fallback ?? 'Missing preset';
  }

  // ── Grid geometry ──────────────────────────────────────────────────────
  let gridEl: HTMLDivElement | undefined = $state();
  /** Grid scrollTop, mirrored onto the lane-label column. */
  let laneScrollTop = $state(0);

  function timeAt(e: MouseEvent | DragEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left + gridEl.scrollLeft) / zoom);
  }

  function laneAt(e: DragEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    // Lane order: ruler, presets / Looks (+ its lines), layer tracks, Stage row,
    // LED rows, then the audio lanes (the Timeline's sound rows, each with its lines).
    const y = e.clientY - rect.top + gridEl.scrollTop - RULER_HEIGHT - topLaneH - looksLinesH - tracksH - stageRowH - ledRowsH;
    if (y < 0) return 0;
    if (isTimeline) return Math.max(0, soundRowAt($soundLayout, y));
    return Math.max(0, Math.min(audioLaneCount, Math.floor(y / AUDIO_LANE_HEIGHT)));
  }

  // ── Scrub ──────────────────────────────────────────────────────────────
  let suppressNextClick = false;

  function seekFromClick(e: MouseEvent) {
    if (suppressNextClick) { suppressNextClick = false; return; }
    const target = e.target as HTMLElement;
    if (
      target.closest('.show-block') ||
      target.closest('.show-playhead') ||
      target.closest('.show-transition') ||
      target.closest('.junction-add') ||
      target.closest('.show-marker') ||
      target.closest('.lc-block') ||
      target.closest('.tx') ||
      target.closest('.tx-add') ||
      target.closest('.kl-key') ||
      target.closest('.sec-block')
    ) {
      return;
    }
    showTimeline.seek(timeAt(e));
  }

  function startScrub(e: MouseEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // Seek on press, not only on the first move: a plain click on the ruler
    // places the playhead (the grid's own click handler is suppressed below).
    const from = get(showTimeline).currentTime;
    showTimeline.seek(timeAt(e));
    followPointer({
      move: (ev) => showTimeline.seek(timeAt(ev)),
      end: () => { suppressNextClick = true; },
      // Esc: the playhead goes back to where it was before the press.
      cancel: () => showTimeline.seek(from),
    });
  }

  // ── Block drag / resize ────────────────────────────────────────────────
  type BlockKind = 'preset' | 'audio' | 'look';
  const selectionKind = (kind: BlockKind) => (kind === 'look' ? 'lookClip' : kind);

  function startBlockDrag(e: MouseEvent, kind: BlockKind, id: string, startTime: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: selectionKind(kind), id });
    const grabOffset = timeAt(e) - startTime;
    const before = showTimeline.exportArrangement();
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        const next = timeAt(ev) - grabOffset;
        if (kind === 'preset') showTimeline.movePresetClip(id, next);
        else if (kind === 'look') showTimeline.moveLookClip(id, next);
        else showTimeline.moveAudioTrack(id, next);
      },
      end: () => { if (moved) suppressNextClick = true; },
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  function startBlockResize(e: MouseEvent, kind: BlockKind, id: string, edge: 'start' | 'end') {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: selectionKind(kind), id });
    const before = showTimeline.exportArrangement();
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        const t = timeAt(ev);
        if (kind === 'preset') showTimeline.resizePresetClip(id, edge, t);
        else if (kind === 'look') showTimeline.resizeLookClip(id, edge, t);
        else showTimeline.resizeAudioTrack(id, edge, t);
      },
      end: () => { if (moved) suppressNextClick = true; },
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  // ── Drops: audio files + preset tray cards ─────────────────────────────
  let dragHover = $state(false);
  /** A Look card from the Looks gallery is over the Timeline. */
  let lookDropActive = $state(false);

  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    if (transitionDragActive) {
      // Highlight the junction the drop would land on, so it is obvious
      // BEFORE releasing which boundary is about to get a transition.
      transitionDropTarget = junctionNear(timeAt(e))?.clipId ?? null;
      if (e.dataTransfer) e.dataTransfer.dropEffect = transitionDropTarget ? 'copy' : 'none';
      return;
    }
    dragHover = true;
    lookDropActive = isTimeline && !!e.dataTransfer && carriesEdgeLook(e.dataTransfer);
    // The media tray drags with effectAllowed 'move' in mapping mode; a
    // dropEffect it does not allow makes the browser refuse the drop.
    if (e.dataTransfer) e.dataTransfer.dropEffect = showDropEffect(e.dataTransfer.effectAllowed);
  }

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    dragHover = false;
    lookDropActive = false;
    const dt = e.dataTransfer;
    if (!dt) return;
    const dropTime = timeAt(e);

    // A Look card from the Looks gallery: a block on the Looks row.
    const look = readEdgeLookDrag(dt);
    if (look) {
      if (!isTimeline) {
        showToast('Looks go on the Timeline\'s Looks row: open Timeline and drop it there.', 'info');
        return;
      }
      showTimeline.addLookClip(look.lookId, look.paletteId, dropTime, { scope: look.scope, layerIds: look.layerIds });
      return;
    }

    // Transition chip dropped on (or near) a junction. A junction only
    // exists where two clips actually touch, so a drop into a gap or onto
    // the middle of a clip finds nothing and is a no-op rather than
    // inventing a boundary.
    if (transitionDragActive || dt.types.includes(TRANSITION_DRAG_TYPE)) {
      const target = junctionNear(dropTime);
      transitionDragActive = false;
      transitionDropTarget = null;
      if (target) createTransitionAt(target.clipId);
      return;
    }

    // A card dragged out of the Preset Tray carries its index into the
    // current compositions list (PresetTray.handlePresetDragStart).
    const presetIndex = dt.getData('application/x-ghost-mapping-preset');
    if (presetIndex && isTimeline) {
      showToast('Presets go on the Show: the Timeline has rows for the pieces instead.', 'info');
      return;
    }
    if (presetIndex) {
      const comp = $compositions[Number(presetIndex)];
      if (comp) {
        showTimeline.insertPresetClipAt(comp.id, dropTime, SHOW_DEFAULT_PRESET_SECONDS, comp.name);
      }
      return;
    }

    // A media-tray card or a video / image file dropped off the rows: it has
    // to go on a piece (rows are the mapping layers), which says so.
    if (carriesTrackMedia(dt) && !Array.from(dt.files ?? []).some((f) => isShowAudioFile(f.name, f.type))) {
      if (!isTimeline) {
        showToast('Media blocks go on the Timeline: open Timeline and drop it on a piece\'s row.', 'info');
        return;
      }
      void dropTrackMedia(dt, null, showTimeline.snapTime(dropTime));
      return;
    }

    const lane = laneAt(e);
    const files = Array.from(dt.files ?? []).filter((f) => isShowAudioFile(f.name, f.type));
    // A song dropped on an empty show builds a show around it.
    const s = get(showTimeline);
    if (files.length === 1 && !isTimeline && s.audioTracks.length === 0 && s.presetClips.length === 0) {
      offerShowFromAudio(files[0]);
      return;
    }
    let cursor = dropTime;
    for (const file of files) {
      await showTimeline.addAudioTrackFromFile(file, { startTime: cursor, lane });
      cursor += 0.001; // keep drop order stable; lane placement resolves overlap
    }
  }

  let audioInput: HTMLInputElement | undefined = $state();
  async function handleAudioPick(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    for (const file of files) {
      await showTimeline.addAudioTrackFromFile(file, { startTime: get(showTimeline).currentTime });
    }
    input.value = '';
  }

  // ── Add preset ─────────────────────────────────────────────────────────
  let addPresetId = $state('');
  function addPreset() {
    const comp = $compositions.find((c) => c.id === addPresetId) ?? $compositions[0];
    if (!comp) return;
    showTimeline.addPresetClip(comp.id, SHOW_DEFAULT_PRESET_SECONDS, comp.name);
  }

  // ── Selection inspector ────────────────────────────────────────────────
  const selectedPreset = $derived(selection?.kind === 'preset'
    ? presetClips.find((c) => c.id === selection!.id) ?? null
    : null);
  const selectedLookClip = $derived(selection?.kind === 'lookClip'
    ? lookClips.find((c) => c.id === selection!.id) ?? null
    : null);
  const selectedLedClip = $derived(selection?.kind === 'ledClip'
    ? ledClipsAll.find((c) => c.id === selection!.id) ?? null
    : null);
  const selectedAudio = $derived(selection?.kind === 'audio'
    ? audioTracks.find((t) => t.id === selection!.id) ?? null
    : null);
  /** Where a layer clip lives (showTimeline.findLayerClip, over the
   *  tracks this component already follows). */
  function findLayerClip(tracks: ShowLayerTrack[], clipId: string): { track: ShowLayerTrack; clip: ShowLayerClip } | null {
    for (const track of tracks) {
      const clip = track.clips.find((c) => c.id === clipId);
      if (clip) return { track, clip };
    }
    return null;
  }
  /** Layer-track clips: one selected shows its inspector, several a count. */
  const selectedLayerClipCount = $derived(selectedClipIds.length);
  const selectedLayerClipFound = $derived(selection?.kind === 'layerClip'
    ? findLayerClip(layerTracks, selection.id)
    : selectedLayerClipCount === 1
      ? findLayerClip(layerTracks, selectedClipIds[0])
      : null);
  const layerClipInspector = $derived(selectedLayerClipCount > 0 || !!selectedLayerClipFound);
  const selectedTrack = $derived(selection?.kind === 'track'
    ? layerTracks.find((t) => t.id === selection!.id) ?? null
    : null);
  const selectedTrackOnStage = $derived(!!selectedTrack && $liveLayersStore.some((l) => l.id === selectedTrack!.layerId));

  /** The clip whose LEFT junction carries the selected transition. */
  const selectedTransitionClip = $derived(selection?.kind === 'transition'
    ? presetClips.find((c) => c.id === selection!.id) ?? null
    : null);

  // Bars ruler: bar lines (and beats, when they are far enough apart) run
  // down through the lanes, so clips can be lined up by eye.
  const barLines = $derived(rulerMode === 'bars' && tempo
    ? rulerTicks(tempo, Math.max(0, viewStart), Math.min(rulerSeconds, viewEnd), zoom, 18).map((t) => ({ x: Math.round(t.time * zoom), bar: t.kind === 'bar' }))
    : []);
  /** A sound row, audio block, Live clip or build selected on the Timeline. */
  const soundSelection = $derived(isTimeline && selection && (selection.kind === 'soundRow' || selection.kind === 'liveClip' || selection.kind === 'build' || selection.kind === 'audio') ? selection : null);
  const inspectorVisible = $derived(!!(selectedPreset || selectedAudio || selectedTransitionClip || selectedMarker || layerClipInspector || selectedTrack || selectedTempo || selectedLookClip || selectedLedClip || soundSelection || selectedSection));
  // With layer tracks the inspector strip is always there (a hint when
  // nothing is selected) and its room is reserved: selecting a clip must not
  // grow the tray, or the lanes jump under the pointer mid-drag.
  const TRACK_INSPECTOR_RESERVE = 72;
  // The inspector wraps onto more rows in a narrow window (or at a large
  // interface scale), and then needs more than the reserve: its real height.
  const inspectorRoom = $derived(hasTracks ? Math.max(TRACK_INSPECTOR_RESERVE, inspectorH) : inspectorVisible ? inspectorH : 0);
  // The takeover pads sit between the transport and the lanes. They make the
  // tray taller rather than taking the lanes' room.
  const padsRoom = $derived($takeoverPadsOpen ? padsH : 0);
  /** Everything but the lanes: transport, pads, inspector, top border. */
  const chromeH = $derived(transportH + padsRoom + inspectorRoom + 1);
  const lanesH = $derived(laneStackH + GRID_SCROLLBAR_ALLOWANCE);
  // Lanes always get room for the ruler, the presets and a couple of tracks
  // (as far as the tray's hard limit allows), however much of the tray the
  // rest needs at this window size and interface scale.
  const lanesMin = $derived(Math.min(lanesH, RULER_HEIGHT + topLaneH + GRID_SCROLLBAR_ALLOWANCE
    + (hasTracks ? Math.min(2, layerTracks.length) * TRACK_ROW_HEIGHT : AUDIO_LANE_HEIGHT)));
  const trayLimits = $derived(trayHeightLimits(viewportH, chromeH, lanesMin));
  const contentH = $derived(Math.max(
    chromeH + lanesH,
    // The cue list needs room for its status, a few rows and the editor.
    cuesOpen ? transportH + padsRoom + CUE_PANEL_MIN_HEIGHT : 0,
  ));
  const autoH = $derived(clampTray(contentH, trayLimits, (cuesOpen ? cueCeiling(viewportH) : autoCeiling(viewportH, hasTracks)) + padsRoom));
  const trayHeight = $derived(userHeight === null
    ? autoH
    : clampTray(userHeight + padsRoom, trayLimits, dragCeiling(viewportH) + padsRoom));

  // Publish the live height so App.svelte can reserve viewport space for the
  // tray, the way it already does for the Presets / Sequencer / Keyframes
  // panels. Those three hard-code a constant because their heights are
  // constant; this one is content-sized and resizable, so it has to be a
  // variable. Cleared on close so the viewport springs straight back.
  // Declared after `trayHeight`: a pre-effect runs as soon as it is created,
  // and with the tray already open at mount it reads the height at once.
  // Each tab publishes its own (`--ga-show-tray-height`,
  // `--ga-timeline-tray-height`); the one not showing is 0.
  $effect.pre(() => {
    if (typeof document !== 'undefined') {
      const open = isOpen && !hiddenInVJ;
      const root = document.documentElement.style;
      root.setProperty('--ga-show-tray-height', open && !isTimeline ? `${trayHeight}px` : '0px');
      root.setProperty('--ga-timeline-tray-height', open && isTimeline ? `${trayHeight}px` : '0px');
    }
  });

  /** Apply a typed number, then show the value that really took: a value
   *  the show refused or clamped must not stay in the box. */
  function commitNumber(e: Event, apply: (v: number) => void, read: () => number | undefined) {
    const input = e.currentTarget as HTMLInputElement;
    apply(parseFloat(input.value));
    const v = read();
    if (v !== undefined && Number.isFinite(v)) input.value = v.toFixed(2);
  }
  const livePreset = (id: string) => get(showTimeline).presetClips.find((c) => c.id === id);
  const liveAudio = (id: string) => get(showTimeline).audioTracks.find((t) => t.id === id);

  function deleteSelected() {
    if (selectedMarker) {
      cueList.removeMarker(selectedMarker.id);
      selectedMarkerId = null;
      return;
    }
    if (selectedSection) showTimeline.removeSection(selectedSection.id);
    else if (selectedLookClip) showTimeline.removeLookClip(selectedLookClip.id);
    else if (selectedLedClip) showTimeline.removeLedClip(selectedLedClip.id);
    else if (selection?.kind === 'liveClip') removeLiveBlock(selection.id);
    else if (selection?.kind === 'build') removeBuildBlock(selection.id);
    else if (selectedTransitionClip) showTimeline.removeTransitionAt(selectedTransitionClip.id);
    else if (selectedPreset) showTimeline.removePresetClip(selectedPreset.id);
    else if (selectedAudio) showTimeline.removeAudioTrack(selectedAudio.id);
  }

  // ── Junction transitions ───────────────────────────────────────────────
  //
  // A transition is an OBJECT on the timeline, not a field in this form. It
  // straddles the junction between two touching clips — half reaching back
  // into the outgoing clip, half forward into the incoming one, the way
  // Premiere and CapCut place one. Drag the "Transition" chip in the
  // transport onto a junction (or click the ghost marker that appears on
  // one) to create it, drag either edge to set its length, click it to edit
  // the type and exact duration below, Delete to go back to a hard cut.
  //
  // The geometry drawn here is EXACTLY what the renderer runs:
  // `showTransitionWindow()` is the same function `resolveShowTransition()`
  // uses to decide what is on screen, so the element can never lie about
  // when the blend happens or how long it really lasts (see laneJunctions.ts).
  const junctions = $derived(presetJunctions(presetClips));

  /** Nearest junction to a dropped/clicked time, inside a zoom-aware reach. */
  function junctionNear(time: number): PresetJunction | null {
    let best: PresetJunction | null = null;
    let bestDelta = Math.max(0.4, 44 / zoom);
    for (const j of junctions) {
      const delta = Math.abs(j.boundary - time);
      if (delta <= bestDelta) {
        bestDelta = delta;
        best = j;
      }
    }
    return best;
  }

  /** Style AND length are inherited from the preset tray's own transition
   *  settings — a crossfade set once there is the crossfade a dropped
   *  transition uses. `addTransitionAt` falls back to
   *  SHOW_DEFAULT_TRANSITION_SECONDS when the tray has nothing usable, and
   *  clamps against both neighbours either way. */
  function createTransitionAt(clipId: string) {
    showTimeline.addTransitionAt(clipId);
  }

  /**
   * Drag either edge to set the length. The window is centred on the
   * boundary, so both edges move together and the duration is twice the
   * distance from the boundary to the pointer — dragging one edge out by a
   * second buys a second on each side.
   */
  function startTransitionResize(e: MouseEvent, clipId: string, boundary: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select({ kind: 'transition', id: clipId });
    const before = showTimeline.exportArrangement();
    let moved = false;
    followPointer({
      move: (ev) => {
        moved = true;
        showTimeline.setTransitionDuration(clipId, Math.abs(timeAt(ev) - boundary) * 2);
      },
      end: () => { if (moved) suppressNextClick = true; },
      cancel: () => { if (moved) showTimeline.restoreArrangement(before); },
    });
  }

  /** Palette chip → junction. Mirrors the preset-card drag contract. */
  const TRANSITION_DRAG_TYPE = 'application/x-ghost-show-transition';
  let transitionDragActive = $state(false);
  let transitionDropTarget: string | null = $state(null);

  function handleTransitionDragStart(e: DragEvent) {
    if (!e.dataTransfer) return;
    transitionDragActive = true;
    e.dataTransfer.setData(TRANSITION_DRAG_TYPE, '1');
    e.dataTransfer.effectAllowed = 'copy';
  }

  function handleTransitionDragEnd() {
    transitionDragActive = false;
    transitionDropTarget = null;
  }

  /** Effective vs requested, so a clamp that actually bites is visible
   *  rather than something you discover mid-show. */
  function requestedTransitionDuration(clip: ShowPresetClip): number {
    const raw = Number(clip.transitionDuration);
    return Number.isFinite(raw) ? Math.max(0, raw) : 0;
  }
  const selectedTransitionWindow = $derived(selectedTransitionClip
    ? showTransitionWindow(presetClips, selectedTransitionClip)
    : null);
  const selectedTransitionMax = $derived(selectedTransitionClip
    ? maxShowTransitionDuration(presetClips, selectedTransitionClip)
    : 0);
  const selectedTransitionClamped = $derived(
    !!selectedTransitionClip &&
    !!selectedTransitionWindow &&
    requestedTransitionDuration(selectedTransitionClip) - selectedTransitionWindow.duration > 0.01);

  // ── Keyboard (gated on pointer-over so it can't fight other panels) ────
  //
  // SPACE IS NOT HERE. Transport play/pause lives in App.svelte's global
  // keydown handler next to every other app-wide shortcut, gated on
  // `showTransportOwnsSpace()`.
  //
  // The keys this panel does own are not a window listener of their own
  // either: App.svelte asks `handleShowKeydown` (show/showKeyboard.ts)
  // before its Copy / Paste / Delete shortcuts, and stops when the show
  // takes the key. With two independent listeners, Delete on a show clip
  // also deleted the selected mapping layer.
  let pointerInTray = false;
  let focusInTray = false;
  function handleShowKey(e: KeyboardEvent): boolean {
    // Esc during a drag cancels the drag (and nothing else), wherever the
    // pointer is.
    if (e.key === 'Escape' && cancelActiveDrag()) return true;
    // Esc with a menu open is the menu's: it closes, the selection stays.
    if (e.key === 'Escape' && showPopoverOpen()) return false;
    const s = get(showTimeline);
    const clipSel = hasClipSelection();
    const action = classifyShowKey(e, {
      open: isOpen && !hiddenInVJ,
      engaged: pointerInTray || focusInTray,
      hasSelection: !!(s.selection || selectedMarker) || clipSel,
      hasClipSelection: clipSel,
      canPaste: canPasteClips() && s.doc === 'timeline' && s.layerTracks.length > 0,
      hasTracks: s.doc === 'timeline' && s.layerTracks.length > 0,
      takeoverActive: s.doc === 'timeline' && (Object.keys(liveTakeover.state.surfaces).length > 0 || !!liveTakeover.state.overlay),
      hasSections: s.doc === 'timeline' && s.sections.length > 0,
    });
    if (!action) return false;
    switch (action) {
      case 'delete':
        if (deleteTrackSelection(false)) return true;
        deleteSelected();
        return true;
      case 'rippleDelete':
        return deleteTrackSelection(true);
      case 'split':
        splitAtPlayhead();
        return true;
      case 'duplicate':
        duplicateSelection();
        return true;
      case 'copy':
        return copySelection();
      case 'cut':
        return cutSelection();
      case 'paste':
        pasteAtPlayhead();
        return true;
      case 'selectAll':
        showTimeline.selectAllLayerClips();
        laneKeySelection.set(null);
        return true;
      case 'nudgeLeft':
      case 'nudgeRight':
      case 'nudgeBarLeft':
      case 'nudgeBarRight':
        return nudgeSelection(action === 'nudgeLeft' || action === 'nudgeBarLeft' ? -1 : 1, action === 'nudgeBarLeft' || action === 'nudgeBarRight');
      case 'toggleSnap':
        showTimeline.setSnapEnabled(!s.snapEnabled);
        return true;
      case 'marker':
        addMarkerAtPlayhead();
        return true;
      case 'home':
        showTimeline.seek(0);
        return true;
      case 'end':
        showTimeline.seek(s.duration);
        return true;
      case 'clearSelection':
        clearTrackSelection();
        showTimeline.select(null);
        selectedMarkerId = null;
        return true;
      case 'takeover':
        return s.doc === 'timeline' && toggleTakeoverOnTarget();
      case 'returnAll':
      case 'returnAllInstant':
        liveTakeover.release('all', action === 'returnAllInstant' ? { mode: 'instant' } : undefined);
        return true;
      case 'heldTakeoverKey':
        return true;
      case 'go':
        showTimeline.go();
        return true;
    }
    return false;
  }
  onMount(() => setShowKeyHandler(handleShowKey));
  // Taken ahead of every other window listener (see installShowKeyCapture).
  onMount(() => installShowKeyCapture());
  // Markers are snap targets for clips and keys.
  onMount(() => {
    setShowSnapEdgeProvider(() => cues.markers.filter((m) => (m.doc ?? 'show') === get(showTimeline).doc).map((m) => m.time));
    return () => setShowSnapEdgeProvider(null);
  });

  const MOD_KEY = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';
  // Without a tempo map the grid is a quarter second: nothing to choose.
  const SNAP_GRID_CHOICES: Array<{ value: ShowSnapGrid; label: string }> = [
    { value: 'bar', label: 'Bar' },
    { value: 'beat', label: 'Beat' },
    { value: 'half', label: '½ beat' },
    { value: 'quarter', label: '¼ beat' },
    { value: 'sixteenth', label: '1/16' },
    { value: 'seconds', label: '¼ second' },
  ];

  /**
   * Cmd/Ctrl + wheel, and a trackpad pinch (which arrives as Ctrl + wheel):
   * zoom by how far the wheel turned, keeping the time under the pointer
   * where it is.
   */
  function handleWheel(e: WheelEvent) {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    if (!gridEl) return;
    const factor = wheelZoomFactor(e.deltaY, e.deltaMode);
    if (factor === 1) return;
    const from = get(showTimeline).zoom;
    const pointerX = e.clientX - gridEl.getBoundingClientRect().left;
    const time = (gridEl.scrollLeft + pointerX) / from;
    showTimeline.setZoom(from * factor);
    const to = get(showTimeline).zoom;
    if (to === from) return;
    // The grid is as wide as the new zoom only once Svelte has drawn it.
    void tick().then(() => {
      if (!gridEl) return;
      gridEl.scrollLeft = anchoredScrollLeft(time, to, pointerX);
      gridScrollLeft = gridEl.scrollLeft;
    });
  }

  /** The header column does not scroll itself: its wheel scrolls the grid
   *  (which the column follows), and Cmd/Ctrl + wheel zooms as there. */
  function handleLabelWheel(e: WheelEvent) {
    if (!gridEl) return;
    if (e.ctrlKey || e.metaKey) return handleWheel(e);
    const dy = wheelPixels(e.deltaY, e.deltaMode, gridEl.clientHeight);
    const dx = wheelPixels(e.deltaX, e.deltaMode, gridEl.clientWidth);
    if (!dy && !dx) return;
    e.preventDefault();
    gridEl.scrollTop += dy;
    gridEl.scrollLeft += dx;
  }

  // Playhead follow: playing (or jumping) off the visible stretch pages the
  // view on, so a long show never runs out of sight. Left alone when the
  // playhead was already off screen, i.e. the user scrolled away.
  let followPrevX: number | null = null;
  $effect(() => {
    const x = currentTime * zoom;
    untrack(() => {
      const prev = followPrevX;
      followPrevX = x;
      if (!gridEl || prev === null) return;
      // A zoom change moves the playhead's pixel position too; that is the
      // view changing, not the playhead.
      if (zoom !== followZoom) { followZoom = zoom; return; }
      // The mirrored scroll and width: reading the element's own would
      // force a layout on every playing frame.
      const next = followScrollLeft(prev, x, gridScrollLeft, gridWidth);
      if (next !== null) {
        gridEl.scrollLeft = next;
        gridScrollLeft = gridEl.scrollLeft;
      }
    });
  });
  let followZoom = 0;

  // A zoom change can clamp the grid's scroll without a scroll event; keep
  // the mirrored value (what the lanes draw from) true to it.
  $effect(() => {
    void zoom;
    void tick().then(() => { if (gridEl) gridScrollLeft = gridEl.scrollLeft; });
  });

  // How tight the transport is (0 roomy … 4 tightest): stepped up by
  // `transportFit` until the controls fit on one line. 1: the takeover's
  // return mode in a popover, shorter labels; 2: icons for the add/edit
  // chips, narrower pickers; 3: no dividers or total length, closer packing;
  // 4: Return as its arrow alone.
  const TRANSPORT_FIT_MAX = 4;
  let transportFitLevel = $state(0);

  let showClearConfirm = $state(false);
  function confirmClear() {
    showTimeline.clear();
    showClearConfirm = false;
  }
</script>

<svelte:window bind:innerHeight={viewportH} />

{#if !hiddenInVJ}
  <button data-help-page="show-timeline"
    class="show-toggle"
    class:active={isOpen}
    onclick={() => showTimeline.toggleDoc('show')}
    title="Show timeline"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="4" width="9" height="6" rx="1"/>
      <rect x="13" y="4" width="9" height="6" rx="1"/>
      <path d="M2 16h3l1.5-3L8 19l1.5-3H12l1.5-3L15 19l1.5-3H22"/>
    </svg>
    <span>Show</span>
  </button>
{/if}

{#if isOpen && !hiddenInVJ}
  <div data-help-page="show-timeline"
    class="show-tray"
    class:resizing={resizingTray}
    class:timeline-doc={isTimeline}
    style="height: {trayHeight}px"
    role="region"
    aria-label={isTimeline ? 'Timeline' : 'Show timeline'}
    data-show-doc={doc}
    onmouseenter={() => pointerInTray = true}
    onmouseleave={() => pointerInTray = false}
    onfocusin={() => focusInTray = true}
    onfocusout={() => focusInTray = false}
  >
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="tray-resize"
      onmousedown={startTrayResize}
      ondblclick={resetTrayHeight}
      title={isTimeline ? 'Drag to resize the Timeline panel — double-click to fit its contents' : 'Drag to resize the show panel — double-click to fit its contents'}
    >
      <div class="resize-grip"></div>
    </div>

    <div class="show-header-btns">
      <span class="show-doc-name" data-show-doc-name>{isTimeline ? 'Timeline' : 'Show'}</span>
      <button class="show-clear" onclick={() => showClearConfirm = true} title={isTimeline ? 'Clear the whole Timeline' : 'Clear the whole show'}>Clear</button>
      <button class="show-close" onclick={() => showTimeline.setOpen(false)} title={isTimeline ? 'Close the Timeline' : 'Close show timeline'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Transport -->
    <div
      class="show-transport"
      class:fit1={transportFitLevel >= 1}
      class:fit2={transportFitLevel >= 2}
      class:fit3={transportFitLevel >= 3}
      bind:clientHeight={transportH}
      use:transportFit={{ max: TRANSPORT_FIT_MAX, set: (level) => (transportFitLevel = level) }}
      data-transport-fit={transportFitLevel}
    >
      <button
        class="t-btn"
        class:active={isPlaying}
        disabled={duration <= 0}
        onclick={() => showTimeline.togglePlay()}
        title={isPlaying ? 'Pause show' : 'Play show'}
      >
        {#if isPlaying}
          <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3.5" height="10" fill="currentColor"/><rect x="7.5" y="1" width="3.5" height="10" fill="currentColor"/></svg>
        {:else}
          <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>
        {/if}
      </button>
      <button class="t-btn" onclick={() => showTimeline.stop()} title="Stop and rewind">
        <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="10" height="10" fill="currentColor"/></svg>
      </button>
      <button class="t-btn" class:active={loop} onclick={() => showTimeline.setLoop(!loop)} title="Loop the show">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M17 2l4 4-4 4"/><path d="M3 11V9a4 4 0 014-4h14"/>
          <path d="M7 22l-4-4 4-4"/><path d="M21 13v2a4 4 0 01-4 4H3"/>
        </svg>
      </button>
      {#if !loop}
        <select
          class="t-select t-end"
          value={endAction}
          onchange={(e) => showTimeline.setEndAction((e.currentTarget as HTMLSelectElement).value as ShowEndAction)}
          title="What happens when the show reaches its end"
          aria-label="At the end of the show"
        >
          {#each Object.entries(END_ACTION_LABELS) as [value, label]}
            <option {value}>{label}</option>
          {/each}
        </select>
      {/if}

      <span class="t-time">{formatPrecise(currentTime)}</span>
      <span class="t-sep t-fit-hide">/</span>
      <span class="t-total t-fit-hide" title="Total programmed show length">{formatPrecise(duration)}</span>
      {#if tempo}
        <span class="t-bars" title="Bar, beat and sixteenth at the playhead" data-show-bars-readout>{formatBarsBeats(tempo, currentTime, true)}</span>
      {/if}
      {#if isTimeline && sections.length}
        <button class="t-go" class:waiting={!!$showSectionStatus.holdId} onclick={() => showTimeline.go()} title={`GO: ${goText}. Enter while the pointer is over the Timeline; MIDI/OSC show/go.`} data-midi-path="show:go" data-section-go>GO</button>
        {#if sectionText}<span class="t-section" class:hold={!!$showSectionStatus.holdId} data-section-status>{sectionText}</span>{/if}
      {/if}

      <!-- Show audio output. Never hidden while the show has audio: a muted
           or blocked bus is exactly the state the user needs to SEE. -->
      {#if audioTracks.length > 0}
        <span class="t-divider"></span>
        <button
          class="t-btn t-audio"
          class:blocked={audioBlocked !== null}
          onclick={toggleAudioOutput}
          title={audioTitle}
          aria-label={audioTitle}
        >
          {#if audioBlocked !== null}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/>
            </svg>
          {:else}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
              <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
            </svg>
          {/if}
        </button>
<!-- Wrapper, not a width on the input: the app-wide
             `input[type="range"]:not(…)` skin in App.svelte sets width:100%
             at a specificity this scoped rule cannot beat. Constraining the
             parent keeps that shared track/thumb styling AND the size. -->
        <span class="t-audio-level">
          <input
            type="range"
            min="0" max="1" step="0.01"
            value={$clipAudioMaster.volume}
            disabled={audioMuted}
            oninput={(e) => clipAudioBus.setMasterVolume(+(e.currentTarget as HTMLInputElement).value)}
            title="Show audio output level"
            aria-label="Show audio output level"
          />
        </span>
        {#if $audioOutput.supported}
          <select
            class="t-select t-out"
            class:missing={$audioOutput.missing}
            value={$audioOutput.deviceId}
            onchange={(e) => void selectAudioOutput((e.currentTarget as HTMLSelectElement).value)}
            onfocus={() => startAudioOutputSelection()}
            title={$audioOutput.missing
              ? 'The chosen sound card is not connected: playing on the system default'
              : $audioOutput.error ?? 'Sound card the show audio plays on'}
            aria-label="Show audio output"
          >
            <option value="">System default</option>
            {#each $audioOutput.devices as device (device.deviceId)}
              <option value={device.deviceId} class="device-name">{device.label}</option>
            {/each}
            {#if $audioOutput.missing}
              <option value={$audioOutput.deviceId}>Not connected</option>
            {/if}
          </select>
        {/if}
        {#if audioBlocked !== null}
          <button class="t-audio-warn" onclick={fixAudioOutput} title="Click to restore show audio output">
            {CLIP_AUDIO_BLOCK_TEXT[audioBlocked]}
          </button>
        {/if}
      {/if}
      <ShowAudioDelayBadge />

      <span class="t-divider"></span>

      <button class="t-btn" onclick={() => showTimeline.setZoom(zoom / 1.4)} disabled={zoom <= SHOW_MIN_ZOOM} title="Zoom out">−</button>
      <button class="t-btn" onclick={() => showTimeline.setZoom(zoom * 1.4)} disabled={zoom >= SHOW_MAX_ZOOM} title="Zoom in">+</button>
      <button
        class="t-chip t-tempo"
        class:active={selectedTempo}
        class:has-map={!!tempo}
        onclick={() => showTimeline.select(selectedTempo ? null : { kind: 'tempo', id: 'tempo' })}
        title="The show's tempo map: BPM, time signature and where bar 1 is"
        data-show-tempo
      >
        {tempo ? `♩ ${Math.round(tempo.segments[0].bpm * 10) / 10}` : 'Tempo'}
      </button>
      <button class="t-chip" class:active={snapEnabled} onclick={() => showTimeline.setSnapEnabled(!snapEnabled)} title="Snap to the grid, clip edges, the playhead and markers (N). Hold {MOD_KEY} while dragging to move freely." data-show-snap>
        Snap
      </button>
      {#if tempo}
        <select
          class="t-select t-grid"
          value={snapGrid}
          onchange={(e) => showTimeline.setSnapGrid((e.currentTarget as HTMLSelectElement).value as ShowSnapGrid)}
          title="Snap grid"
          aria-label="Snap grid"
        >
          {#each SNAP_GRID_CHOICES as grid}
            <option value={grid.value}>{grid.label}</option>
          {/each}
        </select>
        <span class="t-seg" role="group" aria-label="Ruler">
          <button class="t-seg-btn" class:active={rulerMode === 'time'} onclick={() => showTimeline.setRulerMode('time')} title="Ruler in minutes and seconds">Time</button>
          <button class="t-seg-btn" class:active={rulerMode === 'bars'} onclick={() => showTimeline.setRulerMode('bars')} title="Ruler in bars and beats" data-show-ruler-bars>Bars</button>
        </span>
      {/if}

      <span class="t-divider"></span>

      {#if !isTimeline}
      <select class="t-select t-preset" bind:value={addPresetId} title="Preset to add">
        <option value="">Choose preset…</option>
        {#each comps as comp}
          <option value={comp.id}>{comp.name}</option>
        {/each}
      </select>
      <button class="t-chip" onclick={addPreset} disabled={comps.length === 0} title="Append this preset to the end of the show">
        + Preset
      </button>
      {/if}
      <button class="t-chip t-iconable" onclick={() => audioInput?.click()} title="Add an audio file" aria-label="Add an audio file">
        <span class="t-label">+ Audio</span>
        <svg class="t-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
          <path d="M5 2v8M1 6h8"/><path d="M14 18V6l8-2v12"/><circle cx="11.5" cy="18" r="2.5"/><circle cx="19.5" cy="16" r="2.5"/>
        </svg>
      </button>
      {#if !isTimeline}
      <!-- Transition palette. Drag onto the junction between two touching
           preset clips; the junction highlights as you pass over it. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span
        class="t-chip t-transition-chip"
        class:dragging={transitionDragActive}
        class:disabled={junctions.length === 0}
        draggable={junctions.length > 0}
        role="button"
        tabindex="0"
        ondragstart={handleTransitionDragStart}
        ondragend={handleTransitionDragEnd}
        title={junctions.length === 0
          ? 'Put two preset clips edge to edge first — a transition needs a junction'
          : 'Drag onto the junction between two clips to add a transition'}
      >
        <svg width="15" height="10" viewBox="0 0 15 10" aria-hidden="true">
          <path d="M0.5 0.5 L7.5 5 L0.5 9.5 Z M14.5 0.5 L7.5 5 L14.5 9.5 Z"
                fill="currentColor" fill-opacity="0.35" stroke="currentColor" stroke-width="1"/>
        </svg>
        <span class="t-label">Transition</span>
      </span>
      <button class="t-chip t-iconable" onclick={() => showTimeline.compactPresetClips()} disabled={presetClips.length < 2} title="Close every gap on the preset lane" aria-label="Close every gap on the preset lane">
        <span class="t-label">Compact</span>
        <svg class="t-icon" width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M1 6h4.5M3.5 3.5L6 6 3.5 8.5M15 6h-4.5M12.5 3.5L10 6l2.5 2.5M8 1v10"/>
        </svg>
      </button>
      {/if}

      <span class="t-divider"></span>

      <button class="t-chip" class:active={cuesOpen} onclick={toggleCues} title="Show the cue list beside the timeline" data-show-cues-toggle>
        Cues
      </button>
      {#if isTimeline}
        <button class="t-chip" class:active={sectionCuesOpen} onclick={toggleSectionCues} title="The Timeline's sections and markers as a cue list, with a big GO" data-section-cues-toggle>
          Sections
        </button>
      {/if}
      <button class="t-chip t-iconable" onclick={addMarkerAtPlayhead} title="Add a marker at the playhead. It fires the selected cue when the timeline plays across it." aria-label="Add a marker at the playhead. It fires the selected cue when the timeline plays across it." data-show-add-marker>
        <span class="t-label">+ Marker</span>
        <svg class="t-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 2v8M1 6h8"/><path d="M13 5h8v9l-4 5-4-5z"/>
        </svg>
      </button>
      {#if tc.lock !== 'off'}
        <span class="t-tc" class:locked={tc.lock === 'locked'} class:freewheel={tc.lock === 'freewheel'} class:lost={tc.lock === 'lost'} title={tc.error ?? `Timecode ${tc.lock}${tc.rate ? `, ${tc.rate} fps` : ''}`} data-show-tc-badge>
          <span class="t-tc-dot"></span>{tcText}{tc.label ? ` ${tc.label}` : ''}{tc.waiting ? ' · next bar' : ''}
        </span>
        {#if tcNoticeText}
          <span class="t-tc-warn" title={tcNoticeText} data-show-link-notice>⚠ {tc.notice === 'linkNoPeers' ? 'No Link peers' : 'Start Link to play'}</span>
        {/if}
        {#if tcMismatchText}
          <span class="t-tc-warn" title={tcMismatchText} data-show-tempo-mismatch>⚠ {tcSourceName} {tc.sourceBpm?.toFixed(1)} · show {tc.showBpm?.toFixed(1)} BPM</span>
        {/if}
      {/if}
      {#if isTimeline}
      <span class="t-divider"></span>
      <LineRecordControls />
      <span class="t-divider"></span>
      <ShowTakeoverControls fit={transportFitLevel} />
      {/if}
      <input
        class="hidden-file"
        type="file"
        accept="audio/*"
        multiple
        bind:this={audioInput}
        onchange={handleAudioPick}
      />
    </div>

    {#if $takeoverPadsOpen && isTimeline}
      <!-- The outer box may give way in a tight tray; the inner one reports
           the pads' own height, which the tray grows by. -->
      <div class="pads-wrap"><div bind:clientHeight={padsH}><TakeoverPads /></div></div>
    {/if}

    <div class="show-main">
    <div class="show-main-col">
    <!-- Body: lane labels + scrolling grid -->
    <div class="show-body">
      <div class="lane-labels" style="width: {labelWidth}px; flex-basis: {labelWidth}px" onwheel={handleLabelWheel}>
        <div class="label-ruler-spacer" style="height: {RULER_HEIGHT}px"></div>
        <!-- Translated, not scrolled: the grid owns the scroll and the ruler
             spacer above has to stay pinned the way the sticky ruler does.
             Matters now that a short tray really can clip the lane stack.
             Order: presets, layer tracks, audio. -->
        <div class="label-rows" style="transform: translateY({-laneScrollTop}px)">
          {#if isTimeline}
          <div class="lane-label sections" style="height: {SECTION_LANE_HEIGHT}px" data-sections-label>
            <span class="lane-name" title="Named spans of the Timeline with what happens at their end: play through, hold for GO, loop until GO, jump, or Live (pieces to the VJ decks until GO).">Sections</span>
            <button class="lane-line-add" onclick={addSectionAtPlayhead} title="Add a section at the playhead (8 bars, or up to the next section)" data-section-add>+</button>
            <button class="lane-line-add score" onclick={() => (scoreOpen = true)} disabled={!audioTracks.length} title={audioTracks.length ? 'Score this song: sections, looks, energy and where lines from the song on the Song row' : 'Put a song on the Song row first'} data-score-open>✦ Score</button>
          </div>
          <div class="lane-label look" style="height: {LOOK_LANE_HEIGHT}px">
            <span class="lane-name" title="Shape Looks along the Timeline: drag a Look card from the Looks gallery here. The shapes wear it for the block's span; overlapping blocks crossfade.">Looks</span>
            {#if lookClips.length > 0}
              <button class="lane-line-add" onclick={(e) => openLinePicker(e, 'looks')} title="Add a control line for a look block: intensity, speed, colour step, beat reaction, chase" data-line-picker-looks>⌇+</button>
            {/if}
          </div>
          {#if looksLines.length}
            <LineHeaders groupId={LOOKS_GROUP} lines={looksLines} expanded={$lineLayout.expanded.has(LOOKS_GROUP)} blockNames={lookNames} />
          {/if}
          <ShowTrackHeaders />
          <div class="lane-label stage" style="height: {STAGE_ROW_HEIGHT}px" data-stage-row>
            <span class="lane-name" title="The whole stage: Stage FX and LEDs. Lines here drive them along the Timeline.">Stage</span>
            <button class="lane-line-add" onclick={(e) => openLinePicker(e, 'stage')} title="Add a control line for a Stage FX or LED parameter" data-line-picker-stage>⌇+</button>
          </div>
          {#if stageLines.length}
            <LineHeaders groupId={STAGE_GROUP} lines={stageLines} expanded={$lineLayout.expanded.has(STAGE_GROUP)} />
          {/if}
          <LedRowHeaders />
          {#if ledLines.length && $ledRows.length}
            <LineHeaders groupId={LEDS_GROUP} lines={ledLines} expanded={$lineLayout.expanded.has(LEDS_GROUP)} blockNames={ledNames} />
          {/if}
          {:else}
          <div class="lane-label preset" style="height: {PRESET_LANE_HEIGHT}px">
            <span class="lane-name" title="Presets launched along the show, with transitions between them.">Presets</span>
          </div>
          {/if}
          {#if isTimeline}
            <SoundRowHeaders />
          {:else}
          {#each audioLanes as lane}
            <div class="lane-label audio" style="height: {AUDIO_LANE_HEIGHT}px">
              <span class="lane-name">Audio {lane + 1}</span>
            </div>
          {/each}
          {/if}
          {#if cameraLaneH > 0}<ShowCameraLaneLabel />{/if}
        </div>
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div
        class="show-grid"
        class:drag-hover={dragHover}
        bind:this={gridEl}
        bind:clientWidth={gridWidth}
        onclick={seekFromClick}
        onscroll={() => { laneScrollTop = gridEl?.scrollTop ?? 0; gridScrollLeft = gridEl?.scrollLeft ?? 0; }}
        onwheel={handleWheel}
        ondragover={handleDragOver}
        ondragleave={() => { dragHover = false; lookDropActive = false; }}
        ondrop={handleDrop}
      >
        <div class="show-ruler" style="width: {totalWidth}px; height: {RULER_HEIGHT}px" onmousedown={startScrub}>
          <ShowRuler {zoom} {rulerSeconds} {viewStart} {viewEnd} mode={rulerMode} tempo={tempo} />
          {#each visibleMarkers as marker (marker.id)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="show-marker"
              class:selected={marker.id === selectedMarkerId}
              class:unlinked={!marker.cueId}
              style="left: {marker.time * zoom}px"
              onmousedown={(e) => startMarkerDrag(e, marker.id, marker.time)}
              title={`Marker at ${formatPrecise(marker.time)}${marker.cueId ? `: fires ${cueLabel(cues.cues.find((c) => c.id === marker.cueId))}` : ' (no cue)'}. Drag to move.`}
              data-marker-id={marker.id}
            >
              <span class="show-marker-flag">{marker.label || markerCueLabel(marker.cueId)}</span>
            </div>
          {/each}
        </div>

        <div class="lanes" style="width: {totalWidth}px">
          {#if isTimeline}
          <SectionLane {sections} {tempo} height={SECTION_LANE_HEIGHT} {zoom} {viewStart} {viewEnd} {selection} snap={snapEnabled} />
          <ShowLookLane
            clips={lookClips}
            height={LOOK_LANE_HEIGHT}
            {zoom}
            {viewStart}
            {viewEnd}
            {selection}
            dropActive={lookDropActive}
            onblockdrag={(e, id, start) => startBlockDrag(e, 'look', id, start)}
            onblockresize={(e, id, edge) => startBlockResize(e, 'look', id, edge)}
          />

          {#if looksLines.length}
            <LineLanes groupId={LOOKS_GROUP} lines={looksLines} expanded={$lineLayout.expanded.has(LOOKS_GROUP)} {zoom} {viewStart} {viewEnd} blockSpans={lookSpans} />
          {/if}
          <ShowTrackLanes {zoom} {viewStart} {viewEnd} width={totalWidth} />
          <div class="stage-row-strip" style="height: {STAGE_ROW_HEIGHT}px"></div>
          {#if stageLines.length}
            <LineLanes groupId={STAGE_GROUP} lines={stageLines} expanded={$lineLayout.expanded.has(STAGE_GROUP)} {zoom} {viewStart} {viewEnd} />
          {/if}
          <LedRowLanes {zoom} {viewStart} {viewEnd} width={totalWidth} {selection} />
          {#if ledLines.length && $ledRows.length}
            <LineLanes groupId={LEDS_GROUP} lines={ledLines} expanded={$lineLayout.expanded.has(LEDS_GROUP)} {zoom} {viewStart} {viewEnd} blockSpans={ledSpans} />
          {/if}
          {:else}
          <ShowPresetLane
            clips={presetClips}
            {junctions}
            height={PRESET_LANE_HEIGHT}
            {zoom}
            {viewStart}
            {viewEnd}
            {selection}
            {activeClipId}
            names={compositionNames}
            {transitionDragActive}
            {transitionDropTarget}
            onblockdrag={(e, id, start) => startBlockDrag(e, 'preset', id, start)}
            onblockresize={(e, id, edge) => startBlockResize(e, 'preset', id, edge)}
            ontransitionresize={startTransitionResize}
            oncreatetransition={createTransitionAt}
            onselecttransition={(clipId) => showTimeline.select({ kind: 'transition', id: clipId })}
            onremovetransition={(clipId) => showTimeline.removeTransitionAt(clipId)}
          />
          {/if}

          {#if isTimeline}
            <SoundRowLanes {zoom} {viewStart} {viewEnd} />
          {:else}
          {#each audioLanes as lane}
            <ShowAudioLane
              tracks={audioByLane[lane]}
              height={AUDIO_LANE_HEIGHT}
              {zoom}
              {viewStart}
              {viewEnd}
              {selection}
              empty={lane === 0 && audioTracks.length === 0}
              onpicksong={pickSongForShow}
              onblockdrag={(e, id, start) => startBlockDrag(e, 'audio', id, start)}
              onblockresize={(e, id, edge) => startBlockResize(e, 'audio', id, edge)}
            />
          {/each}
          {/if}
          {#if cameraLaneH > 0}<ShowCameraLane {zoom} />{/if}
        </div>

        {#each barLines as line}
          <div class="show-bar-line" class:beat={!line.bar} style="left: {line.x}px; top: {RULER_HEIGHT}px; height: {laneStackH - RULER_HEIGHT}px"></div>
        {/each}

        {#each visibleMarkers as marker (marker.id)}
          <div class="show-marker-line" class:selected={marker.id === selectedMarkerId} style="left: {marker.time * zoom}px; height: {laneStackH}px"></div>
        {/each}

        {#if $showSnapGuide !== null}
          <div class="show-snap-guide" style="left: {$showSnapGuide * zoom}px; height: {laneStackH}px" data-show-snap-guide></div>
        {/if}

        <div class="show-playhead" style="transform: translateX({playheadX}px)" onmousedown={startScrub}>
          <div class="playhead-handle"></div>
          <div class="playhead-line"></div>
        </div>
      </div>
    </div>

    <!-- Inspector -->
    {#if selectedMarker}
      <div class="show-inspector" bind:clientHeight={inspectorH} data-marker-inspector>
        <span class="insp-title">Marker</span>
        <label class="insp-field">
          <span>At</span>
          <input
            type="number" min="0" step="0.25"
            value={selectedMarker.time.toFixed(2)}
            onchange={(e) => { const id = selectedMarker.id; commitNumber(e, (v) => cueList.updateMarker(id, { time: v || 0 }), () => cueList.state.markers.find((m) => m.id === id)?.time); }}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field insp-wide">
          <span>Fires</span>
          <select
            value={selectedMarker.cueId ?? ''}
            onchange={(e) => cueList.updateMarker(selectedMarker.id, { cueId: (e.target as HTMLSelectElement).value || null })}
            data-marker-cue
          >
            <option value="">No cue</option>
            {#each cues.cues as cue (cue.id)}
              <option value={cue.id}>{cueLabel(cue)}</option>
            {/each}
          </select>
        </label>
        <label class="insp-field">
          <span>Label</span>
          <input
            type="text"
            value={selectedMarker.label}
            placeholder={markerCueLabel(selectedMarker.cueId)}
            onchange={(e) => cueList.updateMarker(selectedMarker.id, { label: (e.target as HTMLInputElement).value })}
          />
        </label>
        <button class="insp-delete" onclick={deleteSelected}>Delete</button>
        <button aria-label="Close marker inspector" class="insp-close" onclick={() => (selectedMarkerId = null)}>×</button>
      </div>
    {:else if selectedSection}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <SectionInspector section={selectedSection} {sections} rows={layerTracks} {tempo} onclose={() => showTimeline.select(null)} />
      </div>
    {:else if selectedTempo}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <ShowTempoInspector
          tempo={tempo}
          playhead={currentTime}
          audioTracks={audioTracks}
          onclose={() => showTimeline.select(null)}
        />
      </div>
    {:else if selectedLedClip}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <LedBlockInspector clip={selectedLedClip} onclose={() => showTimeline.select(null)} />
      </div>
    {:else if soundSelection}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <SoundInspector selection={soundSelection} onclose={() => showTimeline.select(null)} />
      </div>
    {:else if selectedLookClip}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <ShowLookInspector clip={selectedLookClip} layers={$liveLayersStore} onclose={() => showTimeline.select(null)} />
      </div>
    {:else if layerClipInspector}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <ShowClipInspector
          clip={selectedLayerClipFound?.clip ?? null}
          track={selectedLayerClipFound?.track ?? null}
          count={Math.max(selectedLayerClipCount, selectedLayerClipFound ? 1 : 0)}
          ondelete={() => deleteTrackSelection(false)}
          onclose={() => { clearTrackSelection(); showTimeline.select(null); }}
        />
      </div>
    {:else if selectedTrack}
      <div class="insp-wrap" bind:clientHeight={inspectorH}>
        <ShowTrackInspector track={selectedTrack} onStage={selectedTrackOnStage} onclose={() => showTimeline.select(null)} />
      </div>
    {:else if selectedPreset}
      <div class="show-inspector" bind:clientHeight={inspectorH}>
        <span class="insp-title">Preset clip</span>
        <label class="insp-field insp-wide">
          <span>Composition</span>
          <select
            value={selectedPreset.compositionId}
            onchange={(e) => showTimeline.updatePresetClip(selectedPreset.id, {
              compositionId: (e.target as HTMLSelectElement).value,
              label: comps.find((c) => c.id === (e.target as HTMLSelectElement).value)?.name,
            })}
          >
            {#each comps as comp}
              <option value={comp.id}>{comp.name}</option>
            {/each}
            {#if !comps.some((c) => c.id === selectedPreset.compositionId)}
              <option value={selectedPreset.compositionId}>{selectedPreset.label ?? 'Missing preset'}</option>
            {/if}
          </select>
        </label>
        <label class="insp-field">
          <span>Start</span>
          <input
            type="number" min="0" step="0.25"
            value={selectedPreset.startTime.toFixed(2)}
            onchange={(e) => { const id = selectedPreset.id; commitNumber(e, (v) => showTimeline.movePresetClip(id, v), () => livePreset(id)?.startTime); }}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field">
          <span>Duration</span>
          <input
            type="number" min="0.25" step="0.25"
            value={selectedPreset.duration.toFixed(2)}
            onchange={(e) => { const clip = selectedPreset; commitNumber(e, (v) => showTimeline.resizePresetClip(clip.id, 'end', clip.startTime + v), () => livePreset(clip.id)?.duration); }}
          />
          <span class="insp-unit">s</span>
        </label>

        <button class="insp-delete" onclick={deleteSelected}>Delete</button>
        <button aria-label="Close selected timeline item" class="insp-close" onclick={() => showTimeline.select(null)}>×</button>
      </div>
    {:else if selectedTransitionClip}
      <!-- Transition inspector. The element on the timeline is the primary
           control; this is where the exact numbers live. -->
      <div class="show-inspector" bind:clientHeight={inspectorH}>
        <span class="insp-title">Transition</span>
        <span class="insp-junction">
          {compositionName(selectedTransitionWindow?.prev.compositionId ?? '', selectedTransitionWindow?.prev.label)}
          <span class="insp-arrow">→</span>
          {compositionName(selectedTransitionClip.compositionId, selectedTransitionClip.label)}
        </span>
        <label class="insp-field">
          <span>Type</span>
          <select
            class="insp-transition"
            value={selectedTransitionWindow?.style ?? 'dissolve'}
            onchange={(e) => showTimeline.setTransitionStyle(
              selectedTransitionClip.id,
              (e.target as HTMLSelectElement).value as CompositionTransitionStyle,
            )}
            title="How the two compositions blend. Every entry renders differently — see stores/presetTransition.ts."
          >
            {#each TRANSITION_OPTIONS as opt}
              <option value={opt.value}>{opt.label}</option>
            {/each}
          </select>
        </label>
        <label class="insp-field">
          <span>Duration</span>
          <input
            class="insp-fade"
            type="number"
            min={SHOW_MIN_TRANSITION_SECONDS}
            max={selectedTransitionMax}
            step="0.25"
            value={(selectedTransitionWindow?.duration ?? 0).toFixed(2)}
            onchange={(e) => { const clip = selectedTransitionClip; commitNumber(e, (v) => showTimeline.setTransitionDuration(clip.id, v || 0), () => {
              const s = get(showTimeline); const c = s.presetClips.find((x) => x.id === clip.id);
              return c ? showTransitionWindow(s.presetClips, c)?.duration ?? 0 : undefined;
            }); }}
          />
          <span class="insp-unit">s</span>
        </label>
        <span class="insp-hint" title="The window is centred on the junction — half of it plays over the outgoing clip and half over the incoming one.">
          {formatPrecise(selectedTransitionWindow?.start ?? 0)} → {formatPrecise(selectedTransitionWindow?.end ?? 0)}
        </span>
        {#if selectedTransitionClamped}
          <span
            class="insp-note"
            title="Clamped to the shorter of the two clips it sits between — a transition can never be longer than the material it has to work with."
          >clamped from {requestedTransitionDuration(selectedTransitionClip).toFixed(2)}s</span>
        {/if}
        <button class="insp-delete" onclick={deleteSelected} title="Remove the transition — the junction goes back to a hard cut">Delete</button>
        <button aria-label="Close selected timeline item" class="insp-close" onclick={() => showTimeline.select(null)}>×</button>
      </div>
    {:else if selectedAudio}
      <div class="show-inspector" bind:clientHeight={inspectorH}>
        <span class="insp-title">Audio track</span>
        <label class="insp-field insp-wide">
          <span>Name</span>
          <input
            type="text"
            value={selectedAudio.name}
            onchange={(e) => showTimeline.renameAudioTrack(selectedAudio.id, (e.target as HTMLInputElement).value)}
          />
        </label>
        <label class="insp-field">
          <span>Start</span>
          <input
            type="number" min="0" step="0.25"
            value={selectedAudio.startTime.toFixed(2)}
            onchange={(e) => { const id = selectedAudio.id; commitNumber(e, (v) => showTimeline.moveAudioTrack(id, v), () => liveAudio(id)?.startTime); }}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field">
          <span>Length</span>
          <input
            type="number" min="0.25" step="0.25"
            value={selectedAudio.duration.toFixed(2)}
            onchange={(e) => { const t = selectedAudio; commitNumber(e, (v) => showTimeline.resizeAudioTrack(t.id, 'end', t.startTime + v), () => liveAudio(t.id)?.duration); }}
          />
          <span class="insp-unit">s</span>
        </label>
        <label class="insp-field">
          <span>Vol</span>
          <input
            class="insp-range"
            type="range" min="0" max="1" step="0.01"
            value={selectedAudio.volume}
            oninput={(e) => showTimeline.setAudioTrackVolume(selectedAudio.id, parseFloat((e.target as HTMLInputElement).value))}
          />
        </label>
        <button
          class="insp-chip"
          class:on={selectedAudio.muted}
          onclick={() => showTimeline.setAudioTrackMuted(selectedAudio.id, !selectedAudio.muted)}
        >{selectedAudio.muted ? 'Muted' : 'Mute'}</button>
        {#if !selectedAudio.url}
          <span class="insp-warn">Media missing — re-add the file</span>
        {:else}
          <button
            class="insp-chip"
            disabled={detectingTempo}
            onclick={() => detectTempoFrom(selectedAudio.id)}
            title="Find this song's tempo and beats and make them the show's grid"
            data-audio-detect-tempo
          >{detectingTempo ? 'Listening…' : 'Detect tempo'}</button>
          {#if tempoNote}<span class="insp-tempo-note" class:warn={!tempoNote.ok} data-audio-tempo-note>{#if tempoNote.ok}{tempoNote.bpm} BPM: the grid follows the song{:else if tempoNote.reason === 'no-pulse'}No steady beat found{:else}This track could not be read{/if}</span>{/if}
        {/if}
        <button class="insp-delete" onclick={deleteSelected}>Delete</button>
        <button aria-label="Close selected timeline item" class="insp-close" onclick={() => showTimeline.select(null)}>×</button>
      </div>
    {:else if hasTracks}
      <div class="show-inspector insp-idle" bind:clientHeight={inspectorH}>
        <span class="insp-hint">Each row is a mapping layer. Drop media on a row; click a block to edit it in Properties and Shader Parameters, or click a Media Library card to replace its media; click a row name for its settings. S splits at the playhead, Shift+Delete closes the gap, ? lists every key.</span>
      </div>
    {/if}

    </div>
    {#if isTimeline && sectionCuesOpen}
      <SectionCueList {sections} {currentTime} playing={isPlaying} />
    {/if}
    {#if cuesOpen}
      <CueListPanel />
    {/if}
    </div>
    {#if scoreOpen}
      <ScoreDialog onclose={() => (scoreOpen = false)} />
    {/if}

    {#if showClearConfirm}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <div class="show-modal-backdrop" onclick={() => showClearConfirm = false}>
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <div class="show-modal" onclick={(e) => e.stopPropagation()}>
          {#if isTimeline}
          <h3>Clear the Timeline?</h3>
          <p>This removes every block, lane, look and audio track from the Timeline. The Show, your presets and media files are not touched.</p>
          {:else}
          <h3>Clear the show?</h3>
          <p>This removes every audio track and preset clip from the timeline. The Timeline, your presets and media files are not touched.</p>
          {/if}
          <div class="show-modal-btns">
            <button class="modal-cancel" onclick={() => showClearConfirm = false}>Cancel</button>
            <button class="modal-confirm" onclick={confirmClear}>{isTimeline ? 'Clear Timeline' : 'Clear show'}</button>
          </div>
        </div>
      </div>
    {/if}
  </div>
  {#if isTimeline}<LineDiamondOverlay />{/if}
{/if}

{#if linePicker}
  <LinePicker targets={linePickerTargets} x={linePicker.x} y={linePicker.y} onclose={() => (linePicker = null)} />
{/if}

<style>
  .show-toggle {
    position: fixed;
    bottom: 24px;
    left: calc(50% + 320px);
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
  .show-toggle:hover {
    border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
  .show-toggle.active {
    border-color: var(--ga-selection-line, #5278ff);
    background: var(--ga-selection-bg, #1f3170);
    color: var(--ga-selection-ink, #e0e8ff);
  }

  /* Height comes from the inline style (auto-fit to content, or the user's
     dragged override) — see the "Tray height" block in the script.

     The background is FULLY OPAQUE on purpose. At 0.98 alpha the canvas and
     the layer-panel chrome behind it ghosted straight through, which is
     unreadable over high-contrast visuals; every inner surface below is
     opaque for the same reason. Anything wanting a blur here has to sit on
     top of this base layer, not replace it. */
  .show-tray {
    position: fixed;
    bottom: var(--ga-bottom-rail-offset, 74px);
    left: 0;
    right: 0;
    z-index: 90;
    background: var(--ga-panel, #0a0a0e);
    border-top: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    animation: slideUp 0.2s ease-out;
    box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.5);
  }
  /* Suppress the entry animation mid-drag: re-running it on every reactive
     height change makes the panel visibly jitter under the pointer. */
  .show-tray.resizing { animation: none; }
  @keyframes slideUp {
    from { transform: translateY(100%); }
    to { transform: translateY(0); }
  }

  .tray-resize {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 7px;
    z-index: 12;
    cursor: ns-resize;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .resize-grip {
    width: 40px;
    height: 3px;
    border-radius: 2px;
    background: var(--ga-line-3, rgba(255, 255, 255, 0.24));
  }
  .tray-resize:hover .resize-grip,
  .show-tray.resizing .resize-grip {
    background: var(--ga-ink-1, #aaa);
  }

  .show-header-btns {
    position: absolute;
    top: 6px;
    right: 10px;
    z-index: 10;
    display: flex;
    gap: 6px;
    align-items: center;
  }
  /* Which tab the tray is showing: the Show or the Timeline. */
  .show-doc-name {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    font-weight: 700;
    color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 75%, #ffffff);
    padding-right: 4px;
  }
  .show-tray.timeline-doc .show-doc-name { color: color-mix(in srgb, #8c78ff 75%, #ffffff); }
  .show-clear {
    height: var(--ga-control-h, 26px);
    background: transparent;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 4px);
    cursor: pointer;
    font-family: inherit;
  }
  .show-clear:hover { border-color: color-mix(in srgb, var(--ga-rec, #ff4438) 55%, transparent); color: var(--ga-rec, #ff4438); }
  .show-close {
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
  }
  .show-close:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }

  .show-transport {
    display: flex;
    align-items: center;
    gap: 6px;
    /* 7px of top padding clears the resize strip so the transport buttons
       are not sitting under an ns-resize cursor. */
    padding: 7px 12px 5px;
    padding-right: 180px;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    background: var(--ga-bar, #0a0a0e);
    flex-shrink: 0;
    flex-wrap: wrap;
  }
  .t-btn {
    background: none;
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #888);
    width: var(--ga-control-h, 26px);
    height: var(--ga-control-h, 26px);
    border-radius: var(--ga-r-hard, 4px);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-size: 14px;
    font-family: inherit;
  }
  .t-btn:hover:not(:disabled):not(.active) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .t-btn:disabled { opacity: 0.35; cursor: default; }
  .t-btn.active { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .t-chip {
    display: inline-flex;
    align-items: center;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    border-radius: var(--ga-r-hard, 4px);
    padding: 0 10px;
    cursor: pointer;
    font-family: inherit;
  }
  .t-chip:hover:not(:disabled):not(.active) { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .t-chip:disabled { opacity: 0.35; cursor: default; }
  .t-chip.active {
    color: var(--ga-selection-ink, #e0e8ff);
    border-color: var(--ga-selection-line, #5278ff);
    background: var(--ga-selection-bg, #1f3170);
  }
  .t-select {
    height: var(--ga-control-h, 26px);
    background: var(--ga-slot, rgba(0, 0, 0, 0.4));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-0, #aaa);
    font-size: var(--ga-text-control, 12px);
    border-radius: var(--ga-r-hard, 3px);
    padding: 0 6px;
    outline: none;
    max-width: 170px;
    font-family: inherit;
  }
  .t-time {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-0, #ddd);
    min-width: 58px;
    text-align: center;
  }
  .t-total {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-2, #888);
    min-width: 58px;
  }
  .t-sep { color: var(--ga-ink-3, #444); }
  .t-divider { width: 1px; height: 18px; background: var(--ga-line-2, rgba(255, 255, 255, 0.12)); margin: 0 4px; }
  .hidden-file { display: none; }

  /* Audio output — amber when the show is audible, red when something is
     silencing it, so a dead show is never mistaken for a working one.
     Literal hex rather than --ga-coral: that token resolves to a near-white
     (#e7eef5) on the current theme, which would render the warning state
     indistinguishable from every other control in this bar. */
  .t-audio { color: #fbbf24; border-color: rgba(251, 191, 36, 0.35); }
  .t-audio:hover:not(:disabled) { color: #fde68a; border-color: rgba(251, 191, 36, 0.6); }
  .t-audio.blocked {
    color: #f87171;
    border-color: rgba(248, 113, 113, 0.6);
    background: rgba(248, 113, 113, 0.15);
  }
  .t-audio.blocked:hover { color: #fca5a5; border-color: #f87171; }
  .t-audio-level {
    display: flex;
    align-items: center;
    flex: 0 0 62px;
    width: 62px;
    accent-color: #fbbf24;
  }
  .t-audio-warn {
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    font-family: inherit;
    color: #f87171;
    background: rgba(248, 113, 113, 0.12);
    border: 1px solid rgba(248, 113, 113, 0.45);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
  }
  .t-audio-warn:hover { color: #fff; background: rgba(248, 113, 113, 0.25); border-color: #f87171; }

  /* `flex: 1` + `min-height: 0` is what lets the tray be short: the body
     takes whatever is left after the transport and the inspector have had
     their intrinsic heights, and the grid inside it scrolls. Without the
     min-height a wrapped transport bar or a tall lane stack would refuse to
     shrink and push the inspector out through the bottom of the tray. */
  .show-body {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  /* Lanes + inspector on the left, the cue list (when open) on the right. */
  .show-main {
    display: flex;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .show-main-col {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  /* Markers: a flag on the ruler, a hairline through the lanes. */
  .show-marker {
    position: absolute;
    top: 0;
    height: 100%;
    z-index: 5;
    transform: translateX(-1px);
    cursor: grab;
  }
  .show-marker-flag {
    position: absolute;
    top: 2px;
    left: 0;
    padding: 0 4px;
    height: 15px;
    line-height: 15px;
    font-size: 9px;
    font-weight: 700;
    color: #1a1204;
    background: #f0c674;
    border-radius: 0 3px 3px 0;
    white-space: nowrap;
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
  }
  .show-marker.unlinked .show-marker-flag { background: #7a7a86; color: #111; }
  .show-marker.selected .show-marker-flag { box-shadow: 0 0 0 1px #fff; }
  .show-marker-line {
    position: absolute;
    top: 0;
    width: 1px;
    background: rgba(240, 198, 116, 0.45);
    pointer-events: none;
    z-index: 3;
  }
  .show-marker-line.selected { background: #f0c674; }
  .show-bar-line {
    position: absolute;
    width: 1px;
    background: rgba(255, 255, 255, 0.07);
    pointer-events: none;
    z-index: 2;
  }
  .show-bar-line.beat { background: rgba(255, 255, 255, 0.03); }
  .t-bars {
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    font-size: var(--ga-text-meta, 11px);
    color: #FFD96B;
    min-width: 52px;
  }
  .t-go {
    height: 24px;
    min-width: 52px;
    padding: 0 12px;
    border-radius: 4px;
    border: 1px solid #2fa35a;
    background: #1d6b3a;
    color: #eaffef;
    font: inherit;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
  }
  .t-go.waiting { background: #2fa35a; box-shadow: 0 0 0 2px rgba(47, 163, 90, 0.45); }
  .t-go:hover { filter: brightness(1.1); }
  .t-section { font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-1, #bbb); max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t-section.hold { color: #ffd36b; font-weight: 600; }
  .t-tempo.has-map { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .t-tc-warn {
    display: inline-flex;
    align-items: center;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    padding: 0 8px;
    font-size: var(--ga-text-meta, 11px);
    color: #f0c674;
    border: 1px solid rgba(240, 198, 116, 0.45);
    border-radius: var(--ga-r-hard, 4px);
    background: rgba(240, 198, 116, 0.08);
  }

  /* Timecode lock badge in the transport. */
  .t-tc {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: var(--ga-control-h, 26px);
    box-sizing: border-box;
    font-size: var(--ga-text-meta, 11px);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    color: var(--ga-ink-1, #aaa);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 4px);
    padding: 0 8px;
  }
  .t-tc-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--ga-ink-3, #777); }
  .t-tc.locked .t-tc-dot { background: #5fdc76; box-shadow: 0 0 6px #5fdc76; }
  .t-tc.freewheel .t-tc-dot { background: #f0c674; }
  .t-tc.lost .t-tc-dot { background: #f87171; }
  .lane-labels {
    width: 108px;
    flex: 0 0 auto;
    background: var(--ga-card, #0e0e12);
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    overflow: hidden;
  }
  .label-ruler-spacer { border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12)); }
  .label-rows { will-change: transform; }
  .lane-label {
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
    box-sizing: border-box;
  }
  /* Lane names: eyebrow. */
  .lane-name {
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    font-weight: 700;
  }
  .lane-label.preset .lane-name { color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 75%, #ffffff); }
  .lane-label.look .lane-name { color: color-mix(in srgb, #8c78ff 75%, #ffffff); }
  .lane-label.stage .lane-name { color: color-mix(in srgb, #5ce1e6 75%, #ffffff); }
  .lane-label.stage { background: rgba(92, 225, 230, 0.03); }
  .lane-line-add {
    margin-left: auto;
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #aaa);
    border-radius: 3px;
    font: inherit;
    font-size: 11px;
    padding: 0 6px;
    height: 18px;
    cursor: pointer;
  }
  .lane-line-add:hover { color: var(--ga-ink-0, #fff); border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  .lane-label.sections .lane-line-add + .lane-line-add { margin-left: 4px; }
  .lane-line-add.score { color: #ffd36b; border-color: rgba(255, 211, 107, 0.45); }
  .lane-line-add:disabled { opacity: 0.4; cursor: default; }
  .stage-row-strip { border-bottom: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07)); background: rgba(92, 225, 230, 0.03); box-sizing: border-box; }

  .show-grid {
    flex: 1;
    min-width: 0;
    overflow: auto;
    position: relative;
    background: var(--ga-void, #08080c);
    cursor: crosshair;
  }
  .show-grid.drag-hover { background: #12100c; box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ga-coral, #ff6f5e) 45%, transparent); }

  .show-ruler {
    position: sticky;
    top: 0;
    z-index: 4;
    background: var(--ga-card, #0e0e12);
    border-bottom: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    cursor: col-resize;
  }
  /* Ruler ticks: ShowRuler.svelte. */

  .lanes { position: relative; }
  .t-end { max-width: 160px; }
  .t-out { max-width: 150px; }
  /* Tighter, step by step, until the transport fits on one line. */
  .t-icon { display: none; }
  .fit2 .t-iconable { padding: 0 8px; }
  .fit2 .t-iconable .t-label, .fit2 .t-transition-chip .t-label { display: none; }
  .fit2 .t-icon { display: block; }
  .fit2 .t-end { max-width: 104px; }
  .fit2 .t-out { max-width: 104px; }
  .fit2 .t-preset { max-width: 104px; }
  .fit3.show-transport { gap: 4px; }
  .fit3 .t-divider, .fit3 .t-fit-hide { display: none; }
  .fit3 .t-end, .fit3 .t-out, .fit3 .t-preset { max-width: 80px; }
  .t-out.missing { border-color: rgba(251, 191, 36, 0.6); color: #fbbf24; }

  .t-transition-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: grab;
    color: #FFD96B;
    border-color: rgba(255, 217, 107, 0.4);
  }
  .t-transition-chip:hover { border-color: rgba(255, 217, 107, 0.8); }
  .t-transition-chip.dragging { cursor: grabbing; opacity: 0.6; }
  .t-transition-chip.disabled {
    opacity: 0.35;
    cursor: default;
    color: var(--ga-ink-1, #aaa);
    border-color: var(--ga-line-2, rgba(255, 255, 255, 0.12));
  }

  .show-snap-guide {
    position: absolute;
    top: 0;
    width: 1px;
    margin-left: -0.5px;
    background: #5ce1e6;
    box-shadow: 0 0 6px rgba(92, 225, 230, 0.8);
    pointer-events: none;
    z-index: 7;
  }
  .insp-wrap { flex: 0 0 auto; }
  .insp-idle { min-height: 36px; }
  .pads-wrap { flex: 0 1 auto; min-height: 64px; overflow: hidden; }
  .t-grid { max-width: 96px; }
  .t-seg { display: inline-flex; }
  .t-seg-btn {
    height: var(--ga-control-h, 26px);
    padding: 0 8px;
    font: inherit;
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    color: var(--ga-ink-1, #aaa);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    cursor: pointer;
  }
  .t-seg-btn:first-child { border-radius: var(--ga-r-hard, 4px) 0 0 var(--ga-r-hard, 4px); }
  .t-seg-btn:last-child { border-radius: 0 var(--ga-r-hard, 4px) var(--ga-r-hard, 4px) 0; border-left: 0; }
  .t-seg-btn.active { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }

  /* Click-through below the ruler: a click in a lane seeks, and the line
     that lands under the pointer must not swallow the second click of a
     double-click (adding a key) or a press on a clip edge. The ruler and
     the handle still scrub. */
  /* Placed by `transform` on its own layer: moving it every frame of a
     playing show must not repaint the lanes underneath. */
  .show-playhead {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    z-index: 6;
    cursor: col-resize;
    pointer-events: none;
    will-change: transform;
  }
  .playhead-handle { pointer-events: auto; cursor: col-resize; }
  .playhead-handle {
    position: absolute;
    top: 0;
    left: -5px;
    width: 11px;
    height: 10px;
    background: #FFD96B;
    clip-path: polygon(0 0, 100% 0, 50% 100%);
  }
  .playhead-line {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 1px;
    background: #FFD96B;
    opacity: 0.85;
  }

  .show-inspector {
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
    flex-wrap: wrap;
  }
  /* Gold ties the inspector to the selected block's gold outline. */
  .insp-title {
    color: #FFD96B;
    font-weight: var(--ga-weight-control, 600);
    font-size: var(--ga-text-control, 12px);
    padding-right: 12px;
    border-right: 1px solid var(--ga-line, rgba(255, 255, 255, 0.07));
  }
  .insp-field { display: flex; align-items: center; gap: 6px; }
  .insp-field > span { color: var(--ga-ink-2, #888); }
  .insp-field input[type="number"],
  .insp-field input[type="text"],
  .insp-field select {
    height: var(--ga-control-h-sm, 22px);
    background: var(--ga-slot, rgba(255, 255, 255, 0.04));
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-hard, 3px);
    color: var(--ga-ink-0, #e8e8e8);
    font-size: var(--ga-text-control, 12px);
    padding: 0 6px;
    width: 78px;
    outline: none;
    font-family: inherit;
  }
  .insp-field input[type="number"] { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); }
  .insp-wide input[type="text"], .insp-wide select { width: 168px; }
  .insp-field select.insp-transition { width: 118px; }
  .insp-field input.insp-fade { width: 62px; }
  .insp-range { width: 90px; }
  .insp-unit { color: var(--ga-ink-2, #888); }
  /* Shown only when the transition-length clamp actually shortens the
     value the user typed. */
  .insp-note {
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    color: #FFD96B;
    background: rgba(255, 217, 107, 0.1);
    border: 1px solid rgba(255, 217, 107, 0.3);
    border-radius: 3px;
    padding: 2px 6px;
    white-space: nowrap;
  }
  .insp-junction {
    font-size: var(--ga-text-control, 12px);
    color: var(--ga-ink-1, #bbb);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }
  .insp-arrow { color: #FFD96B; padding: 0 3px; }
  .insp-hint {
    font-size: var(--ga-text-meta, 11px);
    color: var(--ga-ink-2, #888);
    font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace);
    white-space: nowrap;
  }
  .insp-chip {
    height: var(--ga-control-h-sm, 22px);
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    color: var(--ga-ink-1, #bbb);
    font-size: var(--ga-text-control, 12px);
    font-weight: var(--ga-weight-control, 600);
    padding: 0 10px;
    border-radius: var(--ga-r-hard, 3px);
    cursor: pointer;
    font-family: inherit;
  }
  .insp-chip:hover:not(.on) { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); color: var(--ga-ink-0, #fff); }
  .insp-chip.on { color: var(--ga-selection-ink, #e0e8ff); background: var(--ga-selection-bg, #1f3170); border-color: var(--ga-selection-line, #5278ff); }
  .insp-warn { color: var(--ga-rec, #FF6B6B); font-size: var(--ga-text-meta, 11px); }
  .insp-tempo-note { color: var(--ga-ink-2, #888); font-size: var(--ga-text-meta, 11px); }
  .insp-tempo-note.warn { color: #f0c674; }
  .insp-delete {
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
    font-family: inherit;
  }
  .insp-delete:hover { background: color-mix(in srgb, var(--ga-rec, #ff4757) 14%, transparent); }
  .insp-close {
    background: none;
    border: none;
    color: var(--ga-ink-2, #888);
    font-size: 16px;
    cursor: pointer;
    padding: 2px 6px;
    line-height: 1;
  }
  .insp-close:hover { color: var(--ga-ink-0, #fff); }

  .show-modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .show-modal {
    background: var(--ga-raise, #14141a);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: var(--ga-r-soft, 8px);
    padding: 16px 20px;
    max-width: 400px;
    box-shadow: 0 8px 40px rgba(0, 0, 0, 0.8);
  }
  .show-modal h3 {
    margin: 0 0 8px 0;
    color: var(--ga-ink-0, #fff);
    font-size: var(--ga-text-heading, 16px);
    font-weight: var(--ga-weight-title, 650);
  }
  .show-modal p {
    margin: 0 0 16px 0;
    color: var(--ga-ink-1, #aaa);
    font-size: var(--ga-text-body, 13px);
    line-height: 1.5;
  }
  .show-modal-btns { display: flex; gap: 8px; justify-content: flex-end; }
  .modal-cancel {
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
  .modal-cancel:hover { border-color: var(--ga-line-3, rgba(255, 255, 255, 0.24)); }
  /* Destructive: record red on purpose. */
  .modal-confirm {
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
  .modal-confirm:hover { filter: brightness(1.1); }
</style>
