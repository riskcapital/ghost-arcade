import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  PHONE_FEED_CONNECT_TIMEOUT_MS,
  PHONE_FEED_DISCONNECTED_TEXT,
  PHONE_FEED_IN_USE_LINGER_MS,
  PHONE_FEED_KEYS,
  PHONE_FEED_LABELS,
  PHONE_FEED_MAX_SESSIONS,
  PHONE_FEED_STALL_END_MS,
  PHONE_FEED_STALL_MS,
  listedPhoneFeeds,
  notePhoneFeedInUse,
  phoneFeedCellNotice,
  phoneFeedClip,
  phoneFeedCoreSourceId,
  phoneFeedInUse,
  phoneFeedKeyFromOffer,
  phoneFeedKeyFromUri,
  phoneFeeds,
  phoneFeedUri,
  publishPhoneFeed,
  resetPhoneFeeds,
  sessionsReplacedByOffer,
  stepPhoneFeed,
  type PhoneFeedState,
  type PhoneFeedSummary,
} from './phoneFeeds';

const feedOffer = (kind: string, extra: Record<string, unknown> = {}) => ({
  studioFeed: { schema: 'ghost-mobile-feed', version: 1, kind, content: 'visual-rgba', metricDepth: false, ...extra },
});

describe('phone feed names and addresses', () => {
  it('names every feed the phone sends, each its own source', () => {
    // The kinds the phone's Feed studio offers (feat/ios-1.2 desktopFeed.ts), plus Interactive Studio.
    for (const kind of ['rear', 'front', 'dual', 'depth', 'contours', 'points', 'interactive']) {
      const parsed = phoneFeedKeyFromOffer(feedOffer(kind));
      expect(parsed).toEqual({ key: kind });
    }
    expect(PHONE_FEED_LABELS.dual).toBe('Mobile Dual Camera');
    expect(PHONE_FEED_LABELS.depth).toBe('Mobile Depth Map');
    expect(PHONE_FEED_LABELS.points).toBe('Mobile Point Cloud');
    expect(new Set(PHONE_FEED_KEYS.map((key) => PHONE_FEED_LABELS[key])).size).toBe(PHONE_FEED_KEYS.length);
    expect(new Set(PHONE_FEED_KEYS.map(phoneFeedCoreSourceId)).size).toBe(PHONE_FEED_KEYS.length);
  });

  it('reads an offer without a feed as the plain phone camera, and refuses a feed it does not know', () => {
    expect(phoneFeedKeyFromOffer({})).toEqual({ key: 'camera' });
    expect(phoneFeedKeyFromOffer(feedOffer('thermal'))).toEqual({ error: 'Unsupported Studio feed.' });
    expect(phoneFeedKeyFromOffer(feedOffer('depth', { metricDepth: true }))).toEqual({ error: 'Unsupported Studio feed.' });
    expect(phoneFeedKeyFromOffer(feedOffer('depth', { version: 2 }))).toEqual({ error: 'Unsupported Studio feed.' });
    expect(phoneFeedKeyFromOffer(feedOffer('camera'))).toEqual({ error: 'Unsupported Studio feed.' });
  });

  it('names the feed, not the session, so a cell survives a reconnect', () => {
    expect(phoneFeedUri('dual')).toBe('live://phone-camera/dual');
    expect(phoneFeedKeyFromUri('live://phone-camera/dual')).toBe('dual');
    // A session address saved by an older build reads as the plain camera.
    expect(phoneFeedKeyFromUri('live://phone-camera/6ee3c361-b996-411b-95c5-66f09a75a954')).toBe('camera');
    expect(phoneFeedKeyFromUri('live://webcam/abc')).toBeNull();
    expect(phoneFeedKeyFromUri(undefined)).toBeNull();
  });
});

describe('stepPhoneFeed', () => {
  const offered: PhoneFeedState = { phase: 'offered', at: 0 };
  const connecting: PhoneFeedState = { phase: 'connecting', at: 0 };
  const live: PhoneFeedState = { phase: 'live', since: 100 };
  const stalled: PhoneFeedState = { phase: 'stalled', since: 5000 };

  it('offered → connecting when answered, → live if a frame shows first', () => {
    expect(stepPhoneFeed(offered, { type: 'answered', now: 10 })).toEqual({ phase: 'connecting', at: 10 });
    expect(stepPhoneFeed(offered, { type: 'shown', now: 20 })).toEqual({ phase: 'live', since: 20 });
  });

  it('is live only once the core has shown a frame (a frame alone is not enough)', () => {
    expect(stepPhoneFeed(connecting, { type: 'frame', now: 50 })).toBe(connecting);
    expect(stepPhoneFeed(connecting, { type: 'peer', state: 'connected', now: 50 })).toBe(connecting);
    expect(stepPhoneFeed(connecting, { type: 'shown', now: 60 })).toEqual({ phase: 'live', since: 60 });
  });

  it('fails a feed that never shows a picture', () => {
    expect(stepPhoneFeed(connecting, { type: 'tick', now: PHONE_FEED_CONNECT_TIMEOUT_MS, lastFrameAt: 0 })).toBe(connecting);
    const failed = stepPhoneFeed(connecting, { type: 'tick', now: PHONE_FEED_CONNECT_TIMEOUT_MS + 1, lastFrameAt: 0 });
    expect(failed).toMatchObject({ phase: 'ended', reason: 'failed' });
    expect(stepPhoneFeed(offered, { type: 'tick', now: PHONE_FEED_CONNECT_TIMEOUT_MS + 1, lastFrameAt: 0 })).toMatchObject({ phase: 'ended', reason: 'failed' });
    expect(stepPhoneFeed(offered, { type: 'peer', state: 'failed', now: 5 })).toMatchObject({ phase: 'ended', reason: 'failed' });
    expect(stepPhoneFeed(connecting, { type: 'peer', state: 'closed', now: 5 })).toMatchObject({ phase: 'ended', reason: 'failed' });
  });

  it('live → stalled when frames stop or the connection drops, and back on the next frame', () => {
    expect(stepPhoneFeed(live, { type: 'tick', now: 1000, lastFrameAt: 1000 - PHONE_FEED_STALL_MS })).toBe(live);
    expect(stepPhoneFeed(live, { type: 'tick', now: 5000, lastFrameAt: 1000 })).toEqual({ phase: 'stalled', since: 5000 });
    expect(stepPhoneFeed(live, { type: 'peer', state: 'disconnected', now: 7 })).toEqual({ phase: 'stalled', since: 7 });
    expect(stepPhoneFeed(stalled, { type: 'frame', now: 6000 })).toEqual({ phase: 'live', since: 6000 });
    expect(stepPhoneFeed(stalled, { type: 'shown', now: 6000 })).toEqual({ phase: 'live', since: 6000 });
    expect(stepPhoneFeed(stalled, { type: 'tick', now: 6000, lastFrameAt: 0 })).toBe(stalled);
  });

  it('ends a feed whose connection fails or that stays stalled', () => {
    expect(stepPhoneFeed(live, { type: 'peer', state: 'failed', now: 9 })).toMatchObject({ phase: 'ended', reason: 'disconnected' });
    expect(stepPhoneFeed(live, { type: 'peer', state: 'closed', now: 9 })).toMatchObject({ phase: 'ended', reason: 'disconnected' });
    expect(stepPhoneFeed(stalled, { type: 'peer', state: 'failed', now: 9 })).toMatchObject({ phase: 'ended', reason: 'disconnected' });
    expect(stepPhoneFeed(stalled, { type: 'tick', now: 5000 + PHONE_FEED_STALL_END_MS + 1, lastFrameAt: 0 })).toMatchObject({ phase: 'ended', reason: 'disconnected' });
  });

  it('ends from any open state, with the reason, and ended is final', () => {
    for (const state of [offered, connecting, live, stalled]) {
      const done = stepPhoneFeed(state, { type: 'end', reason: 'replaced', now: 3 });
      expect(done).toMatchObject({ phase: 'ended', reason: 'replaced', at: 3 });
      expect((done as { message: string }).message).toBeTruthy();
      for (const event of [
        { type: 'shown', now: 4 }, { type: 'frame', now: 4 }, { type: 'answered', now: 4 },
        { type: 'tick', now: 4, lastFrameAt: 4 }, { type: 'peer', state: 'connected', now: 4 },
        { type: 'end', reason: 'stopped', now: 4 },
      ] as const) {
        expect(stepPhoneFeed(done, event)).toBe(done);
      }
    }
    expect(stepPhoneFeed(live, { type: 'end', reason: 'stopped', message: 'Stopped on the desktop.', now: 1 }))
      .toMatchObject({ message: 'Stopped on the desktop.' });
  });
});

describe('sessionsReplacedByOffer', () => {
  const open = (sessionId: string, key: any, openedAt: number, phase: PhoneFeedState['phase'] = 'live') =>
    ({ sessionId, key, openedAt, state: (phase === 'ended' ? { phase, at: 0, reason: 'stopped', message: '' } : phase === 'live' || phase === 'stalled' ? { phase, since: 0 } : { phase, at: 0 }) as PhoneFeedState });

  it('replaces the session already sending the same feed', () => {
    expect(sessionsReplacedByOffer([open('a', 'dual', 1), open('b', 'depth', 2)], { sessionId: 'c', key: 'dual' })).toEqual(['a']);
  });

  it('keeps feeds of other kinds until the cap, then the oldest goes', () => {
    const sessions = [open('a', 'rear', 1), open('b', 'depth', 2), open('c', 'points', 3), open('d', 'front', 4)];
    expect(sessions).toHaveLength(PHONE_FEED_MAX_SESSIONS);
    expect(sessionsReplacedByOffer(sessions, { sessionId: 'e', key: 'dual' })).toEqual(['a']);
    expect(sessionsReplacedByOffer(sessions.slice(0, 3), { sessionId: 'e', key: 'dual' })).toEqual([]);
  });

  it('ignores ended sessions and the offer itself', () => {
    expect(sessionsReplacedByOffer([open('a', 'dual', 1, 'ended'), open('c', 'dual', 2)], { sessionId: 'c', key: 'dual' })).toEqual([]);
  });
});

describe('what the UI reads', () => {
  const summary = (over: Partial<PhoneFeedSummary> = {}): PhoneFeedSummary => ({
    key: 'dual', label: 'Mobile Dual Camera', sessionId: 's1', phase: 'live', message: '', width: 1280, height: 480, thumbnail: '', ...over,
  });
  beforeEach(() => resetPhoneFeeds());

  it('lists open feeds by name, in a fixed order, and drops ended ones', () => {
    publishPhoneFeed(summary({ key: 'points', label: PHONE_FEED_LABELS.points, sessionId: 'p' }));
    publishPhoneFeed(summary());
    publishPhoneFeed(summary({ key: 'depth', label: PHONE_FEED_LABELS.depth, sessionId: 'd', phase: 'ended', message: 'gone' }));
    expect(listedPhoneFeeds(get(phoneFeeds)).map((f) => f.label)).toEqual(['Mobile Dual Camera', 'Mobile Point Cloud']);
  });

  it('a replaced session never overwrites the session that replaced it', () => {
    publishPhoneFeed(summary({ sessionId: 'new', phase: 'connecting' }));
    publishPhoneFeed(summary({ sessionId: 'old', phase: 'ended', message: 'replaced' }));
    expect(get(phoneFeeds).get('dual')).toMatchObject({ sessionId: 'new', phase: 'connecting' });
  });

  it('changes the store on transitions only', () => {
    let writes = 0;
    const stop = phoneFeeds.subscribe(() => { writes += 1; });
    publishPhoneFeed(summary());
    publishPhoneFeed(summary());
    publishPhoneFeed(summary());
    publishPhoneFeed(summary({ phase: 'stalled' }));
    stop();
    expect(writes).toBe(3); // initial + live + stalled
  });

  it('a cell says the phone camera is disconnected until its feed is live again', () => {
    expect(phoneFeedCellNotice(undefined)).toBe(PHONE_FEED_DISCONNECTED_TEXT);
    expect(phoneFeedCellNotice(summary({ phase: 'ended' }))).toBe(PHONE_FEED_DISCONNECTED_TEXT);
    expect(phoneFeedCellNotice(summary({ phase: 'connecting' }))).toMatch(/connecting/);
    expect(phoneFeedCellNotice(summary({ phase: 'stalled' }))).toBeTruthy();
    expect(phoneFeedCellNotice(summary({ phase: 'live' }))).toBeNull();
  });

  it('a deck clip names the feed and plays like a live source', () => {
    const clip = phoneFeedClip(summary({ thumbnail: 'data:image/jpeg;base64,xx' }), 'clip-1');
    expect(clip).toMatchObject({ id: 'clip-1', type: 'video', name: 'Mobile Dual Camera', src: 'live://phone-camera/dual', isPlaying: true, videoWidth: 1280, videoHeight: 480, thumbnail: 'data:image/jpeg;base64,xx' });
    expect('videoElement' in clip).toBe(false);
  });

  it('counts a feed as shown for a moment after the last flush that drew it', () => {
    expect(phoneFeedInUse('dual', 1000)).toBe(false);
    notePhoneFeedInUse('dual', 1000);
    expect(phoneFeedInUse('dual', 1000 + PHONE_FEED_IN_USE_LINGER_MS)).toBe(true);
    expect(phoneFeedInUse('dual', 1001 + PHONE_FEED_IN_USE_LINGER_MS)).toBe(false);
    expect(phoneFeedInUse('depth', 1000)).toBe(false);
  });
});
