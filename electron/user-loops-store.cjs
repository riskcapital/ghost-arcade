'use strict';
// "My loops": loops the performer saved from the live looper, kept in one
// folder of the app's userData so every project sees them.
//
// The renderer never names a path. A loop is known by an id this module
// issues (a UUID); the file names are rebuilt here from that id, and every
// read, write, rename and delete is checked to stay inside the one folder.
// A loop is `<id>.json` (its name, length, tempo, key and notes) and, for an
// audio loop, `<id>.wav` beside it. Sizes are capped before anything is
// written, and writes go through a temporary file so a crash leaves the old
// file or the new one, never half of one.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { writeFileAtomicSync } = require('./atomic-write.cjs');

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const MAX_WAV_BYTES = 160 * 1024 * 1024;
const MAX_LOOPS = 2000;
const NAME_MAX = 80;

function toBuffer(bytes) {
  if (bytes == null) return null;
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof ArrayBuffer) return Buffer.from(bytes);
  if (ArrayBuffer.isView(bytes)) return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return null;
}

function cleanName(raw) {
  const name = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name || 'Loop';
}

function cleanMeta(raw) {
  const m = raw && typeof raw === 'object' ? raw : {};
  const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
  return {
    kind: m.kind === 'audio' ? 'audio' : 'midi',
    name: cleanName(m.name),
    bars: Math.round(num(m.bars, 1, 64, 1)),
    beats: num(m.beats, 1, 256, 4),
    bpm: num(m.bpm, 20, 400, 120),
    key: m.key && typeof m.key === 'object' ? { root: Math.round(num(m.key.root, 0, 11, 0)), scale: String(m.key.scale ?? '').slice(0, 24) } : null,
    instrument: typeof m.instrument === 'string' ? m.instrument.slice(0, 32) : null,
    tone: typeof m.tone === 'string' ? m.tone.slice(0, 64) : undefined,
    // A tab instrument's loop (the XY pad, dub shots, drum pads), and an XY loop's puck movement.
    source: ['xy', 'dub', 'pads'].includes(m.source) ? m.source : undefined,
    xy: m.source === 'xy' && Array.isArray(m.xy) ? m.xy.slice(0, 20000).map((p) => ({ beat: num(p?.beat, 0, 256, 0), x: num(p?.x, 0, 1, 0.5), y: num(p?.y, 0, 1, 0.5) })) : undefined,
    notes: Array.isArray(m.notes) ? m.notes.slice(0, 20000).map((n) => ({
      beat: num(n?.beat, 0, 256, 0), dur: num(n?.dur, 0, 256, 0.25), note: Math.round(num(n?.note, 0, 127, 60)), velocity: num(n?.velocity, 0, 1, 0.8),
    })) : [],
    createdAt: num(m.createdAt, 0, 8.64e15, Date.now()),
  };
}

function createUserLoopsStore(directory) {
  const dir = path.resolve(directory);

  function inside(id, ext) {
    if (!ID_RE.test(String(id))) throw new Error('Invalid loop id.');
    const fileName = `${id}${ext}`;
    const target = path.join(dir, fileName);
    if (path.dirname(target) !== dir || path.basename(target) !== fileName) throw new Error('Invalid loop id.');
    return target;
  }

  function ensureDir() {
    fs.mkdirSync(dir, { recursive: true });
  }

  function readMeta(id) {
    const file = inside(id, '.json');
    const stat = fs.statSync(file);
    if (stat.size > MAX_JSON_BYTES) throw new Error('Loop file is too large.');
    return { id, ...cleanMeta(JSON.parse(fs.readFileSync(file, 'utf8'))), hasAudio: fs.existsSync(inside(id, '.wav')) };
  }

  /** Every loop, newest first, without their notes. */
  function list() {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const name of fs.readdirSync(dir)) {
      const m = /^(.+)\.json$/.exec(name);
      if (!m || !ID_RE.test(m[1])) continue;
      try {
        const { notes, ...entry } = readMeta(m[1]);
        out.push({ ...entry, noteCount: notes.length });
      } catch {
        // A damaged file is left alone and not listed.
      }
    }
    return out.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Save a new loop; returns its id. `wav` (bytes) only for an audio loop. */
  function save({ meta, wav } = {}) {
    const clean = cleanMeta(meta);
    const bytes = clean.kind === 'audio' ? toBuffer(wav) : null;
    if (clean.kind === 'audio') {
      if (!bytes || bytes.length < 44 || bytes.length > MAX_WAV_BYTES) throw new Error('The audio loop is missing or too large.');
      if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') throw new Error('The audio loop is not a WAV file.');
    }
    const json = JSON.stringify(clean);
    if (Buffer.byteLength(json) > MAX_JSON_BYTES) throw new Error('The loop is too large.');
    ensureDir();
    if (fs.readdirSync(dir).filter((n) => n.endsWith('.json')).length >= MAX_LOOPS) throw new Error('My loops is full.');
    const id = crypto.randomUUID();
    if (bytes) writeFileAtomicSync(inside(id, '.wav'), bytes);
    writeFileAtomicSync(inside(id, '.json'), json);
    return { id };
  }

  /** One loop with its notes, and its audio as bytes. */
  function read({ id } = {}) {
    const meta = readMeta(id);
    const wavFile = inside(id, '.wav');
    let wav = null;
    if (meta.kind === 'audio' && fs.existsSync(wavFile)) {
      if (fs.statSync(wavFile).size > MAX_WAV_BYTES) throw new Error('Loop audio is too large.');
      wav = fs.readFileSync(wavFile);
    }
    return { loop: meta, wav };
  }

  function rename({ id, name } = {}) {
    const file = inside(id, '.json');
    const meta = readMeta(id);
    const { id: _id, hasAudio: _a, ...rest } = meta;
    writeFileAtomicSync(file, JSON.stringify({ ...rest, name: cleanName(name) }));
    return { id };
  }

  function remove({ id } = {}) {
    const json = inside(id, '.json');
    const wav = inside(id, '.wav');
    if (fs.existsSync(wav)) fs.unlinkSync(wav);
    if (fs.existsSync(json)) fs.unlinkSync(json);
    return { id };
  }

  return { list, save, read, rename, remove, directory: dir };
}

module.exports = { createUserLoopsStore, cleanName };
