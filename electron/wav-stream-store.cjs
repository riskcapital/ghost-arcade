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
const HEADER = 44;

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
  h.write('RIFF', 0, 'ascii');
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write('WAVE', 8, 'ascii');
  h.write('fmt ', 12, 'ascii');
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sampleRate, 24);
  h.writeUInt32LE(sampleRate * 4, 28);
  h.writeUInt16LE(4, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36, 'ascii');
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

function createWavStreamStore(directory) {
  const dir = path.resolve(directory);
  /** id -> { fd, file, bytes } */
  const open = new Map();
  const get = (id) => {
    const s = open.get(String(id ?? ''));
    if (!s) throw new Error('No such recording stream');
    return s;
  };
  const close = (s) => { try { fs.closeSync(s.fd); } catch { /* closed */ } };

  return {
    begin(args) {
      if (open.size >= MAX_OPEN) throw new Error('Too many recordings open');
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, safeName(args?.filename));
      const fd = fs.openSync(file, 'w');
      fs.writeSync(fd, wavHeader(0, 48000), 0, HEADER, 0);
      const id = crypto.randomUUID();
      open.set(id, { fd, file, bytes: 0 });
      return { id, path: file };
    },
    write(args) {
      const s = get(args?.id);
      const buf = toBuffer(args?.bytes);
      if (!buf || buf.length % 4 !== 0 || buf.length > MAX_WRITE) throw new Error('Invalid PCM block');
      fs.writeSync(s.fd, buf, 0, buf.length, HEADER + s.bytes);
      s.bytes += buf.length;
      return { bytes: s.bytes };
    },
    finish(args) {
      const s = get(args?.id);
      const rate = Math.round(Number(args?.sampleRate));
      if (!(rate >= 8000 && rate <= 384000)) throw new Error('Invalid sample rate');
      fs.writeSync(s.fd, wavHeader(s.bytes, rate), 0, HEADER, 0);
      close(s);
      open.delete(String(args.id));
      return { path: s.file, frames: s.bytes / 4 };
    },
    abort(args) {
      const s = open.get(String(args?.id ?? ''));
      if (!s) return {};
      close(s);
      open.delete(String(args.id));
      try { fs.unlinkSync(s.file); } catch { /* gone */ }
      return {};
    },
  };
}

module.exports = { createWavStreamStore, wavHeader };
