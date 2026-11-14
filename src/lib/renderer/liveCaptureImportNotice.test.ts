import { describe, expect, it } from 'vitest';
import {
  LiveCaptureNoticeLimiter,
  liveCaptureAdaptersDiffer,
  liveCaptureImportNotice,
} from './liveCaptureImportNotice';

describe('liveCaptureImportNotice', () => {
  it('names the other graphics chip and the Windows setting when the adapters differ', () => {
    const message = liveCaptureImportNotice({
      kind: 'webcam',
      captureAdapterLuid: '0000000000012345',
      coreAdapterLuid: '000000000001ABCD',
      reason: 'D3D12 OpenSharedHandle failed for HANDLE=0x1234',
    });
    expect(message).toMatch(/^This camera is on a different graphics chip than Ghost Arcade/);
    expect(message).toContain('Settings > System > Display > Graphics');
    expect(message).toContain('High performance');
  });

  it('says screen capture for a capture source', () => {
    expect(liveCaptureImportNotice({ kind: 'capture', captureAdapterLuid: '0000000000000001', coreAdapterLuid: '0000000000000002' }))
      .toMatch(/^This screen capture is on a different graphics chip/);
  });

  it('gives the two-GPU tip for an open failure when the capture adapter is unknown', () => {
    const message = liveCaptureImportNotice({ kind: 'webcam', coreAdapterLuid: '000000000001abcd', reason: 'D3D12 OpenSharedHandle failed' });
    expect(message).toMatch(/two graphics chips/);
    expect(message).toContain('High performance');
  });

  it('does not blame the other chip when both are the same adapter', () => {
    const message = liveCaptureImportNotice({
      kind: 'webcam', captureAdapterLuid: '000000000001abcd', coreAdapterLuid: '000000000001abcd', reason: 'D3D12 OpenSharedHandle failed',
    });
    expect(message).not.toMatch(/different graphics chip|two graphics chips/);
    expect(message).toContain('OpenSharedHandle failed');
  });

  it('keeps a long reason short', () => {
    const message = liveCaptureImportNotice({ kind: 'webcam', reason: 'x'.repeat(500) });
    expect(message.length).toBeLessThan(260);
  });

  it('compares LUIDs only when both are known', () => {
    expect(liveCaptureAdaptersDiffer({ captureAdapterLuid: null, coreAdapterLuid: '000000000001abcd' })).toBe(false);
    expect(liveCaptureAdaptersDiffer({ captureAdapterLuid: 'junk', coreAdapterLuid: '000000000001abcd' })).toBe(false);
    expect(liveCaptureAdaptersDiffer({ captureAdapterLuid: '000000000001ABCD', coreAdapterLuid: '000000000001abcd' })).toBe(false);
  });
});

describe('LiveCaptureNoticeLimiter', () => {
  it('tells once per source, not per frame', () => {
    const limiter = new LiveCaptureNoticeLimiter(60_000, 8);
    expect(limiter.shouldNotify('camera:a', 0)).toBe(true);
    for (let frame = 1; frame <= 600; frame += 1) {
      expect(limiter.shouldNotify('camera:a', frame * 16)).toBe(false);
    }
    expect(limiter.shouldNotify('camera:b', 100)).toBe(true);
  });

  it('tells again after the interval', () => {
    const limiter = new LiveCaptureNoticeLimiter(60_000, 8);
    limiter.shouldNotify('camera:a', 0);
    expect(limiter.shouldNotify('camera:a', 59_999)).toBe(false);
    expect(limiter.shouldNotify('camera:a', 60_000)).toBe(true);
  });

  it('tells straight away after the source recovered and failed again', () => {
    const limiter = new LiveCaptureNoticeLimiter(60_000, 8);
    limiter.shouldNotify('camera:a', 0);
    expect(limiter.recovered('camera:a')).toBe(true);
    expect(limiter.recovered('camera:a')).toBe(false);
    expect(limiter.shouldNotify('camera:a', 10)).toBe(true);
  });

  it('is capped, forgetting the source noted longest ago', () => {
    const limiter = new LiveCaptureNoticeLimiter(60_000, 3);
    for (let i = 0; i < 10; i += 1) limiter.shouldNotify(`s${i}`, i);
    expect(limiter.size).toBe(3);
    expect(limiter.has('s9')).toBe(true);
    expect(limiter.has('s7')).toBe(true);
    expect(limiter.has('s6')).toBe(false);
  });

  it('re-noting a source moves it to the back of the eviction order', () => {
    const limiter = new LiveCaptureNoticeLimiter(10, 2);
    limiter.shouldNotify('a', 0);
    limiter.shouldNotify('b', 1);
    limiter.shouldNotify('a', 20);
    limiter.shouldNotify('c', 21);
    expect(limiter.has('a')).toBe(true);
    expect(limiter.has('b')).toBe(false);
  });
});
