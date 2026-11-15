// The iOS app's StudioOutput plugin: the in-app AirPlay picker, recording files (Photos and the
// share sheet) and the system review prompt. Every method is feature-detected, so an older app
// build, Android and a browser fall back without errors.
//
// Native contract (StudioOutput plugin, StudioOutputPlugin.swift):
//   showRoutePicker({ anchor? }) -> { shown, airplay, name }
//   routeStatus() -> { airplay, name }
//   recordingBegin({ mimeType }) -> { id }
//   recordingAppend({ id, base64 }) -> { bytes }
//   recordingFinish({ id, filename }) -> { id, path, bytes, durationMs, width, height }
//   recordingDiscard({ id }) -> {}
//   recordingSaveToPhotos({ id }) -> { saved }
//   recordingShare({ id, anchor? }) -> { completed }
//   presentMode({ on }) -> {}
//   requestReview() -> { requested }
//   appVersion() -> { version, build }
import { nativeMethodAvailable, shareAnchor } from './nativeShare';

export const OUTPUT_PLUGIN = 'StudioOutput';

type Bridge = {
  nativePromise?: (plugin: string, method: string, args: Record<string, unknown>) => Promise<unknown>;
  convertFileSrc?: (path: string) => string;
};
const bridge = (): Bridge | undefined => (globalThis as { Capacitor?: Bridge }).Capacitor;

/** True when this app build has `method` on the StudioOutput plugin. */
export function hasOutputMethod(method: string): boolean {
  return nativeMethodAvailable(OUTPUT_PLUGIN, method) === true;
}

export async function callOutput<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const cap = bridge();
  if (!cap?.nativePromise || !hasOutputMethod(method)) throw new Error('This needs the latest version of Ghost Arcade.');
  return (await cap.nativePromise(OUTPUT_PLUGIN, method, args)) as T;
}

/** A URL the web view can load for a file the app wrote (video preview of a recording). */
export function fileURL(path: string): string {
  return bridge()?.convertFileSrc?.(path) ?? path;
}

export type RouteResult = { shown: boolean; airplay: boolean; name: string };

/** The in-app AirPlay picker is available (iPhone and iPad app 1.2 and later). */
export const canPickRoute = (): boolean => hasOutputMethod('showRoutePicker');

/**
 * Opens the system AirPlay picker from the tapped control and resolves when it closes.
 * `shown` is false when the system did not open it; the caller then explains the Control Center route.
 */
export async function pickRoute(anchor?: Parameters<typeof shareAnchor>[0]): Promise<RouteResult> {
  const at = shareAnchor(anchor);
  const result = await callOutput<Partial<RouteResult>>('showRoutePicker', at ? { anchor: at } : {});
  return { shown: result?.shown === true, airplay: result?.airplay === true, name: typeof result?.name === 'string' ? result.name : '' };
}

/** The AirPlay device the app's sound is going to, if any. */
export async function routeStatus(): Promise<{ airplay: boolean; name: string }> {
  if (!hasOutputMethod('routeStatus')) return { airplay: false, name: '' };
  try {
    const r = await callOutput<{ airplay?: boolean; name?: string }>('routeStatus');
    return { airplay: r?.airplay === true, name: typeof r?.name === 'string' ? r.name : '' };
  } catch {
    return { airplay: false, name: '' };
  }
}

let version: Promise<string> | undefined;
/** This app's version ("1.2"); in a browser, the web build's version. */
export function appVersion(fallback: string): Promise<string> {
  version ??= hasOutputMethod('appVersion')
    ? callOutput<{ version?: string }>('appVersion').then((r) => r?.version || fallback, () => fallback)
    : Promise.resolve(fallback);
  return version;
}
/** Test hook. */
export function resetAppVersion(): void { version = undefined; }

/** Turns this screen's brightness right down during a show, and back when `on` is false. */
export function presentMode(on: boolean): void {
  if (hasOutputMethod('presentMode')) void callOutput('presentMode', { on }).catch(() => undefined);
}

/** The system rating prompt. iOS decides whether it actually appears (at most three times a year). */
export async function requestReview(): Promise<boolean> {
  if (!hasOutputMethod('requestReview')) return false;
  try {
    const r = await callOutput<{ requested?: boolean }>('requestReview');
    return r?.requested === true;
  } catch {
    return false;
  }
}

let info: Promise<{ version: string; build: string }> | undefined;
/** This app's version and build number ("1.2", "11"); in a browser, `fallback` and no build. */
export function appInfo(fallback: string): Promise<{ version: string; build: string }> {
  info ??= hasOutputMethod('appVersion')
    ? callOutput<{ version?: string; build?: string }>('appVersion').then(
        (r) => ({ version: r?.version || fallback, build: typeof r?.build === 'string' ? r.build : '' }),
        () => ({ version: fallback, build: '' }),
      )
    : Promise.resolve({ version: fallback, build: '' });
  return info;
}
