/**
 * Interactive Studio → 3D World → Depth setup → Scan with the phone, started
 * from the desktop:
 *
 *   desktop -> studio_depth_scan_request { to, requestId, layerId, screenId?, output }
 *   phone   -> studio_depth_scan_progress { requestId, stage, pct?, message? }   (any number)
 *   phone   -> studio_depth_capture_offer { requestId, capture }                  (same requestId)
 *   desktop -> studio_depth_capture_status { requestId, state, message? }
 *
 * The scan is applied as soon as it arrives (no second question: the
 * operator asked for it), with Undo. One scan at a time, in one explicit
 * state. Pure: the caller sends what `tell` holds and runs `tick` once a
 * second while a scan is under way.
 */
import type { DepthCaptureStatus } from './depthCaptureOffer';

export type DepthScanStage = 'ready' | 'measuring' | 'patterns' | 'solving' | 'sending';
export const DEPTH_SCAN_STAGES = ['ready', 'measuring', 'patterns', 'solving', 'sending', 'cancelled', 'error'] as const;

/** Waiting this long for the phone to open the scan means it is not coming. */
export const DEPTH_SCAN_ANSWER_MS = 20_000;
/** A phone silent this long mid-scan is gone (it reports every stage and every few seconds). */
export const DEPTH_SCAN_SILENCE_MS = 90_000;

type Scan = { requestId: string; phone: string; target: string };
export type DepthScanFlow =
  | { kind: 'idle' }
  | ({ kind: 'asking'; at: number } & Scan)
  | ({ kind: 'scanning'; stage: DepthScanStage; pct?: number; message?: string; at: number } & Scan)
  | ({ kind: 'applying' } & Scan)
  | { kind: 'applied'; requestId: string; summary: string }
  | { kind: 'failed'; message: string };

export type DepthScanEvent =
  | { type: 'start'; requestId: string; phone: string; target: string; now: number }
  | { type: 'progress'; requestId: string; stage: string; pct?: number; message?: string; now: number }
  | { type: 'offer'; requestId: string }
  | { type: 'applied'; requestId: string; summary: string }
  | { type: 'failed'; requestId: string; message: string }
  | { type: 'cancel'; message?: string }
  | { type: 'tick'; now: number }
  | { type: 'dismiss' };

export type DepthScanStep = { flow: DepthScanFlow; tell?: DepthCaptureStatus };

const busy = (f: DepthScanFlow): f is Extract<DepthScanFlow, { kind: 'asking' | 'scanning' }> => f.kind === 'asking' || f.kind === 'scanning';
const told = (requestId: string, state: DepthCaptureStatus['state'], message: string): DepthCaptureStatus => ({ type: 'studio_depth_capture_status', requestId, state, message });
const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : undefined);

/** True when a capture offer answers the scan the desktop asked for (it is applied without a prompt). */
export const answersDepthScan = (flow: DepthScanFlow, requestId: unknown) => busy(flow) && flow.requestId === requestId;

export function stepDepthScan(flow: DepthScanFlow, event: DepthScanEvent): DepthScanStep {
  switch (event.type) {
    case 'start':
      // Only from rest: a second Start while one runs is ignored.
      if (busy(flow) || flow.kind === 'applying') return { flow };
      return { flow: { kind: 'asking', requestId: event.requestId, phone: event.phone, target: event.target, at: event.now } };
    case 'progress': {
      if (!busy(flow) || flow.requestId !== event.requestId) return { flow };
      if (event.stage === 'cancelled') return { flow: { kind: 'failed', message: 'The scan was cancelled on the phone.' } };
      if (event.stage === 'error') return { flow: { kind: 'failed', message: clean(event.message, 300) || 'The phone could not finish the scan.' } };
      if (!(DEPTH_SCAN_STAGES as readonly string[]).includes(event.stage)) return { flow };
      const pct = typeof event.pct === 'number' && Number.isFinite(event.pct) ? Math.max(0, Math.min(100, event.pct)) : undefined;
      return {
        flow: {
          kind: 'scanning', requestId: flow.requestId, phone: flow.phone, target: flow.target,
          stage: event.stage as DepthScanStage, at: event.now,
          ...(pct !== undefined ? { pct } : {}), ...(clean(event.message, 300) ? { message: clean(event.message, 300) } : {}),
        },
      };
    }
    case 'offer':
      if (!answersDepthScan(flow, event.requestId) || !busy(flow)) return { flow };
      return { flow: { kind: 'applying', requestId: flow.requestId, phone: flow.phone, target: flow.target } };
    case 'applied':
      if (flow.kind !== 'applying' || flow.requestId !== event.requestId) return { flow };
      return { flow: { kind: 'applied', requestId: flow.requestId, summary: event.summary } };
    case 'failed':
      if ((flow.kind !== 'applying' && !busy(flow)) || flow.requestId !== event.requestId) return { flow };
      return { flow: { kind: 'failed', message: event.message } };
    case 'cancel':
      if (!busy(flow)) return { flow: flow.kind === 'applying' ? flow : { kind: 'idle' } };
      return { flow: { kind: 'idle' }, tell: told(flow.requestId, 'declined', event.message ?? 'Cancelled on the desktop.') };
    case 'tick': {
      if (!busy(flow)) return { flow };
      const limit = flow.kind === 'asking' ? DEPTH_SCAN_ANSWER_MS : DEPTH_SCAN_SILENCE_MS;
      if (event.now - flow.at < limit) return { flow };
      const message = flow.kind === 'asking'
        ? 'The phone did not open the scan. Open Ghost Arcade on the phone, keep it paired, and update it if it has no depth scan.'
        : 'The phone stopped reporting during the scan.';
      return { flow: { kind: 'failed', message }, tell: told(flow.requestId, 'error', message) };
    }
    case 'dismiss':
      return flow.kind === 'applied' || flow.kind === 'failed' ? { flow: { kind: 'idle' } } : { flow };
  }
}

/** Plain words for where the scan is. */
export function depthScanLabel(flow: DepthScanFlow): string {
  switch (flow.kind) {
    case 'asking': return 'Waiting for the phone…';
    case 'scanning':
      return flow.message || {
        ready: 'Ready on the phone. Prop it up facing the objects and tap Start there.',
        measuring: 'Measuring depth…',
        patterns: 'Showing the stripes…',
        solving: 'Working out the surfaces…',
        sending: 'Sending the scan…',
      }[flow.stage];
    case 'applying': return 'Applying the scan…';
    case 'applied': return flow.summary;
    case 'failed': return flow.message;
    default: return '';
  }
}

/** Phones the desktop can ask for a scan: those that named their app (phone app 1.2 does not, and has no depth scan). */
export type ScanPhone = { id: string; label: string };
export function scanPhones(raw: unknown): ScanPhone[] {
  if (!Array.isArray(raw)) return [];
  const out: ScanPhone[] = [];
  for (const p of raw.slice(0, 8)) {
    if (!p || typeof p.id !== 'string' || !/^[\w.:-]{1,80}$/.test(p.id)) continue;
    const name = clean(p.name, 40)?.trim();
    const app = clean(p.app, 20)?.trim(), version = clean(p.version, 20)?.trim();
    out.push({ id: p.id, label: name || (app === 'ios' ? 'iPhone' : app || 'Phone') + (version ? ` · app ${version}` : '') });
  }
  return out;
}
