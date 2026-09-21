'use strict';
const { execFile } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const { existsSync } = require('fs');
const run = promisify(execFile);
const probes = new Map();

async function encoders(executable) {
  if (!probes.has(executable)) {
    probes.set(executable, run(executable, ['-hide_banner', '-encoders'], {
      windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024,
    }).then(({ stdout }) => new Set(stdout.split(/\r?\n/).flatMap(line => {
      const match = line.match(/^\s*[VAS][A-Z.]{5}\s+(\S+)/);
      return match ? [match[1]] : [];
    }))).catch(error => { probes.delete(executable); throw error; }));
  }
  return probes.get(executable);
}

function bundledFfmpegPaths(resourcesPath = process.resourcesPath, platform = process.platform) {
  if (platform !== 'win32') return [];
  return [
    resourcesPath && path.join(resourcesPath, 'ffmpeg', 'ffmpeg.exe'),
    path.join(__dirname, '..', 'build-resources', 'ffmpeg', 'win32-x64', 'ffmpeg.exe'),
  ].filter(candidate => candidate && existsSync(candidate));
}

// The verified Windows full build ships outside ASAR. Keep overrides and
// installed encoders as development fallbacks, not installation prerequisites.
async function resolveConversionFfmpeg(preferred, formatId, probe = encoders) {
  if (!formatId.startsWith('hap')) return preferred;
  const candidates = [...new Set([process.env.GA_FFMPEG_PATH, ...bundledFfmpegPaths(), preferred,
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'].filter(Boolean))];
  for (const candidate of candidates) {
    try { if ((await probe(candidate)).has('hap')) return candidate; }
    catch { /* Try the next installed binary. */ }
  }
  throw new Error('HAP conversion needs an FFmpeg build with the HAP encoder. Install a full FFmpeg build on PATH or set GA_FFMPEG_PATH, then retry. H.264 and ProRes remain available.');
}
module.exports = { resolveConversionFfmpeg, bundledFfmpegPaths };
