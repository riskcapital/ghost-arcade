import { createRequire } from 'node:module';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
const { createTapParser, createNativeAudioTapSink, buildRecordingMuxArgs, tapOffsetSeconds } =
  createRequire(import.meta.url)('../../../electron/native-audio-tap.cjs');

function chunk(frameIndex: number, samples: number[], dropped = 0, rate = 48000) {
  const header = Buffer.alloc(32);
  header.write('GATP', 0);
  header.writeUInt32LE(rate, 4);
  header.writeUInt32LE(samples.length / 2, 8);
  header.writeBigUInt64LE(BigInt(frameIndex), 16);
  header.writeBigUInt64LE(BigInt(dropped), 24);
  const pcm = Buffer.alloc(samples.length * 4);
  samples.forEach((value, index) => pcm.writeFloatLE(value, index * 4));
  return Buffer.concat([header, pcm]);
}

describe('native clip audio tap transport', () => {
  it('reassembles chunks split at any byte and rejects gaps', async () => {
    const received: number[] = [];
    const parse = createTapParser(async ({ pcm }: { pcm: Buffer }) => {
      for (let i = 0; i < pcm.length; i += 4) received.push(pcm.readFloatLE(i));
    });
    const stream = Buffer.concat([chunk(0, [0.5, -0.5, 0.25, -0.25]), chunk(2, [1, -1], 3)]);
    for (let i = 0; i < stream.length; i += 7) await parse(stream.subarray(i, i + 7));
    expect(received).toEqual([0.5, -0.5, 0.25, -0.25, 1, -1]);
    await expect(parse(chunk(9, [0, 0]))).rejects.toThrow(/out of order/);
    await expect(createTapParser(async () => {})(Buffer.alloc(40))).rejects.toThrow(/Invalid audio tap chunk/);
  });

  it('accepts only the authenticated connection and reports frames and drops', async () => {
    const frames: number[] = [];
    const sink = await createNativeAudioTapSink({ onChunk: async ({ frames: count }: { frames: number }) => { frames.push(count); } });
    const intruder = net.connect(sink.port, '127.0.0.1', () => intruder.write('0'.repeat(64)));
    await new Promise(resolve => intruder.on('close', resolve));
    const socket = net.connect(sink.port, '127.0.0.1', () => {
      socket.write(sink.token);
      socket.write(chunk(0, new Array(960 * 2).fill(0.1)));
      socket.end(chunk(960, new Array(480 * 2).fill(0), 480));
    });
    const stats = await sink.ended;
    expect(frames).toEqual([960, 480]);
    expect(stats).toMatchObject({ frames: 1440, dropped: 480, rate: 48000, error: null });
    await sink.close();
  });

  it('aligns the tap to video frame 0 and mixes it with the sidecar at unity gain', () => {
    const tap = { path: '/tmp/tap.flac', startedUnixMs: 10_000, latencyMs: 20 };
    expect(tapOffsetSeconds(tap, 10_520)).toBeCloseTo(0.5);
    const both = buildRecordingMuxArgs({ videoPath: 'v.mp4', outputPath: 'o.mp4', sidecarPath: 's.webm', tap, videoStartUnixMs: 10_520, audioBitrate: 128000 });
    expect(both.join(' ')).toContain('-i v.mp4 -i s.webm -i /tmp/tap.flac');
    expect(both[both.indexOf('-filter_complex') + 1]).toBe('[2:a]atrim=start=0.500000,asetpts=PTS-STARTPTS[tap];[1:a:0][tap]amix=inputs=2:duration=longest:normalize=0[aout]');
    expect(both.join(' ')).toContain('-map 0:v:0 -map [aout] -c:v copy -c:a aac -b:a 128k');
    // A tap that started after the video gets leading silence.
    const late = buildRecordingMuxArgs({ videoPath: 'v.mp4', outputPath: 'o.mp4', tap: { ...tap, latencyMs: 0 }, videoStartUnixMs: 9_750 });
    expect(late[late.indexOf('-filter_complex') + 1]).toBe('[1:a]adelay=delays=250:all=1[aout]');
    // Sidecar only: unchanged from before the tap existed.
    const sidecar = buildRecordingMuxArgs({ videoPath: 'v.mp4', outputPath: 'o.mp4', sidecarPath: 's.webm' });
    expect(sidecar).not.toContain('-filter_complex');
    expect(sidecar.join(' ')).toContain('-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k');
    expect(() => buildRecordingMuxArgs({ videoPath: 'v.mp4', outputPath: 'o.mp4' })).toThrow(/No audio/);
  });
});
