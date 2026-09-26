import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  COMPOSITION_SOURCE,
  listRecordingSources,
  mergeRecordingCodecAvailability,
  RECORDING_CODEC_OPTIONS,
  recordingCodecOption,
  recordingRequest,
  recordingSourceKey,
  recordTargetParams,
  resolveRecordingSourceChoice,
  vjRowLayerIds,
} from './recordingSources';

const require = createRequire(import.meta.url);
const formats = require('../../../electron/recording-formats.cjs');
const { buildRecordingMuxArgs } = require('../../../electron/native-audio-tap.cjs');

const base = ['-hide_banner', '-loglevel', 'warning', '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra',
  '-s:v', '1920x1080', '-framerate', '60', '-i', 'pipe:0', '-an'];
const args = (codec: string, extra: Record<string, unknown> = {}) => formats.recordingEncoderArgs({
  codec, width: 1920, height: 1080, fps: 60, quality: 'high', outputPath: '/tmp/out', ...extra,
});
const after = (list: string[], flag: string) => list[list.indexOf(flag) + 1];

describe('recording encoder arguments', () => {
  it('keeps the H.264 arguments the recorder always used', () => {
    expect(args('h264', { platform: 'darwin' })).toEqual([...base,
      '-c:v', 'h264_videotoolbox', '-b:v', '20M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '/tmp/out']);
    expect(args('h264', { platform: 'win32' })).toEqual([...base,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'fast', '-movflags', '+faststart', '/tmp/out']);
    // An unknown codec id falls back to H.264, never to an empty encode.
    expect(args('nope', { platform: 'darwin' })).toEqual(args('h264', { platform: 'darwin' }));
  });

  it('writes ProRes 4444 with a 4:4:4 alpha plane, hardware or software', () => {
    const hw = args('prores_4444', { hardwareProRes: true });
    expect(after(hw, '-c:v')).toBe('prores_videotoolbox');
    expect(after(hw, '-profile:v')).toBe('4444');
    expect(after(hw, '-vf')).toContain('format=ayuv64le');
    const sw = args('prores_4444');
    expect(after(sw, '-c:v')).toBe('prores_ks');
    expect(after(sw, '-pix_fmt')).toBe('bgra'); // input
    expect(sw.slice(sw.indexOf('-c:v'))).toContain('yuva444p10le');
    for (const list of [hw, sw]) {
      expect(after(list, '-vf')).toContain('out_color_matrix=bt709');
      expect(after(list, '-colorspace')).toBe('bt709');
      expect(list.at(-1)).toBe('/tmp/out');
    }
  });

  it('writes ProRes 422 HQ and HAP with the padding their formats need', () => {
    expect(after(args('prores_hq', { hardwareProRes: true }), '-profile:v')).toBe('hq');
    expect(after(args('prores_hq'), '-profile:v')).toBe('3');
    const hap = args('hap_alpha');
    expect(after(hap, '-c:v')).toBe('hap');
    expect(after(hap, '-format')).toBe('hap_alpha');
    expect(after(hap, '-vf')).toContain('pad=ceil(iw/4)*4:ceil(ih/4)*4');
    expect(after(args('hap'), '-format')).toBe('hap');
  });

  it('passes offline frame counts and pixel formats through', () => {
    const offline = args('prores_hq', { totalFrames: 300, pixelFormat: 'rgba' });
    expect(after(offline, '-frames:v')).toBe('300');
    expect(after(offline, '-pix_fmt')).toBe('rgba');
  });

  it('records software ProRes at 30 fps and everything else at the asked rate', () => {
    expect(formats.liveRecordingFps('prores_4444', 60, false)).toBe(30);
    expect(formats.liveRecordingFps('prores_4444', 60, true)).toBe(60);
    expect(formats.liveRecordingFps('h264', 60, false)).toBe(60);
    expect(formats.liveRecordingFps('hap_alpha', 90, false)).toBe(60);
  });
});

describe('recording codec availability', () => {
  const encoders = formats.parseEncoderList([
    ' V....D libx264              libx264 H.264',
    ' VFS... prores_ks            Apple ProRes (iCodec Pro) (codec prores)',
    ' A....D aac                  AAC',
  ].join('\n'));

  it('offers only what the ffmpeg build can encode', () => {
    expect([...encoders]).toEqual(['libx264', 'prores_ks']);
    const list = formats.recordingCodecAvailability(encoders);
    const byId = Object.fromEntries(list.map((entry: any) => [entry.id, entry]));
    expect(byId.h264.available).toBe(true);
    expect(byId.prores_4444.available).toBe(true);
    expect(byId.hap_alpha.available).toBe(false);
    expect(byId.hap_alpha.reason).toMatch(/hap/);
    // Hardware ProRes alone is enough for ProRes.
    const hwOnly = formats.recordingCodecAvailability(new Set(['h264_videotoolbox']), { hardwareProRes: true });
    expect(hwOnly.find((entry: any) => entry.id === 'prores_hq').available).toBe(true);
  });

  it('keeps the renderer list in step with the main-process list', () => {
    expect(RECORDING_CODEC_OPTIONS.map(({ id, extension, alpha, mime }) => ({ id, extension, alpha, mime })))
      .toEqual(formats.RECORDING_CODECS.map(({ id, extension, alpha, mime }: any) => ({ id, extension, alpha, mime })));
    const merged = mergeRecordingCodecAvailability([{ id: 'prores_4444', available: true }, { id: 'future', available: true }]);
    expect(merged.map(codec => codec.available)).toEqual([true, false, true, false, false]);
    expect(mergeRecordingCodecAvailability(null)[0]).toMatchObject({ id: 'h264', available: true });
  });
});

describe('recording sources', () => {
  const sources = listRecordingSources({
    vjLayers: [{ index: 0, name: 'Tunnel' }, { index: 1 }],
    layers: [{ id: 'logo', name: 'Logo' }, { id: 'cut', name: 'Cut', type: 'mask' }],
    screens: [{ id: 's1', name: 'Left' }, { id: 's2', name: 'Right' }, { id: 's3', name: 'Off', enabled: false }],
  });

  it('lists the composition, VJ layers, layers and enabled Screens', () => {
    expect(sources.map(option => option.label)).toEqual([
      'Composition', 'VJ Layer 1 · Tunnel', 'VJ Layer 2', 'Logo', 'Left output', 'Right output',
    ]);
    expect(sources[1].source).toEqual({ kind: 'layer', layerIds: vjRowLayerIds(0), label: 'VJ Layer 1' });
    expect(vjRowLayerIds(3)).toEqual(['vj-layer-3', 'vj-layer-3-A', 'vj-layer-3-B']);
  });

  it('falls back to the composition when the chosen source is gone', () => {
    expect(resolveRecordingSourceChoice({ kind: 'screen', sliceId: 's2' }, sources)).toMatchObject({ sliceId: 's2' });
    expect(resolveRecordingSourceChoice({ kind: 'layer', layerIds: ['deleted'] }, sources)).toBe(COMPOSITION_SOURCE);
    expect(resolveRecordingSourceChoice(null, sources)).toBe(COMPOSITION_SOURCE);
    expect(recordingSourceKey({ kind: 'layer', layerIds: ['a', 'b'] })).toBe('layer:a|b');
  });

  it('routes each source and codec to the right capture and record target', () => {
    const layer = { kind: 'layer' as const, layerIds: ['logo'], label: 'Logo' };
    expect(recordingRequest(COMPOSITION_SOURCE, 'h264')).toMatchObject({ captureSource: 'output', alpha: false });
    expect(recordingRequest(COMPOSITION_SOURCE, 'prores_4444')).toMatchObject({ captureSource: 'record_target', alpha: true });
    expect(recordingRequest(layer, 'hap_alpha')).toMatchObject({ captureSource: 'record_target', alpha: true, label: 'Logo' });
    expect(recordingRequest(layer, 'prores_hq')).toMatchObject({ alpha: false });
    // A Screen is what its projector shows: opaque even with an alpha codec.
    expect(recordingRequest({ kind: 'screen', sliceId: 's2' }, 'prores_4444'))
      .toMatchObject({ captureSource: 'slice:s2', alpha: false });
    expect(recordTargetParams(layer, true)).toEqual({ kind: 'layer', layer_ids: ['logo'], alpha: true });
    expect(recordTargetParams(COMPOSITION_SOURCE, true)).toEqual({ kind: 'composition', alpha: true });
    expect(recordTargetParams(COMPOSITION_SOURCE, false)).toBeNull();
    expect(recordingCodecOption('prores_4444').extension).toBe('mov');
  });

  it('agrees with the main process on what each source reads', () => {
    expect(formats.resolveRecordingSource(COMPOSITION_SOURCE, 'h264')).toMatchObject({ kind: 'output' });
    expect(formats.resolveRecordingSource(COMPOSITION_SOURCE, 'prores_4444'))
      .toMatchObject({ kind: 'record_target', target: recordTargetParams(COMPOSITION_SOURCE, true) });
    const layer = { kind: 'layer', layerIds: vjRowLayerIds(1) };
    expect(formats.resolveRecordingSource(layer, 'hap_alpha').target)
      .toEqual(recordTargetParams(layer as any, true));
    expect(formats.resolveRecordingSource({ kind: 'screen', sliceId: 's2' }, 'h264')).toMatchObject({ kind: 'screen', sliceId: 's2' });
    expect(() => formats.resolveRecordingSource({ kind: 'screen' }, 'h264')).toThrow(/Screen/);
    expect(() => formats.resolveRecordingSource({ kind: 'layer', layerIds: [] }, 'h264')).toThrow(/layer/);
  });
});

describe('recording audio mux', () => {
  it('keeps MP4 audio as AAC and gives MOV masters PCM', () => {
    const tap = { path: '/tmp/tap.flac', startedUnixMs: 1000 };
    const mp4 = buildRecordingMuxArgs({ videoPath: '/v.mp4', outputPath: '/v.mp4.muxed.mp4', sidecarPath: '/a.webm', audioBitrate: 192000 });
    expect(after(mp4, '-c:a')).toBe('aac');
    expect(after(mp4, '-b:a')).toBe('192k');
    const mov = buildRecordingMuxArgs({ videoPath: '/v.mov', outputPath: '/v.mov.muxed.mov', tap, videoStartUnixMs: 1000 });
    expect(after(mov, '-c:a')).toBe('pcm_s16le');
    expect(after(mov, '-c:v')).toBe('copy');
    expect(mov).not.toContain('-b:a');
  });
});
