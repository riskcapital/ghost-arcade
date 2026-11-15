/**
 * What a paired desktop says it can do (`studio_capabilities`), and how the
 * phone asks (`studio_capabilities_request`).
 *
 * The answer stays version 1; newer features are flags beside it, so a phone
 * shows a feature only when the desktop names it and otherwise behaves as it
 * did before the desktop learned it:
 *   interactiveWorld: 1        the 3D world in the paired Interactive editor
 *   worldTools: [...]          which touch tools the desktop acts on
 *   depthCapture: { limits }   it takes a room scan for Depth mode
 *   output: { width, height }  the shape of its output, which the editor uses
 */
import { appInfo } from './nativeOutput';
import type { TouchTool } from '../../components/studio/interactiveEditorTypes';

export const WORLD_TOOLS: TouchTool[] = ['throw', 'push', 'pour', 'ignite', 'attract', 'repel', 'vortex'];
const BASIC_TOOLS: TouchTool[] = ['attract', 'repel', 'vortex'];

export type DepthCaptureLimits = {
  version: 1;
  maxSurfaces: number;
  maxSamplesPerSurface: number;
  maxSamplesTotal: number;
  maxOutline: number;
  maxBytes: number;
};
/** The contract's limits, which a desktop may only lower. */
export const DEPTH_CAPTURE_LIMITS: DepthCaptureLimits = {
  version: 1,
  maxSurfaces: 48,
  maxSamplesPerSurface: 4000,
  maxSamplesTotal: 60000,
  maxOutline: 64,
  maxBytes: 8_000_000,
};

export type DesktopCapabilities = {
  nativeInteractive: boolean;
  /** The 3D world, with the touch tools the desktop acts on (world tools first). Null on an older desktop. */
  world: { tools: TouchTool[] } | null;
  depthCapture: DepthCaptureLimits | null;
  /** The desktop output's size, when it says. */
  output: { width: number; height: number } | null;
};

const count = (raw: unknown, fallback: number, max: number) =>
  typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? Math.min(raw, max) : fallback;

/** The flags of a `studio_capabilities` message; anything missing or malformed is off. */
export function readDesktopCapabilities(message: Record<string, unknown>): DesktopCapabilities {
  const tools = Array.isArray(message.worldTools)
    ? WORLD_TOOLS.filter((t) => (message.worldTools as unknown[]).includes(t))
    : [];
  const world = message.interactiveWorld === 1 ? { tools: tools.length ? [...new Set([...tools, ...BASIC_TOOLS])].sort((a, b) => WORLD_TOOLS.indexOf(a) - WORLD_TOOLS.indexOf(b)) : BASIC_TOOLS } : null;
  const d = message.depthCapture as Record<string, unknown> | undefined;
  const L = DEPTH_CAPTURE_LIMITS;
  const depthCapture: DepthCaptureLimits | null =
    d && typeof d === 'object' && d.version === 1
      ? {
          version: 1,
          maxSurfaces: count(d.maxSurfaces, L.maxSurfaces, L.maxSurfaces),
          maxSamplesPerSurface: count(d.maxSamplesPerSurface, L.maxSamplesPerSurface, L.maxSamplesPerSurface),
          maxSamplesTotal: count(d.maxSamplesTotal, L.maxSamplesTotal, L.maxSamplesTotal),
          maxOutline: Math.max(3, count(d.maxOutline, L.maxOutline, L.maxOutline)),
          maxBytes: count(d.maxBytes, L.maxBytes, L.maxBytes),
        }
      : null;
  const o = message.output as { width?: unknown; height?: unknown } | undefined;
  const output =
    o && typeof o === 'object' && count(o.width, 0, 32768) && count(o.height, 0, 32768)
      ? { width: o.width as number, height: o.height as number }
      : null;
  return { nativeInteractive: message.nativeInteractive === true, world, depthCapture, output };
}

/** Width ÷ height of the desktop output, or the editor's own default. */
export function outputAspect(capabilities: Pick<DesktopCapabilities, 'output'> | null, fallback = 16 / 9): number {
  const o = capabilities?.output;
  return o ? Math.max(0.2, Math.min(5, o.width / o.height)) : fallback;
}

/** The version this build reports when the native app does not say. */
export const PHONE_APP_VERSION = '1.2';
/** What the desktop's phone list calls this device (iOS gives apps no personal device name). */
export function deviceName(ua = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  return /iPad/.test(ua) || (/Macintosh/.test(ua) && typeof navigator !== 'undefined' && navigator.maxTouchPoints > 1) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android phone' : 'Phone';
}
let client = { app: 'ios', version: PHONE_APP_VERSION, build: '', name: deviceName() };
void appInfo(PHONE_APP_VERSION).then((i) => (client = { ...client, version: i.version, build: i.build }), () => {});

/** The request, with which app is asking: the desktop lists phones that say (Depth setup → Start on phone). */
export function capabilitiesRequest(): { type: 'studio_capabilities_request'; client: { app: string; version: string; build: string; name: string } } {
  return { type: 'studio_capabilities_request', client: { ...client } };
}

// ── One id for this phone on every Studio message ──────────────────────────
// The pairing server tells phones apart by address plus `clientId`; scenes, the capabilities
// request, scan offers, progress and world messages must all carry the same one.
const CLIENT_KEY = 'ghost-studio-client-id';
let clientId = '';
/** This install's id for the desktop (kept on the device; letters, digits and dashes). */
export function studioClientId(storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): string {
  if (clientId) return clientId;
  try { clientId = storage?.getItem(CLIENT_KEY) ?? ''; } catch { clientId = ''; }
  if (!/^[\w-]{1,40}$/.test(clientId)) {
    clientId = `ios-${Math.random().toString(36).slice(2, 12)}`;
    try { storage?.setItem(CLIENT_KEY, clientId); } catch { /* private storage: one id for this run */ }
  }
  return clientId;
}
/** A Studio message (`studio_…`) with this phone's id added; anything else unchanged. */
export function withClientId(data: string, id = studioClientId()): string {
  // Added as text, not by parsing: a room scan is several hundred kilobytes.
  if (!data.startsWith('{"type":"studio_') || data.includes('"clientId":')) return data;
  return `{"clientId":${JSON.stringify(id)},${data.slice(1)}`;
}
/** Every Studio message this socket sends carries the phone's id, whichever tool sends it. */
export function stampStudioMessages(socket: WebSocket): void {
  const send = socket.send.bind(socket);
  socket.send = (data: Parameters<WebSocket['send']>[0]) => send(typeof data === 'string' ? withClientId(data) : data);
}
