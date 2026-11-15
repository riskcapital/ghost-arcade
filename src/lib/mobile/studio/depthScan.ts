/**
 * The room scan for Depth mode over the pairing socket.
 *
 *   desktop -> studio_depth_scan_request  { requestId, layerId, screenId?, output: { width, height } }
 *              (its Interactive Studio → World → Depth setup → Scan with the phone → Start on phone)
 *   phone   -> studio_depth_scan_progress { requestId, stage, pct?, message? }
 *              stage: ready | patterns | measuring | solving | sending | cancelled | error
 *   phone   -> studio_depth_capture_offer { requestId, capture }   (depthCapture.ts)
 *   desktop -> studio_depth_capture_status { requestId, state: received | applied | declined | error, message? }
 *
 * A scan the desktop asked for answers with the request's id, and the desktop
 * applies it without asking again. A scan started on the phone gets its own
 * id, and the desktop asks its user first.
 */
import type { DepthCapture } from './depthCapture';

export type DepthScanRequest = { requestId: string; layerId?: string; screenId?: string; output?: { width: number; height: number } };
export type DepthScanStage = 'ready' | 'patterns' | 'measuring' | 'solving' | 'sending' | 'cancelled' | 'error';
export type DepthCaptureState = 'received' | 'applied' | 'declined' | 'error';

const ID = /^[\w.:-]{1,100}$/;

/** A desktop's request, or null when it is not one this phone can act on. */
export function readDepthScanRequest(msg: Record<string, unknown>): DepthScanRequest | null {
  if (msg.type !== 'studio_depth_scan_request' || typeof msg.requestId !== 'string' || !ID.test(msg.requestId)) return null;
  const o = msg.output as { width?: unknown; height?: unknown } | undefined;
  const size = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 32768;
  return {
    requestId: msg.requestId,
    ...(typeof msg.layerId === 'string' && ID.test(msg.layerId) ? { layerId: msg.layerId } : {}),
    ...(typeof msg.screenId === 'string' && ID.test(msg.screenId) ? { screenId: msg.screenId } : {}),
    ...(o && size(o.width) && size(o.height) ? { output: { width: o.width as number, height: o.height as number } } : {}),
  };
}

export const depthScanProgress = (requestId: string, stage: DepthScanStage, pct?: number, message?: string) => ({
  type: 'studio_depth_scan_progress' as const,
  requestId,
  stage,
  ...(pct !== undefined && Number.isFinite(pct) ? { pct: Math.round(Math.max(0, Math.min(1, pct)) * 100) } : {}),
  ...(message ? { message: message.slice(0, 300) } : {}),
});

export const depthCaptureOffer = (requestId: string, capture: DepthCapture) => ({ type: 'studio_depth_capture_offer' as const, requestId, capture });

/** The desktop's answer to an offer, if this message is one. */
export function readDepthCaptureStatus(msg: Record<string, unknown>, requestId: string): { state: DepthCaptureState; message?: string } | null {
  if (msg.type !== 'studio_depth_capture_status' || msg.requestId !== requestId) return null;
  const state = msg.state;
  if (state !== 'received' && state !== 'applied' && state !== 'declined' && state !== 'error') return null;
  return { state, ...(typeof msg.message === 'string' && msg.message ? { message: msg.message.slice(0, 300) } : {}) };
}

/** What the phone says about the desktop's answer. */
export function depthStatusText(state: DepthCaptureState, message?: string): string {
  switch (state) {
    case 'received': return 'The desktop has the scan. Confirm it there: Use it for Depth mode.';
    case 'applied': return 'Depth mode is set up on the desktop. Throw, pour or ignite to try it.';
    case 'declined': return 'The desktop did not use the scan.';
    default: return message || 'The desktop could not use the scan. Save the file and open it there.';
  }
}

/** Which stage an auto-map progress line belongs to. */
export function stageOf(text: string): DepthScanStage {
  return /depth/i.test(text) ? 'measuring' : /surface|curved/i.test(text) ? 'solving' : 'patterns';
}
