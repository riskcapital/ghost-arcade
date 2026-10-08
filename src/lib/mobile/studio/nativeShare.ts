// Hands a file to the person using the app.
//
// In the iOS app a blob `<a download>` does nothing (WKWebView has no download handler), so the
// file goes to the native StudioCapture plugin, which writes it to a temporary location and
// presents the share sheet (Files, AirDrop, Mail…). In a browser it falls back to a download link.
//
// Native contract: StudioCapture.shareFile({ filename, base64, mimeType }) -> { completed: boolean }
// `completed` is false when the person closes the share sheet without choosing anything.

type Bridge = {
  getPlatform?: () => string;
  nativePromise?: (plugin: string, method: string, args: Record<string, unknown>) => Promise<unknown>;
};
const bridge = (): Bridge | undefined => (globalThis as { Capacitor?: Bridge }).Capacitor;

/** True inside the installed iPhone, iPad or Android app. */
export function isNativePlatform(): boolean {
  const platform = bridge()?.getPlatform?.();
  return platform === 'ios' || platform === 'android';
}

/** A name every file system accepts, keeping the extension. */
export function safeFileName(name: string, fallback = 'Ghost Arcade file'): string {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).replace(/[^.A-Za-z0-9]/g, '') : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[\s.-]+|[\s.-]+$/g, '').slice(0, 80);
  return (stem || fallback) + extension;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  // Chunked so a large file never overflows the argument list.
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function downloadFile(filename: string, blob: Blob): boolean {
  if (typeof document === 'undefined') return false;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/**
 * Share or save `blob` as `filename`. Resolves true only when the file was actually handed over:
 * the share sheet completed, or the browser download started. Resolves false when the person
 * cancelled. Rejects when the native side could not share it.
 */
export async function shareFile(filename: string, blob: Blob, mimeType: string): Promise<boolean> {
  const name = safeFileName(filename);
  const cap = bridge();
  if (isNativePlatform()) {
    if (!cap?.nativePromise) throw new Error('Sharing is not available in this version of the app.');
    const result = (await cap.nativePromise('StudioCapture', 'shareFile', { filename: name, base64: await blobToBase64(blob), mimeType })) as { completed?: boolean } | null | undefined;
    return result?.completed === true;
  }
  return downloadFile(name, blob.type === mimeType ? blob : new Blob([blob], { type: mimeType }));
}
