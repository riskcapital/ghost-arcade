/**
 * Offscreen hosts for three.js / p5.js media sources.
 *
 * The 2.0 core draws everything and cannot run a web page, so each
 * JavaScript source gets its own hidden offscreen BrowserWindow. Chromium
 * renders the page there, every composited frame arrives here as a bitmap,
 * and it goes to the core as the source frame for whichever layers are bound
 * to that source id.
 *
 * A window per source rather than an iframe inside the editor, because:
 *   - the page's animation loop runs in its own renderer process instead of
 *     on the editor's main thread, which also drives the native sync flush;
 *   - frames come from Chromium's compositor, so capture works whatever the
 *     page did with preserveDrawingBuffer;
 *   - the page is served from its own ghost-js:// origin in a separate
 *     session, so an imported .html file cannot read the editor's storage.
 */
import { BrowserWindow, session } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { buildHostHtml } from './js-source-page.js';

export const JS_SOURCE_SCHEME = 'ghost-js';
const PARTITION = 'ghost-js-sources';
// Each host is a renderer process with its own GPU context. Past this many,
// the least recently requested one is closed to make room.
const MAX_HOSTS = 8;
const MAX_FPS = 60;
const MAX_FRAMES_IN_FLIGHT = 2;
// Thumbnails: how long a page gets to draw after loading, and the hard stop.
const THUMBNAIL_SETTLE_MS = 1500;
const THUMBNAIL_TIMEOUT_MS = 8000;
const MAX_LOGGED_PAGE_ERRORS = 20;
// A page that keeps crashing its renderer is not reopened every frame.
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60_000;

const THREE_BUILD_FILES = new Map([
  ['/lib/three.module.min.js', 'three.module.min.js'],
  // three.module.min.js imports this; without it `import 'three'` fails.
  ['/lib/three.core.min.js', 'three.core.min.js'],
  ['/lib/three.webgpu.min.js', 'three.webgpu.min.js'],
  ['/lib/three.tsl.min.js', 'three.tsl.min.js'],
]);
const THREE_ADDON_PREFIXES = ['/lib/addons/', '/lib/examples/jsm/'];
const CONTENT_TYPES = new Map([
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json'],
  ['.wasm', 'application/wasm'],
]);

function clampSize(value, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.max(16, Math.min(3072, n)) : fallback;
}

function sanitizeValues(values) {
  const out = {};
  if (!values || typeof values !== 'object') return out;
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (Array.isArray(value) && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      out[key] = value.slice(0, 4);
    }
  }
  return out;
}

export function createJsSourceHost({ broker, libDir, threeDir, preloadPath, isPackaged = false, log = console }) {
  const hosts = new Map();
  const threeAddonsRoot = path.join(threeDir, 'examples', 'jsm');

  // Files a page may load from its own origin; everything else is a 404.
  function resolveAsset(pathname) {
    if (pathname === '/lib/p5.min.js') return path.join(libDir, 'p5.min.js');
    const buildFile = THREE_BUILD_FILES.get(pathname);
    if (buildFile) return path.join(threeDir, 'build', buildFile);
    for (const prefix of THREE_ADDON_PREFIXES) {
      if (!pathname.startsWith(prefix)) continue;
      let relative;
      try {
        relative = decodeURIComponent(pathname.slice(prefix.length));
      } catch {
        return null;
      }
      const target = path.normalize(path.join(threeAddonsRoot, relative));
      return target.startsWith(threeAddonsRoot + path.sep) ? target : null;
    }
    return null;
  }
  const byToken = new Map();
  const crashes = new Map();
  let protocolReady = false;
  let tokenSerial = 0;
  // The core keeps the highest seq it has seen per source and drops older
  // frames, so this must keep rising across host restarts for the same id.
  let seq = Date.now() * 1000;

  function ensureProtocol() {
    if (protocolReady) return;
    const ses = session.fromPartition(PARTITION);
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.protocol.handle(JS_SOURCE_SCHEME, async (request) => {
      let url;
      try {
        url = new URL(request.url);
      } catch {
        return new Response('Bad request', { status: 400 });
      }
      const entry = byToken.get(url.hostname);
      if (!entry) return new Response('Not found', { status: 404 });
      if (url.pathname === '/' || url.pathname === '/index.html') {
        return new Response(entry.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
      }
      const file = resolveAsset(url.pathname);
      if (!file) return new Response('Not found', { status: 404 });
      try {
        const data = await fs.promises.readFile(file);
        const type = CONTENT_TYPES.get(path.extname(file).toLowerCase()) ?? 'application/octet-stream';
        return new Response(data, { headers: { 'content-type': type } });
      } catch {
        return new Response('Not found', { status: 404 });
      }
    });
    protocolReady = true;
  }

  function describe(entry) {
    return {
      id: entry.id,
      loaded: entry.loaded,
      width: entry.width,
      height: entry.height,
      fps: entry.fps,
      frame_width: entry.frameWidth,
      frame_height: entry.frameHeight,
      paints: entry.paints,
      uploads: entry.uploads,
      dropped: entry.dropped,
      errors: entry.errors,
      last_error: entry.lastError,
      last_upload_at: entry.lastUploadAt,
    };
  }

  function closeEntry(entry) {
    if (!entry || entry.closed) return;
    entry.closed = true;
    if (hosts.get(entry.id) === entry) hosts.delete(entry.id);
    byToken.delete(entry.token);
    try {
      if (!entry.window.isDestroyed()) entry.window.destroy();
    } catch {
      /* already gone */
    }
  }

  function evictIfFull() {
    while (hosts.size >= MAX_HOSTS) {
      let oldest = null;
      for (const entry of hosts.values()) {
        if (!oldest || entry.lastRequestedAt < oldest.lastRequestedAt) oldest = entry;
      }
      if (!oldest) return;
      log.warn?.(`[JsSource] closing ${oldest.id}: more than ${MAX_HOSTS} JavaScript sources open`);
      closeEntry(oldest);
    }
  }

  function crashedTooOften(id, hash) {
    const record = crashes.get(id);
    if (!record) return false;
    if (record.hash !== hash || Date.now() - record.lastAt > CRASH_WINDOW_MS) {
      crashes.delete(id);
      return false;
    }
    return record.count >= CRASH_LIMIT;
  }

  function noteCrash(entry, reason) {
    const record = crashes.get(entry.id);
    const count = record && record.hash === entry.hash ? record.count + 1 : 1;
    crashes.set(entry.id, { hash: entry.hash, count, lastAt: Date.now() });
    log.warn?.(`[JsSource] ${entry.id} renderer exited (${reason || 'unknown'}), crash ${count}`);
  }

  function handlePaint(entry, image) {
    if (entry.closed) return;
    entry.paints += 1;
    // A frame's round trip ends when the core has applied it, which is at
    // least one render tick. With a single frame in flight that caps uploads
    // near 40 a second on a 60 Hz core; two keeps pace without letting a
    // backlog build, and anything beyond that is dropped rather than queued.
    if (entry.uploading >= MAX_FRAMES_IN_FLIGHT) {
      entry.dropped += 1;
      return;
    }
    const { width, height } = image.getSize();
    if (!width || !height) return;
    const bitmap = image.toBitmap();
    if (bitmap.length < width * height * 4) return;
    entry.uploading += 1;
    entry.frameWidth = width;
    entry.frameHeight = height;
    seq += 1;
    broker
      .invoke('native_renderer_submit_commands', {
        commands: [
          {
            type: 'upload_source_frame',
            source_id: entry.id,
            seq,
            width,
            height,
            rgba_buffer: bitmap,
            pixel_format: 'bgra',
            placement: 'rect',
          },
        ],
      })
      .then((result) => {
        if (result === null || result === undefined) return;
        entry.uploads += 1;
        entry.lastUploadAt = Date.now();
      })
      .catch((err) => {
        entry.errors += 1;
        entry.lastError = String(err?.message || err);
      })
      .finally(() => {
        entry.uploading -= 1;
      });
  }

  function handleConsoleMessage(entry, args) {
    // Electron passes one details object; older versions passed positional args.
    const details = args[0] && typeof args[0] === 'object' && 'message' in args[0] ? args[0] : null;
    const level = details ? details.level : args[1];
    const message = details ? details.message : args[2];
    const isError = level === 'error' || level === 3;
    if (!isError || entry.loggedErrors >= MAX_LOGGED_PAGE_ERRORS) return;
    entry.loggedErrors += 1;
    entry.lastError = String(message);
    log.warn?.(`[JsSource] ${entry.id}: ${message}`);
  }

  function open(args = {}) {
    const id = typeof args.id === 'string' ? args.id.trim() : '';
    const html = typeof args.html === 'string' ? args.html : '';
    if (!id || !html) return { ok: false, reason: 'id and html are required' };
    const width = clampSize(args.width, 1280);
    const height = clampSize(args.height, 720);
    const fps = Math.max(1, Math.min(MAX_FPS, Math.round(Number(args.fps) || MAX_FPS)));
    const hash = crypto.createHash('sha1').update(html).digest('hex');
    const params = sanitizeValues(args.params);

    let entry = hosts.get(id);
    if (entry && (entry.hash !== hash || entry.window.isDestroyed())) {
      closeEntry(entry);
      entry = null;
    }
    if (entry) {
      entry.lastRequestedAt = Date.now();
      if (entry.width !== width || entry.height !== height) {
        entry.width = width;
        entry.height = height;
        entry.window.setContentSize(width, height);
      }
      if (entry.fps !== fps) {
        entry.fps = fps;
        entry.window.webContents.setFrameRate(fps);
      }
      return { ok: true, reused: true, ...describe(entry) };
    }
    if (crashedTooOften(id, hash)) return { ok: false, reason: 'crashed' };

    evictIfFull();
    ensureProtocol();

    const token = `s${(++tokenSerial).toString(36)}`;
    const win = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: true,
        partition: PARTITION,
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        webgl: true,
        spellcheck: false,
        devTools: !isPackaged,
      },
    });
    entry = {
      id,
      token,
      hash,
      html: buildHostHtml(html),
      window: win,
      width,
      height,
      fps,
      params,
      loaded: false,
      closed: false,
      uploading: 0,
      paints: 0,
      uploads: 0,
      dropped: 0,
      errors: 0,
      loggedErrors: 0,
      lastError: null,
      lastUploadAt: 0,
      frameWidth: 0,
      frameHeight: 0,
      lastRequestedAt: Date.now(),
    };
    hosts.set(id, entry);
    byToken.set(token, entry);

    const current = entry;
    const wc = win.webContents;
    wc.setFrameRate(fps);
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.on('did-finish-load', () => {
      current.loaded = true;
      // The page's own `window.shaderParams = {...}` has run by now; the saved
      // values go on top of its defaults.
      if (Object.keys(current.params).length > 0) wc.send('ghost-js:params', current.params);
    });
    wc.on('paint', (_event, _dirty, image) => handlePaint(current, image));
    wc.on('console-message', (...consoleArgs) => handleConsoleMessage(current, consoleArgs));
    wc.on('render-process-gone', (_event, details) => {
      noteCrash(current, details?.reason);
      closeEntry(current);
    });
    win.loadURL(`${JS_SOURCE_SCHEME}://${token}/index.html`).catch((err) => {
      current.errors += 1;
      current.lastError = String(err?.message || err);
    });
    return { ok: true, reused: false, ...describe(entry) };
  }

  /**
   * A still of a page for the media library, from a short-lived host of its
   * own, so an imported file never runs inside the editor, not even once.
   */
  function thumbnail(args = {}) {
    const html = typeof args.html === 'string' ? args.html : '';
    if (!html) return Promise.resolve({ ok: false, reason: 'html is required' });
    ensureProtocol();
    const token = `t${(++tokenSerial).toString(36)}`;
    byToken.set(token, { token, html: buildHostHtml(html) });
    const win = new BrowserWindow({
      width: 480,
      height: 270,
      useContentSize: true,
      show: false,
      frame: false,
      backgroundColor: '#000000',
      paintWhenInitiallyHidden: true,
      webPreferences: {
        offscreen: true,
        partition: PARTITION,
        preload: preloadPath,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        webgl: true,
        spellcheck: false,
        devTools: false,
      },
    });
    return new Promise((resolve) => {
      let lastImage = null;
      let settled = false;
      let timer = null;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        byToken.delete(token);
        let dataUrl = null;
        try {
          if (lastImage && !lastImage.isEmpty()) {
            const jpeg = lastImage.resize({ width: 320, height: 180, quality: 'good' }).toJPEG(75);
            dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
          }
        } catch {
          dataUrl = null;
        }
        try {
          if (!win.isDestroyed()) win.destroy();
        } catch {
          /* already gone */
        }
        resolve(dataUrl ? { ok: true, data_url: dataUrl } : { ok: false, reason: 'no frame' });
      };
      const wc = win.webContents;
      wc.setFrameRate(30);
      wc.setWindowOpenHandler(() => ({ action: 'deny' }));
      wc.on('will-navigate', (event) => event.preventDefault());
      wc.on('paint', (_event, _dirty, image) => {
        lastImage = image;
      });
      wc.on('did-finish-load', () => setTimeout(finish, THUMBNAIL_SETTLE_MS));
      wc.on('render-process-gone', finish);
      timer = setTimeout(finish, THUMBNAIL_TIMEOUT_MS);
      win.loadURL(`${JS_SOURCE_SCHEME}://${token}/index.html`).catch(finish);
    });
  }

  function close(id) {
    const entry = hosts.get(String(id ?? ''));
    if (!entry) return { ok: false };
    closeEntry(entry);
    return { ok: true };
  }

  function setParams(id, values) {
    const entry = hosts.get(String(id ?? ''));
    if (!entry) return { ok: false };
    const clean = sanitizeValues(values);
    Object.assign(entry.params, clean);
    if (entry.loaded && !entry.window.isDestroyed()) entry.window.webContents.send('ghost-js:params', clean);
    return { ok: true };
  }

  function setAudio(fields) {
    const clean = sanitizeValues(fields);
    for (const entry of hosts.values()) {
      if (entry.loaded && !entry.window.isDestroyed()) entry.window.webContents.send('ghost-js:audio', clean);
    }
    return { ok: true };
  }

  function status() {
    return { hosts: Array.from(hosts.values(), describe), max_hosts: MAX_HOSTS };
  }

  function closeAll() {
    for (const entry of Array.from(hosts.values())) closeEntry(entry);
  }

  return { open, close, setParams, setAudio, status, closeAll, thumbnail };
}
