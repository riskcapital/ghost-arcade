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
let client = { app: 'ios', version: PHONE_APP_VERSION, build: '' };
void appInfo(PHONE_APP_VERSION).then((i) => (client = { app: 'ios', version: i.version, build: i.build }), () => {});

/** The request, with which app is asking (the desktop logs it). */
export function capabilitiesRequest(): { type: 'studio_capabilities_request'; client: { app: string; version: string; build: string } } {
  return { type: 'studio_capabilities_request', client: { ...client } };
}
