/*
 * Webcams as an input source for the GPU instruments that take one.
 *
 * This runs through the app's existing native live-capture addon
 * (AVFoundation on macOS, Media Foundation on Windows) — the same path
 * MediaTray's webcam sources use. The addon hands back an IOSurface / DXGI
 * shared texture, and the sync's shared-texture upload path carries it to the
 * core with no readback at all.
 *
 * An earlier attempt did this in the renderer with getUserMedia, a <video> and
 * canvas readback. It is worth recording why that is the wrong path, because
 * it looks like it works:
 *
 *   Chromium hands back a track that reports `live`, and then no frame ever
 *   arrives — readyState stays 0 and the camera light never comes on. macOS
 *   only raises the TCC prompt when the app asks through
 *   systemPreferences.askForMediaAccess, which is a main-process call. The
 *   addon path already does that (see native_live_capture_start_camera in
 *   electron/main.js, whose comment records the same failure from the other
 *   direction).
 *
 * Sessions are keyed by device id and shared: two layers on one camera open
 * one session.
 */
import { invoke, isElectron } from '$lib/bridge';
import type { Layer } from '$lib/types';

export type CameraDevice = { id: string; name: string };

type CameraSession = {
  deviceId: string;
  sessionId: string | null;
  state: 'idle' | 'starting' | 'live' | 'error';
  error: string | null;
  /** Epoch ms before which a failed session will not be retried. */
  retryAfter: number;
  retryDelay: number;
};

/*
 * A failed camera is retried on a widening backoff rather than every frame or
 * never.
 *
 * Every frame would re-ask the OS sixty times a second, and on macOS an
 * unanswered permission prompt leaves the status at "not-determined" -- so each
 * ask raises the dialog again. Never retrying is no better: the fix for the
 * common failure is for the user to grant access in System Settings, and that
 * should start working on its own rather than making them re-pick the camera.
 */
const CAMERA_RETRY_MIN_MS = 4000;
const CAMERA_RETRY_MAX_MS = 60000;

const sessions = new Map<string, CameraSession>();

/** Stable layer-source id for a camera. Distinct from the addon's session id,
 *  which is regenerated whenever the session restarts. */
export function cameraLiveSourceId(deviceId: string | null | undefined): string {
  return `camera:${String(deviceId || 'default')}`;
}

export function isCameraLiveSourceId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('camera:');
}

/** Inverse of cameraLiveSourceId — 'camera:default' maps back to ''. */
export function cameraDeviceIdFromLiveSourceId(id: string): string {
  const raw = String(id || '').slice('camera:'.length);
  return raw === 'default' ? '' : raw;
}

export function cameraLiveSourceError(deviceId: string | null | undefined): string | null {
  return sessions.get(String(deviceId || ''))?.error ?? null;
}

/** Cameras the native addon can open. These ids are the addon's, NOT
 *  navigator.mediaDevices ids — the two do not interchange. */
export async function listNativeCameras(): Promise<CameraDevice[]> {
  if (!isElectron) return [];
  try {
    const available = await invoke<{ available?: boolean; error?: string }>(
      'native_live_capture_available',
    );
    if (!available?.available) return [];
    const devices = await invoke<Array<{ id?: string; name?: string }>>(
      'native_live_capture_list_cameras',
    );
    return (Array.isArray(devices) ? devices : [])
      .map((device) => ({ id: String(device?.id || ''), name: String(device?.name || 'Camera') }))
      .filter((device) => !!device.id);
  } catch (err) {
    console.warn('[camera] native camera enumeration failed:', err);
    return [];
  }
}

function sessionFor(deviceId: string): CameraSession {
  let session = sessions.get(deviceId);
  if (!session) {
    session = {
      deviceId,
      sessionId: null,
      state: 'idle',
      error: null,
      retryAfter: 0,
      retryDelay: CAMERA_RETRY_MIN_MS,
    };
    sessions.set(deviceId, session);
  }
  return session;
}

const reportedFailures = new Map<string, string>();

function reportCameraFailure(session: CameraSession): void {
  const previous = reportedFailures.get(session.deviceId);
  if (previous === session.error) return;
  reportedFailures.set(session.deviceId, session.error ?? '');
  console.warn(`[camera] ${cameraLiveSourceId(session.deviceId)}: ${session.error}`);
}

function failSession(session: CameraSession): void {
  session.state = 'error';
  session.retryAfter = Date.now() + session.retryDelay;
  session.retryDelay = Math.min(session.retryDelay * 2, CAMERA_RETRY_MAX_MS);
  reportCameraFailure(session);
}

function startSession(session: CameraSession): void {
  if (session.state === 'starting' || session.state === 'live') return;
  if (session.state === 'error' && Date.now() < session.retryAfter) return;
  session.state = 'starting';
  const sessionId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `cam-${Math.abs(Date.now() ^ (performance.now() * 1000)).toString(36)}`;
  void invoke<{ ok?: boolean; error?: string }>('native_live_capture_start_camera', {
    sessionId,
    deviceId: session.deviceId,
  })
    .then((result) => {
      // Released while the permission prompt was up: stop the session rather
      // than leaving a camera light on for a layer that no longer wants it.
      if (!sessions.has(session.deviceId)) {
        void invoke('native_live_capture_stop', { sessionId }).catch(() => {});
        return;
      }
      if (!result?.ok) {
        session.error = result?.error || 'camera did not start';
        failSession(session);
        return;
      }
      session.sessionId = sessionId;
      session.state = 'live';
      session.error = null;
      session.retryDelay = CAMERA_RETRY_MIN_MS;
      reportedFailures.delete(session.deviceId);
      console.log(`[camera] ${cameraLiveSourceId(session.deviceId)} session ${sessionId} started`);
    })
    .catch((err: any) => {
      session.error = String(err?.message || err || 'camera start failed');
      failSession(session);
    });
}

/**
 * The layer source for a camera, or null while it is still opening (or failed).
 *
 * Starts the session on first call. The returned shape is the same one
 * MediaTray builds for its webcam sources, so the sync recognises it as a live
 * shared-texture source and needs no camera-specific upload path.
 */
export function cameraLayerSource(deviceId: string): NonNullable<Layer['source']> | null {
  const session = sessionFor(String(deviceId || ''));
  if (session.state !== 'live' || !session.sessionId) {
    startSession(session);
    return null;
  }
  return {
    id: cameraLiveSourceId(session.deviceId),
    name: 'Camera',
    type: 'video',
    src: `live://webcam/${session.sessionId}`,
    liveSourceType: 'webcam',
    liveSourceSessionId: session.sessionId,
  } as unknown as NonNullable<Layer['source']>;
}

/**
 * Stop any camera session no layer is pointed at any more.
 *
 * Driven from the full active set each sync pass rather than reference
 * counted: the sync already walks every layer, and a missed decrement would
 * leave the camera light on after the user switched the source away, which is
 * the most visible way this could misbehave.
 */
export function pruneCameraLiveSources(activeDeviceIds: Set<string>): void {
  for (const [deviceId, session] of sessions) {
    if (activeDeviceIds.has(deviceId)) continue;
    sessions.delete(deviceId);
    reportedFailures.delete(deviceId);
    if (session.sessionId) {
      void invoke('native_live_capture_stop', { sessionId: session.sessionId }).catch(() => {});
      console.log(`[camera] ${cameraLiveSourceId(deviceId)} released`);
    }
  }
}

/** Stop every camera session. For core shutdown and teardown. */
export function releaseAllCameraLiveSources(): void {
  pruneCameraLiveSources(new Set());
}
