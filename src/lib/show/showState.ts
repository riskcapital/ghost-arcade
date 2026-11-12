/**
 * The show as it is right now, read-only, as one subscribable object: for a
 * phone remote, an install watchdog, or anything else that shows or reports
 * the show without driving it (to drive it, use fireShowAction).
 *
 *   const off = showState.subscribe((s) => draw(s.time, s.section?.name, s.go.label));
 *
 * Which document is active (Show / Timeline), playing, time and length,
 * tempo with bar and beat, the section the playhead is in and the next one
 * (name, kind, end action), what GO does now and the transport's status
 * line, the takeover, the A/V phrases, blackout, and install mode (running,
 * uptime, frame rate, restarts, last problem).
 *
 * Costs nothing per frame: the stores it reads only mark it changed; it is
 * worked out at most 10 times a second, and only while something is
 * subscribed. A snapshot is published only when something in it changed
 * (`at` aside), so a paused show publishes nothing. Install mode's health
 * comes from the main process every few seconds, only while install mode
 * runs.
 */
import { get, readable, type Readable } from 'svelte/store';
import { showPhraseStatus, showSectionStatus, showTimeline, type ShowSectionStatus } from '../stores/showTimeline';
import { settings } from '../stores/settings';
import { nativeRendererRuntime } from '../stores/nativeRenderer';
import { invoke, isDesktopApp } from '../bridge';
import { barBeatAt } from './tempoMap';
import { cueList } from './cueList';
import { liveTakeover, takeoverSummary } from './takeover/liveTakeover';
import { sectionAt, type SectionAction, type SectionKind, type TimelineSection } from '../timeline/sections/sectionModel';
import { goLabel, sectionStatusText } from '../components/show/timeline/sections/sectionGoUi';
import { installModeRunning, installPaused } from '../install/installSession';

export interface ShowStateSection {
  id: string;
  name: string;
  kind: SectionKind | null;
  /** What happens at its end: through, hold, vamp (loop until GO), jump, live. */
  action: SectionAction;
  start: number;
  end: number;
}

export interface ShowState {
  /** Wall clock (ms since 1970) this was worked out at. */
  at: number;
  /** The document the transport plays. */
  doc: 'show' | 'timeline';
  playing: boolean;
  /** Playhead, seconds. */
  time: number;
  /** Length, seconds (0: empty). */
  duration: number;
  loop: boolean;
  /** An outside clock (timecode, MIDI clock, Link, Live) owns the playhead. */
  following: boolean;
  /** The tempo map at the playhead, or null for a show in seconds only. */
  tempo: { bpm: number; bar: number; beat: number; beatsPerBar: number } | null;
  /** The Timeline section under the playhead, and the next one. */
  section: ShowStateSection | null;
  nextSection: ShowStateSection | null;
  go: {
    /** What GO does now ("Go on from Drop", "Leave Build after this pass", "Play"…). */
    label: string;
    /** The transport's short status ("HOLD · Drop", "LOOP · Build ×2", "GO armed · Verse"), or ''. */
    status: string;
    /** Held at a section's end, waiting for GO. */
    holding: boolean;
    /** GO was pressed ahead: the section plays on at its end. */
    armed: boolean;
    /** Who takes GO now: the Timeline's sections, or the cue list. */
    target: 'sections' | 'cues';
  };
  takeover: {
    active: boolean;
    rows: Array<{ trackId: string | null; label: string; phase: string }>;
    /** The live overlay's level, or null when there is none. */
    overlay: number | null;
  };
  phrase: {
    /** The phrase playing (its section), or null. */
    playing: { id: string; name: string } | null;
    /** A launch waiting for its bar: a phrase, or a stop (`id` null). */
    waiting: { id: string | null; name: string | null } | null;
  };
  blackout: boolean;
  install: {
    /** Install mode runs in this window (show mode launch, not left). */
    running: boolean;
    /** Since install mode started, seconds. */
    uptime: number | null;
    /** Frames a second the render core is making (null: not measured yet). */
    fps: number | null;
    /** Watchdog restarts so far (render core, editor reloads, relaunches). */
    restarts: number | null;
    /** The last restart or warning in the health log. */
    lastError: { at: number; kind: string; message: string } | null;
  };
}

/** At most this often (ms): 10 a second. */
export const SHOW_STATE_INTERVAL_MS = 100;
/** Install mode's health is asked for this often (ms) while it runs. */
export const SHOW_STATE_INSTALL_POLL_MS = 3000;

const ERROR_KINDS = new Set(['restart', 'warning', 'watchdog', 'guardian']);

function sectionInfo(s: TimelineSection | null | undefined): ShowStateSection | null {
  return s ? { id: s.id, name: s.name, kind: s.kind ?? null, action: s.action, start: s.start, end: s.end } : null;
}

const round3 = (v: number) => Math.round(v * 1000) / 1000;

interface InstallHealth {
  uptime: number | null;
  fps: number | null;
  restarts: number | null;
  lastError: ShowState['install']['lastError'];
}
const NO_HEALTH: InstallHealth = { uptime: null, fps: null, restarts: null, lastError: null };

/** Work the state out now (pure reads of the stores). */
export function sampleShowState(health: InstallHealth = NO_HEALTH, now = Date.now()): ShowState {
  const s = get(showTimeline);
  const doc = s.doc === 'timeline' ? 'timeline' : 'show';
  const time = s.currentTime;
  const sections = doc === 'timeline' ? s.sections : [];
  const status: ShowSectionStatus = get(showSectionStatus);
  const bb = s.tempo ? barBeatAt(s.tempo, time) : null;
  const here = sections.length ? sectionAt(sections, time) : null;
  const next = sections.find((x) => x.start > time + 1e-6) ?? null;
  const sectionsTakeGo = doc === 'timeline' && sections.length > 0;
  const standby = cueList.state.cues.find((c) => c.id === cueList.state.standbyCueId) ?? (!cueList.state.currentCueId ? cueList.state.cues[0] : undefined);
  const summary = takeoverSummary(liveTakeover.state);
  const phrase = get(showPhraseStatus);
  const nameOf = (id: string | null) => (id ? s.sections.find((x) => x.id === id)?.name ?? null : null);
  return {
    at: now,
    doc,
    playing: s.isPlaying,
    time: round3(time),
    duration: round3(s.duration),
    loop: s.loop,
    following: showTimeline.isChasing(),
    tempo: bb ? { bpm: Math.round(bb.bpm * 100) / 100, bar: bb.bar, beat: bb.beat, beatsPerBar: bb.beatsPerBar } : null,
    section: sectionInfo(here),
    nextSection: sectionInfo(next),
    go: sectionsTakeGo
      ? {
          label: goLabel(sections, status, time, s.isPlaying),
          status: sectionStatusText(sections, status, time, s.isPlaying),
          holding: status.holdId !== null,
          armed: !!here && status.armed.includes(here.id),
          target: 'sections',
        }
      : {
          label: standby ? `Cue ${standby.number}${standby.name ? ` ${standby.name}` : ''}` : 'Nothing waits',
          status: '',
          holding: false,
          armed: false,
          target: 'cues',
        },
    takeover: {
      active: summary.active,
      rows: summary.surfaces.map((x) => ({ trackId: x.trackId ?? null, label: x.label, phase: x.phase })),
      overlay: summary.overlay ? summary.overlay.level : null,
    },
    phrase: {
      playing: phrase.activeId ? { id: phrase.activeId, name: nameOf(phrase.activeId) ?? '' } : null,
      waiting: phrase.pending ? { id: phrase.pending.id, name: nameOf(phrase.pending.id) } : null,
    },
    blackout: !!get(settings).output?.blackout,
    install: { running: installModeRunning(), ...health },
  };
}

/** Same state, `at` aside (cheap enough at 10 a second: a few hundred bytes). */
function signature(state: ShowState): string {
  return JSON.stringify({ ...state, at: 0 });
}

interface StatusReply {
  uptimeMs?: number;
  core?: { frames: number | null; at: number } | null;
  restarts?: { coreKills: number; reloads: number; relaunches: number };
  recent?: Array<{ at: number; kind: string; message: string }>;
}

/** Install mode's health from the main process's status (pure). */
export function installHealthFrom(reply: StatusReply | null, prevCore: { frames: number; at: number } | null, outputFps: number | null): { health: InstallHealth; core: { frames: number; at: number } | null } {
  if (!reply) return { health: { ...NO_HEALTH, fps: outputFps }, core: prevCore };
  const frames = reply.core?.frames;
  const core = typeof frames === 'number' && Number.isFinite(frames) && reply.core ? { frames, at: reply.core.at } : null;
  let fps: number | null = outputFps;
  if (core && prevCore && core.at > prevCore.at && core.frames >= prevCore.frames) {
    fps = Math.round(((core.frames - prevCore.frames) / ((core.at - prevCore.at) / 1000)) * 10) / 10;
  }
  const last = [...(reply.recent ?? [])].reverse().find((e) => ERROR_KINDS.has(e.kind)) ?? null;
  const r = reply.restarts;
  return {
    health: {
      uptime: typeof reply.uptimeMs === 'number' ? Math.round(reply.uptimeMs / 1000) : null,
      fps,
      restarts: r ? r.coreKills + r.reloads + r.relaunches : null,
      lastError: last ? { at: last.at, kind: last.kind, message: last.message } : null,
    },
    core: core ?? prevCore,
  };
}

/** Test seams: the clock and the main process's install status. */
let wallNow: () => number = () => Date.now();
let readInstallStatus: () => Promise<StatusReply | null> = async () => (isDesktopApp ? ((await invoke('install_status').catch(() => null)) as StatusReply | null) : null);
export function _setShowStateSources(opts: { now?: () => number; installStatus?: () => Promise<StatusReply | null> } | null): void {
  wallNow = opts?.now ?? (() => Date.now());
  readInstallStatus = opts?.installStatus ?? (async () => (isDesktopApp ? ((await invoke('install_status').catch(() => null)) as StatusReply | null) : null));
}

/** Never seen by a subscriber: the first subscribe works the state out at once. */
const NOT_STARTED: ShowState = {
  at: 0, doc: 'show', playing: false, time: 0, duration: 0, loop: false, following: false, tempo: null, section: null, nextSection: null,
  go: { label: '', status: '', holding: false, armed: false, target: 'cues' },
  takeover: { active: false, rows: [], overlay: null },
  phrase: { playing: null, waiting: null },
  blackout: false,
  install: { running: false, ...NO_HEALTH },
};

/** The show, read-only (see the file comment). */
export const showState: Readable<ShowState> = readable<ShowState>(NOT_STARTED, (set) => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastAt = -Infinity;
  let lastKey = '';
  let health: InstallHealth = NO_HEALTH;
  let core: { frames: number; at: number } | null = null;
  let stopped = false;
  // Subscribing below calls `changed` at once for each store: the first
  // sample is taken right after instead.
  let starting = true;

  const publish = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (stopped) return;
    lastAt = wallNow();
    let next: ShowState;
    try {
      next = sampleShowState(health, lastAt);
    } catch (err) {
      console.warn('[ShowState] could not read the show:', err);
      return;
    }
    const key = signature(next);
    if (key === lastKey) return;
    lastKey = key;
    set(next);
  };
  // Every store change only marks it; the next sample is at most 10 a second.
  const changed = () => {
    if (timer !== null || stopped || starting) return;
    timer = setTimeout(publish, Math.max(0, lastAt + SHOW_STATE_INTERVAL_MS - wallNow()));
  };

  const offs = [
    showTimeline.subscribe(changed),
    showSectionStatus.subscribe(changed),
    showPhraseStatus.subscribe(changed),
    liveTakeover.subscribe(changed),
    cueList.subscribe(changed),
    settings.subscribe(changed),
    installPaused.subscribe(changed),
  ];

  // Install mode's health, only while it runs.
  let pollBusy = false;
  const poll = async () => {
    if (pollBusy || stopped) return;
    if (!installModeRunning()) {
      if (health !== NO_HEALTH) { health = NO_HEALTH; core = null; changed(); }
      return;
    }
    pollBusy = true;
    try {
      const reply = await readInstallStatus();
      if (stopped) return;
      const r = installHealthFrom(reply, core, get(nativeRendererRuntime).outputFps ?? null);
      health = r.health;
      core = r.core;
      changed();
    } finally {
      pollBusy = false;
    }
  };
  starting = false;
  // Install mode starts with the launch: without it there is nothing to ask.
  const pollTimer = installModeRunning() ? setInterval(() => { void poll(); }, SHOW_STATE_INSTALL_POLL_MS) : null;
  void poll();

  publish();
  return () => {
    stopped = true;
    for (const off of offs) off();
    if (timer !== null) clearTimeout(timer);
    if (pollTimer) clearInterval(pollTimer);
  };
});
