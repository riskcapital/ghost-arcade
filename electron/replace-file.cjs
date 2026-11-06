'use strict';
// Move a finished temp file over its target.
//
// On Windows a rename onto a file fails (EPERM, EACCES or EBUSY) while
// anything has the target open without sharing delete access: Defender or
// the search indexer scanning it, OneDrive or Dropbox syncing it, Explorer's
// preview pane showing it. Those holds last a moment, so retry for a short
// while; if the target stays held, copy over it instead (a copy only needs
// write access) and remove the temp file.

const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RETRY_DELAYS_MS = [50, 100, 200, 400, 750];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string} temp     the finished file, beside the target
 * @param {string} target   the file to replace
 * @param {{ fs?: typeof import('fs'), platform?: string, delays?: number[] }} [options]
 */
async function replaceFile(temp, target, options = {}) {
  const fs = options.fs ?? require('fs');
  const platform = options.platform ?? process.platform;
  const delays = options.delays ?? RETRY_DELAYS_MS;
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(temp, target);
      return;
    } catch (err) {
      if (platform !== 'win32' || !RETRY_CODES.has(err?.code)) throw err;
      if (attempt < delays.length) {
        await wait(delays[attempt]);
        continue;
      }
      fs.copyFileSync(temp, target);
      try { fs.unlinkSync(temp); } catch { /* the copy is what matters */ }
      return;
    }
  }
}

module.exports = { replaceFile, RETRY_CODES };
