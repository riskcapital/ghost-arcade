'use strict';
// Live recording formats and sources.
//
// A recording is a source (the composition, one layer / VJ row, or one
// Screen's output) encoded by the bundled ffmpeg from packed BGRA frames.
// H.264 MP4 stays the default and keeps exactly the arguments it always had;
// ProRes and HAP are offered only when the ffmpeg in use can encode them.
const { execFile } = require('child_process');

/** Everything the recorder can write. `alpha` codecs keep transparency. */
const RECORDING_CODECS = [
  { id: 'h264', label: 'H.264 (MP4)', extension: 'mp4', mime: 'video/mp4', alpha: false, encoders: ['libx264', 'h264_videotoolbox', 'h264_nvenc', 'h264_qsv'] },
  { id: 'prores_hq', label: 'ProRes 422 HQ (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: false, encoders: ['prores_ks', 'prores_videotoolbox'] },
  { id: 'prores_4444', label: 'ProRes 4444 with alpha (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: true, encoders: ['prores_ks', 'prores_videotoolbox'] },
  { id: 'hap', label: 'HAP (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: false, encoders: ['hap'] },
  { id: 'hap_alpha', label: 'HAP Alpha (MOV)', extension: 'mov', mime: 'video/quicktime', alpha: true, encoders: ['hap'] },
];

function recordingCodec(id) {
  return RECORDING_CODECS.find(codec => codec.id === id) || RECORDING_CODECS[0];
}

// Same software H.264 tiers as main.js crfForVideoQuality / presetForVideoQuality.
function crfForQuality(quality) {
  const q = String(quality || 'high').trim().toLowerCase();
  if (q === 'archive') return '14';
  if (q === 'web') return '23';
  return '18';
}

function presetForQuality(quality) {
  const q = String(quality || 'high').trim().toLowerCase();
  if (q === 'archive') return 'medium';
  if (q === 'web') return 'veryfast';
  return 'fast';
}

// ffmpeg converts RGB to YUV with BT.601 unless told otherwise; ProRes is an
// editing format, so convert and tag BT.709 like every NLE expects.
const BT709_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
const TO_BT709 = 'scale=out_color_matrix=bt709:out_range=tv';

/**
 * ffmpeg arguments for one live recording: raw frames on stdin, the chosen
 * codec to `outputPath`. `hardwareProRes` selects VideoToolbox ProRes (Apple
 * silicon encodes it in hardware; see probeRecordingCodecs).
 */
function recordingEncoderArgs({
  codec = 'h264',
  width,
  height,
  fps,
  quality = 'high',
  outputPath,
  platform = process.platform,
  hardwareProRes = false,
  hardwareH264 = null,
  pixelFormat = 'bgra',
  totalFrames = 0,
}) {
  const base = [
    '-hide_banner', '-loglevel', 'warning', '-y',
    '-f', 'rawvideo', '-pix_fmt', pixelFormat,
    '-s:v', `${width}x${height}`,
    '-framerate', String(fps),
    '-i', 'pipe:0',
    ...(totalFrames > 0 ? ['-frames:v', String(totalFrames)] : []),
    '-an',
  ];
  const format = recordingCodec(codec);
  if (format.id === 'prores_4444') {
    if (hardwareProRes) {
      return [...base, '-vf', `${TO_BT709},format=ayuv64le`, '-c:v', 'prores_videotoolbox', '-profile:v', '4444',
        '-allow_sw', '1', ...BT709_TAGS, outputPath];
    }
    return [...base, '-vf', `${TO_BT709},format=yuva444p10le`, '-c:v', 'prores_ks', '-profile:v', '4',
      '-pix_fmt', 'yuva444p10le', '-alpha_bits', '16', '-vendor', 'apl0', ...BT709_TAGS, outputPath];
  }
  if (format.id === 'prores_hq') {
    if (hardwareProRes) {
      return [...base, '-vf', `pad=ceil(iw/2)*2:ceil(ih/2)*2,${TO_BT709},format=p210le`, '-c:v', 'prores_videotoolbox',
        '-profile:v', 'hq', '-allow_sw', '1', ...BT709_TAGS, outputPath];
    }
    return [...base, '-vf', `pad=ceil(iw/2)*2:ceil(ih/2)*2,${TO_BT709},format=yuv422p10le`, '-c:v', 'prores_ks',
      '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-vendor', 'apl0', ...BT709_TAGS, outputPath];
  }
  if (format.id === 'hap' || format.id === 'hap_alpha') {
    // DXT blocks are 4x4: pad with transparent pixels, never scale.
    return [...base, '-vf', 'pad=ceil(iw/4)*4:ceil(ih/4)*4:0:0:color=black@0,format=rgba',
      '-c:v', 'hap', '-format', format.id, '-compressor', 'snappy', '-chunks', '4', outputPath];
  }
  // H.264: exactly the recorder's arguments before other codecs existed.
  if (platform === 'darwin') {
    const bitrate = quality === 'maximum' ? '40M' : quality === 'high' ? '20M' : quality === 'medium' ? '10M' : '6M';
    return [...base, '-c:v', 'h264_videotoolbox', '-b:v', bitrate, '-pix_fmt', 'yuv420p', '-movflags', '+faststart', outputPath];
  }
  if (hardwareH264) {
    // Quality is expressed as a bitrate here, matching the VideoToolbox tiers
    // above; NVENC/QSV CQ modes vary too much between drivers to tune blind.
    const bitrate = quality === 'archive' ? '40M' : quality === 'web' ? '8M' : '20M';
    const tuning = hardwareH264 === 'h264_nvenc'
      ? ['-preset', 'p4', '-tune', 'll', '-rc', 'cbr']
      : [];
    return [...base, '-c:v', hardwareH264, ...tuning, '-b:v', bitrate, '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', outputPath];
  }
  return [...base, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', crfForQuality(quality), '-preset', presetForQuality(quality),
    '-movflags', '+faststart', outputPath];
}

/** Capture rate for a live recording: software ProRes cannot keep up with
 *  60 fps at 1080p on most machines, so it records at 30. */
function liveRecordingFps(codec, requestedFps, hardwareProRes) {
  const fps = Math.round(Math.max(1, Math.min(60, Number(requestedFps) || 30)));
  const format = recordingCodec(codec);
  if (format.id.startsWith('prores') && !hardwareProRes) return Math.min(fps, 30);
  return fps;
}

function run(executable, args, timeoutMs) {
  return new Promise((resolve) => {
    execFile(executable, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      resolve({ ok: !error, stdout: String(stdout || '') });
    });
  });
}

function parseEncoderList(stdout) {
  return new Set(String(stdout).split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*V[A-Z.]{5}\s+(\S+)/);
    return match ? [match[1]] : [];
  }));
}

/** Which codecs this ffmpeg can record, given its encoder list and whether
 *  VideoToolbox ProRes (with alpha) actually opened. Pure, for tests. */
function recordingCodecAvailability(encoders, { hardwareProRes = false } = {}) {
  return RECORDING_CODECS.map((codec) => {
    let available;
    if (codec.id === 'h264') available = encoders.has('libx264') || encoders.has('h264_videotoolbox');
    else if (codec.id.startsWith('prores')) available = hardwareProRes || encoders.has('prores_ks');
    else available = encoders.has('hap');
    return {
      id: codec.id,
      label: codec.label,
      extension: codec.extension,
      mime: codec.mime,
      alpha: codec.alpha,
      available,
      ...(available ? {} : { reason: `This FFmpeg build has no ${codec.encoders.join(' / ')} encoder.` }),
    };
  });
}

const probes = new Map();

/**
 * Ask the bundled ffmpeg what it can encode. VideoToolbox ProRes is listed
 * on every macOS build but only opens where the OS provides the encoder, so
 * it is proven with a one-frame ProRes 4444 encode before it is used.
 */
function probeRecordingCodecs(ffmpegPath, platform = process.platform) {
  const key = `${platform}:${ffmpegPath}`;
  if (!probes.has(key)) {
    probes.set(key, (async () => {
      const listed = await run(ffmpegPath, ['-hide_banner', '-encoders'], 15000);
      const encoders = listed.ok ? parseEncoderList(listed.stdout) : new Set();
      let hardwareProRes = false;
      if (platform === 'darwin' && encoders.has('prores_videotoolbox')) {
        const probe = await run(ffmpegPath, [
          '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red@0.5:s=64x64:d=0.1,format=bgra',
          '-frames:v', '1', '-vf', 'format=ayuv64le', '-c:v', 'prores_videotoolbox', '-profile:v', '4444', '-allow_sw', '1',
          '-f', 'null', '-',
        ], 15000);
        hardwareProRes = probe.ok;
      }
      // Windows recorded through libx264 while macOS used VideoToolbox, so a
      // machine with a perfectly good NVENC block encoded 1080p on the CPU.
      // At `-crf 18 -preset fast` that is several cores, and when it
      // backpressures the recorder's stdin the capture pump stalls -- which
      // is why enabling REC dropped the live preview too, not just the file.
      // Listed is not the same as usable (no GPU, headless VM, driver too
      // old), so prove it with a real encode before choosing it.
      let hardwareH264 = null;
      if (platform === 'win32') {
        for (const candidate of ['h264_nvenc', 'h264_qsv']) {
          if (!encoders.has(candidate)) continue;
          const probe = await run(ffmpegPath, [
            '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=256x256:d=0.1',
            '-frames:v', '1', '-c:v', candidate, '-f', 'null', '-',
          ], 20000);
          if (probe.ok) { hardwareH264 = candidate; break; }
        }
      }
      return { hardwareProRes, hardwareH264, codecs: recordingCodecAvailability(encoders, { hardwareProRes }) };
    })().catch((error) => {
      probes.delete(key);
      throw error;
    }));
  }
  return probes.get(key);
}

/**
 * Normalize the renderer's recording source. Returns what to read frames
 * from and, for layers and transparent compositions, the core record
 * target to set up:
 *   { kind: 'output' }                           the program output export
 *   { kind: 'record_target', target: {...} }     core set_record_target params
 *   { kind: 'screen', sliceId }                  one Screen's slice output
 */
function resolveRecordingSource(source, codecId) {
  const codec = recordingCodec(codecId);
  const kind = String(source?.kind || 'composition');
  if (kind === 'screen') {
    const sliceId = typeof source?.sliceId === 'string' ? source.sliceId.trim() : '';
    if (!sliceId) throw new Error('Choose a Screen to record.');
    return { kind: 'screen', sliceId, alpha: false, label: source?.label || 'Screen' };
  }
  if (kind === 'layer') {
    const layerIds = (Array.isArray(source?.layerIds) ? source.layerIds : [source?.layerId])
      .filter(id => typeof id === 'string' && id.trim());
    if (!layerIds.length) throw new Error('Choose a layer to record.');
    return { kind: 'record_target', alpha: codec.alpha, label: source?.label || 'Layer',
      target: { kind: 'layer', layer_ids: layerIds, alpha: codec.alpha } };
  }
  if (kind === 'vj_layer') {
    const index = Number(source?.vjLayerIndex);
    if (!Number.isInteger(index) || index < 0) throw new Error('Choose a VJ layer to record.');
    return { kind: 'record_target', alpha: codec.alpha, label: source?.label || `Layer ${index + 1}`,
      target: { kind: 'vj_layer', vj_layer_index: index, alpha: codec.alpha } };
  }
  // The composition: the program output as always, unless the codec keeps
  // alpha — then the composition renders again over a transparent background.
  if (codec.alpha) {
    return { kind: 'record_target', alpha: true, label: 'Composition',
      target: { kind: 'composition', alpha: true } };
  }
  return { kind: 'output', alpha: false, label: 'Composition' };
}

/** Audio settings for muxing into a finished recording's container. */
function recordingAudioCodecArgs(videoPath, audioBitrate = 192000) {
  if (/\.mov$/i.test(String(videoPath))) return ['-c:a', 'pcm_s16le', '-ar', '48000'];
  const bitrate = Math.round(Math.max(32000, Math.min(512000, Number(audioBitrate) || 192000)));
  return ['-c:a', 'aac', '-b:a', `${Math.round(bitrate / 1000)}k`];
}

module.exports = {
  RECORDING_CODECS,
  recordingCodec,
  recordingEncoderArgs,
  liveRecordingFps,
  parseEncoderList,
  recordingCodecAvailability,
  probeRecordingCodecs,
  resolveRecordingSource,
  recordingAudioCodecArgs,
};
