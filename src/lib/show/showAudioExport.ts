/**
 * The show's soundtrack in "Render to Video": which tracks go into the file
 * and the ffmpeg arguments that mix them under the rendered picture. The
 * render encodes with ffmpeg.wasm, so the mix runs there too, on copies of
 * the track files read through their playback URLs.
 */
import type { ShowAudioTrack } from '../types';

export interface ShowMuxTrack {
  /** Where the track plays from (ghost-asset:, blob: or data: URL). */
  url: string;
  startTime: number;
  offset: number;
  duration: number;
  volume: number;
}

/** Audible tracks that have something to play, as the mix wants them. */
export function showMuxTracks(tracks: ShowAudioTrack[]): ShowMuxTrack[] {
  const out: ShowMuxTrack[] = [];
  for (const track of tracks) {
    if (track.muted || !(track.volume > 0) || !(track.duration > 0) || !track.url) continue;
    out.push({
      url: track.url,
      startTime: Math.max(0, track.startTime),
      offset: Math.max(0, track.offset),
      duration: track.duration,
      volume: Math.max(0, Math.min(1, track.volume)),
    });
  }
  return out;
}

/** True when the show has a soundtrack a render would carry. */
export function showHasSoundtrack(tracks: ShowAudioTrack[]): boolean {
  return showMuxTracks(tracks).length > 0;
}

const SAMPLE_RATE = 48000;

function seconds(value: unknown): string {
  const n = Number(value);
  return (Number.isFinite(n) && n > 0 ? n : 0).toFixed(6);
}

export interface ShowAudioMuxInput {
  /** The rendered, silent video. */
  videoPath: string;
  /** The video with the soundtrack. */
  outputPath: string;
  /** One file per track, with that track's place, trim and level. */
  tracks: Array<{ path: string; startTime: number; offset: number; duration: number; volume: number }>;
  showDuration: number;
  renderDuration: number;
  /** The show loops: the soundtrack repeats when the render is longer. */
  loop?: boolean;
  audioCodecArgs?: string[];
  sampleRate?: number;
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
export function buildShowAudioMuxArgs({
  videoPath,
  outputPath,
  tracks,
  showDuration,
  renderDuration,
  loop = false,
  audioCodecArgs = ['-c:a', 'aac', '-b:a', '192k'],
  sampleRate = SAMPLE_RATE,
}: ShowAudioMuxInput): string[] {
  const usable = (Array.isArray(tracks) ? tracks : []).filter((t) => t && typeof t.path === 'string' && t.path && Number(t.duration) > 0);
  if (usable.length === 0) throw new Error('No show audio to add');
  const show = Math.max(Number(showDuration) || 0, ...usable.map((t) => (Number(t.startTime) || 0) + Number(t.duration)));
  const render = Number(renderDuration) > 0 ? Number(renderDuration) : show;

  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath];
  for (const t of usable) args.push('-i', t.path);

  const filters: string[] = [];
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

/** A file name for a track's copy, keeping its extension so ffmpeg can
 *  tell the format. */
export function showMuxInputName(index: number, url: string): string {
  let ext = '';
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    const m = /\.([a-z0-9]{1,5})$/i.exec(pathname);
    if (m) ext = `.${m[1].toLowerCase()}`;
  } catch { /* a blob: or data: URL has no extension */ }
  return `show_audio_${index}${ext}`;
}
