/**
 * Auto-map: the phone asks a paired desktop to show stripe frames on each
 * open Screen, photographs every frame from one fixed spot, and works out
 * where each projector's picture lands in the photo. The result drops into
 * the calibration workshop in place of four tapped corners.
 *
 * The link and the camera are passed in, so the whole run can be tested
 * against a simulated projector and camera.
 */
import { planPatterns, decodeCaptures, fitHomography, applyHomography, type Capture, type Decoded, type PatternFrame, type PatternPlan, type UV } from './structuredLight';
import { stripeFrameCode, STRIPE_CELL } from './structuredLightCodes';

export type AutoMapScreen = { id: string; name: string; width: number; height: number };
export type AutoMapLink = { request(op: 'screens' | 'show' | 'end', extra?: Record<string, unknown>): Promise<Record<string, any>> };
export type AutoMapCamera = { turn?: number; grab(): Promise<Capture>; jpeg?(): Promise<{ image: string; width: number; height: number }> };
export type AutoMapProjector = {
  id: string; name: string; width: number; height: number;
  corners: UV[];        // the full picture's corners in the photo, TL TR BR BL
  rmsPx: number;        // fit error in projector pixels
  coverage: number;     // share of the photo that saw this projector
  plan: PatternPlan;    // kept so each outlined surface can be fitted on its own
  decoded: Decoded;
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
  let colour: { image: string; width: number; height: number } | undefined;
  try {
    for (const [index, screen] of screens.entries()) {
      const plan = planPatterns(screen.width, screen.height, STRIPE_CELL);
      const captures: Capture[] = [];
      for (const [step, frame] of plan.frames.entries()) {
        progress(`${screen.name}: pattern ${step + 1} of ${plan.frames.length} (projector ${index + 1} of ${screens.length}). Keep the phone still.`);
        await link.request('show', { screenId: screen.id, frame: stripeFrameCode(frame as PatternFrame, STRIPE_CELL) });
        await wait(settle);
        const shot = await camera.grab();
        if (step === 0 && index === 0 && camera.jpeg) colour = await camera.jpeg().catch(() => undefined);
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
      let seen = 0;
      for (let i = 0; i < decoded.valid.length; i++) seen += decoded.valid[i];
      if (seen < 400) throw new Error(`${screen.name}: the stripes could not be read. Check the projector is in the photo, dim the room, and keep the phone still.`);
      // One fit across the whole photo only suits a single flat surface, so
      // it is a best effort: each outlined surface is fitted on its own later.
      let corners: UV[] = [{ x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }], rmsPx = Number.NaN;
      try {
        const fit = fitHomography(plan, decoded);
        if (fit.cornersInPhoto.every(p => p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) { corners = fit.cornersInPhoto; rmsPx = fit.rmsPx; }
      } catch { /* not one plane: expected for an object */ }
      projectors.push({ id: screen.id, name: screen.name, width: screen.width, height: screen.height, corners, rmsPx, coverage: decoded.coverage, plan, decoded });
    }
  } finally {
    await link.request('end').catch(() => {});
  }
  const encode = options.encode ?? lumaToJpeg;
  return { reference: { image: colour && !options.encode ? colour.image : encode(brightest!, width, height), width, height }, projectors };
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
/**
 * How far to turn the camera picture clockwise so it is upright, from how
 * the phone is being held. The app is locked to portrait, so a phone on its
 * side still delivers a portrait picture with the scene lying down.
 * Resolves 0 when the phone will not say (no sensor, or permission refused).
 */
export async function uprightTurn(): Promise<{ turn: 0 | 90 | 180 | 270; gravity: [number, number] | null }> {
  const Motion = (globalThis as any).DeviceMotionEvent;
  if (!Motion) return { turn: 0, gravity: null };
  try { if (typeof Motion.requestPermission === 'function' && (await Motion.requestPermission()) !== 'granted') return { turn: 0, gravity: null }; }
  catch { return { turn: 0, gravity: null }; }
  return new Promise(resolve => {
    let sx = 0, sy = 0, n = 0;
    const read = (event: DeviceMotionEvent) => { const g = event.accelerationIncludingGravity; if (g?.x != null && g?.y != null) { sx += g.x; sy += g.y; n++; } };
    window.addEventListener('devicemotion', read);
    setTimeout(() => {
      window.removeEventListener('devicemotion', read);
      if (!n) return resolve({ turn: 0, gravity: null });
      const x = sx / n, y = sy / n;
      // iOS reports gravity itself: about -9.8 on y upright, -9.8 on x with the top of the phone to the left.
      const turn = Math.abs(x) > Math.abs(y) ? (x < 0 ? 270 : 90) : (y > 0 ? 180 : 0);
      resolve({ turn, gravity: [Math.round(x * 10) / 10, Math.round(y * 10) / 10] });
    }, 350);
  });
}

export async function openAutoMapCamera(preview?: HTMLVideoElement, turn: 0 | 90 | 180 | 270 = 0): Promise<AutoMapCamera & { stop(): void }> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('The camera is unavailable here. Open the installed app.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30, max: 30 } } });
  const video = preview ?? document.createElement('video');
  video.playsInline = true; video.muted = true; video.srcObject = stream;
  await video.play();
  for (let i = 0; i < 100 && !video.videoWidth; i++) await wait(50);
  if (!video.videoWidth) { stream.getTracks().forEach(t => t.stop()); throw new Error('The camera did not start.'); }
  // Enough pixels to resolve the finest stripes without a slow decode.
  const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
  const rawWidth = Math.round(video.videoWidth * scale), rawHeight = Math.round(video.videoHeight * scale);
  const sideways = turn === 90 || turn === 270;
  const width = sideways ? rawHeight : rawWidth, height = sideways ? rawWidth : rawHeight;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  /** The current video frame, turned upright. */
  const draw = () => {
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(width / 2, height / 2);
    context.rotate(turn * Math.PI / 180);
    context.drawImage(video, -rawWidth / 2, -rawHeight / 2, rawWidth, rawHeight);
    context.setTransform(1, 0, 0, 1, 0, 0);
  };
  const nextFrame = () => new Promise<void>(resolve => {
    const v = video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(() => resolve()); else setTimeout(resolve, 45);
  });
  return {
    turn,
    async grab() {
      // Three frames averaged: steadier than one against sensor noise.
      const luma = new Float32Array(width * height);
      const frames = 3;
      for (let n = 0; n < frames; n++) {
        await nextFrame();
        draw();
        const data = context.getImageData(0, 0, width, height).data;
        for (let i = 0, p = 0; i < luma.length; i++, p += 4) luma[i] += (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / frames;
      }
      return { width, height, luma };
    },
    /** One colour photo of what the camera sees now, for a desktop-driven run. */
    async jpeg() {
      await nextFrame(); await nextFrame();
      draw();
      return { image: canvas.toDataURL('image/jpeg', 0.9), width, height };
    },
    stop() { stream.getTracks().forEach(t => t.stop()); if (!preview) video.srcObject = null; },
  };
}

/**
 * Desktop-driven capture: the phone announces its camera and then takes a
 * photo each time the desktop asks, so the desktop can run and re-run the
 * whole measurement while the phone sits on a tripod. Returns a stop function.
 */
export function serveRemoteCapture(socket: WebSocket, camera: AutoMapCamera): () => void {
  const requestId = crypto.randomUUID();
  const send = (body: Record<string, unknown>) => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'studio_automap_request', requestId, ...body }));
  };
  const announce = () => send({ seq: 0, op: 'camera_ready', turn: camera.turn ?? 0 });
  const receive = async (event: MessageEvent) => {
    let message: Record<string, any>;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (message.type !== 'studio_automap_reply' || message.requestId !== requestId || !message.grab || !camera.jpeg) return;
    try { send({ seq: message.seq, op: 'frame', ...(await camera.jpeg()) }); }
    catch (error) { send({ seq: message.seq, op: 'frame', error: error instanceof Error ? error.message : 'capture failed' }); }
  };
  socket.addEventListener('message', receive);
  announce();
  const timer = setInterval(announce, 3000);
  return () => { clearInterval(timer); socket.removeEventListener('message', receive); send({ seq: 0, op: 'camera_gone' }); };
}

export type MappedSurface = {
  points: UV[];     // the outline in the projector's raster, normalised 0..1, top-left origin, same order as traced
  rmsPx: number;    // fit error in projector pixels
  agree: number;    // share of the measured points inside the outline that lie on one plane
};

/**
 * Where an outlined surface sits in the projector's own picture. The outline
 * is traced on the photo; the stripe measurements inside it are fitted as
 * one plane, on their own, so a box face maps correctly even though the
 * wall behind it and the face beside it are at other depths.
 * `outline` is normalised photo coordinates. Throws a plain message when the
 * projector did not light enough of the surface.
 */
export function mapSurface(projector: Pick<AutoMapProjector, 'plan' | 'decoded' | 'width' | 'height'>, outline: UV[]): MappedSurface {
  const { decoded, plan } = projector;
  if (outline.length < 3) throw new Error('Tap at least three corners.');
  const quad = outline.map(p => ({ x: p.x * decoded.width, y: p.y * decoded.height }));
  const cx = quad.reduce((sum, p) => sum + p.x, 0) / quad.length, cy = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
  // Sample a little inside the outline: its edge pixels straddle two surfaces.
  const inner = quad.map(p => ({ x: cx + (p.x - cx) * 0.93, y: cy + (p.y - cy) * 0.93 }));
  const inside = (x: number, y: number) => {
    let hit = false;
    for (let i = 0, j = inner.length - 1; i < inner.length; j = i++) {
      const a = inner[i], b = inner[j];
      if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) hit = !hit;
    }
    return hit;
  };
  const valid = new Uint8Array(decoded.valid.length);
  let count = 0;
  const [minX, maxX] = [Math.max(0, Math.floor(Math.min(...inner.map(p => p.x)))), Math.min(decoded.width - 1, Math.ceil(Math.max(...inner.map(p => p.x))))];
  const [minY, maxY] = [Math.max(0, Math.floor(Math.min(...inner.map(p => p.y)))), Math.min(decoded.height - 1, Math.ceil(Math.max(...inner.map(p => p.y))))];
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const i = y * decoded.width + x;
    if (decoded.valid[i] && inside(x + 0.5, y + 0.5)) { valid[i] = 1; count++; }
  }
  if (count < 60) throw new Error('The projector does not light enough of this surface to map it. Outline a surface inside the projected picture.');
  let fit;
  try { fit = fitHomography(plan, { ...decoded, valid, coverage: count / valid.length }, { inlierPx: Math.max(12, plan.cell * 0.6) }); }
  catch { throw new Error('This outline does not look like one flat surface. Outline each flat face on its own.'); }
  const points = quad.map(p => {
    const q = applyHomography(fit.cameraToProjector, p.x, p.y);
    return { x: q.x / projector.width, y: q.y / projector.height };
  });
  return { points, rmsPx: fit.rmsPx, agree: fit.inliers / Math.max(1, fit.samples) };
}
