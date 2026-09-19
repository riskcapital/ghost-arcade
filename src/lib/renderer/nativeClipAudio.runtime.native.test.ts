import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
const binary = platform.binary;
type Command = Record<string, unknown>;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
function core() {
  const child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
  let nextId = 0;
  let stderr = '';
  let stopped: Error | undefined;
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  const fail = (error: Error) => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
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
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) {
      fail(new Error(`invalid native core response: ${String(error)}: ${line}`));
    }
  });
  const send = (method: string, params: Command = {}, timeoutMs = 15000): Promise<any> => {
    if (stopped) return Promise.reject(stopped);
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (error) fail(error);
      });
    });
  };
  return {
    send,
    commands: (commands: Command[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

const suite = platform.runnable ? describe : describe.skip;
suite('Native clip audio output', () => {
  it('decodes audio, follows video direction, balances channels and silences on pause/stop', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ghost-audio-test-'));
    const uri = join(dir, 'tone.mp4');
    const rpc = core();
    async function until(predicate: (s: any) => boolean) {
      let status: any;
      for (let i = 0; i < 120; i++) { status = await rpc.send('audio_status'); if (predicate(status)) return status; await sleep(50); }
      throw new Error(`Audio state did not settle: ${JSON.stringify(status)}`);
    }
    const voice = (pan = 0, gain = .02) => ({ type: 'set_clip_audio_mix', sources: [uri], voices: [{ id: 'tone', source_id: 'tone', gain, pan }] });
    const play = (extra = {}) => ({ type: 'set_media_source_playback', source_id: 'tone', uri, source_type: 'video', duration_seconds: 4,
      time_seconds: 0, playback_rate: 1, trim_start: 0, trim_end: 1, loop_enabled: true, paused: false, seek_generation: 1, ...extra });
    try {
      execFileSync(process.env.GA_FFMPEG_PATH || 'ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=128x96:r=30:d=4',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', uri]);
      await rpc.send('start', { config: { backend: platform.rendererBackend, width: 128, height: 96, target_fps: 60 } });
      expect(await rpc.send('audio_devices')).toBeInstanceOf(Array);
      await rpc.commands([voice(), { type: 'upsert_layer', layer_id: 'layer', opacity: 1, z_index: 0, blend_mode: 'normal' },
        { type: 'bind_media_source', source_id: 'tone', layer_id: 'layer', uri, source_type: 'video' }, play()]);
      const audible = await until(s => s.running && s.peak_left > .0001 && s.peak_right > .0001);
      expect(audible.assets[0].seconds_ready).toBeGreaterThan(0);
      expect(audible.voices[0].rate).toBeGreaterThan(0);
      await rpc.commands([voice(1)]);
      await until(s => s.peak_left < .00001 && s.peak_right > .0001);
      await rpc.commands([play({ playback_rate: -1, time_seconds: 3, seek_generation: 2 })]);
      await until(s => s.voices[0]?.rate < 0 && s.peak_right > .0001);
      await rpc.commands([play({ playback_rate: 1, time_seconds: 3.95, bounce_enabled: true, seek_generation: 3 })]);
      await until(s => s.voices[0]?.rate < 0 && s.peak_right > .0001);
      await rpc.commands([play({ paused: true, time_seconds: 1, seek_generation: 4 })]);
      await until(s => s.peak_left === 0 && s.peak_right === 0);
      await rpc.commands([play({ time_seconds: 1, playback_rate: 1.5, seek_generation: 5 })]);
      await until(s => s.voices[0]?.rate > 1.4 && s.peak_right > .0001);
      const stable = await rpc.send('audio_status');
      await sleep(1000);
      const after = await rpc.send('audio_status');
      expect(after.callbacks).toBeGreaterThan(stable.callbacks);
      expect(after.underflow_frames - stable.underflow_frames).toBe(0);
      await rpc.send('stop');
      await until(s => s.peak_left === 0 && s.peak_right === 0);
    } finally { await rpc.close(); rmSync(dir, { recursive: true, force: true }); }
  }, 45000);
});
