/*
 * Camera and depth feeds a paired phone sends to the desktop over WebRTC.
 *
 * Each feed the phone can send (rear, selfie, Dual Camera, depth map, depth
 * contours, point cloud, Interactive Studio) is its own named source. A deck
 * cell or layer names the feed, not the WebRTC session behind it
 * (`live://phone-camera/dual`), so it picks the picture up again when the
 * phone sends that feed again, and shows "Phone camera disconnected" until
 * then.
 *
 * A session moves through explicit states, and only these:
 *
 *   offered ─answered─▶ connecting ─frame shown─▶ live ◀─frame─▶ stalled
 *      │                    │                      │               │
 *      └────────────────────┴──── stop / fail / replace ───────────┴──▶ ended
 *
 * "live" means the render core has a frame of this feed, not that a track
 * arrived: the phone is told the feed is live on the desktop only then.
 *
 * The store changes on these transitions only, never per frame.
 */
import { writable, type Readable } from 'svelte/store';

export const PHONE_FEED_URI_PREFIX = 'live://phone-camera/';

export type PhoneFeedKey = 'rear' | 'front' | 'dual' | 'depth' | 'contours' | 'points' | 'interactive' | 'camera';

export const PHONE_FEED_LABELS: Readonly<Record<PhoneFeedKey, string>> = {
  rear: 'Mobile Rear Camera',
  front: 'Mobile Selfie',
  dual: 'Mobile Dual Camera',
  depth: 'Mobile Depth Map',
  contours: 'Mobile Depth Contours',
  points: 'Mobile Point Cloud',
  interactive: 'Mobile Interactive Studio',
  // A phone that sends its camera without naming a Studio feed (Phone Vision).
  camera: 'Phone Camera',
};

export const PHONE_FEED_KEYS = Object.keys(PHONE_FEED_LABELS) as PhoneFeedKey[];

/** What a cell or layer shows while its feed is not on the desktop. */
export const PHONE_FEED_DISCONNECTED_TEXT = 'Phone camera disconnected';

export function isPhoneFeedKey(value: unknown): value is PhoneFeedKey {
  return typeof value === 'string' && Object.hasOwn(PHONE_FEED_LABELS, value);
}

export function phoneFeedUri(key: PhoneFeedKey): string {
  return `${PHONE_FEED_URI_PREFIX}${key}`;
}

export function isPhoneFeedUri(uri: unknown): uri is string {
  return typeof uri === 'string' && uri.startsWith(PHONE_FEED_URI_PREFIX);
}

/**
 * The feed a `live://phone-camera/…` URI names. Before 2.1.12 the URI carried
 * the WebRTC session id, which never comes back: those read as the plain
 * phone camera.
 */
export function phoneFeedKeyFromUri(uri: unknown): PhoneFeedKey | null {
  if (!isPhoneFeedUri(uri)) return null;
  const rest = uri.slice(PHONE_FEED_URI_PREFIX.length).split(/[/?#]/)[0];
  return isPhoneFeedKey(rest) ? rest : 'camera';
}

/** The render core's source id for a feed: every layer showing it shares one upload. */
export function phoneFeedCoreSourceId(key: PhoneFeedKey): string {
  return `phone-feed:${key}`;
}

/** The core URI a layer binds; nothing decodes it, frames arrive by upload. */
export function phoneFeedCoreUri(key: PhoneFeedKey): string {
  return `native-phone-feed://${key}`;
}

export function phoneFeedMediaId(key: PhoneFeedKey): string {
  return `phone-feed-${key}`;
}

/**
 * The feed a camera offer is for, from its `studioFeed` descriptor, or an
 * error for one this desktop does not take. An offer without a descriptor is
 * the plain phone camera.
 */
export function phoneFeedKeyFromOffer(detail: Record<string, unknown>): { key: PhoneFeedKey } | { error: string } {
  const feed = detail.studioFeed as Record<string, unknown> | undefined | null;
  if (feed === undefined || feed === null) return { key: 'camera' };
  if (typeof feed !== 'object' || feed.schema !== 'ghost-mobile-feed' || feed.version !== 1
    || feed.metricDepth !== false || feed.content !== 'visual-rgba'
    || !isPhoneFeedKey(feed.kind) || feed.kind === 'camera') {
    return { error: 'Unsupported Studio feed.' };
  }
  return { key: feed.kind };
}

// ── Session state ─────────────────────────────────────────────────────────

export type PhoneFeedEndReason = 'stopped' | 'disconnected' | 'replaced' | 'failed';

export type PhoneFeedState =
  | { phase: 'offered'; at: number }
  | { phase: 'connecting'; at: number }
  | { phase: 'live'; since: number }
  | { phase: 'stalled'; since: number }
  | { phase: 'ended'; at: number; reason: PhoneFeedEndReason; message: string };

export type PhoneFeedPhase = PhoneFeedState['phase'];

export type PhoneFeedEvent =
  /** The desktop answered the offer. */
  | { type: 'answered'; now: number }
  /** The render core has a frame of this feed. */
  | { type: 'shown'; now: number }
  /** A frame arrived from the phone (after the first one was shown). */
  | { type: 'frame'; now: number }
  /** Once a second: `lastFrameAt` is when the newest frame arrived (0 = none). */
  | { type: 'tick'; now: number; lastFrameAt: number }
  /** The WebRTC connection changed. */
  | { type: 'peer'; state: RTCPeerConnectionState | string; now: number }
  | { type: 'end'; reason: PhoneFeedEndReason; message?: string; now: number };

/** No frame for this long and a live feed is stalled. */
export const PHONE_FEED_STALL_MS = 2000;
/** A feed that has not shown a frame this long after the offer has failed (the phone gives up at 15 s). */
export const PHONE_FEED_CONNECT_TIMEOUT_MS = 14000;
/** A stalled feed whose connection is gone, or that sends nothing for this long, has ended. */
export const PHONE_FEED_STALL_END_MS = 30000;

const END_MESSAGES: Record<PhoneFeedEndReason, string> = {
  stopped: 'The phone stopped sending.',
  disconnected: 'The phone disconnected.',
  replaced: 'Another feed took its place.',
  failed: 'The phone camera connection failed.',
};

function ended(now: number, reason: PhoneFeedEndReason, message?: string): PhoneFeedState {
  return { phase: 'ended', at: now, reason, message: message || END_MESSAGES[reason] };
}

/**
 * The next state, or the same object when the event changes nothing. Ended
 * is final: a feed that comes back is a new session.
 */
export function stepPhoneFeed(state: PhoneFeedState, event: PhoneFeedEvent): PhoneFeedState {
  if (state.phase === 'ended') return state;
  if (event.type === 'end') return ended(event.now, event.reason, event.message);
  switch (state.phase) {
    case 'offered':
      if (event.type === 'answered') return { phase: 'connecting', at: event.now };
      if (event.type === 'shown') return { phase: 'live', since: event.now };
      if (event.type === 'peer' && (event.state === 'failed' || event.state === 'closed')) return ended(event.now, 'failed');
      if (event.type === 'tick' && event.now - state.at > PHONE_FEED_CONNECT_TIMEOUT_MS) {
        return ended(event.now, 'failed', 'The desktop did not get a picture from the phone.');
      }
      return state;
    case 'connecting':
      if (event.type === 'shown') return { phase: 'live', since: event.now };
      if (event.type === 'peer' && (event.state === 'failed' || event.state === 'closed')) return ended(event.now, 'failed');
      if (event.type === 'tick' && event.now - state.at > PHONE_FEED_CONNECT_TIMEOUT_MS) {
        return ended(event.now, 'failed', 'The desktop did not get a picture from the phone.');
      }
      return state;
    case 'live':
      if (event.type === 'tick' && event.now - event.lastFrameAt > PHONE_FEED_STALL_MS) return { phase: 'stalled', since: event.now };
      if (event.type === 'peer' && event.state === 'disconnected') return { phase: 'stalled', since: event.now };
      if (event.type === 'peer' && (event.state === 'failed' || event.state === 'closed')) return ended(event.now, 'disconnected');
      return state;
    case 'stalled':
      if (event.type === 'frame' || event.type === 'shown') return { phase: 'live', since: event.now };
      if (event.type === 'peer' && (event.state === 'failed' || event.state === 'closed')) return ended(event.now, 'disconnected');
      if (event.type === 'tick' && event.now - state.since > PHONE_FEED_STALL_END_MS) return ended(event.now, 'disconnected');
      return state;
  }
}

/** Whether a phase still has a WebRTC session behind it. */
export function phoneFeedActive(phase: PhoneFeedPhase): boolean {
  return phase !== 'ended';
}

// ── Sessions on this desktop ───────────────────────────────────────────────

/** Sessions open at once (phones × feeds). The oldest goes when another arrives. */
export const PHONE_FEED_MAX_SESSIONS = 4;

export type PhoneFeedSessionInfo = {
  sessionId: string;
  key: PhoneFeedKey;
  openedAt: number;
  state: PhoneFeedState;
};

/**
 * Which open sessions a new offer ends: the one sending the same feed (the
 * phone switched or restarted it, or another phone took it over), then the
 * oldest while over the cap. Pure: the caller ends them.
 */
export function sessionsReplacedByOffer(
  open: readonly PhoneFeedSessionInfo[],
  offer: { sessionId: string; key: PhoneFeedKey },
  max = PHONE_FEED_MAX_SESSIONS,
): string[] {
  const active = open.filter((s) => phoneFeedActive(s.state.phase) && s.sessionId !== offer.sessionId);
  const out = active.filter((s) => s.key === offer.key).map((s) => s.sessionId);
  const keep = active.filter((s) => !out.includes(s.sessionId)).sort((a, b) => a.openedAt - b.openedAt);
  while (keep.length + 1 > max) out.push(keep.shift()!.sessionId);
  return out;
}

// ── What the UI reads (one entry per feed, changed on transitions only) ───

export type PhoneFeedSummary = {
  key: PhoneFeedKey;
  label: string;
  sessionId: string;
  phase: PhoneFeedPhase;
  /** Why it ended, for an ended feed. */
  message: string;
  width: number;
  height: number;
  /** A small still of the first frame (data URL), for the tray and new cells. */
  thumbnail: string;
};

let summaries: ReadonlyMap<PhoneFeedKey, PhoneFeedSummary> = new Map();
const summaryStore = writable<ReadonlyMap<PhoneFeedKey, PhoneFeedSummary>>(summaries);

/** One entry per feed this desktop has seen this run (at most one per key, so bounded). */
export const phoneFeeds: Readable<ReadonlyMap<PhoneFeedKey, PhoneFeedSummary>> = { subscribe: summaryStore.subscribe };

export function phoneFeedSummaries(): ReadonlyMap<PhoneFeedKey, PhoneFeedSummary> {
  return summaries;
}

function sameSummary(a: PhoneFeedSummary | undefined, b: PhoneFeedSummary): boolean {
  return !!a && a.sessionId === b.sessionId && a.phase === b.phase && a.message === b.message
    && a.width === b.width && a.height === b.height && a.thumbnail === b.thumbnail && a.label === b.label;
}

/**
 * Record a feed's new summary. A session that is no longer the feed's
 * current one (it was replaced) does not overwrite the newer one.
 */
export function publishPhoneFeed(summary: PhoneFeedSummary): void {
  const current = summaries.get(summary.key);
  if (current && current.sessionId !== summary.sessionId && phoneFeedActive(current.phase) && !phoneFeedActive(summary.phase)) return;
  if (sameSummary(current, summary)) return;
  const next = new Map(summaries);
  next.set(summary.key, summary);
  summaries = next;
  summaryStore.set(next);
}

/** Tests and a full reset. */
export function resetPhoneFeeds(): void {
  summaries = new Map();
  summaryStore.set(summaries);
  inUse.clear();
  aspects.clear();
}

/** What a cell showing this feed says: nothing when its picture is on the desktop. */
export function phoneFeedCellNotice(feed: PhoneFeedSummary | undefined): string | null {
  if (!feed || feed.phase === 'ended') return PHONE_FEED_DISCONNECTED_TEXT;
  if (feed.phase === 'offered' || feed.phase === 'connecting') return 'Phone camera connecting…';
  if (feed.phase === 'stalled') return 'Phone camera paused';
  return null;
}

/** The tray's status for a listed feed. */
export function phoneFeedStatusLabel(phase: PhoneFeedPhase): { label: string; tone: 'live' | 'connecting' | 'error' } {
  if (phase === 'live') return { label: 'Live', tone: 'live' };
  if (phase === 'stalled') return { label: 'No frames', tone: 'error' };
  if (phase === 'ended') return { label: 'Disconnected', tone: 'error' };
  return { label: 'Connecting…', tone: 'connecting' };
}

/** Feeds to list as sources: those with a session (ended ones drop out). */
export function listedPhoneFeeds(map: ReadonlyMap<PhoneFeedKey, PhoneFeedSummary>): PhoneFeedSummary[] {
  return PHONE_FEED_KEYS.map((key) => map.get(key)).filter((f): f is PhoneFeedSummary => !!f && phoneFeedActive(f.phase));
}

/** A deck clip for a feed, placed like any other live source. */
export function phoneFeedClip(feed: Pick<PhoneFeedSummary, 'key' | 'label' | 'thumbnail' | 'width' | 'height'>, id: string) {
  return {
    id,
    type: 'video' as const,
    name: feed.label,
    src: phoneFeedUri(feed.key),
    playbackMode: 'loop' as const,
    isPlaying: true,
    mirrorX: false,
    ...(feed.thumbnail ? { thumbnail: feed.thumbnail } : {}),
    ...(feed.width > 0 && feed.height > 0 ? { videoWidth: feed.width, videoHeight: feed.height } : {}),
  };
}

// ── Per-frame facts the render sync and the frame pump share (no store) ──

/** How long after the last flush that drew a feed it still counts as shown. */
export const PHONE_FEED_IN_USE_LINGER_MS = 1000;

const inUse = new Map<PhoneFeedKey, number>();
const aspects = new Map<PhoneFeedKey, number>();

/** The render sync: a visible layer shows this feed (called per flush; a Map write). Wall clock. */
export function notePhoneFeedInUse(key: PhoneFeedKey, now = Date.now()): void {
  inUse.set(key, now);
}

export function phoneFeedInUse(key: PhoneFeedKey, now = Date.now()): boolean {
  const at = inUse.get(key);
  return at !== undefined && now - at <= PHONE_FEED_IN_USE_LINGER_MS;
}

export function setPhoneFeedAspect(key: PhoneFeedKey, width: number, height: number): void {
  if (width > 0 && height > 0) aspects.set(key, width / height);
}

/** The feed's picture shape, once a frame has arrived. */
export function phoneFeedAspect(key: PhoneFeedKey): number | undefined {
  return aspects.get(key);
}

// ── Stopping a feed from the desktop (Sources → stop) ─────────────────────

let stopHandler: ((key: PhoneFeedKey) => void) | null = null;

/** The receiver (App) says how a feed is stopped. */
export function setPhoneFeedStopHandler(handler: ((key: PhoneFeedKey) => void) | null): void {
  stopHandler = handler;
}

export function stopPhoneFeedFromDesktop(key: PhoneFeedKey): void {
  stopHandler?.(key);
}
