// Recording tap for native clip audio: the core streams its post-mix device
// signal to this loopback sink, which encodes it losslessly until the
// recording stops. Same token handshake as native-frame-stream.cjs.
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { randomBytes, timingSafeEqual } = require('node:crypto');

const HEADER_BYTES = 32;
const MAGIC = Buffer.from('GATP');

/** Chunk stream: 'GATP', rate u32, frames u32, reserved u32, first frame
 *  index u64, cumulative dropped frames u64, then frames * 2 f32le samples.
 *  Indices must be continuous; the core pads gaps with silence. */
function createTapParser(onChunk) {
  let pending = Buffer.alloc(0);
  let nextIndex = 0;
  let rate = 0;
  return async (data) => {
    pending = pending.length ? Buffer.concat([pending, data]) : data;
    while (pending.length >= HEADER_BYTES) {
      if (!pending.subarray(0, 4).equals(MAGIC)) throw new Error('Invalid audio tap chunk');
      const chunkRate = pending.readUInt32LE(4);
      const frames = pending.readUInt32LE(8);
      if (!chunkRate || chunkRate > 384000 || frames > chunkRate * 60) throw new Error('Invalid audio tap chunk header');
      if (rate && chunkRate !== rate) throw new Error('Audio tap sample rate changed mid-recording');
      const size = HEADER_BYTES + frames * 8;
      if (pending.length < size) break;
      const frameIndex = Number(pending.readBigUInt64LE(16));
      const dropped = Number(pending.readBigUInt64LE(24));
      if (frameIndex !== nextIndex) throw new Error(`Audio tap chunk out of order: ${frameIndex} after ${nextIndex}`);
      const pcm = pending.subarray(HEADER_BYTES, size);
      pending = pending.subarray(size);
      rate = chunkRate;
      nextIndex += frames;
      await onChunk({ rate, frameIndex, frames, dropped, pcm });
    }
  };
}

async function createNativeAudioTapSink({ onChunk }) {
  const token = randomBytes(32).toString('hex');
  const stats = { frames: 0, dropped: 0, rate: 0, error: null };
  let owner = null, closed = false, resolveEnded;
  const ended = new Promise(resolve => { resolveEnded = resolve; });
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (closed || owner || sockets.size >= 2) { socket.destroy(); return; }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    (async () => {
      let header = Buffer.alloc(0), authenticated = false;
      const parse = createTapParser(async chunk => {
        stats.frames = chunk.frameIndex + chunk.frames; stats.dropped = chunk.dropped; stats.rate = chunk.rate;
        await onChunk(chunk);
      });
      try {
        for await (let chunk of socket) {
          if (!authenticated) {
            const need = 64 - header.length;
            header = Buffer.concat([header, chunk.subarray(0, need)]);
            chunk = chunk.subarray(need);
            if (header.length < 64) continue;
            if (!timingSafeEqual(header, Buffer.from(token)) || owner) throw new Error('Invalid audio tap token');
            owner = socket; authenticated = true;
          }
          if (chunk.length) await parse(chunk);
        }
      } catch (error) {
        if (authenticated) stats.error = error?.message || String(error);
        socket.destroy();
      } finally {
        if (owner === socket) { owner = null; resolveEnded(stats); }
      }
    })();
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return {
    port: server.address().port,
    token,
    stats: () => ({ ...stats }),
    /** Resolves when the core closes its connection (after audio_tap_stop). */
    ended,
    async close() {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      resolveEnded(stats);
      await new Promise(resolve => server.close(resolve));
    },
  };
}

function writeStdin(child, bytes) {
  return new Promise((resolve, reject) => {
    if (!child.stdin || child.stdin.destroyed) { reject(new Error('Audio tap encoder closed')); return; }
    child.stdin.write(bytes, error => (error ? reject(error) : resolve()));
  });
}

/**
 * One recording's tap: sink -> FLAC file in `directory`. `startCore` and
 * `stopCore` issue audio_tap_start / audio_tap_stop to the native core.
 * stop() resolves to { path, rate, frames, dropped, startedUnixMs,
 * latencyMs } or null when nothing was captured.
 */
async function startNativeAudioTapRecording({ ffmpegPath, directory, startCore, stopCore, endTimeoutMs = 5000 }) {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, 'clip-audio.flac');
  let encoder = null, encoderExit = null, encoderError = '';
  const sink = await createNativeAudioTapSink({
    onChunk: async ({ rate, pcm }) => {
      if (!encoder) {
        encoder = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(rate), '-ac', '2',
          '-i', 'pipe:0', '-c:a', 'flac', filePath], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
        encoder.stderr.setEncoding('utf8');
        encoder.stderr.on('data', text => { encoderError = (encoderError + text).slice(-4000); });
        encoder.stdin.on('error', () => {});
        encoderExit = new Promise(resolve => { encoder.on('error', error => { encoderError += String(error); resolve(-1); }); encoder.on('close', code => resolve(code)); });
      }
      await writeStdin(encoder, pcm);
    },
  });
  let started;
  try {
    started = await startCore({ port: sink.port, token: sink.token });
  } catch (error) {
    await sink.close();
    throw error;
  }
  let stopped = null;
  const finish = async (keep) => {
    let core = null;
    try { core = await stopCore(); } catch { /* the core may already be gone */ }
    await Promise.race([sink.ended, new Promise(resolve => setTimeout(resolve, endTimeoutMs))]);
    await sink.close();
    const stats = sink.stats();
    if (encoder) {
      try { encoder.stdin.end(); } catch { /* already closed */ }
      if (!keep) try { encoder.kill(); } catch { /* exited */ }
    }
    const code = encoderExit ? await encoderExit : null;
    if (!keep || !encoder || code !== 0 || stats.frames <= 0) {
      try { fs.rmSync(directory, { recursive: true, force: true }); } catch { /* best-effort */ }
      if (keep && encoder && code !== 0) throw new Error(`Clip audio encoder failed: ${encoderError.trim() || `exit ${code}`}`);
      return null;
    }
    return {
      path: filePath,
      directory,
      rate: stats.rate,
      frames: stats.frames,
      dropped: Number(core?.dropped ?? stats.dropped) || 0,
      startedUnixMs: Number(core?.started_unix_ms ?? started?.started_unix_ms) || 0,
      latencyMs: Number(core?.latency_ms ?? started?.latency_ms) || 0,
      error: stats.error || core?.error || null,
    };
  };
  return {
    started,
    stop() { stopped ??= finish(true); return stopped; },
    cancel() { stopped ??= finish(false); return stopped; },
  };
}

/** Seconds of tap audio before the first video frame (negative: the tap
 *  started late and needs leading silence). A tap frame reaches listeners
 *  latencyMs after the device callback that the tap timestamp records. */
function tapOffsetSeconds(tap, videoStartUnixMs) {
  return (videoStartUnixMs - tap.startedUnixMs - (tap.latencyMs || 0)) / 1000;
}

/** ffmpeg arguments that copy the video and write one AAC track: the
 *  renderer's sidecar (mic, browser audio), the native tap, or both mixed
 *  at unity gain. */
function buildRecordingMuxArgs({ videoPath, outputPath, sidecarPath = null, tap = null, videoStartUnixMs = 0, audioBitrate = 192000 }) {
  if (!sidecarPath && !tap) throw new Error('No audio to mux');
  const args = ['-hide_banner', '-loglevel', 'warning', '-y', '-i', videoPath];
  if (sidecarPath) args.push('-i', sidecarPath);
  let audioMap = '1:a:0';
  if (tap) {
    const tapInput = sidecarPath ? 2 : 1;
    args.push('-i', tap.path);
    const offset = tapOffsetSeconds(tap, videoStartUnixMs);
    const align = offset >= 0
      ? `atrim=start=${offset.toFixed(6)},asetpts=PTS-STARTPTS`
      : `adelay=delays=${Math.round(-offset * 1000)}:all=1`;
    const filter = sidecarPath
      ? `[${tapInput}:a]${align}[tap];[1:a:0][tap]amix=inputs=2:duration=longest:normalize=0[aout]`
      : `[${tapInput}:a]${align}[aout]`;
    args.push('-filter_complex', filter);
    audioMap = '[aout]';
  }
  const bitrate = Math.round(Math.max(32000, Math.min(512000, Number(audioBitrate) || 192000)));
  args.push('-map', '0:v:0', '-map', audioMap, '-c:v', 'copy', '-c:a', 'aac', '-b:a', `${Math.round(bitrate / 1000)}k`,
    '-movflags', '+faststart', '-shortest', outputPath);
  return args;
}

module.exports = { createTapParser, createNativeAudioTapSink, startNativeAudioTapRecording, tapOffsetSeconds, buildRecordingMuxArgs };
