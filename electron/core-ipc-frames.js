// Binary payload frames on the render core's stdin/stdout pipes.
//
// Every RPC is still one JSON object per line. A message that carries large
// float arrays or pixels is preceded by a header line naming raw payloads,
// and its JSON refers to them by index where a base64 string would be:
//
//   #B 38000\n<38000 bytes>{"id":7,...,"initial_b64":{"$blob":0},...}\n
//
// So frame data crosses the pipe as bytes rather than as JSON numbers, and
// the main thread no longer stringifies or parses it. The core accepts these
// frames once it has said so (a `{"id":0,"ipc_frames":1}` hello, sent when
// the broker sets GA_CORE_IPC_FRAMES=1), and frames its own large replies
// the same way. GA_CORE_IPC=json keeps the plain JSON lines throughout.
//
// Snapshot pixels can also come back as raw bytes: the broker sets
// GA_CORE_IPC_BYTES=1 too, a request asks with `pixel_bytes: true`, and the
// reply names the payload `{"$bytes": n}` under `rgba_raw` / `jpeg_raw`. The
// reader turns it into a Uint8Array of exactly those bytes, which IPC hands
// to the renderer without any base64 step. GA_CORE_IPC_BYTES=0 turns it off.
// See native-renderer/src/ipc_frames.rs for the core's half.

import os from 'os';

const FRAME_HEADER = '#B ';
const NEWLINE = 0x0a;

/** False when GA_CORE_IPC=json asks for plain JSON lines only. */
export function coreIpcFramesWanted(env = process.env) {
  if (os.endianness() !== 'LE') return false;
  return String(env?.GA_CORE_IPC ?? '').trim().toLowerCase() !== 'json';
}

/** False when raw snapshot bytes are off (GA_CORE_IPC_BYTES=0, or no frames). */
export function coreIpcBytesWanted(env = process.env) {
  if (!coreIpcFramesWanted(env)) return false;
  return String(env?.GA_CORE_IPC_BYTES ?? '').trim() !== '0';
}

/** The hello a framing core sends before anything else. */
export function isCoreIpcFramesHello(message) {
  return !!message && message.id === 0 && message.ipc_frames === 1;
}

function isBinary(value) {
  return ArrayBuffer.isView(value) || value instanceof ArrayBuffer;
}

function bytesOf(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}

// Fields the core reads a buffer's data from, in the order it tries them
// (compute_graph.rs compute_initial_bytes). A typed array may only become
// `initial_b64` when no field the core would read first is present.
const AHEAD_OF_B64 = ['initial_file', 'data_file', 'bytes_file'];
const AHEAD_OF_U32 = [...AHEAD_OF_B64, 'initial_b64', 'data_b64', 'bytes_b64'];
const AHEAD_OF_I32 = [...AHEAD_OF_U32, 'initial_u32', 'u32'];
const AHEAD_OF_F32 = [...AHEAD_OF_I32, 'initial_i32', 'i32'];

function hasAny(object, keys) {
  return keys.some((key) => object[key] !== undefined && object[key] !== null);
}

/**
 * Float data as the core stores it when it reads the same values as JSON:
 * NaN and infinities (which JSON sends as null) become 0, -0 becomes 0, and
 * values are held to +/-1e20 before rounding to f32.
 */
function coreFloat32Bytes(values) {
  const out = new Float32Array(values.length);
  for (let index = 0; index < values.length; index++) {
    const value = Number(values[index]);
    out[index] = Number.isFinite(value) && value !== 0 ? Math.max(-1e20, Math.min(1e20, value)) : 0;
  }
  return Buffer.from(out.buffer);
}

/**
 * How a typed array at `object[key]` goes to the core: returns the field to
 * write and its value, with `blob(bytes)` standing for a binary payload. With
 * no `blob` (JSON transport) it returns what the renderer used to send: a
 * number array, or a base64 string for a `*_b64` field. Null leaves it as is.
 */
function typedFieldForCore(object, key, value, blob) {
  if (key === 'initial_f32') {
    if (blob && !hasAny(object, AHEAD_OF_F32)) return { key: 'initial_b64', value: blob(coreFloat32Bytes(value)) };
    return { key, value: Array.from(value) };
  }
  if (key === 'initial_u32' && value instanceof Uint32Array) {
    if (blob && !hasAny(object, AHEAD_OF_U32)) return { key: 'initial_b64', value: blob(bytesOf(value)) };
    return { key, value: Array.from(value) };
  }
  if (key === 'initial_i32' && value instanceof Int32Array) {
    if (blob && !hasAny(object, AHEAD_OF_I32)) return { key: 'initial_b64', value: blob(bytesOf(value)) };
    return { key, value: Array.from(value) };
  }
  if (key.endsWith('_b64')) {
    const bytes = bytesOf(value);
    return { key, value: blob ? blob(bytes) : bytes.toString('base64') };
  }
  return null;
}

/** Copy-on-write walk that rewrites typed-array fields (see above). */
function prepareForCore(value, blob, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 32 || isBinary(value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'number') return value;
    let out = null;
    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      const next = prepareForCore(item, blob, depth + 1);
      if (next !== item) (out ??= value.slice())[index] = next;
    }
    return out ?? value;
  }
  let out = null;
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item && typeof item === 'object' && isBinary(item)) {
      const field = typedFieldForCore(value, key, item, blob);
      if (!field) continue;
      out ??= { ...value };
      if (field.key !== key) delete out[key];
      out[field.key] = field.value;
      continue;
    }
    const next = prepareForCore(item, blob, depth + 1);
    if (next !== item) (out ??= { ...value })[key] = next;
  }
  return out ?? value;
}

/**
 * One request as written to the core's stdin. With `frames` the typed arrays
 * travel as binary payloads (a Buffer is returned only when there are any);
 * without, the line is what JSON alone would carry.
 */
export function encodeCoreRequest(message, { frames = false } = {}) {
  const blobs = [];
  const blob = frames ? (bytes) => ({ $blob: blobs.push(bytes) - 1 }) : null;
  const params = prepareForCore(message.params ?? {}, blob);
  const line = `${JSON.stringify({ id: message.id, method: message.method, params })}\n`;
  if (!blobs.length) return { payload: line, bytes: Buffer.byteLength(line) };
  const header = Buffer.from(`${FRAME_HEADER}${blobs.map((b) => b.length).join(' ')}\n`, 'latin1');
  const payload = Buffer.concat([header, ...blobs, Buffer.from(line, 'utf8')]);
  return { payload, bytes: payload.length };
}

/** Puts payload text back where the core lifted it out of a reply. */
function spliceBlobs(value, blobs, depth = 0) {
  if (!value || typeof value !== 'object' || depth > 64) return value;
  const keys = Object.keys(value);
  if (!Array.isArray(value) && keys.length === 1 && keys[0] === '$blob') {
    const blob = blobs[value.$blob];
    if (!blob) throw new Error('core reply names a payload it did not carry');
    // The core lifts only base64 text, so this is the original string.
    return blob.toString('latin1');
  }
  if (!Array.isArray(value) && keys.length === 1 && keys[0] === '$bytes') {
    const blob = blobs[value.$bytes];
    if (!blob) throw new Error('core reply names a payload it did not carry');
    return ownedBytes(blob);
  }
  for (const key of keys) {
    const item = value[key];
    if (item && typeof item === 'object') value[key] = spliceBlobs(item, blobs, depth + 1);
  }
  return value;
}

/**
 * Raw payload bytes as a Uint8Array over a buffer of their own. A payload is
 * often a view into a larger pipe chunk, and IPC would copy the whole of it.
 */
function ownedBytes(blob) {
  if (blob.byteOffset === 0 && blob.buffer.byteLength === blob.length) {
    return new Uint8Array(blob.buffer, 0, blob.length);
  }
  const out = new Uint8Array(blob.length);
  out.set(blob);
  return out;
}

/**
 * Reads the core's stdout: JSON lines, some preceded by a payload frame.
 * `onLine(text, blobs)` gets each JSON line (trimmed) and the payloads that
 * came with it; `decode(text, blobs)` turns that into the message.
 */
export function createCoreOutputReader(onLine) {
  let chunks = [];
  let length = 0;
  // Bytes at the front already searched for a newline.
  let scanned = 0;
  let need = null;
  let blobs = null;

  const take = (count) => {
    let out;
    if (chunks[0].length >= count) {
      out = chunks[0].subarray(0, count);
      if (chunks[0].length === count) chunks.shift();
      else chunks[0] = chunks[0].subarray(count);
    } else {
      const parts = [];
      let left = count;
      while (left > 0) {
        const head = chunks[0];
        if (head.length <= left) { parts.push(head); chunks.shift(); left -= head.length; }
        else { parts.push(head.subarray(0, left)); chunks[0] = head.subarray(left); left = 0; }
      }
      out = Buffer.concat(parts, count);
    }
    length -= count;
    scanned = 0;
    return out;
  };

  const findNewline = () => {
    let offset = 0;
    for (const chunk of chunks) {
      if (offset + chunk.length > scanned) {
        const from = Math.max(0, scanned - offset);
        const at = chunk.indexOf(NEWLINE, from);
        if (at >= 0) return offset + at;
      }
      offset += chunk.length;
    }
    scanned = length;
    return -1;
  };

  const drain = () => {
    for (;;) {
      if (need) {
        while (need.index < need.lengths.length) {
          const size = need.lengths[need.index];
          if (length < size) return;
          need.blobs.push(size ? take(size) : Buffer.alloc(0));
          need.index += 1;
        }
        blobs = need.blobs;
        need = null;
      }
      if (!length) return;
      const at = findNewline();
      if (at < 0) return;
      const line = take(at + 1).subarray(0, at);
      if (line.length >= FRAME_HEADER.length && line.toString('latin1', 0, FRAME_HEADER.length) === FRAME_HEADER) {
        const lengths = line.toString('latin1', FRAME_HEADER.length).trim().split(/\s+/).map(Number);
        if (!lengths.length || lengths.some((n) => !Number.isSafeInteger(n) || n < 0)) {
          // Not a frame this reader can follow; show it like any stray line.
          onLine(line.toString('utf8').trim(), null);
          continue;
        }
        need = { lengths, index: 0, blobs: [] };
        continue;
      }
      const carried = blobs;
      blobs = null;
      onLine(line.toString('utf8').trim(), carried);
    }
  };

  return {
    push(chunk) {
      const buffer = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
      if (!buffer?.length) return;
      chunks.push(buffer);
      length += buffer.length;
      drain();
    },
    reset() {
      chunks = [];
      length = 0;
      scanned = 0;
      need = null;
      blobs = null;
    },
  };
}

/** Parses a core reply line, restoring any payloads the core framed. */
export function decodeCoreLine(text, blobs) {
  const message = JSON.parse(text);
  return blobs?.length ? spliceBlobs(message, blobs) : message;
}
