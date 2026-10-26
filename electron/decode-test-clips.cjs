'use strict';
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');

/**
 * One short clip per common format, for Settings > Performance > Video
 * Decoding: the render core probes each and the panel shows what really
 * plays in hardware on this computer. (The panel used to ask Chromium, which
 * could call VP9 or AV1 "Hardware" although the core always decodes them on
 * the CPU.)
 */
const DECODE_TEST_CLIPS = [
  { id: 'h264', label: 'H.264', file: 'h264.mp4', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'] },
  { id: 'h264-10', label: 'H.264 10-bit', file: 'h264-10bit.mp4', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le'] },
  { id: 'h264-422', label: 'H.264 4:2:2', file: 'h264-422.mov', args: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv422p'] },
  { id: 'hevc', label: 'HEVC', file: 'hevc.mp4', args: ['-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'] },
  { id: 'hevc-10', label: 'HEVC 10-bit', file: 'hevc-10bit.mp4', args: ['-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p10le', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'] },
  { id: 'prores', label: 'ProRes 422', file: 'prores.mov', args: ['-c:v', 'prores_ks', '-profile:v', '2', '-pix_fmt', 'yuv422p10le'] },
  { id: 'hap', label: 'HAP', file: 'hap.mov', args: ['-c:v', 'hap', '-format', 'hap'] },
  { id: 'vp9', label: 'VP9', file: 'vp9.webm', args: ['-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-pix_fmt', 'yuv420p'] },
  { id: 'av1', label: 'AV1', file: 'av1.mp4', args: ['-c:v', 'libaom-av1', '-cpu-used', '8', '-row-mt', '1', '-pix_fmt', 'yuv420p'] },
];

function encode(ffmpegPath, args, output, timeout) {
  return new Promise((resolve) => {
    execFile(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', '-f', 'lavfi',
      '-i', 'testsrc2=s=640x360:r=30:d=0.5', '-an', ...args, output],
    { windowsHide: true, timeout }, (error) => resolve(!error));
  });
}

let pending = null;

/**
 * The clips this ffmpeg can make, written once into `dir` and reused. A
 * format this build cannot encode is left out rather than reported.
 */
function ensureDecodeTestClips(ffmpegPath, dir, { timeout = 30000 } = {}) {
  if (pending) return pending;
  pending = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const made = [];
    for (const clip of DECODE_TEST_CLIPS) {
      const output = path.join(dir, clip.file);
      let ok = false;
      try { ok = fs.statSync(output).size > 0; } catch { /* not made yet */ }
      if (!ok) {
        const partial = `${output}.part${path.extname(output)}`;
        ok = await encode(ffmpegPath, clip.args, partial, timeout);
        if (ok) fs.renameSync(partial, output);
        else fs.rmSync(partial, { force: true });
      }
      if (ok) made.push({ id: clip.id, label: clip.label, path: output });
    }
    return made;
  })().finally(() => { pending = null; });
  return pending;
}

module.exports = { DECODE_TEST_CLIPS, ensureDecodeTestClips };
