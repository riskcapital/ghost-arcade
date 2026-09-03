import { readControlPath } from './oscFeedback';
import type { OscBinding } from './oscStore';

/**
 * Outbound OSC: mirror app state back to the control surface.
 *
 * Bindings are reused as the feedback list rather than configured separately.
 * A surface that sends /ghost/vj/a/layer/1/opacity is exactly the surface that
 * wants to hear about that value changing, so the mapping a user already made
 * is the mapping to answer on. It also means feedback needs no second UI.
 *
 * Only changes go out. A poll that re-sent every bound value would put a
 * hundred-odd messages per tick on the wire and fight the user's own fader
 * moves; sending on change keeps idle traffic at zero.
 */

/** How often to look for changes. 20Hz is smooth on a fader and cheap. */
export const OSC_OUTPUT_POLL_MS = 50;

/**
 * Values closer than this are treated as unchanged.
 *
 * Playhead position moves continuously, so an exact comparison would emit on
 * every single tick for any playing clip. This is finer than a surface can
 * display and far finer than a fader's own resolution.
 */
export const OSC_OUTPUT_EPSILON = 0.001;

export interface OscOutputTarget {
  host: string;
  port: number;
}

export interface OscOutputMessage {
  address: string;
  args: number[];
}

/**
 * Diff bindings against the last sent values and return what to send.
 *
 * `lastSent` is mutated: it is the caller's running record of what the surface
 * has been told. Split out from the transport so the change rule is testable
 * without a socket.
 */
export function collectOscFeedback(
  bindings: readonly OscBinding[],
  lastSent: Map<string, number>,
  epsilon = OSC_OUTPUT_EPSILON,
): OscOutputMessage[] {
  const messages: OscOutputMessage[] = [];
  const seen = new Set<string>();

  for (const binding of bindings) {
    const address = binding.address;
    // Two bindings can share an address; sending it twice per tick would be
    // noise, and the second value would be identical anyway.
    if (seen.has(address)) continue;

    const value = readControlPath(binding.path);
    if (value === null) continue;
    seen.add(address);

    const previous = lastSent.get(address);
    if (previous !== undefined && Math.abs(previous - value) <= epsilon) continue;

    lastSent.set(address, value);
    messages.push({ address, args: [value] });
  }

  // Forget addresses that stopped being readable (clip unloaded, layer
  // removed) so they re-send when they come back rather than being suppressed
  // by a stale value.
  for (const address of [...lastSent.keys()]) {
    if (!seen.has(address)) lastSent.delete(address);
  }

  return messages;
}
