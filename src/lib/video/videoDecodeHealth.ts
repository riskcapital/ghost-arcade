/**
 * How each video file plays in the render core, shown on the media itself.
 *
 * Decode failures and slow CPU decoding were invisible: the core reported a
 * backend and a fallback reason per session and nothing read them. Each file
 * is now checked once with the core's probe_video (before it plays), and live
 * playback sessions keep the answer current. A badge on media tray items,
 * the layer's source and VJ clip cells says "Software decode -- may lag" or
 * "Can't play", with the reason, and offers to convert the file.
 */
import { writable, get } from 'svelte/store';
import { isDesktopApp } from '$lib/bridge';
import { probeNativeVideo, type NativeVideoProbe } from '$lib/api/native-renderer';
import { canonicalLocalPath, localPathFromUrl } from '$lib/vj/clipFiles';

export type VideoDecodeState = 'checking' | 'hardware' | 'software' | 'failed';

export interface VideoDecodeHealth {
  state: VideoDecodeState;
  /** videotoolbox | media-foundation | hap-texture | ffmpeg | failed | '' */
  backend: string;
  /** Plain words for the badge ("it is 10-bit H.264"). */
  reason: string;
  /** The core's own words, for the log and the tooltip's second line. */
  detail: string;
  reverseSupported: boolean;
  codec?: string;
  /** Set while "Convert for smooth playback" runs on this file. */
  converting?: { progress: number; message: string };
}

/** Keyed by absolute file path. */
export const videoDecodeHealth = writable<Record<string, VideoDecodeHealth>>({});

const HARDWARE_BACKENDS = new Set(['videotoolbox', 'media-foundation', 'hap-texture']);

/** Why software decoding (or no decoding) applies, in words a user can act on. */
export function plainDecodeReason(backend: string, rawReason: string, codec = ''): string {
  const reason = String(rawReason || '');
  const stream = String(codec || '').toLowerCase();
  const name = stream.split(/[\s,(]/)[0];
  if (/not found/i.test(reason)) return 'the file was not found';
  if (/(reverse|bounce) playback requires/i.test(reason)) return 'reverse and bounce play only with hardware decoding';
  if (/alpha|transparen/i.test(reason)) return 'it has transparency (alpha)';
  if (/media foundation is not installed|media feature pack/i.test(reason)) {
    return "Windows' Media Feature Pack is not installed";
  }
  if (backend === 'failed') {
    if (/no video/i.test(reason)) return 'it has no video this app can read';
    return 'its video could not be decoded';
  }
  if (name === 'prores') return 'this computer has no hardware ProRes decoder';
  if (name === 'dnxhd' || name === 'dnxhr') return 'DNxHD/DNxHR has no hardware decoder';
  if (['vp8', 'vp9', 'av1', 'mpeg2video', 'mpeg4', 'mjpeg', 'cfhd', 'qtrle', 'png'].includes(name)) {
    return `${name.toUpperCase()} has no hardware decoder in this app`;
  }
  if (/yuva?444/.test(stream)) return "it uses 4:4:4 colour, which this computer's hardware decoder does not take";
  if (/yuva?422/.test(stream)) return "it uses 4:2:2 colour, which this computer's hardware decoder does not take";
  if ((name === 'h264') && /p10|p12/.test(stream)) return "it is 10-bit H.264, which this computer's hardware decoder does not take";
  if (/interlaced/i.test(reason)) return 'it is interlaced';
  if (/non-square/i.test(reason)) return 'it has non-square pixels';
  if (/rotated/i.test(reason)) return 'it is rotated';
  if (/turned off/i.test(reason)) return 'hardware decoding is turned off';
  if (/precise|edit list|ordering|timestamps/i.test(reason)) return 'its timing needs the software decoder';
  return 'the hardware decoder could not open it';
}

export function decodeHealthFromProbe(probe: Pick<NativeVideoProbe, 'backend' | 'hardware' | 'reason' | 'reverse_supported'> & { codec?: string }): VideoDecodeHealth {
  const backend = String(probe.backend || '');
  if (probe.hardware || HARDWARE_BACKENDS.has(backend)) {
    return { state: 'hardware', backend, reason: '', detail: '', reverseSupported: true };
  }
  // A software clip asked to play in reverse fails, but plays forwards:
  // converting it fixes both, so it is a software clip, not a broken one.
  const reverseOnly = /(reverse|bounce) playback requires/i.test(String(probe.reason || ''));
  const state: VideoDecodeState = backend === 'failed' && !reverseOnly ? 'failed' : 'software';
  return {
    state,
    backend,
    reason: plainDecodeReason(backend, probe.reason, probe.codec),
    detail: String(probe.reason || ''),
    reverseSupported: !!probe.reverse_supported,
    codec: probe.codec,
  };
}

export interface DecodeBadge {
  tone: 'warn' | 'error' | 'busy';
  label: string;
  title: string;
  canConvert: boolean;
}

/** What to show for a file: null means nothing (hardware, or not known yet). */
export function decodeBadge(health: VideoDecodeHealth | null | undefined): DecodeBadge | null {
  if (!health) return null;
  if (health.converting) {
    const pct = Math.round(Math.max(0, Math.min(1, health.converting.progress)) * 100);
    return { tone: 'busy', label: `${pct}%`, title: `Converting for smooth playback (${pct}%)`, canConvert: false };
  }
  if (health.state === 'software') {
    const reverse = health.reverseSupported ? '' : ' Reverse and bounce will not play.';
    return {
      tone: 'warn',
      label: 'SW',
      title: `Software decode — may lag: ${health.reason}.${reverse}`,
      canConvert: true,
    };
  }
  if (health.state === 'failed') {
    return { tone: 'error', label: '!', title: `Can't play: ${health.reason}.`, canConvert: false };
  }
  return null;
}

/** The local file behind a media URI (ghost-asset://, file://, or a path). */
export function videoPathFromUri(uri: string | null | undefined): string | null {
  const value = String(uri ?? '');
  if (!value) return null;
  const fromUrl = localPathFromUrl(value);
  if (fromUrl) return fromUrl;
  if (value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)) return canonicalLocalPath(value);
  return null;
}

function setHealth(path: string, next: VideoDecodeHealth | null) {
  videoDecodeHealth.update((all) => {
    const current = all[path];
    if (!next) {
      if (!current) return all;
      const { [path]: _gone, ...rest } = all;
      return rest;
    }
    if (current && !next.converting && current.converting) next = { ...next, converting: current.converting };
    if (current && JSON.stringify(current) === JSON.stringify(next)) return all;
    return { ...all, [path]: next };
  });
}

export function setVideoConversionProgress(path: string, converting: VideoDecodeHealth['converting'] | null) {
  videoDecodeHealth.update((all) => {
    const current = all[path] ?? { state: 'checking', backend: '', reason: '', detail: '', reverseSupported: false };
    if (!converting) {
      const { converting: _done, ...rest } = current;
      return { ...all, [path]: rest };
    }
    return { ...all, [path]: { ...current, converting } };
  });
}

const inFlight = new Map<string, Promise<VideoDecodeHealth | null>>();

/** Ask the core how `path` will play, once per file unless `force`. */
export function checkVideoDecode(path: string | null | undefined, options: { force?: boolean; probe?: typeof probeNativeVideo } = {}): Promise<VideoDecodeHealth | null> {
  if (!path || !isDesktopApp) return Promise.resolve(null);
  const known = get(videoDecodeHealth)[path];
  if (!options.force && known && known.state !== 'checking') return Promise.resolve(known);
  const pending = inFlight.get(path);
  if (pending && !options.force) return pending;
  const probe = options.probe ?? probeNativeVideo;
  if (!known) setHealth(path, { state: 'checking', backend: '', reason: '', detail: '', reverseSupported: false });
  const job = probe(path)
    .then((result) => {
      // No answer yet: the core is not running, or playing clips held the
      // video memory the check needs. Forget it so the next check runs again.
      if (!result || result.backend === 'busy') {
        if (get(videoDecodeHealth)[path]?.state === 'checking') setHealth(path, null);
        return null;
      }
      const health = decodeHealthFromProbe(result);
      setHealth(path, health);
      if (health.state !== 'hardware') {
        console.info(`[VideoDecode] ${path}: ${health.state} (${health.detail || health.backend})`);
      }
      return health;
    })
    .catch((error) => {
      if (get(videoDecodeHealth)[path]?.state === 'checking') setHealth(path, null);
      console.warn('[VideoDecode] could not check', path, error);
      return null;
    })
    .finally(() => { if (inFlight.get(path) === job) inFlight.delete(path); });
  inFlight.set(path, job);
  return job;
}

/** Check every file in the list (each once). */
export function checkVideoDecodes(paths: Iterable<string | null | undefined>): void {
  for (const path of paths) void checkVideoDecode(path);
}

type SessionBackend = { uri?: string; backend?: string; fallback_reason?: string };

/**
 * Live playback is the final word: a file the probe passed can still fall
 * back while playing. Sessions still preparing say nothing yet.
 */
export function noteVideoSessionBackends(sessions: readonly SessionBackend[] | null | undefined): string[] {
  const newlyFailed: string[] = [];
  if (!sessions?.length) return newlyFailed;
  const all = get(videoDecodeHealth);
  for (const session of sessions) {
    const path = videoPathFromUri(session.uri);
    const backend = String(session.backend ?? '');
    if (!path || !backend || backend === 'preparing') continue;
    const known = all[path];
    if (HARDWARE_BACKENDS.has(backend)) {
      if (known?.state !== 'hardware') setHealth(path, decodeHealthFromProbe({ backend, hardware: true, reason: '', reverse_supported: true }));
      continue;
    }
    if (backend === 'ffmpeg' || backend === 'failed') {
      const reason = String(session.fallback_reason ?? '');
      const sameState = known?.state === (backend === 'failed' && !/(reverse|bounce) playback requires/i.test(reason) ? 'failed' : 'software');
      // Keep the probe's richer answer (it knows the codec) for the same verdict.
      if (sameState && known?.codec) continue;
      const next = decodeHealthFromProbe({ backend, hardware: false, reason, reverse_supported: false, codec: known?.codec });
      if (next.state === 'failed' && known?.state !== 'failed') newlyFailed.push(path);
      setHealth(path, next);
    }
  }
  return newlyFailed;
}
