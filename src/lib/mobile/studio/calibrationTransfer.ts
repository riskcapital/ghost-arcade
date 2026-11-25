/**
 * A calibration package from a phone to the desktop over the pairing socket.
 * The socket takes 10 MB a message, and a package with a painting's photo can
 * come close to that, so a large one travels in pieces and the desktop puts
 * it back together. A small one goes in one message, as an object (not JSON
 * text inside JSON, which escapes every quote again).
 */

/** Largest package either way: the desktop refuses anything bigger. */
export const CALIBRATION_MAX_CHARS = 20_000_000;
/** One piece of a large package, in characters of JSON text (the server allows 1 MiB). */
export const CALIBRATION_CHUNK_CHARS = 1_000_000;
/** Packages up to this size go in one message. */
const SINGLE_MESSAGE_CHARS = 4_000_000;

export type CalibrationMessage =
  | { type: 'studio_calibration_offer'; requestId: string; calibration: unknown }
  | { type: 'studio_calibration_chunk'; requestId: string; index: number; count: number; data: string };

/** The messages that carry `json` to the desktop. Throws a plain message when it is too large to send live. */
export function calibrationMessages(requestId: string, json: string): CalibrationMessage[] {
  if (json.length > CALIBRATION_MAX_CHARS) throw new Error('Package is too large for live transfer. Export it using Files / AirDrop.');
  if (json.length <= SINGLE_MESSAGE_CHARS) return [{ type: 'studio_calibration_offer', requestId, calibration: JSON.parse(json) }];
  const count = Math.ceil(json.length / CALIBRATION_CHUNK_CHARS);
  return Array.from({ length: count }, (_, index) => ({ type: 'studio_calibration_chunk' as const, requestId, index, count, data: json.slice(index * CALIBRATION_CHUNK_CHARS, (index + 1) * CALIBRATION_CHUNK_CHARS) }));
}

/** The package an offer carries, as JSON text: the object form, or the older text form. Null when it has neither. */
export function offeredCalibration(msg: Record<string, unknown>): string | null {
  if (typeof msg.json === 'string') return msg.json.length <= CALIBRATION_MAX_CHARS ? msg.json : null;
  if (msg.calibration && typeof msg.calibration === 'object') {
    const json = JSON.stringify(msg.calibration);
    return json.length <= CALIBRATION_MAX_CHARS ? json : null;
  }
  return null;
}

/**
 * Collects the pieces of large packages on the desktop. `receive` returns the
 * whole JSON text once the last piece of a package is in, else null; a package
 * that stops arriving is forgotten after `ttlMs`, and one that claims more than
 * the size limit is refused at once.
 */
export function calibrationAssembler(ttlMs = 60_000, now: () => number = Date.now) {
  const parts = new Map<string, { count: number; got: string[]; have: number; chars: number; at: number }>();
  return {
    receive(msg: Record<string, unknown>): string | null {
      for (const [id, entry] of parts) if (now() - entry.at > ttlMs) parts.delete(id);
      const { requestId, index, count, data } = msg;
      if (typeof requestId !== 'string' || typeof data !== 'string' || !Number.isInteger(count) || !Number.isInteger(index)) return null;
      const n = count as number, k = index as number;
      if (n < 1 || n > Math.ceil(CALIBRATION_MAX_CHARS / CALIBRATION_CHUNK_CHARS) || k < 0 || k >= n || data.length > CALIBRATION_CHUNK_CHARS) return null;
      let entry = parts.get(requestId);
      if (!entry || entry.count !== n) { entry = { count: n, got: [], have: 0, chars: 0, at: now() }; parts.set(requestId, entry); }
      entry.at = now();
      if (entry.got[k] === undefined) { entry.have++; entry.chars += data.length; }
      else entry.chars += data.length - entry.got[k].length;
      entry.got[k] = data;
      if (entry.chars > CALIBRATION_MAX_CHARS) { parts.delete(requestId); return null; }
      if (entry.have < entry.count) return null;
      parts.delete(requestId);
      return entry.got.join('');
    },
    /** Packages still being put together (for tests). */
    get pending() { return parts.size; },
  };
}
