/*
 * Frames of one phone feed to the render core.
 *
 * A WebRTC track can only be read in the renderer (the decoded picture is
 * not a texture the core can open), so each frame is copied out once and
 * goes up the same way three.js / p5 pages do: raw RGBA over IPC, written
 * into the source slot as sent (`placement: "rect"`, no resample, no mips).
 *
 * Pacing: frames are read as the track delivers them, so uploads never run
 * faster than the phone sends. One upload is in flight at a time; a frame
 * that arrives meanwhile is dropped, never queued. Once the core has shown a
 * frame, frames go up only while a visible layer shows the feed.
 *
 * Memory: one pixel buffer per feed, sized to the picture (at most the
 * core's slot edge squared × 4), reused for every frame.
 */

/** The parts of a WebCodecs VideoFrame this pump uses. */
export type PumpFrame = {
  readonly displayWidth: number;
  readonly displayHeight: number;
  readonly timestamp: number;
  copyTo(destination: Uint8Array, options?: { format?: string }): Promise<unknown>;
  close(): void;
  metadata?(): { captureTime?: number; receiveTime?: number; rtpTimestamp?: number } | undefined;
};

/** Delivers frames until it returns null (the track ended) or is cancelled. */
export type PumpFrameSource = {
  read(): Promise<PumpFrame | null>;
  cancel(): void;
};

export type PumpSink = {
  /** Sends one frame; resolves true when the core took it. */
  upload(command: PhoneFeedUploadCommand | PhoneFeedBlankCommand): Promise<boolean>;
  /** Whether the core has a frame for this source id. */
  shown(sourceId: string): Promise<boolean>;
};

export type PhoneFeedUploadCommand = {
  type: 'upload_source_frame';
  source_id: string;
  seq: number;
  width: number;
  height: number;
  rgba_buffer: Uint8Array;
  placement: 'rect';
};

/** A see-through 2×2 frame: the feed shows nothing (not a frozen picture, not a loading card). */
export type PhoneFeedBlankCommand = {
  type: 'upload_source_frame';
  source_id: string;
  seq: number;
  width: 2;
  height: 2;
  rgba_b64: string;
  placement: 'rect';
};

export function phoneFeedBlankCommand(sourceId: string): PhoneFeedBlankCommand {
  return { type: 'upload_source_frame', source_id: sourceId, seq: nextPhoneFeedSeq(), width: 2, height: 2, rgba_b64: 'AAAAAAAAAAAAAAAAAAAAAA==', placement: 'rect' };
}

export type PumpScaler = (frame: PumpFrame, width: number, height: number, out: Uint8Array) => Promise<boolean>;

export type PhoneFeedPumpOptions = {
  sourceId: string;
  frames: PumpFrameSource;
  sink: PumpSink;
  /** The core's slot edge: larger pictures are scaled down to fit. */
  maxEdge: () => number;
  /** Whether a visible layer shows this feed now. */
  wanted: (now: number) => boolean;
  now?: () => number;
  /** First frame the core has (once per pump). */
  onShown?: (now: number) => void;
  /** Every frame that arrives (for stall recovery; keep it cheap). */
  onFrame?: (now: number, width: number, height: number) => void;
  /** The first frame, once, for a still. */
  onFirstFrame?: (frame: PumpFrame) => Promise<void> | void;
  /** Copies a frame scaled (or when the frame cannot convert to RGBA itself). */
  scale?: PumpScaler;
};

/** Samples kept for the pacing and latency numbers. */
export const PUMP_STATS_WINDOW = 120;

/** How often to ask the core whether it has the first frame yet. */
const SHOWN_POLL_MS = 200;

/** Upload sequence numbers: the core keeps the newest per source, across sessions and renderer reloads. */
let nextSeq = Date.now();
export function nextPhoneFeedSeq(): number {
  nextSeq += 1;
  return nextSeq;
}

class Ring {
  private values = new Float64Array(PUMP_STATS_WINDOW);
  private count = 0;
  private index = 0;
  push(value: number) {
    if (!Number.isFinite(value)) return;
    this.values[this.index] = value;
    this.index = (this.index + 1) % PUMP_STATS_WINDOW;
    this.count = Math.min(PUMP_STATS_WINDOW, this.count + 1);
  }
  summary(): { avg: number; p95: number; max: number; n: number } | null {
    if (!this.count) return null;
    const sorted = Array.from(this.values.subarray(0, this.count)).sort((a, b) => a - b);
    const sum = sorted.reduce((s, v) => s + v, 0);
    const round = (v: number) => Math.round(v * 10) / 10;
    return { avg: round(sum / this.count), p95: round(sorted[Math.min(this.count - 1, Math.floor(this.count * 0.95))]), max: round(sorted[this.count - 1]), n: this.count };
  }
}

export type PhoneFeedPumpStats = {
  framesIn: number;
  uploads: number;
  /** Arrived while an upload was in flight. */
  dropped: number;
  /** Not uploaded because no visible layer shows the feed. */
  idle: number;
  errors: number;
  width: number;
  height: number;
  /** Time between frames arriving from the phone. */
  arrivalMs: ReturnType<Ring['summary']>;
  /** Copying a frame out of the decoder. */
  copyMs: ReturnType<Ring['summary']>;
  /** Frame arrival to the core having it. */
  receiveToCoreMs: ReturnType<Ring['summary']>;
  /** Phone capture to the core having it, when the frame carries a capture time. */
  captureToCoreMs: ReturnType<Ring['summary']>;
  /** Network: phone capture to arrival here, when known. */
  captureToReceiveMs: ReturnType<Ring['summary']>;
};

export function phoneFeedFitSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  const edge = Math.max(16, Math.floor(maxEdge) || 2048);
  if (w <= edge && h <= edge) return { width: w, height: h };
  const scale = Math.min(edge / w, edge / h);
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}

export class PhoneFeedPump {
  private stopped = false;
  private busy = false;
  private shown = false;
  private lastShownPollAt = -Infinity;
  private firstFrameSeen = false;
  private buffer: Uint8Array | null = null;
  private rgbaConversion = true;
  private readonly now: () => number;
  private lastArrival = 0;
  private readonly arrival = new Ring();
  private readonly copy = new Ring();
  private readonly receiveToCore = new Ring();
  private readonly captureToCore = new Ring();
  private readonly captureToReceive = new Ring();
  private counts = { framesIn: 0, uploads: 0, dropped: 0, idle: 0, errors: 0 };
  private size = { width: 0, height: 0 };
  /** When the newest frame arrived (0 = none yet). */
  lastFrameAt = 0;
  readonly done: Promise<void>;

  constructor(private readonly options: PhoneFeedPumpOptions) {
    this.now = options.now ?? (() => performance.now());
    this.done = this.run();
  }

  get hasShownFrame(): boolean {
    return this.shown;
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    try { this.options.frames.cancel(); } catch { /* already gone */ }
    this.buffer = null;
  }

  stats(): PhoneFeedPumpStats {
    return {
      ...this.counts,
      ...this.size,
      arrivalMs: this.arrival.summary(),
      copyMs: this.copy.summary(),
      receiveToCoreMs: this.receiveToCore.summary(),
      captureToCoreMs: this.captureToCore.summary(),
      captureToReceiveMs: this.captureToReceive.summary(),
    };
  }

  private async run(): Promise<void> {
    while (!this.stopped) {
      let frame: PumpFrame | null;
      try {
        frame = await this.options.frames.read();
      } catch {
        break;
      }
      if (!frame) break;
      if (this.stopped) { frame.close(); break; }
      this.accept(frame);
    }
    this.stop();
  }

  private accept(frame: PumpFrame): void {
    const now = this.now();
    this.counts.framesIn += 1;
    if (this.lastArrival) this.arrival.push(now - this.lastArrival);
    this.lastArrival = now;
    this.lastFrameAt = now;
    const width = frame.displayWidth;
    const height = frame.displayHeight;
    if (!(width > 0 && height > 0)) { frame.close(); return; }
    this.options.onFrame?.(now, width, height);
    if (!this.firstFrameSeen) {
      this.firstFrameSeen = true;
      // A still for the tray; it holds its own copy, so this frame can go on.
      try { void Promise.resolve(this.options.onFirstFrame?.(frame)).catch(() => {}); } catch { /* still optional */ }
    }
    if (this.busy) { this.counts.dropped += 1; frame.close(); return; }
    if (this.shown && !this.options.wanted(now)) { this.counts.idle += 1; frame.close(); return; }
    this.busy = true;
    void this.send(frame, now).finally(() => { this.busy = false; });
  }

  private async send(frame: PumpFrame, receivedAt: number): Promise<void> {
    let meta: ReturnType<NonNullable<PumpFrame['metadata']>> | undefined;
    try { meta = frame.metadata?.(); } catch { meta = undefined; }
    const fit = phoneFeedFitSize(frame.displayWidth, frame.displayHeight, this.options.maxEdge());
    const bytes = fit.width * fit.height * 4;
    if (!this.buffer || this.buffer.byteLength !== bytes) this.buffer = new Uint8Array(bytes);
    const out = this.buffer;
    const copyStart = this.now();
    let copied = false;
    try {
      const native = fit.width === frame.displayWidth && fit.height === frame.displayHeight;
      if (native && this.rgbaConversion) {
        try {
          await frame.copyTo(out, { format: 'RGBA' });
          copied = true;
        } catch {
          // This Chromium cannot convert while copying: draw instead, from now on.
          this.rgbaConversion = false;
        }
      }
      if (!copied && this.options.scale) copied = await this.options.scale(frame, fit.width, fit.height, out);
    } catch {
      copied = false;
    } finally {
      frame.close();
    }
    if (!copied || this.stopped) { if (!copied) this.counts.errors += 1; return; }
    this.copy.push(this.now() - copyStart);
    let accepted = false;
    try {
      accepted = await this.options.sink.upload({
        type: 'upload_source_frame',
        source_id: this.options.sourceId,
        seq: nextPhoneFeedSeq(),
        width: fit.width,
        height: fit.height,
        rgba_buffer: out,
        placement: 'rect',
      });
    } catch {
      accepted = false;
    }
    if (!accepted) { this.counts.errors += 1; return; }
    const atCore = this.now();
    this.counts.uploads += 1;
    this.size = fit;
    this.receiveToCore.push(atCore - receivedAt);
    if (meta?.captureTime && meta.captureTime > 0) this.captureToCore.push(atCore - meta.captureTime);
    if (meta?.captureTime && meta?.receiveTime && meta.receiveTime > meta.captureTime) {
      this.captureToReceive.push(meta.receiveTime - meta.captureTime);
    }
    if (!this.shown && !this.stopped && atCore - this.lastShownPollAt >= SHOWN_POLL_MS) {
      this.lastShownPollAt = atCore;
      let ready = false;
      try { ready = await this.options.sink.shown(this.options.sourceId); } catch { ready = false; }
      if (ready && !this.shown && !this.stopped) {
        this.shown = true;
        this.options.onShown?.(this.now());
      }
    }
  }
}

// ── Browser glue (Electron renderer) ─────────────────────────────────────

/** Frames of a track: MediaStreamTrackProcessor where Chromium has it, else a video element. */
export function trackFrameSource(track: MediaStreamTrack): PumpFrameSource {
  const Processor = (globalThis as any).MediaStreamTrackProcessor;
  if (typeof Processor === 'function') {
    // Two frames of slack; older ones are dropped by Chromium, never queued.
    const reader = new Processor({ track, maxBufferSize: 2 }).readable.getReader();
    return {
      async read() {
        const { value, done } = await reader.read();
        return done ? null : (value as PumpFrame);
      },
      cancel() { void reader.cancel().catch(() => {}); },
    };
  }
  return videoElementFrameSource(track);
}

function videoElementFrameSource(track: MediaStreamTrack): PumpFrameSource {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.srcObject = new MediaStream([track]);
  void video.play().catch(() => {});
  let cancelled = false;
  let wake: ((frame: PumpFrame | null) => void) | null = null;
  const ended = () => wake?.(null);
  track.addEventListener('ended', ended);
  return {
    read() {
      if (cancelled) return Promise.resolve(null);
      return new Promise((resolve) => {
        wake = resolve;
        (video as any).requestVideoFrameCallback?.(() => {
          if (cancelled) { resolve(null); return; }
          try { resolve(new (globalThis as any).VideoFrame(video, { timestamp: Math.round(performance.now() * 1000) })); } catch { resolve(null); }
        });
      });
    },
    cancel() {
      cancelled = true;
      track.removeEventListener('ended', ended);
      wake?.(null);
      try { video.pause(); video.srcObject = null; } catch { /* gone */ }
    },
  };
}

/** Scaled copies (and copies where VideoFrame cannot convert): GPU resize, then a small canvas readback. */
export function canvasScaler(): PumpScaler {
  let canvas: OffscreenCanvas | null = null;
  let context: OffscreenCanvasRenderingContext2D | null = null;
  return async (frame, width, height, out) => {
    if (typeof OffscreenCanvas === 'undefined') return false;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      context = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!context) return false;
    context.drawImage(frame as unknown as CanvasImageSource, 0, 0, width, height);
    out.set(context.getImageData(0, 0, width, height).data);
    return true;
  };
}

/** A small JPEG still of a frame, for the tray and new deck cells. */
export async function phoneFeedThumbnail(frame: PumpFrame, maxWidth = 192): Promise<string> {
  if (typeof OffscreenCanvas === 'undefined' || typeof FileReader === 'undefined') return '';
  const scale = Math.min(1, maxWidth / Math.max(1, frame.displayWidth));
  const width = Math.max(1, Math.round(frame.displayWidth * scale));
  const height = Math.max(1, Math.round(frame.displayHeight * scale));
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) return '';
  context.drawImage(frame as unknown as CanvasImageSource, 0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
  return await new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => resolve('');
    reader.readAsDataURL(blob);
  });
}
