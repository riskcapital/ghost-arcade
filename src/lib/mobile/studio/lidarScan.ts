/**
 * The LiDAR camera for auto-map: stripe photos and depth from one ARKit
 * camera (StudioLiveCapture pattern capture), so the photos, the depth map
 * and the lens line up exactly. Everything arrives in the sensor's
 * orientation and is turned upright here, together.
 */
import type { AutoMapCamera } from './autoMap';
import type { DepthScan, Intrinsics } from './meshMap';
import type { Capture } from './structuredLight';
import { acquireNativeFeed } from './nativeLive';

export type Turn = 0 | 90 | 180 | 270;
export type PatternLuma = { width: number; height: number; frames: number; pose: Float32Array; luma: Uint8Array };
export type PatternDepth = { width: number; height: number; frames: number; imageWidth: number; imageHeight: number; intrinsics: Intrinsics; pose: Float32Array; meters: Float32Array };

const LUMA_MAGIC = 0x4741504c; // "GAPL"
const DEPTH_MAGIC = 0x47415044; // "GAPD"

export function parsePatternLuma(buffer: ArrayBuffer): PatternLuma {
  const view = new DataView(buffer);
  if (buffer.byteLength < 84 || view.getUint32(0, true) !== LUMA_MAGIC) throw new Error('Invalid camera frame.');
  const width = view.getUint32(8, true), height = view.getUint32(12, true);
  if (!width || !height || width > 4096 || height > 4096 || buffer.byteLength !== 84 + width * height) throw new Error('Incomplete camera frame.');
  const pose = new Float32Array(16);
  for (let k = 0; k < 16; k++) pose[k] = view.getFloat32(20 + k * 4, true);
  return { width, height, frames: view.getUint32(16, true), pose, luma: new Uint8Array(buffer, 84, width * height) };
}

export function parsePatternDepth(buffer: ArrayBuffer): PatternDepth {
  const view = new DataView(buffer);
  if (buffer.byteLength < 104 || view.getUint32(0, true) !== DEPTH_MAGIC) throw new Error('Invalid depth frame.');
  const width = view.getUint32(4, true), height = view.getUint32(8, true);
  if (!width || !height || width > 1024 || height > 1024 || buffer.byteLength !== 104 + width * height * 4) throw new Error('Incomplete depth frame.');
  const f = (offset: number) => view.getFloat32(offset, true);
  const pose = new Float32Array(16);
  for (let k = 0; k < 16; k++) pose[k] = f(40 + k * 4);
  const meters = new Float32Array(width * height);
  for (let k = 0; k < meters.length; k++) meters[k] = f(104 + k * 4);
  return {
    width, height, frames: view.getUint32(12, true), imageWidth: view.getUint32(16, true), imageHeight: view.getUint32(20, true),
    intrinsics: { fx: f(24), fy: f(28), cx: f(32), cy: f(36) }, pose, meters,
  };
}

/** Turns a raster clockwise by `turn` degrees. */
export function turnRaster<T extends Uint8Array | Float32Array>(data: T, width: number, height: number, turn: Turn): { data: T; width: number; height: number } {
  if (turn === 0) return { data, width, height };
  const out = new (data.constructor as { new (n: number): T })(data.length);
  const sideways = turn === 90 || turn === 270;
  const w2 = sideways ? height : width, h2 = sideways ? width : height;
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) {
    let x: number, y: number;
    if (turn === 90) { x = height - 1 - j; y = i; }
    else if (turn === 180) { x = width - 1 - i; y = height - 1 - j; }
    else { x = j; y = width - 1 - i; }
    out[y * w2 + x] = data[j * width + i];
  }
  return { data: out, width: w2, height: h2 };
}

/** The lens of a photo turned clockwise by `turn` (normalised intrinsics follow the picture). */
export function turnIntrinsics(k: Intrinsics, turn: Turn): Intrinsics {
  if (turn === 90) return { fx: k.fy, fy: k.fx, cx: 1 - k.cy, cy: k.cx };
  if (turn === 180) return { fx: k.fx, fy: k.fy, cx: 1 - k.cx, cy: 1 - k.cy };
  if (turn === 270) return { fx: k.fy, fy: k.fx, cx: k.cy, cy: 1 - k.cx };
  return { ...k };
}

/** How far the camera moved between two poses (4x4, column-major). */
export function poseChange(a: ArrayLike<number>, b: ArrayLike<number>): { metres: number; degrees: number } {
  const metres = Math.hypot(a[12] - b[12], a[13] - b[13], a[14] - b[14]);
  // trace(Ra^T Rb) = sum over the 3x3 of a[i] * b[i].
  let trace = 0;
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) trace += a[c * 4 + r] * b[c * 4 + r];
  const degrees = (Math.acos(Math.max(-1, Math.min(1, (trace - 1) / 2))) * 180) / Math.PI;
  return { metres, degrees };
}

/** Beyond this the stripe photos no longer line up with each other. */
const MOVED = { metres: 0.03, degrees: 1.5 };

type Cap = { getPlatform?: () => string; nativePromise?: (plugin: string, method: string, args: Record<string, unknown>) => Promise<unknown> };
const cap = () => (globalThis as unknown as { Capacitor?: Cap }).Capacitor;
function call<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = cap();
  if (c?.getPlatform?.() !== 'ios' || !c.nativePromise) return Promise.reject(new Error('LiDAR scanning needs the iPhone or iPad app.'));
  return c.nativePromise('StudioCapture', method, args) as Promise<T>;
}

async function fetchBinary(url: string, timeoutMs: number): Promise<ArrayBuffer> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetch(url, { cache: 'no-store', signal: abort.signal });
    if (!response.ok) throw new Error((await response.text()) || 'The camera did not answer.');
    return await response.arrayBuffer();
  } catch (error) {
    if (abort.signal.aborted) throw new Error('The camera did not answer in time. Keep the app open and scan again.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export type LidarAutoMapCamera = AutoMapCamera & { turn: Turn; lock(): Promise<void>; depth(): Promise<DepthScan>; stop(): void };

/**
 * Starts the LiDAR camera for a scan. `preview` (optional) shows a live grey
 * picture, upright, while the phone is being placed.
 */
export async function openLidarAutoMapCamera(preview?: HTMLCanvasElement): Promise<LidarAutoMapCamera> {
  const lease = await acquireNativeFeed('depth');
  let stopped = false;
  let info: { width: number; height: number; turn: number; intrinsics: number[] };
  try {
    info = await call('patternBegin');
  } catch (error) {
    lease.release();
    throw error;
  }
  const turn = ([0, 90, 180, 270].includes(info.turn) ? info.turn : 0) as Turn;
  let firstPose: Float32Array | null = null;
  const checkStill = (pose: Float32Array) => {
    if (!firstPose) { firstPose = pose; return; }
    const moved = poseChange(firstPose, pose);
    if (moved.metres > MOVED.metres || moved.degrees > MOVED.degrees) throw new Error('The phone moved during the scan. Prop it so it cannot move and scan again.');
  };

  // The live preview: a small grey frame a few times a second, until the scan starts.
  let previewing = !!preview;
  const drawPreview = async () => {
    while (previewing && !stopped) {
      try {
        const frame = parsePatternLuma(await fetchBinary('ghostcapture://pattern/luma?frames=1&width=480', 3000));
        const upright = turnRaster(frame.luma, frame.width, frame.height, turn);
        const canvas = preview!;
        if (canvas.width !== upright.width || canvas.height !== upright.height) { canvas.width = upright.width; canvas.height = upright.height; }
        const context = canvas.getContext('2d');
        if (context) {
          const image = context.createImageData(upright.width, upright.height);
          for (let i = 0; i < upright.data.length; i++) { const v = upright.data[i]; image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v; image.data[i * 4 + 3] = 255; }
          context.putImageData(image, 0, 0);
        }
      } catch { /* a missed preview frame is fine */ }
      await new Promise(resolve => setTimeout(resolve, 120));
    }
  };
  void drawPreview();

  return {
    turn,
    async grab(): Promise<Capture> {
      previewing = false;
      const frame = parsePatternLuma(await fetchBinary('ghostcapture://pattern/luma?frames=3&width=1280', 6000));
      checkStill(frame.pose);
      const upright = turnRaster(frame.luma, frame.width, frame.height, turn);
      return { width: upright.width, height: upright.height, luma: upright.data };
    },
    /** A colour photo of the scene, upright, for the results and for paintings. */
    async jpeg() {
      const reference = await call<{ image: string; width: number; height: number }>('calibrationReference');
      const image = new Image();
      image.src = reference.image;
      await image.decode();
      const sideways = turn === 90 || turn === 270;
      const canvas = document.createElement('canvas');
      canvas.width = sideways ? image.height : image.width;
      canvas.height = sideways ? image.width : image.height;
      const context = canvas.getContext('2d')!;
      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate((turn * Math.PI) / 180);
      context.drawImage(image, -image.width / 2, -image.height / 2);
      return { image: canvas.toDataURL('image/jpeg', 0.9), width: canvas.width, height: canvas.height };
    },
    /** Holds exposure, focus and white balance for the rest of the scan. */
    async lock() {
      await call('patternLock', { locked: true });
    },
    async depth(): Promise<DepthScan> {
      const scan = parsePatternDepth(await fetchBinary('ghostcapture://pattern/depth?frames=15', 8000));
      checkStill(scan.pose);
      const upright = turnRaster(scan.meters, scan.width, scan.height, turn);
      // The pose stays: it says which way gravity points (depthCapture.ts gravityInScan).
      return { width: upright.width, height: upright.height, meters: upright.data, intrinsics: turnIntrinsics(scan.intrinsics, turn), pose: Array.from(scan.pose), turn };
    },
    stop() {
      if (stopped) return;
      stopped = true;
      previewing = false;
      void call('patternEnd').catch(() => {}).finally(() => lease.release());
    },
  };
}
