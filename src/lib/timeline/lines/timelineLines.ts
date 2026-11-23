/**
 * Control lines on the Timeline: the one place that connects the lines
 * engine (lineSession) to the Timeline document.
 *
 * - The document owns its lines (`showTimeline` state `lines`, saved with
 *   the Timeline, undone with it). A session mirrors them while the Timeline
 *   is the active document and is disposed when the Show takes over.
 * - The show ticks the session from its own evaluation (setShowLineTicker):
 *   every frame while playing, every seek and scrub while paused, and each
 *   frame of an offline render (exportFrame: live-only sources add nothing).
 * - A recorded pass is one undo step of the document.
 * - The registry the session reads knows the Timeline's blocks, look blocks
 *   and pieces that are off the stage; the sound rows are a registered scope.
 */
import { get, writable } from 'svelte/store';
import { heldEdits, heldTouches, holdContentEdit, holdParamEdit, installLiveEditHooks, resetLiveEdit, setLiveEditArmed, type HeldEdit } from '../liveEdit';
import { planDiscard } from '../liveEditRevert';
import {
  onShowDocChange,
  onShowTimelineReset,
  setShowLineTicker,
  setShowRecordArm,
  showTimeline,
  type ShowLineTick,
} from '../../stores/showTimeline';
import { project } from '../../stores/layers';
import type { Layer, MediaSource, Project, ShowLayerClip, ShowLayerTrack } from '../../types';
import { createLineSession, type LineSession } from './lineSession';
import { ALL_LOOKS_ID, findParam, paramsFor, readParam, sameTarget, type ParamEntry, type ParamTarget, type RegistrySource } from './paramRegistry';
import type { ControlLine, LinePoint } from './lineModel';
import type { RecordMode } from './lineRecorder';
import { fitLineRanges } from './laneConversion';
import { generateUUID } from '../../utils/uuid';
import { pointsValueAt, SOUND_ROW_TRACK_PREFIX } from './lineEvaluator';
import { installWhereRuntime } from '../where/whereRuntime';
import { installStageFxRuntime } from '../stagefx/stageFxRuntime';
import { soundRowsFor } from '../sound/soundModel';
import { soundLineScope } from '../sound/soundParams';
import { registerParamScope } from './lineExtensions';
import { createContentRecorder } from './contentRecorder';
import { LiveTraceTable } from './liveTrace';
import { beginHistoryRestore, cancelPendingHistorySnapshot, endHistoryRestore, isAutomation, isRestoringHistory, recordDiscreteAction } from '../../stores/historyHooks';

// ── Registry over the Timeline ─────────────────────────────────────────────

function findClip(tracks: readonly ShowLayerTrack[], clipId: string): { track: ShowLayerTrack; clip: ShowLayerClip } | null {
  for (const track of tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/** The piece with a block's media as its source: what a block's lines drive. */
export function blockAsLayer(piece: Layer | null, clip: ShowLayerClip): Layer | null {
  if (!piece) return null;
  const media = clip.media;
  if (media.kind === 'shader') {
    const source = {
      ...(piece.source ?? {}),
      id: `show-block-${clip.id}`,
      type: 'shader',
      src: media.src,
      name: media.name,
      shaderCode: media.shaderCode,
      shaderInputs: media.shaderInputs,
      shaderValues: { ...(media.shaderValues ?? {}) },
    } as MediaSource;
    return { ...piece, source };
  }
  if (media.jsAnimation) {
    return { ...piece, source: { ...(piece.source ?? {}), id: `show-block-${clip.id}`, type: 'video', src: media.src, name: media.name, jsAnimation: media.jsAnimation } as MediaSource };
  }
  if (media.kind === 'video') {
    return { ...piece, source: { ...(piece.source ?? {}), id: `show-block-${clip.id}`, type: 'video', src: media.src, name: media.name } as MediaSource };
  }
  return null;
}

/** What the lines' registry reads: the project, plus the Timeline's own. */
export function timelineRegistrySource(): RegistrySource {
  const p = get(project) as any;
  const s = get(showTimeline);
  const layers: Layer[] = p?.layers ?? [];
  const pieceLayer = (layerId: string) => {
    const live = layers.find((l) => l.id === layerId);
    if (live) return live;
    return s.layerTracks.find((t) => t.layerId === layerId && t.template)?.template ?? null;
  };
  return {
    layers,
    mappingComposition: p?.mappingComposition,
    wledControllers: p?.wledControllers,
    wledEffects: p?.wledEffects,
    pieceLayer,
    blockLayer: (clipId) => {
      const found = findClip(s.layerTracks, clipId);
      return found ? blockAsLayer(pieceLayer(found.track.layerId), found.clip) : null;
    },
    hasLookBlock: (clipId) => (clipId === ALL_LOOKS_ID ? s.lookClips.length > 0 : s.lookClips.some((c) => c.id === clipId)),
    ledBlock: (clipId) => s.ledClips.find((c) => c.id === clipId) ?? null,
    stageBlock: (clipId) => s.stageClips.find((c) => c.id === clipId) ?? null,
    whereOf: (clipId) => s.lookClips.find((c) => c.id === clipId)?.where
      ?? s.ledClips.find((c) => c.id === clipId)?.where
      ?? s.stageClips.find((c) => c.id === clipId)?.where
      ?? findClip(s.layerTracks, clipId)?.clip.where
      ?? null,
  };
}

// The sound rows are a line scope on the extension mechanism, with the
// Timeline's own rows (lineExtensions.ts).
registerParamScope(soundLineScope(() => {
  const s = get(showTimeline);
  return soundRowsFor(s.sound, s.audioTracks);
}));

export function describeLineParam(target: ParamTarget, key: string): ParamEntry | null {
  return findParam(timelineRegistrySource(), target, key);
}

export function paramsForTarget(target: ParamTarget): ParamEntry[] {
  try {
    return paramsFor(timelineRegistrySource(), target);
  } catch {
    return [];
  }
}

// ── UI state ───────────────────────────────────────────────────────────────

export interface LineRecordUi {
  armed: boolean;
  mode: RecordMode;
  /** "Touch a knob to bind": the parameter the next moved CC binds to. */
  bindPending: { target: ParamTarget; key: string; label: string } | null;
  /** A pass is being written right now. */
  writing: boolean;
  /** Follow edits: while armed, every parameter you change in the editor is
   *  recorded, not only the ones with a line or a bound control. */
  followEdits: boolean;
  /** Why recording stopped on its own (a take at its length cap), until the next take. */
  notice: string | null;
}
const FOLLOW_EDITS_KEY = 'ga.timeline.followEdits';
function storedFollowEdits(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(FOLLOW_EDITS_KEY) === '1'; } catch { return false; }
}
export const lineRecordState = writable<LineRecordUi>({ armed: false, mode: 'touch', bindPending: null, writing: false, followEdits: storedFollowEdits(), notice: null });
// Armed, the Timeline plays even when empty and rolls on past its end.
setShowRecordArm(() => get(lineRecordState).armed);

/** The line being edited, and its selected points (indices). */
// The point and key selection lives in lineSelection.ts (light enough for
// the track commands to import); re-exported here for its users.
export { lineSelection, selectedLinePoints, selectedKeys, selectKeys, clearSelectedKeys, type LineSelection } from './lineSelection';
import { lineSelection } from './lineSelection';

/** Live values of lines that follow a live source (for the faint trace): the last 30 s. */
export const liveTraces = new LiveTraceTable(30);
/** Moves when a live trace grew (every few frames) or the offline sources changed (songs read). */
export const liveTraceVersion = writable(0);
/**
 * A record pass being written, for the view: the recorder's own samples (not
 * a copy; read them, never change them) and how many of them were there when
 * this was published. The recorder only adds samples at the end and moves
 * the last one on, so the view can draw what is new since it last looked.
 */
export interface RecordingPass {
  samples: ReadonlyArray<{ t: number; v: number }>;
  count: number;
}
/** Record passes being written right now, by line id (drawn as they grow). */
export const recordingPasses = writable<ReadonlyMap<string, RecordingPass>>(new Map());
let passesShown = false;
/** The longest take: a record run stops here on its own (show-time seconds of
 *  recording, so it also ends a run rolling on past the end of the Timeline). */
export const MAX_TAKE_SECONDS = 30 * 60;
export const TAKE_CAP_NOTICE = 'Live key stopped: a take can be 30 minutes at most';
/** Show time recorded in this take, and where the last frame was. */
let takeSeconds = 0;
let takeLast: number | null = null;
let takeStopping = false;

// ── Session ────────────────────────────────────────────────────────────────

let session: LineSession | null = null;
let unsubStore: (() => void) | null = null;
let unsubContent: (() => void) | null = null;

// Follow edits also records what each piece shows: other content put on a
// layer while armed and playing becomes a block on its row.
const contentRecorder = createContentRecorder({
  armed: () => { const r = get(lineRecordState); return r.armed && r.followEdits; },
  layers: () => ((get(project) as { layers?: Layer[] } | null)?.layers ?? []),
  rowOf: (layer) => get(showTimeline).layerTracks.find((t) => t.layerId === layer.id && !t.subRow) ?? null,
  // A piece without a row gets one in the same step as its block.
  write: (layer, media, start, end) => { showTimeline.recordLayerBlockFor(layer, media, start, end); },
  // Parked with Live edit on, a swap is held until Update (liveEdit.ts).
  swapAt: (layer, row, media, t, before, previous) => {
    if (!holdContentEdit(row, media, t, before, { layerId: layer.id, previous: (previous ?? null) as MediaSource | null })) showTimeline.cutInLayerMediaFor(layer, media, t, before);
  },
  notAPerson: () => isAutomation() || isRestoringHistory(),
});
let lastPlaying = false;
let lastSongsKey = '';
let traceTick = 0;
let liveTraceTick = 0;

export function currentLineSession(): LineSession | null {
  return session;
}

const EMPTY_HELD: ReadonlyMap<string, number> = new Map();

function syncRecordUi(): void {
  const r = session?.recorder;
  const pending = session?.controls.pendingBind() ?? null;
  // Runs every frame while armed: a store's update() tells its subscribers
  // even when it hands the same object back, so publish only a change.
  const x = get(lineRecordState);
  const armed = r?.armed ?? false;
  const writing = (r?.openPasses() ?? 0) > 0;
  const bindPending = pending ? (x.bindPending && sameTarget(x.bindPending.target, pending.target) && x.bindPending.key === pending.key ? x.bindPending : { ...pending, label: pending.key }) : null;
  if (x.armed === armed && x.writing === writing && x.bindPending === bindPending) return;
  lineRecordState.set({ ...x, armed, writing, bindPending });
}

function startSession(): void {
  stopSession();
  const s = get(showTimeline);
  const mode = get(lineRecordState).mode;
  const next = createLineSession({
    initial: s.lines,
    bindings: s.lineBindings,
    onBindingsChange: (b) => showTimeline.setLineBindings(b),
    registry: timelineRegistrySource,
    // Parked with Live edit on, a change is held until Update (liveEdit.ts).
    keyAt: (target, key, value, t, was) => { if (!holdParamEdit(target, key, value, t, was)) keyAtPlayhead(target, key, value, t, was); },
    // While parked, a held change shows over its line; playing shows the Timeline as it is.
    held: () => (get(showTimeline).isPlaying ? EMPTY_HELD : heldTouches()),
  });
  session = next;
  lastPlaying = s.isPlaying;
  // Recorded passes land in the session's store: make each one a step of
  // the document's undo.
  unsubStore = next.store.subscribe((state) => {
    const doc = get(showTimeline);
    if (session !== next || state.lines === doc.lines) return;
    // The pass and the control moves that made it are one step: a slider's
    // own edit, still waiting for its debounce, is folded into this one.
    cancelPendingHistorySnapshot();
    showTimeline.setLines(state.lines);
    syncRecordUi();
  });
  // Converted ◆ lanes and old files: ranges fit the parameters.
  const fitted = fitLineRanges(s.lines, describeLineParam);
  if (fitted !== s.lines) showTimeline.setLines(fitted, { quiet: true });
  unsubContent = project.subscribe(() => contentRecorder.observe());
  next.setFollowEdits(get(lineRecordState).followEdits);
  if (get(lineRecordState).armed) next.arm(mode);
  void refreshSongs(true);
  retick();
}

function stopSession(): void {
  contentRecorder.stop();
  unsubContent?.();
  unsubContent = null;
  // Dispose first: it closes any open pass (a Live Key latch mid-move),
  // and those points land through the store subscription below.
  session?.dispose();
  unsubStore?.();
  unsubStore = null;
  session = null;
  syncRecordUi();
}

/** Evaluate at the playhead now (an edit while paused). */
function retick(): void {
  if (!session) return;
  const s = get(showTimeline);
  if (s.doc !== 'timeline') return;
  session.tick(s.currentTime, s.isPlaying, s.tempo);
  contentRecorder.tick(s.currentTime, s.isPlaying);
}

async function refreshSongs(force = false): Promise<void> {
  const s = get(showTimeline);
  if (!session) return;
  const follows = s.lines.some((l) => l.follow && (l.follow.source.kind === 'audio' || l.follow.source.kind === 'stem'));
  const audible = s.audioTracks.filter((t) => t.url && !t.muted);
  const rows = soundRowsFor(s.sound, s.audioTracks);
  const placements = follows
    ? [
        ...audible.map((t) => ({ trackId: t.id, url: t.url, startTime: t.startTime, offset: t.offset ?? 0, length: t.duration })),
        // Each Timeline sound row as a source: every block on it, at its fades and level.
        ...audible.filter((t) => rows[t.lane]).map((t) => ({
          trackId: `${SOUND_ROW_TRACK_PREFIX}${rows[t.lane].id}`, url: t.url, startTime: t.startTime, offset: t.offset ?? 0, length: t.duration,
          fadeIn: t.fadeIn, fadeOut: t.fadeOut, gain: t.volume,
        })),
      ]
    : [];
  const key = JSON.stringify(placements);
  if (!force && key === lastSongsKey) return;
  lastSongsKey = key;
  const at = session;
  try {
    await at.useSongs(placements);
  } catch (err) {
    console.warn('[TimelineLines] song analysis failed:', err);
  }
  if (session === at) {
    retick();
    liveTraceVersion.update((n) => n + 1);
  }
}

function onTick(tick: ShowLineTick): void {
  if (tick.doc !== 'timeline' || !session) return;
  if (tick.manual) {
    session.exportFrame(tick.time, tick.tempo);
    return;
  }
  if (lastPlaying && !tick.playing) session.stopped(tick.time);
  lastPlaying = tick.playing;
  session.tick(tick.time, tick.playing, tick.tempo);
  contentRecorder.tick(tick.time, tick.playing);
  if (tick.playing) recordTraces(tick.time);
  if (session.recorder.armed || get(lineRecordState).bindPending) syncRecordUi();
  countTake(tick.time, tick.playing && session.recorder.armed);
  const open = session.recorder.openPasses();
  if (open > 0) {
    // The samples themselves, not copies: the view draws what is new.
    if (++traceTick % 3 === 0) {
      const out = new Map<string, RecordingPass>();
      for (const [id, samples] of session.recorder.passSamples()) out.set(id, { samples, count: samples.length });
      recordingPasses.set(out);
      passesShown = true;
    }
  } else if (passesShown) {
    passesShown = false;
    recordingPasses.set(new Map());
  }
}

/** A take is capped: at MAX_TAKE_SECONDS of recording the show stops, and says why. */
function countTake(time: number, recording: boolean): void {
  if (!recording) {
    takeSeconds = 0;
    takeLast = null;
    takeStopping = false;
    return;
  }
  if (takeLast === null) setRecordNotice(null);
  const dt = takeLast === null ? 0 : time - takeLast;
  // Play only: a loop wrap, a seek or a section jump is not recorded time.
  if (dt > 0 && dt <= 0.5) takeSeconds += dt;
  takeLast = time;
  if (takeSeconds < MAX_TAKE_SECONDS || takeStopping) return;
  takeStopping = true;
  setRecordNotice(TAKE_CAP_NOTICE);
  // After this frame: stopping ends every open pass (one undo step each).
  queueMicrotask(() => { if (get(showTimeline).isPlaying) showTimeline.pause(); });
}

function setRecordNotice(notice: string | null): void {
  if (get(lineRecordState).notice !== notice) lineRecordState.update((x) => ({ ...x, notice }));
}

function recordTraces(time: number): void {
  const controls = session!.controls;
  const any = liveTraces.record(get(showTimeline).lines, time, (src) => (src.kind === 'midi' ? controls.midiCC(src.channel, src.cc, src.input) : null));
  if (any && ++liveTraceTick % 4 === 0) liveTraceVersion.update((n) => n + 1);
}

/** Wire the lines into the app (once, at start). */
export function installTimelineLines(): () => void {
  setShowLineTicker(onTick);
  // Where lines and LED rows evaluate right after the lines, on the same tick.
  const stopWhere = installWhereRuntime();
  // Screen FX and Effects rows, on the same evaluation.
  const stopStageFx = installStageFxRuntime();
  if (get(showTimeline).doc === 'timeline') startSession();
  const offDoc = onShowDocChange((doc) => {
    // What Live edit holds belongs to the document it was made in.
    resetLiveEdit();
    if (doc === 'timeline') startSession();
    else stopSession();
  });
  const offReset = onShowTimelineReset(() => {
    resetLiveEdit();
    // Another project (or the same reopened): its own bindings and lines.
    queueMicrotask(() => {
      if (get(showTimeline).doc === 'timeline') startSession();
    });
  });
  let lastLines = get(showTimeline).lines;
  let lastBindings = get(showTimeline).lineBindings;
  let lastAudio = get(showTimeline).audioTracks;
  let lastSound = get(showTimeline).sound;
  let lastTracks = get(showTimeline).layerTracks;
  let lastLooks = get(showTimeline).lookClips;
  let lastStage = get(showTimeline).stageClips;
  let lastLeds = get(showTimeline).ledClips;
  const unsub = showTimeline.subscribe((s) => {
    if (!session || s.doc !== 'timeline') return;
    if (s.lines !== lastLines) {
      lastLines = s.lines;
      if (session.store.lines() !== s.lines) session.store.reset(s.lines);
      if (!s.isPlaying) retick();
      void refreshSongs();
    }
    if (s.lineBindings !== lastBindings) {
      lastBindings = s.lineBindings;
      if (session.controls.bindings() !== s.lineBindings) session.controls.setBindings(s.lineBindings);
    }
    if (s.audioTracks !== lastAudio || s.sound !== lastSound) {
      lastAudio = s.audioTracks;
      lastSound = s.sound;
      void refreshSongs();
    }
    if (s.layerTracks !== lastTracks || s.lookClips !== lastLooks || s.stageClips !== lastStage || s.ledClips !== lastLeds) {
      lastTracks = s.layerTracks;
      lastLooks = s.lookClips;
      lastStage = s.stageClips;
      lastLeds = s.ledClips;
      // A block's own values moved (its panel): record it when armed.
      session.observe();
    }
  });
  // Live edit is the recorder armed with Follow edits; its held changes
  // show at once, so a change to them is evaluated again.
  installLiveEditHooks({
    keyAt: (target, key, value, t, was) => { keyAtPlayhead(target, key, value, t, was); },
    cutIn: (edit) => {
      if (edit.trackId) { showTimeline.cutInLayerMedia(edit.trackId, edit.media, edit.t, edit.before); return; }
      // Held before the piece had a row: the row is made with the cut-in.
      const layer = edit.piece ? layerOf(edit.piece.layerId) : null;
      if (layer) showTimeline.cutInLayerMediaFor(layer, edit.media, edit.t, edit.before);
    },
    revert: discardEdits,
    setArmed: (on) => {
      if (on) {
        setFollowEdits(true);
        armLines();
      } else {
        disarmLines();
      }
    },
  });
  const offLive = lineRecordState.subscribe((r) => setLiveEditArmed(r.armed && r.followEdits));
  const offHeld = heldEdits.subscribe(() => { if (!get(showTimeline).isPlaying) retick(); });
  return () => {
    offLive();
    offHeld();
    unsub();
    offDoc();
    offReset();
    setShowLineTicker(null);
    stopWhere();
    stopStageFx();
    stopSession();
  };
}

function layerOf(id: string): Layer | null {
  return ((get(project) as { layers?: Layer[] } | null)?.layers ?? []).find((l) => l.id === id) ?? null;
}

/**
 * Live edit's Discard: each held change's own setting or content goes back
 * to what it was before (liveEditRevert.ts), as one undo step, and nothing
 * else moves. Written as a restore, so Follow edits and the content
 * recorder take it as no one's edit (nothing new is held or recorded).
 */
function discardEdits(edits: readonly HeldEdit[]): { ok: true } | { ok: false; reason: string } {
  const before = get(project) as Project;
  const plan = planDiscard(before, edits);
  if (!plan.ok) return { ok: false, reason: cantDiscard(plan.edit) };
  beginHistoryRestore();
  try {
    if (plan.project !== before) project.update((p) => (p === before ? plan.project : p));
    for (const s of plan.sources) project.setLayerSource(s.layerId, s.source, { history: false });
  } finally {
    endHistoryRestore();
  }
  recordDiscreteAction();
  return { ok: true };
}

function cantDiscard(edit: HeldEdit): string {
  if (edit.kind === 'content') return "Discard can't put back what that piece showed: it is gone. Press Update to keep the change, or Stop.";
  const label = describeLineParam(edit.target, edit.key)?.label ?? 'a setting whose piece is gone';
  return `Discard can't put back ${label}. Undo it, or press Update to keep it.`;
}

// ── Commands (the UI calls these) ──────────────────────────────────────────

export function armLines(mode: RecordMode = get(lineRecordState).mode): void {
  lineRecordState.update((x) => ({ ...x, mode, armed: true, notice: null }));
  session?.arm(mode);
  retick();
  syncRecordUi();
}

export function disarmLines(): void {
  contentRecorder.stop();
  session?.disarm();
  lineRecordState.update((x) => ({ ...x, armed: false, notice: null }));
  syncRecordUi();
}

/** Follow edits on or off: armed, it records every parameter you change. */
export function setFollowEdits(on: boolean): void {
  lineRecordState.update((x) => (x.followEdits === on ? x : { ...x, followEdits: on }));
  try { localStorage.setItem(FOLLOW_EDITS_KEY, on ? '1' : '0'); } catch { /* private window */ }
  session?.setFollowEdits(on);
  retick();
}

export function setRecordMode(mode: RecordMode): void {
  lineRecordState.update((x) => ({ ...x, mode }));
  if (session?.recorder.armed) session.recorder.setMode(mode);
}

/** "Touch a knob to bind": the next moved MIDI CC drives this parameter. */
export function bindNextControl(target: ParamTarget, key: string, label: string): void {
  if (!session) return;
  session.controls.bindNext(target, key);
  lineRecordState.update((x) => ({ ...x, bindPending: { target, key, label } }));
}

export function cancelBind(): void {
  session?.controls.cancelBind();
  lineRecordState.update((x) => ({ ...x, bindPending: null }));
}

export function unbindControl(id: string): void {
  session?.controls.unbind(id);
}

/** A panel control moved (in parameter units): recorded when armed and playing. */
export function lineControlInput(target: ParamTarget, key: string, value: number | boolean): void {
  session?.controls.controlInput(target, key, value);
}

const LINE_COLORS = ['#ff5c8a', '#5ce1e6', '#ffd166', '#7ae582', '#a78bfa', '#ff9f43', '#4dabf7', '#f783ac', '#c0eb75', '#e599f7'];

/** A colour for a new line: the first the target's lines do not use. */
export function nextLineColor(lines: readonly ControlLine[], target: ParamTarget): string {
  const used = new Set(lines.filter((l) => sameTarget(l.target, target)).map((l) => l.color));
  return LINE_COLORS.find((c) => !used.has(c)) ?? LINE_COLORS[lines.length % LINE_COLORS.length];
}

/** The value a parameter has at show time `t`: its line there, else the stored value, else its default. */
export function valueAt(line: ControlLine | undefined, entry: ParamEntry | null, target: ParamTarget, t: number): number {
  if (line?.points.length) {
    const v = pointsValueAt(line.points, t, line.kind === 'bool' || line.kind === 'stepped' ? 'hold' : 'linear', line.kind === 'colour');
    if (v !== undefined) return v;
  }
  const stored = readParam(timelineRegistrySource(), target, entry?.key ?? line?.key ?? '');
  if (typeof stored === 'number') return stored;
  if (typeof stored === 'boolean') return stored ? 1 : 0;
  const d = entry?.default ?? line?.default;
  return typeof d === 'boolean' ? (d ? 1 : 0) : typeof d === 'number' ? d : entry?.min ?? 0;
}

/** A new line for a parameter (no points yet: it drives nothing until it has some). */
export function makeLine(target: ParamTarget, entry: ParamEntry, lines: readonly ControlLine[]): ControlLine {
  return {
    id: generateUUID(),
    target,
    key: entry.key,
    kind: entry.kind,
    min: entry.min,
    max: entry.max,
    step: entry.step,
    default: typeof entry.default === 'boolean' ? (entry.default ? 1 : 0) : entry.default,
    points: [],
    label: entry.label,
    color: nextLineColor(lines, target),
  };
}

/** Add a line for a parameter (if it has none) with a point at `time` holding its value there. Returns the line id. */
export function addLineWithPoint(target: ParamTarget, key: string, time: number, value?: number): string | null {
  const entry = describeLineParam(target, key);
  const lines = get(showTimeline).lines;
  const existing = lines.find((l) => l.key === key && sameTarget(l.target, target));
  if (!entry && !existing) return null;
  const line = existing ?? makeLine(target, entry!, lines);
  const v = value ?? valueAt(existing, entry, target, time);
  const point: LinePoint = line.kind === 'bool' || line.kind === 'stepped' ? { t: Math.max(0, time), v, c: 'hold' } : { t: Math.max(0, time), v };
  const points = [...line.points.filter((p) => Math.abs(p.t - point.t) > 1e-4), point].sort((a, b) => a.t - b.t);
  const next = { ...line, points };
  showTimeline.editLines((list) => (existing ? list.map((l) => (l.id === line.id ? next : l)) : [...list, next]));
  lineSelection.set({ lineId: line.id, points: [points.indexOf(point)], channel: 'points', of: points });
  return line.id;
}

/**
 * Live edit: a setting changed in the editor while the playhead is parked
 * (armed, Follow edits on) is keyed on its line at the playhead. A first key
 * makes the line. One gesture (a slider drag, a corner drag) is one undo step.
 */
// A slider drag sends a stream of changes: they make one step. A pause longer
// than this starts a new gesture, so two separate drags never share a step.
const LIVE_EDIT_GESTURE_MS = 250;
let liveEditAt = 0;
let liveEditSeq = 0;

export function keyAtPlayhead(target: ParamTarget, key: string, value: number | boolean, time: number, was?: number | boolean): boolean {
  const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (nowMs - liveEditAt > LIVE_EDIT_GESTURE_MS) liveEditSeq++;
  liveEditAt = nowMs;
  const entry = describeLineParam(target, key);
  const lines = get(showTimeline).lines;
  const existing = lines.find((l) => l.key === key && sameTarget(l.target, target));
  if (!entry && !existing) return false;
  const line = existing ?? makeLine(target, entry!, lines);
  const v = typeof value === 'boolean' ? (value ? 1 : 0) : value;
  const point: LinePoint = line.kind === 'bool' || line.kind === 'stepped' || line.kind === 'colour' ? { t: Math.max(0, time), v, c: 'hold' } : { t: Math.max(0, time), v };
  // A new line from a change part-way through: the setting keeps what it
  // was up to the change (held, then the change), not the new value from 0.
  const start: LinePoint[] = !existing && was !== undefined && point.t > 1e-3
    ? [{ t: 0, v: typeof was === 'boolean' ? (was ? 1 : 0) : was, c: 'hold' }]
    : [];
  const points = [...start, ...line.points.filter((p) => Math.abs(p.t - point.t) > 1e-4), point].sort((a, b) => a.t - b.t);
  const next = { ...line, points };
  return showTimeline.editLines(
    (list) => (existing ? list.map((l) => (l.id === line.id ? next : l)) : [...list, next]),
    `live-edit:${line.id}:${point.t.toFixed(3)}:${liveEditSeq}`,
  );
}

/** Add a line with one point at the playhead (the ⌇+ picker). */
export function addLineAtPlayhead(target: ParamTarget, key: string): string | null {
  return addLineWithPoint(target, key, get(showTimeline).currentTime);
}

/** Test seam. */
export function _resetTimelineLinesForTest(): void {
  stopSession();
  lineRecordState.set({ armed: false, mode: 'touch', bindPending: null, writing: false, followEdits: false, notice: null });
  lineSelection.set(null);
  liveTraces.clear();
  recordingPasses.set(new Map());
  passesShown = false;
  countTake(0, false);
  lastSongsKey = '';
}
