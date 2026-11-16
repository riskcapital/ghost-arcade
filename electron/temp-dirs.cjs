'use strict';
// Temp folders the app makes for a render or a recording (raw frames, the
// soundtrack for the mux). Each is removed when its job ends: finished,
// cancelled, failed, or the app quits. A session that was killed cannot do
// that, so at launch the ones it left behind are swept: only folders of the
// app's own kinds, more than a day untouched, and not owned by a process
// that is still running (another copy of the app may be rendering).

/** The kinds of temp folder this sweep may remove (mkdtemp prefixes). */
const SWEPT_PREFIXES = ['ghost-native-mp4-', 'ghost-native-jpeg-', 'ghost-show-audio-', 'ghost-render-core-frames-'];
const OWNER_FILE = '.ghost-owner';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Note which process a temp folder belongs to, so a sweep in another copy of the app leaves it alone. */
function markOwned(fs, path, dir, pid = process.pid) {
  try { fs.writeFileSync(path.join(dir, OWNER_FILE), JSON.stringify({ pid, at: Date.now() })); } catch { /* best effort */ }
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (err) { return err?.code === 'EPERM'; }
}

/**
 * Remove the stale ones under `root`. `inUse` (absolute paths) are this
 * process's own live folders. Returns the folders removed.
 */
async function sweepStaleTempDirs({ fs, path, root, now = Date.now(), maxAgeMs = DAY_MS, inUse = new Set(), isAlive = processAlive, prefixes = SWEPT_PREFIXES }) {
  const removed = [];
  let names;
  try { names = await fs.promises.readdir(root); } catch { return removed; }
  for (const name of names) {
    if (!prefixes.some((p) => name.startsWith(p))) continue;
    const dir = path.join(root, name);
    if (inUse.has(dir)) continue;
    try {
      const stat = await fs.promises.lstat(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      let owner = null;
      try { owner = JSON.parse(await fs.promises.readFile(path.join(dir, OWNER_FILE), 'utf8')); } catch { /* none (older app) */ }
      if (owner && owner.pid !== process.pid && isAlive(owner.pid)) continue;
      // Untouched for a day: the folder and everything directly in it.
      let newest = stat.mtimeMs;
      for (const entry of await fs.promises.readdir(dir)) {
        try { newest = Math.max(newest, (await fs.promises.lstat(path.join(dir, entry))).mtimeMs); } catch { /* gone */ }
      }
      if (now - newest < maxAgeMs) continue;
      await fs.promises.rm(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch { /* in use or gone: leave it */ }
  }
  return removed;
}

/** The render core keeps decoded clip audio in `ghost-audio-<its pid>-<ns>`.
 *  It removes it when it shuts down; when it is stopped or dies, its parent
 *  removes it here (the core also sweeps ones a day old at start). */
const CORE_AUDIO_PREFIX = 'ghost-audio-';

function removeCoreAudioDirs({ fs, path, root, pid }) {
  const removed = [];
  if (!Number.isSafeInteger(pid) || pid <= 0) return removed;
  const prefix = `${CORE_AUDIO_PREFIX}${pid}-`;
  let names;
  try { names = fs.readdirSync(root); } catch { return removed; }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const dir = path.join(root, name);
    try {
      const stat = fs.lstatSync(dir);
      if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
      fs.rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch { /* gone */ }
  }
  return removed;
}

module.exports = { SWEPT_PREFIXES, OWNER_FILE, CORE_AUDIO_PREFIX, markOwned, processAlive, sweepStaleTempDirs, removeCoreAudioDirs };
