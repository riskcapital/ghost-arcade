'use strict';
const fs = require('fs');
const path = require('path');

/**
 * Where the main process writes its debug log.
 *
 * Packaged builds keep the name the docs point people to
 * (ghost-arcade-debug.log) in the per-user log folder: ~/Library/Logs on
 * macOS, %LOCALAPPDATA% on Windows. A source checkout writes
 * electron-debug.log at the repo root, as before.
 */
function debugLogLocation({ packaged, platform, env, sourceRoot }) {
  if (!packaged) {
    return { dir: sourceRoot, file: path.join(sourceRoot, 'electron-debug.log') };
  }
  const dir = platform === 'darwin'
    ? path.join(env.HOME || '/tmp', 'Library', 'Logs')
    : (env.LOCALAPPDATA || env.TEMP || '.');
  return { dir, file: path.join(dir, 'ghost-arcade-debug.log') };
}

/** `ghost-arcade-debug.log` -> `ghost-arcade-debug.<n>.log` (n = 0 is the file itself). */
function rotatedLogName(file, n) {
  if (n === 0) return file;
  const ext = path.extname(file);
  const base = ext ? file.slice(0, -ext.length) : file;
  return `${base}.${n}${ext}`;
}

/**
 * Keep the last `keep` launches' logs: the previous log becomes .1, .1
 * becomes .2, and the oldest falls off. A problem reported after a restart
 * is no longer lost with the log that would have shown it.
 *
 * Never throws. Returns true when the newest log was moved away (or there
 * was none), false when it is still there: it could not be moved (a virus
 * scanner or another program has it open, a read-only folder). The caller
 * then appends to it instead of starting it afresh, so the launch that
 * failed is not wiped by the next one.
 */
function rotateDebugLogs(file, keep = 3, fsImpl = fs) {
  const count = Math.max(1, Math.floor(keep));
  for (let n = count - 1; n >= 1; n -= 1) {
    const from = rotatedLogName(file, n - 1);
    const to = rotatedLogName(file, n);
    try {
      if (!fsImpl.existsSync(from)) continue;
      try { fsImpl.rmSync(to, { force: true }); } catch { /* rename may still replace it */ }
      fsImpl.renameSync(from, to);
    } catch {
      /* keep going: the newest log still gets written */
    }
  }
  try {
    return !fsImpl.existsSync(file);
  } catch {
    return true;
  }
}

/**
 * Start this launch's log: a fresh file after a rotation, or a separator
 * appended to a log that could not be rotated (unless that log is already
 * over `maxBytes`, so a log that can never be moved still cannot grow
 * without end). Never throws.
 */
function startDebugLog(file, header, rotated, fsImpl = fs, maxBytes = 32 * 1024 * 1024) {
  try {
    let fresh = rotated;
    if (!fresh) {
      try { fresh = fsImpl.statSync(file).size > maxBytes; } catch { fresh = true; }
    }
    if (fresh) fsImpl.writeFileSync(file, header);
    else fsImpl.appendFileSync(file, `\n${header}`);
  } catch {
    /* a read-only log folder must not stop the app */
  }
}

module.exports = { debugLogLocation, rotatedLogName, rotateDebugLogs, startDebugLog };
