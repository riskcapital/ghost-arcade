/**
 * Frame numbers for the auto-map stripe patterns, shared by the phone (which
 * asks for a frame) and the desktop core (which draws it). The WGSL in
 * heartbeat.wgsl (structured_light_pattern) decodes the same number.
 *
 * 0 = white, 1 = black, otherwise 2 + ((axis * 16 + bit) * 2 + inverted),
 * axis 0 = x, 1 = y, bit 0 = most significant; plus 100 for each doubling of
 * the stripe size above 8 projector pixels.
 */
export type StripeFrame =
  | { kind: 'white' } | { kind: 'black' }
  | { kind: 'bit'; axis: 'x' | 'y'; bit: number; inverted: boolean };

/** Projector pixels per code step. The core draws 8, 16, 32, 64 or 128.
 *  32 is the default: a phone across the room resolves it easily, and the
 *  fit uses thousands of points, so accuracy does not depend on fine stripes. */
export const STRIPE_CELLS = [8, 16, 32, 64, 128] as const;
export const STRIPE_CELL = 32;
/** Black on a Screen that is not being measured (any cell size). */
export const STRIPE_BLACK = 1;

export function stripeFrameCode(frame: StripeFrame, cell: number = STRIPE_CELL): number {
  const shift = STRIPE_CELLS.indexOf(cell as (typeof STRIPE_CELLS)[number]);
  if (shift < 0) throw new Error('Unsupported stripe size.');
  const base = frame.kind === 'white' ? 0 : frame.kind === 'black' ? 1
    : 2 + ((frame.axis === 'y' ? 16 : 0) + frame.bit) * 2 + (frame.inverted ? 1 : 0);
  return shift * 100 + base;
}
