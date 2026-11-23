'use strict';
// WAV files written as they are recorded (Audio Lab's Record A/V and its
// stems), so a long take never sits in the renderer's memory.
//
// The renderer names a stream only by an id issued here. The folder is fixed
// when the store is created and the file name is rebuilt here, so nothing it
// sends can write outside that folder. Each write is 16-bit stereo PCM,
// interleaved; finish writes the header for the bytes actually on disk.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_OPEN = 64;
const MAX_WRITE = 32 * 1024 * 1024;
// 80 bytes: RIFF, a 28-byte JUNK chunk held for an RF64 ds64 chunk, fmt, data.
// A take that ends up over 4 GB (the 32-bit RIFF sizes' limit, about 6 h of
// 48 kHz stereo) is finished as RF64 (EBU Tech 3306) by turning that JUNK into
// ds64 with the 64-bit sizes; anything smaller stays a plain WAV, and the JUNK
// chunk is skipped by every reader.
const HEADER = 80;
const RIFF_LIMIT = 0xffffffff - (HEADER - 8);

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

function safeName(raw) {
  const base = String(raw ?? '').split(/[\\/]/).pop().replace(/\.wav$/i, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, '_').slice(0, 80) || 'Recording';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${base}_${stamp}_${crypto.randomBytes(3).toString('hex')}.wav`;
}

function wavHeader(dataBytes, sampleRate) {
  const h = Buffer.alloc(HEADER);
  const big = dataBytes > RIFF_LIMIT;
  h.write(big ? 'RF64' : 'RIFF', 0, 'ascii');
  h.writeUInt32LE(big ? 0xffffffff : HEADER - 8 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write(big ? 'ds64' : 'JUNK', 12, 'ascii');
  h.writeUInt32LE(28, 16);
  if (big) {
    h.writeBigUInt64LE(BigInt(HEADER - 8 + dataBytes), 20);
    h.writeBigUInt64LE(BigInt(dataBytes), 28);
    h.writeBigUInt64LE(BigInt(Math.floor(dataBytes / 4)), 36);
    h.writeUInt32LE(0, 44);
  }
  h.write('fmt ', 48, 'ascii');
  h.writeUInt32LE(16, 52);
  h.writeUInt16LE(1, 56);
  h.writeUInt16LE(2, 58);
  h.writeUInt32LE(sampleRate, 60);
  h.writeUInt32LE(sampleRate * 4, 64);
  h.writeUInt16LE(4, 68);
  h.writeUInt16LE(16, 70);
  h.write('data', 72, 'ascii');
  h.writeUInt32LE(big ? 0xffffffff : dataBytes, 76);
  return h;
}

// File work is async (fs.promises), so a long take never stalls the main
// process. Each block's place in the file is fixed before it is written, so
// blocks land in order even if their writes overlap.
function createWavStreamStore(directory) {
  const dir = path.resolve(directory);
  /** id -> { handle, file, bytes, pending } */
  const open = new Map();
  const get = (id) => {
    const s = open.get(String(id ?? ''));
    if (!s) throw new Error('No such recording stream');
    return s;
  };
  const close = async (s) => { try { await s.handle.close(); } catch { /* closed */ } };

  return {
    async begin(args) {
      if (open.size >= MAX_OPEN) throw new Error('Too many recordings open');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, safeName(args?.filename));
      const handle = await fs.promises.open(file, 'w');
      try {
        await handle.write(wavHeader(0, 48000), 0, HEADER, 0);
      } catch (err) {
        await close({ handle });
        try { await fs.promises.unlink(file); } catch { /* gone */ }
        throw err;
      }
      const id = crypto.randomUUID();
      open.set(id, { handle, file, bytes: 0, pending: Promise.resolve() });
      return { id, path: file };
    },
    async write(args) {
      const s = get(args?.id);
      const buf = toBuffer(args?.bytes);
      if (!buf || buf.length % 4 !== 0 || buf.length > MAX_WRITE) throw new Error('Invalid PCM block');
      const at = HEADER + s.bytes;
      s.bytes += buf.length;
      const done = s.handle.write(buf, 0, buf.length, at);
      s.pending = s.pending.then(() => done, () => done);
      await done;
      return { bytes: s.bytes };
    },
    async finish(args) {
      const s = get(args?.id);
      const rate = Math.round(Number(args?.sampleRate));
      if (!(rate >= 8000 && rate <= 384000)) throw new Error('Invalid sample rate');
      // Closed and forgotten whatever happens, so a failed finish never keeps the file open.
      open.delete(String(args.id));
      try {
        await s.pending.catch(() => {});
        await s.handle.write(wavHeader(s.bytes, rate), 0, HEADER, 0);
      } finally {
        await close(s);
      }
      return { path: s.file, frames: s.bytes / 4 };
    },
    async abort(args) {
      const s = open.get(String(args?.id ?? ''));
      if (!s) return {};
      open.delete(String(args.id));
      await s.pending.catch(() => {});
      await close(s);
      try { await fs.promises.unlink(s.file); } catch { /* gone */ }
      return {};
    },
  };
}

module.exports = { createWavStreamStore, wavHeader };
