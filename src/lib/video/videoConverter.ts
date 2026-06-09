import { FFmpeg } from '@ffmpeg/ffmpeg';
import ffmpegCoreUrl from '@ffmpeg/core?url';
import ffmpegWasmUrl from '@ffmpeg/core/wasm?url';

export type VideoConversionStage = 'idle' | 'loading' | 'writing' | 'converting' | 'reading' | 'complete' | 'cancelled' | 'error';

export interface VideoConversionProgress {
  stage: VideoConversionStage;
  progress: number;
  message: string;
}

export interface VideoConversionResult {
  blob: Blob;
  filename: string;
}

let ffmpegInstance: FFmpeg | null = null;
let ffmpegLoadPromise: Promise<FFmpeg> | null = null;
let activeConversion = false;
type ActiveVideoConversionJob = {
  ffmpeg: FFmpeg | null;
  cancelled: boolean;
  cancelReason: 'user' | 'stall' | null;
  abortController: AbortController;
};

let activeJob: ActiveVideoConversionJob | null = null;

const CANCELLED_MESSAGE = 'Conversion cancelled.';
const STALLED_MESSAGE = 'Conversion stalled before FFmpeg produced output. Try a shorter WebM, or cancel and retry.';
const STALL_TIMEOUT_MS = 45_000;

function report(
  onProgress: ((progress: VideoConversionProgress) => void) | undefined,
  stage: VideoConversionStage,
  progress: number,
  message: string,
): void {
  onProgress?.({
    stage,
    progress: Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)),
    message,
  });
}

async function loadFFmpeg(
  onProgress: ((progress: VideoConversionProgress) => void) | undefined,
  job: ActiveVideoConversionJob,
): Promise<FFmpeg> {
  if (ffmpegInstance) {
    job.ffmpeg = ffmpegInstance;
    return ffmpegInstance;
  }
  if (ffmpegLoadPromise) return ffmpegLoadPromise;

  report(onProgress, 'loading', 0, 'Loading FFmpeg encoder...');
  ffmpegLoadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    job.ffmpeg = ffmpeg;
    await ffmpeg.load({
      coreURL: ffmpegCoreUrl,
      wasmURL: ffmpegWasmUrl,
    }, { signal: job.abortController.signal });
    if (job.cancelled) throw new Error(CANCELLED_MESSAGE);
    ffmpegInstance = ffmpeg;
    report(onProgress, 'loading', 1, 'FFmpeg ready');
    return ffmpeg;
  })();

  try {
    return await ffmpegLoadPromise;
  } finally {
    ffmpegLoadPromise = null;
  }
}

function outputFilenameFor(inputName: string): string {
  const base = (inputName || 'converted-video')
    .replace(/\.[^.]+$/, '')
    .replace(/[^\w .-]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 90) || 'converted-video';
  return `${base}.mp4`;
}

function isLikelyWebM(file: File): boolean {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  return type === 'video/webm' || name.endsWith('.webm');
}

function parseFfmpegTime(message: string, prefix: 'Duration:' | 'time='): number | null {
  const pattern = prefix === 'Duration:'
    ? /Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/
    : /time=\s*(\d+):(\d+):(\d+)\.(\d+)/;
  const match = message.match(pattern);
  if (!match) return null;
  const h = parseInt(match[1], 10);
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  const frac = parseFloat(`0.${match[4]}`);
  const seconds = h * 3600 + m * 60 + s + frac;
  return Number.isFinite(seconds) ? seconds : null;
}

function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function cancelActiveVideoConversion(): boolean {
  const job = activeJob;
  if (!job) return false;

  job.cancelled = true;
  job.cancelReason = 'user';
  try { job.abortController.abort(); } catch { /* ignore */ }
  try { job.ffmpeg?.terminate(); } catch { /* ignore */ }
  ffmpegInstance = null;
  ffmpegLoadPromise = null;
  return true;
}

export function isVideoConversionCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes(CANCELLED_MESSAGE)
    || message.includes('called FFmpeg.terminate()')
    || message.includes('AbortError')
    || message.includes('was aborted');
}

export function isVideoConversionStalled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes(STALLED_MESSAGE);
}

export async function convertWebMToMp4(
  file: File,
  onProgress?: (progress: VideoConversionProgress) => void,
): Promise<VideoConversionResult> {
  if (activeConversion) {
    throw new Error('A video conversion is already running.');
  }
  if (!isLikelyWebM(file)) {
    throw new Error('Choose a .webm video file.');
  }

  activeConversion = true;
  const job = {
    ffmpeg: null as FFmpeg | null,
    cancelled: false,
    cancelReason: null as 'user' | 'stall' | null,
    abortController: new AbortController(),
  };
  activeJob = job;
  const inputName = 'input.webm';
  const outputName = 'output.mp4';
  let progressHandler: ((data: { progress: number }) => void) | null = null;
  let logHandler: ((data: { message: string }) => void) | null = null;

  try {
    const ffmpeg = await loadFFmpeg(onProgress, job);
    job.ffmpeg = ffmpeg;
    if (job.cancelled) throw new Error(CANCELLED_MESSAGE);

    // Best-effort cleanup from any prior interrupted run.
    try { await ffmpeg.deleteFile(inputName, { signal: job.abortController.signal }); } catch { /* ignore */ }
    try { await ffmpeg.deleteFile(outputName, { signal: job.abortController.signal }); } catch { /* ignore */ }

    report(onProgress, 'writing', 0.08, 'Reading WebM file...');
    const inputBytes = new Uint8Array(await file.arrayBuffer());
    if (job.cancelled) throw new Error(CANCELLED_MESSAGE);
    await ffmpeg.writeFile(inputName, inputBytes, { signal: job.abortController.signal });

    report(onProgress, 'converting', 0.12, 'Converting to high-quality MP4...');
    let detectedDuration = 0;
    let bestEncodeProgress = 0;
    const encodeStartedAt = performance.now();
    let lastActivityAt = encodeStartedAt;
    let stallError: Error | null = null;
    const publishEncodeProgress = (progress: number) => {
      if (job.cancelled) return;
      const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
      if (p <= bestEncodeProgress) return;
      bestEncodeProgress = p;
      report(onProgress, 'converting', 0.12 + p * 0.78, `Converting to high-quality MP4 (${Math.round(p * 100)}%)...`);
    };
    const publishHeuristicProgress = (message: string) => {
      if (job.cancelled) return;
      const elapsedSec = (performance.now() - encodeStartedAt) / 1000;
      // WebM files from MediaRecorder often report Duration: N/A, so
      // ffmpeg.wasm cannot produce reliable percentage progress. Keep
      // the UI alive with a conservative heartbeat that never claims
      // completion; real progress events can still overtake it.
      const slowDrift = 0.12 + Math.min(0.60, (1 - Math.exp(-elapsedSec / 60)) * 0.60);
      if (slowDrift <= bestEncodeProgress) return;
      bestEncodeProgress = slowDrift;
      report(onProgress, 'converting', slowDrift, `${message} (${formatElapsed(elapsedSec)})...`);
    };
    progressHandler = ({ progress }: { progress: number }) => {
      lastActivityAt = performance.now();
      publishEncodeProgress(progress || 0);
    };
    logHandler = ({ message }: { message: string }) => {
      lastActivityAt = performance.now();
      const duration = parseFfmpegTime(message, 'Duration:');
      if (duration && duration > 0) detectedDuration = duration;

      const time = parseFfmpegTime(message, 'time=');
      if (time !== null && detectedDuration > 0) {
        publishEncodeProgress(time / detectedDuration);
      } else if (time !== null || /frame=\s*\d+/.test(message)) {
        publishHeuristicProgress('Encoding MP4');
      }
    };
    ffmpeg.on('progress', progressHandler);
    ffmpeg.on('log', logHandler);

    const command = [
      '-fflags', '+genpts',
      '-i', inputName,
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-crf', '18',
      '-pix_fmt', 'yuv420p',
      '-threads', '1',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-ar', '48000',
      '-ac', '2',
      '-movflags', '+faststart',
      '-avoid_negative_ts', 'make_zero',
      '-max_muxing_queue_size', '1024',
      outputName,
    ];

    const heartbeat = window.setInterval(() => {
      if (job.cancelled) return;
      publishHeuristicProgress('Encoding MP4');
      if (performance.now() - lastActivityAt > STALL_TIMEOUT_MS) {
        stallError = new Error(STALLED_MESSAGE);
        job.cancelled = true;
        job.cancelReason = 'stall';
        try { job.abortController.abort(); } catch { /* ignore */ }
        try { ffmpeg.terminate(); } catch { /* ignore */ }
        ffmpegInstance = null;
        ffmpegLoadPromise = null;
      }
    }, 1000);

    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(command, -1, { signal: job.abortController.signal });
    } finally {
      window.clearInterval(heartbeat);
    }
    if (stallError) throw stallError;
    if (job.cancelled) throw new Error(CANCELLED_MESSAGE);
    if (exitCode !== 0) {
      throw new Error(`FFmpeg conversion failed with exit code ${exitCode}.`);
    }

    if (progressHandler) {
      ffmpeg.off('progress', progressHandler);
      progressHandler = null;
    }
    if (logHandler) {
      ffmpeg.off('log', logHandler);
      logHandler = null;
    }

    report(onProgress, 'reading', 0.94, 'Preparing download...');
    const outputData = await ffmpeg.readFile(outputName, 'binary', { signal: job.abortController.signal });
    const u8 = outputData instanceof Uint8Array ? outputData : new Uint8Array(outputData as any);
    const blob = new Blob([u8 as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });

    report(onProgress, 'complete', 1, 'Conversion complete');
    return {
      blob,
      filename: outputFilenameFor(file.name),
    };
  } catch (error) {
    if (job.cancelReason === 'stall') {
      ffmpegInstance = null;
      ffmpegLoadPromise = null;
      throw new Error(STALLED_MESSAGE);
    }
    if (job.cancelled || isVideoConversionCancelled(error)) {
      ffmpegInstance = null;
      ffmpegLoadPromise = null;
      throw new Error(CANCELLED_MESSAGE);
    }
    throw error;
  } finally {
    const ffmpeg = job.ffmpeg;
    if (ffmpeg && progressHandler) {
      try { ffmpeg.off('progress', progressHandler); } catch { /* ignore */ }
    }
    if (ffmpeg && logHandler) {
      try { ffmpeg.off('log', logHandler); } catch { /* ignore */ }
    }
    if (ffmpeg && !job.cancelled && ffmpegInstance === ffmpeg) {
      try { await ffmpeg.deleteFile(inputName); } catch { /* ignore */ }
      try { await ffmpeg.deleteFile(outputName); } catch { /* ignore */ }
    }
    if (activeJob === job) activeJob = null;
    activeConversion = false;
  }
}
