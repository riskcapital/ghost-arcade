'use strict';
// Which disk paths the renderer may write, copy to, or read back.
//
// The renderer is not trusted with the whole disk. A path is usable only when
// the main process learned it from the user: a native open/save dialog, a file
// the user picked or dropped (preload's getPathForFile), a project file the
// main process read, or one of the app's own asset folders. Media that a
// project file refers to is readable too, but only by media file type, so a
// forged project cannot name a key or a config file.
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const PROJECT_EXTENSIONS = new Set(['.gha', '.shrnk', '.json']);
const MEDIA_EXTENSIONS = new Set([
  // video
  '.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.wmv', '.flv', '.mpg', '.mpeg', '.mts', '.m2ts', '.ts', '.3gp', '.ogv', '.mxf', '.hap',
  // image
  '.png', '.jpg', '.jpeg', '.jfif', '.gif', '.webp', '.avif', '.bmp', '.tif', '.tiff', '.svg', '.ico', '.heic', '.heif', '.exr', '.hdr', '.tga', '.dds', '.ktx', '.ktx2', '.psd',
  // audio
  '.mp3', '.wav', '.ogg', '.oga', '.flac', '.aac', '.m4a', '.aif', '.aiff', '.opus', '.wma', '.mid', '.midi',
  // 3D models, splats, point clouds
  '.glb', '.gltf', '.bin', '.obj', '.mtl', '.fbx', '.stl', '.ply', '.splat', '.ksplat', '.spz', '.sog', '.usdz', '.dae', '.3ds',
  // looks, fonts, shaders, vector animation
  '.cube', '.ttf', '.otf', '.woff', '.woff2', '.fs', '.vs', '.frag', '.vert', '.glsl', '.isf', '.wgsl', '.lottie', '.milk', '.html', '.htm', '.dmfx',
]);
const REF_FIELDS = ['_assetRef', '_textureAssetRef', '_sourceAssetRef', 'assetRef'];
const MEDIA_FIELDS = ['src', 'mediaSrc', 'modelData', 'filePath', 'texturePath', 'sourceUrl', 'assetUrl', 'url', 'thumbnail'];
const PERSIST_LIMIT = 20000;

function createPathGrants({ assetDirs = [], storePath = null, platform = process.platform } = {}) {
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  const caseless = platform === 'win32';

  /** Normalized absolute path, or null when the value cannot be one. */
  function canon(value) {
    if (typeof value !== 'string' || !value || value.includes('\0')) return null;
    if (!pathApi.isAbsolute(value)) return null;
    // Refuse traversal outright instead of resolving it: no caller builds one.
    if (value.split(/[\\/]/).includes('..')) return null;
    const resolved = pathApi.normalize(value).replace(/[\\/]+$/, '') || pathApi.sep;
    return caseless ? resolved.toLowerCase() : resolved;
  }
  function isInside(dir, target) {
    if (target === dir) return true;
    return target.startsWith(dir.endsWith(pathApi.sep) ? dir : dir + pathApi.sep);
  }

  const fixedDirs = assetDirs.map(canon).filter(Boolean);
  const writeFiles = new Set();
  const writeDirs = new Set();
  const readFiles = new Set();
  const readDirs = new Set();
  // Kept across launches: the renderer remembers these paths itself (recent
  // files, the autosave, the media library) and comes back with them.
  const projectFiles = new Set();
  const persistedReads = new Set();
  let saveTimer = null;

  function load() {
    if (!storePath) return;
    try {
      const stored = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      for (const entry of Array.isArray(stored?.projectFiles) ? stored.projectFiles : []) {
        const key = canon(entry);
        if (key) projectFiles.add(key);
      }
      for (const entry of Array.isArray(stored?.readFiles) ? stored.readFiles : []) {
        const key = canon(entry);
        if (key) persistedReads.add(key);
      }
    } catch { /* first run, or an unreadable store: start empty */ }
  }
  function trim(set) {
    while (set.size > PERSIST_LIMIT) set.delete(set.values().next().value);
  }
  function flush() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!storePath) return;
    try {
      fs.mkdirSync(path.dirname(storePath), { recursive: true });
      fs.writeFileSync(storePath, JSON.stringify({ projectFiles: [...projectFiles], readFiles: [...persistedReads] }), 'utf8');
    } catch { /* the grants still hold for this launch */ }
  }
  function scheduleSave() {
    if (!storePath || saveTimer) return;
    saveTimer = setTimeout(flush, 500);
    saveTimer.unref?.();
  }
  function remember(set, key) {
    if (set.has(key)) return;
    set.add(key);
    trim(set);
    scheduleSave();
  }

  function isProjectFile(key) {
    return PROJECT_EXTENSIONS.has(pathApi.extname(key).toLowerCase());
  }

  /** A file the user picked, dropped, or opened: readable from now on. */
  function allowRead(value) {
    const key = canon(value);
    if (!key) return false;
    remember(persistedReads, key);
    return true;
  }
  /** A folder the user picked to read from (an image sequence). */
  function allowReadDir(value) {
    const key = canon(value);
    if (!key) return false;
    readDirs.add(key);
    return true;
  }
  /** A file the user named in a save dialog. Project files stay writable across launches. */
  function allowWriteFile(value) {
    const key = canon(value);
    if (!key) return false;
    if (isProjectFile(key)) remember(projectFiles, key);
    else writeFiles.add(key);
    return true;
  }
  /** A folder the user picked to export into, or a temp folder the main process made. */
  function allowWriteDir(value) {
    const key = canon(value);
    if (!key) return false;
    writeDirs.add(key);
    return true;
  }

  function canWrite(value) {
    const key = canon(value);
    if (!key) return false;
    if (writeFiles.has(key) || projectFiles.has(key)) return true;
    for (const dir of fixedDirs) if (isInside(dir, key)) return true;
    for (const dir of writeDirs) if (isInside(dir, key)) return true;
    return false;
  }
  function canRead(value) {
    const key = canon(value);
    if (!key) return false;
    if (readFiles.has(key) || persistedReads.has(key)) return true;
    for (const dir of readDirs) if (isInside(dir, key)) return true;
    return canWrite(key);
  }

  function mediaPath(value, projectDir) {
    if (typeof value !== 'string' || !value || value.length > 4096) return null;
    let candidate = value;
    try {
      if (/^ghost-asset:\/\/localhost\//i.test(candidate)) candidate = fileURLToPath(candidate.replace(/^ghost-asset:\/\/localhost/i, 'file://'));
      else if (/^file:/i.test(candidate)) candidate = fileURLToPath(candidate);
      else if (/^[a-z][a-z0-9+.-]+:/i.test(candidate) && !/^[a-z]:[\\/]/i.test(candidate)) return null;
    } catch { return null; }
    if (!pathApi.isAbsolute(candidate)) {
      if (!projectDir) return null;
      candidate = pathApi.join(projectDir, candidate);
    }
    const key = canon(candidate);
    if (!key || !MEDIA_EXTENSIONS.has(pathApi.extname(key).toLowerCase())) return null;
    return key;
  }
  /** Make the media a project refers to readable. Returns how many paths it found. */
  function registerProjectData(data, projectDir) {
    const dir = projectDir ? canon(projectDir) : null;
    let found = 0;
    const add = value => {
      const key = mediaPath(value, dir);
      if (!key) return;
      found++;
      remember(persistedReads, key);
    };
    const visit = (node, depth) => {
      if (!node || typeof node !== 'object' || depth > 64) return;
      if (Array.isArray(node)) { for (const item of node) visit(item, depth + 1); return; }
      for (const field of REF_FIELDS) {
        const ref = node[field];
        if (!ref || typeof ref !== 'object') continue;
        add(ref.originalPath);
        add(ref.projectPath);
        add(ref.url);
      }
      for (const field of MEDIA_FIELDS) add(node[field]);
      for (const value of Object.values(node)) visit(value, depth + 1);
    };
    visit(data, 0);
    return found;
  }
  /**
   * A project file the user opened or the main process read. It becomes
   * writable (Save writes back to it) and its media becomes readable.
   */
  function registerProjectFile(value, content) {
    const key = canon(value);
    if (!key || !isProjectFile(key)) return false;
    remember(projectFiles, key);
    try {
      const text = typeof content === 'string' ? content : fs.readFileSync(value, 'utf8');
      registerProjectData(JSON.parse(text), pathApi.dirname(key));
    } catch { /* not a readable project: nothing to register */ }
    return true;
  }
  /** A path from preload's getPathForFile: a file the user picked or dropped. */
  function registerPickedFile(value) {
    const key = canon(value);
    if (!key) return false;
    remember(persistedReads, key);
    if (isProjectFile(key)) registerProjectFile(value);
    return true;
  }

  load();
  return {
    allowRead, allowReadDir, allowWriteFile, allowWriteDir,
    canRead, canWrite,
    registerProjectData, registerProjectFile, registerPickedFile,
    flush,
  };
}

module.exports = { createPathGrants, MEDIA_EXTENSIONS, PROJECT_EXTENSIONS };
