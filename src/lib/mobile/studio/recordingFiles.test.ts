import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppRecordingSink, canStoreRecordings, formatDuration, recordingSink, MemoryRecordingSink, saveRecording, shareRecording, soundLine } from './recordingFiles';
import { canPickRoute, pickRoute, presentMode, requestReview } from './nativeOutput';

const METHODS = ['showRoutePicker', 'routeStatus', 'recordingBegin', 'recordingVideoStarted', 'recordingAppend', 'recordingFinish', 'recordingDiscard', 'recordingSaveToPhotos', 'recordingShare', 'presentMode', 'requestReview', 'appVersion'];
function app(answers: Record<string, unknown> = {}, methods = METHODS) {
  const nativePromise = vi.fn(async (_plugin: string, method: string, _args?: Record<string, unknown>) => answers[method] ?? {});
  (globalThis as { Capacitor?: unknown }).Capacitor = {
    getPlatform: () => 'ios', nativePromise, convertFileSrc: (p: string) => `capacitor://localhost/_capacitor_file_${p}`,
    PluginHeaders: [{ name: 'StudioOutput', methods: methods.map((name) => ({ name })) }],
  };
  return nativePromise;
}
afterEach(() => { delete (globalThis as { Capacitor?: unknown }).Capacitor; });

describe('recording files in the app', () => {
  it('writes each piece to the app as it arrives and hands back the finished file', async () => {
    const native = app({ recordingBegin: { id: 'A' }, recordingFinish: { id: 'A', path: '/tmp/GhostRecordings/A/Ghost Arcade.mp4', bytes: 9_400_000, durationMs: 10_010, width: 1280, height: 720 } });
    expect(canStoreRecordings()).toBe(true);
    const sink = recordingSink();
    expect(sink).toBeInstanceOf(AppRecordingSink);
    await sink.begin('video/mp4;codecs=avc1');
    await sink.append(new Blob([new Uint8Array([1, 2, 3])]));
    const result = await sink.finish('Ghost Arcade.mp4');
    expect(native.mock.calls.map((c) => c[1])).toEqual(['recordingBegin', 'recordingAppend', 'recordingFinish']);
    expect(native.mock.calls[0][2]).toMatchObject({ mimeType: 'video/mp4;codecs=avc1', sound: true });
    expect(native.mock.calls[1][2]).toEqual({ id: 'A', base64: 'AQID' });
    expect(result).toMatchObject({ id: 'A', bytes: 9_400_000, durationMs: 10_010, width: 1280, height: 720, mimeType: 'video/mp4', filename: 'Ghost Arcade.mp4' });
    expect(result.url).toBe('capacitor://localhost/_capacitor_file_/tmp/GhostRecordings/A/Ghost Arcade.mp4');
  });
  it('asks for the sound, tells the app when the video started, and reports the sound track', async () => {
    const native = app({ recordingBegin: { id: 'B', sound: 'player', recordsSound: true }, recordingFinish: { id: 'B', path: '/t/B/a.mp4', bytes: 1, durationMs: 10_000, width: 1280, height: 720, sound: true } });
    const sink = new AppRecordingSink();
    expect(await sink.begin('video/mp4')).toEqual({ source: 'player', recorded: true });
    const clock = (native.mock.calls[0][2] as { clock: number }).clock;
    expect(Math.abs(clock - (performance.timeOrigin + performance.now()))).toBeLessThan(1000);
    sink.videoStarted(clock + 40);
    const result = await sink.finish('a.mp4');
    expect(native.mock.calls.map((c) => c[1])).toEqual(['recordingBegin', 'recordingVideoStarted', 'recordingFinish']);
    expect(native.mock.calls[1][2]).toMatchObject({ id: 'B', at: clock + 40 });
    expect(result.sound).toBe(true);
  });
  it('a source the app cannot record comes back as such', async () => {
    app({ recordingBegin: { id: 'C', sound: 'phone', recordsSound: false } });
    expect(await new AppRecordingSink().begin('video/mp4')).toEqual({ source: 'phone', recorded: false });
    app({ recordingBegin: { id: 'D', sound: 'nonsense' } });
    expect(await new AppRecordingSink().begin('video/mp4')).toEqual({ source: 'off', recorded: false });
  });
  it('saves to Photos and shares through the app', async () => {
    const native = app({ recordingShare: { completed: true } });
    const result = { id: 'A', url: '', bytes: 1, durationMs: 1, width: 2, height: 2, mimeType: 'video/mp4', filename: 'a.mp4' };
    expect(await saveRecording(result)).toBe('photos');
    expect(await shareRecording(result)).toBe(true);
    expect(native.mock.calls.map((c) => [c[1], c[2]])).toEqual([['recordingSaveToPhotos', { id: 'A' }], ['recordingShare', { id: 'A' }]]);
  });
  it('an older app build without the methods records into memory instead', () => {
    app({}, ['haptic']);
    expect(canStoreRecordings()).toBe(false);
    expect(recordingSink()).toBeInstanceOf(MemoryRecordingSink);
  });
});

describe('the rest of the StudioOutput plugin', () => {
  it('opens the AirPlay picker at the tapped control', async () => {
    const native = app({ showRoutePicker: { shown: true, airplay: true, name: 'Living Room' } });
    expect(canPickRoute()).toBe(true);
    expect(await pickRoute({ x: 10.4, y: 20, width: 200, height: 44 })).toEqual({ shown: true, airplay: true, name: 'Living Room' });
    expect(native.mock.calls[0][2]).toEqual({ anchor: { x: 10, y: 20, width: 200, height: 44 } });
  });
  it('is quiet where the plugin is missing', async () => {
    app({}, []);
    expect(canPickRoute()).toBe(false);
    expect(await requestReview()).toBe(false);
    expect(() => presentMode(true)).not.toThrow();
    await expect(pickRoute()).rejects.toThrow(/latest version/);
  });
});

it('says plainly what sound a take will carry', () => {
  expect(soundLine('player', true)).toMatch(/Player/);
  expect(soundLine('mic', true)).toMatch(/microphone/);
  expect(soundLine('phone', true)).toBe("Sound from other apps can't be recorded, so this video will be silent.");
  expect(soundLine('off', true)).toMatch(/silent/);
  expect(soundLine('player', false)).toMatch(/silent/);
});

it('formats a length the way a phone shows it', () => {
  expect([0, 7_400, 62_000, 3_723_000].map(formatDuration)).toEqual(['0:00', '0:07', '1:02', '1:02:03']);
});
