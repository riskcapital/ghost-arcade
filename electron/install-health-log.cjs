'use strict';

/**
 * Install mode health log: one line per event (start, schedule changes,
 * restarts, frame stalls, LED controllers dropping and coming back), in a
 * plain text file beside the app's other logs, so whoever looks after the
 * installation can read what happened overnight.
 *
 * The file rotates by size: installation.log, installation.1.log, ... up
 * to `keep` old files, so weeks of running cannot fill the disk. Nothing
 * here needs a network. The latest events are also kept in memory for the
 * status readout in Settings.
 */

const nodeFs = require('fs');
const nodePath = require('path');

function pad(n, w = 2) {
  return String(n).padStart(w, '0');
}

/** Local time with the UTC offset, so a DST change reads unambiguously. */
function stamp(ms) {
  const d = new Date(ms);
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const a = Math.abs(off);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

function createHealthLog({ dir, name = 'installation', maxBytes = 512 * 1024, keep = 5, fs = nodeFs, path = nodePath, now = () => Date.now(), memory = 200 } = {}) {
  const file = path.join(dir, `${name}.log`);
  const recent = [];
  let size = null;

  function rotate() {
    for (let i = keep - 1; i >= 1; i--) {
      const from = path.join(dir, `${name}.${i}.log`);
      const to = path.join(dir, `${name}.${i + 1}.log`);
      try { if (fs.existsSync(from)) fs.renameSync(from, to); } catch { /* keep going */ }
    }
    try { fs.renameSync(file, path.join(dir, `${name}.1.log`)); } catch { /* nothing to rotate */ }
    // Anything past `keep` is dropped.
    try { fs.rmSync(path.join(dir, `${name}.${keep + 1}.log`), { force: true }); } catch { /* ignore */ }
    size = 0;
  }

  function write(kind, message) {
    const at = now();
    const entry = { at, kind: String(kind || 'info'), message: String(message ?? '') };
    recent.push(entry);
    if (recent.length > memory) recent.splice(0, recent.length - memory);
    const line = `${stamp(at)}  ${entry.kind.padEnd(9)} ${entry.message.replace(/\s*\n\s*/g, ' | ')}\n`;
    try {
      fs.mkdirSync(dir, { recursive: true });
      if (size === null) {
        try { size = fs.statSync(file).size; } catch { size = 0; }
      }
      if (size + Buffer.byteLength(line) > maxBytes && size > 0) rotate();
      fs.appendFileSync(file, line);
      size += Buffer.byteLength(line);
    } catch (err) {
      // A full or read-only disk must never take the show down.
      try { console.warn('[Install] health log write failed:', err && err.message); } catch { /* ignore */ }
    }
    return entry;
  }

  return {
    file,
    write,
    recent(limit = 30) {
      return recent.slice(-limit);
    },
  };
}

module.exports = { createHealthLog, stamp };
