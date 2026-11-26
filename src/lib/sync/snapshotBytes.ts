/**
 * Pixel bytes of a core frame snapshot, however they travelled.
 *
 * A request that passes `pixel_bytes: true` gets them as raw bytes
 * (`rgba_raw`, `jpeg_raw`: a Uint8Array) when the broker and core can send
 * them that way; otherwise, and from older cores, they come as base64
 * (`rgba_b64`, `jpeg_b64`). Either way the caller gets the same bytes.
 */
export interface SnapshotPayload {
  rgba_raw?: Uint8Array | ArrayBuffer | null;
  rgba_b64?: string;
  jpeg_raw?: Uint8Array | ArrayBuffer | null;
  jpeg_b64?: string;
}

/** Asks the core for raw pixel bytes; spread into a snapshot request. */
export const PIXEL_BYTES = { pixel_bytes: true } as const;

export function base64Bytes(b64: string): Uint8Array {
  // Uint8Array.fromBase64 does the whole thing in native code; the loop
  // stays as the fallback for runtimes without it.
  const fromBase64 = (Uint8Array as unknown as { fromBase64?: (s: string) => Uint8Array }).fromBase64;
  if (typeof fromBase64 === 'function') return fromBase64(b64);
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function rawBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

/** The snapshot's `rgba` pixels or `jpeg` file bytes, or null without any. */
export function snapshotBytes(snap: SnapshotPayload | null | undefined, kind: 'rgba' | 'jpeg'): Uint8Array | null {
  if (!snap) return null;
  const raw = rawBytes(kind === 'rgba' ? snap.rgba_raw : snap.jpeg_raw);
  if (raw) return raw;
  const b64 = kind === 'rgba' ? snap.rgba_b64 : snap.jpeg_b64;
  return b64 ? base64Bytes(b64) : null;
}

/** True when the snapshot carries `kind` bytes in either form. */
export function snapshotHas(snap: SnapshotPayload | null | undefined, kind: 'rgba' | 'jpeg'): boolean {
  if (!snap) return false;
  const raw = kind === 'rgba' ? snap.rgba_raw : snap.jpeg_raw;
  if (raw && (raw as ArrayBufferLike).byteLength > 0) return true;
  return !!(kind === 'rgba' ? snap.rgba_b64 : snap.jpeg_b64);
}
