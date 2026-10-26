'use strict';
// Show timeline audio, main-process side, with the bundled ffmpeg:
//
//  - show_audio_prepare: a song in a format Chromium cannot play (AIFF, WMA,
//    ALAC, AC-3 …) is converted once to FLAC (lossless) in the app's asset
//    folder and played from there. The project then refers to that copy.
//
// The argument builders are pure so they can be tested without spawning.
const crypto = require('crypto');

/** Where the converted copy of `sourcePath` lives: one file per source, name and version. */
function convertedAudioPath(pathApi, dir, sourcePath, stat = {}) {
  const base = pathApi.basename(sourcePath, pathApi.extname(sourcePath))
    .replace(/[^\w .-]+/g, '_').trim().slice(0, 60) || 'audio';
  const hash = crypto.createHash('sha1')
    .update(`${sourcePath}\n${stat.size ?? ''}\n${stat.mtimeMs ?? ''}`)
    .digest('hex')
    .slice(0, 10);
  return pathApi.join(dir, `${base}-${hash}.flac`);
}

function buildShowAudioConvertArgs(sourcePath, outputPath) {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', sourcePath,
    '-map', '0:a:0', '-vn',
    '-c:a', 'flac',
    outputPath,
  ];
}

function runFfmpeg(spawn, ffmpegPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg exited ${code}`))));
    child.on('error', reject);
  });
}

/**
 * Registers the IPC handler. The path the renderer names must be one it may
 * read (picked, dropped or in a project).
 */
function registerShowAudioIpc({ ipcMain, spawn, fs, path, ffmpegPath, pathGrants, convertDir }) {
  ipcMain.handle('show_audio_prepare', async (_event, args = {}) => {
    const source = typeof args.path === 'string' ? args.path : '';
    if (!source || !path.isAbsolute(source) || !pathGrants.canRead(source)) {
      return { success: false, error: 'That file was not picked in this session.' };
    }
    let stat;
    try { stat = fs.statSync(source); } catch { return { success: false, error: 'The file could not be found.' }; }
    if (!stat.isFile()) return { success: false, error: 'That is not a file.' };
    const output = convertedAudioPath(path, convertDir, source, stat);
    try {
      if (!fs.existsSync(output)) {
        fs.mkdirSync(convertDir, { recursive: true });
        const partial = `${output}.part.flac`;
        try {
          await runFfmpeg(spawn, ffmpegPath(), buildShowAudioConvertArgs(source, partial));
          fs.renameSync(partial, output);
        } finally {
          try { fs.rmSync(partial, { force: true }); } catch { /* best effort */ }
        }
      }
      pathGrants.allowRead(output);
      return { success: true, path: output };
    } catch (err) {
      return { success: false, error: err?.message || String(err) };
    }
  });
}

module.exports = { buildShowAudioConvertArgs, convertedAudioPath, registerShowAudioIpc, runFfmpeg };
