import { describe, expect, it } from 'vitest';
import { MIME_CANDIDATES, coverCrop, normalizeRecordingOptions, pickMimeType, recordingFilename, recordingLayout } from './programRecorder';

describe('recording format', () => {
  it('picks MP4 before WebM, because Photos and messages need MP4', () => {
    expect(MIME_CANDIDATES[0]).toMatch(/^video\/mp4/);
    expect(pickMimeType(() => true)).toBe('video/mp4;codecs=avc1');
    expect(pickMimeType((t) => t.startsWith('video/webm'))).toBe('video/webm;codecs=vp9');
    expect(pickMimeType(() => false)).toBe('');
    expect(pickMimeType(() => { throw new Error('no'); })).toBe('');
  });
});

describe('recording layout', () => {
  it('records the program at its own size, kept between 960 and 1920 wide', () => {
    expect(recordingLayout({ camera: 'off', mark: false }, 1280, 720)).toEqual({ width: 1280, height: 720, program: { x: 0, y: 0, w: 1280, h: 720 }, camera: null, mark: null });
    expect(recordingLayout({ camera: 'off', mark: false }, 3840, 2160)).toMatchObject({ width: 1920, height: 1080 });
    expect(recordingLayout({ camera: 'off', mark: false }, 640, 360)).toMatchObject({ width: 960, height: 540 });
  });
  it('puts the camera and the program side by side at half size', () => {
    const l = recordingLayout({ camera: 'side', mark: false }, 1920, 1080);
    expect(l).toMatchObject({ width: 1920, height: 540, camera: { x: 0, y: 0, w: 960, h: 540 }, program: { x: 960, y: 0, w: 960, h: 540 } });
  });
  it('puts an inset camera in the lower left, clear of the mark in the lower right', () => {
    const l = recordingLayout({ camera: 'inset', mark: true }, 1280, 720);
    expect(l.camera!.x).toBeLessThan(l.width / 2);
    expect(l.camera!.y + l.camera!.h).toBeLessThan(l.height);
    expect(l.mark!.x).toBeGreaterThan(l.camera!.x + l.camera!.w);
    expect(l.mark!.x + l.mark!.w).toBeLessThan(l.width);
    expect(l.mark!.y + l.mark!.h).toBeLessThan(l.height);
  });
  it('keeps every size even, as video encoders need', () => {
    for (const [w, h] of [[1279, 721], [1000, 563], [960, 540]]) {
      const l = recordingLayout({ camera: 'side', mark: true }, w, h);
      expect(l.width % 2).toBe(0);
      expect(l.height % 2).toBe(0);
    }
  });
  it('leaves the mark out when it is switched off', () => {
    expect(recordingLayout({ camera: 'off', mark: false }, 1280, 720).mark).toBeNull();
  });
});

describe('camera crop', () => {
  it('cuts a portrait camera frame from the middle to fill a wide tile without stretching', () => {
    const c = coverCrop(1080, 1920, { w: 960, h: 540 });
    expect(c.sw).toBe(1080);
    expect(c.sh).toBeCloseTo(607.5);
    expect(c.sy).toBeCloseTo((1920 - 607.5) / 2);
    expect(c.sw / c.sh).toBeCloseTo(960 / 540);
  });
  it('cuts the sides of a wider frame', () => {
    const c = coverCrop(2000, 500, { w: 400, h: 300 });
    expect(c).toMatchObject({ sy: 0, sh: 500 });
    expect(c.sw / c.sh).toBeCloseTo(4 / 3);
  });
});

it('remembers the camera layout and the mark, with the mark on by default', () => {
  expect(normalizeRecordingOptions({})).toEqual({ camera: 'off', mark: true });
  expect(normalizeRecordingOptions({ camera: 'inset', mark: false })).toEqual({ camera: 'inset', mark: false });
  expect(normalizeRecordingOptions({ camera: 'other', mark: 'no' })).toEqual({ camera: 'off', mark: true });
});

it('names a recording by its date and time', () => {
  expect(recordingFilename(new Date(2026, 10, 13, 9, 5, 7))).toBe('Ghost Arcade 2026-11-13 09.05.07.mp4');
});
