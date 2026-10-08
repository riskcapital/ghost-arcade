'use strict';
// Where scans sent from a paired phone are written.
//
// The phone (and the renderer relaying for it) only ever names a transfer by
// an id this module issued. The folder is fixed when the store is created, the
// file name is rebuilt here from scratch, and every write is checked against
// the size that was announced, so nothing a phone sends can create or touch a
// file outside that one folder. A transfer lands in a hidden ".part" file and
// is moved into place only after its size, SHA-256 and PLY header check out.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_OPEN = 4;
const NAME_MAX = 80;

/** Same rule as sanitizeScanName in src/lib/mobile/studio/scanTransfer.ts. */
function sanitizeScanName(raw) {
  let name = String(raw ?? '').normalize('NFKC');
  name = name.split(/[\\/]/).pop() ?? '';
  name = name.replace(/\.ply$/i, '');
  name = name.replace(/[^A-Za-z0-9 ._()-]/g, '_').replace(/\s+/g, ' ').replace(/_{2,}/g, '_');
  name = name.replace(/^[ ._]+/, '').replace(/[ ._]+$/, '');
  if (name.length > NAME_MAX) name = name.slice(0, NAME_MAX).replace(/[ ._]+$/, '');
  if (!name) name = 'Scan';
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name.split('.')[0])) name = `_${name}`;
  return `${name}.ply`;
}

function toBuffer(bytes) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

function createPhoneScanStore(directory) {
  const dir = path.resolve(directory);
  const open = new Map();

  /** A path inside the folder for a bare file name, or a thrown error. */
  function inside(fileName) {
    const target = path.join(dir, fileName);
    if (path.dirname(target) !== dir || path.basename(target) !== fileName) throw new Error('Invalid scan file name.');
    return target;
  }
  function freeName(wanted) {
    const base = wanted.replace(/\.ply$/i, '');
    for (let n = 1; n < 1000; n++) {
      const candidate = n === 1 ? `${base}.ply` : `${base} (${n}).ply`;
      const taken = fs.existsSync(inside(candidate)) || [...open.values()].some((t) => t.name === candidate);
      if (!taken) return candidate;
    }
    throw new Error('Too many scans with this name.');
  }
  function discard(id) {
    const transfer = open.get(id);
    if (!transfer) return;
    open.delete(id);
    try { fs.closeSync(transfer.fd); } catch {}
    try { fs.unlinkSync(transfer.temp); } catch {}
  }

  return {
    directory: dir,
    begin({ name, bytes } = {}) {
      if (!Number.isInteger(bytes) || bytes < 16 || bytes > MAX_BYTES) throw new Error('This scan is too large for the desktop to receive.');
      if (open.size >= MAX_OPEN) throw new Error('The desktop is busy with other scans.');
      fs.mkdirSync(dir, { recursive: true });
      const id = crypto.randomBytes(16).toString('hex');
      const finalName = freeName(sanitizeScanName(name));
      const temp = inside(`.incoming-${id}.part`);
      const fd = fs.openSync(temp, 'wx');
      open.set(id, { fd, temp, name: finalName, bytes, written: 0, hash: crypto.createHash('sha256'), head: Buffer.alloc(0) });
      return { id, name: finalName };
    },
    write({ id, offset, bytes } = {}) {
      const transfer = open.get(String(id));
      if (!transfer) throw new Error('This scan is no longer being received.');
      const data = toBuffer(bytes);
      if (!data || data.length === 0) throw new Error('Empty scan data.');
      // Strictly in order and never past the announced size.
      if (offset !== transfer.written || transfer.written + data.length > transfer.bytes) {
        discard(String(id));
        throw new Error('Scan data arrived out of order.');
      }
      fs.writeSync(transfer.fd, data, 0, data.length, transfer.written);
      transfer.hash.update(data);
      if (transfer.head.length < 4) transfer.head = Buffer.concat([transfer.head, data.subarray(0, 4 - transfer.head.length)]);
      transfer.written += data.length;
      return { written: transfer.written };
    },
    finish({ id, sha256 } = {}) {
      const transfer = open.get(String(id));
      if (!transfer) throw new Error('This scan is no longer being received.');
      try {
        if (transfer.written !== transfer.bytes) throw new Error('The scan did not arrive in full.');
        if (transfer.hash.digest('hex') !== String(sha256 || '').toLowerCase()) throw new Error('The scan did not arrive intact. Send it again.');
        if (transfer.head.toString('latin1') !== 'ply\n') throw new Error('This file is not a point cloud scan.');
        fs.closeSync(transfer.fd);
        const target = inside(transfer.name);
        if (fs.existsSync(target)) throw new Error('A scan with this name already exists.');
        fs.renameSync(transfer.temp, target);
        open.delete(String(id));
        return { path: target, name: transfer.name, bytes: transfer.bytes };
      } catch (error) {
        discard(String(id));
        throw error;
      }
    },
    abort({ id } = {}) {
      discard(String(id));
      return { aborted: true };
    },
    /** Scans already in the folder, newest first, so the library survives a restart. */
    list() {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { return []; }
      const out = [];
      for (const name of names) {
        if (name.startsWith('.') || !/\.ply$/i.test(name)) continue;
        try {
          const stat = fs.statSync(inside(name));
          if (stat.isFile()) out.push({ name, path: inside(name), bytes: stat.size, modified: stat.mtimeMs });
        } catch {}
      }
      return out.sort((a, b) => b.modified - a.modified);
    },
    /** Remove leftovers of transfers that were cut off by a quit or crash. */
    cleanup() {
      let names = [];
      try { names = fs.readdirSync(dir); } catch { return 0; }
      let removed = 0;
      for (const name of names) {
        if (!/^\.incoming-[0-9a-f]{32}\.part$/.test(name)) continue;
        if ([...open.values()].some((t) => path.basename(t.temp) === name)) continue;
        try { fs.unlinkSync(inside(name)); removed++; } catch {}
      }
      return removed;
    },
    openCount() { return open.size; },
  };
}

module.exports = { createPhoneScanStore, sanitizeScanName, PHONE_SCAN_MAX_BYTES: MAX_BYTES };
