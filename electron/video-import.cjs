'use strict';
const { execFile } = require('child_process');
// This single thumbnail is offline import work. Playback uses native decoders.
function inspectVideoForImport(ffmpeg, inputPath) {
  return new Promise((resolve, reject) => {
    execFile(ffmpeg, ['-hide_banner', '-nostdin', '-i', inputPath, '-map', '0:v:0', '-frames:v', '1', '-an',
      '-vf', 'showinfo,scale=160:90:force_original_aspect_ratio=decrease', '-c:v', 'mjpeg', '-f', 'image2pipe', 'pipe:1'],
    { windowsHide: true, encoding: 'buffer', timeout: 15000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error || !stdout?.length) { reject(new Error('Could not read this video for import.')); return; }
      const duration = String(stderr).match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      const durationSeconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : undefined;
      // showinfo runs before thumbnail scaling and after container rotation.
      const dimensions = String(stderr).match(/Parsed_showinfo_[^\n]*\bs:(\d+)x(\d+)/);
      resolve({ durationSeconds, videoWidth: dimensions ? Number(dimensions[1]) : undefined,
        videoHeight: dimensions ? Number(dimensions[2]) : undefined,
        thumbnail: 'data:image/jpeg;base64,' + stdout.toString('base64') });
    });
  });
}
module.exports = { inspectVideoForImport };
