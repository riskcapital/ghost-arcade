// Native clip audio in recordings: the core's post-mix tap, the recorder's
// FLAC/mux path, and equal-power audio fades that follow clip transitions.
// GA_CLIP_AUDIO_NULL_OUTPUT drives the real output callback without speakers.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';

const require = createRequire(import.meta.url);
const ffmpeg: string = process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
const { createNativeAudioTapSink, startNativeAudioTapRecording, buildRecordingMuxArgs } = require('../../../electron/native-audio-tap.cjs');
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RATE = 48000;
const WINDOW = 480; // 10 ms: 400 Hz and 1000 Hz both complete whole cycles.
const TONE_A = 400;
const TONE_B = 1000;
// lavfi sine peaks at 1/8; the clip decoder upmixes mono to stereo at -3 dB; voices play at gain 0.5.
const FULL = 0.125 * Math.SQRT1_2 * 0.5;

function core() {
  const child = spawn(platform.binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware', GA_CLIP_AUDIO_NULL_OUTPUT: '1', GA_FFMPEG_PATH: ffmpeg },
  });
  let nextId = 0, stderr = '', stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => { stopped = error; for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`native core exited (${code ?? signal}): ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result); else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch { /* non-JSON core output */ }
  });
  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 15000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, timeoutMs);
      pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  return {
    send,
    commands: (commands: Record<string, unknown>[]) => send('submit_commands', { commands }),
    async close() { try { await send('shutdown', {}, 1000); } catch { /* already exited */ } await closeNativeTestCore(child); },
  };
}

type Rpc = ReturnType<typeof core>;
type Voice = { id: string; source_id: string; gain: number; pan: number; row?: string; transition?: Record<string, unknown> };

/** Two looping tone clips on two layers, both decoding; only listed voices sound. */
async function startTwoTones(rpc: Rpc, dir: string) {
  const uris: Record<string, string> = {};
  for (const [id, freq] of [['tone-a', TONE_A], ['tone-b', TONE_B]] as const) {
    uris[id] = join(dir, `${id}.mp4`);
    execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=128x96:r=30:d=8',
      '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=48000:duration=8`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-shortest', uris[id]]);
  }
  await rpc.send('start', { config: { backend: platform.rendererBackend, width: 128, height: 96, target_fps: 60 } }, 20000);
  const mix = (voices: Voice[]) => ({ type: 'set_clip_audio_mix', sources: Object.values(uris), voices });
  await rpc.commands(Object.entries(uris).flatMap(([id, uri], index) => [
    { type: 'upsert_layer', layer_id: `layer-${id}`, opacity: 1, z_index: index, blend_mode: 'normal' },
    { type: 'bind_media_source', source_id: id, layer_id: `layer-${id}`, uri, source_type: 'video' },
    { type: 'set_media_source_playback', source_id: id, uri, source_type: 'video', duration_seconds: 8, time_seconds: 0, playback_rate: 1,
      trim_start: 0, trim_end: 1, loop_enabled: true, paused: false, seek_generation: 1 },
  ]));
  // Wait until both assets have decoded audio, then until A is heard.
  for (let i = 0; i < 200; i++) {
    await rpc.commands([mix([{ id: 'A:0:tone-a', source_id: 'tone-a', gain: 0.5, pan: 0 }])]);
    const status = await rpc.send('audio_status');
    if (status.running && status.peak_left > 0.02 && status.assets.every((a: any) => a.seconds_ready > 4)) return mix;
    await sleep(50);
  }
  throw new Error(`clip audio never started: ${JSON.stringify(await rpc.send('audio_status'))}`);
}

function interleaved(bytes: Buffer) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Float32Array(copy.buffer);
}
function decode(path: string) {
  return interleaved(execFileSync(ffmpeg, ['-v', 'error', '-i', path, '-map', '0:a:0', '-f', 'f32le', '-ac', '2', '-ar', String(RATE), 'pipe:1'], { maxBuffer: 256 * 1024 * 1024 }));
}
/** Amplitude of `freq` in the left channel over one 10 ms window. */
function level(samples: Float32Array, window: number, freq: number) {
  let re = 0, im = 0;
  for (let i = 0; i < WINDOW; i++) {
    const x = samples[(window * WINDOW + i) * 2] ?? 0;
    const phase = 2 * Math.PI * freq * i / RATE;
    re += x * Math.cos(phase); im -= x * Math.sin(phase);
  }
  return 2 * Math.hypot(re, im) / WINDOW;
}
/** Window index at wall-clock `unixMs`, for audio whose frame 0 is `originMs`. */
const windowAt = (unixMs: number, originMs: number) => Math.floor((unixMs - originMs) / 10);
const mean = (values: number[]) => values.reduce((sum, v) => sum + v, 0) / values.length;

const suite = platform.runnable ? describe : describe.skip;
suite('Native clip audio recording tap', () => {
  it('records the device mix with frame timestamps and muxes it into the MP4 at the right time', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghost-audio-tap-'));
    const rpc = core();
    try {
      const mix = await startTwoTones(rpc, dir);
      const recording = await startNativeAudioTapRecording({ ffmpegPath: ffmpeg, directory: join(dir, 'tap'),
        startCore: (sink: unknown) => rpc.send('audio_tap_start', sink as Record<string, unknown>), stopCore: () => rpc.send('audio_tap_stop') });
      expect(recording.started).toMatchObject({ sample_rate: RATE, channels: 2, format: 'f32le' });
      await sleep(1200);
      const switchAt = Date.now();
      await rpc.commands([mix([{ id: 'A:0:tone-b', source_id: 'tone-b', gain: 0.5, pan: 0 }])]);
      await sleep(1300);
      const stoppedAt = Date.now();
      const tap = await recording.stop();
      expect(tap).not.toBeNull();
      expect(tap.dropped).toBe(0);
      expect(tap.rate).toBe(RATE);
      // Continuous timeline: one tap frame per output frame since the tap started.
      expect(tap.frames / RATE * 1000).toBeGreaterThan(stoppedAt - tap.startedUnixMs - 150);
      expect(tap.frames / RATE * 1000).toBeLessThan(stoppedAt - tap.startedUnixMs + 150);

      const samples = decode(tap.path);
      // No read-position discontinuities: a pure tone's second difference stays tiny.
      let discontinuities = 0;
      for (let i = RATE * 0.3; i < RATE; i++) if (Math.abs(samples[i * 2] - 2 * samples[i * 2 - 2] + samples[i * 2 - 4]) > 0.004) discontinuities++;
      expect(discontinuities).toBe(0);
      const origin = tap.startedUnixMs;
      const switchWindow = windowAt(switchAt, origin);
      const before = Array.from({ length: switchWindow - 30 }, (_, i) => i + 20);
      const after = Array.from({ length: windowAt(stoppedAt, origin) - switchWindow - 40 }, (_, i) => switchWindow + 20 + i);
      // The tap carries exactly what the device plays.
      expect(mean(before.map(w => level(samples, w, TONE_A)))).toBeCloseTo(FULL, 2);
      expect(Math.max(...before.map(w => level(samples, w, TONE_B)))).toBeLessThan(0.004);
      expect(mean(after.map(w => level(samples, w, TONE_B)))).toBeCloseTo(FULL, 2);
      expect(Math.max(...after.map(w => level(samples, w, TONE_A)))).toBeLessThan(0.004);
      const heard = Array.from({ length: 60 }, (_, i) => switchWindow - 10 + i)
        .find(w => level(samples, w, TONE_B) > level(samples, w, TONE_A))!;
      // The switch lands where the command was sent, plus the mixer's ~21 ms lookahead.
      expect((heard - switchWindow) * 10).toBeGreaterThanOrEqual(-10);
      expect((heard - switchWindow) * 10).toBeLessThanOrEqual(150);

      // End to end: a video that began 0.5 s into the tap gets the aligned track.
      const video = join(dir, 'video.mp4');
      const output = join(dir, 'recording.mp4');
      execFileSync(ffmpeg, ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red:s=128x96:r=30:d=2.4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
      const videoStartUnixMs = origin + 500;
      execFileSync(ffmpeg, buildRecordingMuxArgs({ videoPath: video, outputPath: output, tap, videoStartUnixMs, audioBitrate: 192000 }));
      let probe = '';
      try { execFileSync(ffmpeg, ['-hide_banner', '-i', output], { stdio: 'pipe' }); } catch (error: any) { probe = String(error.stderr); }
      expect(probe).toMatch(/Audio: aac .*48000 Hz, stereo/);
      expect(probe).toMatch(/Video: h264/);
      const muxed = decode(output);
      // The tap ran ~2.5 s and 0.5 s preceded the video; -shortest ends with the tap.
      expect(muxed.length / 2 / RATE).toBeGreaterThan((stoppedAt - videoStartUnixMs) / 1000 - 0.15);
      const muxedSwitch = windowAt(switchAt, videoStartUnixMs);
      const muxedHeard = Array.from({ length: 80 }, (_, i) => muxedSwitch - 20 + i).find(w => level(muxed, w, TONE_B) > level(muxed, w, TONE_A))!;
      expect((muxedHeard - muxedSwitch) * 10).toBeGreaterThanOrEqual(-30);
      expect((muxedHeard - muxedSwitch) * 10).toBeLessThanOrEqual(170);
      expect(level(muxed, muxedSwitch - 40, TONE_A)).toBeGreaterThan(0.8 * FULL);
      expect(level(muxed, muxedSwitch + 40, TONE_B)).toBeGreaterThan(0.8 * FULL);
    } finally { await rpc.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 60000);

  it('crossfades a 2 s transition at equal power and cuts a 0 s transition', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghost-audio-fade-'));
    const rpc = core();
    try {
      const mix = await startTwoTones(rpc, dir);
      const chunks: Float32Array[] = [];
      const sink = await createNativeAudioTapSink({ onChunk: async ({ pcm }: { pcm: Buffer }) => { chunks.push(interleaved(pcm)); } });
      const started = await rpc.send('audio_tap_start', { port: sink.port, token: sink.token });
      const underflowsBefore = (await rpc.send('audio_status')).underflow_frames;
      await sleep(600);
      const fade = (role: 'in' | 'out', token: number, duration: number) => ({ role, token, duration, running: true });
      const fadeAt = Date.now();
      await rpc.commands([mix([
        { id: 'A:0:tone-a', source_id: 'tone-a', gain: 0.5, pan: 0, row: 'A:0', transition: fade('out', 900, 2) },
        { id: 'A:0:tone-b', source_id: 'tone-b', gain: 0.5, pan: 0, row: 'A:0', transition: fade('in', 900, 2) },
      ])]);
      await sleep(2700);
      const cutAt = Date.now();
      await rpc.commands([mix([
        { id: 'A:0:tone-a', source_id: 'tone-a', gain: 0.5, pan: 0, row: 'A:0', transition: fade('in', 901, 0) },
        { id: 'A:0:tone-b', source_id: 'tone-b', gain: 0.5, pan: 0, row: 'A:0', transition: fade('out', 901, 0) },
      ])]);
      await sleep(500);
      const stopped = await rpc.send('audio_tap_stop');
      expect((await rpc.send('audio_status')).underflow_frames).toBe(underflowsBefore);
      const stats = await sink.ended;
      await sink.close();
      expect(stats.dropped).toBe(0);
      expect(stopped.dropped).toBe(0);
      const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
      chunks.reduce((offset, c) => { samples.set(c, offset); return offset + c.length; }, 0);

      const origin = started.started_unix_ms;
      const a = (w: number) => level(samples, w, TONE_A);
      const b = (w: number) => level(samples, w, TONE_B);
      const f0 = windowAt(fadeAt, origin);
      const full = mean(Array.from({ length: f0 - 20 }, (_, i) => a(i + 10)));
      expect(full).toBeCloseTo(FULL, 2);
      const fadeWindows = Array.from({ length: 240 }, (_, i) => f0 + i);
      const cross = (series: (w: number) => number, threshold: number, rising: boolean) =>
        fadeWindows.find(w => rising ? series(w) >= threshold * full : series(w) <= threshold * full)!;
      // Equal power: the summed power stays at the pre-fade level throughout.
      for (const w of fadeWindows) expect((a(w) ** 2 + b(w) ** 2) / full ** 2).toBeGreaterThan(0.85);
      for (const w of fadeWindows) expect((a(w) ** 2 + b(w) ** 2) / full ** 2).toBeLessThan(1.15);
      // sin/cos over 2 s: 10% -> 90% of full takes (asin(.9) - asin(.1)) * 4 / PI = 1.298 s.
      const expected10to90 = (Math.asin(0.9) - Math.asin(0.1)) * 4 / Math.PI;
      const inRise = (cross(b, 0.9, true) - cross(b, 0.1, true)) / 100;
      const outFall = (cross(a, 0.1, false) - cross(a, 0.9, false)) / 100;
      expect(inRise).toBeGreaterThan(expected10to90 - 0.06);
      expect(inRise).toBeLessThan(expected10to90 + 0.06);
      expect(outFall).toBeGreaterThan(expected10to90 - 0.06);
      expect(outFall).toBeLessThan(expected10to90 + 0.06);
      // The fade starts with the command and is complete 2 s later: 2 s total.
      const start = (cross(b, 0.1, true) / 100) - Math.asin(0.1) * 4 / Math.PI;
      expect(start - f0 / 100).toBeGreaterThan(-0.02);
      expect(start - f0 / 100).toBeLessThan(0.15);
      const midpoint = cross(b, Math.SQRT1_2, true);
      expect(a(midpoint) / full).toBeGreaterThan(0.62);
      expect(a(midpoint) / full).toBeLessThan(0.8);
      const end = Math.round((start + 2) * 100);
      expect(b(end + 5) / full).toBeGreaterThan(0.97);
      expect(a(end + 5) / full).toBeLessThan(0.03);
      // 0 s: a cut, not a fade. Only the mixer's 3 ms de-click ramp remains, so
      // 10% -> 90% spans at most two 10 ms windows (vs 130 for the 2 s fade).
      const c0 = windowAt(cutAt, origin);
      const cutWindows = Array.from({ length: 40 }, (_, i) => c0 - 5 + i);
      const aUp = cutWindows.find(w => a(w) >= 0.9 * full)!, aStart = cutWindows.find(w => a(w) >= 0.1 * full)!;
      const bDown = cutWindows.find(w => b(w) <= 0.1 * full)!, bStart = cutWindows.find(w => b(w) <= 0.9 * full)!;
      expect(aUp - aStart).toBeLessThanOrEqual(2);
      expect(bDown - bStart).toBeLessThanOrEqual(2);
      expect(Math.abs(bDown - aUp)).toBeLessThanOrEqual(2);
    } finally { await rpc.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 60000);
});
