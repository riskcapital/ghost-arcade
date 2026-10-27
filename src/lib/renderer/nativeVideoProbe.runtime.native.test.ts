// The render core says how a video file will play before it plays:
// hardware (VideoToolbox / Media Foundation), HAP, software (ffmpeg, with the
// reason), or not at all. Run after rebuilding the core.
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { closeNativeTestCore, hardwareTestPlatform as platform } from './nativeHardwareTestPlatform';
import { checkDecodeCapabilities } from '../video/decodeCapabilities';

const requireCjs = createRequire(import.meta.url);

const probeDescribe = platform.runnable && !platform.linux ? describe : describe.skip;

function core() {
  const child = spawn(platform.binary, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  let stderr = '';
  const pending = new Map<number, { resolve(value: any): void; reject(error: Error): void }>();
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('exit', (code, signal) => {
    for (const request of pending.values()) request.reject(new Error(`core exited (${code ?? signal}): ${stderr}`));
    pending.clear();
  });
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    const message = JSON.parse(line);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(`${message.error}: ${stderr}`));
  });
  const send = (method: string, params: Record<string, unknown> = {}, timeoutMs = 30000): Promise<any> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out: ${stderr}`)); }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };
  return {
    send,
    async close() {
      try { await send('shutdown', {}, 1000); } catch { /* already exited */ }
      await closeNativeTestCore(child);
    },
  };
}

probeDescribe(`${platform.label} video probe`, () => {
  let directory: string;
  let rpc: ReturnType<typeof core>;
  const file = (name: string) => join(directory, name);
  const ffmpeg = (args: string[]) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { timeout: 30000 });

  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), 'ghost-video-probe-'));
    ffmpeg(['-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file('h264.mp4')]);
    // Transparency: the hardware path refuses it, ffmpeg keeps the alpha.
    ffmpeg(['-f', 'lavfi', '-i', 'color=c=red@0.4:s=64x64:r=10:d=1,format=rgba',
      '-c:v', 'prores_ks', '-profile:v', '4', '-pix_fmt', 'yuva444p10le', file('alpha.mov')]);
    writeFileSync(file('not-a-video.mp4'), 'this is text, not video');
    rpc = core();
    const status = await rpc.send('start', { config: { backend: platform.rendererBackend, width: 128, height: 72, target_fps: 30 } });
    expect(status.backend_ready).toBe(true);
    const capabilities = await rpc.send('get_capabilities');
    expect(capabilities.implemented_methods).toContain('probe_video');
  }, 60000);

  afterAll(async () => {
    await rpc?.close();
    if (directory) rmSync(directory, { recursive: true, force: true });
  });

  it('reports hardware decoding for ordinary H.264', async () => {
    const probe = await rpc.send('probe_video', { uri: file('h264.mp4') });
    expect(probe).toMatchObject({ backend: platform.decoderBackend, hardware: true, reverse_supported: true,
      width: 320, height: 180, uri: file('h264.mp4') });
    expect(probe.duration_seconds).toBeCloseTo(1, 1);
  });

  it('reports software decoding, with the reason, for video the hardware decoder refuses', async () => {
    const probe = await rpc.send('probe_video', { uri: file('alpha.mov') });
    expect(probe.backend).toBe('ffmpeg');
    expect(probe.hardware).toBe(false);
    expect(probe.reverse_supported).toBe(false);
    // macOS's decoder takes ProRes but not its alpha; Windows' hardware
    // decoder takes no ProRes at all, so the codec is the reason there.
    expect(probe.reason).toMatch(platform.windows ? /compatibility decoder|alpha|transparen/i : /alpha|transparen/i);
    expect(probe.codec).toMatch(/^prores/);
    expect([probe.width, probe.height]).toEqual([64, 64]);
  });

  it('reports files that cannot play, and missing files', async () => {
    const broken = await rpc.send('probe_video', { uri: file('not-a-video.mp4') });
    expect(broken.backend).toBe('failed');
    expect(broken.reason).not.toBe('');
    const missing = await rpc.send('probe_video', { uri: file('gone.mp4') });
    expect(missing).toMatchObject({ backend: 'failed', reason: 'The file was not found' });
  });

  it('reports what plays in hardware for the Settings decoding panel (not what Chromium claims)', async () => {
    const { ensureDecodeTestClips } = requireCjs('../../../electron/decode-test-clips.cjs');
    const ffmpegStatic: string = requireCjs('ffmpeg-static');
    const clips = await ensureDecodeTestClips(ffmpegStatic, join(directory, 'decode-check'));
    expect(clips.map((clip: { id: string }) => clip.id)).toEqual(expect.arrayContaining(['h264', 'hevc', 'prores', 'vp9']));
    const rows = await checkDecodeCapabilities({
      clips: async () => clips,
      probe: (uri: string) => rpc.send('probe_video', { uri }),
    });
    const verdict = (id: string) => rows.find(row => row.id === id);
    expect(verdict('h264')).toMatchObject({ state: 'hardware', verdict: 'Hardware' });
    // The core never decodes VP9 in hardware, whatever Chromium says.
    expect(verdict('vp9')).toMatchObject({ state: 'software', verdict: 'Software — may lag' });
    expect(verdict('vp9')?.reason).toMatch(/VP9/);
    for (const row of rows) expect(row.state).not.toBe('unknown');
  }, 120000);

  it('answers status while probes run', async () => {
    const probes = Array.from({ length: 4 }, () => rpc.send('probe_video', { uri: file('h264.mp4') }));
    const status = await rpc.send('status', {}, 5000);
    expect(status.running).toBe(true);
    for (const probe of await Promise.all(probes)) expect(probe.hardware).toBe(true);
  });
});
