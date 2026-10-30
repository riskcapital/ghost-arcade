'use strict';
// Write a file so that a crash, power cut or full disk mid-write leaves the
// old contents or the new ones, never a torn mix: write a temp file beside
// the target, flush it to disk, then move it over the target (on Windows
// with the retries in replace-file.cjs).

const nodeFs = require('fs');
const { replaceFile, replaceFileSync } = require('./replace-file.cjs');

let serial = 0;

/** A temp name beside the file, unique within this process. */
function tempPathFor(target) {
  serial = (serial + 1) % 1e9;
  return `${target}.saving-${process.pid}-${serial}`;
}

function encodingFor(data, options) {
  return typeof data === 'string' ? (options.encoding ?? 'utf8') : undefined;
}

/** Write through a symlink rather than replace the link with a file. */
function resolveLinkSync(fs, target) {
  try {
    return fs.lstatSync(target).isSymbolicLink() ? fs.realpathSync(target) : target;
  } catch {
    return target;
  }
}

async function resolveLink(fs, target) {
  try {
    return (await fs.promises.lstat(target)).isSymbolicLink() ? await fs.promises.realpath(target) : target;
  } catch {
    return target;
  }
}

/**
 * @param {string} target
 * @param {string | Buffer | Uint8Array} data
 * @param {{ encoding?: BufferEncoding, fs?: typeof import('fs'), platform?: string }} [options]
 */
async function writeFileAtomic(target, data, options = {}) {
  const fs = options.fs ?? nodeFs;
  const file = await resolveLink(fs, target);
  const temp = tempPathFor(file);
  let handle = null;
  try {
    handle = await fs.promises.open(temp, 'w');
    await handle.writeFile(data, encodingFor(data, options));
    await handle.sync();
    await handle.close();
    handle = null;
    await replaceFile(temp, file, { fs, platform: options.platform });
  } catch (err) {
    if (handle) await handle.close().catch(() => {});
    await fs.promises.rm(temp, { force: true }).catch(() => {});
    throw err;
  }
}

/** The same, blocking, for callers that must finish before returning. */
function writeFileAtomicSync(target, data, options = {}) {
  const fs = options.fs ?? nodeFs;
  const file = resolveLinkSync(fs, target);
  const temp = tempPathFor(file);
  let fd = null;
  try {
    fd = fs.openSync(temp, 'w');
    fs.writeFileSync(fd, data, encodingFor(data, options));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    replaceFileSync(temp, file, { fs, platform: options.platform });
  } catch (err) {
    if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
    try { fs.rmSync(temp, { force: true }); } catch { /* never written */ }
    throw err;
  }
}

module.exports = { writeFileAtomic, writeFileAtomicSync };
