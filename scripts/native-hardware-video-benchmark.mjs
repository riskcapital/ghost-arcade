#!/usr/bin/env node
// Rebuild the core first, then run on macOS or Windows with a real GPU:
// node scripts/native-hardware-video-benchmark.mjs --duration-seconds=8 --interval-ms=125
// Optional --output=/absolute/path/report.json persists the evidence.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createInterface } from 'node:readline';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [name, ...value] = arg.replace(/^--/, '').split('=');
  return [name, value.join('=')];
}));
const durationSeconds = Number(args['duration-seconds'] ?? 8);
const intervalMs = Number(args['interval-ms'] ?? 125);
if (!(durationSeconds > 0 && durationSeconds <= 120 && intervalMs >= 16)) {
  throw new Error('Use --duration-seconds in (0, 120] and --interval-ms >= 16');
}
const windows = process.platform === 'win32';
if (!windows && process.platform !== 'darwin') {
  throw new Error('This benchmark requires macOS VideoToolbox or Windows Media Foundation hardware decoding');
}
const rendererBackend = windows ? 'd3d12' : 'metal';
const decoderBackend = windows ? 'media-foundation' : 'videotoolbox';
const uploadTransport = windows ? 'native-video-dxgi' : 'native-video-iosurface';
const cpuUploadCounters = [
  'source_frame_input_bytes_uploaded', 'source_frame_cpu_fallback_uploads',
  'source_frame_file_uploads', 'source_frame_base64_uploads', 'source_frame_json_uploads',
];
const binary = join(process.cwd(), 'native-renderer/target/release',
  windows ? 'ghost-render-core.exe' : 'ghost-render-core');
if (!existsSync(binary)) throw new Error('Build the native core before running the hardware benchmark');
const directory = mkdtempSync(join(tmpdir(), 'ghost-hardware-trigger-benchmark-'));
let child;
let send;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
};

try {
  const uri = args.input ?? join(directory, 'bframes.mp4');
  if (!args.input) execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=256x144:rate=30:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '120', '-bf', '3',
    '-x264-params', 'b-adapt=0:scenecut=0', uri,
  ], { timeout: 15000 });
  const media = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name:format=duration', '-of', 'json', uri], { encoding: 'utf8' }));
  const clipDuration = Number(media.format.duration);
  child = spawn(binary, [], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, GA_NATIVE_VIDEO_BACKEND: 'hardware' },
  });
  let nextId = 0;
  let stderr = '';
  let stopped;
  const pending = new Map();
  const fail = error => {
    stopped = error;
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr = (stderr + data).slice(-16000); });
  child.on('error', fail);
  child.on('exit', (code, signal) => fail(new Error(`core exited ${code ?? signal}: ${stderr}`)));
  createInterface({ input: child.stdout }).on('line', line => {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.ok) request.resolve(message.result);
      else request.reject(new Error(`${message.error}: ${stderr}`));
    } catch (error) { fail(error); }
  });
  send = (method, params = {}, timeoutMs = 15000) => {
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
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => { if (error) fail(error); });
    });
  };
  const baseline = await send('start', { config: {
    backend: rendererBackend, width: Number(args.width ?? 512), height: Number(args.height ?? 288), source_frame_size: Number(args['source-size'] ?? 1024), target_fps: 60,
    native_quality_policy: 'fixed', decode_handoff_byte_cap_mb: Number(args['budget-mb'] ?? 256),
  } });
  if (!baseline.backend_ready || baseline.adapter_is_software) throw new Error(`${rendererBackend} hardware renderer is unavailable`);
  for (const counter of cpuUploadCounters) {
    if (typeof baseline[counter] !== 'number') throw new Error(`Missing required upload telemetry: ${counter}`);
  }
  const playback = (sourceId, generation) => ({
    source_id: sourceId, uri, source_type: 'video', time_seconds: 0,
    decode_width: 1024, decode_height: 576, playback_rate: 1, loop_enabled: true,
    duration_seconds: clipDuration, trim_start: 0, trim_end: 1, seek_generation: generation, seq: generation,
  });
  for (let row = 0; row < 4; row++) await send('prefetch_media', playback(`library:row-${row}:g1`, 1));
  const prerollDeadline = performance.now() + 15000;
  for (;;) {
    const status = await send('status');
    const ready = status.native_video_sessions.filter(session => session.state === 'prerolled');
    if (ready.length === 4) {
      if (ready.some(session => session.backend !== decoderBackend)) throw new Error('Preroll used a software decoder');
      break;
    }
    if (performance.now() > prerollDeadline) throw new Error(`Hardware preroll failed: ${JSON.stringify(status)}`);
    await sleep(20);
  }
  const commandsFor = generation => Array.from({ length: 4 }, (_, row) => {
    const x = row % 2 / 2;
    const y = Math.floor(row / 2) / 2;
    return [
      { type: 'upsert_layer', layer_id: `row-${row}`, opacity: 1, z_index: row, corners: {
        topLeft: { x, y: 1 - y }, topRight: { x: x + 0.5, y: 1 - y },
        bottomRight: { x: x + 0.5, y: 0.5 - y }, bottomLeft: { x, y: 0.5 - y },
      } },
      { type: 'set_media_source_playback', ...playback(`clip-${row}`, generation), paused: false },
      { type: 'bind_media_source', layer_id: `row-${row}`, source_id: `clip-${row}`, uri, source_type: 'video' },
    ];
  }).flat();
  await send('submit_commands', { commands: commandsFor(1) });
  // Include an initial presentation before timed retriggers so startup is
  // measured separately from the explicitly requested warm-trigger cadence.
  const firstDeadline = performance.now() + 15000;
  for (;;) {
    const snapshot = await send('output_shared_texture_snapshot');
    if (snapshot.nonzero_pixels > 0) break;
    if (performance.now() > firstDeadline) throw new Error('Initial hardware picture never reached the output');
    await sleep(10);
  }
  const samples = [];
  const triggerCount = Math.ceil(durationSeconds * 1000 / intervalMs);
  const started = performance.now();
  for (let index = 0; index < triggerCount; index++) {
    const scheduled = started + index * intervalMs;
    await sleep(Math.max(0, scheduled - performance.now()));
    const dispatched = performance.now();
    await send('submit_commands', { commands: commandsFor(index + 2) });
    const acknowledged = performance.now();
    const snapshot = await send('output_shared_texture_snapshot');
    const status = await send('status');
    const playing = status.native_video_sessions.filter(session => session.state === 'playing');
    if (playing.length !== 4 || playing.some(session => session.backend !== decoderBackend || session.frames_presented < 1)) {
      throw new Error(`Warm trigger lost a hardware session: ${JSON.stringify(status.native_video_sessions)}`);
    }
    if (status.native_video_software_frames !== 0 || status.native_video_hardware_fallbacks !== 0 ||
        !(status.native_video_hardware_frames > 0) || status.source_frame_last_upload_transport !== uploadTransport ||
        cpuUploadCounters.some(counter => status[counter] !== baseline[counter])) {
      throw new Error(`Warm trigger left the hardware texture path: ${JSON.stringify(status)}`);
    }
    if (snapshot.nonzero_pixels === 0) throw new Error(`Warm trigger ${index} presented a black output`);
    samples.push({
      trigger: index + 1, generation: index + 2, dispatched_ms: dispatched - started,
      lateness_ms: Math.max(0, dispatched - scheduled), command_ack_ms: acknowledged - dispatched,
      core_trigger_latency_us: status.native_video_trigger_last_latency_us,
      hardware_frames: status.native_video_hardware_frames, export_frame: snapshot.export_frame,
      checksum: snapshot.checksum, session_frames: playing.map(session => ({
        source_id: session.source_id, frames_presented: session.frames_presented,
      })),
    });
  }
  const finalStatus = await send('status');
  const cadence = samples.slice(1).map((sample, index) => sample.dispatched_ms - samples[index].dispatched_ms);
  const report = {
    captured_at: new Date().toISOString(), platform: process.platform, adapter: finalStatus.adapter_name,
    renderer_backend: rendererBackend, pixel_format: finalStatus.native_video_last_pixel_format,
    upload_transport: finalStatus.source_frame_last_upload_transport,
    input: args.input ?? 'generated testsrc2', media: media.streams[0],
    backend: decoderBackend, simultaneous_clips: 4, requested_interval_ms: intervalMs,
    requested_duration_seconds: durationSeconds, trigger_batches: samples.length,
    retriggers: samples.length * 4, elapsed_ms: performance.now() - started,
    cadence_ms: { median: percentile(cadence, 0.5), p95: percentile(cadence, 0.95), max: Math.max(0, ...cadence) },
    command_ack_ms: { median: percentile(samples.map(sample => sample.command_ack_ms), 0.5),
      p95: percentile(samples.map(sample => sample.command_ack_ms), 0.95),
      max: Math.max(...samples.map(sample => sample.command_ack_ms)) },
    max_dispatch_lateness_ms: Math.max(...samples.map(sample => sample.lateness_ms)),
    hardware_frames: finalStatus.native_video_hardware_frames,
    software_frames: finalStatus.native_video_software_frames,
    hardware_fallbacks: finalStatus.native_video_hardware_fallbacks,
    cpu_pixel_upload_bytes: finalStatus.source_frame_input_bytes_uploaded - baseline.source_frame_input_bytes_uploaded,
    cpu_upload_counter_deltas: Object.fromEntries(cpuUploadCounters.map(counter => [counter, finalStatus[counter] - baseline[counter]])),
    stream_underflows: finalStatus.native_video_stream_underflows,
    samples,
  };
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.output) writeFileSync(args.output, json);
  process.stdout.write(args.output ? `${JSON.stringify({ ...report, samples: undefined }, null, 2)}\n` : json);
} finally {
  if (send) { try { await send('shutdown', {}, 1000); } catch { /* already exited */ } }
  // A Windows decoder holds its input file open until process exit.
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise(resolve => {
      const done = () => {
        clearTimeout(timer);
        child.off('exit', done);
        resolve();
      };
      const timer = setTimeout(done, 2000);
      child.once('exit', done);
      child.kill();
    });
  }
  rmSync(directory, { recursive: true, force: true });
}
