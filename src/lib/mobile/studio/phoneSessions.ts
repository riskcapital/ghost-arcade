import type { InteractiveScene, Interaction } from './interactive';

/**
 * Desktop side of paired-phone Interactive sessions.
 *
 * Each phone owns one session, keyed by the id the pairing server stamps on
 * its messages, so two phones never share a timer or stop each other.
 *
 * Two timeouts, because "the phone went quiet" means two different things:
 *
 *  - PHONE_INPUT_RELEASE_MS (2.5 s): a phone that is live resends at least
 *    once a second. Two missed beats plus jitter means no finger is being
 *    tracked any more, so the touch is released. The scene keeps playing.
 *
 *  - PHONE_SESSION_GRACE_MS (60 s): only after a minute of silence is the
 *    phone treated as gone and its scene taken off the output. That rides out
 *    a Wi-Fi roam or reconnect (2 to 10 s), an app switch, and a short screen
 *    lock (a locked phone stops its timers at once and drops the socket about
 *    30 s later), yet a phone that really left (app closed, battery, out of
 *    range) does not leave a scene on the output that no remote can stop.
 *    Only the phone's own layer is ever hidden.
 */
export const PHONE_INPUT_RELEASE_MS = 2500;
export const PHONE_SESSION_GRACE_MS = 60000;
/** Largest `studio_scene` message the desktop accepts, in JSON characters. */
export const PHONE_SCENE_MAX_BYTES = 150000;
/** A phone editing at 20 Hz is told about a rejected scene at most this often. */
export const PHONE_REJECT_NOTICE_MS = 1000;
/** Marker id for phones talking through a relay that does not stamp senders. */
export const PHONE_UNKNOWN_SENDER = 'phone';

export type PhoneSceneState = { scene: InteractiveScene; inputs: Interaction[]; paused: boolean };

export interface PhoneSessionHost {
  /** Write the phone's scene to its dedicated layer or clip. `starting` is
   *  true when the phone goes live or comes back after being stopped. */
  apply(phone: string, state: PhoneSceneState, starting: boolean): void;
  /** Drop the phone's touches from its target; the scene keeps playing. */
  releaseInputs(phone: string): void;
  /** Take the phone's scene off the output. */
  stop(phone: string, reason: 'stopped' | 'expired'): void;
}

type Timer = ReturnType<typeof setTimeout>;
type Session = {
  active: boolean;
  signature: string;
  hasInputs: boolean;
  inputTimer?: Timer;
  graceTimer?: Timer;
  lastReject: number;
};

/** A stable, bounded id for one phone. */
export function phoneSenderId(raw: unknown): string {
  return typeof raw === 'string' && /^[\w.:-]{1,80}$/.test(raw) ? raw : PHONE_UNKNOWN_SENDER;
}

/** Keep up to eight well-formed touches; drop everything else on them. */
export function sanitizePhoneInputs(raw: unknown): Interaction[] {
  if (!Array.isArray(raw)) return [];
  const inputs: Interaction[] = [];
  for (const entry of raw.slice(0, 8)) {
    const point = entry?.point;
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(entry?.strength)) continue;
    inputs.push({
      id: String(entry.id ?? `touch-${inputs.length}`).slice(0, 40),
      point: { x: Math.max(0, Math.min(1, point.x)), y: Math.max(0, Math.min(1, point.y)) },
      strength: Math.max(0, Math.min(1, entry.strength)),
      mode: entry.mode === 'repel' || entry.mode === 'vortex' ? entry.mode : 'attract',
    });
  }
  return inputs;
}

export class PhoneSessions {
  private sessions = new Map<string, Session>();
  constructor(
    private host: PhoneSessionHost,
    private now: () => number = () => Date.now(),
  ) {}

  private session(phone: string): Session {
    let session = this.sessions.get(phone);
    if (!session) {
      session = { active: false, signature: '', hasInputs: false, lastReject: -Infinity };
      this.sessions.set(phone, session);
    }
    return session;
  }

  private clearTimers(session: Session) {
    clearTimeout(session.inputTimer);
    clearTimeout(session.graceTimer);
    session.inputTimer = session.graceTimer = undefined;
  }

  private arm(phone: string, session: Session) {
    this.clearTimers(session);
    session.inputTimer = setTimeout(() => {
      session.inputTimer = undefined;
      if (!session.active || !session.hasInputs) return;
      session.hasInputs = false;
      // Forget the held-touch signature so the same touch is applied again
      // if the phone resumes mid-gesture.
      session.signature = '';
      this.host.releaseInputs(phone);
    }, PHONE_INPUT_RELEASE_MS);
    session.graceTimer = setTimeout(() => {
      session.graceTimer = undefined;
      if (!session.active) return;
      this.end(phone, session, 'expired');
    }, PHONE_SESSION_GRACE_MS);
  }

  private end(phone: string, session: Session, reason: 'stopped' | 'expired') {
    this.clearTimers(session);
    session.active = false;
    session.hasInputs = false;
    session.signature = '';
    this.host.stop(phone, reason);
  }

  /** A validated `studio_scene` message from one phone. */
  receive(phone: string, state: PhoneSceneState, active: boolean) {
    const session = this.session(phone);
    if (!active) {
      if (session.active) this.end(phone, session, 'stopped');
      return;
    }
    this.arm(phone, session);
    const signature = JSON.stringify(state);
    if (session.active && signature === session.signature) return;
    const starting = !session.active;
    session.active = true;
    session.signature = signature;
    session.hasInputs = state.inputs.length > 0;
    this.host.apply(phone, state, starting);
  }

  /** The phone is alive but sent something unusable: keep its scene up. */
  keepAlive(phone: string) {
    const session = this.sessions.get(phone);
    if (session?.active) this.arm(phone, session);
  }

  /** True when the phone should be told now that its scene was rejected. */
  shouldNotifyRejection(phone: string): boolean {
    const session = this.session(phone);
    const now = this.now();
    if (now - session.lastReject < PHONE_REJECT_NOTICE_MS) return false;
    session.lastReject = now;
    return true;
  }

  isActive(phone: string): boolean {
    return this.sessions.get(phone)?.active === true;
  }

  /** Stop tracking a phone without touching its layer (the desktop took it over). */
  forget(phone: string) {
    const session = this.sessions.get(phone);
    if (!session) return;
    this.clearTimers(session);
    this.sessions.delete(phone);
  }

  dispose() {
    for (const session of this.sessions.values()) this.clearTimers(session);
    this.sessions.clear();
  }
}
