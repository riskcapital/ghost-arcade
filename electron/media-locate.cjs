/**
 * Finding media files a show refers to: which of them are still on disk, and
 * where files with the same names are inside a folder the user picked.
 */
const fs = require('fs');
const path = require('path');

const MAX_PATHS = 2000;
const MAX_NAMES = 2000;
const MAX_DEPTH = 8;
const MAX_ENTRIES = 50000;

/** `{ [path]: true | false }` for each absolute path asked about. */
async function mediaFilesStatus(paths) {
  const result = {};
  const list = Array.isArray(paths) ? paths.slice(0, MAX_PATHS) : [];
  await Promise.all(list.map(async (value) => {
    if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) return;
    try {
      result[value] = (await fs.promises.stat(value)).isFile();
    } catch {
      result[value] = false;
    }
  }));
  return result;
}

/**
 * Names compare without case, as the file systems this runs on do, and in
 * one Unicode form: macOS can hand back an accented letter as the letter
 * plus a separate accent, where the same name saved on Windows is one
 * character.
 */
const nameKey = name => name.normalize('NFC').toLowerCase();

/**
 * Look through `dir` for files named like the ones asked for. The nearest
 * match to the top of the folder wins when a name appears more than once.
 */
async function findMediaInFolder(dir, names, { maxDepth = MAX_DEPTH, maxEntries = MAX_ENTRIES } = {}) {
  const wanted = new Map();
  for (const name of Array.isArray(names) ? names.slice(0, MAX_NAMES) : []) {
    if (typeof name === 'string' && name && !/[\\/\0]/.test(name)) wanted.set(nameKey(name), name);
  }
  const found = {};
  let remaining = wanted.size;
  let seen = 0;
  let level = [dir];
  for (let depth = 0; depth <= maxDepth && level.length && remaining > 0 && seen < maxEntries; depth += 1) {
    const next = [];
    for (const folder of level) {
      let entries;
      try {
        entries = await fs.promises.readdir(folder, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        seen += 1;
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') next.push(path.join(folder, entry.name));
          continue;
        }
        if (!entry.isFile()) continue;
        const asked = wanted.get(nameKey(entry.name));
        if (asked === undefined || found[asked]) continue;
        found[asked] = path.join(folder, entry.name);
        remaining -= 1;
      }
      if (remaining <= 0 || seen >= maxEntries) break;
    }
    level = next;
  }
  return found;
}

module.exports = { mediaFilesStatus, findMediaInFolder };
