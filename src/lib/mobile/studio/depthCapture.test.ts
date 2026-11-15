import { describe, expect, it } from 'vitest';
import { boxPyramid, pyramidCapture } from '../../scene3d/roomFixtures';
import { DepthCaptureOffers, MAX_WAITING_PHONES, parseDepthCaptureOffer, stepDepthOffer, type DepthCaptureOffer, type DepthCaptureStatus, type DepthOfferState } from './depthCaptureOffer';
import { DEPTH_SCAN_ANSWER_MS, DEPTH_SCAN_SILENCE_MS, answersDepthScan, depthScanLabel, scanPhones, stepDepthScan, type DepthScanFlow } from './depthScanFlow';

const wire = (requestId = 'scan-1') => {
  const c = pyramidCapture(boxPyramid([1.2, 1.0, 5], [0.1, 1.2, 0], 28, 16 / 9));
  return { type: 'studio_depth_capture_offer', requestId, capture: { version: 1, ...c, source: { device: 'iPhone 15 Pro', screen: { id: 's1', width: 1920, height: 1080 }, capturedAt: '2026-11-14T20:00:00Z' } } };
};
const parse = (msg: Record<string, unknown>) => parseDepthCaptureOffer(msg, JSON.stringify(msg.capture).length);
const offer = (requestId: string): DepthCaptureOffer => parse(wire(requestId));

describe('a room scan offered by a phone', () => {
  it('reads a scan within the limits', () => {
    const o = offer('scan-1');
    expect(o.requestId).toBe('scan-1');
    expect(o.source).toEqual({ device: 'iPhone 15 Pro', screen: { id: 's1', width: 1920, height: 1080 }, capturedAt: '2026-11-14T20:00:00Z' });
    expect(o.surfaces).toBe(o.capture.surfaces.length);
    expect(o.samples).toBe(o.surfaces * 36);
  });

  it('refuses, with the reason, a scan that breaks the advertised limits or the format', () => {
    const bad = (change: (m: any) => void) => {
      const m: any = structuredClone(wire());
      change(m);
      return () => parse(m);
    };
    expect(bad((m) => (m.requestId = 'no spaces'))).toThrow(/request id/);
    expect(bad((m) => (m.capture.version = 2))).toThrow(/version 2/);
    expect(bad((m) => (m.capture.down = [0, 0, 0]))).toThrow(/down/);
    expect(bad((m) => (m.capture.surfaces = Array.from({ length: 49 }, () => m.capture.surfaces[0])))).toThrow(/48 surfaces/);
    expect(bad((m) => (m.capture.surfaces[1].id = m.capture.surfaces[0].id))).toThrow(/repeats/);
    expect(bad((m) => (m.capture.surfaces[0].outline = Array.from({ length: 65 }, () => ({ x: 0.5, y: 0.5 }))))).toThrow(/64 points/);
    expect(bad((m) => (m.capture.surfaces[0].outline[0] = { x: 5, y: 0 }))).toThrow(/off the output/);
    expect(bad((m) => (m.capture.surfaces[0].samples = Array.from({ length: 4001 }, () => m.capture.surfaces[0].samples[0])))).toThrow(/4000 samples/);
    expect(bad((m) => (m.capture.surfaces[0].samples[3] = { p: [0, 0, 1e6], uv: { x: 0, y: 0 } }))).toThrow(/meters/);
    expect(bad((m) => (m.capture.surfaces[0].samples[3] = { p: [0, 0, NaN], uv: { x: 0, y: 0 } }))).toThrow(/meters/);
    expect(bad((m) => { for (const s of m.capture.surfaces) s.samples = s.samples.slice(0, 0); })).toThrow(/six/);
    expect(() => parseDepthCaptureOffer(wire(), 8_000_001)).toThrow(/8 MB/);
    const many: any = structuredClone(wire());
    many.capture.surfaces = Array.from({ length: 16 }, (_, i) => ({ ...many.capture.surfaces[0], id: `s${i}`, samples: Array.from({ length: 4000 }, () => many.capture.surfaces[0].samples[0]) }));
    expect(() => parse(many)).toThrow(/60000 samples in all/);
  });

  it('names an unnamed phone plainly and drops control characters', () => {
    const m: any = wire();
    m.capture.source = { device: 'My\u0007 phone\n', screen: { id: 1 } };
    expect(parse(m).source).toEqual({ device: 'My phone' });
    delete m.capture.source;
    expect(parse(m).source.device).toBe('a phone');
  });
});

describe('one phone offer, step by step', () => {
  const a = offer('a'), b = offer('b');
  const offered: DepthOfferState = { kind: 'offered', offer: a };
  const applying: DepthOfferState = { kind: 'applying', offer: a, token: 7 };

  it('goes idle -> offered -> applying -> applied', () => {
    let s = stepDepthOffer({ kind: 'idle' }, { type: 'offer', offer: a });
    expect(s.state).toEqual(offered);
    expect(s.replies).toEqual([{ type: 'studio_depth_capture_status', requestId: 'a', state: 'received' }]);
    s = stepDepthOffer(s.state, { type: 'accept', token: 7 });
    expect(s.state).toEqual(applying);
    expect(s.replies).toEqual([]);
    s = stepDepthOffer(s.state, { type: 'applied', token: 7, message: 'Scanned 7 faces.' });
    expect(s.state).toEqual({ kind: 'applied', requestId: 'a', message: 'Scanned 7 faces.' });
    expect(s.replies[0]).toMatchObject({ requestId: 'a', state: 'applied', message: 'Scanned 7 faces.' });
  });

  it('declines, fails, cancels, and replaces a waiting offer with a newer one', () => {
    expect(stepDepthOffer(offered, { type: 'decline' }).replies[0]).toMatchObject({ requestId: 'a', state: 'declined' });
    expect(stepDepthOffer(applying, { type: 'failed', token: 7, message: 'No world.' })).toMatchObject({ state: { kind: 'error' }, replies: [{ state: 'error', message: 'No world.' }] });
    for (const s of [offered, applying]) expect(stepDepthOffer(s, { type: 'cancel', message: 'Another project was opened.' }).replies[0]).toMatchObject({ requestId: 'a', state: 'error' });
    const newer = stepDepthOffer(offered, { type: 'offer', offer: b });
    expect(newer.state).toEqual({ kind: 'offered', offer: b });
    expect(newer.replies.map((r) => [r.requestId, r.state])).toEqual([['a', 'declined'], ['b', 'received']]);
    // The same offer again only says received again.
    expect(stepDepthOffer(offered, { type: 'offer', offer: a }).replies.map((r) => r.state)).toEqual(['received']);
  });

  it('keeps an apply under way, and ignores a stale token or an answer that does not fit', () => {
    const busy = stepDepthOffer(applying, { type: 'offer', offer: b });
    expect(busy.state).toBe(applying);
    expect(busy.replies[0]).toMatchObject({ requestId: 'b', state: 'error' });
    expect(stepDepthOffer(applying, { type: 'applied', token: 6 })).toEqual({ state: applying, replies: [] });
    expect(stepDepthOffer(applying, { type: 'decline' })).toEqual({ state: applying, replies: [] });
    expect(stepDepthOffer({ kind: 'idle' }, { type: 'accept', token: 1 })).toEqual({ state: { kind: 'idle' }, replies: [] });
    expect(stepDepthOffer({ kind: 'declined', requestId: 'a' }, { type: 'offer', offer: b }).state).toEqual({ kind: 'offered', offer: b });
  });
});

describe('offers from several phones', () => {
  it('keeps one per phone, a few phones at most, and forgets finished ones', () => {
    const sent: DepthCaptureStatus[] = [];
    let changes = 0;
    const offers = new DepthCaptureOffers((s) => sent.push(s), () => changes++);
    for (let i = 0; i < MAX_WAITING_PHONES; i++) offers.offer(`phone${i}`, offer(`r${i}`));
    offers.offer('phone-extra', offer('extra'));
    expect(sent.at(-1)).toMatchObject({ requestId: 'extra', state: 'error' });
    expect(offers.waiting()).toHaveLength(MAX_WAITING_PHONES);
    offers.offer('phone0', offer('r0b'));
    expect(offers.waiting().find((w) => w.phone === 'phone0')!.offer.requestId).toBe('r0b');
    const run = offers.accept('phone1')!;
    expect(offers.applying('phone1', run.token)).toBe(true);
    expect(offers.accept('phone1')).toBeNull();
    offers.finish('phone1', run.token, { ok: true, message: 'done' });
    expect(offers.applying('phone1', run.token)).toBe(false);
    offers.decline('phone2');
    expect(offers.waiting().map((w) => w.phone)).toEqual(['phone0']);
    const late = offers.accept('phone0')!;
    offers.cancelAll('Another project was opened on the desktop.');
    expect(offers.applying('phone0', late.token)).toBe(false);
    expect(offers.waiting()).toEqual([]);
    expect(sent.at(-1)).toMatchObject({ requestId: 'r0b', state: 'error', message: 'Another project was opened on the desktop.' });
    // A finish after the cancel does nothing.
    const count = sent.length;
    offers.finish('phone0', late.token, { ok: true });
    expect(sent.length).toBe(count);
    expect(changes).toBeGreaterThan(5);
  });
});

describe('a scan the desktop asked for', () => {
  const start = stepDepthScan({ kind: 'idle' }, { type: 'start', requestId: 'q', phone: 'p', target: 'L1', now: 0 }).flow;

  it('goes asking -> scanning -> applying -> applied, and a matching offer needs no prompt', () => {
    expect(start).toMatchObject({ kind: 'asking', requestId: 'q' });
    let f: DepthScanFlow = stepDepthScan(start, { type: 'progress', requestId: 'q', stage: 'ready', now: 1000 }).flow;
    expect(depthScanLabel(f)).toMatch(/tap Start/);
    f = stepDepthScan(f, { type: 'progress', requestId: 'q', stage: 'patterns', pct: 140, now: 2000 }).flow;
    expect(f).toMatchObject({ kind: 'scanning', stage: 'patterns', pct: 100 });
    expect(answersDepthScan(f, 'q')).toBe(true);
    expect(answersDepthScan(f, 'other')).toBe(false);
    // Progress for another scan changes nothing.
    expect(stepDepthScan(f, { type: 'progress', requestId: 'x', stage: 'solving', now: 3000 }).flow).toBe(f);
    f = stepDepthScan(f, { type: 'offer', requestId: 'q' }).flow;
    expect(f.kind).toBe('applying');
    expect(stepDepthScan(f, { type: 'cancel' }).flow).toBe(f);
    f = stepDepthScan(f, { type: 'applied', requestId: 'q', summary: 'Scanned 7 faces.' }).flow;
    expect(f).toEqual({ kind: 'applied', requestId: 'q', summary: 'Scanned 7 faces.' });
    expect(stepDepthScan(f, { type: 'dismiss' }).flow).toEqual({ kind: 'idle' });
  });

  it('tells the phone when the desktop cancels or gives up, and stops on the phone cancelling', () => {
    const cancelled = stepDepthScan(start, { type: 'cancel' });
    expect(cancelled.flow).toEqual({ kind: 'idle' });
    expect(cancelled.tell).toMatchObject({ requestId: 'q', state: 'declined' });
    expect(stepDepthScan(start, { type: 'tick', now: DEPTH_SCAN_ANSWER_MS - 1 }).flow).toBe(start);
    const late = stepDepthScan(start, { type: 'tick', now: DEPTH_SCAN_ANSWER_MS });
    expect(late.flow.kind).toBe('failed');
    expect(late.tell).toMatchObject({ requestId: 'q', state: 'error' });
    const scanning = stepDepthScan(start, { type: 'progress', requestId: 'q', stage: 'measuring', now: 5000 }).flow;
    expect(stepDepthScan(scanning, { type: 'tick', now: 5000 + DEPTH_SCAN_ANSWER_MS }).flow).toBe(scanning);
    expect(stepDepthScan(scanning, { type: 'tick', now: 5000 + DEPTH_SCAN_SILENCE_MS }).flow.kind).toBe('failed');
    expect(stepDepthScan(scanning, { type: 'progress', requestId: 'q', stage: 'cancelled', now: 6000 }).flow).toEqual({ kind: 'failed', message: 'The scan was cancelled on the phone.' });
    expect(stepDepthScan(scanning, { type: 'progress', requestId: 'q', stage: 'error', message: 'No LiDAR.', now: 6000 }).flow).toEqual({ kind: 'failed', message: 'No LiDAR.' });
    // One at a time.
    expect(stepDepthScan(scanning, { type: 'start', requestId: 'q2', phone: 'p', target: 'L1', now: 7000 }).flow).toBe(scanning);
  });

  it('lists only phones that can be asked, bounded', () => {
    expect(scanPhones([{ id: '10.0.0.4:abc', app: 'ios', version: '1.2' }, { id: 'bad id!' }, { id: '10.0.0.5', name: 'Stage iPhone', app: 'ios' }, null])).toEqual([
      { id: '10.0.0.4:abc', label: 'iPhone · app 1.2' },
      { id: '10.0.0.5', label: 'Stage iPhone' },
    ]);
    expect(scanPhones(Array.from({ length: 20 }, (_, i) => ({ id: `p${i}`, app: 'ios' })))).toHaveLength(8);
    expect(scanPhones('x')).toEqual([]);
  });
});
