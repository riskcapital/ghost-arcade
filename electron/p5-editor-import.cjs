'use strict';
/**
 * Public sketches from the p5.js Web Editor (editor.p5js.org).
 *
 * The editor offers other apps no sign-in, so this reads only what its own
 * front end reads without a session: a user's public sketches, and one public
 * sketch by id. Requests go to fixed editor URLs built here from a checked
 * username and sketch id, so the renderer never names a URL. A sketch's
 * uploaded files (images, sounds, fonts) are downloaded from the hosts the
 * editor stores them on, within size limits, so the imported page plays
 * offline. Anything else stays a link the page loads when it plays.
 */

const EDITOR_ORIGIN = 'https://editor.p5js.org';

// Where sketch files live: the editor's upload bucket, and the CDNs its
// examples and libraries point at. A host matches itself and its subdomains.
const ASSET_HOSTS = [
  'assets.editor.p5js.org',
  'cdn.jsdelivr.net',
  'raw.githubusercontent.com',
  'cdnjs.cloudflare.com',
  'unpkg.com',
];

const USERNAME_RE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9._-]{1,64}$/;
const SKETCH_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// One prolific account lists over a thousand sketches, contents included,
// in about 17 MB.
const LIST_MAX_BYTES = 64 * 1024 * 1024;
const LIST_TIMEOUT_MS = 60_000;
const SKETCH_MAX_BYTES = 16 * 1024 * 1024;
const SKETCH_TIMEOUT_MS = 30_000;
const ASSET_MAX_BYTES = 8 * 1024 * 1024;
const ASSETS_TOTAL_MAX_BYTES = 24 * 1024 * 1024;
const ASSET_TIMEOUT_MS = 30_000;
const ASSET_CONCURRENCY = 4;
const MAX_REDIRECTS = 3;
const MAX_FILES = 500;
const MAX_FOLDER_DEPTH = 16;

// p5 itself and its add-ons: Ghost Arcade plays sketches on its own copy.
const P5_LIBRARY_FILE = /^p5(?:\.sound|\.dom)?(?:\.min)?\.js$/i;

class EditorError extends Error {}

function checkUsername(value) {
  const username = typeof value === 'string' ? value.trim() : '';
  if (!USERNAME_RE.test(username)) throw new EditorError('Enter a p5.js Web Editor username.');
  return username;
}

function checkSketchId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!SKETCH_ID_RE.test(id)) throw new EditorError('That is not a p5.js Web Editor sketch id.');
  return id;
}

function hostAllowed(hostname, hosts) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return hosts.some((h) => host === h || host.endsWith(`.${h}`));
}

/** True for an https URL on one of the hosts sketch files are stored on. */
function isAllowedAssetUrl(value) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    return false;
  }
  return url.protocol === 'https:' && !url.username && !url.password && hostAllowed(url.hostname, ASSET_HOSTS);
}

function isEditorUrl(url) {
  return url.protocol === 'https:' && url.hostname === 'editor.p5js.org';
}

async function readCapped(response, maxBytes, label) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new EditorError(`${label} is too large.`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new EditorError(`${label} is too large.`);
    }
    chunks.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
  }
  return Buffer.concat(chunks, size);
}

/**
 * GET with redirects followed by hand, so every hop is checked against the
 * same rule as the first URL.
 */
async function fetchChecked(fetchImpl, href, allowed, timeoutMs, accept) {
  let url = new URL(href);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowed(url)) throw new EditorError(`Not allowed to load ${url.hostname}.`);
    const response = await fetchImpl(url.href, {
      method: 'GET',
      redirect: 'manual',
      headers: { accept },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) throw new EditorError(`Redirect without a destination from ${url.hostname}.`);
      url = new URL(location, url);
      continue;
    }
    return response;
  }
  throw new EditorError('Too many redirects.');
}

async function fetchEditorJson(fetchImpl, path, maxBytes, timeoutMs, notFound) {
  let response;
  try {
    response = await fetchChecked(fetchImpl, `${EDITOR_ORIGIN}${path}`, isEditorUrl, timeoutMs, 'application/json');
  } catch (err) {
    if (err instanceof EditorError) throw err;
    if (err?.name === 'TimeoutError') throw new EditorError('The p5.js Web Editor took too long to answer.');
    throw new EditorError('Could not reach the p5.js Web Editor. Check the internet connection.');
  }
  if (response.status === 404) throw new EditorError(notFound);
  if (response.status === 429) throw new EditorError('The p5.js Web Editor is busy. Try again in a minute.');
  if (!response.ok) throw new EditorError(`The p5.js Web Editor answered with HTTP ${response.status}.`);
  const body = await readCapped(response, maxBytes, 'The answer from the p5.js Web Editor');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new EditorError('The p5.js Web Editor sent something that is not a sketch list.');
  }
}

function safeFileName(name) {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 255
    && name !== '.'
    && name !== '..'
    && !/[/\\\0]/.test(name);
}

function fileId(file) {
  if (typeof file?.id === 'string') return file.id;
  if (typeof file?._id === 'string') return file._id;
  return null;
}

/**
 * The editor stores a sketch as a flat list in which each folder names its
 * children by id, starting from a folder called "root". This walks it into
 * paths such as "assets/moon.jpg". Files outside the tree are left out.
 */
function sketchFileEntries(files) {
  const list = Array.isArray(files) ? files : [];
  const byId = new Map();
  for (const file of list) {
    const id = fileId(file);
    if (id) byId.set(id, file);
  }
  const root = list.find((f) => f?.fileType === 'folder' && f?.name === 'root');
  const out = [];
  if (!root) return out;
  const seen = new Set([fileId(root)]);
  const walk = (folder, prefix, depth) => {
    if (depth > MAX_FOLDER_DEPTH) return;
    for (const childId of Array.isArray(folder.children) ? folder.children : []) {
      if (out.length >= MAX_FILES) return;
      const child = byId.get(childId);
      if (!child || seen.has(childId) || !safeFileName(child.name)) continue;
      seen.add(childId);
      const path = prefix ? `${prefix}/${child.name}` : child.name;
      if (child.fileType === 'folder') {
        walk(child, path, depth + 1);
      } else {
        out.push({
          path,
          content: typeof child.content === 'string' ? child.content : '',
          url: typeof child.url === 'string' && child.url ? child.url : undefined,
        });
      }
    }
  };
  walk(root, '', 0);
  return out;
}

/** The `src` of each <script> in a page, in order. */
function scriptSources(html) {
  const out = [];
  const re = /<script\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match;
  while ((match = re.exec(String(html ?? ''))) && out.length < 32) {
    out.push((match[1] ?? match[2] ?? match[3] ?? '').trim());
  }
  return out;
}

function isoDate(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
}

function summarizeProject(project) {
  const entries = sketchFileEntries(project?.files);
  const index = entries.find((e) => e.path.toLowerCase() === 'index.html');
  return {
    id: String(project?.id ?? project?._id ?? ''),
    name: typeof project?.name === 'string' && project.name.trim() ? project.name.trim() : 'Untitled sketch',
    createdAt: isoDate(project?.createdAt),
    updatedAt: isoDate(project?.updatedAt),
    scripts: index ? scriptSources(index.content) : [],
    files: entries.length,
    assets: entries.filter((e) => e.url).length,
  };
}

/** A username's public sketches, newest first, without their file contents. */
async function listSketches(usernameValue, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const username = checkUsername(usernameValue);
    const json = await fetchEditorJson(
      fetchImpl,
      `/editor/${encodeURIComponent(username)}/projects`,
      LIST_MAX_BYTES,
      LIST_TIMEOUT_MS,
      `There is no p5.js Web Editor user called "${username}".`,
    );
    const projects = Array.isArray(json?.projects) ? json.projects : Array.isArray(json) ? json : [];
    const sketches = projects
      .map(summarizeProject)
      .filter((s) => SKETCH_ID_RE.test(s.id))
      .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? '') || 0);
    return { ok: true, username, sketches };
  } catch (err) {
    return { ok: false, reason: err instanceof EditorError ? err.message : 'Could not read the sketch list.' };
  }
}

async function runLimited(items, limit, task) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index], index);
    }
  });
  await Promise.all(workers);
}

async function downloadAsset(fetchImpl, href) {
  const response = await fetchChecked(
    fetchImpl,
    href,
    (url) => isAllowedAssetUrl(url.href),
    ASSET_TIMEOUT_MS,
    '*/*',
  );
  if (!response.ok) throw new EditorError(`HTTP ${response.status}`);
  const data = await readCapped(response, ASSET_MAX_BYTES, 'The file');
  const mime = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  return { data, mime };
}

/**
 * One public sketch with its files. Text files carry their text; uploaded
 * files carry their bytes (base64) when they could be downloaded, otherwise
 * their URL and the reason they stayed remote.
 */
async function getSketch(usernameValue, idValue, { fetchImpl = globalThis.fetch } = {}) {
  try {
    const username = checkUsername(usernameValue);
    const id = checkSketchId(idValue);
    const project = await fetchEditorJson(
      fetchImpl,
      `/editor/${encodeURIComponent(username)}/projects/${encodeURIComponent(id)}`,
      SKETCH_MAX_BYTES,
      SKETCH_TIMEOUT_MS,
      'That sketch does not exist, or it is private. Private sketches import from a downloaded zip.',
    );
    const author = typeof project?.user?.username === 'string' && USERNAME_RE.test(project.user.username)
      ? project.user.username
      : username;
    const entries = sketchFileEntries(project?.files);
    const files = new Array(entries.length);
    let downloaded = 0;
    await runLimited(entries, ASSET_CONCURRENCY, async (entry, index) => {
      if (!entry.url) {
        files[index] = { path: entry.path, text: entry.content };
        return;
      }
      const name = entry.path.split('/').pop() ?? '';
      if (P5_LIBRARY_FILE.test(name)) {
        files[index] = { path: entry.path, url: entry.url, remote: 'library' };
        return;
      }
      if (!isAllowedAssetUrl(entry.url)) {
        files[index] = { path: entry.path, url: entry.url, remote: 'host' };
        return;
      }
      try {
        const { data, mime } = await downloadAsset(fetchImpl, entry.url);
        if (downloaded + data.length > ASSETS_TOTAL_MAX_BYTES) {
          files[index] = { path: entry.path, url: entry.url, remote: 'size' };
          return;
        }
        downloaded += data.length;
        files[index] = { path: entry.path, base64: data.toString('base64'), mime: mime || undefined };
      } catch (err) {
        const tooLarge = err instanceof EditorError && /too large/.test(err.message);
        files[index] = { path: entry.path, url: entry.url, remote: tooLarge ? 'size' : 'failed' };
      }
    });
    return {
      ok: true,
      sketch: {
        id,
        name: typeof project?.name === 'string' && project.name.trim() ? project.name.trim() : 'Untitled sketch',
        author,
        url: `${EDITOR_ORIGIN}/${encodeURIComponent(author)}/sketches/${encodeURIComponent(id)}`,
        createdAt: isoDate(project?.createdAt),
        updatedAt: isoDate(project?.updatedAt),
        files,
      },
    };
  } catch (err) {
    return { ok: false, reason: err instanceof EditorError ? err.message : 'Could not read the sketch.' };
  }
}

module.exports = {
  ASSET_HOSTS,
  ASSET_MAX_BYTES,
  ASSETS_TOTAL_MAX_BYTES,
  isAllowedAssetUrl,
  sketchFileEntries,
  scriptSources,
  summarizeProject,
  listSketches,
  getSketch,
};
