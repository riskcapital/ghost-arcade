/**
 * Video Loop Creator
 *
 * Creates seamless loops using the "cross dissolve" technique:
 * 1. Read the video as two inputs
 * 2. Trim first input: 0 to midpoint (second half of original becomes start)
 * 3. Trim second input: midpoint to end (first half of original becomes end)
 * 4. Apply xfade crossfade at the junction
 *
 * Single-pass approach avoids keyframe alignment issues from stream-copy splits.
 */

// NOTE: @ffmpeg/ffmpeg is ~10MB. We dynamic-import it inside initFFmpeg()
// so the main bundle stays lean and only users who actually open the
// video-loop creator pay the cost.
import type { FFmpeg as FFmpegType } from '@ffmpeg/ffmpeg';

// Singleton FFmpeg instance
let ffmpeg: FFmpegType | null = null;
let ffmpegLoaded = false;
let ffmpegLoading = false;

export interface LoopProgress {
  stage: 'loading' | 'processing' | 'rendering' | 'complete' | 'error';
  progress: number; // 0-1
  message: string;
}

export type ProgressCallback = (progress: LoopProgress) => void;

// FFmpeg xfade transition types
export type LoopTransitionType =
  | 'fade'
  | 'dissolve'
  | 'pixelize'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'smoothleft'
  | 'smoothright'
  | 'smoothup'
  | 'smoothdown'
  | 'circlecrop'
  | 'circleclose'
  | 'circleopen'
  | 'radial'
  | 'horzclose'
  | 'horzopen'
  | 'vertclose'
  | 'vertopen';

export const LOOP_TRANSITIONS: { value: LoopTransitionType; label: string }[] = [
  { value: 'fade', label: 'Cross Dissolve' },
  { value: 'dissolve', label: 'Dissolve (Dither)' },
  { value: 'pixelize', label: 'Pixelate' },
  { value: 'wipeleft', label: 'Wipe Left' },
  { value: 'wiperight', label: 'Wipe Right' },
  { value: 'wipeup', label: 'Wipe Up' },
  { value: 'wipedown', label: 'Wipe Down' },
  { value: 'slideleft', label: 'Slide Left' },
  { value: 'slideright', label: 'Slide Right' },
  { value: 'circlecrop', label: 'Circle Crop' },
  { value: 'circleclose', label: 'Circle Close' },
  { value: 'circleopen', label: 'Circle Open' },
  { value: 'radial', label: 'Radial' },
  { value: 'horzclose', label: 'Horizontal Close' },
  { value: 'horzopen', label: 'Horizontal Open' },
  { value: 'vertclose', label: 'Vertical Close' },
  { value: 'vertopen', label: 'Vertical Open' },
];

/**
 * Initialize FFmpeg (lazy load). Dynamic-imports the ~10MB library on demand.
 */
async function initFFmpeg(onProgress?: ProgressCallback): Promise<FFmpegType> {
  if (ffmpeg && ffmpegLoaded) {
    return ffmpeg;
  }

  if (ffmpegLoading) {
    // Wait for existing load to complete
    while (ffmpegLoading) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (ffmpeg && ffmpegLoaded) {
      return ffmpeg;
    }
  }

  ffmpegLoading = true;
  onProgress?.({ stage: 'loading', progress: 0, message: 'Loading FFmpeg...' });

  try {
    // Dynamic imports — keeps @ffmpeg/ffmpeg out of the initial bundle (~10MB savings).
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import('@ffmpeg/ffmpeg'),
      import('@ffmpeg/util'),
    ]);
    ffmpeg = new FFmpeg();

    // Set up progress logging
    ffmpeg.on('log', ({ message }) => {
      console.log('[FFmpeg]', message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      onProgress?.({
        stage: 'processing',
        progress: Math.min(progress, 0.99),
        message: `Processing: ${Math.round(progress * 100)}%`
      });
    });

    // Load FFmpeg core from CDN
    const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';

    onProgress?.({ stage: 'loading', progress: 0.3, message: 'Downloading FFmpeg core...' });

    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    });

    ffmpegLoaded = true;
    onProgress?.({ stage: 'loading', progress: 1, message: 'FFmpeg loaded' });

    return ffmpeg;
  } catch (error) {
    ffmpegLoading = false;
    throw error;
  } finally {
    ffmpegLoading = false;
  }
}

/**
 * Get video duration from a blob URL
 * Falls back to seeking to the end if metadata doesn't have duration
 */
async function getVideoDuration(videoUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;

    let resolved = false;
    const done = (val: number) => {
      if (resolved) return;
      resolved = true;
      video.remove();
      resolve(val);
    };
    const fail = (msg: string) => {
      if (resolved) return;
      resolved = true;
      video.remove();
      reject(new Error(msg));
    };

    video.onloadedmetadata = () => {
      // Check if duration is valid
      if (video.duration && isFinite(video.duration) && video.duration > 0) {
        done(video.duration);
        return;
      }

      // Duration not available in metadata, try seeking to find it
      video.currentTime = Number.MAX_SAFE_INTEGER;
    };

    video.onseeked = () => {
      if (video.currentTime > 0 && isFinite(video.currentTime)) {
        done(video.currentTime);
      } else {
        fail('Could not determine video duration');
      }
    };

    video.onerror = () => {
      fail('Failed to load video metadata');
    };

    // Timeout safety
    setTimeout(() => fail('Duration detection timeout'), 8000);

    video.src = videoUrl;
    video.load();
  });
}

/**
 * Create a seamless loop from a video file using a single-pass filter approach.
 *
 * Algorithm:
 * - Use the same input file as two virtual inputs
 * - Trim input 0: from midpoint to end (this becomes the start of the loop)
 * - Trim input 1: from 0 to midpoint (this becomes the end of the loop)
 * - Apply xfade crossfade at the junction point
 *
 * This ensures a seamless loop: the original middle becomes the new start/end,
 * and the original start/end (which match when looped) get crossfaded together.
 *
 * @param videoFile - The video file or blob URL
 * @param crossfadeDuration - Duration of crossfade in seconds (default: 0.5)
 * @param onProgress - Progress callback
 * @returns Blob URL of the looped video
 */
export async function createLoopedVideo(
  videoFile: File | Blob | string,
  crossfadeDuration: number = 0.5,
  onProgress?: ProgressCallback,
  transitionType: LoopTransitionType = 'fade'
): Promise<string> {
  const ff = await initFFmpeg(onProgress);

  onProgress?.({ stage: 'processing', progress: 0, message: 'Preparing video...' });

  // Get the video data
  let videoData: Uint8Array;
  let videoUrl: string;
  let needsUrlCleanup = false;

  if (typeof videoFile === 'string') {
    videoUrl = videoFile;
    const response = await fetch(videoFile);
    const blob = await response.blob();
    videoData = new Uint8Array(await blob.arrayBuffer());
  } else {
    videoUrl = URL.createObjectURL(videoFile);
    needsUrlCleanup = true;
    videoData = new Uint8Array(await videoFile.arrayBuffer());
  }

  onProgress?.({ stage: 'processing', progress: 0.05, message: 'Getting video duration...' });

  // Get video duration
  let duration: number;
  try {
    duration = await getVideoDuration(videoUrl);
  } catch (e) {
    console.warn('Could not get duration from video element:', e);
    duration = 0;
  }

  if (needsUrlCleanup) {
    URL.revokeObjectURL(videoUrl);
  }

  onProgress?.({ stage: 'processing', progress: 0.1, message: 'Analyzing video...' });

  // Write input video to FFmpeg filesystem
  await ff.writeFile('input.mp4', videoData);

  // Ensure crossfade doesn't exceed reasonable bounds
  const fadeDuration = Math.min(crossfadeDuration, 1.0);

  if (!duration || !isFinite(duration) || duration <= 0) {
    // Fallback: if we can't detect duration, use a simpler approach
    // Re-encode to get proper metadata, then determine duration from FFmpeg logs
    onProgress?.({ stage: 'processing', progress: 0.15, message: 'Detecting duration...' });

    // First pass: re-encode to normalize the container and extract duration
    let detectedDuration = 0;

    // Capture log messages to find duration
    const logHandler = ({ message }: { message: string }) => {
      // FFmpeg logs duration like "Duration: 00:00:05.00"
      const match = message.match(/Duration:\s*(\d+):(\d+):(\d+)\.(\d+)/);
      if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        const centiseconds = parseInt(match[4]);
        detectedDuration = hours * 3600 + minutes * 60 + seconds + centiseconds / 100;
      }
    };

    ff.on('log', logHandler);

    // Quick probe pass - just copy to read metadata
    try {
      await ff.exec([
        '-i', 'input.mp4',
        '-c', 'copy',
        '-f', 'null',
        '-'
      ]);
    } catch {
      // May fail but we just need the logs
    }

    // If still no duration, re-encode fully and try again
    if (!detectedDuration || detectedDuration <= 0) {
      try {
        await ff.exec([
          '-i', 'input.mp4',
          '-c:v', 'libx264',
          '-preset', 'ultrafast',
          '-crf', '28',
          '-an',
          'normalized.mp4'
        ]);

        // Try to get duration from normalized version
        await ff.exec([
          '-i', 'normalized.mp4',
          '-f', 'null',
          '-'
        ]);

        // Use normalized as input
        try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
        await ff.exec([
          '-i', 'normalized.mp4',
          '-c', 'copy',
          'input.mp4'
        ]);
        try { await ff.deleteFile('normalized.mp4'); } catch { /* ignore */ }
      } catch {
        // If this also fails, use a default duration
      }
    }

    ff.off('log', logHandler);

    if (detectedDuration && detectedDuration > 0) {
      duration = detectedDuration;
    } else {
      // Last resort fallback
      duration = 5.0;
      console.warn('Could not detect video duration, using default:', duration);
    }
  }

  // Now we have duration, use single-pass xfade approach
  const midpoint = duration / 2;
  const safeXfade = Math.min(fadeDuration, midpoint * 0.8); // Don't let xfade exceed half duration
  const secondHalfDuration = duration - midpoint;

  // The xfade offset = duration of first clip minus the fade duration
  // First clip is the "second half" of the original (midpoint to end)
  const xfadeOffset = Math.max(0, secondHalfDuration - safeXfade);

  onProgress?.({ stage: 'rendering', progress: 0.3, message: 'Creating seamless loop...' });

  // Single-pass approach using filter_complex with trim filters
  // This avoids the keyframe-misalignment issues from stream-copy splitting
  //
  // [0:v] = second half (midpoint..end) - becomes start of loop
  // [1:v] = first half (0..midpoint) - becomes end of loop
  // xfade at the junction point creates the seamless transition
  try {
    await ff.exec([
      '-i', 'input.mp4',
      '-i', 'input.mp4',
      '-filter_complex',
      // Trim second half from first input, reset timestamps
      `[0:v]trim=start=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v0];` +
      // Trim first half from second input, reset timestamps
      `[1:v]trim=end=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v1];` +
      // Apply crossfade at the junction
      `[v0][v1]xfade=transition=${transitionType}:duration=${safeXfade.toFixed(3)}:offset=${xfadeOffset.toFixed(3)}[outv]`,
      '-map', '[outv]',
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',
      '-movflags', '+faststart',
      '-an',
      'output.mp4'
    ]);
  } catch (err) {
    console.error('FFmpeg xfade failed, trying simple concat fallback:', err);

    // Fallback: simple concat without crossfade
    try {
      await ff.exec([
        '-i', 'input.mp4',
        '-i', 'input.mp4',
        '-filter_complex',
        `[0:v]trim=start=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v0];` +
        `[1:v]trim=end=${midpoint.toFixed(3)},setpts=PTS-STARTPTS,fps=30,format=yuv420p[v1];` +
        `[v0][v1]concat=n=2:v=1:a=0[outv]`,
        '-map', '[outv]',
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-movflags', '+faststart',
        '-an',
        'output.mp4'
      ]);
    } catch (err2) {
      console.error('Concat fallback also failed:', err2);
      // Clean up
      try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
      throw new Error('Failed to create video loop');
    }
  }

  onProgress?.({ stage: 'rendering', progress: 0.9, message: 'Finalizing...' });

  // Read the output
  const outputData = await ff.readFile('output.mp4');

  // Clean up FFmpeg filesystem
  try { await ff.deleteFile('input.mp4'); } catch { /* ignore */ }
  try { await ff.deleteFile('output.mp4'); } catch { /* ignore */ }

  // Create blob URL for the result
  // FFmpeg readFile returns FileData (Uint8Array), cast to ensure Blob compatibility
  const outputBlob = new Blob([outputData as Uint8Array<ArrayBuffer>], { type: 'video/mp4' });
  const outputUrl = URL.createObjectURL(outputBlob);

  onProgress?.({ stage: 'complete', progress: 1, message: 'Loop created!' });

  return outputUrl;
}

/**
 * Smart loop creator - main entry point
 */
export async function createLoop(
  videoFile: File | Blob | string,
  crossfadeDuration: number = 0.5,
  onProgress?: ProgressCallback,
  transitionType: LoopTransitionType = 'fade'
): Promise<string> {
  return createLoopedVideo(videoFile, crossfadeDuration, onProgress, transitionType);
}
