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
module.exports = { alphaInputArgs, probeConversionInput, sequenceConcatText, formats, conversionFormat, conversionOutputArgs, stageConversionOutput };
