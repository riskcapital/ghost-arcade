import { invoke, isDesktopApp } from '../bridge';

export type VideoConversionStage =
  | 'idle'
  | 'selecting'
  | 'scanning'
  | 'preparing'
  | 'converting'
  | 'complete'
  | 'cancelled'
  | 'error';

export interface VideoConversionProgress {
  jobId?: string;
  stage: VideoConversionStage;
  progress: number;
  message: string;
  outputPath?: string;
}

export interface PickedVideoFile {
  path: string;
  name: string;
  size?: number;
  defaultOutputPath?: string;
}

export interface PickedSequenceFolder {
  path: string;
  name: string;
  frameCount: number;
  firstFrame?: string;
  lastFrame?: string;
  defaultOutputPath?: string;
}

export interface VideoConversionResult {
  outputPath: string;
  ffmpegPath?: string;
}

export interface NativeConversionOptions {
  crf: number;
  preset: string;
}

let activeJobId: string | null = null;

function requireDesktop(): void {
  if (!isDesktopApp) {
    throw new Error('The native converter is available in the desktop app.');
  }
}

function makeJobId(): string {
  return `vc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function listenForJobProgress(jobId: string, onProgress?: (progress: VideoConversionProgress) => void): (() => void) | null {
  const api = window.electronAPI;
  if (!api?.on || !onProgress) return null;
  return api.on('video-converter-progress', (progress: VideoConversionProgress) => {
    if (progress?.jobId && progress.jobId !== jobId) return;
    onProgress({
      ...progress,
      progress: Math.max(0, Math.min(1, Number.isFinite(progress.progress) ? progress.progress : 0)),
    });
  });
}

export async function pickWebMVideo(): Promise<PickedVideoFile | null> {
  requireDesktop();
  return invoke<PickedVideoFile | null>('video_converter_pick_webm');
}

export async function pickImageSequenceFolder(): Promise<PickedSequenceFolder | null> {
  requireDesktop();
  return invoke<PickedSequenceFolder | null>('video_converter_pick_sequence_folder');
}

export async function pickVideoOutputPath(defaultPath?: string, defaultName?: string): Promise<string | null> {
  requireDesktop();
  const result = await invoke<{ path: string } | null>('video_converter_pick_output', { defaultPath, defaultName });
  return result?.path ?? null;
}

export async function revealVideoOutput(path: string): Promise<void> {
  requireDesktop();
  await invoke('video_converter_reveal_path', { path });
}

export async function cancelActiveVideoConversion(): Promise<boolean> {
  if (!activeJobId) return false;
  const result = await invoke<{ success?: boolean }>('video_converter_cancel', {});
  return !!result?.success;
}

export function isVideoConversionCancelled(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /cancelled|canceled/i.test(message);
}

export async function convertWebMToMp4(
  inputPath: string,
  outputPath: string,
  options: NativeConversionOptions,
  onProgress?: (progress: VideoConversionProgress) => void,
): Promise<VideoConversionResult> {
  requireDesktop();
  if (activeJobId) throw new Error('A video conversion is already running.');
  const jobId = makeJobId();
  activeJobId = jobId;
  const stopListening = listenForJobProgress(jobId, onProgress);

  try {
    onProgress?.({ jobId, stage: 'preparing', progress: 0, message: 'Preparing encoder...', outputPath });
    const result = await invoke<VideoConversionResult>('video_converter_start', {
      jobId,
      mode: 'webm',
      inputPath,
      outputPath,
      crf: options.crf,
      preset: options.preset,
    });
    return result;
  } finally {
    stopListening?.();
    if (activeJobId === jobId) activeJobId = null;
  }
}

export async function convertImageSequenceToMp4(
  folderPath: string,
  outputPath: string,
  fps: number,
  options: NativeConversionOptions,
  onProgress?: (progress: VideoConversionProgress) => void,
): Promise<VideoConversionResult> {
  requireDesktop();
  if (activeJobId) throw new Error('A video conversion is already running.');
  const jobId = makeJobId();
  activeJobId = jobId;
  const stopListening = listenForJobProgress(jobId, onProgress);

  try {
    onProgress?.({ jobId, stage: 'scanning', progress: 0, message: 'Scanning frame folder...', outputPath });
    const result = await invoke<VideoConversionResult>('video_converter_start', {
      jobId,
      mode: 'sequence',
      folderPath,
      outputPath,
      fps,
      crf: options.crf,
      preset: options.preset,
    });
    return result;
  } finally {
    stopListening?.();
    if (activeJobId === jobId) activeJobId = null;
  }
}
