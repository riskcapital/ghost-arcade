/**
 * Auto-map stripe patterns on Screens.
 *
 * A paired phone maps a projector by photographing stripe frames on it (see
 * mobile/studio/structuredLightCodes.ts for the frame numbers). The editor
 * says which frame each open Screen shows; each Screen window draws it over
 * its picture at its own pixel size, and tells the editor that size.
 */
import { get, writable } from 'svelte/store';

const CHANNEL = 'ghost-arcade-screen-patterns';
/** A capture that stops talking is cleared, so a dropped phone never leaves stripes on a projector. */
const WATCHDOG_MS = 15000;

export interface OpenScreenOutput { id: string; name: string; width: number; height: number }
type Message =
  | { type: 'frames'; frames: Record<string, number> }
  | { type: 'who' }
  | { type: 'open'; id: string; width: number; height: number }
  | { type: 'closed'; id: string };

/** Screens with a window open on a display, at the pixel size they draw. */
export const openScreenOutputList = writable<OpenScreenOutput[]>([]);

/**
 * Draw one stripe frame. `number` is 0 for white, 1 for black, otherwise a
 * Gray-code bit plane; the hundreds carry the stripe size (8 pixels doubled
 * that many times). Positions count from the top left of the Screen.
 */
export function drawStripeFrame(ctx: CanvasRenderingContext2D, width: number, height: number, number: number): void {
  const cellPx = 8 << Math.min(Math.floor(number / 100), 4);
  const frame = number % 100;
  ctx.fillStyle = frame === 0 ? '#fff' : '#000';
  ctx.fillRect(0, 0, width, height);
  if (frame < 2) return;
  const k = frame - 2, inverted = k & 1, vertical = ((k >> 5) & 1) === 1, bit = (k >> 1) & 15;
  const size = vertical ? height : width;
  const cells = Math.ceil(size / cellPx);
  let bits = 0;
  while (bits < 16 && (1 << bits) < cells) bits++;
  if (bit >= bits) return;
  ctx.fillStyle = '#fff';
  for (let cell = 0; cell < cells; cell++) {
    const gray = cell ^ (cell >> 1);
    if ((((gray >> (bits - 1 - bit)) & 1) ^ inverted) === 0) continue;
    if (vertical) ctx.fillRect(0, cell * cellPx, width, cellPx);
    else ctx.fillRect(cell * cellPx, 0, cellPx, height);
  }
}

// ---- Editor side ----

let editor: BroadcastChannel | null = null;
let watchdog: ReturnType<typeof setTimeout> | undefined;
const open = new Map<string, { width: number; height: number }>();
let nameOf: (id: string) => string = (id) => id;

function publishOpen() {
  openScreenOutputList.set([...open].map(([id, size]) => ({ id, name: nameOf(id), ...size })));
}

/** Start listening for Screen windows. `screenName` gives a Screen's current name. */
export function watchScreenOutputs(screenName: (id: string) => string): () => void {
  nameOf = screenName;
  if (typeof BroadcastChannel === 'undefined') return () => {};
  editor = new BroadcastChannel(CHANNEL);
  editor.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data;
    if (msg?.type === 'open' && typeof msg.id === 'string' && msg.width > 0 && msg.height > 0) {
      open.set(msg.id, { width: Math.round(msg.width), height: Math.round(msg.height) });
      publishOpen();
    } else if (msg?.type === 'closed' && open.delete(msg.id)) {
      publishOpen();
    }
  };
  editor.postMessage({ type: 'who' } satisfies Message);
  return () => { clearTimeout(watchdog); editor?.close(); editor = null; open.clear(); publishOpen(); };
}

/** Show `frame` on each named Screen, or clear every pattern with null. */
export function setScreenPatternFrames(frames: Record<string, number> | null): void {
  clearTimeout(watchdog);
  editor?.postMessage({ type: 'frames', frames: frames ? { ...frames } : {} } satisfies Message);
  if (frames) watchdog = setTimeout(() => setScreenPatternFrames(null), WATCHDOG_MS);
}

export function openScreenOutputs(): OpenScreenOutput[] {
  publishOpen();
  return get(openScreenOutputList);
}

// ---- Screen window side ----

/**
 * Run inside a Screen window. Calls `show` with the frame to draw, or null to
 * go back to the picture, and keeps the editor told of the window's size.
 */
export function followScreenPatterns(screenId: string, size: () => { width: number; height: number }, show: (frame: number | null) => void): () => void {
  if (typeof BroadcastChannel === 'undefined' || !screenId) return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  const announce = () => channel.postMessage({ type: 'open', id: screenId, ...size() } satisfies Message);
  channel.onmessage = (event: MessageEvent<Message>) => {
    const msg = event.data;
    if (msg?.type === 'who') announce();
    else if (msg?.type === 'frames') {
      const frame = msg.frames?.[screenId];
      show(Number.isInteger(frame) && frame >= 0 && frame < 500 ? frame : null);
    }
  };
  const closed = () => channel.postMessage({ type: 'closed', id: screenId } satisfies Message);
  window.addEventListener('resize', announce);
  window.addEventListener('pagehide', closed);
  announce();
  return () => { window.removeEventListener('resize', announce); window.removeEventListener('pagehide', closed); closed(); channel.close(); };
}
