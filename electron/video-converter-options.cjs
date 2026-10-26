'use strict';
const fs = require('fs');
const path = require('path');
const formats = require('./video-converter-formats.json');
/** Native VP8/VP9 decoders omit WebM's separate alpha plane; libvpx reads it. */
function alphaInputArgs(probeText) {
  const codec = String(probeText).match(/Stream[^\n]*Video:\s*(vp8|vp9)\b/i)?.[1]?.toLowerCase();
  return codec ? ['-c:v', codec === 'vp9' ? 'libvpx-vp9' : 'libvpx'] : [];
}
function probeConversionInput(ffmpegPath, inputPath, job) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', inputPath], { windowsHide: true });
    job.process = child;
    let text = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 15000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { text = (text + chunk).slice(-65536); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      if (job.cancelled) reject(new Error('Conversion cancelled.'));
      else if (timedOut) reject(new Error('Reading the input video timed out.'));
      else if (!/Stream[^\n]*Video:/.test(text)) reject(new Error('Could not read a video stream from this file.'));
      else resolve(alphaInputArgs(text));
    });
  });
}
function conversionFormat(id = 'h264') {
  const format = formats.find(f => f.id === id);
  if (!format) throw new Error('Choose a supported output format.');
  return format;
}
function conversionOutputArgs(id, options = {}) {
  const format = conversionFormat(id);
  if (format.id === 'playback') return playbackOutputArgs(options.playback || {});
  const audio = format.id === 'h264' ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'pcm_s16le'];
  const common = ['-ar', '48000', '-max_muxing_queue_size', '1024', '-movflags', '+faststart', '-f', format.extension === 'mp4' ? 'mp4' : 'mov'];
  if (format.id.startsWith('hap')) {
    return ['-vf', 'pad=ceil(iw/4)*4:ceil(ih/4)*4:0:0:color=black@0,format=rgba',
      '-c:v', 'hap', '-format', format.id, '-compressor', 'snappy', '-chunks', '4', ...audio, ...common];
  }
  if (format.id.startsWith('prores')) {
    const alpha = format.alpha;
    return ['-vf', alpha ? 'format=yuva444p10le' : 'pad=ceil(iw/2)*2:ih:0:0,format=yuv422p10le',
      '-c:v', 'prores_ks', '-profile:v', alpha ? '4' : '3', '-pix_fmt', alpha ? 'yuva444p10le' : 'yuv422p10le',
      ...(alpha ? ['-alpha_bits', '16'] : []), ...audio, ...common];
  }
  const crf = Number.isFinite(Number(options.crf)) ? Math.max(10, Math.min(32, Math.round(Number(options.crf)))) : 18;
  const preset = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium'].includes(options.preset) ? options.preset : 'veryfast';
  return ['-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0,format=yuv420p', '-c:v', 'libx264', '-preset', preset, '-crf', String(crf), ...audio, ...common];
}
// ── Playback preset ──────────────────────────────────────────────────────
// The format that plays smoothly everywhere: 8-bit 4:2:0 H.264, at most
// 1920 px on the long edge and 60 fps, a keyframe every second, rotation
// applied and HDR tone-mapped to SDR. Every Mac and PC decodes it in hardware,
// with reverse and bounce playback.
const PLAYBACK_DEFAULT_LONG_EDGE = 1920;
const PLAYBACK_MAX_FPS = 60;
const PLAYBACK_HARDWARE_ENCODERS = {
  darwin: ['h264_videotoolbox'],
  win32: ['h264_nvenc', 'h264_qsv', 'h264_amf'],
};

/** What the playback preset needs to know about a source, from ffmpeg -i. */
function parsePlaybackProbe(text) {
  const stream = String(text).split(/\r?\n/).find(line => /Stream #[^\n]*Video:/.test(line));
  if (!stream) return null;
  const video = stream.slice(stream.indexOf('Video:') + 6).trim();
  const size = video.match(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,]|$)/);
  const fps = video.match(/([\d.]+)\s*fps/) || video.match(/([\d.]+)\s*tbr/);
  const transfer = /smpte2084/i.test(video) ? 'pq' : /arib-std-b67/i.test(video) ? 'hlg' : null;
  const rotation = String(text).match(/rotation of (-?[\d.]+) degrees/);
  return {
    codec: video.split(/[\s,(]/)[0] || '',
    width: size ? Number(size[1]) : 0,
    height: size ? Number(size[2]) : 0,
    fps: fps ? Number(fps[1]) : 0,
    transfer,
    rotation: rotation ? Number(rotation[1]) : 0,
    description: video,
  };
}

function probePlaybackInput(ffmpegPath, inputPath, job) {
  return new Promise((resolve, reject) => {
    const child = require('child_process').spawn(ffmpegPath, ['-hide_banner', '-nostdin', '-i', inputPath], { windowsHide: true });
    job.process = child;
    let text = '', timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 15000);
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { text = (text + chunk).slice(-65536); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      const probe = parsePlaybackProbe(text);
      if (job.cancelled) reject(new Error('Conversion cancelled.'));
      else if (timedOut) reject(new Error('Reading the input video timed out.'));
      else if (!probe) reject(new Error('Could not read a video stream from this file.'));
      else resolve(probe);
    });
  });
}

/** The output size the preset gives a source (rotation does not change the long edge). */
function playbackOutputSize(probe, longEdge = PLAYBACK_DEFAULT_LONG_EDGE) {
  const width = Math.max(2, Number(probe?.width) || 1920);
  const height = Math.max(2, Number(probe?.height) || 1080);
  const scale = Math.min(1, longEdge / Math.max(width, height));
  const even = value => Math.max(2, Math.floor((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

function playbackFps(probe) {
  const fps = Number(probe?.fps);
  return Math.min(PLAYBACK_MAX_FPS, Number.isFinite(fps) && fps > 0 ? fps : 30);
}

/** Hardware encoder settings: none of them takes a constant-quality factor everywhere. */
function playbackBitrate(probe, longEdge) {
  const { width, height } = playbackOutputSize(probe, longEdge);
  const bits = width * height * playbackFps(probe) * 0.12;
  return Math.round(Math.max(4e6, Math.min(40e6, bits)));
}

/**
 * ffmpeg output arguments for the playback preset.
 * `encoder` is a proven hardware H.264 encoder or libx264; `tonemap` says
 * whether this ffmpeg has zscale and tonemap (an HDR source is otherwise
 * converted without tone mapping, and the caller says so).
 */
function playbackOutputArgs({ probe, longEdge = PLAYBACK_DEFAULT_LONG_EDGE, encoder = 'libx264', tonemap = false } = {}) {
  const edge = Math.max(320, Math.min(7680, Math.round(Number(longEdge) || PLAYBACK_DEFAULT_LONG_EDGE)));
  const fps = playbackFps(probe);
  const gop = Math.max(1, Math.round(fps));
  const hdr = !!probe?.transfer;
  const filters = [
    // Square pixels first, so the long edge is measured as it is shown.
    'scale=trunc(iw*sar/2)*2:ih',
    `scale='if(gte(iw,ih),trunc(min(iw,${edge})/2)*2,-2)':'if(gte(iw,ih),-2,trunc(min(ih,${edge})/2)*2)'`,
    'setsar=1',
  ];
  if (hdr && tonemap) {
    filters.push('zscale=t=linear:npl=100', 'format=gbrpf32le', 'zscale=p=bt709',
      'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  }
  filters.push(`fps='min(source_fps,${PLAYBACK_MAX_FPS})'`, 'format=yuv420p');
  const bitrate = playbackBitrate(probe, edge);
  const rate = [`-b:v`, String(bitrate), '-maxrate', String(Math.round(bitrate * 1.5)), '-bufsize', String(bitrate * 2)];
  let codec;
  if (encoder === 'h264_videotoolbox') codec = ['-c:v', encoder, '-allow_sw', '1', '-profile:v', 'high', '-b:v', String(bitrate)];
  else if (encoder === 'h264_nvenc') codec = ['-c:v', encoder, '-preset', 'p5', '-profile:v', 'high', '-rc', 'vbr', ...rate];
  else if (encoder === 'h264_qsv' || encoder === 'h264_amf') codec = ['-c:v', encoder, '-profile:v', 'high', ...rate];
  else codec = ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high'];
  const color = hdr && tonemap ? ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'] : [];
  return ['-vf', filters.join(','), ...codec, '-pix_fmt', 'yuv420p', '-g', String(gop), ...color,
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-max_muxing_queue_size', '1024', '-movflags', '+faststart', '-f', 'mp4'];
}

const capabilityProbes = new Map();
function cachedProbe(key, run) {
  if (!capabilityProbes.has(key)) {
    capabilityProbes.set(key, run().catch(error => { capabilityProbes.delete(key); throw error; }));
  }
  return capabilityProbes.get(key);
}
function runFfmpeg(ffmpegPath, args, timeout = 20000) {
  return new Promise(resolve => {
    require('child_process').execFile(ffmpegPath, args, { windowsHide: true, timeout, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => resolve({ ok: !error, stdout: String(stdout || '') }));
  });
}

/** Whether this ffmpeg can tone-map HDR (zscale and tonemap filters). */
function playbackCanToneMap(ffmpegPath) {
  return cachedProbe(`filters:${ffmpegPath}`, async () => {
    const { ok, stdout } = await runFfmpeg(ffmpegPath, ['-hide_banner', '-filters']);
    return ok && /\szscale\s/.test(stdout) && /\stonemap\s/.test(stdout);
  });
}

/** The first hardware H.264 encoder that really encodes here, else libx264. */
function choosePlaybackEncoder(ffmpegPath, platform = process.platform) {
  return cachedProbe(`encoder:${platform}:${ffmpegPath}`, async () => {
    const { stdout } = await runFfmpeg(ffmpegPath, ['-hide_banner', '-encoders']);
    for (const candidate of PLAYBACK_HARDWARE_ENCODERS[platform] || []) {
      if (!new RegExp(`\\s${candidate}\\s`).test(stdout)) continue;
      // Listed is not usable (no GPU, old driver): prove it with one frame.
      const probe = await runFfmpeg(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
        '-i', 'color=c=black:s=256x256:d=0.1', '-frames:v', '1', '-c:v', candidate, '-f', 'null', '-']);
      if (probe.ok) return candidate;
    }
    return 'libx264';
  });
}

/** `clip.mov` -> `clip-playback.mp4` beside it, never an existing file. */
function playbackOutputPath(inputPath, directory = path.dirname(inputPath), exists = fs.existsSync) {
  const base = path.basename(inputPath, path.extname(inputPath)).replace(/-playback(?:-\d+)?$/i, '');
  for (let n = 1; n < 1000; n += 1) {
    const candidate = path.join(directory, `${base}-playback${n === 1 ? '' : `-${n}`}.mp4`);
    if (!exists(candidate)) return candidate;
  }
  throw new Error('Too many converted copies of this video already exist.');
}

function sequenceConcatText(paths, fps) {
  if (!paths.length || !Number.isFinite(fps) || fps < 1 || fps > 240) throw new Error('Invalid frame sequence.');
  const quote = value => "'" + path.resolve(value).replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  const lines = ['ffconcat version 1.0'];
  for (const frame of paths) {
    lines.push(`file ${quote(frame)}`, `option framerate ${fps}`, `duration ${(1 / fps).toFixed(10)}`);
  }
  lines.push(`file ${quote(paths[paths.length - 1])}`, `option framerate ${fps}`);
  return lines.join('\n') + '\n';
}
/** Publish only a completed file. Never overwrite an existing source or output. */
function stageConversionOutput(outputPath, formatId) {
  const format = conversionFormat(formatId);
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== `.${format.extension}`) {
    throw new Error(`Choose a .${format.extension} output path for ${format.label}.`);
  }
  if (fs.existsSync(outputPath)) throw new Error('Output already exists. Choose a new filename to preserve the existing file.');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  const directory = fs.mkdtempSync(path.join(path.dirname(outputPath), '.ghost-convert-'));
  const temporaryPath = path.join(directory, `output.${format.extension}`);
  return {
    temporaryPath,
    complete() {
      if (!fs.statSync(temporaryPath).size) throw new Error('Encoder produced an empty file.');
      try { fs.linkSync(temporaryPath, outputPath); }
      catch (error) {
        if (!['EPERM', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error;
        try { fs.copyFileSync(temporaryPath, outputPath, fs.constants.COPYFILE_EXCL); }
        catch (copyError) { throw copyError; }
      }
    },
    cleanup() { fs.rmSync(directory, { recursive: true, force: true }); },
  };
}
module.exports = {
  alphaInputArgs, probeConversionInput, sequenceConcatText, formats, conversionFormat, conversionOutputArgs, stageConversionOutput,
  PLAYBACK_DEFAULT_LONG_EDGE, PLAYBACK_MAX_FPS, parsePlaybackProbe, probePlaybackInput, playbackOutputArgs,
  playbackOutputSize, playbackCanToneMap, choosePlaybackEncoder, playbackOutputPath,
};
