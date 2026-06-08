// Mobile-standalone recorder.
//
// MediaRecorder cannot capture a CSS-composited stack of canvases (it
// only sees one source), so we render a separate "composite" canvas on
// every animation frame: deck A drawn first, deck B drawn over it at
// the current crossfader opacity using the matching globalComposite-
// Operation. captureStream() then exposes that single canvas as a
// MediaStream that MediaRecorder encodes to a WebM blob.
//
// Sizing: defaults to 1280×720 — wide enough to look good shared as a
// promo clip, cheap enough that on-device encoding sustains 30fps on
// phones from ~2022 onward. Aspect-ratio adapts to the source canvas
// once recording starts, so portrait phone output stays portrait.

/** CSS mix-blend-mode → canvas2D globalCompositeOperation. Almost all
 *  values map 1:1; 'normal' is canvas-2D's 'source-over' default. */
const BLEND_MAP: Record<string, GlobalCompositeOperation> = {
  'normal':      'source-over',
  'screen':      'screen',
  'multiply':    'multiply',
  'overlay':     'overlay',
  'difference':  'difference',
  'lighten':     'lighten',
  'darken':      'darken',
  'color-dodge': 'color-dodge',
};

function pickMimeType(): string {
  // Order matters — first supported wins. WebM/VP9 is the best size/
  // quality on Chrome (Android Capacitor); VP8 is the universal fallback;
  // MP4/H264 covers iOS Safari (which only supports MP4 in MediaRecorder).
  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1',
    'video/mp4',
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(m)) return m;
  }
  return '';
}

export function isRecordingSupported(): boolean {
  if (typeof MediaRecorder === 'undefined') return false;
  if (typeof HTMLCanvasElement === 'undefined' || !HTMLCanvasElement.prototype.captureStream) return false;
  return pickMimeType() !== '';
}

/** A single layer in the live composite. The recorder reads these on
 *  every frame so changes during recording are captured live. */
export interface LayerSnapshot {
  canvas: HTMLCanvasElement;
  enabled: boolean;
  opacity: number;
  blendMode: string;
  /** Canvas2D `filter` string — accepts CSS filter syntax (e.g.
   *  `"blur(4px) hue-rotate(30deg)"`) so the recorder matches what the
   *  user sees in the live CSS stack. */
  filter: string;
}

export interface RecorderOptions {
  /** Returns the current layer stack each frame, in render order
   *  (index 0 = bottom). */
  getStack: () => LayerSnapshot[];
  /** Target FPS for the composite render loop + MediaRecorder
   *  timeslice. Defaults to 30. */
  fps?: number;
  /** Composite output width. The height is derived from the bottom
   *  layer's aspect ratio at record-start. Defaults to 1280. */
  width?: number;
  /** Encoder bitrate. Defaults to 6 Mbps (good promo-clip quality at
   *  720p30 without ballooning the file). */
  bitrate?: number;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
  /** Suggested filename (caller can override). */
  filename: string;
}

/** Active recording session — start once, call stop() exactly once.
 *  Throws if MediaRecorder fails (caller should report micError-style). */
export class StandaloneRecorder {
  private opts: Required<RecorderOptions>;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private rafId = 0;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private mimeType = '';
  private startedAt = 0;
  /** Last frame we drew — used to throttle the rAF loop to ~`fps`. */
  private lastFrame = 0;

  constructor(opts: RecorderOptions) {
    this.opts = {
      fps: 30,
      width: 1280,
      bitrate: 6_000_000,
      ...opts,
    };
  }

  start(): void {
    if (this.recorder) return;
    const mime = pickMimeType();
    if (!mime) throw new Error('MediaRecorder unsupported in this browser');
    this.mimeType = mime;

    // Pick the first enabled layer to derive aspect; fall back to 9:16
    // (portrait phone) if the stack hasn't materialised yet.
    const stack = this.opts.getStack();
    const base = stack.find(l => l.enabled && l.canvas) ?? stack[0];
    const srcW = base?.canvas.width  || base?.canvas.clientWidth  || 1920;
    const srcH = base?.canvas.height || base?.canvas.clientHeight || 1080;
    const aspect = srcW > 0 && srcH > 0 ? srcH / srcW : 9 / 16;
    const w = this.opts.width;
    const h = Math.max(2, Math.round((w * aspect) / 2) * 2);  // keep h even — some encoders require it

    this.canvas = document.createElement('canvas');
    this.canvas.width = w;
    this.canvas.height = h;
    const ctx = this.canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D context unavailable for composite canvas');
    this.ctx = ctx;
    // Black backdrop so semi-transparent deck B doesn't reveal the page.
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, w, h);

    const stream = this.canvas.captureStream(this.opts.fps);
    this.recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: this.opts.bitrate,
    });
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size) this.chunks.push(e.data); };
    this.startedAt = performance.now();
    this.lastFrame = 0;
    // 1s timeslice — gives a chunk every second so a crash during
    // record still yields a usable partial file.
    this.recorder.start(1000);
    this.tick();
  }

  /** Stop the recorder and resolve with the assembled blob.
   *  Idempotent — calling stop() twice yields the same blob. */
  async stop(): Promise<RecordingResult | null> {
    if (!this.recorder) return null;
    cancelAnimationFrame(this.rafId);
    const rec = this.recorder;
    const stopAt = performance.now();
    const result = await new Promise<RecordingResult | null>((resolve) => {
      rec.onstop = () => {
        if (this.chunks.length === 0) return resolve(null);
        const blob = new Blob(this.chunks, { type: this.mimeType });
        const durationMs = stopAt - this.startedAt;
        resolve({
          blob,
          mimeType: this.mimeType,
          durationMs,
          filename: defaultFilename(this.mimeType),
        });
      };
      if (rec.state !== 'inactive') rec.stop();
      else resolve(null);
    });
    this.recorder = null;
    this.chunks = [];
    return result;
  }

  /** Current elapsed recording time in seconds. */
  elapsedSec(): number {
    if (!this.startedAt) return 0;
    return (performance.now() - this.startedAt) / 1000;
  }

  private tick = (): void => {
    this.rafId = requestAnimationFrame(this.tick);
    const now = performance.now();
    const interval = 1000 / this.opts.fps;
    if (now - this.lastFrame < interval - 1) return;  // throttle ~30fps
    this.lastFrame = now;

    const { ctx, canvas, opts } = this;
    const w = canvas.width;
    const h = canvas.height;
    const stack = opts.getStack();

    // Clear to black so semi-transparent layers don't reveal page.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    // Composite layers bottom-up. First enabled layer goes down with
    // source-over (no underlying pixels to blend against); each
    // subsequent layer uses its own composite op + opacity.
    let isFirstEnabled = true;
    for (const l of stack) {
      if (!l.enabled || !l.canvas) continue;
      ctx.globalCompositeOperation = isFirstEnabled
        ? 'source-over'
        : (BLEND_MAP[l.blendMode] ?? 'source-over');
      ctx.globalAlpha = Math.max(0, Math.min(1, l.opacity));
      // Canvas2D filter takes CSS-filter syntax — same string as CSS.
      ctx.filter = l.filter && l.filter !== 'none' ? l.filter : 'none';
      try { ctx.drawImage(l.canvas, 0, 0, w, h); }
      catch { /* layer canvas mid-resize — skip frame */ }
      isFirstEnabled = false;
    }

    // Reset for any out-of-loop drawing the caller might do later.
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.filter = 'none';
  };
}

function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }

function defaultFilename(mime: string): string {
  const ext = mime.includes('mp4') ? 'mp4' : 'webm';
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}-${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
  return `ghost-arcade-${stamp}.${ext}`;
}

/** Hand the recording to the user. Tries native Capacitor Share first
 *  (writes the blob to the cache directory then opens the share sheet);
 *  falls back to a synthetic anchor download. Returns the method that
 *  succeeded so the UI can show "Saved" vs "Shared". */
export async function deliverRecording(result: RecordingResult): Promise<'shared' | 'downloaded' | 'failed'> {
  // Native Capacitor handoff — only attempted if @capacitor/filesystem
  // AND @capacitor/share are installed. Dynamic import so the bundle
  // doesn't reference packages that may not be installed.
  try {
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      // Cast through `any` so TypeScript doesn't try to resolve these
      // at type-check time — they're optional native plugins that may
      // not be installed in the project.
      const dynImport = (m: string): Promise<any> =>
        (Function('m', 'return import(m)') as (m: string) => Promise<any>)(m);
      const [fs, share] = await Promise.all([
        dynImport('@capacitor/filesystem').catch(() => null),
        dynImport('@capacitor/share').catch(() => null),
      ]);
      if (fs && share) {
        const base64 = await blobToBase64(result.blob);
        const write = await fs.Filesystem.writeFile({
          path: result.filename,
          data: base64,
          directory: fs.Directory.Cache,
        });
        await share.Share.share({
          title: 'Ghost Arcade clip',
          text: 'Recorded with Ghost Arcade',
          url: write.uri,
          dialogTitle: 'Save or share clip',
        });
        return 'shared';
      }
    }
  } catch { /* fall through to download */ }

  // Web fallback — anchor download. Works in modern mobile Chromium
  // WebViews too (Capacitor 6+ on Android allows anchor downloads).
  try {
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const out = r.result as string;
      const i = out.indexOf(',');
      resolve(i >= 0 ? out.slice(i + 1) : out);
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
