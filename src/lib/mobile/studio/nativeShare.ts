// Hands a file to the person using the app, and the small native bridge helpers that needs.
//
// In the iOS app a blob `<a download>` does nothing (WKWebView has no download handler), so the
// file goes to the native StudioCapture plugin, which writes it to a temporary location and
// presents the share sheet (Files, AirDrop, Mail…). In a browser it falls back to a download link.
//
// Native contract (StudioCapture plugin):
//   shareFile({ filename, base64, mimeType, anchor? }) -> { completed: boolean }
//     anchor = { x, y, width, height } of the tapped control, in CSS pixels; it places the iPad
//     share popover. completed is false when the sheet is closed without choosing anything.
//     A second call while a sheet is open rejects.
//   haptic({ type }) -> {}
//   openAppSettings() -> {}   opens this app's page in iOS Settings (camera, microphone, local network)
// Older app builds and Android do not have these methods, so both are feature-detected.

type PluginHeader = { name: string; methods?: Array<{ name: string }> };
type Bridge = {
  getPlatform?: () => string;
  nativePromise?: (plugin: string, method: string, args: Record<string, unknown>) => Promise<unknown>;
  PluginHeaders?: PluginHeader[];
};
const bridge = (): Bridge | undefined => (globalThis as { Capacitor?: Bridge }).Capacitor;

/** True inside the installed iPhone, iPad or Android app. */
export function isNativePlatform(): boolean {
  const platform = bridge()?.getPlatform?.();
  return platform === 'ios' || platform === 'android';
}

/**
 * Whether this build's native plugin implements `method`. Capacitor lists every plugin's methods
 * in PluginHeaders; when that list is missing the answer is unknown (null) and the caller has to
 * try the call.
 */
export function nativeMethodAvailable(plugin: string, method: string): boolean | null {
  const cap = bridge();
  if (!isNativePlatform() || !cap?.nativePromise) return false;
  const headers = cap.PluginHeaders;
  if (!Array.isArray(headers)) return null;
  return !!headers.find((h) => h.name === plugin)?.methods?.some((m) => m.name === method);
}

/** True when a rejected native call failed because the method does not exist in this build. */
function unimplemented(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | undefined;
  return e?.code === 'UNIMPLEMENTED' || /not implemented|unimplemented|no such method|not available/i.test(e?.message ?? '');
}

/** A name every file system accepts, keeping the extension. */
export function safeFileName(name: string, fallback = 'Ghost Arcade file'): string {
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 ? name.slice(dot).replace(/[^.A-Za-z0-9]/g, '') : '';
  const stem = (dot > 0 ? name.slice(0, dot) : name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/^[\s.-]+|[\s.-]+$/g, '').slice(0, 80);
  return (stem || fallback) + extension;
}

export async function blobToBase64(blob: Blob): Promise<string> {
  // Read and encoded a slice at a time (a multiple of three bytes, so the pieces join into valid
  // base64). A set with its videos can be over 100 MB; one pass would hold it three times over.
  const SLICE = 3 * 0x80000;
  const pieces: string[] = [];
  for (let at = 0; at < blob.size; at += SLICE) {
    const bytes = new Uint8Array(await blob.slice(at, at + SLICE).arrayBuffer());
    let binary = '';
    // Chunked so a large slice never overflows the argument list.
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    pieces.push(btoa(binary));
  }
  return pieces.join('');
}

export type ShareAnchor = { x: number; y: number; width: number; height: number };
type AnchorSource = ShareAnchor | { getBoundingClientRect: () => ShareAnchor } | null | undefined;
/** The tapped control's rectangle, from the element itself or a rectangle already measured. */
export function shareAnchor(source: AnchorSource): ShareAnchor | undefined {
  if (!source) return undefined;
  const r = 'getBoundingClientRect' in source ? source.getBoundingClientRect() : source;
  const anchor = { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  return Object.values(anchor).every(Number.isFinite) && anchor.width > 0 && anchor.height > 0 ? anchor : undefined;
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

/** The system share sheet through the Web Share API, for app builds without the native method. */
async function webShare(filename: string, blob: Blob, mimeType: string): Promise<boolean | null> {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (typeof File === 'undefined' || !nav?.canShare || !nav.share) return null;
  const file = new File([blob], filename, { type: mimeType });
  if (!nav.canShare({ files: [file] })) return null;
  try {
    await nav.share({ files: [file], title: filename });
    return true;
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') return false;
    throw e;
  }
}

/**
 * Share or save `blob` as `filename`. Resolves true only when the file was actually handed over:
 * the share sheet completed, or the browser download started. Resolves false when the person
 * cancelled. Rejects when the file could not be shared. Pass the tapped button (or its rectangle)
 * as `anchor` so the iPad share popover points at it.
 */
export async function shareFile(filename: string, blob: Blob, mimeType: string, anchor?: AnchorSource): Promise<boolean> {
  const name = safeFileName(filename);
  const typed = blob.type === mimeType ? blob : new Blob([blob], { type: mimeType });
  if (!isNativePlatform()) return downloadFile(name, typed);
  const cap = bridge();
  const available = nativeMethodAvailable('StudioCapture', 'shareFile');
  if (available !== false && cap?.nativePromise) {
    const at = shareAnchor(anchor);
    try {
      const result = (await cap.nativePromise('StudioCapture', 'shareFile', { filename: name, base64: await blobToBase64(typed), mimeType, ...(at ? { anchor: at } : {}) })) as { completed?: boolean } | null | undefined;
      return result?.completed === true;
    } catch (e) {
      // Only an app build that lacks the method falls through to the Web Share sheet.
      if (available === true || !unimplemented(e)) throw e;
    }
  }
  const shared = await webShare(name, typed, mimeType);
  if (shared === null) throw new Error('Sharing files needs the latest version of Ghost Arcade.');
  return shared;
}

export type HapticType = 'light' | 'medium' | 'heavy' | 'selection' | 'success' | 'warning' | 'error';
let hapticsMissing = false;
/** A short tap from the Taptic Engine. Silent where the app build or the device has none. */
export function haptic(type: HapticType = 'light'): void {
  const cap = bridge();
  if (hapticsMissing || !cap?.nativePromise || nativeMethodAvailable('StudioCapture', 'haptic') === false) return;
  void cap.nativePromise('StudioCapture', 'haptic', { type }).catch((e) => { if (unimplemented(e)) hapticsMissing = true; });
}
/** Test hook: forget that a build was found to have no haptics. */
export function resetHapticsProbe(): void { hapticsMissing = false; }

/** True when this app build can open its own page in iOS Settings. */
export function canOpenAppSettings(): boolean {
  return nativeMethodAvailable('StudioCapture', 'openAppSettings') === true;
}
/** Opens this app's page in iOS Settings, where camera and microphone access are switched on. */
export async function openAppSettings(): Promise<boolean> {
  const cap = bridge();
  if (!canOpenAppSettings() || !cap?.nativePromise) return false;
  try { await cap.nativePromise('StudioCapture', 'openAppSettings', {}); return true; } catch { return false; }
}
/** True for a message that tells the person to change a permission in iOS Settings. */
export const mentionsSettings = (message: string): boolean => /\bSettings\b/.test(message) && /camera|microphone|access|permission/i.test(message);
