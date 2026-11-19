/*
 * The desktop end of phone camera / depth feeds: one WebRTC session per feed
 * a phone sends, its frames into the render core (phoneFeedPump), its state
 * (phoneFeeds), and what the phone and the Media Library are told.
 *
 * Every way a session ends goes through `finish`: the phone stopped, its
 * socket closed, the connection failed or went quiet, another session took
 * its feed, the desktop stopped it, or the app closes. Each closes the peer,
 * stops the track and the pump, and, when no other session sends that feed,
 * blanks the feed in the core and takes it out of the Media Library, so no
 * deck cell keeps showing a frozen picture of a phone that has gone.
 */
import {
  PHONE_FEED_LABELS,
  phoneFeedActive,
  phoneFeedCoreSourceId,
  phoneFeedInUse,
  phoneFeedKeyFromOffer,
  phoneFeedMediaId,
  phoneFeedUri,
  publishPhoneFeed,
  sessionsReplacedByOffer,
  setPhoneFeedAspect,
  stepPhoneFeed,
  type PhoneFeedEndReason,
  type PhoneFeedEvent,
  type PhoneFeedKey,
  type PhoneFeedState,
} from './phoneFeeds';
import {
  phoneFeedBlankCommand,
  PhoneFeedPump,
  type PhoneFeedPumpStats,
  type PumpFrame,
  type PumpFrameSource,
  type PumpScaler,
  type PumpSink,
} from './phoneFeedPump';

export type PhoneFeedMediaItem = {
  id: string;
  name: string;
  src: string;
  type: 'video';
  thumbnail?: string;
  videoWidth?: number;
  videoHeight?: number;
};

export type PhoneFeedReceiverDeps = {
  /** Signalling and status to the phone, over the pairing socket. */
  send(payload: Record<string, unknown>): void;
  createPeer(): RTCPeerConnection;
  sink: PumpSink;
  maxEdge(): number;
  frameSource(track: MediaStreamTrack): PumpFrameSource;
  scale?: PumpScaler;
  thumbnail?(frame: PumpFrame): Promise<string>;
  media: { put(item: PhoneFeedMediaItem): void; remove(id: string): void };
  /** The phone's Phone Vision commands ride a data channel on the same peer. */
  onDataChannel?(sessionId: string, channel: RTCDataChannel): void;
  /** A session changed state (for the Phone Vision panel). */
  onChange?(session: PhoneFeedSessionView): void;
  now?(): number;
  setInterval?(fn: () => void, ms: number): unknown;
  clearInterval?(handle: unknown): void;
};

export type PhoneFeedSessionView = {
  sessionId: string;
  key: PhoneFeedKey;
  label: string;
  state: PhoneFeedState;
};

type Session = PhoneFeedSessionView & {
  openedAt: number;
  peer: RTCPeerConnection | null;
  pendingIce: RTCIceCandidateInit[];
  pump: PhoneFeedPump | null;
  track: MediaStreamTrack | null;
  width: number;
  height: number;
  thumbnail: string;
  /** Set once the core showed a frame; first-frame time from the offer. */
  firstFrameMs: number | null;
};

/** ICE candidates held for a session whose offer has not been applied yet. */
const MAX_PENDING_ICE = 128;
/** Sessions that ended, kept for their stats (`window.__gaPhoneFeeds`). */
const MAX_ENDED_KEPT = 4;

export class PhoneFeedReceiver {
  private sessions = new Map<string, Session>();
  private endedStats: { sessionId: string; key: PhoneFeedKey; stats: PhoneFeedPumpStats | null; firstFrameMs: number | null; state: PhoneFeedState }[] = [];
  private timer: unknown = null;
  private readonly now: () => number;

  constructor(private readonly deps: PhoneFeedReceiverDeps) {
    this.now = deps.now ?? (() => performance.now());
  }

  /** Open sessions (not ended). */
  activeSessions(): PhoneFeedSessionView[] {
    return [...this.sessions.values()].filter((s) => phoneFeedActive(s.state.phase)).map(view);
  }

  session(sessionId: string): PhoneFeedSessionView | null {
    const s = this.sessions.get(sessionId);
    return s ? view(s) : null;
  }

  /** The newest session that has a picture on the desktop. */
  newestLive(): PhoneFeedSessionView | null {
    let best: Session | null = null;
    for (const s of this.sessions.values()) {
      if (s.state.phase === 'live' && (!best || s.openedAt > best.openedAt)) best = s;
    }
    return best ? view(best) : null;
  }

  /** Pacing and latency of every session, newest last (debug and tests). */
  stats() {
    return [
      ...this.endedStats,
      ...[...this.sessions.values()].map((s) => ({ sessionId: s.sessionId, key: s.key, stats: s.pump?.stats() ?? null, firstFrameMs: s.firstFrameMs, state: s.state })),
    ];
  }

  async offer(sessionId: string, sdp: RTCSessionDescriptionInit, detail: Record<string, unknown> = {}): Promise<void> {
    const parsed = phoneFeedKeyFromOffer(detail);
    if ('error' in parsed) {
      this.deps.send({ type: 'phone_vision_status', sessionId, status: 'failed', error: parsed.error });
      return;
    }
    const key = parsed.key;
    const now = this.now();
    // The phone re-offering the same session id starts it over (quietly: the new one takes its place).
    if (this.sessions.has(sessionId)) this.finish(sessionId, 'replaced', undefined, false, true);
    const open = [...this.sessions.values()].map((s) => ({ sessionId: s.sessionId, key: s.key, openedAt: s.openedAt, state: s.state }));
    for (const old of sessionsReplacedByOffer(open, { sessionId, key })) {
      const oldKey = this.sessions.get(old)?.key;
      this.finish(old, 'replaced', oldKey === key ? `${PHONE_FEED_LABELS[key]} is coming from another session now.` : 'The desktop has too many phone feeds open.', true);
    }
    const session: Session = {
      sessionId,
      key,
      label: PHONE_FEED_LABELS[key],
      state: { phase: 'offered', at: now },
      openedAt: now,
      peer: null,
      pendingIce: [],
      pump: null,
      track: null,
      width: 0,
      height: 0,
      thumbnail: '',
      firstFrameMs: null,
    };
    this.sessions.set(sessionId, session);
    this.publish(session);
    this.ensureTimer();

    let peer: RTCPeerConnection;
    try {
      peer = this.deps.createPeer();
    } catch (err) {
      this.finish(sessionId, 'failed', errorText(err, 'Could not open the phone camera connection.'), true);
      return;
    }
    session.peer = peer;
    peer.onicecandidate = (event) => {
      if (!event.candidate || this.sessions.get(sessionId) !== session) return;
      const candidate = typeof event.candidate.toJSON === 'function' ? event.candidate.toJSON() : event.candidate;
      this.deps.send({ type: 'phone_camera_ice', sessionId, candidate });
    };
    peer.ondatachannel = (event) => {
      if (this.sessions.get(sessionId) === session) this.deps.onDataChannel?.(sessionId, event.channel);
    };
    peer.ontrack = (event) => {
      if (this.sessions.get(sessionId) !== session || event.track.kind !== 'video') return;
      this.attachTrack(session, event.track);
    };
    peer.onconnectionstatechange = () => {
      if (this.sessions.get(sessionId) !== session) return;
      this.step(session, { type: 'peer', state: peer.connectionState, now: this.now() });
    };

    try {
      await peer.setRemoteDescription(sdp);
      if (this.sessions.get(sessionId) !== session) return;
      for (const candidate of session.pendingIce.splice(0)) {
        try { await peer.addIceCandidate(candidate); } catch { /* a stale candidate */ }
      }
      const answer = await peer.createAnswer();
      if (this.sessions.get(sessionId) !== session) return;
      await peer.setLocalDescription(answer);
      if (this.sessions.get(sessionId) !== session) return;
      this.deps.send({ type: 'phone_camera_answer', sessionId, sdp: peer.localDescription });
      this.step(session, { type: 'answered', now: this.now() });
      this.deps.send({ type: 'phone_vision_status', sessionId, status: 'connecting', sourceReady: false, label: session.label });
    } catch (err) {
      if (this.sessions.get(sessionId) === session) this.finish(sessionId, 'failed', errorText(err, 'Failed to start the phone camera.'), true);
    }
  }

  async ice(sessionId: string, candidate: RTCIceCandidateInit): Promise<void> {
    if (!candidate) return;
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (!phoneFeedActive(session.state.phase)) return;
    const peer = session.peer;
    if (!peer || !peer.remoteDescription) {
      if (session.pendingIce.length < MAX_PENDING_ICE) session.pendingIce.push(candidate);
      return;
    }
    try { await peer.addIceCandidate(candidate); } catch { /* rejected candidate */ }
  }

  /** The phone stopped sending (`phone_camera_stop`), or its socket went away. */
  phoneStopped(sessionId: string, reason: 'stopped' | 'disconnected' = 'stopped'): void {
    this.finish(sessionId, reason, undefined, false);
  }

  /** The desktop stops a feed (Sources → stop); the phone is told. */
  stopFromDesktop(key: PhoneFeedKey): void {
    for (const s of [...this.sessions.values()]) {
      if (s.key === key && phoneFeedActive(s.state.phase)) this.finish(s.sessionId, 'stopped', 'Stopped on the desktop.', true);
    }
  }

  /** Everything off (app closing, pairing server gone). */
  stopAll(reason: PhoneFeedEndReason = 'disconnected'): void {
    for (const id of [...this.sessions.keys()]) this.finish(id, reason, undefined, false);
  }

  private attachTrack(session: Session, track: MediaStreamTrack): void {
    if (session.pump) return;
    session.track = track;
    const key = session.key;
    const sourceId = phoneFeedCoreSourceId(key);
    const pump = new PhoneFeedPump({
      sourceId,
      frames: this.deps.frameSource(track),
      sink: this.deps.sink,
      maxEdge: this.deps.maxEdge,
      scale: this.deps.scale,
      now: this.now,
      wanted: () => phoneFeedInUse(key),
      onFrame: (now, width, height) => {
        if (width !== session.width || height !== session.height) {
          session.width = width;
          session.height = height;
          setPhoneFeedAspect(key, width, height);
          if (this.sessions.get(session.sessionId) === session) this.publish(session);
        }
        if (session.state.phase === 'stalled') this.step(session, { type: 'frame', now });
      },
      onFirstFrame: (frame) => {
        const still = this.deps.thumbnail?.(frame);
        if (!still) return;
        return still.then((thumbnail) => {
          if (!thumbnail || this.sessions.get(session.sessionId) !== session) return;
          session.thumbnail = thumbnail;
          this.publish(session);
          if (session.state.phase === 'live' || session.state.phase === 'stalled') this.putMedia(session);
        });
      },
      onShown: (now) => {
        if (this.sessions.get(session.sessionId) !== session) return;
        session.firstFrameMs = Math.round(now - session.openedAt);
        this.step(session, { type: 'shown', now });
      },
    });
    session.pump = pump;
    void pump.done.then(() => {
      // The track ended under a session that is still open: the phone stopped it.
      if (this.sessions.get(session.sessionId) === session && phoneFeedActive(session.state.phase) && session.pump === pump) {
        this.finish(session.sessionId, 'stopped', undefined, false);
      }
    });
  }

  private step(session: Session, event: PhoneFeedEvent): void {
    const previous = session.state;
    const next = stepPhoneFeed(previous, event);
    if (next === previous) return;
    if (next.phase === 'ended') {
      this.finish(session.sessionId, next.reason, next.message, next.reason !== 'stopped');
      return;
    }
    session.state = next;
    if (next.phase === 'live') {
      this.putMedia(session);
      this.deps.send({
        type: 'phone_vision_status',
        sessionId: session.sessionId,
        status: 'live',
        sourceReady: true,
        // The desktop's render core has a frame of this feed.
        rendered: true,
        label: session.label,
        ...(previous.phase === 'stalled' ? { resumed: true } : { firstFrameMs: session.firstFrameMs }),
      });
    } else if (next.phase === 'stalled') {
      this.deps.send({ type: 'phone_vision_status', sessionId: session.sessionId, status: 'stalled', sourceReady: false, label: session.label });
    }
    this.publish(session);
  }

  private finish(sessionId: string, reason: PhoneFeedEndReason, message: string | undefined, notifyPhone: boolean, quiet = false): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.delete(sessionId);
    const wasActive = phoneFeedActive(session.state.phase);
    session.state = stepPhoneFeed(session.state, { type: 'end', reason, message, now: this.now() });
    session.pump?.stop();
    try { session.track?.stop(); } catch { /* gone */ }
    const peer = session.peer;
    session.peer = null;
    if (peer) {
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.ondatachannel = null;
      peer.onconnectionstatechange = null;
      try { peer.close(); } catch { /* closed */ }
    }
    session.pendingIce = [];
    this.endedStats.push({ sessionId, key: session.key, stats: session.pump?.stats() ?? null, firstFrameMs: session.firstFrameMs, state: session.state });
    while (this.endedStats.length > MAX_ENDED_KEPT) this.endedStats.shift();
    session.pump = null;
    session.track = null;
    if (wasActive && notifyPhone && session.state.phase === 'ended') {
      this.deps.send({ type: 'phone_vision_status', sessionId, status: 'failed', sourceReady: false, error: session.state.message, reason });
    }
    // Another session already sends this feed: leave its picture alone.
    const feedLivesOn = [...this.sessions.values()].some((s) => s.key === session.key && phoneFeedActive(s.state.phase));
    if (!feedLivesOn) {
      this.blankCoreFeed(session.key);
      this.deps.media.remove(phoneFeedMediaId(session.key));
      if (!quiet) this.publish(session);
    } else if (!quiet) {
      this.deps.onChange?.(view(session));
    }
    if (![...this.sessions.values()].some((s) => phoneFeedActive(s.state.phase))) this.stopTimer();
  }

  /** The feed's slot in the core goes see-through, so no layer holds a frozen frame. */
  private blankCoreFeed(key: PhoneFeedKey): void {
    void this.deps.sink.upload(phoneFeedBlankCommand(phoneFeedCoreSourceId(key))).catch(() => {});
  }

  private putMedia(session: Session): void {
    this.deps.media.put({
      id: phoneFeedMediaId(session.key),
      name: session.label,
      src: phoneFeedUri(session.key),
      type: 'video',
      ...(session.thumbnail ? { thumbnail: session.thumbnail } : {}),
      ...(session.width > 0 && session.height > 0 ? { videoWidth: session.width, videoHeight: session.height } : {}),
    });
  }

  private publish(session: Session): void {
    publishPhoneFeed({
      key: session.key,
      label: session.label,
      sessionId: session.sessionId,
      phase: session.state.phase,
      message: session.state.phase === 'ended' ? session.state.message : '',
      width: session.width,
      height: session.height,
      thumbnail: session.thumbnail,
    });
    this.deps.onChange?.(view(session));
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    const set = this.deps.setInterval ?? ((fn: () => void, ms: number) => setInterval(fn, ms));
    this.timer = set(() => this.tick(), 1000);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    const clear = this.deps.clearInterval ?? ((handle: unknown) => clearInterval(handle as ReturnType<typeof setInterval>));
    clear(this.timer);
    this.timer = null;
  }

  /** Once a second while a session is open: stalls and timeouts. */
  tick(): void {
    const now = this.now();
    for (const session of [...this.sessions.values()]) {
      this.step(session, { type: 'tick', now, lastFrameAt: session.pump?.lastFrameAt ?? 0 });
    }
  }
}

function view(session: Session): PhoneFeedSessionView {
  return { sessionId: session.sessionId, key: session.key, label: session.label, state: session.state };
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
