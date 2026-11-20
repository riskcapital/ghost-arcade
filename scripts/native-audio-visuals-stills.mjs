/**
 * Stills and GPU cost for the audio-reactive native instruments (Strands,
 * Cloud Pulse), rendered by the real core exactly as the app drives it.
 *
 *   node scripts/native-audio-visuals-stills.mjs --plan plan.json --out <dir> [--only name]
 *
 * plan.json:
 *   { "wav": "track.wav", "fps": 60, "width": 1920, "height": 1080,
 *     "shots": [ { "name", "kind": "strands" | "cloud-pulse", "params": {..},
 *                  "ply": "cloud.ply" (Cloud Pulse: becomes params.path),
 *                  "wav": "other.wav" (optional, per shot),
 *                  "at": [seconds, ..], "perfSeconds": 4 } ] }
 *
 * Audio goes through the editor's own code: the file is decoded here, the
 * offline analyser (`offlineFileAudio.ts`) produces each frame's analysis on
 * the render clock, and `audioVisualData.ts` packs it into the same
 * `set_audio_spectrum.visual_b64` the app sends. Frames are stepped on the
 * core's manual (offline render) clock, so a still at `at` seconds is the
 * same picture on every run. `perfSeconds` then measures the layer on the
 * live clock with audio fed in real time (the core's GPU timestamp cost).
 */
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const planPath = path.resolve(argValue('plan', ''));
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const planDir = path.dirname(planPath);
const outDir = path.resolve(argValue('out', path.join(root, 'reports', 'audio-visuals')));
const only = argValue('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const fps = Number(plan.fps ?? 60);
const width = Number(plan.width ?? 1920);
const height = Number(plan.height ?? 1080);
const executable = path.join(root, 'native-renderer', 'target', 'release',
  process.platform === 'win32' ? 'ghost-render-core.exe' : 'ghost-render-core');

/* ── WAV ───────────────────────────────────────────────────────────────── */
function readWavMono(file) {
  const buf = readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV`);
  let offset = 12;
  let format = null;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === 'fmt ') {
      format = {
        tag: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        rate: buf.readUInt32LE(body + 4),
        bits: buf.readUInt16LE(body + 14),
      };
    } else if (id === 'data' && format) {
      const { channels, bits, tag } = format;
      const bytes = bits / 8;
      const frames = Math.floor(size / (bytes * channels));
      const mono = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) {
          const at = body + (f * channels + c) * bytes;
          if (tag === 3 && bits === 32) sum += buf.readFloatLE(at);
          else if (bits === 16) sum += buf.readInt16LE(at) / 32768;
          else if (bits === 24) sum += buf.readIntLE(at, 3) / 8388608;
          else if (bits === 32) sum += buf.readInt32LE(at) / 2147483648;
        }
        mono[f] = sum / channels;
      }
      return { mono, rate: format.rate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error(`${file}: no PCM data`);
}

/* ── PNG ───────────────────────────────────────────────────────────────── */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function writePng(file, w, h, rgba) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4;
      const d = y * (w * 3 + 1) + 1 + x * 3;
      raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  writeFileSync(file, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]));
}
/** Snapshot (top row first, BGRA or RGBA) -> RGBA rows, plus corner lumas
 *  so orientation can be checked without opening the file. */
function snapshotPixels(snap) {
  const w = Number(snap.width);
  const h = Number(snap.height);
  const padded = Number(snap.padded_bytes_per_row || snap.bytes_per_row || w * 4);
  const src = Buffer.from(String(snap.rgba_b64 || ''), 'base64');
  const out = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) src.copy(out, y * w * 4, y * padded, y * padded + w * 4);
  if (/Bgra/i.test(String(snap.format || ''))) {
    for (let i = 0; i < out.length; i += 4) {
      const b = out[i];
      out[i] = out[i + 2];
      out[i + 2] = b;
    }
  }
  return { w, h, out };
}

/* ── RPC ───────────────────────────────────────────────────────────────── */
const child = spawn(executable, [], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, RUST_BACKTRACE: '1' } });
let stderrTail = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (text) => { stderrTail = (stderrTail + text).slice(-4000); });
child.on('exit', (code, signal) => {
  if (code || signal) console.error(`render core exited (${code ?? signal})\n${stderrTail.slice(-2000)}`);
});
child.stdin.on('error', () => {});
const pending = new Map();
let nextId = 1;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  let message;
  try { message = JSON.parse(line); } catch { return; }
  const waiter = pending.get(message.id);
  if (!waiter) return;
  pending.delete(message.id);
  clearTimeout(waiter.timer);
  if (message.ok) waiter.resolve(message.result);
  else waiter.reject(new Error(message.error || 'native RPC failed'));
});
function rpc(method, params = {}, timeoutMs = 30_000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timed out: ${method}\n${stderrTail}`)); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const submit = (commands, timeoutMs) => rpc('submit_commands', { commands }, timeoutMs);

const FULLSCREEN = { topLeft: { x: 0, y: 1 }, topRight: { x: 1, y: 1 }, bottomRight: { x: 1, y: 0 }, bottomLeft: { x: 0, y: 0 } };

let vite;
const results = [];
mkdirSync(outDir, { recursive: true });
try {
  vite = await createServer({ root, server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  const offline = await vite.ssrLoadModule('/src/lib/audio/offlineFileAudio.ts');
  const packing = await vite.ssrLoadModule('/src/lib/audio/audioVisualData.ts');

  await rpc('start', {
    config: {
      backend: process.platform === 'darwin' ? 'metal' : process.platform === 'win32' ? 'd3d12' : 'vulkan',
      width, height, target_fps: 60, native_quality_policy: 'fixed', present_mode: 'vsync', max_frame_latency: 1,
    },
  }, 30_000);

  const tracks = new Map();
  const track = (file) => {
    const resolved = path.resolve(planDir, file);
    if (!tracks.has(resolved)) tracks.set(resolved, readWavMono(resolved));
    return tracks.get(resolved);
  };

  for (const shot of plan.shots) {
    if (only.length && !only.some((o) => shot.name.includes(o))) continue;
    const { mono, rate } = track(shot.wav ?? plan.wav);
    const layerId = `avfx-${shot.name}`;
    const sourceId = `avfx:${shot.name}:out`;
    // Cloud Pulse reads its PLY itself (bounded, on a worker thread).
    const params = { ...(shot.params ?? {}) };
    if (shot.ply) params.path = path.resolve(planDir, shot.ply);
    await submit([
      { type: 'upsert_layer', layer_id: layerId, z_index: 0, blend_mode: 'normal', opacity: 1, corners: FULLSCREEN },
      { type: 'set_layer_visibility', layer_id: layerId, visible: true },
      { type: 'set_native_graph_layer', layer_id: layerId, kind: shot.kind, instrument_source_id: sourceId,
        composite_source_id: sourceId, input_source_id: null, effect_graph: null, params },
    ]);
    // Let the pipelines compile on the live clock before the timed run.
    await delay(2500);

    const analyzer = new offline.OfflineFileAudioAnalyzer(mono, rate);
    const packer = packing.createAudioVisualPacker({ sampleRate: rate });
    const shots = [...(shot.at ?? [])].sort((a, b) => a - b);
    const lastFrame = Math.round((shots.at(-1) ?? 0) * fps);
    const wanted = new Map(shots.map((t) => [Math.round(t * fps), t]));
    const step = 1 / fps;
    for (let frame = 0; frame <= lastFrame; frame++) {
      const t = frame * step;
      const visual = packer.encode(analyzer.frameAt(t), t);
      await submit([
        { type: 'set_render_clock', mode: 'manual', time: t, time_delta: step, frame_index: frame },
        { type: 'set_audio_spectrum', active: false, ...(visual ? { visual_b64: visual } : {}) },
      ]);
      const take = wanted.has(frame);
      // The offline render's own call: steps every graph by exactly one frame
      // at `t`, then reads the composite back (BGRA, top row first).
      const rawPath = path.join(outDir, '.frame.raw');
      const snap = await rpc('export_frame_snapshot', { path: rawPath, time: t, frame_index: frame, step_seconds: step }, 60_000);
      if (take) {
        const raw = readFileSync(rawPath);
        const { w, h, out } = snapshotPixels({ ...snap, rgba_b64: raw.toString('base64'),
          padded_bytes_per_row: raw.length / Number(snap.height) });
        const file = path.join(outDir, `${shot.name}-${wanted.get(frame).toFixed(2)}s.png`);
        writePng(file, w, h, out);
        const lum = (x, y) => { const i = (y * w + x) * 4; return Math.round(0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2]); };
        let sum = 0;
        let clipped = 0;
        for (let i = 0; i < out.length; i += 4) {
          const l = 0.2126 * out[i] + 0.7152 * out[i + 1] + 0.0722 * out[i + 2];
          sum += l;
          if (l >= 250) clipped++;
        }
        const row = {
          name: shot.name, at: wanted.get(frame), png: file, size: `${w}x${h}`,
          mean_luma: Number((sum / (w * h)).toFixed(2)), clipped_pct: Number(((clipped / (w * h)) * 100).toFixed(3)),
          corners: { tl: lum(4, 4), tr: lum(w - 5, 4), bl: lum(4, h - 5), br: lum(w - 5, h - 5) },
        };
        results.push(row);
        console.log(`${path.basename(file)}  luma ${row.mean_luma}  clipped ${row.clipped_pct}%`);
      }
    }
    const status = await rpc('status');
    if (String(status.last_shader_error || '').length) console.log(`  core: ${status.last_shader_error}`);
    if (args.includes('--debug')) console.log(`  stderr: ${stderrTail.slice(-1500)}`);

    if (shot.perfSeconds) {
      await submit([{ type: 'set_render_clock', mode: 'reset' }]);
      const livePacker = packing.createAudioVisualPacker({ sampleRate: rate });
      const liveAnalyzer = new offline.OfflineFileAudioAnalyzer(mono, rate);
      const started = performance.now();
      const duration = mono.length / rate;
      let feeding = true;
      const feed = (async () => {
        while (feeding) {
          const t = ((performance.now() - started) / 1000) % duration;
          const visual = livePacker.encode(liveAnalyzer.frameAt(t), (performance.now() - started) / 1000);
          if (visual) await submit([{ type: 'set_audio_spectrum', active: false, visual_b64: visual }]).catch(() => {});
          await delay(16);
        }
      })();
      await delay(1500);
      const before = await rpc('status');
      const samples = [];
      const t0 = performance.now();
      while (performance.now() - t0 < shot.perfSeconds * 1000) {
        await delay(250);
        const s = await rpc('status');
        const g = Number(s.last_render_gpu_ms || 0);
        if (g > 0) samples.push(g);
      }
      const after = await rpc('status');
      feeding = false;
      await feed;
      samples.sort((a, b) => a - b);
      const elapsed = (performance.now() - t0) / 1000;
      const perf = {
        name: shot.name,
        gpu_ms_median: Number((samples[Math.floor(samples.length / 2)] ?? 0).toFixed(3)),
        gpu_ms_p90: Number((samples[Math.floor(samples.length * 0.9)] ?? 0).toFixed(3)),
        completed_fps: Number(((Number(after.gpu_frames_completed || 0) - Number(before.gpu_frames_completed || 0)) / elapsed).toFixed(1)),
        cpu_ms_ema: Number(Number(after.avg_render_cpu_ms || 0).toFixed(3)),
        adapter: after.adapter_name,
      };
      results.push(perf);
      console.log(`  perf: gpu ${perf.gpu_ms_median} ms (p90 ${perf.gpu_ms_p90})  ${perf.completed_fps} fps  cpu ${perf.cpu_ms_ema} ms`);
    }
    await submit([{ type: 'remove_layer', layer_id: layerId }]);
    await delay(300);
  }
  writeFileSync(path.join(outDir, 'results.json'), JSON.stringify(results, null, 2));
} finally {
  await vite?.close().catch(() => {});
  await rpc('shutdown', {}, 2_000).catch(() => {});
  child.stdin.end();
}
