/**
 * The live side of A/V phrases, installed with show control:
 *
 * - Pads (VJ mode's Phrases strip, the Timeline's phrase strip, MIDI / OSC
 *   `show:phrase:<n>`) launch a phrase on the next bar of the launch clock
 *   with VJ mode's launch quantise (whole bars: Off and beat grids launch on
 *   the next bar). The Timeline's own transport plays it.
 * - Live: the phrase's Live clips go out ahead of the bar, each inside its
 *   row's grid step (the Live scheduler's own rule), with stops for the
 *   tracks the old phrase leaves; a section's Live scene is fired the same
 *   way, also when the Timeline simply plays into the section.
 * - A Live scene linked to a phrase (Ableton links) launches it at once: Live
 *   already waited for its launch quantise and started its clips, so the
 *   phrase's own fires are left out.
 * - In VJ mode with the decks live, a phrase hands the output to the
 *   Timeline (the pieces) and Stop gives it back.
 */
import { get } from 'svelte/store';
import {
  onShowFrame,
  setShowPhraseEffects,
  showPhraseStatus,
  showTimeline,
  type PhraseOrigin,
  type ShowFrameTick,
  type ShowPhraseEvent,
} from '../../stores/showTimeline';
import { vjClipLauncher } from '../../stores/vjClipLauncher';
import { nextLaunchBoundary } from '../../stores/launchClock';
import { abletonBridge, LIVE_PHRASE_PROTOCOL, setPhraseLinkLauncher, type AbletonBridgeState } from '../../ableton/abletonBridge';
import { quantizeBeats } from '../../ableton/abletonLinks';
import { showToast } from '../../stores/errorToast';
import { bpmAt } from '../sound/rowBus';
import { fireLead, LIVE_Q_QUARTER, type LiveClipScheduler } from '../sound/liveSchedule';
import { liveSchedulerNow } from '../sound/soundEngine';
import type { TimelineSection } from '../sections/sectionModel';
import { phraseByNumber, phraseGridBeats } from './phraseModel';

/** Latency allowed for a scene fire (s), like a Live row's default. */
const SCENE_LATENCY = 0.02;
/** The landing's requests are checked this often (ms). */
const ENTRY_POLL_MS = 4;

/** Where Live requests go (tests replace it). */
export interface PhraseLiveOut {
  fireScene(scene: number, q?: number): void;
  scheduler(): LiveClipScheduler;
  bridge(): AbletonBridgeState;
}
let out: PhraseLiveOut = {
  fireScene: (scene, q) => abletonBridge.launchScene(scene, q !== undefined ? { q } : {}),
  scheduler: () => liveSchedulerNow(),
  bridge: () => get(abletonBridge),
};
/** Test seam. */
export function setPhraseLiveOut(next: Partial<PhraseLiveOut> | null): void {
  out = next
    ? { ...out, ...next }
    : { fireScene: (scene, q) => abletonBridge.launchScene(scene, q !== undefined ? { q } : {}), scheduler: () => liveSchedulerNow(), bridge: () => get(abletonBridge) };
}

let nowMs: () => number = () => performance.now();
/** Test seam: the wall clock (ms). */
export function setPhraseRuntimeClock(clock: (() => number) | null): void {
  nowMs = clock ?? (() => performance.now());
}

// ── Live scenes ────────────────────────────────────────────────────────────

/** The scene a section fires, found by name when scenes moved in Live. */
export function resolveSceneIndex(section: Pick<TimelineSection, 'liveScene'>, bridge: Pick<AbletonBridgeState, 'scenes'>): number | null {
  const ref = section.liveScene;
  if (!ref) return null;
  const scenes = bridge.scenes;
  if (ref.name) {
    if (scenes[ref.scene]?.name === ref.name) return ref.scene;
    const byName = scenes.findIndex((s) => s.name === ref.name);
    if (byName >= 0) return byName;
  }
  return ref.scene >= 0 && ref.scene < scenes.length ? ref.scene : null;
}

/** How a scene fire goes out: on the beat with protocol 6 (sent inside the
 *  beat before), else on the set's launch quantise. */
export function sceneLaunch(bridge: Pick<AbletonBridgeState, 'protocol' | 'quantize' | 'numerator' | 'denominator'>, bpm: number): { q?: number; lead: number } {
  const beat = 60 / (bpm > 0 ? bpm : 120);
  if (bridge.protocol >= LIVE_PHRASE_PROTOCOL) return { q: LIVE_Q_QUARTER, lead: fireLead(beat, SCENE_LATENCY) };
  const step = quantizeBeats(bridge.quantize, bridge.numerator, bridge.denominator) * beat;
  return { lead: fireLead(step, SCENE_LATENCY) };
}

// ── The landing ────────────────────────────────────────────────────────────

interface Pending<T> { item: T; lead: number; sent: boolean }
interface Entry {
  id: string;
  at: number;
  fires: Pending<{ blockId: string; cmd: Parameters<LiveClipScheduler['sendEntry']>[0] }>[];
  stops: Pending<number>[];
  scene: Pending<{ index: number; q?: number }> | null;
  /** Launched by a Live scene: nothing goes to Live, the blocks are primed. */
  fromLive: boolean;
}
let entry: Entry | null = null;
let entryTimer: ReturnType<typeof setInterval> | null = null;
/** The landing just happened: the next frame's jump must not fire the scene again. */
let landedSeek = false;
/** VJ mode's decks were live and a phrase took the output. */
let vjHandedOver = false;

function stopEntryTimer(): void {
  if (entryTimer) clearInterval(entryTimer);
  entryTimer = null;
}

function sendDue(force: boolean): void {
  const e = entry;
  if (!e || e.fromLive) return;
  const now = nowMs();
  const due = (lead: number) => force || now >= e.at - lead * 1000;
  const scheduler = out.scheduler();
  for (const s of e.stops) if (!s.sent && due(s.lead)) { s.sent = true; scheduler.stopForEntry(s.item); }
  for (const f of e.fires) if (!f.sent && due(f.lead)) { f.sent = true; scheduler.sendEntry(f.item.cmd); }
  if (e.scene && !e.scene.sent && due(e.scene.lead)) {
    e.scene.sent = true;
    out.fireScene(e.scene.item.index, e.scene.item.q);
  }
}

function planEntry(id: string, at: number, origin: PhraseOrigin): void {
  stopEntryTimer();
  const s = get(showTimeline);
  const section = s.sections.find((x) => x.id === id);
  entry = null;
  if (!section) return;
  const bridge = out.bridge();
  const fromLive = origin.scene !== undefined;
  const scheduler = out.scheduler();
  const plan = bridge.connected ? scheduler.entryPlan(section.start) : { fires: [], stops: [] };
  const sceneIndex = bridge.connected && !fromLive ? resolveSceneIndex(section, bridge) : null;
  const launch = sceneLaunch(bridge, bpmAt(s.tempo, section.start));
  entry = {
    id,
    at,
    fromLive,
    fires: plan.fires.map((f) => ({ item: { blockId: f.blockId, cmd: f.cmd }, lead: f.lead, sent: false })),
    stops: plan.stops.map((x) => ({ item: x.track, lead: x.lead, sent: false })),
    scene: sceneIndex !== null ? { item: { index: sceneIndex, q: launch.q }, lead: launch.lead, sent: false } : null,
  };
  // The playing phrase fires nothing past its last bar.
  if (s.isPlaying) scheduler.setCut(s.currentTime + Math.max(0, at - nowMs()) / 1000);
  sendDue(false);
  if (!fromLive && (entry.fires.length || entry.stops.length || entry.scene)) entryTimer = setInterval(() => sendDue(false), ENTRY_POLL_MS);
}

function landEntry(id: string): void {
  stopEntryTimer();
  const e = entry && entry.id === id ? entry : null;
  entry = null;
  const scheduler = out.scheduler();
  if (e) {
    // Anything the poll had not sent yet goes now (late, never lost).
    entry = e;
    sendDue(true);
    entry = null;
    scheduler.primeEntry(e.fires.map((f) => f.item.blockId));
  } else {
    scheduler.primeEntry([]);
  }
  landedSeek = true;
}

function handOutput(on: boolean): void {
  const vj = get(vjClipLauncher);
  if (on) {
    if (vj.isOpen && vj.isLive) {
      vjClipLauncher.setLive(false);
      vjHandedOver = true;
      showToast('The phrase plays the Timeline on the pieces: the decks hand the output over until Stop.', 'info');
    }
  } else if (vjHandedOver) {
    vjHandedOver = false;
    if (vj.isOpen && !vj.isLive) vjClipLauncher.setLive(true);
  }
}

export function handlePhraseEvent(e: ShowPhraseEvent): void {
  switch (e.type) {
    case 'pending':
      if (e.id) planEntry(e.id, e.at, e.origin);
      else {
        stopEntryTimer();
        entry = null;
        const s = get(showTimeline);
        if (s.isPlaying) out.scheduler().setCut(s.currentTime + Math.max(0, e.at - nowMs()) / 1000);
      }
      break;
    case 'land':
      landEntry(e.id);
      handOutput(true);
      break;
    case 'stop':
      stopEntryTimer();
      entry = null;
      out.scheduler().setCut(null);
      handOutput(false);
      break;
    case 'cancel':
      stopEntryTimer();
      entry = null;
      out.scheduler().setCut(null);
      break;
  }
}

// ── Sections firing their scene while the Timeline plays ───────────────────

let prevTick: { time: number; seek: number; playing: boolean } | null = null;
const firedAt = new Set<string>();

export function sceneTick(tick: ShowFrameTick): void {
  if (tick.doc !== 'timeline' || tick.manual) {
    prevTick = null;
    return;
  }
  const prev = prevTick;
  prevTick = { time: tick.time, seek: tick.seek, playing: tick.playing };
  if (!tick.playing) {
    firedAt.clear();
    return;
  }
  const bridge = out.bridge();
  if (!bridge.connected) return;
  const s = get(showTimeline);
  const scened = s.sections.filter((x) => x.liveScene);
  if (!scened.length) return;
  const jumped = !prev || !prev.playing || prev.seek !== tick.seek;
  const landing = landedSeek;
  landedSeek = false;
  const cutAt = get(showPhraseStatus).pending ? showTimeline.phrasePendingAt() : null;
  for (const sec of scened) {
    const key = `${sec.id}:${tick.seek}`;
    if (firedAt.has(key)) continue;
    const launch = sceneLaunch(bridge, bpmAt(s.tempo, sec.start));
    const fireAt = sec.start - launch.lead;
    let fire = false;
    if (!jumped && prev) fire = prev.time < fireAt && tick.time >= fireAt && tick.time < sec.end;
    // Started (or jumped) right at a section's start: it fires now. A
    // phrase landing fired its own.
    else if (!landing) fire = tick.time >= fireAt && tick.time < sec.start + 0.05;
    // A phrase is taking over on the bar: what lies past it does not start.
    if (fire && cutAt !== null && sec.start - tick.time > (cutAt - nowMs()) / 1000 - 1e-3) fire = false;
    if (!fire) continue;
    const index = resolveSceneIndex(sec, bridge);
    if (index === null) continue;
    firedAt.add(key);
    if (firedAt.size > 64) firedAt.clear();
    out.fireScene(index, launch.q);
  }
}

// ── Launching ──────────────────────────────────────────────────────────────

/** Seconds from now to the next phrase bar on the launch clock. */
export function phraseDelay(now = nowMs()): number {
  const grid = phraseGridBeats(get(vjClipLauncher).quantization);
  return Math.max(0, (nextLaunchBoundary(grid, now) - now) / 1000);
}

/**
 * Press a phrase pad: the phrase plays from its start on the next bar.
 * Pressing the pad of the phrase waiting for its bar calls it off.
 */
export function launchPhrase(id: string, opts: { origin?: PhraseOrigin } = {}): boolean {
  const s = get(showTimeline);
  if (!s.sections.some((x) => x.id === id && x.phrase)) return false;
  if (showTimeline.isChasing()) {
    showToast('The Timeline follows an outside clock: phrases need its own transport (Settings > Show control > Timecode: Follow Off).', 'info');
    return false;
  }
  const origin = opts.origin ?? {};
  const st = get(showPhraseStatus);
  if (origin.scene === undefined && st.pending?.id === id) return showTimeline.cancelPhraseLaunch();
  return showTimeline.launchPhrase(id, { delay: origin.scene !== undefined ? 0 : phraseDelay(), origin });
}

/** Pad `n` (1-based). */
export function launchPhraseNumber(n: number): boolean {
  const p = phraseByNumber(get(showTimeline).sections, n);
  return p ? launchPhrase(p.id) : false;
}

/** Stop the phrases on the next bar. */
export function stopPhrases(): void {
  const s = get(showTimeline);
  showTimeline.stopPhrases({ delay: s.isPlaying ? phraseDelay() : 0 });
}

/** A Live scene linked to a phrase launched in Live. */
function launchFromLive(sectionId: string, name: string, origin: { scene?: number }): void {
  const s = get(showTimeline);
  const section = s.sections.find((x) => x.id === sectionId && x.phrase) ?? s.sections.find((x) => !!name && x.name === name && x.phrase);
  if (!section) return;
  const st = get(showPhraseStatus);
  // The phrase fired this scene itself: Live echoes the launch back.
  if (st.activeId === section.id || st.pending?.id === section.id) return;
  launchPhrase(section.id, { origin: { scene: origin.scene ?? -1 } });
}

let installed: (() => void) | null = null;

export function installPhraseRuntime(): () => void {
  if (installed) return installed;
  setShowPhraseEffects(handlePhraseEvent);
  setPhraseLinkLauncher(launchFromLive);
  const offFrame = onShowFrame(sceneTick);
  try {
    const w = window as unknown as { __ghostArcade?: Record<string, unknown> };
    w.__ghostArcade = { ...(w.__ghostArcade ?? {}), timelinePhrases: { launch: launchPhrase, launchNumber: launchPhraseNumber, stop: stopPhrases, status: showPhraseStatus, delay: phraseDelay } };
  } catch { /* sealed */ }
  installed = () => {
    offFrame();
    setShowPhraseEffects(null);
    setPhraseLinkLauncher(null);
    stopEntryTimer();
    entry = null;
    installed = null;
  };
  return installed;
}

/** Test seam: forget the runtime's session state. */
export function _resetPhraseRuntime(): void {
  stopEntryTimer();
  entry = null;
  landedSeek = false;
  vjHandedOver = false;
  prevTick = null;
  firedAt.clear();
}
