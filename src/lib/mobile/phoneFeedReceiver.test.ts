import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import { PhoneFeedReceiver, type PhoneFeedMediaItem } from './phoneFeedReceiver';
import { PHONE_FEED_CONNECT_TIMEOUT_MS, PHONE_FEED_STALL_MS, notePhoneFeedInUse, phoneFeedAspect, phoneFeeds, resetPhoneFeeds } from './phoneFeeds';
import { FakePeer, fakeCore, fakeFrame, fakeFrameSource, flush } from './phoneFeedTestKit';

const offerFor = (kind: string) => ({ studioFeed: { schema: 'ghost-mobile-feed', version: 1, kind, content: 'visual-rgba', metricDepth: false } });
const SDP = { type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescriptionInit;

function rig() {
  FakePeer.made = [];
  const sent: Record<string, any>[] = [];
  const media = new Map<string, PhoneFeedMediaItem>();
  const core = fakeCore();
  const sources: ReturnType<typeof fakeFrameSource>[] = [];
  let clock = 1000;
  let timer: (() => void) | null = null;
  const receiver = new PhoneFeedReceiver({
    send: (payload) => sent.push(payload),
    createPeer: () => new FakePeer() as unknown as RTCPeerConnection,
    sink: core.sink,
    maxEdge: () => 2048,
    frameSource: () => { const s = fakeFrameSource(); sources.push(s); return s; },
    thumbnail: async () => 'data:image/jpeg;base64,still',
    media: { put: (item) => media.set(item.id, item), remove: (id) => media.delete(id) },
    now: () => clock,
    setInterval: (fn) => { timer = fn; return 1; },
    clearInterval: () => { timer = null; },
  });
  const statuses = (sessionId: string) => sent.filter((m) => m.type === 'phone_vision_status' && m.sessionId === sessionId).map((m) => m.status);
  /** Offer, answer, track, first frame shown: the feed is live. */
  async function goLive(sessionId: string, kind = 'dual') {
    await receiver.offer(sessionId, SDP, offerFor(kind));
    const peer = FakePeer.made[FakePeer.made.length - 1];
    peer.setState('connected');
    const track = peer.addTrack();
    const source = sources[sources.length - 1];
    source.push(fakeFrame(1280, 480));
    await flush(); await flush(); await flush();
    return { peer, track, source };
  }
  return {
    receiver, sent, media, core, sources, statuses, goLive,
    advance(ms: number) { clock += ms; },
    tick() { timer?.(); },
    timerRunning: () => timer !== null,
  };
}

describe('PhoneFeedReceiver', () => {
  beforeEach(() => resetPhoneFeeds());

  it('answers the offer, and tells the phone it is live only once the core has shown a frame', async () => {
    const r = rig();
    await r.receiver.offer('s1', SDP, offerFor('dual'));
    expect(r.sent.find((m) => m.type === 'phone_camera_answer')).toMatchObject({ sessionId: 's1', sdp: { type: 'answer' } });
    expect(get(phoneFeeds).get('dual')?.phase).toBe('connecting');
    expect(r.statuses('s1')).toEqual(['connecting']);
    expect(r.media.size).toBe(0);

    const peer = FakePeer.made[0];
    peer.setState('connected');
    peer.addTrack();
    // A track alone is not a picture on the desktop.
    expect(r.statuses('s1')).not.toContain('live');
    r.sources[0].push(fakeFrame(1280, 480));
    await flush(); await flush(); await flush();

    const live = r.sent.find((m) => m.type === 'phone_vision_status' && m.status === 'live');
    expect(live).toMatchObject({ sessionId: 's1', sourceReady: true, rendered: true, label: 'Mobile Dual Camera' });
    expect(r.core.uploads[0]).toMatchObject({ source_id: 'phone-feed:dual', width: 1280, height: 480 });
    expect(get(phoneFeeds).get('dual')).toMatchObject({ phase: 'live', width: 1280, height: 480, thumbnail: 'data:image/jpeg;base64,still' });
    expect(r.media.get('phone-feed-dual')).toMatchObject({ name: 'Mobile Dual Camera', src: 'live://phone-camera/dual', type: 'video' });
    expect(phoneFeedAspect('dual')).toBeCloseTo(1280 / 480);
  });

  it('dual camera and each depth view are separate, named sources', async () => {
    const r = rig();
    await r.goLive('a', 'dual');
    await r.goLive('b', 'depth');
    await r.goLive('c', 'points');
    expect([...r.media.values()].map((m) => m.name)).toEqual(['Mobile Dual Camera', 'Mobile Depth Map', 'Mobile Point Cloud']);
    expect(new Set(r.core.uploads.map((u) => u.source_id))).toEqual(new Set(['phone-feed:dual', 'phone-feed:depth', 'phone-feed:points']));
  });

  it('refuses a feed it does not know, telling the phone why', async () => {
    const r = rig();
    await r.receiver.offer('x', SDP, offerFor('thermal'));
    expect(FakePeer.made).toHaveLength(0);
    expect(r.sent).toEqual([{ type: 'phone_vision_status', sessionId: 'x', status: 'failed', error: 'Unsupported Studio feed.' }]);
  });

  it('a feed that stops sending frames is stalled, and live again when frames return', async () => {
    const r = rig();
    const { source } = await r.goLive('s1');
    r.advance(PHONE_FEED_STALL_MS + 500);
    r.tick();
    expect(get(phoneFeeds).get('dual')?.phase).toBe('stalled');
    expect(r.statuses('s1')).toContain('stalled');
    source.push(fakeFrame(1280, 480));
    await flush();
    expect(get(phoneFeeds).get('dual')?.phase).toBe('live');
    expect(r.sent.filter((m) => m.status === 'live').pop()).toMatchObject({ resumed: true, sourceReady: true });
  });

  it('when the phone stops: closes the peer, stops the track, blanks the feed in the core, takes it out of the library', async () => {
    const r = rig();
    const { peer, track, source } = await r.goLive('s1');
    r.receiver.phoneStopped('s1');
    expect(peer.closed).toBe(true);
    expect((track as any).stopped).toBe(true);
    expect(source.cancelled()).toBe(true);
    const last = r.core.uploads[r.core.uploads.length - 1];
    expect(last).toMatchObject({ source_id: 'phone-feed:dual', width: 2, height: 2 });
    expect(Array.from(Buffer.from((last as any).rgba_b64, 'base64'))).toEqual(new Array(16).fill(0));
    expect(r.media.size).toBe(0);
    expect(get(phoneFeeds).get('dual')).toMatchObject({ phase: 'ended', sessionId: 's1' });
    expect(r.receiver.activeSessions()).toEqual([]);
    expect(r.timerRunning()).toBe(false);
    // The phone already knows it stopped.
    expect(r.statuses('s1')).not.toContain('failed');
  });

  it('when the phone disconnects (socket closed, or the connection fails) the session ends the same way', async () => {
    const r = rig();
    await r.goLive('s1');
    r.receiver.phoneStopped('s1', 'disconnected');
    expect(get(phoneFeeds).get('dual')).toMatchObject({ phase: 'ended' });

    const { peer } = await r.goLive('s2', 'depth');
    peer.setState('failed');
    expect(get(phoneFeeds).get('depth')).toMatchObject({ phase: 'ended' });
    expect(peer.closed).toBe(true);
    expect(r.media.has('phone-feed-depth')).toBe(false);
  });

  it('reconnect: the same feed from a new session lights the same source again', async () => {
    const r = rig();
    await r.goLive('s1');
    r.receiver.phoneStopped('s1', 'disconnected');
    expect(get(phoneFeeds).get('dual')?.phase).toBe('ended');
    await r.goLive('s2');
    expect(get(phoneFeeds).get('dual')).toMatchObject({ phase: 'live', sessionId: 's2' });
    expect(r.media.get('phone-feed-dual')).toBeTruthy();
    const ids = r.core.uploads.map((u) => u.source_id);
    expect(new Set(ids)).toEqual(new Set(['phone-feed:dual']));
  });

  it('replace: a second session for the same feed ends the first and tells its phone', async () => {
    const r = rig();
    const first = await r.goLive('s1');
    await r.goLive('s2');
    expect(first.peer.closed).toBe(true);
    expect(r.sent.find((m) => m.sessionId === 's1' && m.status === 'failed')?.error).toMatch(/another session/);
    expect(get(phoneFeeds).get('dual')).toMatchObject({ phase: 'live', sessionId: 's2' });
    expect(r.receiver.activeSessions().map((s) => s.sessionId)).toEqual(['s2']);
  });

  it('holds at most four sessions; the oldest goes', async () => {
    const r = rig();
    for (const [id, kind] of [['a', 'rear'], ['b', 'front'], ['c', 'depth'], ['d', 'points'], ['e', 'dual']]) await r.goLive(id, kind);
    expect(r.receiver.activeSessions().map((s) => s.sessionId)).toEqual(['b', 'c', 'd', 'e']);
    expect(FakePeer.made[0].closed).toBe(true);
  });

  it('a session with no picture fails after the timeout, and the phone is told', async () => {
    const r = rig();
    await r.receiver.offer('s1', SDP, offerFor('dual'));
    r.advance(PHONE_FEED_CONNECT_TIMEOUT_MS + 1);
    r.tick();
    expect(get(phoneFeeds).get('dual')?.phase).toBe('ended');
    expect(r.sent.find((m) => m.status === 'failed')).toMatchObject({ sessionId: 's1', error: 'The desktop did not get a picture from the phone.' });
    expect(FakePeer.made[0].closed).toBe(true);
  });

  it('the desktop can stop a feed (Sources → stop); the phone is told', async () => {
    const r = rig();
    await r.goLive('s1');
    r.receiver.stopFromDesktop('dual');
    expect(r.sent.find((m) => m.status === 'failed')).toMatchObject({ sessionId: 's1', error: 'Stopped on the desktop.' });
    expect(get(phoneFeeds).get('dual')?.phase).toBe('ended');
  });

  it('holds early ICE until the offer is applied, bounded', async () => {
    const r = rig();
    const pending = r.receiver.offer('s1', SDP, offerFor('dual'));
    for (let i = 0; i < 200; i++) void r.receiver.ice('s1', { candidate: `c${i}` });
    await pending;
    expect(FakePeer.made[0].candidates.length).toBeLessThanOrEqual(128);
    await r.receiver.ice('s1', { candidate: 'late' });
    expect(FakePeer.made[0].candidates.at(-1)).toEqual({ candidate: 'late' });
  });

  it('uploads only while a layer shows the feed once it is live', async () => {
    const r = rig();
    const { source } = await r.goLive('s1');
    const before = r.core.uploads.length;
    source.push(fakeFrame(1280, 480)); await flush(); await flush();
    expect(r.core.uploads.length).toBe(before);
    notePhoneFeedInUse('dual');
    source.push(fakeFrame(1280, 480)); await flush(); await flush();
    expect(r.core.uploads.length).toBe(before + 1);
  });

  it('stopAll ends every session and leaves nothing running', async () => {
    const r = rig();
    await r.goLive('a', 'dual');
    await r.goLive('b', 'depth');
    r.receiver.stopAll();
    expect(r.receiver.activeSessions()).toEqual([]);
    expect(FakePeer.made.every((p) => p.closed)).toBe(true);
    expect(r.media.size).toBe(0);
    expect(r.timerRunning()).toBe(false);
    expect(r.receiver.stats().length).toBeLessThanOrEqual(4);
  });
});
