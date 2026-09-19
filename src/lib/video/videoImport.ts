import type { AssetRef } from '../storage/assetRegistry';
export type VideoImportInfo = { durationSeconds?: number; videoWidth?: number; videoHeight?: number; thumbnail: string };
export async function prepareVideoImport(video: HTMLVideoElement, ref?: AssetRef): Promise<VideoImportInfo> {
  await new Promise<void>(resolve => {
    let timer: ReturnType<typeof setTimeout>;
    const done = () => { clearTimeout(timer); video.removeEventListener('loadeddata', done); video.removeEventListener('error', done); resolve(); };
    video.addEventListener('loadeddata', done); video.addEventListener('error', done);
    timer = setTimeout(done, 2500);
    if (video.readyState >= 2 || video.error) done();
  });
  const durationSeconds = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
  if (video.readyState >= 2 && video.videoWidth > 0) {
    try {
      const canvas = document.createElement('canvas'); canvas.width = 160; canvas.height = 90;
      const ctx = canvas.getContext('2d');
      if (ctx) { ctx.drawImage(video, 0, 0, canvas.width, canvas.height); return { durationSeconds, videoWidth: video.videoWidth, videoHeight: video.videoHeight, thumbnail: canvas.toDataURL('image/jpeg', .7) }; }
    } catch { /* Native-only codecs use the bounded import probe below. */ }
  }
  if (ref?.originalPath && typeof window !== 'undefined' && (window as any).electronAPI?.invoke) {
    return (window as any).electronAPI.invoke('inspect_video_import', { inputPath: ref.originalPath });
  }
  return { durationSeconds, thumbnail: '' };
}
