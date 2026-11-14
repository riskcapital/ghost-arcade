// Where a recording is written and how it leaves the app: Photos and the share sheet in the iOS
// app (StudioOutput plugin), a download in a browser.
import type { RecordingResult, RecordingSink } from './programRecorder';
import { blobToBase64, shareFile } from './nativeShare';
import { callOutput, fileURL, hasOutputMethod } from './nativeOutput';

/** The app can keep recordings itself (and save them to Photos). */
export const canStoreRecordings = (): boolean => hasOutputMethod('recordingBegin') && hasOutputMethod('recordingFinish');

/** Writes each encoded piece to a file in the app as it arrives. */
export class AppRecordingSink implements RecordingSink {
  private id: string | null = null;
  private mimeType = '';
  async begin(mimeType: string) {
    this.mimeType = mimeType;
    const r = await callOutput<{ id?: string }>('recordingBegin', { mimeType });
    if (!r?.id) throw new Error('The recording could not be stored.');
    this.id = r.id;
  }
  async append(chunk: Blob) {
    if (!this.id) throw new Error('The recording has not started.');
    await callOutput('recordingAppend', { id: this.id, base64: await blobToBase64(chunk) });
  }
  async finish(filename: string): Promise<RecordingResult> {
    if (!this.id) throw new Error('The recording has not started.');
    const r = await callOutput<{ id: string; path: string; bytes: number; durationMs: number; width: number; height: number }>('recordingFinish', { id: this.id, filename });
    return { id: r.id, url: fileURL(r.path), bytes: r.bytes, durationMs: r.durationMs, width: r.width, height: r.height, mimeType: 'video/mp4', filename: r.path.split('/').pop() || filename };
  }
  async discard() {
    if (this.id) await callOutput('recordingDiscard', { id: this.id }).catch(() => undefined);
    this.id = null;
  }
}

/** A browser keeps the take in memory and offers it as a download. */
export class MemoryRecordingSink implements RecordingSink {
  private chunks: Blob[] = [];
  private mimeType = '';
  private startedAt = 0;
  private url = '';
  async begin(mimeType: string) { this.mimeType = mimeType; this.chunks = []; this.startedAt = performance.now(); }
  async append(chunk: Blob) { this.chunks.push(chunk); }
  async finish(filename: string): Promise<RecordingResult> {
    const blob = new Blob(this.chunks, { type: this.mimeType.split(';')[0] });
    this.chunks = [];
    if (!blob.size) throw new Error('Nothing was recorded.');
    this.url = URL.createObjectURL(blob);
    const ext = this.mimeType.includes('mp4') ? '.mp4' : '.webm';
    const size = await videoSize(this.url);
    return { url: this.url, bytes: blob.size, durationMs: Math.round(performance.now() - this.startedAt), width: size.width, height: size.height, mimeType: blob.type, filename: filename.replace(/\.\w+$/, '') + ext, blob };
  }
  async discard() { this.chunks = []; if (this.url) URL.revokeObjectURL(this.url); this.url = ''; }
}

function videoSize(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    const done = () => resolve({ width: v.videoWidth, height: v.videoHeight });
    v.onloadedmetadata = done; v.onerror = done; setTimeout(done, 3000);
    v.muted = true; v.preload = 'metadata'; v.src = url;
  });
}

export const recordingSink = (): RecordingSink => (canStoreRecordings() ? new AppRecordingSink() : new MemoryRecordingSink());

/** Adds the recording to Photos (the app asks for add-only access the first time). */
export async function saveRecording(result: RecordingResult): Promise<'photos' | 'download'> {
  if (result.id && hasOutputMethod('recordingSaveToPhotos')) {
    await callOutput('recordingSaveToPhotos', { id: result.id });
    return 'photos';
  }
  if (!result.blob) throw new Error('This recording can no longer be saved.');
  await shareFile(result.filename, result.blob, result.mimeType);
  return 'download';
}

/** Opens the share sheet. Resolves true when the person sent or saved it somewhere. */
export async function shareRecording(result: RecordingResult, anchor?: Element | null): Promise<boolean> {
  if (result.id && hasOutputMethod('recordingShare')) {
    const r = anchor?.getBoundingClientRect();
    const at = r && r.width > 0 ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) } : undefined;
    const done = await callOutput<{ completed?: boolean }>('recordingShare', at ? { id: result.id, anchor: at } : { id: result.id });
    return done?.completed === true;
  }
  if (!result.blob) throw new Error('This recording can no longer be shared.');
  return shareFile(result.filename, result.blob, result.mimeType, anchor);
}

export async function discardRecording(result: RecordingResult): Promise<void> {
  if (result.id) await callOutput('recordingDiscard', { id: result.id }).catch(() => undefined);
  else if (result.url.startsWith('blob:')) URL.revokeObjectURL(result.url);
}

/** "0:07", "1:02:03". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000)), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
