// Records what goes to the projector, for saving to Photos and sharing.
//
// The program canvas is WebGL without a kept drawing buffer, so it cannot be copied at an arbitrary
// moment. It is read the same way the external display reads it: canvas capture into a video
// element. Each frame that video is drawn into a 2D composite with the optional camera view of the
// wall and the optional corner mark, and the composite is encoded by MediaRecorder (MP4/H.264 in
// the iOS app). Encoded pieces leave the web view about once a second (see recordingFiles.ts), so a
// long take never sits in memory.

export type CameraLayout = 'off' | 'side' | 'inset';
export type RecordingOptions = { camera: CameraLayout; mark: boolean };
export type Rect = { x: number; y: number; w: number; h: number };
export type RecordingLayout = { width: number; height: number; program: Rect; camera: Rect | null; mark: Rect | null };

export const RECORDING_OPTIONS_KEY = 'ga-mobile-recording-v1';
export const defaultRecordingOptions = (): RecordingOptions => ({ camera: 'off', mark: true });
export function normalizeRecordingOptions(raw: unknown): RecordingOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<RecordingOptions>;
  return { camera: r.camera === 'side' || r.camera === 'inset' ? r.camera : 'off', mark: r.mark !== false };
}
export function loadRecordingOptions(): RecordingOptions {
  try { return normalizeRecordingOptions(JSON.parse(localStorage.getItem(RECORDING_OPTIONS_KEY) || '{}')); } catch { return defaultRecordingOptions(); }
}
export function saveRecordingOptions(options: RecordingOptions): void {
  try { localStorage.setItem(RECORDING_OPTIONS_KEY, JSON.stringify(normalizeRecordingOptions(options))); } catch { /* only costs the choice */ }
}

/** MP4 first: it is what Photos, Messages and every share target accept. WebM only where MP4 cannot be made. */
export const MIME_CANDIDATES = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
export function pickMimeType(isSupported: (type: string) => boolean = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)): string {
  return MIME_CANDIDATES.find((t) => { try { return isSupported(t); } catch { return false; } }) ?? '';
}
export function isRecordingSupported(): boolean {
  if (typeof MediaRecorder === 'undefined' || typeof HTMLCanvasElement === 'undefined') return false;
  if (typeof HTMLCanvasElement.prototype.captureStream !== 'function') return false;
  return pickMimeType() !== '';
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
/**
 * Where everything goes in the recorded frame. The program keeps its own size (clamped between
 * 960 and 1920 wide); side by side puts the camera and the program next to each other in a
 * 1920-wide frame; inset puts the camera in the lower left so the mark keeps the lower right.
 */
export function recordingLayout(options: RecordingOptions, programWidth: number, programHeight: number): RecordingLayout {
  const aspect = programWidth > 0 && programHeight > 0 ? programWidth / programHeight : 16 / 9;
  const width = even(Math.min(1920, Math.max(960, programWidth || 1280)));
  const height = even(width / aspect);
  let frame = { width, height };
  let program: Rect = { x: 0, y: 0, w: width, h: height };
  let camera: Rect | null = null;
  if (options.camera === 'side') {
    // Two 960-wide tiles: a 1920-wide frame whatever the program size, so neither half gets small.
    const tileW = 960, tileH = even(tileW / aspect);
    frame = { width: tileW * 2, height: tileH };
    camera = { x: 0, y: 0, w: tileW, h: tileH };
    program = { x: tileW, y: 0, w: tileW, h: tileH };
  } else if (options.camera === 'inset') {
    const w = even(width * 0.3), h = even(w / aspect), margin = Math.round(height * 0.04);
    camera = { x: margin, y: height - h - margin, w, h };
  }
  let mark: Rect | null = null;
  if (options.mark) {
    const h = Math.max(18, Math.round(frame.height * 0.042)), w = Math.round(h * 6.2), margin = Math.round(frame.height * 0.035);
    mark = { x: frame.width - w - margin, y: frame.height - h - margin, w, h };
  }
  return { ...frame, program, camera, mark };
}

/** The part of a source that fills `target` without distortion, cut from the middle. */
export function coverCrop(sourceWidth: number, sourceHeight: number, target: Pick<Rect, 'w' | 'h'>): { sx: number; sy: number; sw: number; sh: number } {
  if (!(sourceWidth > 0 && sourceHeight > 0 && target.w > 0 && target.h > 0)) return { sx: 0, sy: 0, sw: Math.max(0, sourceWidth), sh: Math.max(0, sourceHeight) };
  const want = target.w / target.h, have = sourceWidth / sourceHeight;
  if (have > want) { const sw = sourceHeight * want; return { sx: (sourceWidth - sw) / 2, sy: 0, sw, sh: sourceHeight }; }
  const sh = sourceWidth / want;
  return { sx: 0, sy: (sourceHeight - sh) / 2, sw: sourceWidth, sh };
}

export function recordingFilename(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `Ghost Arcade ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}.${p(date.getSeconds())}.mp4`;
}

/** Where the encoded pieces go: the app's recording file, or memory in a browser. */
/** Wall-clock milliseconds, on the clock the app's native side also reads (to lay sound against the picture). */
export const wallClock = (): number => performance.timeOrigin + performance.now();

/** Which sound a take carries, as the app answered when it began. */
export type TakeSound = { source: 'off' | 'mic' | 'player' | 'phone'; recorded: boolean };

export interface RecordingSink {
  /** Starts the file (and in the app, the sound) and says which sound the take will carry. */
  begin(mimeType: string): Promise<TakeSound | void>;
  /** The moment the video started, so the sound can be laid against it. */
  videoStarted?(at: number): void;
  append(chunk: Blob): Promise<void>;
  finish(filename: string): Promise<RecordingResult>;
  discard(): Promise<void>;
}
export type RecordingResult = {
  /** The app's id for the file (save and share go through it), absent in a browser. */
  id?: string;
  /** A URL the web view can play for the preview. */
  url: string;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  mimeType: string;
  filename: string;
  /** Browser only: the file itself. */
  blob?: Blob;
  /** The file has a sound track (silent when nothing could be recorded). */
  sound?: boolean;
};

export type RecorderParts = {
  /** The program canvas now (it changes when visuals restart on a fresh canvas). */
  source: () => HTMLCanvasElement | null;
  /** The camera view of the wall, when the layout uses one. */
  camera?: HTMLVideoElement | null;
  options: RecordingOptions;
  sink: RecordingSink;
  fps?: number;
  /** Encoder bit rate. 8 Mbps keeps a 720p or 1080p projection crisp after a messenger re-encodes it. */
  bitrate?: number;
  /** A take ends by itself at this length. */
  maxMs?: number;
  /** The mark artwork; drawn as text alone when absent. */
  markImage?: HTMLImageElement | null;
  /** Called once when recording stops on its own: the length limit, the app leaving the screen, or an error. */
  onstop?: (reason: 'limit' | 'hidden' | 'error', message?: string) => void;
};

/** One take: start once, then stop (keep) or cancel (throw away). */
export class ProgramRecorder {
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private feed: HTMLVideoElement | null = null;
  private feedCanvas: HTMLCanvasElement | null = null;
  private feedStream: MediaStream | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private layout!: RecordingLayout;
  private frame = 0;
  private lastDraw = 0;
  private startedAt = 0;
  private writes: Promise<void> = Promise.resolve();
  private writeError: Error | null = null;
  private stopping: Promise<RecordingResult> | null = null;
  private limitTimer: ReturnType<typeof setTimeout> | undefined;
  private hidden = () => { if (document.visibilityState === 'hidden') this.autoStop('hidden'); };
  readonly mimeType: string;
  /** The sound this take carries, once started (null in a browser). */
  sound: TakeSound | null = null;
  private fps: number;

  constructor(private parts: RecorderParts) {
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Recording is not available on this device.');
    this.ctx = ctx;
    this.mimeType = pickMimeType();
    if (!this.mimeType || typeof this.canvas.captureStream !== 'function') throw new Error('This device cannot record video here.');
    this.fps = parts.fps ?? 30;
  }

  async start(): Promise<void> {
    const source = this.parts.source();
    if (!source) throw new Error('The visuals are not running.');
    this.layout = recordingLayout(this.parts.options, source.width, source.height);
    this.canvas.width = this.layout.width;
    this.canvas.height = this.layout.height;
    this.paintBlack();
    this.attachFeed(source);
    try { this.sound = (await this.parts.sink.begin(this.mimeType)) || null; } catch (e) { this.release(); throw e; }
    this.stream = this.canvas.captureStream(this.fps);
    try {
      this.recorder = new MediaRecorder(this.stream, { mimeType: this.mimeType, videoBitsPerSecond: this.parts.bitrate ?? 8_000_000 });
    } catch (e) {
      this.release();
      await this.parts.sink.discard();
      throw e instanceof Error ? e : new Error('Recording could not start.');
    }
    this.recorder.ondataavailable = (e) => {
      if (!e.data?.size) return;
      // Pieces are written in order; a failed write stops the take and is reported once.
      this.writes = this.writes.then(() => (this.writeError ? undefined : this.parts.sink.append(e.data))).catch((error) => {
        if (!this.writeError) { this.writeError = error instanceof Error ? error : new Error(String(error)); this.autoStop('error', this.writeError.message); }
      });
    };
    this.recorder.onerror = () => this.autoStop('error', 'The recording stopped unexpectedly.');
    this.startedAt = performance.now();
    // The picture starts when MediaRecorder says it has started (WebKit: about 0.1 s after start()),
    // not at the call: measured against a click track, the call is too early by about that much.
    this.recorder.addEventListener('start', () => this.stampStart(), { once: true });
    this.recorder.start(1000);
    this.tick();
    document.addEventListener('visibilitychange', this.hidden);
    const maxMs = this.parts.maxMs ?? 5 * 60_000;
    this.limitTimer = setTimeout(() => this.autoStop('limit'), maxMs);
  }

  /** Seconds since the take started. */
  elapsed(): number { return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0; }

  /** Ends the take and hands back the finished file. Safe to call more than once. */
  stop(filename = recordingFilename()): Promise<RecordingResult> {
    this.stopping ??= this.finish(filename);
    return this.stopping;
  }

  /** Ends the take and deletes what was written. */
  async cancel(): Promise<void> {
    try { await this.stop(); } catch { /* nothing to keep */ }
    await this.parts.sink.discard().catch(() => undefined);
  }

  private autoStop(reason: 'limit' | 'hidden' | 'error', message?: string) {
    if (this.stopping) return;
    this.parts.onstop?.(reason, message);
  }

  private stamped = false;
  private stampStart(at = wallClock()) {
    if (this.stamped) return;
    this.stamped = true;
    this.parts.sink.videoStarted?.(at);
  }

  private async finish(filename: string): Promise<RecordingResult> {
    clearTimeout(this.limitTimer);
    // A take stopped before the start event still needs a start: the call's own moment.
    this.stampStart(performance.timeOrigin + this.startedAt);
    document.removeEventListener('visibilitychange', this.hidden);
    const recorder = this.recorder;
    if (recorder && recorder.state !== 'inactive') {
      await new Promise<void>((resolve) => { recorder.addEventListener('stop', () => resolve(), { once: true }); recorder.stop(); });
    }
    cancelAnimationFrame(this.frame);
    this.release();
    await this.writes;
    if (this.writeError) { await this.parts.sink.discard().catch(() => undefined); throw this.writeError; }
    return this.parts.sink.finish(filename);
  }

  private release() {
    cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.detachFeed();
  }

  private attachFeed(source: HTMLCanvasElement) {
    this.detachFeed();
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true; video.autoplay = true;
    this.feedStream = source.captureStream(this.fps);
    video.srcObject = this.feedStream;
    void video.play().catch(() => undefined);
    this.feed = video;
    this.feedCanvas = source;
  }
  private detachFeed() {
    this.feedStream?.getTracks().forEach((t) => t.stop());
    this.feedStream = null;
    if (this.feed) { try { this.feed.pause(); this.feed.srcObject = null; } catch { /* gone */ } }
    this.feed = null;
    this.feedCanvas = null;
  }

  private paintBlack() {
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private tick = () => {
    this.frame = requestAnimationFrame(this.tick);
    const now = performance.now();
    if (now - this.lastDraw < 1000 / this.fps - 2) return;
    this.lastDraw = now;
    // Visuals restarted on a fresh canvas: follow it.
    const source = this.parts.source();
    if (source && source !== this.feedCanvas) this.attachFeed(source);
    this.draw();
  };

  private draw() {
    const { ctx, layout } = this;
    this.paintBlack();
    const feed = this.feed;
    if (feed && feed.readyState >= 2) {
      try { ctx.drawImage(feed, layout.program.x, layout.program.y, layout.program.w, layout.program.h); } catch { /* a frame mid-resize */ }
    }
    const camera = this.parts.camera;
    if (layout.camera && camera && camera.readyState >= 2 && camera.videoWidth > 0) {
      const c = layout.camera, crop = coverCrop(camera.videoWidth, camera.videoHeight, c);
      try {
        ctx.drawImage(camera, crop.sx, crop.sy, crop.sw, crop.sh, c.x, c.y, c.w, c.h);
        if (this.parts.options.camera === 'inset') { ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(2, layout.height / 360); ctx.strokeRect(c.x, c.y, c.w, c.h); }
      } catch { /* camera frame not ready */ }
    }
    if (layout.mark) drawMark(ctx, layout.mark, this.parts.markImage ?? null);
  }
}

/** The corner mark: the app icon and the name, white over a soft shadow so it reads on any picture. */
export function drawMark(ctx: CanvasRenderingContext2D, r: Rect, image: HTMLImageElement | null): void {
  ctx.save();
  ctx.globalAlpha = 0.82;
  ctx.shadowColor = 'rgba(0,0,0,.6)';
  ctx.shadowBlur = r.h * 0.5;
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(r.h * 0.56)}px system-ui, -apple-system, sans-serif`;
  // Wide tracking, drawn a letter at a time (canvas letterSpacing is not on every iOS version).
  const letters = [...'GHOST ARCADE'], spacing = r.h * 0.08;
  const widths = letters.map((l) => ctx.measureText(l).width);
  const text = widths.reduce((a, b) => a + b, 0) + spacing * (letters.length - 1);
  const icon = image && image.complete && image.naturalWidth > 0;
  // Right-aligned in its box, so it always keeps the same distance from the corner.
  let x = r.x + r.w - text - (icon ? r.h * 1.3 : 0);
  if (icon) { ctx.drawImage(image!, x, r.y, r.h, r.h); x += r.h * 1.3; }
  letters.forEach((letter, i) => { ctx.fillText(letter, x, r.y + r.h / 2); x += widths[i] + spacing; });
  ctx.restore();
}
