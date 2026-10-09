/**
 * Frame numbers for the auto-map stripe patterns, shared by the phone (which
 * asks for a frame) and the desktop core (which draws it). The WGSL in
 * heartbeat.wgsl (structured_light_pattern) decodes the same number.
 *
 * 0 = white, 1 = black, otherwise 2 + ((axis * 16 + bit) * 2 + inverted),
 * axis 0 = x, 1 = y, bit 0 = most significant.
 */
export type StripeFrame =
  | { kind: 'white' } | { kind: 'black' }
  | { kind: 'bit'; axis: 'x' | 'y'; bit: number; inverted: boolean };

/** Projector pixels per code step. Fixed: the core's shader assumes it. */
export const STRIPE_CELL = 8;
export const STRIPE_BLACK = 1;

export function stripeFrameCode(frame: StripeFrame): number {
  if (frame.kind === 'white') return 0;
  if (frame.kind === 'black') return 1;
  return 2 + ((frame.axis === 'y' ? 16 : 0) + frame.bit) * 2 + (frame.inverted ? 1 : 0);
}
