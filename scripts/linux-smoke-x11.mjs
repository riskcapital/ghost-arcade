// X11 helpers for scripts/linux-smoke.mjs: what is really on the display,
// read with the stock tools (xwininfo, xprop, xdotool, ImageMagick import).
// Every function returns null off Linux or when a tool is missing.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { encodePng } from './linux-smoke-image.mjs';

const isLinux = process.platform === 'linux';

function run(command, args, options = {}) {
  if (!isLinux) return null;
  try {
    return execFileSync(command, args, { encoding: options.encoding ?? 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return options.orNull === false ? String(error.stdout || '') : null;
  }
}

/** Geometry and map state of a window, by id (hex string or number). */
export function windowInfo(id) {
  const text = run('xwininfo', ['-id', String(id)]);
  if (!text) return null;
  const number = (label) => Number((text.match(new RegExp(`${label}:\\s+(-?\\d+)`)) || [])[1]);
  return {
    id: String(id), x: number('Absolute upper-left X'), y: number('Absolute upper-left Y'),
    width: number('Width'), height: number('Height'),
    viewable: /Map State:\s+IsViewable/.test(text),
  };
}

/** Direct children of a window: [{ id, name, width, height, x, y }]. */
export function windowChildren(id) {
  const text = run('xwininfo', ['-id', String(id), '-children']);
  if (!text) return null;
  const children = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s+(0x[0-9a-f]+)\s+(\(has no name\)|"[^"]*")[^\d]*?(\d+)x(\d+)\+(-?\d+)\+(-?\d+)/);
    if (match) children.push({ id: match[1], name: match[2].replace(/"/g, ''), width: Number(match[3]), height: Number(match[4]), x: Number(match[5]), y: Number(match[6]) });
  }
  return children;
}

/** Window ids whose title matches (xdotool search --name). */
export function findWindows(namePattern) {
  const text = run('xdotool', ['search', '--name', namePattern]);
  if (!text) return [];
  return text.split('\n').map((line) => line.trim()).filter(Boolean);
}

export function windowState(id) {
  const text = run('xprop', ['-id', String(id), '_NET_WM_STATE']);
  return text ? text.replace(/\s+/g, ' ').trim() : null;
}

export function rootSize() {
  const info = run('xwininfo', ['-root']);
  if (!info) return null;
  return { width: Number((info.match(/Width:\s+(\d+)/) || [])[1]), height: Number((info.match(/Height:\s+(\d+)/) || [])[1]) };
}

/** The whole X display as an RGBA image; also saved as a PNG when `file` is given. */
export function rootScreenshot(file = null) {
  const size = rootSize();
  if (!size) return null;
  const raw = run('import', ['-window', 'root', '-depth', '8', 'rgba:-'], { encoding: 'buffer' });
  if (!raw || raw.length < size.width * size.height * 4) return null;
  const image = { width: size.width, height: size.height, rgba: new Uint8Array(raw.buffer, raw.byteOffset, size.width * size.height * 4) };
  if (file) fs.writeFileSync(file, encodePng(image.width, image.height, image.rgba));
  return image;
}

/** A real key press at the X server (XTEST), with the pointer parked at x,y first. */
export function xKey(key, x = null, y = null) {
  if (x != null && y != null) run('xdotool', ['mousemove', String(x), String(y)]);
  return run('xdotool', ['key', key]) !== null;
}

/** The tree of windows under the root, for the artifact folder. */
export function windowTree() {
  return run('xwininfo', ['-root', '-tree']) || '';
}
