/**
 * One way to fire anything a show can do: `fireShowAction(action)`.
 *
 * Every kind wraps the dispatcher the app already uses for it, so a zone in
 * an interactive scene, a note in the Music Studio, a phone remote and the
 * MIDI / OSC `show:` paths all do exactly what the app's own buttons do:
 *
 *   look         a shape Look on the shapes (the Looks gallery's apply)
 *   preset       recall a mapping preset (as a cue does)
 *   clip         launch a VJ clip (deck, row, column; VJ launch quantise)
 *   clipColumn   launch a VJ column
 *   liveClip     fire a clip in Ableton Live (the Ableton bridge)
 *   liveScene    fire a scene in Ableton Live
 *   section      jump to a Timeline section (the cue list's click)
 *   go           GO: the Timeline's sections when it is active and has
 *                sections (hold, vamp, Live), else the cue list
 *   transport    play / pause / stop / toggle / seek the active document
 *   phrase       launch an A/V phrase pad on the next bar, or stop them
 *   takeover     hand a piece's row to the VJ decks
 *   release      hand one row (or every row) back to the show
 *   blackout     the output's blackout on, off or toggled
 *   cue          the cue list: go, back, stop, reset, fire cue n
 *
 * Returns `{ ok: true }` when it was done, else `{ ok: false, reason }`
 * with a short code (`not-found`, `no-sections`, `not-connected`,
 * `chasing`, `invalid`, `nothing-waits`, `refused`, `error`). Never throws,
 * and a target that has gone (a deleted section, an empty VJ slot, Live not
 * connected) is a reason, not an error. Runs as live control: nothing it
 * changes becomes an undo step (like every controller).
 */
import { get } from 'svelte/store';
import { project, compositions } from '../stores/layers';
import { settings } from '../stores/settings';
import { vjClipLauncher, type VJDeck } from '../stores/vjClipLauncher';
import { parkedShowDoc, showTimeline } from '../stores/showTimeline';
import { runAsLiveControl } from '../stores/historyHooks';
import { abletonBridge, type AbletonBridgeState } from '../ableton/abletonBridge';
import { edgeLook } from '../looks/edgeLookCatalog';
import { isLookTarget } from '../looks/edgeLooks';
import { cueList } from './cueList';
import type { ShowTakeoverSourceSpec } from '../control/showControlPaths';
import { liveTakeover } from './takeover/liveTakeover';
import { returnTrack, sourceFromSpec, takeOverTrack, trackAt, trackById } from './takeover/takeoverRuntime';
import { timelineTakesGo } from '../timeline/sections/sectionRuntime';
import { launchPhrase, launchPhraseNumber, stopPhrases } from '../timeline/phrases/phraseRuntime';
import { phraseByNumber } from '../timeline/phrases/phraseModel';
import type { ShowLayerTrack } from '../types';

export type ShowAction =
  /** A shape Look on the shapes: every shape, or `layerIds`. Palette: the Look's own unless given. */
  | { kind: 'look'; lookId: string; paletteId?: string; layerIds?: string[] }
  /** Recall a mapping preset (composition), with the tray's transition when it is open. */
  | { kind: 'preset'; compositionId: string }
  /** A VJ clip: row and column from 0, deck A unless given. Waits for the VJ launch quantise. */
  | { kind: 'clip'; deck?: VJDeck; row: number; column: number }
  /** A VJ column, from 0. */
  | { kind: 'clipColumn'; deck?: VJDeck; column: number }
  /** A clip in Live: track and slot from 0 (Live's launch quantise). */
  | { kind: 'liveClip'; track: number; slot: number }
  /** A scene in Live, from 0. */
  | { kind: 'liveScene'; scene: number }
  /** Jump to a Timeline section, by id, name or position (from 0). Playing, it plays on from there. */
  | { kind: 'section'; id?: string; name?: string; index?: number }
  /** GO. */
  | { kind: 'go' }
  | { kind: 'transport'; op: 'play' | 'pause' | 'stop' | 'toggle' | 'seek'; seconds?: number }
  /** Launch a phrase on the next bar: its pad (from 1) or its section id. `stop`: stop the phrases on the next bar. */
  | { kind: 'phrase'; pad?: number; sectionId?: string; stop?: boolean }
  /** Hand a row to the VJ decks: `track` is the row as numbered on the Timeline (from 0) or a row id. */
  | { kind: 'takeover'; track: number | string; source: ShowTakeoverSourceSpec }
  /** Hand a row back (with the takeover's release setting); no `track`: every row. */
  | { kind: 'release'; track?: number | string | null }
  /** Blackout on or off; no `on`: toggle. */
  | { kind: 'blackout'; on?: boolean }
  /** The cue list. `fire`: cue `index` (from 0). */
  | { kind: 'cue'; op: 'go' | 'back' | 'stop' | 'reset' | 'fire'; index?: number };

export type ShowActionKind = ShowAction['kind'];

export type ShowActionReason = 'not-found' | 'no-sections' | 'not-connected' | 'chasing' | 'invalid' | 'nothing-waits' | 'refused' | 'error';

export interface ShowActionResult {
  ok: boolean;
  reason?: ShowActionReason;
}

const OK: ShowActionResult = { ok: true };
const fail = (reason: ShowActionReason): ShowActionResult => ({ ok: false, reason });
const index = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;

// ── Things only the app does (tests replace them) ────────────────────────

/** Where Live requests go and what the bridge knows of the set. */
export interface ShowActionLive {
  bridge(): Pick<AbletonBridgeState, 'connected' | 'tracks' | 'scenes'>;
  launchClip(track: number, slot: number): void;
  launchScene(scene: number): void;
}
const defaultLive: ShowActionLive = {
  bridge: () => get(abletonBridge),
  launchClip: (track, slot) => abletonBridge.launchClip(track, slot),
  launchScene: (scene) => abletonBridge.launchScene(scene),
};
let live: ShowActionLive = defaultLive;
/** Test seam: a fake Live. */
export function setShowActionLive(next: Partial<ShowActionLive> | null): void {
  live = next ? { ...defaultLive, ...next } : defaultLive;
}

// ── Shared with the show-control runtime ─────────────────────────────────

export function setBlackout(on: boolean): void {
  settings.update((s) => (s.output.blackout === on ? s : { ...s, output: { ...s.output, blackout: on } }));
}

/**
 * Recall a mapping preset the way a tray click does (with the tray's
 * transition) when the tray is mounted to take it; otherwise a hard cut.
 */
export function recallPreset(compositionId: string): boolean {
  if (!get(compositions).some((c) => c.id === compositionId)) return false;
  const detail = { compositionId, handled: false };
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('show-recall-preset', { detail }));
  if (!detail.handled) project.loadComposition(compositionId, { recordHistory: false });
  return true;
}

/** GO, as `show:go` from MIDI / OSC / keys has always done it. */
function go(): ShowActionResult {
  if (timelineTakesGo()) {
    const r = showTimeline.go();
    return r.kind === 'none' ? fail('nothing-waits') : OK;
  }
  return cueList.go('remote') ? OK : fail('nothing-waits');
}

function transport(op: Extract<ShowAction, { kind: 'transport' }>['op'], seconds: number | undefined): ShowActionResult {
  // A followed clock owns the playhead (as the cue list's timeline action).
  if (showTimeline.isChasing() && op !== 'seek') return fail('chasing');
  switch (op) {
    case 'play': showTimeline.play(); return OK;
    case 'pause': showTimeline.pause(); return OK;
    case 'stop': showTimeline.stop(); return OK;
    case 'toggle': showTimeline.togglePlay(); return OK;
    case 'seek':
      if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return fail('invalid');
      showTimeline.seek(seconds);
      return OK;
  }
  return fail('invalid');
}

function section(a: Extract<ShowAction, { kind: 'section' }>): ShowActionResult {
  const s = get(showTimeline);
  if (s.doc !== 'timeline' || !s.sections.length) return fail('no-sections');
  const target = a.id !== undefined ? s.sections.find((x) => x.id === a.id)
    : a.name !== undefined ? s.sections.find((x) => x.name === a.name)
      : index(a.index) ? s.sections[a.index] : undefined;
  if (!target) return fail('not-found');
  if (showTimeline.isChasing()) return fail('chasing');
  showTimeline.seek(target.start);
  return OK;
}

function phrase(a: Extract<ShowAction, { kind: 'phrase' }>): ShowActionResult {
  if (a.stop) {
    stopPhrases();
    return OK;
  }
  if (a.sectionId !== undefined) return launchPhrase(a.sectionId) ? OK : phraseMissing(a);
  if (typeof a.pad === 'number' && Number.isInteger(a.pad) && a.pad >= 1) return launchPhraseNumber(a.pad) ? OK : phraseMissing(a);
  return fail('invalid');
}

/** Why a phrase did not launch: there is no such phrase, or it was refused (an outside clock owns the playhead). */
function phraseMissing(a: Extract<ShowAction, { kind: 'phrase' }>): ShowActionResult {
  // The Timeline's sections, whichever document is open (the pads launch from the Show tab too).
  const s = get(showTimeline);
  const sections = s.doc === 'timeline' ? s.sections : get(parkedShowDoc).sections ?? [];
  const exists = a.sectionId !== undefined ? sections.some((x) => x.id === a.sectionId && x.phrase) : !!phraseByNumber(sections, a.pad ?? 0);
  return fail(exists ? 'refused' : 'not-found');
}

function row(track: number | string): ShowLayerTrack | null {
  if (typeof track === 'number') return index(track) ? trackAt(track) : null;
  return typeof track === 'string' ? trackById(track) : null;
}

function look(a: Extract<ShowAction, { kind: 'look' }>): ShowActionResult {
  if (!edgeLook(a.lookId)) return fail('not-found');
  const shapes = get(project).layers.filter(isLookTarget).map((l) => l.id);
  const targets = a.layerIds ? shapes.filter((id) => a.layerIds!.includes(id)) : shapes;
  if (!targets.length) return fail('not-found');
  return project.applyLook(targets, a.lookId, a.paletteId) > 0 ? OK : fail('refused');
}

function vjClip(deck: VJDeck, rowIndex: number, column: number): ShowActionResult {
  const st = get(vjClipLauncher);
  const grid = deck === 'B' ? st.bankBClipGrid : st.clipGrid;
  if (!grid?.[rowIndex]?.[column]) return fail('not-found');
  const states = deck === 'B' ? st.bankBLayerStates : st.layerStates;
  if (states?.[rowIndex]?.locked) return fail('refused');
  vjClipLauncher.triggerClip(rowIndex, column, deck);
  return OK;
}

function vjColumn(deck: VJDeck, column: number): ShowActionResult {
  const st = get(vjClipLauncher);
  if (column >= st.numColumns) return fail('not-found');
  const grid = deck === 'B' ? st.bankBClipGrid : st.clipGrid;
  if (!grid?.some((r) => !!r?.[column])) return fail('not-found');
  vjClipLauncher.triggerColumn(column, deck);
  return OK;
}

function run(action: ShowAction): ShowActionResult {
  switch (action.kind) {
    case 'look': return look(action);
    case 'preset': return typeof action.compositionId === 'string' && recallPreset(action.compositionId) ? OK : fail('not-found');
    case 'clip': {
      if (!index(action.row) || !index(action.column)) return fail('invalid');
      return vjClip(action.deck === 'B' ? 'B' : 'A', action.row, action.column);
    }
    case 'clipColumn':
      if (!index(action.column)) return fail('invalid');
      return vjColumn(action.deck === 'B' ? 'B' : 'A', action.column);
    case 'liveClip': {
      if (!index(action.track) || !index(action.slot)) return fail('invalid');
      const b = live.bridge();
      if (!b.connected) return fail('not-connected');
      if (!b.tracks[action.track]?.slots?.[action.slot]) return fail('not-found');
      live.launchClip(action.track, action.slot);
      return OK;
    }
    case 'liveScene': {
      if (!index(action.scene)) return fail('invalid');
      const b = live.bridge();
      if (!b.connected) return fail('not-connected');
      if (!b.scenes[action.scene]) return fail('not-found');
      live.launchScene(action.scene);
      return OK;
    }
    case 'section': return section(action);
    case 'go': return go();
    case 'transport': return transport(action.op, action.seconds);
    case 'phrase': return phrase(action);
    case 'takeover': {
      const track = row(action.track);
      if (!track) return fail('not-found');
      const source = action.source ? sourceFromSpec(action.source) : null;
      if (!source) return fail('not-found');
      return takeOverTrack(track, source) ? OK : fail('refused');
    }
    case 'release': {
      if (action.track === undefined || action.track === null) {
        liveTakeover.release('all');
        return OK;
      }
      const track = row(action.track);
      if (!track) return fail('not-found');
      return returnTrack(track) > 0 ? OK : fail('nothing-waits');
    }
    case 'blackout':
      setBlackout(typeof action.on === 'boolean' ? action.on : !get(settings).output.blackout);
      return OK;
    case 'cue':
      switch (action.op) {
        case 'go': return cueList.go('remote') ? OK : fail('nothing-waits');
        case 'back': return cueList.back() ? OK : fail('nothing-waits');
        case 'stop': cueList.stop(); return OK;
        case 'reset': cueList.reset(); return OK;
        case 'fire': {
          const cue = index(action.index) ? cueList.state.cues[action.index] : undefined;
          if (!cue) return fail('not-found');
          return cueList.fire(cue.id, 'remote') ? OK : fail('refused');
        }
      }
      return fail('invalid');
  }
  return fail('invalid');
}

/** Fire a show action. Never throws; see the file comment for the kinds and reasons. */
export function fireShowAction(action: ShowAction): ShowActionResult {
  if (!action || typeof action !== 'object' || typeof (action as { kind?: unknown }).kind !== 'string') return fail('invalid');
  try {
    return runAsLiveControl(() => run(action));
  } catch (err) {
    console.warn(`[ShowActions] ${action.kind} failed:`, err);
    return fail('error');
  }
}
