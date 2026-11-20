// Checks a rendered video with the bundled ffmpeg (ffprobe when it is on
// PATH): size, codec, frame count and the mean brightness of a middle frame.
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function ffmpegPath() {
  return process.env.GA_FFMPEG_PATH || require('ffmpeg-static');
}

let ffprobe;
function ffprobePath() {
  if (ffprobe !== undefined) return ffprobe;
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffprobe'], { encoding: 'utf8' });
  ffprobe = r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
  return ffprobe;
}

export function probeVideo(file) {
  const info = { width: 0, height: 0, frames: 0, codec: '?', duration: 0, meanLuma: null, tool: 'ffmpeg' };
  const probe = ffprobePath();
  if (probe) {
    try {
      const out = JSON.parse(execFileSync(probe, ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,codec_name,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8', timeout: 120000 }));
      const s = out.streams?.[0] ?? {};
      Object.assign(info, { width: s.width, height: s.height, codec: s.codec_name, frames: Number(s.nb_read_frames) || 0, duration: Number(out.format?.duration) || 0, tool: 'ffprobe' });
    } catch { /* fall back to ffmpeg */ }
  }
  if (!info.frames) {
    // Decode every frame to nothing; stderr carries the stream line and the frame count.
    const r = spawnSync(ffmpegPath(), ['-hide_banner', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { encoding: 'utf8', timeout: 180000 });
    const err = r.stderr ?? '';
    const stream = err.match(/Stream #0:\d+[^:]*: Video: ([a-z0-9_]+)[^\n]*?, (\d{2,5})x(\d{2,5})/);
    if (stream) { info.codec = stream[1]; info.width = Number(stream[2]); info.height = Number(stream[3]); }
    const frames = [...err.matchAll(/frame=\s*(\d+)/g)];
    info.frames = frames.length ? Number(frames[frames.length - 1][1]) : 0;
    const dur = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
    if (dur) info.duration = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
  }
  try {
    const mid = Math.max(0, Math.floor(info.frames / 2));
    const raw = execFileSync(ffmpegPath(), ['-loglevel', 'error', '-i', file, '-vf', `select=eq(n\\,${mid}),scale=64:-2,format=gray`, '-frames:v', '1', '-f', 'rawvideo', '-'], { maxBuffer: 16 * 1024 * 1024, timeout: 60000 });
    if (raw.length) info.meanLuma = raw.reduce((s, v) => s + v, 0) / raw.length / 255;
  } catch { /* no frame */ }
  return info;
}
