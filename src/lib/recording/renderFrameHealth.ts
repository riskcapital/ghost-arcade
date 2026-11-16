/**
 * Is a frame the render core handed back one it really made?
 *
 * This used to be judged by brightness: a frame that was nearly black failed
 * the render. Shows go dark on purpose (fades to black, blackouts, a dark
 * scene), so that stopped good renders. What it was there to catch is a
 * frame the core never drew, and that is checked directly:
 *   - the frame is the size, byte count and pixel format the encoder takes;
 *   - the core says it drew this frame itself (`drawn`);
 *   - an opaque output is never fully transparent: one that is was never
 *     written (a new GPU texture starts all zero, alpha included);
 *   - an offline render's frame was made on the render's clock (a core that
 *     restarted mid-render is back on the live clock, with no scene).
 *
 * And a playing video must keep moving: see `VideoMotionWatch`.
 */

export interface RenderFrameReport {
  width: number;
  height: number;
  format: string;
  byte_length?: number;
  bytes_written?: number;
  transparent_pixels?: number;
  checksum?: string;
  average_luma?: number;
  max_luma?: number;
  nonzero_pixels?: number;
  bright_pixels?: number;
  /** False: the core did not draw this frame (older cores leave it out). */
  drawn?: boolean;
  /** 'straight': a target that may be transparent on purpose. */
  alpha_mode?: string;
  /** The core's clock when it made the frame: 'manual' during a render. */
  render_clock?: string;
  layers?: number;
  videos?: RenderFrameVideo[];
}

/** One video in a frame, as the core made it (manual clock only). */
export interface RenderFrameVideo {
  id: string;
  uri?: string;
  /** Media time it showed. */
  time: number;
  /** Source frame index, when the file's rate is known. */
  frame?: number | null;
  fps?: number | null;
  rate?: number;
  /** Its playback should move it (playing, at a rate, not held at an end). */
  moving?: boolean;
  /** The core holds it paused. */
  paused?: boolean;
  anchor_time?: number;
  anchor_clock?: number;
  seek_generation?: number;
}

export interface RenderFrameExpectation {
  width: number;
  height: number;
  pixelFormat: 'rgba' | 'bgra';
  /** An offline render: the frame must come from the render's clock. */
  manualClock?: boolean;
}

export function pixelFormatOf(format: string): 'rgba' | 'bgra' | null {
  const normalized = String(format || '').trim().toLowerCase();
  if (normalized.includes('bgra')) return 'bgra';
  if (normalized.includes('rgba')) return 'rgba';
  return null;
}

export function describeFrameReport(snapshot: RenderFrameReport): string {
  return [
    `checksum=${snapshot.checksum || 'missing'}`,
    `luma=${Number(snapshot.average_luma ?? 0).toFixed(4)}`,
    `max=${Number(snapshot.max_luma ?? 0).toFixed(4)}`,
    `nonzero=${Number(snapshot.nonzero_pixels ?? 0)}`,
    `transparent=${Number(snapshot.transparent_pixels ?? 0)}`,
    `bytes=${Number(snapshot.bytes_written ?? 0)}/${Number(snapshot.byte_length ?? 0)}`,
    `format=${snapshot.format || 'unknown'}`,
    ...(snapshot.render_clock ? [`clock=${snapshot.render_clock}`] : []),
    ...(snapshot.layers !== undefined ? [`layers=${snapshot.layers}`] : []),
  ].join(' ');
}

/** Why this frame is not one the core made, or null when it is. Dark and
 *  black frames are fine. */
export function renderFrameProblem(
  snapshot: RenderFrameReport,
  frameIndex: number,
  expected: RenderFrameExpectation,
): string | null {
  const health = () => describeFrameReport(snapshot);
  if (snapshot.width !== expected.width || snapshot.height !== expected.height) {
    return `Native renderer frame ${frameIndex} size mismatch: got ${snapshot.width}x${snapshot.height}, expected ${expected.width}x${expected.height} (${health()})`;
  }
  const expectedBytes = expected.width * expected.height * 4;
  if (Number(snapshot.byte_length ?? 0) !== expectedBytes || Number(snapshot.bytes_written ?? 0) !== expectedBytes) {
    return `Native renderer frame ${frameIndex} byte count mismatch: expected ${expectedBytes} raw bytes (${health()})`;
  }
  const format = pixelFormatOf(snapshot.format);
  if (format !== expected.pixelFormat) {
    return `Native renderer frame ${frameIndex} format changed from ${expected.pixelFormat} to ${format ?? snapshot.format} (${health()})`;
  }
  if (snapshot.drawn === false) {
    return `The render core did not draw frame ${frameIndex} (${health()})`;
  }
  if (snapshot.alpha_mode !== 'straight' && Number(snapshot.transparent_pixels ?? 0) >= expected.width * expected.height) {
    return `The render core returned an empty frame at ${frameIndex}: nothing was drawn into it (${health()})`;
  }
  if (expected.manualClock && snapshot.render_clock !== undefined && snapshot.render_clock !== 'manual') {
    return `The render core left the render's clock at frame ${frameIndex} (it may have restarted) (${health()})`;
  }
  return null;
}

function videoName(video: RenderFrameVideo): string {
  const file = String(video.uri ?? '').split(/[\\/]/).pop() ?? '';
  try { return decodeURIComponent(file) || video.id; } catch { return file || video.id; }
}

/**
 * A playing video must keep changing frame. One render (of a two-minute
 * show with two clips) came out with both videos on their first frame all
 * the way through; a frozen video is now a failed render that says so, not
 * a file that looks fine until someone watches it.
 *
 * A video counts as stopped once it has shown the same frame for longer
 * than two of its own frames at its rate, plus two render frames, while the
 * core says its playback should be moving it.
 */
export class VideoMotionWatch {
  private readonly seen = new Map<string, { key: number; since: number }>();

  constructor(private readonly renderFps: number) {}

  /** The error for a video that stopped, or null. */
  /** `playing`: the source ids the Timeline plays at this frame. One the
   *  core holds paused counts as stopped too (the two disagree). */
  check(renderTime: number, videos: RenderFrameVideo[] | undefined, playing?: ReadonlySet<string>): string | null {
    if (!videos) return null;
    const present = new Set<string>();
    for (const video of videos) {
      present.add(video.id);
      const key = Number.isFinite(video.frame) ? Number(video.frame) : Number(video.time);
      const last = this.seen.get(video.id);
      const shouldMove = video.moving === true || (video.paused === true && !!playing?.has(video.id));
      if (!last || last.key !== key || !shouldMove) {
        this.seen.set(video.id, { key, since: renderTime });
        continue;
      }
      const fps = Number(video.fps) > 0 ? Number(video.fps) : 30;
      const rate = Math.max(1e-6, Math.abs(Number(video.rate ?? 1)) || 1);
      const allowance = 2 / (fps * rate) + 2 / Math.max(1, this.renderFps);
      const held = renderTime - last.since;
      if (held > allowance + 1e-6) {
        const at = Number.isFinite(video.frame) ? `frame ${video.frame}` : `${Number(video.time).toFixed(3)} s`;
        const why = video.moving ? 'while it was playing' : 'held paused while the Timeline plays it';
        return `A video stopped moving in the render: ${videoName(video)} stayed on ${at} for ${held.toFixed(2)} s from ${last.since.toFixed(2)} s ${why} `
          + `(anchor ${Number(video.anchor_time ?? 0).toFixed(3)} s at clock ${Number(video.anchor_clock ?? 0).toFixed(3)} s, seek ${video.seek_generation ?? '?'}). `
          + 'The render was stopped so it does not make a video with a frozen clip. Try it again.';
      }
    }
    for (const id of [...this.seen.keys()]) if (!present.has(id)) this.seen.delete(id);
    return null;
  }
}
