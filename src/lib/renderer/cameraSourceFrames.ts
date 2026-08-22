/*
 * Webcam frames as a native source frame.
 *
 * The GPU instruments that take an image or video input (Flythrough, Pixel
 * Particles) could already be POINTED at a camera — GPULayerPanel has offered
 * the picker for a while — but the native path answered
 * `gpu-source:camera:native-ingest-pending` and drew nothing. This is that
 * ingest.
 *
 * There is no native camera capture in the core, so frames come from the
 * renderer: a <video> on the MediaStream, drawn to a canvas, read back, and
 * pushed through the same base64 `upload_source_frame` transport the text
 * atlas and splat textures use. The broker spills anything large to a temp
 * file on its own, so the wire cost is bounded without us managing it.
 *
 * One capture per device, shared by every layer pointed at it: two layers on
 * the same camera cost one stream and one upload per frame, not two.
 */

/** Square capture edge, in pixels.
 *
 * The core resamples every upload to a square slot regardless, so the choice
 * is only how many bytes cross per frame. 512 is 1MB a frame — 1024 would be
 * four times that, thirty times a second, for detail that a particle field
 * or a displacement map cannot resolve anyway. */
const CAMERA_CAPTURE_SIZE = 512;

/** ~30fps. Matches LIVE_CANVAS_REFRESH_MS: a camera is a live performance
 *  source, not a poster frame to refresh every few seconds. */
export const CAMERA_FRAME_INTERVAL_MS = 33;

type CameraCapture = {
  deviceId: string;
  video: HTMLVideoElement | null;
  stream: MediaStream | null;
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  /** currentTime of the last frame we captured. A camera that stalls stops
   *  advancing it, and we stop re-uploading identical pixels. */
  lastFrameTime: number;
  lastCaptureAt: number;
  seq: number;
  opening: boolean;
  /** Last getUserMedia failure, surfaced so a denied permission reads as a
   *  denied permission rather than a black layer. */
  error: string | null;
};

const captures = new Map<string, CameraCapture>();

/** Stable source id for a camera device. The empty deviceId is the system
 *  default camera, which is what the picker's first entry means. */
export function cameraSourceFrameId(deviceId: string | null | undefined): string {
  return `camera:${String(deviceId || 'default')}`;
}

/** True for ids minted by cameraSourceFrameId. */
export function isCameraSourceFrameId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('camera:');
}

/** Inverse of cameraSourceFrameId — 'camera:default' maps back to ''. */
export function cameraDeviceIdFromSourceFrameId(id: string): string {
  const raw = String(id || '').slice('camera:'.length);
  return raw === 'default' ? '' : raw;
}

export function cameraSourceError(deviceId: string | null | undefined): string | null {
  return captures.get(String(deviceId || ''))?.error ?? null;
}

function captureFor(deviceId: string): CameraCapture {
  let capture = captures.get(deviceId);
  if (!capture) {
    capture = {
      deviceId,
      video: null,
      stream: null,
      canvas: null,
      ctx: null,
      lastFrameTime: -1,
      lastCaptureAt: 0,
      seq: 0,
      opening: false,
      error: null,
    };
    captures.set(deviceId, capture);
  }
  return capture;
}

/**
 * Open a camera if it is not already open. Safe to call every sync pass — it
 * returns immediately once the stream is live, and never re-prompts.
 */
function openCamera(capture: CameraCapture): void {
  if (capture.stream || capture.opening) return;
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    capture.error = 'camera capture unavailable in this runtime';
    return;
  }
  capture.opening = true;
  const constraints: MediaStreamConstraints = {
    video: capture.deviceId ? { deviceId: { exact: capture.deviceId } } : true,
    audio: false,
  };
  navigator.mediaDevices
    .getUserMedia(constraints)
    .then((stream) => {
      capture.opening = false;
      // Released while the permission prompt was up: drop the stream rather
      // than leaving a camera light on for a layer that no longer wants it.
      if (!captures.has(capture.deviceId)) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.autoplay = true;
      /* Off-screen but attached and composited. A detached <video> can be
         throttled or left undecoded by the compositor, which shows up as a
         camera that opens, lights up, and then never advances a frame.
         display:none would do the same thing, hence the off-screen position. */
      video.style.cssText =
        'position:fixed;left:-10000px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
      document.body.appendChild(video);
      video.srcObject = stream;
      capture.stream = stream;
      capture.video = video;
      capture.error = null;
      void video.play().catch(() => {
        /* autoplay policy can defer the first frame; currentTime simply stays
           put until playback starts, so there is nothing to recover here. */
      });
      console.log(`[camera] opened ${cameraSourceFrameId(capture.deviceId)}`);
    })
    .catch((err: any) => {
      capture.opening = false;
      capture.error = String(err?.message || err || 'getUserMedia failed');
      console.warn(`[camera] ${cameraSourceFrameId(capture.deviceId)} failed:`, capture.error);
    });
}

export type CameraFrame = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  seq: number;
};

/**
 * The next frame from this camera, or null when there is nothing new to send.
 *
 * Opens the device on first call. Returns null while the permission prompt is
 * up, while the stream is warming, and on every tick that has no new frame —
 * callers upload only when they get something back.
 */
export function nextCameraFrame(deviceId: string, now: number): CameraFrame | null {
  const capture = captureFor(String(deviceId || ''));
  if (!capture.stream) {
    openCamera(capture);
    return null;
  }
  const video = capture.video;
  if (!video || video.readyState < 2) return null;
  if (now - capture.lastCaptureAt < CAMERA_FRAME_INTERVAL_MS) return null;
  /* Freshness by currentTime rather than requestVideoFrameCallback: rVFC does
     not fire reliably for a video the page never composites, which reads as a
     camera that opens and then produces nothing at all. */
  if (video.currentTime === capture.lastFrameTime) return null;

  const size = CAMERA_CAPTURE_SIZE;
  if (!capture.canvas) {
    capture.canvas = document.createElement('canvas');
    capture.canvas.width = size;
    capture.canvas.height = size;
    capture.ctx = capture.canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = capture.ctx;
  if (!ctx) return null;

  const vw = video.videoWidth || 0;
  const vh = video.videoHeight || 0;
  if (vw <= 0 || vh <= 0) return null;

  /* Centre-crop to square rather than squashing.
   *
   * The core stretches every upload to a square slot, so handing it a 16:9
   * frame would render a visibly squeezed picture — a face narrowed by a
   * third. Cropping loses the sides of a wide camera, which is the lesser
   * wrong for a source that is being read as a particle distribution or a
   * displacement map. */
  const edge = Math.min(vw, vh);
  const sx = (vw - edge) / 2;
  const sy = (vh - edge) / 2;
  ctx.drawImage(video, sx, sy, edge, edge, 0, 0, size, size);

  capture.lastFrameTime = video.currentTime;
  capture.lastCaptureAt = now;
  capture.seq += 1;
  return {
    width: size,
    height: size,
    rgba: ctx.getImageData(0, 0, size, size).data,
    seq: capture.seq,
  };
}

function closeCapture(capture: CameraCapture): void {
  if (capture.stream) {
    try { capture.stream.getTracks().forEach((track) => track.stop()); } catch { /* */ }
  }
  if (capture.video) {
    try { (capture.video as any).srcObject = null; } catch { /* */ }
    try { capture.video.remove(); } catch { /* */ }
  }
  capture.stream = null;
  capture.video = null;
  capture.canvas = null;
  capture.ctx = null;
  capture.lastFrameTime = -1;
}

/**
 * Stop any camera no layer is pointed at any more.
 *
 * Called with the full active set each sync pass rather than reference
 * counted: the sync already walks every layer, and a missed decrement would
 * leave the camera light on after the user switched away — the most visible
 * possible bug in this feature.
 */
export function pruneCameraCaptures(activeDeviceIds: Set<string>): void {
  for (const [deviceId, capture] of captures) {
    if (activeDeviceIds.has(deviceId)) continue;
    closeCapture(capture);
    captures.delete(deviceId);
    console.log(`[camera] released ${cameraSourceFrameId(deviceId)}`);
  }
}

/** Stop every camera. For core shutdown and hot-reload teardown. */
export function releaseAllCameraCaptures(): void {
  pruneCameraCaptures(new Set());
}
