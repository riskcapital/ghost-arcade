/**
 * Base64 of a byte buffer, for buffers sent to the render core every frame.
 *
 * The usual `btoa(String.fromCharCode(...bytes))` builds a binary string
 * from tens of thousands of call arguments first, which costs about 20 µs
 * per KB. Encoding three bytes at a time from a table into one string of
 * code units is about ten times faster and gives the same text.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CODES = Array.from(ALPHABET, (c) => c.charCodeAt(0));
const PAD = 61; // '='
// Two output characters for each 12-bit value.
const PAIRS = new Uint16Array(4096);
for (let i = 0; i < 4096; i++) PAIRS[i] = (CODES[i >> 6] << 8) | CODES[i & 63];

let scratch = new Uint8Array(0);

export function bytesToBase64(bytes: Uint8Array): string {
  const n = bytes.length;
  const outLength = Math.ceil(n / 3) * 4;
  if (scratch.length < outLength) scratch = new Uint8Array(outLength);
  const out = scratch;
  let o = 0;
  let i = 0;
  for (const end = n - (n % 3); i < end; i += 3) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    const hi = PAIRS[v >> 12], lo = PAIRS[v & 4095];
    out[o++] = hi >> 8; out[o++] = hi & 255; out[o++] = lo >> 8; out[o++] = lo & 255;
  }
  if (n - i === 1) {
    const v = bytes[i] << 16;
    out[o++] = CODES[v >> 18]; out[o++] = CODES[(v >> 12) & 63]; out[o++] = PAD; out[o++] = PAD;
  } else if (n - i === 2) {
    const v = (bytes[i] << 16) | (bytes[i + 1] << 8);
    out[o++] = CODES[v >> 18]; out[o++] = CODES[(v >> 12) & 63]; out[o++] = CODES[(v >> 6) & 63]; out[o++] = PAD;
  }
  // Decode the ASCII in chunks: one call per 8K characters, not one per byte.
  let text = '';
  for (let at = 0; at < o; at += 8192) {
    text += String.fromCharCode.apply(null, out.subarray(at, Math.min(o, at + 8192)) as unknown as number[]);
  }
  return text;
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  return bytesToBase64(new Uint8Array(buffer));
}
