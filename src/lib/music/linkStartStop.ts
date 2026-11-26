/**
 * Audio Lab's Start/Stop Sync with an Ableton Link session.
 *
 * On: the session starting (Live's Play) starts the studio on the bar it
 * started on, bringing back what Stop stopped and the looper takes armed
 * while it was stopped; the session stopping stops what plays. The studio's
 * own Play and Stop start and stop the session, Play on the next bar so the
 * other apps start there with it.
 *
 * Off: Play and Stop are the studio's alone, exactly as before.
 */

import { get } from 'svelte/store';
import { abletonLink, type LinkTransportChange } from '../sync/abletonLink';
import { launchClockFollowsLink, launchClockPosition } from '../stores/launchClock';
import { musicStudio } from './musicStudioStore';
import { playAll, stopAll, studioTransportPlaying } from './musicRuntime';
import { setLoopSessionHold } from './loopStation';
import { punchAt } from './loopTrack';

/** Bars of the session, in beats (Link's quantum as the studio reads it). */
export const LINK_START_QUANTUM = 4;

/**
 * The bar the studio starts on for a session start at `beat`: that bar line,
 * or the next one when the session started between bars (a peer that starts
 * at once and comes in on its next downbeat).
 */
export function sessionStartBeat(beat: number, quantum = LINK_START_QUANTUM): number {
  // Within a thousandth of a bar counts as on it (a rounding hair either side).
  return Math.ceil(beat / quantum - 1e-3) * quantum + 0;
}

export interface StartStopDeps {
  /** Start/Stop Sync is switched on and Link is on. */
  enabled(): boolean;
  /** The launch clock follows the session (Link with peers): its beats are the session's. */
  following(): boolean;
  /** Ableton Live drives the studio through its control script: its transport is already the studio's. */
  liveControl(): boolean;
  /** The session is playing now. */
  sessionPlaying(): boolean;
  beatNow(): number;
  /** Anything of the studio's playing. */
  playing(): boolean;
  play(opts: { atBeat?: number; resumeOnly?: boolean }): void;
  stop(): void;
  /** Looper takes armed on the bar wait for the session (true), or start (false) from `startBeat`. */
  hold(on: boolean, startBeat?: number): void;
  /** Start or stop the session; a start with `beat` begins on that bar. */
  setSessionPlaying(playing: boolean, beat?: number): void;
  /** performance.now(). */
  nowMs(): number;
}

/** How long a start or stop we sent counts as the session's state before it is read back. */
const SENT_STATE_MS = 1000;

export interface LinkStartStop {
  /** The session's transport changed (a push or a poll). */
  sessionChanged(change: Pick<LinkTransportChange, 'playing' | 'beat'>): void;
  /** The studio's Play button. */
  play(): void;
  /** The studio's Stop button. */
  stop(): void;
  /** Settings, peers or the session changed: hold armed takes only while they should wait. */
  refresh(): void;
}

export function createLinkStartStop(deps: StartStopDeps): LinkStartStop {
  let held = false;
  // What we last told the session, until it reads back (or a moment passes).
  let sent: { playing: boolean; until: number } | null = null;
  const sessionPlaying = () => {
    const read = deps.sessionPlaying();
    if (sent && (read === sent.playing || deps.nowMs() > sent.until)) sent = null;
    return sent ? sent.playing : read;
  };
  const tell = (playing: boolean, beat?: number) => {
    sent = { playing, until: deps.nowMs() + SENT_STATE_MS };
    deps.setSessionPlaying(playing, beat);
  };
  const active = () => deps.enabled() && !deps.liveControl();
  const setHold = (on: boolean, startBeat?: number) => {
    if (on === held && startBeat === undefined) return;
    held = on;
    deps.hold(on, startBeat);
  };

  return {
    sessionChanged(change) {
      sent = null;
      if (!active()) return;
      if (change.playing) {
        // Its beat is the session's only while the launch clock follows the session.
        const at = deps.following() && change.beat !== null && Number.isFinite(change.beat) ? sessionStartBeat(change.beat) : undefined;
        if (held) setHold(false, at);
        // Our own start coming back, or the studio already playing on the session's beats.
        if (deps.playing()) return;
        deps.play({ atBeat: at, resumeOnly: true });
        return;
      }
      if (deps.playing()) deps.stop();
      if (deps.following()) setHold(true);
    },

    play() {
      if (!active()) {
        deps.play({});
        return;
      }
      if (deps.following()) {
        // The next bar, for the studio and the session alike.
        const at = punchAt(deps.beatNow());
        if (held) setHold(false, at);
        deps.play({ atBeat: at });
        tell(true, at);
        return;
      }
      if (held) setHold(false);
      deps.play({});
      tell(true);
    },

    stop() {
      deps.stop();
      if (!active()) return;
      tell(false);
      if (deps.following()) setHold(true);
    },

    refresh() {
      setHold(active() && deps.following() && !sessionPlaying());
    },
  };
}

// ── The app's instance ──────────────────────────────────────────────────

let instance: LinkStartStop | null = null;

function linkStartStop(): LinkStartStop {
  if (instance) return instance;
  const created = createLinkStartStop({
    enabled: () => {
      const link = get(abletonLink);
      return link.enabled && link.startStopSync;
    },
    following: () => launchClockFollowsLink(),
    liveControl: () => get(musicStudio).liveControl,
    sessionPlaying: () => get(abletonLink).playing,
    beatNow: () => launchClockPosition().beat,
    playing: () => studioTransportPlaying(),
    play: (opts) => playAll(opts),
    stop: () => stopAll(),
    hold: (on, startBeat) => setLoopSessionHold(on, startBeat),
    setSessionPlaying: (playing, beat) => { void abletonLink.setPlaying(playing, beat); },
    nowMs: () => performance.now(),
  });
  instance = created;
  abletonLink.onTransport((change) => created.sessionChanged(change));
  // Subscribing calls refresh once now: nothing waits unless it should.
  abletonLink.subscribe(() => created.refresh());
  musicStudio.subscribe(() => created.refresh());
  return created;
}

/** Hear the session's starts and stops. Call once the studio is up (any number of times). */
export function installLinkStartStop(): void {
  linkStartStop();
}

/** The studio's Play: as playAll(), and with Start/Stop Sync it starts the session too. */
export function studioPlay(): void {
  linkStartStop().play();
}

/** The studio's Stop: as stopAll(), and with Start/Stop Sync it stops the session too. */
export function studioStop(): void {
  linkStartStop().stop();
}
