// Minimal OSC 1.0 parser — runs in Electron main process.
//
// We parse just enough of the OSC spec to route control messages
// from external apps (TouchOSC, Lemur, Vezér, etc.) into the
// existing modulation pipeline. Bundles are unpacked into their
// contained messages; per-element timestamps are honored only to
// the extent that they get forwarded with each message — we don't
// schedule deferred delivery (typical control surfaces send
// "immediate" anyway).
//
// Returned shape per message:
//   { address: '/foo/bar', args: [<value>, ...], tags: 'fi', timeTag: <bigint> | null }
//
// Common argument types we decode: f (float32), i (int32), s (string),
// b (blob → Buffer), d (float64), h (int64 → bigint), T (true), F (false),
// N (null), I (impulse). Anything else logs and skips that argument.

'use strict';

/** Pad to next 4-byte boundary (OSC requires all fields 4-byte aligned). */
function padded(n) { return (n + 3) & ~3; }

/** Read a null-terminated 4-byte-aligned string starting at offset.
 *  Returns { value, nextOffset }. */
function readString(buf, offset) {
  let end = offset;
  while (end < buf.length && buf[end] !== 0) end++;
  const value = buf.toString('utf8', offset, end);
  // Skip the null + alignment padding.
  const len = end - offset + 1;
  return { value, nextOffset: offset + padded(len) };
}

/** Read a length-prefixed blob (4-byte length + bytes + padding). */
function readBlob(buf, offset) {
  const len = buf.readInt32BE(offset);
  offset += 4;
  const value = buf.slice(offset, offset + len);
  return { value, nextOffset: offset + padded(len) };
}

/** Parse a single OSC message starting at `start` within `buf`.
 *  Returns { message, nextOffset } where message is null on parse
 *  failure (caller skips). */
function parseMessage(buf, start, end) {
  if (start >= end) return { message: null, nextOffset: end };
  // 1. Address pattern
  const addr = readString(buf, start);
  if (!addr.value.startsWith('/')) {
    return { message: null, nextOffset: end };
  }
  // 2. Type tag string — should start with ','. Some senders omit it
  //    on no-arg messages; tolerate that.
  let offset = addr.nextOffset;
  let tags = '';
  if (offset < end && buf[offset] === 0x2c /* ',' */) {
    const t = readString(buf, offset);
    tags = t.value.slice(1); // drop leading ','
    offset = t.nextOffset;
  }
  // 3. Arguments
  const args = [];
  for (let i = 0; i < tags.length; i++) {
    const tag = tags[i];
    if (tag === 'f') {
      if (offset + 4 > end) break;
      args.push(buf.readFloatBE(offset));
      offset += 4;
    } else if (tag === 'i') {
      if (offset + 4 > end) break;
      args.push(buf.readInt32BE(offset));
      offset += 4;
    } else if (tag === 's' || tag === 'S') {
      const s = readString(buf, offset);
      args.push(s.value);
      offset = s.nextOffset;
    } else if (tag === 'b') {
      const b = readBlob(buf, offset);
      args.push(b.value);
      offset = b.nextOffset;
    } else if (tag === 'd') {
      if (offset + 8 > end) break;
      args.push(buf.readDoubleBE(offset));
      offset += 8;
    } else if (tag === 'h') {
      if (offset + 8 > end) break;
      args.push(buf.readBigInt64BE(offset));
      offset += 8;
    } else if (tag === 'T') {
      args.push(true);
    } else if (tag === 'F') {
      args.push(false);
    } else if (tag === 'N') {
      args.push(null);
    } else if (tag === 'I') {
      args.push(Infinity);
    } else if (tag === '[' || tag === ']') {
      // Type-tag array brackets — flatten into a single array stream.
      // No-op for our purposes.
    } else {
      // Unknown tag — bail on remaining args to stay aligned.
      console.warn('[OSC] unknown type tag:', tag, 'in', addr.value);
      break;
    }
  }
  return {
    message: { address: addr.value, args, tags, timeTag: null },
    nextOffset: end,
  };
}

/** Parse an OSC bundle. Bundles start with '#bundle\0' + a 64-bit
 *  NTP time tag, followed by length-prefixed elements (each element
 *  is itself either a message or another bundle). */
function parseBundle(buf, start, end, timeTag, out) {
  let offset = start;
  while (offset + 4 <= end) {
    const elemLen = buf.readInt32BE(offset);
    offset += 4;
    if (offset + elemLen > end || elemLen <= 0) break;
    const elemEnd = offset + elemLen;
    // Bundle-within-bundle?
    if (elemLen >= 8 && buf.toString('utf8', offset, offset + 7) === '#bundle') {
      // Read inner timetag (8 bytes after #bundle\0).
      const innerTimeTag = buf.readBigUInt64BE(offset + 8);
      parseBundle(buf, offset + 16, elemEnd, innerTimeTag, out);
    } else {
      const r = parseMessage(buf, offset, elemEnd);
      if (r.message) {
        r.message.timeTag = timeTag;
        out.push(r.message);
      }
    }
    offset = elemEnd;
  }
}

/** Top-level parse — handles both single messages and bundles.
 *  Returns an array of message objects. */
function parseOSCPacket(buf) {
  const out = [];
  if (buf.length === 0) return out;
  // Bundle?
  if (buf.length >= 16 && buf.toString('utf8', 0, 7) === '#bundle') {
    const timeTag = buf.readBigUInt64BE(8);
    parseBundle(buf, 16, buf.length, timeTag, out);
  } else {
    const r = parseMessage(buf, 0, buf.length);
    if (r.message) out.push(r.message);
  }
  return out;
}

// ─── Encoding (outbound feedback) ───────────────────────────
//
// Controllers that only receive are fire-and-forget: a fader moved in the
// app never reaches the surface, so the two drift apart. Sending state back
// is what lets a TouchOSC or Lemur layout track the app — faders follow,
// clip buttons light when their clip is live.
//
// We emit float32 for everything numeric. Every surface worth supporting
// reads 'f', and mixing int/float per value would make a layout's parsing
// depend on whether a number happened to be whole.

/** Write a null-terminated, 4-byte-aligned OSC string. */
function writeString(value) {
  const raw = Buffer.from(String(value), 'utf8');
  const out = Buffer.alloc(padded(raw.length + 1));  // alloc zero-fills, so the
  raw.copy(out);                                     // terminator and padding are free
  return out;
}

/**
 * Encode one OSC message. `args` are numbers (sent as float32) or strings.
 * Returns a Buffer ready for dgram.send, or null if the address is unusable.
 */
function encodeOSCMessage(address, args = []) {
  if (typeof address !== 'string' || !address.startsWith('/')) return null;

  const list = Array.isArray(args) ? args : [args];
  let tags = ',';
  const chunks = [];
  for (const arg of list) {
    if (typeof arg === 'string') {
      tags += 's';
      chunks.push(writeString(arg));
    } else {
      const num = Number(arg);
      // A NaN on the wire is worse than a zero: surfaces tend to render it as
      // a jumped fader rather than ignore it.
      const buf = Buffer.alloc(4);
      buf.writeFloatBE(Number.isFinite(num) ? num : 0, 0);
      tags += 'f';
      chunks.push(buf);
    }
  }

  return Buffer.concat([writeString(address), writeString(tags), ...chunks]);
}

module.exports = { parseOSCPacket, encodeOSCMessage };
