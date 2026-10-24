'use strict';
/**
 * A show in one file: a .zip with the project at its top and its media in a
 * Media folder beside it, every reference relative. Unzipped anywhere (by the
 * app or by hand), the project opens with its media.
 *
 * Media is stored, not compressed: video and images are compressed already,
 * so packing is as fast as copying. Files of 4 GB and more, and packages of
 * that size, use the ZIP64 extensions, which current unzip tools read.
 */
const fs = require('fs/promises');
const path = require('path');
const zlib = require('zlib');
const { planPackedMedia } = require('./project-media.cjs');

const U32 = 0xFFFFFFFF;
const CHUNK = 4 << 20;
const UTF8_NAMES = 0x0800;

class PackageCancelled extends Error {
  constructor() { super('Packing was cancelled.'); this.code = 'cancelled'; }
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/**
 * A zip written front to back into `outputPath`. Each entry's header is
 * written first and its CRC filled in once the data is through, so nothing
 * is read twice. `zip64Threshold` exists for tests.
 */
async function createZipWriter(outputPath, { zip64Threshold = U32 } = {}) {
  const handle = await fs.open(outputPath, 'w');
  const entries = [];
  let offset = 0;
  const write = async (buffer) => {
    await handle.write(buffer, 0, buffer.length, offset);
    offset += buffer.length;
  };
  async function localHeader(name, size, mtime) {
    const nameBytes = Buffer.from(name, 'utf8');
    const zip64 = size >= zip64Threshold;
    const extra = Buffer.alloc(zip64 ? 20 : 0);
    if (zip64) {
      extra.writeUInt16LE(0x0001, 0);
      extra.writeUInt16LE(16, 2);
      extra.writeBigUInt64LE(BigInt(size), 4);
      extra.writeBigUInt64LE(BigInt(size), 12);
    }
    const { time, day } = dosDateTime(mtime);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(zip64 ? 45 : 20, 4);
    header.writeUInt16LE(UTF8_NAMES, 6);
    header.writeUInt16LE(0, 8); // stored
    header.writeUInt16LE(time, 10);
    header.writeUInt16LE(day, 12);
    header.writeUInt32LE(0, 14); // CRC, filled in after the data
    header.writeUInt32LE(zip64 ? U32 : size, 18);
    header.writeUInt32LE(zip64 ? U32 : size, 22);
    header.writeUInt16LE(nameBytes.length, 26);
    header.writeUInt16LE(extra.length, 28);
    const start = offset;
    await write(Buffer.concat([header, nameBytes, extra]));
    return { start, nameBytes, zip64, time, day };
  }
  async function fillCrc(start, crc) {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(crc >>> 0, 0);
    await handle.write(bytes, 0, 4, start + 14);
  }
  return {
    async addBuffer(name, buffer, mtime = new Date()) {
      const entry = await localHeader(name, buffer.length, mtime);
      const crc = zlib.crc32(buffer);
      await write(buffer);
      await fillCrc(entry.start, crc);
      entries.push({ ...entry, crc, size: buffer.length });
    },
    async addFile(name, source, { onBytes, signal } = {}) {
      const input = await fs.open(source, 'r');
      try {
        const stat = await input.stat();
        const entry = await localHeader(name, stat.size, stat.mtime);
        const chunk = Buffer.allocUnsafe(Math.min(CHUNK, Math.max(1, stat.size)));
        let crc = 0;
        let copied = 0;
        while (copied < stat.size) {
          if (signal?.aborted) throw new PackageCancelled();
          const { bytesRead } = await input.read(chunk, 0, Math.min(chunk.length, stat.size - copied), copied);
          if (!bytesRead) break;
          const part = chunk.subarray(0, bytesRead);
          crc = zlib.crc32(part, crc);
          await write(part);
          copied += bytesRead;
          onBytes?.(bytesRead);
        }
        if (copied !== stat.size) throw new Error(`${path.basename(source)} changed while it was being packed.`);
        await fillCrc(entry.start, crc);
        entries.push({ ...entry, crc, size: copied });
      } finally {
        await input.close();
      }
    },
    async finish() {
      const directoryStart = offset;
      for (const entry of entries) {
        const bigSize = entry.size >= zip64Threshold;
        const bigOffset = entry.start >= zip64Threshold;
        const fields = [...(bigSize ? [entry.size, entry.size] : []), ...(bigOffset ? [entry.start] : [])];
        const extra = Buffer.alloc(fields.length ? 4 + fields.length * 8 : 0);
        if (fields.length) {
          extra.writeUInt16LE(0x0001, 0);
          extra.writeUInt16LE(fields.length * 8, 2);
          fields.forEach((value, i) => extra.writeBigUInt64LE(BigInt(value), 4 + i * 8));
        }
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50, 0);
        record.writeUInt16LE((3 << 8) | 45, 4); // made on Unix, so the mode below is read
        record.writeUInt16LE(bigSize || bigOffset ? 45 : 20, 6);
        record.writeUInt16LE(UTF8_NAMES, 8);
        record.writeUInt16LE(0, 10);
        record.writeUInt16LE(entry.time, 12);
        record.writeUInt16LE(entry.day, 14);
        record.writeUInt32LE(entry.crc >>> 0, 16);
        record.writeUInt32LE(bigSize ? U32 : entry.size, 20);
        record.writeUInt32LE(bigSize ? U32 : entry.size, 24);
        record.writeUInt16LE(entry.nameBytes.length, 28);
        record.writeUInt16LE(extra.length, 30);
        record.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file, rw-r--r--
        record.writeUInt32LE(bigOffset ? U32 : entry.start, 42);
        await write(Buffer.concat([record, entry.nameBytes, extra]));
      }
      const directorySize = offset - directoryStart;
      const count = entries.length;
      const zip64 = count >= 0xFFFF || directoryStart >= zip64Threshold || directorySize >= zip64Threshold;
      if (zip64) {
        const end64 = Buffer.alloc(56);
        end64.writeUInt32LE(0x06064b50, 0);
        end64.writeBigUInt64LE(44n, 4);
        end64.writeUInt16LE(45, 12);
        end64.writeUInt16LE(45, 14);
        end64.writeBigUInt64LE(BigInt(count), 24);
        end64.writeBigUInt64LE(BigInt(count), 32);
        end64.writeBigUInt64LE(BigInt(directorySize), 40);
        end64.writeBigUInt64LE(BigInt(directoryStart), 48);
        const end64Start = offset;
        await write(end64);
        const locator = Buffer.alloc(20);
        locator.writeUInt32LE(0x07064b50, 0);
        locator.writeBigUInt64LE(BigInt(end64Start), 8);
        locator.writeUInt32LE(1, 16);
        await write(locator);
      }
      const end = Buffer.alloc(22);
      end.writeUInt32LE(0x06054b50, 0);
      end.writeUInt16LE(zip64 ? 0xFFFF : count, 8);
      end.writeUInt16LE(zip64 ? 0xFFFF : count, 10);
      end.writeUInt32LE(zip64 ? U32 : directorySize, 12);
      end.writeUInt32LE(zip64 ? U32 : directoryStart, 16);
      await write(end);
      await handle.sync();
      await handle.close();
    },
    async abort() {
      try { await handle.close(); } catch { /* already closed */ }
    },
  };
}

const projectFileName = (name) => `${String(name || 'Project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || 'Project'}.gha`;

/**
 * Write the show into `outputPath` (.zip). The project data is changed in
 * place to point at the packed media. The zip is written beside the target
 * and renamed into place when complete, so a cancelled or failed pack never
 * leaves a broken file under the chosen name.
 */
async function exportProjectPackage(data, projectDir, outputPath, { projectName, onProgress, signal, zip64Threshold } = {}) {
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.zip') throw new Error('Choose a .zip file name.');
  const plan = await planPackedMedia(data, projectDir, 'Media');
  const project = Buffer.from(JSON.stringify(data, null, 2), 'utf8');
  const total = project.length + plan.files.reduce((sum, file) => sum + file.size, 0);
  const partial = `${outputPath}.partial`;
  const zip = await createZipWriter(partial, { zip64Threshold });
  let done = 0;
  const report = (file) => onProgress?.({ done, total, file });
  try {
    await zip.addBuffer(projectFileName(projectName || path.basename(outputPath, path.extname(outputPath))), project);
    done += project.length;
    report(null);
    for (const file of plan.files) {
      await zip.addFile(file.target, file.source, { signal, onBytes: (bytes) => { done += bytes; report(file.target); } });
    }
    await zip.finish();
    await fs.rename(partial, outputPath);
  } catch (error) {
    await zip.abort();
    await fs.rm(partial, { force: true });
    throw error;
  }
  return { outputPath, files: plan.files.length, bytes: total, missing: plan.missing, fonts: plan.fonts };
}

/**
 * Unpack a package into a new folder named after it inside `parentDir`
 * ("Name 2"… when taken) and return the project file in it. A zip made by
 * hand from a show folder has the project one folder down; that is found too.
 */
async function unpackProjectPackage(zipPath, parentDir) {
  const extract = require('extract-zip');
  const base = path.basename(zipPath).replace(/\.zip$/i, '').trim() || 'Project';
  let folder = path.join(parentDir, base);
  for (let n = 2; await fs.stat(folder).then(() => true, () => false); n++) folder = path.join(parentDir, `${base} ${n}`);
  await fs.mkdir(folder, { recursive: true });
  try {
    // extract-zip refuses entries that would land outside `dir`.
    await extract(zipPath, { dir: folder });
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true });
    throw new Error(`Could not unpack ${path.basename(zipPath)}: ${error?.message || error}`);
  }
  const projectIn = async (dir) => {
    const names = (await fs.readdir(dir)).filter((name) => name.toLowerCase().endsWith('.gha') && !name.startsWith('._'));
    return names.length ? path.join(dir, names.sort()[0]) : null;
  };
  let projectPath = await projectIn(folder);
  if (!projectPath) {
    const dirs = (await fs.readdir(folder, { withFileTypes: true })).filter((entry) => entry.isDirectory() && entry.name !== '__MACOSX');
    if (dirs.length === 1) projectPath = await projectIn(path.join(folder, dirs[0].name));
  }
  if (!projectPath) {
    await fs.rm(folder, { recursive: true, force: true });
    throw new Error('This zip has no Ghost Arcade project (.gha) in it.');
  }
  return { folder, projectPath };
}

module.exports = { createZipWriter, exportProjectPackage, unpackProjectPackage, PackageCancelled };
