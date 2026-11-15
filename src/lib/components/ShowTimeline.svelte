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
  import { lineRecordState } from '../timeline/lines/timelineLines';
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
  import type { CompositionTransitionStyle, Effect, ShowAudioTrack, ShowLayerClip, ShowLayerTrack, ShowPresetClip, StageEffect } from '../types';
  import { compositions } from '../stores/layers';
  import { vjClipLauncher } from '../stores/vjClipLauncher';
  import { clipAudioBus, clipAudioMaster, CLIP_AUDIO_BLOCK_TEXT } from '../audio/clipAudioBus';
  import CueListPanel from './show/CueListPanel.svelte';
  import TimelineIcon from './show/timeline/TimelineIcon.svelte';
  import TimelineToolbar from './show/timeline/TimelineToolbar.svelte';
  import { performShown, sideColumn } from './show/timeline/sideColumn';
  import TimelineSide from './show/timeline/TimelineSide.svelte';
  import { buildCueStack, markerNumber } from './show/timeline/perform/cueStack';
  import RowSectionHeader from './show/timeline/RowSectionHeader.svelte';
  import RowSectionLane from './show/timeline/RowSectionLane.svelte';
  import AddRowMenu from './show/timeline/AddRowMenu.svelte';
  import { SECTION_HEADER_HEIGHT, askedRows, rowPresence, sectionFolds, sendFold, setShowEveryRow, showEveryRow, stageSummary } from './show/timeline/rowSections';
  import { roomToWork, toggleRoomToWork } from './show/timeline/roomToWork';
  import { openExternalUrl } from '$lib/bridge';

  /** The Timeline guide on the website (the ? in the Timeline's header). */
  const TIMELINE_HELP_URL = 'https://ghostarcade.live/docs/timeline';
  import { cueList, cueLabel } from '../show/cueList';
  import { timecodeChase } from '../show/timecode/timecodeChase';
  import { settings } from '../stores/settings';
  import { audioOutput, selectAudioOutput, startAudioOutputSelection } from '../audio/audioOutputDevice';
  import { isShowAudioFile } from '../audio/showAudioImport';
  import { offerShowFromAudio, pickSongForShow } from '../show/showFromAudio';
  import { classifyShowKey, installShowKeyCapture, setShowKeyHandler } from '../show/showKeyboard';
  import { showDropEffect } from '../show/showDrop';
  import { setShowSnapEdgeProvider, showSectionStatus, showPhraseStatus } from '../stores/showTimeline';
  import PhrasePads from './show/PhrasePads.svelte';
  import { phraseSections } from '../timeline/phrases/phraseModel';
  import SectionsLiveMenu from './show/timeline/sections/SectionsLiveMenu.svelte';
  import SectionLane from './show/timeline/sections/SectionLane.svelte';
  import SectionInspector from './show/timeline/sections/SectionInspector.svelte';
  import SectionCueList from './show/timeline/sections/SectionCueList.svelte';
  import AutoShowDialog from './show/timeline/autoshow/AutoShowDialog.svelte';
  import WherePatternEditor from './show/timeline/WherePatternEditor.svelte';
  import { selectAllKeys } from './show/timeline/keyCommands';
  import { autoShowOpen } from './show/timeline/autoshow/autoShowUi';
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
  import { TRACK_HEADER_WIDTH, TRACK_ROW_HEIGHT, TRAY_MIN_HEIGHT, laneKeySelection, showSnapGuide, trayEditorCap } from './show/timeline/trackLayout';
  import { stackHeight, timelineRowStack, watchLayerReveal } from './show/timeline/layersSection';
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
  import { stageScopeTargets } from '../timeline/lines/lineExtensions';
  import LineRecordControls from './show/timeline/LineRecordControls.svelte';
  import LineDiamondOverlay from './show/timeline/LineDiamondOverlay.svelte';
  import { LOOKS_GROUP, STAGE_GROUP, STAGE_ROW_HEIGHT, LEDS_GROUP, lineLayout } from './show/timeline/lineUi';
  import LedRowHeaders from './show/timeline/LedRowHeaders.svelte';
  import LedRowLanes from './show/timeline/LedRowLanes.svelte';
  import LedBlockInspector from './show/timeline/LedBlockInspector.svelte';
  import StageFxRowHeaders from './show/timeline/StageFxRowHeaders.svelte';
  import StageFxRowLanes from './show/timeline/StageFxRowLanes.svelte';
  import StageFxBlockInspector from './show/timeline/StageFxBlockInspector.svelte';
  import { STAGE_FX_ROWS, STAGE_FX_ROW_HEIGHT, blockName as stageBlockName, newBlockEffect, newScreenFx } from './show/timeline/stageFxRowsUi';
  import { carriesStageDrag, readStageDrag } from '../timeline/stagefx/stageClips';
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
    jumpToEdit,
    nudgeSelection,
    pasteAtPlayhead,
    splitAtPlayhead,
    toggleFocusedLines,
    trimToPlayhead,
  } from './show/timeline/trackCommands';
  import { EDIT_TOOLS, editTool, shuttleBack, shuttleForward, shuttleStop, stepFrame, stopShuttle } from './show/timeline/editTools';

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
  const workAreaStore = showSlice('workArea');
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
  // Armed, an empty Timeline plays too, so there is time to record into.
  const recordArmed = $derived($lineRecordState.armed);
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
  // A/V phrases: the strip of pads under the transport (a view preference,
  // on by default) once the Timeline has published sections.
  const PHRASES_OPEN_KEY = 'ghostarcade-timeline-phrases-open';
  let phrasesPref = $state((() => {
    try { return localStorage.getItem(PHRASES_OPEN_KEY) !== '0'; } catch { return true; }
  })());
  function togglePhrases() {
    phrasesPref = !phrasesPref;
    try { localStorage.setItem(PHRASES_OPEN_KEY, phrasesPref ? '1' : '0'); } catch { /* private */ }
  }
  const hasPhrases = $derived(isTimeline && phraseSections(sections).length > 0);
  const phraseStripShown = $derived(hasPhrases && phrasesPref);
  const phraseText = $derived.by(() => {
    if (!isTimeline) return '';
    const st = $showPhraseStatus;
    const name = (id: string | null) => sections.find((x) => x.id === id)?.name ?? '';
    const playing = st.activeId ? `PHRASE · ${name(st.activeId)}` : '';
    if (st.pending) return `${playing ? `${playing} → ` : ''}${st.pending.id ? name(st.pending.id) : 'stop'} on the bar`;
    return playing;
  });
  /** The sections' cue list beside the Timeline (a view preference). */
  const SECTION_CUES_KEY = 'ghostarcade-timeline-section-cues-open';
  let sectionCuesOpen = $state((() => {
    try { return localStorage.getItem(SECTION_CUES_KEY) === '1'; } catch { return false; }
  })());
  function toggleSectionCues() {
    sectionCuesOpen = !sectionCuesOpen;
    try { localStorage.setItem(SECTION_CUES_KEY, sectionCuesOpen ? '1' : '0'); } catch { /* private mode */ }
  }
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
  const stageClipsStore = showSlice('stageClips');
  const stageClipsAll = $derived($stageClipsStore);
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
  /** The Timeline's one cue list (sections, markers, cues), numbered once: the flags show the numbers. */
  const cueStack = $derived(isTimeline ? buildCueStack(sections, docMarkers, cues.cues) : []);
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
    if (doc === 'timeline') sideColumn.send({ kind: 'selected' });
  }

  function startMarkerDrag(e: MouseEvent, id: string, time: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    showTimeline.select(null);
    selectedMarkerId = id;
    if (doc === 'timeline') sideColumn.send({ kind: 'selected' });
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

  // Content-creation tool: hide + auto-close in VJ mode, exactly like the
  // keyframe timeline does.
  const hiddenInVJ = $derived($vjClipLauncher.isOpen);
  $effect.pre(() => {
    if (hiddenInVJ && isOpen) showTimeline.setOpen(false);
  });

  const PRESET_LANE_HEIGHT = 46;
  /** The Timeline's Looks row. */
  const LOOK_LANE_HEIGHT = 32;
  /** The Timeline's Presets row (shorter than the Show's preset lane). */
  const PRESET_ROW_HEIGHT = 32;
  const AUDIO_LANE_HEIGHT = 52;
  const RULER_HEIGHT = 26;
  /** The Timeline's sections band, pinned under the ruler. */
  const BAND_HEIGHT = 22;
  /** Ruler and band: the corner cell beside them. */
  const HEAD_H = RULER_HEIGHT + BAND_HEIGHT;
  /** The "+ Row" row at the end of the list. */
  const ADD_ROW_HEIGHT = 28;

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

  /** Room the docked Timeline leaves above it (top bar and a canvas strip). */
  const TIMELINE_CANVAS_ROOM = 300;
  function timelineAutoHeight(vh: number): number {
    return Math.max(TRAY_MIN_HEIGHT, Math.min(Math.round(vh * 0.66), vh - TIMELINE_CANVAS_ROOM));
  }
  function timelineDragCeiling(vh: number): number {
    return Math.max(TRAY_MIN_HEIGHT, Math.round(vh * 0.85));
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
  /** The toolbar's height. */
  const transportH = 40;
  let inspectorH = $state(0);

  // The rows as drawn: group rows, the Layers header and (open) the layer rows.
  const tracksH = $derived(isTimeline ? stackHeight($timelineRowStack, $lineLayout) : 0);
  // Control lines of the Looks row and the Stage row (Timeline only).
  const looksLines = $derived(isTimeline ? $lineLayout.lines.get(LOOKS_GROUP) ?? [] : []);
  const stageLines = $derived(isTimeline ? $lineLayout.lines.get(STAGE_GROUP) ?? [] : []);
  const looksLinesH = $derived(isTimeline ? ($lineLayout.heights.get(LOOKS_GROUP) ?? 0) : 0);
  const stageBlockNames = $derived(Object.fromEntries(stageClipsAll.map((c) => [c.id, stageBlockName(c)])));
  const stageBlockSpans = $derived(Object.fromEntries(stageClipsAll.map((c) => [c.id, { start: c.startTime, end: c.startTime + c.duration }])));
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
    // Scopes registered at runtime (lineExtensions.ts) add their targets here.
    if (linePicker.group === 'stage') return [{ target: { scope: 'stage' as const }, label: 'Stage FX' }, { target: { scope: 'led' as const }, label: 'LEDs' }, ...stageScopeTargets()];
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
  const topLaneH = PRESET_LANE_HEIGHT;
  // The Stage camera lane sits under the audio lanes once it has shots (or was asked for).
  // ── Sections of rows (rowSections.ts): what shows, what is folded ─────────
  const folds = $derived($sectionFolds);
  const presence = $derived(rowPresence({
    presets: presetClips.length,
    looks: lookClips.length,
    looksLines: looksLines.length,
    screenfx: stageClipsAll.filter((c) => c.row === 'screenfx').length,
    effects: stageClipsAll.filter((c) => c.row === 'effects').length,
    ledRows: $ledRows.length,
    camera: cameraLane.length + ($cameraLaneShown ? 1 : 0),
    groupRows: 0,
    controlLines: stageLines.length,
  }, $askedRows, $showEveryRow));
  const stageFxRows = $derived(STAGE_FX_ROWS.filter((r) => presence[r]));
  const stageRowCount = $derived([presence.presets, presence.looks, presence.screenfx, presence.effects, presence.camera].filter(Boolean).length + $ledRows.length);
  const STAGE_ROW_LABELS = { presets: 'Presets', looks: 'Looks', screenfx: 'Screen FX', effects: 'Effects', leds: 'LEDs', camera: 'Camera' } as const;
  const stageSummaryText = $derived(stageSummary(presence, STAGE_ROW_LABELS));
  const audioSummary = $derived(audioTracks.map((t) => t.name.replace(/\.[a-z0-9]+$/i, '')).join(', '));
  const cameraLaneH = $derived((isTimeline ? presence.camera : cameraLane.length > 0 || $cameraLaneShown) ? CAMERA_LANE_HEIGHT : 0);
  /** Stage & FX: its header and (open) its rows. */
  const stageSectionH = $derived(!isTimeline || !presence.stage ? 0 : SECTION_HEADER_HEIGHT + (folds.stage ? 0
    : (presence.presets ? PRESET_ROW_HEIGHT : 0) + (presence.looks ? LOOK_LANE_HEIGHT + looksLinesH : 0)
      + stageFxRows.length * STAGE_FX_ROW_HEIGHT + ledRowsH + cameraLaneH));
  const stageLinesH = $derived(isTimeline && stageLines.length ? $lineLayout.heights.get(STAGE_GROUP) ?? 0 : 0);
  /** Control: its header and (open) the stage-wide lines. */
  const controlSectionH = $derived(!isTimeline || !presence.control ? 0 : SECTION_HEADER_HEIGHT + (folds.control ? 0 : stageLinesH));
  /** The Audio section: its header and (open) its rows. */
  const audioSectionH = $derived(isTimeline ? SECTION_HEADER_HEIGHT + (folds.audio ? 0 : $soundLayout.total) : 0);
  /** Above the rows: the ruler (and the sections band on the Timeline). */
  const headH = $derived(isTimeline ? HEAD_H : RULER_HEIGHT);
  let addRowFrom: 'corner' | 'stage' | 'foot' | null = $state(null);
  let cornerRowAnchor: HTMLElement | undefined = $state();
  let stageRowAnchor: HTMLElement | undefined = $state();
  let footRowAnchor: HTMLElement | undefined = $state();
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
  const laneStackH = $derived(isTimeline
    ? HEAD_H + audioSectionH + tracksH + stageSectionH + controlSectionH + ADD_ROW_HEIGHT
    : RULER_HEIGHT + topLaneH + audioStackH + cameraLaneH);
  const hasTracks = $derived(isTimeline && layerTracks.length > 0);
  /** Something to edit on the Timeline: the edit tools show once there is. */
  const hasBlocks = $derived(audioTracks.length > 0 || presetClips.length > 0 || lookClips.length > 0
    || stageClipsAll.length > 0 || ledClipsAll.length > 0 || layerTracks.some((t) => t.clips.length > 0));
  /** The toolbar's compact GO: with sections or cues, while the Perform tab is not showing. */
  const toolbarGoShown = $derived(isTimeline && (sections.length > 0 || cues.cues.length > 0) && !$performShown);
  const toolbarGoWord = $derived.by(() => {
    if (!isTimeline) return '';
    const held = sections.find((x) => x.id === $showSectionStatus.holdId);
    if (held) return held.name;
    const next = sections.find((x) => x.start > currentTime + 1e-5);
    return next?.name ?? '';
  });

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
        const next = startH - (ev.clientY - startY);
        userHeight = Math.max(TRAY_MIN_HEIGHT, Math.min(Math.round(next), isTimeline ? timelineDragCeiling(viewportH) : dragCeiling(viewportH)));
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
  /** Tabbing to a row header out of view scrolls the label column itself
   *  (it hides its overflow but still scrolls to show focus), and the
   *  headers then sat beside the wrong lanes. The grid owns the scroll: hand
   *  it the distance and put the column back. */
  function labelsScrolled(e: Event) {
    const el = e.currentTarget as HTMLElement;
    const dy = el.scrollTop;
    if (!dy && !el.scrollLeft) return;
    el.scrollTop = 0;
    el.scrollLeft = 0;
    if (gridEl && dy) gridEl.scrollTop += dy;
  }

  function timeAt(e: MouseEvent | DragEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left + gridEl.scrollLeft) / zoom);
  }

  function laneAt(e: DragEvent): number {
    if (!gridEl) return 0;
    const rect = gridEl.getBoundingClientRect();
    // The Timeline: ruler and band, then the Audio section's header and rows
    // (each with its lines). The Show: ruler, presets, then the audio lanes.
    if (isTimeline) {
      if (folds.audio) return 0;
      const y = e.clientY - rect.top + gridEl.scrollTop - HEAD_H - SECTION_HEADER_HEIGHT;
      return y < 0 ? 0 : Math.max(0, soundRowAt($soundLayout, y));
    }
    const y = e.clientY - rect.top + gridEl.scrollTop - RULER_HEIGHT - topLaneH;
    if (y < 0) return 0;
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

    // A Screen FX or effect card dropped off its row (the row may not show
    // yet: rows appear when used): a block on its row at the drop.
    if (isTimeline) {
      for (const row of STAGE_FX_ROWS) {
        if (!carriesStageDrag(dt, row)) continue;
        const payload = readStageDrag(dt, row);
        if (!payload) return;
        if (row === 'screenfx') {
          const fx = payload as StageEffect;
          showTimeline.addStageClip('screenfx', dropTime, { screenFx: newScreenFx(fx.type, fx) });
        } else {
          const fx = payload as Effect;
          showTimeline.addStageClip('effects', dropTime, { effect: newBlockEffect(fx.type, fx.params, fx) });
        }
        return;
      }
    }

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
  /** The Timeline's Presets row: a preset at the playhead. */
  function addPresetAtPlayhead(id: string) {
    const comp = $compositions.find((c) => c.id === id);
    if (!comp) return;
    showTimeline.insertPresetClipAt(comp.id, get(showTimeline).currentTime, SHOW_DEFAULT_PRESET_SECONDS, comp.name);
  }
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
  const selectedStageClip = $derived(selection?.kind === 'stageClip'
    ? stageClipsAll.find((c) => c.id === selection!.id) ?? null
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
  const inspectorVisible = $derived(!!(selectedPreset || selectedAudio || selectedTransitionClip || selectedMarker || layerClipInspector || selectedTrack || selectedTempo || selectedLookClip || selectedLedClip || selectedStageClip || soundSelection || selectedSection));
  // With layer tracks the inspector strip is always there (a hint when
  // nothing is selected) and its room is reserved: selecting a clip must not
  // grow the tray, or the lanes jump under the pointer mid-drag.
  const TRACK_INSPECTOR_RESERVE = 72;
  // The inspector wraps onto more rows in a narrow window (or at a large
  // interface scale), and then needs more than the reserve: its real height.
  // The Timeline's inspector is in the side column, not under the lanes.
  const inspectorRoom = $derived(isTimeline ? 0 : hasTracks ? Math.max(TRACK_INSPECTOR_RESERVE, inspectorH) : inspectorVisible ? inspectorH : 0);
  /** Everything but the lanes: transport, pads, inspector, top border. */
  const chromeH = $derived(transportH + inspectorRoom + 1);
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
    cuesOpen ? transportH + CUE_PANEL_MIN_HEIGHT : 0,
  ));
  // Sizing itself (content, pads, phrase strip) the tray leaves the editor
  // its reserve; a height dragged by hand is kept, but the pads opening on
  // top of it do not push it further.
  // A tall inspector (an effect's settings at a large interface scale) still
  // gets its whole height and a ruler with two rows of lanes above it.
  const editorCap = $derived(Math.max(trayEditorCap(viewportH, TRAY_MAX_SHARE),
    transportH + inspectorRoom + RULER_HEIGHT + 2 * TRACK_ROW_HEIGHT + GRID_SCROLLBAR_ALLOWANCE + 1));
  const within = (cap: number): TrayLimits => ({ cap: Math.min(trayLimits.cap, cap), floor: Math.min(trayLimits.floor, cap) });
  const autoH = $derived(clampTray(contentH, within(editorCap), (cuesOpen ? cueCeiling(viewportH) : autoCeiling(viewportH, hasTracks))));
  const showTrayHeight = $derived(userHeight === null
    ? autoH
    : clampTray(userHeight, within(Math.max(editorCap, userHeight)), dragCeiling(viewportH)));
  // The Timeline is a workspace of its own (rows, the side column's
  // inspector, the Perform tab): about two thirds of the window unless
  // dragged, always leaving the canvas a strip above it.
  const trayHeight = $derived(isTimeline
    ? (userHeight === null ? timelineAutoHeight(viewportH) : Math.max(TRAY_MIN_HEIGHT, Math.min(userHeight, timelineDragCeiling(viewportH))))
    : showTrayHeight);

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
      // Toasts rise above the open tray (and the preview's zoom buttons).
      root.setProperty('--ga-tray-toast-lift', open ? `${trayHeight + 52}px` : '0px');
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
    else if (selectedStageClip) showTimeline.removeStageClip(selectedStageClip.id);
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
      pointerOver: pointerInTray,
      isTimeline: s.doc === 'timeline',
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
        selectAllKeys();
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
      case 'shuttleBack':
        shuttleBack();
        return true;
      case 'shuttleStop':
        shuttleStop();
        return true;
      case 'shuttleForward':
        shuttleForward();
        return true;
      case 'frameBack':
      case 'frameForward':
        stepFrame(action === 'frameBack' ? -1 : 1);
        return true;
      case 'markIn':
        showTimeline.markIn(s.currentTime);
        return true;
      case 'markOut':
        showTimeline.markOut(s.currentTime);
        return true;
      case 'goIn':
      case 'goOut':
        if (!s.workArea) return false;
        showTimeline.seek(action === 'goIn' ? s.workArea.start : s.workArea.end);
        return true;
      case 'clearInOut':
        showTimeline.setWorkArea(null);
        return true;
      case 'prevEdit':
      case 'nextEdit':
        jumpToEdit(action === 'prevEdit' ? -1 : 1);
        return true;
      case 'zoomIn':
      case 'zoomOut':
        zoomAroundPlayhead(action === 'zoomIn' ? 1.25 : 1 / 1.25);
        return true;
      case 'zoomFit':
        zoomToFitView();
        return true;
      case 'trimStart':
      case 'trimEnd':
        trimToPlayhead(action === 'trimStart' ? 'start' : 'end');
        return true;
      case 'forwardTool':
        editTool.set('forward');
        return true;
      case 'razor':
        editTool.set('razor');
        return true;
      case 'rippleTool':
        editTool.set('ripple');
        return true;
      case 'rollTool':
        editTool.set('roll');
        return true;
      case 'slipTool':
        editTool.set('slip');
        return true;
      case 'selectTool':
        editTool.set('select');
        return true;
      case 'toggleLines':
        return toggleFocusedLines();
      case 'group':
        return showTimeline.groupLayerClips(get(showTimeline).selectedClipIds);
      case 'ungroup':
        return showTimeline.ungroupLayerClips(get(showTimeline).selectedClipIds);
      case 'roomToWork':
        toggleRoomToWork();
        return true;
    }
    return false;
  }

  /** Zoom so the whole show fits the lanes. */
  function zoomToFitView() {
    showTimeline.zoomToFit(Math.max(100, gridWidth - 24));
    if (gridEl) gridEl.scrollLeft = 0;
  }

  /** = / -: zoom in or out, keeping the playhead where it is on screen. */
  function zoomAroundPlayhead(factor: number) {
    const from = get(showTimeline).zoom;
    const time = get(showTimeline).currentTime;
    const screenX = gridEl ? time * from - gridEl.scrollLeft : 0;
    showTimeline.setZoom(from * factor);
    const to = get(showTimeline).zoom;
    if (to === from) return;
    void tick().then(() => {
      if (!gridEl) return;
      gridEl.scrollLeft = anchoredScrollLeft(time, to, Math.max(0, Math.min(gridEl.clientWidth, screenX)));
      gridScrollLeft = gridEl.scrollLeft;
    });
  }
  onMount(() => setShowKeyHandler(handleShowKey));
  // A block picked on a folded layer row (select all, the inspector, undo) opens the Layers section.
  onMount(() => watchLayerReveal());
  // Something new picked on the Timeline (not a row: that brings the Media
  // tab) brings the side column's Inspector, unless Perform is showing.
  onMount(() => {
    let prevSel = get(showTimeline).selection;
    let prevClips = get(showTimeline).selectedClipIds;
    const check = () => {
      const s = get(showTimeline);
      const sel = s.selection;
      const clips = s.selectedClipIds;
      const fresh = (!!sel && sel !== prevSel && sel.kind !== 'track') || (clips !== prevClips && clips.some((id) => !prevClips.includes(id)));
      prevSel = sel;
      prevClips = clips;
      if (fresh && s.doc === 'timeline' && s.isOpen) sideColumn.send({ kind: 'selected' });
    };
    const a = showSlice('selection').subscribe(check);
    const b = showSlice('selectedClipIds').subscribe(check);
    return () => { a(); b(); };
  });
  // A backwards shuttle stops when the tray goes.
  onMount(() => () => stopShuttle());
  // Taken ahead of every other window listener (see installShowKeyCapture).
  onMount(() => installShowKeyCapture());
  // Markers are snap targets for clips and keys.
  onMount(() => {
    setShowSnapEdgeProvider(() => cues.markers.filter((m) => (m.doc ?? 'show') === get(showTimeline).doc).map((m) => m.time));
    return () => setShowSnapEdgeProvider(null);
  });

  const MOD_KEY = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform) ? 'Cmd' : 'Ctrl';

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

  let showClearConfirm = $state(false);
  function confirmClear() {
    showTimeline.clear();
    showClearConfirm = false;
  }
</script>

<svelte:window bind:innerHeight={viewportH} />

{#snippet inspectorChain()}
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
  {:else if selectedStageClip}
    <div class="insp-wrap" bind:clientHeight={inspectorH}>
      <StageFxBlockInspector clip={selectedStageClip} onclose={() => showTimeline.select(null)} />
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
      <span class="insp-hint" title="The window is centered on the junction — half of it plays over the outgoing clip and half over the incoming one.">
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
      <span class="insp-hint insp-idle-hint">Click a block to see its settings here.</span>
    </div>
  {/if}
{/snippet}

{#snippet timelineInspector()}
  {#if inspectorVisible}
    {@render inspectorChain()}
  {:else}
    <div class="show-inspector insp-idle">
      <span class="insp-hint insp-idle-hint">Click a block to see its settings here.</span>
    </div>
  {/if}
{/snippet}

{#snippet performInterim()}
  <ShowTakeoverControls />
  {#if sections.length || docMarkers.length}<SectionCueList {sections} {currentTime} playing={isPlaying} />{/if}
  <CueListPanel />
  {#if hasPhrases}<PhrasePads variant="timeline" />{/if}
  <TakeoverPads />
{/snippet}

{#snippet showDocTools()}
  <select class="t-select t-preset" bind:value={addPresetId} title="Preset to add">
    <option value="">Choose preset…</option>
    {#each comps as comp}
      <option value={comp.id}>{comp.name}</option>
    {/each}
  </select>
  <button class="t-chip" onclick={addPreset} disabled={comps.length === 0} title="Append this preset to the end of the show">
    + Preset
  </button>
  <button class="t-chip t-iconable" onclick={() => audioInput?.click()} title="Add audio from this computer at the playhead: a song, stems or a sound" aria-label="Add audio">
    <TimelineIcon name="song" /><span class="t-label">Add audio</span>
  </button>
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
  </button>
  <button class="t-chip t-iconable" class:active={cuesOpen} onclick={toggleCues} title="Show the cue list beside the timeline" aria-label="Cues" data-show-cues-toggle>
    <TimelineIcon name="cues" /><span class="t-label">Cues</span>
  </button>
  <button class="t-chip t-iconable" onclick={addMarkerAtPlayhead} title="Add a marker at the playhead. It fires the selected cue when the timeline plays across it." aria-label="Add a marker at the playhead. It fires the selected cue when the timeline plays across it." data-show-add-marker>
    <TimelineIcon name="marker" /><span class="t-label">Marker</span>
  </button>
{/snippet}


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
    class:room={isTimeline && $roomToWork}
    style:height={isTimeline && $roomToWork ? null : `${trayHeight}px`}
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

    <TimelineToolbar
      {isTimeline}
      zoomBy={zoomAroundPlayhead}
      zoomFit={zoomToFitView}
      onclear={() => (showClearConfirm = true)}
      goShown={toolbarGoShown}
      goTitle={`GO: ${goText}. Enter while the pointer is over the Timeline; MIDI/OSC show/go.`}
      goWord={toolbarGoWord}
      go={() => showTimeline.go()}
      {hasBlocks}
      showDocTools={isTimeline ? undefined : showDocTools}
    />
    <input
      class="hidden-file"
      type="file"
      accept="audio/*"
      multiple
      bind:this={audioInput}
      onchange={handleAudioPick}
    />


    <div class="show-main">
    <div class="show-main-col">
    <!-- Body: lane labels + scrolling grid -->
    <div class="show-body">
      <div class="lane-labels" style="width: {labelWidth}px; flex-basis: {labelWidth}px" onwheel={handleLabelWheel} onscroll={labelsScrolled}>
        {#if isTimeline}
          <!-- The corner cell, pinned beside the ruler and the sections band. -->
          <div class="tl-corner" style="height: {HEAD_H}px" data-timeline-corner>
            <div class="corner-top" style="height: {RULER_HEIGHT}px">
              <button class="cbtn box" bind:this={cornerRowAnchor} onclick={() => (addRowFrom = addRowFrom === 'corner' ? null : 'corner')} title="Add a row: audio, a group, a layer on a piece, Presets, Looks, Screen FX, Effects, LEDs, camera or a control line" aria-expanded={addRowFrom === 'corner'} data-add-row-menu>
                <TimelineIcon name="plus" size={12} />Row<TimelineIcon name="caret" size={11} />
              </button>
              <button class="cbtn" onclick={addMarkerAtPlayhead} title="Add a marker at the playhead (M). It fires the selected cue when the Timeline plays across it." aria-label="Add a marker at the playhead" data-show-add-marker>
                <TimelineIcon name="flag" size={13} />Marker
              </button>
              <span class="corner-grow"></span>
              <button class="cbtn icon" class:on={$showEveryRow} onclick={() => setShowEveryRow(!$showEveryRow)} title={$showEveryRow ? 'Showing every row: click to show only the rows in use' : 'Show every row, empty ones too'} aria-pressed={$showEveryRow} data-show-every-row><TimelineIcon name="pin" size={13} /></button>
            </div>
            <div class="corner-bot" style="height: {BAND_HEIGHT}px" data-sections-label>
              <span class="corner-eyebrow" title="Named spans of the Timeline with what happens at their end: play through, hold for GO, loop until GO, jump, or hand to the VJ decks.">Sections</span>
              <button class="cbtn icon" onclick={addSectionAtPlayhead} title="Add a section at the playhead (8 bars, or up to the next section)" aria-label="Add a section at the playhead" data-section-add><TimelineIcon name="plus" size={12} /></button>
              <span class="corner-grow"></span>
              <SectionsLiveMenu />
            </div>
          </div>
        {:else}
          <div class="label-ruler-spacer" style="height: {RULER_HEIGHT}px"></div>
        {/if}
        <!-- Translated, not scrolled: the grid owns the scroll and the corner
             above has to stay pinned the way the sticky ruler does. -->
        <div class="label-rows" style="transform: translateY({-laneScrollTop}px)">
          {#if isTimeline}
          <RowSectionHeader id="audio" title="Audio" icon="wave" count={audioTracks.length} folded={folds.audio} ontoggle={() => sendFold({ kind: 'toggle', id: 'audio' })}
            summary={audioSummary} help="Audio rows: the song, stems and one-shots, and Ableton clips rows. The first song's tempo is the grid.">
            {#snippet actions()}
              <button class="rsh-act" onclick={() => audioInput?.click()} title="Add audio from this computer at the playhead: a song, stems or a sound" data-add-audio><TimelineIcon name="plus" size={12} />Add audio</button>
              <button class="rsh-act" onclick={() => autoShowOpen.set(true)} disabled={!audioTracks.length}
                title={audioTracks.length ? 'Auto show: a whole show on your mapping from the song (sections, content on the pieces, looks, Screen FX)' : 'Add audio first'}
                data-auto-show-open data-auto-show-song><TimelineIcon name="sparkle" size={12} />Auto show</button>
            {/snippet}
          </RowSectionHeader>
          {#if !folds.audio}<SoundRowHeaders />{/if}
          <ShowTrackHeaders />
          {#if presence.stage}
            <RowSectionHeader id="stage" title="Stage & FX" icon="stage" count={stageRowCount} folded={folds.stage} ontoggle={() => sendFold({ kind: 'toggle', id: 'stage' })}
              summary={stageSummaryText} help="The whole stage: Presets, Looks, Screen FX, composition effects, LEDs and the Stage Sim camera. A row shows once it is used; + Row adds one.">
              {#snippet actions()}
                <button class="rsh-act" bind:this={stageRowAnchor} onclick={() => (addRowFrom = addRowFrom === 'stage' ? null : 'stage')} title="Add a row" data-stage-add-row><TimelineIcon name="plus" size={12} />Row</button>
              {/snippet}
            </RowSectionHeader>
            {#if !folds.stage}
              {#if presence.presets}
                <div class="lane-label row32 timeline-presets" style="height: {PRESET_ROW_HEIGHT}px" data-presets-label>
                  <span class="row-stripe preset" aria-hidden="true"></span>
                  <span class="row-icon"><TimelineIcon name="preset" size={15} /></span>
                  <span class="lane-name" title="Presets along the Timeline: each block loads a saved preset (the whole stage, its groups and content) at its start, with transitions between them. Drag a preset here from the Presets tray. The rows below play over it.">Presets</span>
                  <select class="lane-preset-add" value="" disabled={comps.length === 0}
                    title={comps.length ? 'Put a preset on the Presets row at the playhead' : 'Save a preset in the Presets tray first'}
                    onchange={(e) => { const el = e.currentTarget as HTMLSelectElement; addPresetAtPlayhead(el.value); el.value = ''; }}
                    aria-label="Add a preset at the playhead" data-timeline-preset-add>
                    <option value="">+</option>
                    {#each comps as comp (comp.id)}<option value={comp.id}>{comp.name}</option>{/each}
                  </select>
                </div>
              {/if}
              {#if presence.looks}
                <div class="lane-label row32 look" style="height: {LOOK_LANE_HEIGHT}px">
                  <span class="row-stripe look" aria-hidden="true"></span>
                  <span class="row-icon"><TimelineIcon name="look" size={15} /></span>
                  <span class="lane-name" title="Shape Looks along the Timeline: drag a Look card from the Looks gallery here. The shapes wear it for the block's span; overlapping blocks crossfade.">Looks</span>
                  {#if lookClips.length > 0}
                    <button class="lane-line-add" onclick={(e) => openLinePicker(e, 'looks')} title="Add a control line for a look block: intensity, speed, colour step, beat reaction, chase" data-line-picker-looks aria-label="Add a control line"><TimelineIcon name="line-add" size={14} /></button>
                  {/if}
                </div>
                {#if looksLines.length}
                  <LineHeaders groupId={LOOKS_GROUP} lines={looksLines} expanded={$lineLayout.expanded.has(LOOKS_GROUP)} blockNames={lookNames} />
                {/if}
              {/if}
              {#if stageFxRows.length}<StageFxRowHeaders rows={stageFxRows} />{/if}
              <LedRowHeaders />
              {#if ledLines.length && $ledRows.length}
                <LineHeaders groupId={LEDS_GROUP} lines={ledLines} expanded={$lineLayout.expanded.has(LEDS_GROUP)} blockNames={ledNames} />
              {/if}
              {#if cameraLaneH > 0}<ShowCameraLaneLabel />{/if}
            {/if}
          {/if}
          {#if presence.control}
            <RowSectionHeader id="control" title="Control" icon="control" count={stageLines.length} folded={folds.control} ontoggle={() => sendFold({ kind: 'toggle', id: 'control' })}
              summary={stageLines.map((l) => l.label ?? l.key).join(', ')} help="Stage-wide control lines: composition effects, LED settings, world settings. Each can follow the song, a stem, the beat or a knob.">
              {#snippet actions()}
                <button class="rsh-act" onclick={(e) => openLinePicker(e, 'stage')} title="Add a control line for a composition effect (Effects tab), an LED setting or a world setting" data-line-picker-stage><TimelineIcon name="plus" size={12} />Line</button>
              {/snippet}
            </RowSectionHeader>
            {#if !folds.control && stageLines.length}
              <LineHeaders groupId={STAGE_GROUP} lines={stageLines} expanded={$lineLayout.expanded.has(STAGE_GROUP)} blockNames={stageBlockNames} />
            {/if}
          {/if}
          <div class="tl-addrow" style="height: {ADD_ROW_HEIGHT}px">
            <button class="cbtn box" bind:this={footRowAnchor} onclick={() => (addRowFrom = addRowFrom === 'foot' ? null : 'foot')} title="Add a row" data-add-row-foot><TimelineIcon name="plus" size={12} />Row<TimelineIcon name="caret" size={11} /></button>
            <span class="tl-addrow-hint">audio, group, looks, Screen FX, LEDs, camera, line</span>
          </div>
          {:else}
          <div class="lane-label preset" style="height: {PRESET_LANE_HEIGHT}px">
            <span class="lane-name" title="Presets launched along the show, with transitions between them.">Presets</span>
          </div>
          {#each audioLanes as lane}
            <div class="lane-label audio" style="height: {AUDIO_LANE_HEIGHT}px">
              <span class="lane-name">Audio {lane + 1}</span>
            </div>
          {/each}
          {#if cameraLaneH > 0}<ShowCameraLaneLabel />{/if}
          {/if}
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
          {#if $workAreaStore}
            <div
              class="show-work-area"
              class:looping={$loopStore}
              style="left: {$workAreaStore.start * zoom}px; width: {($workAreaStore.end - $workAreaStore.start) * zoom}px"
              title="In and out points (I / O). With Loop on, play loops between them. {MOD_KEY}+Shift+X clears them"
              data-show-work-area
            ></div>
          {/if}
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
              {#if isTimeline}
                <span class="show-marker-flag tl-flag"><span class="flag-q">Q{markerNumber(cueStack, marker.id) ?? '?'}</span>{marker.label || cues.cues.find((c) => c.id === marker.cueId)?.name || ''}</span>
              {:else}
                <span class="show-marker-flag">{marker.label || markerCueLabel(marker.cueId)}</span>
              {/if}
            </div>
          {/each}
        </div>

        {#if isTimeline}
          <!-- The sections band, pinned under the ruler. -->
          <div class="tl-band" style="width: {totalWidth}px; height: {BAND_HEIGHT}px; top: {RULER_HEIGHT}px">
            <SectionLane {sections} {tempo} height={BAND_HEIGHT} {zoom} {viewStart} {viewEnd} {selection} snap={snapEnabled} />
          </div>
        {/if}
        <div class="lanes" style="width: {totalWidth}px">
          {#if isTimeline}
          <RowSectionLane id="audio" />
          {#if !folds.audio}<SoundRowLanes {zoom} {viewStart} {viewEnd} />{/if}
          <ShowTrackLanes {zoom} {viewStart} {viewEnd} width={totalWidth} />
          {#if presence.stage}
            <RowSectionLane id="stage" />
            {#if !folds.stage}
              {#if presence.presets}
                <ShowPresetLane
                  clips={presetClips}
                  {junctions}
                  height={PRESET_ROW_HEIGHT}
                  emptyHint="Drop a preset card from the Presets tray here, or choose one with + (it goes in at the playhead)."
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
              {#if presence.looks}
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
              {/if}
              {#if stageFxRows.length}<StageFxRowLanes {zoom} {viewStart} {viewEnd} width={totalWidth} {selection} rows={stageFxRows} />{/if}
              <LedRowLanes {zoom} {viewStart} {viewEnd} width={totalWidth} {selection} />
              {#if ledLines.length && $ledRows.length}
                <LineLanes groupId={LEDS_GROUP} lines={ledLines} expanded={$lineLayout.expanded.has(LEDS_GROUP)} {zoom} {viewStart} {viewEnd} blockSpans={ledSpans} />
              {/if}
              {#if cameraLaneH > 0}<ShowCameraLane {zoom} />{/if}
            {/if}
          {/if}
          {#if presence.control}
            <RowSectionLane id="control" />
            {#if !folds.control && stageLines.length}
              <LineLanes groupId={STAGE_GROUP} lines={stageLines} expanded={$lineLayout.expanded.has(STAGE_GROUP)} {zoom} {viewStart} {viewEnd} blockSpans={stageBlockSpans} />
            {/if}
          {/if}
          <div class="tl-addrow-lane" style="height: {ADD_ROW_HEIGHT}px"></div>
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
          {#if cameraLaneH > 0}<ShowCameraLane {zoom} />{/if}
          {/if}
        </div>

        {#each barLines as line}
          <div class="show-bar-line" class:beat={!line.bar} style="left: {line.x}px; top: {headH}px; height: {laneStackH - headH}px"></div>
        {/each}

        {#each visibleMarkers as marker (marker.id)}
          <div class="show-marker-line" class:selected={marker.id === selectedMarkerId} style="left: {marker.time * zoom}px; height: {laneStackH}px"></div>
        {/each}

        {#if $workAreaStore}
          <div class="show-work-edge" style="left: {$workAreaStore.start * zoom}px; height: {laneStackH}px"></div>
          <div class="show-work-edge" style="left: {$workAreaStore.end * zoom}px; height: {laneStackH}px"></div>
        {/if}

        {#if $showSnapGuide !== null}
          <div class="show-snap-guide" style="left: {$showSnapGuide * zoom}px; height: {laneStackH}px" data-show-snap-guide></div>
        {/if}

        <div class="show-playhead" style:transform="translateX({playheadX}px)" style:height="{laneStackH}px" onmousedown={startScrub}>
          <div class="playhead-handle"></div>
          <div class="playhead-line"></div>
        </div>
      </div>
    </div>

    {#if !isTimeline}{@render inspectorChain()}{/if}

    </div>
    {#if isTimeline}
      <TimelineSide inspector={timelineInspector} perform={performInterim} />
    {:else if cuesOpen}
      <CueListPanel />
    {/if}
    </div>
    <WherePatternEditor />
    {#if $autoShowOpen}
      <AutoShowDialog onclose={() => autoShowOpen.set(false)} />
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
{#if addRowFrom}
  <AddRowMenu anchor={addRowFrom === 'corner' ? cornerRowAnchor : addRowFrom === 'stage' ? stageRowAnchor : footRowAnchor}
    placement={addRowFrom === 'foot' ? 'above' : 'below'}
    onclose={() => (addRowFrom = null)}
    online={(el) => { const r = el.getBoundingClientRect(); linePicker = { x: r.left, y: r.top - 4, group: 'stage' }; }} />
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
  /* Room to work: from the top bar to the status bar, over the canvas and
     the side panels (they keep their size underneath). */
  .show-tray.room { top: var(--ga-bar-h, 48px); animation: none; z-index: 95; }
  .show-tray.room .tray-resize { display: none; }
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
  /* Which tab the tray is showing: the Show or the Timeline. */

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
  /* The editing tool: lit in the royal blue while it is not Select. */

  /* The open list keeps the app's colours (a white tool name must not land on a white list). */
  .t-select option { background: var(--ga-raise, #14141a); color: var(--ga-ink-0, #ddd); }
  .hidden-file { display: none; }

  /* Audio output — amber when the show is audible, red when something is
     silencing it, so a dead show is never mistaken for a working one.
     Literal hex rather than --ga-coral: that token resolves to a near-white
     (#e7eef5) on the current theme, which would render the warning state
     indistinguishable from every other control in this bar. */

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
  /* Timeline markers: blue cue flags with their number. */
  .show-marker-flag.tl-flag {
    top: 3px;
    height: 16px;
    line-height: 16px;
    display: inline-flex;
    gap: 4px;
    padding: 0 5px 0 4px;
    border-left: 2px solid var(--ga-blue, #5278ff);
    border-radius: 0 3px 3px 0;
    background: color-mix(in srgb, var(--ga-blue, #5278ff) 40%, #000);
    color: var(--ga-selection-ink, #e0e8ff);
    font-family: inherit;
    font-size: 10px;
    font-weight: 600;
  }
  .tl-flag .flag-q { font-family: var(--ga-font-mono, 'Geist Mono', ui-monospace, monospace); color: #aebfff; }
  .show-marker.unlinked .show-marker-flag.tl-flag { background: var(--ga-raise, #26221c); color: var(--ga-ink-1, #ada9a2); border-left-color: var(--ga-ink-2, #89857e); }
  .show-marker.selected .show-marker-flag.tl-flag { box-shadow: 0 0 0 1px var(--tl-on, #ff725f); }
  .timeline-doc .show-marker-line { width: 0; background: none; border-left: 1px dashed rgba(82, 120, 255, 0.38); }
  .timeline-doc .show-marker-line.selected { border-left-color: var(--ga-blue, #5278ff); }
  .show-marker.selected .show-marker-flag { box-shadow: 0 0 0 1px #fff; }
  /* In and out points: a band under the ruler and a faint line down each edge. */
  .show-work-area {
    position: absolute;
    bottom: 0;
    height: 4px;
    background: color-mix(in srgb, var(--ga-icon, #5278ff) 45%, transparent);
    pointer-events: none;
  }
  .show-work-area.looping { background: var(--ga-icon, #5278ff); }
  .show-work-edge {
    position: absolute;
    top: 0;
    width: 1px;
    background: color-mix(in srgb, var(--ga-icon, #5278ff) 55%, transparent);
    pointer-events: none;
    z-index: 3;
  }
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

  /* Timecode lock badge in the transport. */

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
    /* One line in any language: a long translation ends in an ellipsis
       instead of wrapping inside the row label. */
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--ga-text-eyebrow, 10px);
    text-transform: uppercase;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    color: var(--ga-ink-2, #7a7a86);
    font-weight: 700;
  }
  .lane-label.preset .lane-name { color: color-mix(in srgb, var(--ga-coral, #ff6f5e) 75%, #ffffff); }
  .lane-label.look .lane-name { color: color-mix(in srgb, #8c78ff 75%, #ffffff); }
  .lane-line-add {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
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
  .lane-preset-add {
    margin-left: auto;
    width: 34px;
    height: 18px;
    padding: 0 2px;
    background: var(--ga-sunk, #0c0c10);
    border: 1px solid var(--ga-line-2, rgba(255, 255, 255, 0.12));
    border-radius: 3px;
    color: var(--ga-ink-1, #aaa);
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }
  .lane-preset-add:disabled { opacity: 0.4; cursor: default; }
  .lane-line-add:disabled { opacity: 0.4; cursor: default; }

  /* ── Timeline: header column, corner cell, rows ─────────────────────── */
  .timeline-doc .lane-labels { background: var(--ga-panel, #100f0d); border-right-color: var(--ga-line-2, rgba(245, 236, 222, 0.13)); position: relative; z-index: 3; }
  .tl-corner {
    position: relative;
    z-index: 2;
    box-sizing: border-box;
    background: var(--ga-bar, #100f0d);
    border-bottom: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .corner-top, .corner-bot { display: flex; align-items: center; gap: 4px; box-sizing: border-box; }
  .corner-top { padding: 0 6px; }
  .corner-bot { padding: 0 6px 0 10px; border-top: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07)); }
  .corner-grow { flex: 1; min-width: 0; }
  .corner-eyebrow {
    font-size: var(--ga-text-eyebrow, 10px);
    font-weight: 700;
    letter-spacing: var(--ga-eyebrow-tracking, 0.08em);
    text-transform: uppercase;
    color: var(--ga-ink-2, #89857e);
  }
  .cbtn {
    height: 20px;
    padding: 0 6px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--ga-ink-1, #ada9a2);
    font: inherit;
    font-size: var(--ga-text-meta, 11px);
    font-weight: 600;
    white-space: nowrap;
    cursor: pointer;
  }
  .cbtn :global(.tl-icon) { color: var(--ga-icon, #5278ff); }
  .cbtn :global(.tl-icon:last-child:not(:first-child)) { color: var(--ga-ink-2, #89857e); }
  .cbtn.box { border-color: var(--ga-line-2, rgba(245, 236, 222, 0.13)); background: var(--ga-card, #16140f); color: var(--ga-ink-0, #f2ede4); }
  .cbtn.icon { width: 22px; padding: 0; justify-content: center; }
  .cbtn:hover { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .cbtn.on { background: var(--ga-selection-bg, #1f3170); }
  .cbtn.on :global(.tl-icon) { color: var(--ga-selection-ink, #e0e8ff); }
  .lane-label.row32 { position: relative; gap: 6px; padding: 0 4px 0 12px; }
  .lane-label.row32:hover { background: rgba(245, 236, 222, 0.035); }
  .lane-label.row32 .lane-name {
    flex: 1 1 auto;
    font-size: var(--ga-text-body, 13px);
    text-transform: none;
    letter-spacing: 0;
    font-weight: 600;
    color: var(--ga-ink-0, #f2ede4);
  }
  .row-stripe { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
  .row-stripe.preset { background: color-mix(in srgb, #f0c674 85%, transparent); }
  .row-stripe.look { background: color-mix(in srgb, #8b7cff 85%, transparent); }
  .row-icon { display: inline-flex; color: var(--ga-icon, #5278ff); }
  .lane-label.row32 .lane-line-add { margin-left: 0; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--ga-ink-2, #89857e); }
  .lane-label.row32 .lane-line-add:hover { background: var(--ga-raise, #26221c); color: var(--ga-ink-0, #f2ede4); }
  .lane-label.row32 .lane-preset-add { margin-left: 0; width: 34px; height: 22px; background: var(--ga-slot, #060504); }
  .tl-addrow { display: flex; align-items: center; gap: 8px; padding: 0 8px 0 10px; box-sizing: border-box; border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07)); }
  .tl-addrow-hint { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--ga-text-meta, 11px); color: var(--ga-ink-3, #39342c); }
  .tl-addrow-lane { box-sizing: border-box; border-bottom: 1px solid var(--ga-line, rgba(245, 236, 222, 0.07)); }
  .tl-band {
    position: sticky;
    z-index: 4;
    box-sizing: border-box;
    background: var(--ga-panel, #100f0d);
    border-bottom: 1px solid var(--ga-line-2, rgba(245, 236, 222, 0.13));
  }
  .timeline-doc .show-grid { background: var(--tl-lane-bg, #0c0b09); }
  .timeline-doc .show-ruler { background: var(--ga-bar, #100f0d); }
  .timeline-doc .playhead-handle { background: var(--tl-on, #ff725f); clip-path: polygon(0 0, 100% 0, 100% 55%, 50% 100%, 0 55%); }
  .timeline-doc .playhead-line { background: var(--tl-on, #ff725f); opacity: 1; }
  .timeline-doc .show-bar-line { background: rgba(245, 236, 222, 0.045); }
  .timeline-doc .show-bar-line.beat { background: rgba(245, 236, 222, 0.02); }

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
  /* Tighter, step by step, until the transport fits on one line. */
  /* Icons always; their labels while there is room. */
  .t-iconable { display: inline-flex; align-items: center; gap: 6px; }

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
  /* In a tray at its cap the pads give way first, and scroll: every pad and
     setting stays reachable. */

  /* Click-through below the ruler: a click in a lane seeks, and the line
     that lands under the pointer must not swallow the second click of a
     double-click (adding a key) or a press on a clip edge. The ruler and
     the handle still scrub. */
  /* Placed by `transform` on its own layer: moving it every frame of a
     playing show must not repaint the lanes underneath. */
  /* As tall as every row (the bar lines are too), so it runs all the way
     down a long stack of layers, scrolled or not. */
  .show-playhead {
    position: absolute;
    top: 0;
    left: 0;
    width: 1px;
    z-index: 6;
    cursor: col-resize;
    pointer-events: none;
    will-change: transform;
  }
  .playhead-handle { pointer-events: auto; cursor: col-resize; }
  /* Sticks to the ruler while the rows scroll under it. */
  .playhead-handle {
    position: sticky;
    top: 0;
    z-index: 1;
    margin-left: -5px;
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
  /* The idle hint is a paragraph: two lines in the reserved strip (longer
     languages and narrow windows included), the rest in its tooltip. */
  .insp-idle-hint {
    flex: 1 1 0;
    min-width: 0;
    white-space: normal;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    overflow: hidden;
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
