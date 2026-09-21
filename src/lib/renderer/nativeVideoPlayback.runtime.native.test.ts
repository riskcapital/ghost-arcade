import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const binary = join(process.cwd(), 'native-renderer/target/release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');
const nativeDescribe = existsSync(binary) ? describe : describe.skip;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function core(backend?: 'software' | 'hardware') {
  const child = spawn(binary, [], { env: backend ? { ...process.env, GA_NATIVE_VIDEO_BACKEND: backend } : process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0;
  let buffer = '';
  let stderr = '';
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-8000); });
  child.stdout.on('data', data => {
    buffer += data;
    let newline: number;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(message.error));
    }
  });
  child.on('exit', code => {
    for (const request of pending.values()) request.reject(new Error(`core exited ${code}: ${stderr}`));
    pending.clear();
  });
  const send = (method: string, params: Record<string, unknown> = {}): Promise<any> => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${method} timed out: ${stderr}`));
      }, 15000);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
    });
  };
  return {
    send,
    commands: (commands: Record<string, unknown>[]) => send('submit_commands', { commands }),
    async close() {
      try { await send('shutdown'); } finally { child.kill(); }
    },
  };
}

type Core = ReturnType<typeof core>;
async function waitUntil<T>(read: () => Promise<T>, ready: (value: T) => boolean, label: string): Promise<T> {
  const deadline = Date.now() + 10000;
  let value: T;
  do {
    value = await read();
    if (ready(value)) return value;
    await sleep(15);
  } while (Date.now() < deadline);
  throw new Error(`${label}: ${JSON.stringify(value)}`);
}

async function start(rpc: Core, config: Record<string, unknown> = {}) {
  await rpc.send('start', { config: {
    backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
    width: 64, height: 36, source_frame_size: 64, target_fps: 60,
    ...config,
  } });
}

const layer = (id = 'video-layer') => ({ type: 'upsert_layer', layer_id: id, opacity: 1, z_index: 0,
  corners: { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 },
    bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } } });

nativeDescribe('native video startup and handoff', () => {
  let directory: string;
  let uri: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'ghost-video-startup-'));
    uri = join(directory, 'framecode.mp4');
    // 60 uniquely coloured frames, one keyframe. The first second is red,
    // the second blue, with a green ramp to identify motion within each half.
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
      '-i', 'color=c=black:s=64x36:r=30:d=2', '-vf',
      "geq=r='if(lt(N,30),220,16)':g='16+3*mod(N,30)':b='if(lt(N,30),16,220)'",
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '1000', '-sc_threshold', '0', uri]);
  });
  afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

  const playback = (source_id: string, time_seconds = 0) => ({
    source_id, uri, source_type: 'video', time_seconds, decode_width: 64, decode_height: 36,
    playback_rate: 1, loop_enabled: true, duration_seconds: 2, trim_start: 0, trim_end: 1,
    seek_generation: 1, seq: 1,
  });
  const bind = (source_id: string) => ({ type: 'bind_media_source', layer_id: 'video-layer',
    source_id, uri, source_type: 'video' });
  const arm = async (rpc: Core, source_id: string, time = 0) => {
    await rpc.send('prefetch_media', playback(source_id, time));
    await waitUntil(() => rpc.send('status'), status => status.native_video_sessions.some(
      (session: any) => session.source_id === source_id && session.state === 'prerolled'), 'preroll');
  };

  it('late scene prefetch cannot pause or replace a triggered warm session', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await arm(rpc, 'library:clip:g1');
      await rpc.commands([layer(), { type: 'set_media_source_playback', ...playback('clip'), paused: false }, bind('clip')]);
      const before = await rpc.send('status');
      expect(before.native_video_sessions.find((s: any) => s.source_id === 'clip')?.frames_presented).toBeGreaterThan(0);
      // The normal scene sync arrives after the urgent trigger, using an old
      // seek generation. It is a warm-up hint, never a transport command.
      const after = await rpc.send('prefetch_media', { ...playback('clip'), seek_generation: 0 });
      expect(after.native_video_sessions.find((s: any) => s.source_id === 'clip')?.state).toBe('playing');
      expect(after.native_video_sessions.find((s: any) => s.source_id === 'clip')?.frames_presented)
        .toBeGreaterThanOrEqual(before.native_video_sessions.find((s: any) => s.source_id === 'clip').frames_presented);
    } finally { await rpc.close(); }
  });

  it('does not resurrect evicted prerolls and churn the Windows decoder pool', async () => {
    const rpc = core();
    try {
      await start(rpc);
      for (let row = 0; row < 17; row++) {
        await rpc.commands([layer(`paused-${row}`),
          { type: 'set_media_source_playback', ...playback(`paused-${row}`), paused: true },
          { ...bind(`paused-${row}`), layer_id: `paused-${row}` }]);
      }
      for (let index = 0; index < 16; index++) await rpc.send('prefetch_media', playback(`library:next-${index}:g1`));
      const before = await waitUntil(() => rpc.send('status'), status =>
        status.native_video_sessions.length === 32 && status.native_video_sessions
          .filter((s: any) => s.source_id.startsWith('library:'))
          .every((s: any) => s.state === 'prerolled'), 'bounded pool prepared');
      await sleep(500);
      const after = await rpc.send('status');
      expect(after.native_video_session_evictions).toBe(before.native_video_session_evictions);
      expect(after.native_video_sessions).toHaveLength(32);
      expect(after.native_video_sessions.filter((s: any) => s.source_id.startsWith('library:')).every((s: any) => s.state === 'prerolled')).toBe(true);
    } finally { await rpc.close(); }
  }, 20000);

  it('restarts all three column rows from prepared frames without independent decoder seeks', async () => {
    const rpc = core();
    try {
      await start(rpc);
      const rows = [0, 1, 2];
      const launch = (generation: number) => rows.flatMap(row => [
        layer(`row-${row}`),
        { type: 'set_media_source_playback', ...playback(`clip-${row}`), seek_generation: generation, seq: generation, paused: false },
        { ...bind(`clip-${row}`), layer_id: `row-${row}` },
      ]);
      for (const row of rows) await arm(rpc, `library:clip-${row}:g1`);
      await rpc.commands(launch(1));
      for (const row of rows) await arm(rpc, `library:clip-${row}:g2`);
      await rpc.commands(launch(2));
      // Inspect immediately after the one command batch, without polling for
      // stragglers. All three must have presented a frame of the new seek.
      const status = await rpc.send('status');
      const playing = status.native_video_sessions.filter((session: any) => session.state === 'playing');
      expect(playing).toHaveLength(3);
      expect(playing.every((session: any) => session.seek_generation === 2 && session.frames_presented > 0)).toBe(true);
      expect(status.native_video_sessions.filter((session: any) => session.source_id.startsWith('library:'))).toHaveLength(0);
      const ready = await Promise.all(rows.map(row => rpc.send('get_source_frame_readiness', { source_id: `clip-${row}`, seek_generation: 2 })));
      expect(ready.every(result => result.ready)).toBe(true);
    } finally { await rpc.close(); }
  }, 20000);

  it('keeps a twelve-video grid warm and launches its oldest column without cold decoders', async () => {
    const rpc = core('hardware');
    try {
      await start(rpc);
      const clips = Array.from({ length: 12 }, (_, index) => {
        const file = join(directory, `grid-${index}.mp4`);
        copyFileSync(uri, file);
        return { ...playback(`clip-${index}`), uri: file };
      });
      for (const [index, clip] of clips.entries()) {
        const id = `library:grid-${index}:g1`;
        await rpc.send('prefetch_media', { ...clip, source_id: id });
        await waitUntil(() => rpc.send('status'), s => s.native_video_sessions.some(
          (v: any) => v.source_id === id && v.state === 'prerolled'), 'grid preroll');
      }
      expect((await rpc.send('status')).native_video_sessions.filter((s: any) => s.state === 'prerolled')).toHaveLength(12);
      // Row-major loading made the first column's earlier rows the oldest
      // preparations. Unique URIs prevent accidentally claiming another clip.
      for (const column of [0, 1, 2, 3]) {
        const incoming = [clips[column], clips[4 + column], clips[8 + column]];
        await rpc.commands(incoming.flatMap((clip, row) => [layer(`grid-row-${row}`),
          { type: 'set_media_source_playback', ...clip, paused: false },
          { ...bind(clip.source_id), uri: clip.uri, layer_id: `grid-row-${row}` },
        ]));
        const ready = await Promise.all(incoming.map(clip => rpc.send('get_source_frame_readiness', {
          source_id: clip.source_id, seek_generation: 1,
        })));
        expect(ready.every(value => value.ready)).toBe(true);
      }
      const status = await rpc.send('status');
      expect(status.native_video_hardware_fallbacks).toBe(0);
      expect(status.native_video_frame_decode_failures).toBe(0);
    } finally { await rpc.close(); }
  }, 30000);

  it('does not claim preroll from a different playhead position', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await arm(rpc, 'library:clip:g1', 1);
      await rpc.commands([layer(), { type: 'set_media_source_playback', ...playback('clip'), paused: false }, bind('clip')]);
      await waitUntil(() => rpc.send('status'), status => status.native_video_sessions.some(
        (s: any) => s.source_id === 'clip' && s.frames_presented > 0), 'first frame');
      const frame = await rpc.send('frame_snapshot');
      expect(frame.mean_rgba[0]).toBeGreaterThan(0.7);
      expect(frame.mean_rgba[2]).toBeLessThan(0.15);
    } finally { await rpc.close(); }
  });

  it('hands off preparation already in flight when a clip is triggered immediately after loading', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await rpc.send('prefetch_media', playback('library:early:g1'));
      // Deliberately do not wait for preroll. The trigger must consume the
      // same session even when ffmpeg has not delivered any pixels yet.
      await rpc.commands([layer(), { type: 'set_media_source_playback', ...playback('early'), paused: false }, bind('early')]);
      const status = await rpc.send('status');
      expect(status.native_video_sessions.map((s: any) => s.source_id)).toEqual(['early']);
      await waitUntil(() => rpc.send('status'), next => next.native_video_sessions.some(
        (s: any) => s.source_id === 'early' && s.frames_presented > 0), 'early trigger first frame');
      const frame = await rpc.send('frame_snapshot');
      expect(frame.mean_rgba[0]).toBeGreaterThan(0.7);
    } finally { await rpc.close(); }
  });

  it('keeps a separate prepared session for each library clip and consumes only the triggered one', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await arm(rpc, 'library:first:g1');
      await arm(rpc, 'library:second:g1');
      const armed = await rpc.send('status');
      expect(armed.native_video_sessions.filter((s: any) => s.state === 'prerolled')).toHaveLength(2);
      await rpc.commands([layer(), { type: 'set_media_source_playback', ...playback('clip'), paused: false }, bind('clip')]);
      const status = await rpc.send('status');
      expect(status.native_video_sessions.filter((s: any) => s.state === 'playing')).toHaveLength(1);
      expect(status.native_video_sessions.filter((s: any) => s.source_id.startsWith('library:'))).toHaveLength(1);
    } finally { await rpc.close(); }
  });

  it('shows no placeholder on an empty row while a video has no decoded frame', async () => {
    const rpc = core();
    try {
      await start(rpc);
      // No decoder: this makes the not-ready state deterministic.
      await rpc.commands([layer(), bind('not-ready'), { type: 'present' }]);
      const frame = await rpc.send('frame_snapshot');
      expect(frame.mean_rgba.slice(0, 3)).toEqual([0, 0, 0]);
    } finally { await rpc.close(); }
  });

  it('reclaims unused preroll when a full decode budget would block a live trigger', async () => {
    const rpc = core('software');
    try {
      await start(rpc, { decode_handoff_byte_cap_mb: 12 });
      const largePlayback = (id: string, time = 0) => ({
        ...playback(id, time), decode_width: 512, decode_height: 288,
      });
      for (let index = 0; index < 3; index++) {
        await rpc.send('prefetch_media', largePlayback(`library:budget-${index}:g1`));
      }
      await waitUntil(() => rpc.send('status'), status => status.native_video_sessions.filter(
        (s: any) => s.state === 'prerolled').length === 3, 'full preroll pool');
      // A different in-point prevents a warm claim. The new live decoder
      // must displace unused preroll instead of remaining blank forever.
      await rpc.commands([layer(), { type: 'set_media_source_playback', ...largePlayback('live', 0.5), paused: false }, bind('live')]);
      const status = await waitUntil(() => rpc.send('status'), next => next.native_video_sessions.some(
        (s: any) => s.source_id === 'live' && s.frames_presented > 0), 'budgeted live trigger');
      expect(status.native_video_session_evictions).toBeGreaterThan(0);
      expect(status.native_video_sessions.reduce((sum: number, s: any) => sum + s.reserved_bytes, 0))
        .toBeLessThanOrEqual(12 * 1024 * 1024);
    } finally { await rpc.close(); }
  }, 15000);

  it('keeps four playing rows and all four next triggers prepared within a bounded budget', async () => {
    const rpc = core();
    try {
      await start(rpc, { decode_handoff_byte_cap_mb: 32 });
      const sized = (id: string) => ({ ...playback(id), decode_width: 512, decode_height: 288 });
      for (let index = 0; index < 4; index++) {
        await rpc.send('prefetch_media', sized(`library:row-${index}:g1`));
      }
      await waitUntil(() => rpc.send('status'), status => status.native_video_sessions.filter(
        (s: any) => s.state === 'prerolled').length === 4, 'four prepared rows');
      const commands = Array.from({ length: 4 }, (_, index) => [
        layer(`row-${index}`),
        { type: 'set_media_source_playback', ...sized(`clip-${index}`), paused: false },
        { ...bind(`clip-${index}`), layer_id: `row-${index}` },
      ]).flat();
      await rpc.commands(commands);
      for (let index = 0; index < 4; index++) {
        await rpc.send('prefetch_media', sized(`library:row-${index}:g2`));
      }
      const status = await waitUntil(() => rpc.send('status'), next => next.native_video_sessions.filter(
        (s: any) => s.state === 'prerolled').length === 4, 'four next triggers prepared');
      expect(status.native_video_sessions.filter((s: any) => s.state === 'playing')).toHaveLength(4);
      expect(status.native_video_sessions.reduce((sum: number, s: any) => sum + s.reserved_bytes, 0))
        .toBeLessThanOrEqual(32 * 1024 * 1024);
      expect(status.native_video_stream_underflows).toBe(0);
      await rpc.commands(commands.map(command => command.type === 'set_media_source_playback'
        ? { ...command, seek_generation: 2, seq: 2 } : command));
      const retriggered = await rpc.send('status');
      const playing = retriggered.native_video_sessions.filter((s: any) => s.state === 'playing');
      expect(playing).toHaveLength(4);
      expect(playing.every((s: any) => s.frames_presented > 0)).toBe(true);
      expect(retriggered.native_video_stream_underflows).toBe(0);
    } finally { await rpc.close(); }
  }, 15000);

  it('plays at source cadence through three loop seams without restarting or freezing', async () => {
    const rpc = core();
    try {
      await start(rpc);
      await arm(rpc, 'library:loop:g1');
      await rpc.commands([layer(), { type: 'set_media_source_playback', ...playback('loop'), paused: false }, bind('loop')]);
      const started = Date.now();
      let previousHalf = 'red';
      let previousChecksum = '';
      let lastChange = started;
      let longestHold = 0;
      let seams = 0;
      while (Date.now() - started < 6250) {
        // Keep the core's demand-driven status publication current.
        await rpc.send('status');
        const frame = await rpc.send('frame_snapshot');
        const half = frame.mean_rgba[0] > frame.mean_rgba[2] ? 'red' : 'blue';
        if (previousHalf === 'blue' && half === 'red') seams++;
        previousHalf = half;
        if (frame.checksum !== previousChecksum) {
          longestHold = Math.max(longestHold, Date.now() - lastChange);
          lastChange = Date.now();
          previousChecksum = frame.checksum;
        }
        await sleep(45);
      }
      const status = await rpc.send('status');
      const session = status.native_video_sessions.find((s: any) => s.source_id === 'loop');
      expect(seams).toBe(3);
      expect(longestHold).toBeLessThan(250);
      // Readbacks compete with presentation under load. Count the source
      // frames consumed, including ones skipped to keep the clock on time.
      const consumed = session.frames_presented + session.frames_dropped;
      expect(consumed).toBeGreaterThan(180);
      expect(consumed).toBeLessThan(205);
      expect(status.native_video_stream_underflows).toBe(0);
    } finally { await rpc.close(); }
  }, 15000);
});
