/**
 * A room scan offered by a paired phone for Depth mode
 * (`studio_depth_capture_offer`), and the desktop's answers
 * (`studio_depth_capture_status`).
 *
 *   phone   -> studio_depth_capture_offer { requestId, capture }
 *   desktop -> studio_depth_capture_status { requestId, state: 'received' }
 *   (the operator answers the prompt)
 *   desktop -> studio_depth_capture_status { requestId, state: 'applied' | 'declined' | 'error', message? }
 *
 * Each phone has one offer at a time, in one explicit state:
 * idle -> offered -> applying -> applied | declined | error. A newer offer
 * from the same phone replaces one still waiting; an open project changing
 * ends every offer. Only waiting and applying offers are kept, for at most
 * MAX_WAITING_PHONES phones, so memory stays bounded.
 */
import { validateDepthCapture, type DepthCapture } from '../../scene3d/roomPhone';
import { DEPTH_CAPTURE_CAPABILITY } from './phoneWorld';

export type DepthCaptureSource = { device: string; screen?: { id: string; width: number; height: number }; capturedAt?: string };
export type DepthCaptureOffer = {
  requestId: string;
  capture: DepthCapture;
  source: DepthCaptureSource;
  surfaces: number;
  samples: number;
};
export type DepthCaptureState = 'received' | 'applied' | 'declined' | 'error';
export type DepthCaptureStatus = { type: 'studio_depth_capture_status'; requestId: string; state: DepthCaptureState; message?: string };

/** Phones with a scan waiting or applying at once. */
export const MAX_WAITING_PHONES = 3;
export const DEPTH_REQUEST_ID = /^[\w.:-]{1,128}$/;

// ── The message ───────────────────────────────────────────────────────────

const LIMIT = DEPTH_CAPTURE_CAPABILITY;
/** Meters from the phone a measured point may be. */
const MAX_DISTANCE = 100;
const refuse = (what: string): never => {
  throw new Error(`The room scan ${what}.`);
};
const num = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isPoint = (p: unknown) => !!p && typeof p === 'object' && num((p as { x?: unknown }).x, -1, 2) && num((p as { y?: unknown }).y, -1, 2);
const isVec = (v: unknown, max: number) => Array.isArray(v) && v.length === 3 && v.every((x) => num(x, -max, max));
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '');

/**
 * Check an offer field by field against the limits the desktop advertised.
 * Nothing is truncated: a phone that sends more than it was told is refused
 * with the reason, which goes back to it. `bytes` is the message's JSON size.
 */
export function parseDepthCaptureOffer(msg: Record<string, unknown>, bytes: number): DepthCaptureOffer {
  const requestId = msg.requestId;
  if (typeof requestId !== 'string' || !DEPTH_REQUEST_ID.test(requestId)) refuse('has no usable request id');
  if (!(bytes <= LIMIT.maxBytes)) refuse(`is larger than ${LIMIT.maxBytes / 1_000_000} MB`);
  const c = msg.capture as Record<string, unknown> | null | undefined;
  if (!c || typeof c !== 'object') refuse('is missing');
  if (c!.version !== LIMIT.version) refuse(`is version ${String(c!.version)}; this desktop reads version ${LIMIT.version}. Update the apps`);
  if (!isVec(c!.down, 2) || Math.hypot(...(c!.down as number[])) < 0.5) refuse('has no direction for down');
  const surfaces = c!.surfaces;
  if (!Array.isArray(surfaces) || !surfaces.length) refuse('has no surfaces');
  if ((surfaces as unknown[]).length > LIMIT.maxSurfaces) refuse(`has more than ${LIMIT.maxSurfaces} surfaces`);
  let samples = 0;
  const ids = new Set<string>();
  (surfaces as unknown[]).forEach((raw, i) => {
    const s = raw as { id?: unknown; name?: unknown; outline?: unknown; samples?: unknown } | null;
    const which = `surface ${i + 1}`;
    if (!s || typeof s !== 'object') refuse(`${which} is not a surface`);
    if (typeof s!.id !== 'string' || !s!.id || s!.id.length > 100) refuse(`${which} has no usable id`);
    if (ids.has(s!.id as string)) refuse(`${which} repeats the id of another surface`);
    ids.add(s!.id as string);
    if (s!.name !== undefined && typeof s!.name !== 'string') refuse(`${which} has a name that is not text`);
    const outline = s!.outline;
    if (!Array.isArray(outline) || outline.length < 3) refuse(`${which} has an outline of fewer than three points`);
    if ((outline as unknown[]).length > LIMIT.maxOutline) refuse(`${which} has an outline of more than ${LIMIT.maxOutline} points`);
    if (!(outline as unknown[]).every(isPoint)) refuse(`${which} has an outline point off the output`);
    const list = s!.samples;
    if (!Array.isArray(list)) refuse(`${which} has no samples`);
    if ((list as unknown[]).length > LIMIT.maxSamplesPerSurface) refuse(`${which} has more than ${LIMIT.maxSamplesPerSurface} samples`);
    for (const q of list as unknown[]) {
      const sample = q as { p?: unknown; uv?: unknown } | null;
      if (!sample || !isVec(sample.p, MAX_DISTANCE) || !isPoint(sample.uv)) refuse(`${which} has a sample that is not a point in meters with its place on the output`);
    }
    samples += (list as unknown[]).length;
  });
  if (samples > LIMIT.maxSamplesTotal) refuse(`has more than ${LIMIT.maxSamplesTotal} samples in all`);
  if (samples < 6) refuse('has fewer than six measured points');
  const s = (c!.source ?? {}) as Record<string, unknown>;
  const screen = s.screen as Record<string, unknown> | undefined;
  const source: DepthCaptureSource = {
    device: text(s.device, 60) || 'a phone',
    ...(screen && typeof screen === 'object' && typeof screen.id === 'string' && num(screen.width, 1, 32768) && num(screen.height, 1, 32768)
      ? { screen: { id: text(screen.id, 128), width: Math.round(screen.width as number), height: Math.round(screen.height as number) } }
      : {}),
    ...(text(s.capturedAt, 40) ? { capturedAt: text(s.capturedAt, 40) } : {}),
  };
  // The Screen's size and region go along: they decide the lens's shape over the output.
  const capture = validateDepthCapture({ down: c!.down, surfaces, source: { screen } });
  return { requestId: requestId as string, capture, source, surfaces: capture.surfaces.length, samples };
}

// ── One phone's offer ─────────────────────────────────────────────────────

export type DepthOfferState =
  | { kind: 'idle' }
  | { kind: 'offered'; offer: DepthCaptureOffer }
  | { kind: 'applying'; offer: DepthCaptureOffer; token: number }
  | { kind: 'applied' | 'declined' | 'error'; requestId: string; message?: string };

export type DepthOfferEvent =
  | { type: 'offer'; offer: DepthCaptureOffer }
  | { type: 'accept'; token: number }
  | { type: 'decline' }
  | { type: 'applied'; token: number; message?: string }
  | { type: 'failed'; token: number; message: string }
  | { type: 'cancel'; message: string };

const status = (requestId: string, state: DepthCaptureState, message?: string): DepthCaptureStatus => ({
  type: 'studio_depth_capture_status', requestId, state, ...(message ? { message } : {}),
});

/** The next state of one phone's offer, and what to tell the phone. Pure. */
export function stepDepthOffer(state: DepthOfferState, event: DepthOfferEvent): { state: DepthOfferState; replies: DepthCaptureStatus[] } {
  const same = { state, replies: [] as DepthCaptureStatus[] };
  switch (event.type) {
    case 'offer': {
      const id = event.offer.requestId;
      if (state.kind === 'applying') {
        return { state, replies: [status(id, 'error', 'The desktop is still applying the last scan from this phone. Send it again in a moment.')] };
      }
      if (state.kind === 'offered') {
        if (state.offer.requestId === id) return { state: { kind: 'offered', offer: event.offer }, replies: [status(id, 'received')] };
        return {
          state: { kind: 'offered', offer: event.offer },
          replies: [status(state.offer.requestId, 'declined', 'A newer scan from this phone replaced it.'), status(id, 'received')],
        };
      }
      return { state: { kind: 'offered', offer: event.offer }, replies: [status(id, 'received')] };
    }
    case 'accept':
      return state.kind === 'offered' ? { state: { kind: 'applying', offer: state.offer, token: event.token }, replies: [] } : same;
    case 'decline':
      if (state.kind !== 'offered') return same;
      return { state: { kind: 'declined', requestId: state.offer.requestId }, replies: [status(state.offer.requestId, 'declined', 'Not used on the desktop.')] };
    case 'applied':
      if (state.kind !== 'applying' || state.token !== event.token) return same;
      return { state: { kind: 'applied', requestId: state.offer.requestId, message: event.message }, replies: [status(state.offer.requestId, 'applied', event.message)] };
    case 'failed':
      if (state.kind !== 'applying' || state.token !== event.token) return same;
      return { state: { kind: 'error', requestId: state.offer.requestId, message: event.message }, replies: [status(state.offer.requestId, 'error', event.message)] };
    case 'cancel':
      if (state.kind !== 'offered' && state.kind !== 'applying') return same;
      return { state: { kind: 'error', requestId: state.offer.requestId, message: event.message }, replies: [status(state.offer.requestId, 'error', event.message)] };
  }
}

const live = (s: DepthOfferState): s is Extract<DepthOfferState, { kind: 'offered' | 'applying' }> => s.kind === 'offered' || s.kind === 'applying';

export type WaitingDepthOffer = { phone: string; offer: DepthCaptureOffer; applying: boolean };

/** Every phone's offer. Keeps only offers still waiting or applying. */
export class DepthCaptureOffers {
  private phones = new Map<string, DepthOfferState>();
  private token = 0;
  constructor(
    private send: (status: DepthCaptureStatus) => void,
    private changed: () => void = () => {},
  ) {}

  private step(phone: string, event: DepthOfferEvent): DepthOfferState {
    const before = this.phones.get(phone) ?? { kind: 'idle' };
    const { state, replies } = stepDepthOffer(before, event);
    if (live(state)) this.phones.set(phone, state);
    else this.phones.delete(phone);
    for (const reply of replies) this.send(reply);
    if (state !== before) this.changed();
    return state;
  }

  /** A checked offer from one phone. */
  offer(phone: string, offer: DepthCaptureOffer): void {
    if (!this.phones.has(phone) && this.phones.size >= MAX_WAITING_PHONES) {
      this.send(status(offer.requestId, 'error', 'The desktop already has room scans waiting. Answer those first, then send again.'));
      return;
    }
    this.step(phone, { type: 'offer', offer });
  }

  /** The operator said yes. Returns the token the apply must carry, or null when nothing is waiting. */
  accept(phone: string): { token: number; offer: DepthCaptureOffer } | null {
    const token = ++this.token;
    const state = this.step(phone, { type: 'accept', token });
    return state.kind === 'applying' && state.token === token ? { token, offer: state.offer } : null;
  }

  decline(phone: string): void {
    this.step(phone, { type: 'decline' });
  }

  /** True while this apply is still the phone's current one (not cancelled or replaced). */
  applying(phone: string, token: number): boolean {
    const state = this.phones.get(phone);
    return state?.kind === 'applying' && state.token === token;
  }

  finish(phone: string, token: number, result: { ok: true; message?: string } | { ok: false; message: string }): void {
    this.step(phone, result.ok ? { type: 'applied', token, message: result.message } : { type: 'failed', token, message: result.message });
  }

  /** End every offer (another project was opened). */
  cancelAll(message: string): void {
    for (const phone of [...this.phones.keys()]) this.step(phone, { type: 'cancel', message });
  }

  waiting(): WaitingDepthOffer[] {
    return [...this.phones].flatMap(([phone, s]) => (live(s) ? [{ phone, offer: s.offer, applying: s.kind === 'applying' }] : []));
  }
}
