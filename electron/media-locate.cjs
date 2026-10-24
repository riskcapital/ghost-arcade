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

/**
 * iCloud Drive with "Optimize Mac Storage" keeps only a stub of a file it has
 * not downloaded. macOS 14 and later keep the name, but the file holds no
 * data until it is read, and reading it waits for the whole download: a show
 * that opens on such files stalls with no word of why. Earlier macOS hid the
 * file and left `.name.icloud` beside it, so the file looked missing.
 *
 * Returns 'dataless' (there, not downloaded), 'placeholder' (only the
 * `.icloud` stub is there) or null. `statFn` exists for tests.
 */
async function icloudState(file, { platform = process.platform, statFn = fs.promises.stat } = {}) {
  if (platform !== 'darwin' || typeof file !== 'string' || !path.isAbsolute(file)) return null;
  try {
    const stat = await statFn(file);
    // No blocks on disk for a file with a size. Tiny files can live inside
    // their metadata, so only files over 64 KB count.
    return stat.isFile() && stat.size > 65536 && stat.blocks === 0 ? 'dataless' : null;
  } catch { /* not there: look for the older stub */ }
  try {
    const stub = path.join(path.dirname(file), `.${path.basename(file)}.icloud`);
    return (await statFn(stub)).isFile() ? 'placeholder' : null;
  } catch {
    return null;
  }
}

/**
 * Start downloading these iCloud files without waiting. A dataless file
 * downloads when it is read, so a separate process reads its first byte
 * (the read blocks until the file is here; the app does not). An older
 * `.icloud` stub is handed to brctl, which those macOS versions have.
 */
function requestIcloudDownloads(items, { spawnFn = require('child_process').execFile } = {}) {
  const started = [];
  for (const item of (Array.isArray(items) ? items : []).slice(0, 500)) {
    const file = item?.file;
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('\0')) continue;
    if (item.state === 'dataless') {
      spawnFn('/usr/bin/head', ['-c', '1', file], { timeout: 0, maxBuffer: 16 }, () => {});
    } else if (item.state === 'placeholder') {
      spawnFn('/usr/bin/brctl', ['download', file], { timeout: 60000 }, () => {});
    } else {
      continue;
    }
    started.push(file);
  }
  return started;
}

module.exports = { mediaFilesStatus, findMediaInFolder, icloudState, requestIcloudDownloads };
