/**
 * Auto-map: the phone asks a paired desktop to show stripe frames on each
 * open Screen, photographs every frame from one fixed spot, and works out
 * where each projector's picture lands in the photo. The result drops into
 * the calibration workshop in place of four tapped corners.
 *
 * The link and the camera are passed in, so the whole run can be tested
 * against a simulated projector and camera.
 */
import { planPatterns, decodeCaptures, fitHomography, type Capture, type PatternFrame, type UV } from './structuredLight';
import { stripeFrameCode, STRIPE_CELL } from './structuredLightCodes';

export type AutoMapScreen = { id: string; name: string; width: number; height: number };
export type AutoMapLink = { request(op: 'screens' | 'show' | 'end', extra?: Record<string, unknown>): Promise<Record<string, any>> };
export type AutoMapCamera = { grab(): Promise<Capture> };
export type AutoMapProjector = {
  id: string; name: string; width: number; height: number;
  corners: UV[];        // the full picture's corners in the photo, TL TR BR BL
  rmsPx: number;        // fit error in projector pixels
  coverage: number;     // share of the photo that saw this projector
};
export type AutoMapResult = {
  reference: { image: string; width: number; height: number };
  projectors: AutoMapProjector[];
};

/** Time for the projector and the camera pipeline to show the new frame. */
const SETTLE_MS = 320;
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function runAutoMap(
  link: AutoMapLink,
  camera: AutoMapCamera,
  progress: (text: string) => void = () => {},
  options: { settleMs?: number; encode?: (luma: Float32Array, width: number, height: number) => string } = {},
): Promise<AutoMapResult> {
  const settle = options.settleMs ?? SETTLE_MS;
  const listed = await link.request('screens');
  const screens: AutoMapScreen[] = Array.isArray(listed.screens) ? listed.screens : [];
  if (!screens.length) throw new Error('No Screen is open on a projector. On the desktop, use Open on display for each Screen first.');
  if (Array.isArray(listed.cells) && !listed.cells.includes(STRIPE_CELL)) throw new Error('This desktop uses a different pattern size. Update both apps.');
  const projectors: AutoMapProjector[] = [];
  let brightest: Float32Array | undefined, width = 0, height = 0;
  try {
    for (const [index, screen] of screens.entries()) {
      const plan = planPatterns(screen.width, screen.height, STRIPE_CELL);
      const captures: Capture[] = [];
      for (const [step, frame] of plan.frames.entries()) {
        progress(`${screen.name}: pattern ${step + 1} of ${plan.frames.length} (projector ${index + 1} of ${screens.length}). Keep the phone still.`);
        await link.request('show', { screenId: screen.id, frame: stripeFrameCode(frame as PatternFrame, STRIPE_CELL) });
        await wait(settle);
        const shot = await camera.grab();
        if (captures.length && (shot.width !== captures[0].width || shot.height !== captures[0].height)) throw new Error('The camera changed size during the capture. Keep the app open and try again.');
        captures.push(shot);
      }
      // The white frames of every projector together make the reference photo.
      const white = captures[0];
      width = white.width; height = white.height;
      brightest ??= new Float32Array(width * height);
      for (let i = 0; i < brightest.length; i++) brightest[i] = Math.max(brightest[i], white.luma[i]);
      progress(`${screen.name}: reading the patterns.`);
      await wait(0);
      const decoded = decodeCaptures(plan, captures);
      let fit;
      try { fit = fitHomography(plan, decoded); }
      catch (error) { throw new Error(`${screen.name}: ${error instanceof Error ? error.message : 'the patterns could not be read.'}`); }
      if (fit.cornersInPhoto.some(p => p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) {
        throw new Error(`${screen.name}: part of its picture is outside the photo. Move back until the whole picture is in frame, then try again.`);
      }
      projectors.push({ id: screen.id, name: screen.name, width: screen.width, height: screen.height, corners: fit.cornersInPhoto, rmsPx: fit.rmsPx, coverage: decoded.coverage });
    }
  } finally {
    await link.request('end').catch(() => {});
  }
  const encode = options.encode ?? lumaToJpeg;
  return { reference: { image: encode(brightest!, width, height), width, height }, projectors };
}

/** Grey photo from luma, stretched to its own range so a dim room still reads. */
export function lumaToJpeg(luma: Float32Array, width: number, height: number): string {
  let top = 1;
  for (let i = 0; i < luma.length; i++) if (luma[i] > top) top = luma[i];
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d')!;
  const image = context.createImageData(width, height);
  for (let i = 0; i < luma.length; i++) {
    const v = Math.round(255 * Math.pow(luma[i] / top, 0.6));
    image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
    image.data[i * 4 + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL('image/jpeg', 0.88);
}

/** Requests over the pairing socket; one answer per request, in order. */
export function socketAutoMapLink(socket: WebSocket, timeoutMs = 5000): AutoMapLink {
  const requestId = crypto.randomUUID();
  let seq = 0;
  return {
    request(op, extra = {}) {
      if (socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Desktop disconnected.'));
      const mine = ++seq;
      return new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); socket.removeEventListener('message', receive); };
        const timer = setTimeout(() => { done(); reject(new Error('The desktop did not answer. Update the desktop app, or check it is still paired.')); }, timeoutMs);
        const receive = (event: MessageEvent) => {
          let reply: Record<string, any>;
          try { reply = JSON.parse(String(event.data)); } catch { return; }
          if (reply.type !== 'studio_automap_reply' || reply.requestId !== requestId || reply.seq !== mine) return;
          done();
          if (reply.error) reject(new Error(String(reply.error))); else resolve(reply);
        };
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ type: 'studio_automap_request', requestId, seq: mine, op, ...extra }));
      });
    },
  };
}

/** The rear camera as a source of averaged luma frames. */
export async function openAutoMapCamera(preview?: HTMLVideoElement): Promise<AutoMapCamera & { stop(): void }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('The camera is unavailable here. Open the installed app.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } } });
  const video = preview ?? document.createElement('video');
  video.playsInline = true; video.muted = true; video.srcObject = stream;
  await video.play();
  for (let i = 0; i < 100 && !video.videoWidth; i++) await wait(50);
  if (!video.videoWidth) { stream.getTracks().forEach(t => t.stop()); throw new Error('The camera did not start.'); }
  // Enough pixels to resolve the finest stripes without a slow decode.
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  const nextFrame = () => new Promise<void>(resolve => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve()); else setTimeout(resolve, 45);
  });
  return {
    async grab() {
      // Three frames averaged: steadier than one against sensor noise.
      const luma = new Float32Array(width * height);
      const frames = 3;
      for (let n = 0; n < frames; n++) {
        await nextFrame();
        context.drawImage(video, 0, 0, width, height);
        const data = context.getImageData(0, 0, width, height).data;
        for (let i = 0, p = 0; i < luma.length; i++, p += 4) luma[i] += (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / frames;
      }
      return { width, height, luma };
    },
    stop() { stream.getTracks().forEach(t => t.stop()); if (!preview) video.srcObject = null; },
  };
}
