'use strict';
// Show timeline audio, main-process side, with the bundled ffmpeg:
//
//  - show_audio_prepare: a song in a format Chromium cannot play (AIFF, WMA,
//    ALAC, AC-3 …) is converted once to FLAC (lossless) in the app's asset
//    folder and played from there. The project then refers to that copy.
//  - show_audio_mux: "Render to Video" writes the picture only; this mixes
//    the show's tracks (each at its place, trim and level, looped like the
//    show) and adds them to the rendered file.
//
// The argument builders are pure so they can be tested without spawning.
const crypto = require('crypto');

const SAMPLE_RATE = 48000;

function seconds(value) {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : 0).toFixed(6);
}

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

/**
 * ffmpeg arguments that add the show's soundtrack to a rendered video.
 *
 * Each track: cut to its trim (`offset`, `duration`), set to its level, and
 * delayed to its `startTime`. The tracks are summed without normalising
 * (what the speakers would play), padded with silence to one pass of the
 * show, then looped like the show when the render runs longer and it loops,
 * and cut to the render length. The picture is copied untouched.
 */
function buildShowAudioMuxArgs({
  videoPath,
  outputPath,
  tracks,
  showDuration,
  renderDuration,
  loop = false,
  audioCodecArgs = ['-c:a', 'aac', '-b:a', '192k'],
  sampleRate = SAMPLE_RATE,
}) {
  const usable = (Array.isArray(tracks) ? tracks : []).filter((t) => t && typeof t.path === 'string' && t.path && Number(t.duration) > 0);
  if (usable.length === 0) throw new Error('No show audio to add');
  const show = Math.max(Number(showDuration) || 0, ...usable.map((t) => (Number(t.startTime) || 0) + Number(t.duration)));
  const render = Number(renderDuration) > 0 ? Number(renderDuration) : show;

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath];
  for (const t of usable) args.push('-i', t.path);

  const filters = [];
  usable.forEach((t, k) => {
    const volume = Math.max(0, Math.min(1, Number(t.volume ?? 1)));
    const chain = [
      `atrim=start=${seconds(t.offset)}:duration=${seconds(t.duration)}`,
      'asetpts=PTS-STARTPTS',
      `aresample=${sampleRate}`,
      'aformat=sample_fmts=fltp:channel_layouts=stereo',
      `volume=${volume.toFixed(4)}`,
    ];
    const delayMs = Math.round((Number(t.startTime) || 0) * 1000);
    if (delayMs > 0) chain.push(`adelay=delays=${delayMs}:all=1`);
    filters.push(`[${k + 1}:a]${chain.join(',')}[t${k}]`);
  });
  let mix = 't0';
  if (usable.length > 1) {
    filters.push(`${usable.map((_, k) => `[t${k}]`).join('')}amix=inputs=${usable.length}:duration=longest:normalize=0[mix]`);
    mix = 'mix';
  }
  filters.push(`[${mix}]apad=whole_dur=${seconds(show)},atrim=end=${seconds(show)}[show]`);
  if (loop && render > show + 1e-3) {
    filters.push(`[show]aloop=loop=-1:size=${Math.round(show * sampleRate)},atrim=end=${seconds(render)}[aout]`);
  } else {
    filters.push(`[show]apad=whole_dur=${seconds(render)},atrim=end=${seconds(render)}[aout]`);
  }

  args.push(
    '-filter_complex', filters.join(';'),
    '-map', '0:v:0', '-map', '[aout]',
    '-c:v', 'copy',
    ...audioCodecArgs,
    '-movflags', '+faststart',
    '-shortest',
    outputPath,
  );
  return args;
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
 * Registers the two IPC handlers. Every path the renderer names must be one
 * it may read (picked, dropped or in a project), and the video must be a
 * rendered .mp4 / .mov that exists.
 */
function registerShowAudioIpc({ ipcMain, spawn, fs, path, ffmpegPath, pathGrants, convertDir, audioCodecArgs }) {
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

  ipcMain.handle('show_audio_mux', async (_event, args = {}) => {
    const videoPath = typeof args.videoPath === 'string' ? args.videoPath : '';
    // Renders land in the app's own asset folder, which the grants cover.
    if (!videoPath || !path.isAbsolute(videoPath) || !/\.(mp4|mov)$/i.test(videoPath) || !pathGrants.canRead(videoPath) || !fs.existsSync(videoPath)) {
      return { success: false, error: 'Rendered video not found.' };
    }
    const tracks = (Array.isArray(args.tracks) ? args.tracks : [])
      .filter((t) => t && typeof t.path === 'string' && path.isAbsolute(t.path) && pathGrants.canRead(t.path) && fs.existsSync(t.path));
    if (tracks.length === 0) return { success: false, error: 'The show audio files could not be found.' };
    const ext = path.extname(videoPath);
    const muxedPath = `${videoPath}.audio${ext}`;
    try {
      await runFfmpeg(spawn, ffmpegPath(), buildShowAudioMuxArgs({
        videoPath,
        outputPath: muxedPath,
        tracks,
        showDuration: args.showDuration,
        renderDuration: args.renderDuration,
        loop: args.loop === true,
        audioCodecArgs: audioCodecArgs(videoPath),
      }));
      // The render may still be open in a preview on Windows.
      await require('./replace-file.cjs').replaceFile(muxedPath, videoPath, { fs });
      return { success: true, outputPath: videoPath };
    } catch (err) {
      try { fs.rmSync(muxedPath, { force: true }); } catch { /* best effort */ }
      return { success: false, error: err?.message || String(err) };
    }
  });
}

module.exports = { buildShowAudioConvertArgs, buildShowAudioMuxArgs, convertedAudioPath, registerShowAudioIpc, runFfmpeg };
