'use strict';
const fs = require('fs/promises');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const { findMediaInFolder } = require('./media-locate.cjs');
const REF_FIELDS = new Set(['_assetRef', '_textureAssetRef', '_sourceAssetRef', 'assetRef']);
const MEDIA_FIELDS = ['src', 'mediaSrc', 'modelData', 'filePath', 'texturePath', 'sourceUrl', 'assetUrl', 'url'];
// Files that ship inside the app (the shader library, built-in pages, looks)
// are relative to the app, and a bare word is a source keyword (a Performer
// clip's "performer"): neither is a file in the project.
const APP_PATH = /^(?:\.\/)?(?:ISF|threejs|looks|lib|fonts|mediapipe)\//;
const appOwned = value => APP_PATH.test(value) || !/[\\/.]/.test(value);
// How far above the project folder a saved relative location may reach.
const MAX_RELATIVE_UP = 3;
// Looking for moved files by name when a project opens.
const OPEN_SEARCH = { maxDepth: 6, maxEntries: 30000 };
function localPath(value, projectDir) {
  if (typeof value !== 'string' || !value) return null;
  if (/^[\s]*[\[{]/.test(value)) return null;
  try {
    if (/^ghost-asset:\/\/localhost\//.test(value)) value = fileURLToPath(value.replace('ghost-asset://localhost', 'file://'));
    else if (/^file:/i.test(value)) value = fileURLToPath(value);
    else if (/^[a-z][a-z0-9+.-]+:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
  } catch { return null; }
  // A path from another platform is still a missing asset, never a relative path.
  if (/^[a-z]:[\\/]/i.test(value) && process.platform !== 'win32') return value;
  if (path.isAbsolute(value)) return path.normalize(value);
  if (appOwned(value)) return null;
  if (projectDir) return path.resolve(projectDir, value);
  return null;
}
/** The file name a reference was saved with, for finding it again. */
function fileNameOf(entry) {
  return path.basename(entry.candidates[0] || entry.name || '');
}
function refId(ref) { return JSON.stringify([ref.projectPath || '', ref.originalPath || '', ref.url || '', ref.name || '']); }
function mediaEntries(data, projectDir) {
  const entries = new Map();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const key of REF_FIELDS) {
      const ref = node[key];
      if (!ref || typeof ref !== 'object') continue;
      if (!ref.projectPath && !ref.originalPath && (ref.dataUrl || (ref.url && !ref.url.startsWith('blob:')))) continue;
      const id = refId(ref);
      const entry = entries.get(id) || { id, name: ref.name || path.basename(ref.originalPath || ref.projectPath || 'Missing media'), candidates: [], refs: [], fields: [] };
      // Beside the project first (so a moved show folder works), then where
      // the file was saved from.
      const nearby = projectDir ? [ref.projectPath, ref.relativePath].map(value => value ? localPath(value, projectDir) : null) : [];
      for (const candidate of [...nearby, localPath(ref.originalPath)]) {
        if (candidate && !entry.candidates.includes(candidate)) entry.candidates.push(candidate);
      }
      entry.refs.push(ref); entries.set(id, entry);
    }
    for (const field of MEDIA_FIELDS) {
      const refKey = field === 'texturePath' ? '_textureAssetRef' : field === 'sourceUrl' ? '_sourceAssetRef' : ['assetUrl', 'url'].includes(field) ? 'assetRef' : '_assetRef';
      if (node[refKey]) continue;
      const candidate = localPath(node[field], projectDir);
      const transient = typeof node[field] === 'string' && node[field].startsWith('blob:');
      if (!candidate && !transient) continue;
      const id = 'legacy:' + (candidate || node[field]);
      const entry = entries.get(id) || { id, name: node.name || path.basename(candidate || 'Unsaved media'), candidates: candidate ? [candidate] : [], refs: [], fields: [] };
      entry.fields.push({ node, field }); entries.set(id, entry);
    }
    for (const [key, value] of Object.entries(node)) if (!REF_FIELDS.has(key)) visit(value);
  };
  visit(data); return [...entries.values()];
}
/** Point every use of a media entry at `file`. */
function pointAt(entry, file, size, projectDir) {
  for (const ref of entry.refs) {
    ref.kind = 'local-file'; ref.originalPath = file; ref.name = path.basename(file);
    if (size !== undefined) ref.size = size;
    delete ref.projectPath; delete ref.relativePath; delete ref.dataUrl; delete ref.url;
    const relative = projectDir ? path.relative(projectDir, file) : null;
    if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) {
      ref.kind = 'project-file'; ref.projectPath = './' + relative.split(path.sep).join('/');
    }
  }
  for (const { node, field } of entry.fields) node[field] = pathToFileURL(file).href;
}
async function existingFile(candidates) {
  for (const candidate of candidates) {
    try { const stat = await fs.stat(candidate); if (stat.isFile()) return { path: candidate, size: stat.size }; } catch {}
  }
  return null;
}
async function scanProjectMedia(data, projectDir) {
  const results = [];
  for (const entry of mediaEntries(data, projectDir)) {
    const found = await existingFile(entry.candidates);
    results.push({ id: entry.id, name: entry.name, path: found?.path || entry.candidates[0] || '', size: found?.size || 0, missing: !found, uses: entry.refs.length + entry.fields.length });
  }
  return results;
}
async function relinkProjectMedia(data, projectDir, id, replacementPath) {
  if (!path.isAbsolute(replacementPath)) throw new Error('Choose a local file.');
  const found = await existingFile([replacementPath]);
  if (!found) throw new Error('Replacement file is not available.');
  const entry = mediaEntries(data, projectDir).find(item => item.id === id);
  if (!entry) throw new Error('This media reference changed. Refresh the list and try again.');
  pointAt(entry, replacementPath, found.size, projectDir);
  return data;
}
/**
 * After one file was located in `dir`, look there (and in its folders) for
 * every other missing file and point their uses at what was found: a show
 * whose media folder moved is relinked in one go. Returns the files found.
 */
async function relinkMissingInFolder(data, projectDir, dir) {
  const missing = [];
  for (const entry of mediaEntries(data, projectDir)) {
    if (entry.candidates.length && !(await existingFile(entry.candidates))) missing.push(entry);
  }
  if (!missing.length || !dir) return [];
  const found = await findMediaInFolder(dir, [...new Set(missing.map(fileNameOf))], { maxDepth: 3 });
  const files = [];
  for (const entry of missing) {
    const file = found[fileNameOf(entry)];
    if (!file) continue;
    const stat = await existingFile([file]);
    if (!stat) continue;
    pointAt(entry, file, stat.size, projectDir);
    files.push(file);
  }
  return files;
}
/**
 * Make a project that is being opened point at files that are there. Each
 * reference is tried beside the project, then where it was saved from, and
 * a file that is in neither place is looked for by name inside the
 * project's folder. A reference that is found keeps that one location (Save
 * writes the portable ones again); one that is not keeps what it had for
 * Project Media to show. Returns what moved and what is missing.
 */
async function prepareProjectMediaForOpen(data, projectDir) {
  const entries = mediaEntries(data, projectDir);
  const found = await Promise.all(entries.map(entry => existingFile(entry.candidates)));
  const lost = entries.filter((entry, index) => !found[index] && entry.candidates.length);
  const moved = [];
  if (projectDir && lost.length) {
    const hits = await findMediaInFolder(projectDir, [...new Set(lost.map(fileNameOf))], OPEN_SEARCH);
    for (const entry of lost) {
      const file = hits[fileNameOf(entry)];
      const stat = file ? await existingFile([file]) : null;
      if (stat) { found[entries.indexOf(entry)] = stat; moved.push(entry.name); }
    }
  }
  const missing = [];
  entries.forEach((entry, index) => {
    const file = found[index]?.path;
    if (!file) {
      if (entry.candidates.length) missing.push(entry.name);
      // Keep an absolute location so a Save As elsewhere can still place it.
      for (const ref of entry.refs) if (!ref.originalPath && entry.candidates[0]) ref.originalPath = entry.candidates[0];
      return;
    }
    for (const ref of entry.refs) {
      ref.originalPath = file;
      delete ref.projectPath; delete ref.relativePath;
      if (ref.kind === 'project-file') ref.kind = 'local-file';
    }
    for (const { node, field } of entry.fields) {
      if (localPath(node[field], projectDir) !== file) node[field] = pathToFileURL(file).href;
    }
  });
  return { moved, missing };
}
/**
 * Before a save: next to each file's absolute location, write where it is
 * from the project file's folder, so the show still opens after the folder
 * (with its media) is moved, copied to another computer or renamed.
 * `projectPath` (inside the folder) is read by every version; files above
 * the folder get `relativePath`, which older versions ignore.
 */
function makeProjectPortable(data, projectDir) {
  if (!projectDir) return data;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const key of REF_FIELDS) {
      const ref = node[key];
      if (!ref || typeof ref !== 'object' || typeof ref.originalPath !== 'string') continue;
      const file = localPath(ref.originalPath);
      if (!file || !path.isAbsolute(file)) continue;
      const relative = path.relative(projectDir, file);
      delete ref.projectPath; delete ref.relativePath;
      if (!relative || path.isAbsolute(relative)) continue;
      const portable = relative.split(path.sep).join('/');
      const up = portable.split('/').filter(part => part === '..').length;
      if (up === 0) ref.projectPath = './' + portable;
      else if (up <= MAX_RELATIVE_UP) ref.relativePath = portable;
    }
    for (const [key, value] of Object.entries(node)) if (!REF_FIELDS.has(key)) visit(value);
  };
  visit(data);
  return data;
}
// ── Packing a show's media (Collect beside a new project, Export Package) ──
// Files keep their own names; a different file with a taken name becomes
// "name (2).ext". A model that loads files from beside itself (a .gltf's
// buffers and textures, an .obj's materials and theirs) gets a folder with
// those files at the same places, so it loads as it did.
const SAFE_NAME = /[<>:"/\\|?*\x00-\x1f]/g;
const GENERIC_FONTS = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial']);
async function gltfDependencies(file) {
  const json = JSON.parse(await fs.readFile(file, 'utf8'));
  return [...(json.buffers || []), ...(json.images || [])]
    .map(item => item && item.uri)
    .filter(uri => typeof uri === 'string' && uri && !/^[a-z][a-z0-9+.-]*:/i.test(uri))
    .map(uri => { try { return decodeURIComponent(uri); } catch { return uri; } });
}
async function objDependencies(file) {
  const libraries = [];
  for (const line of (await fs.readFile(file, 'utf8')).split(/\r?\n/)) {
    const match = /^\s*mtllib\s+(.+?)\s*$/.exec(line);
    if (match) libraries.push(match[1]);
  }
  const textures = [];
  for (const library of libraries) {
    let text;
    try { text = await fs.readFile(path.resolve(path.dirname(file), library.replace(/\\/g, '/')), 'utf8'); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      // Options come before the file name: the file is the last word.
      const match = /^\s*(map_\w+|bump|disp|decal|refl|norm)\s+(.+?)\s*$/i.exec(line);
      if (match) textures.push(match[2].split(/\s+/).pop());
    }
  }
  return [...libraries, ...textures];
}
const DEPENDENCY_READERS = { '.gltf': gltfDependencies, '.obj': objDependencies };
/** Files a model loads from beside itself: those inside its folder, and the names of any outside it. */
async function modelDependencies(file) {
  const read = DEPENDENCY_READERS[path.extname(file).toLowerCase()];
  const inside = [], outside = [];
  if (!read) return { inside, outside };
  let names = [];
  try { names = await read(file); } catch { return { inside, outside }; }
  const dir = path.dirname(file);
  for (const name of new Set(names)) {
    const absolute = path.resolve(dir, name.replace(/\\/g, '/'));
    const relative = path.relative(dir, absolute);
    if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) outside.push(name);
    else inside.push({ relative: relative.split(path.sep).join('/'), absolute });
  }
  return { inside, outside };
}
/** Font families the show names. They are not packed: they have to be installed. */
function fontsUsed(data) {
  const fonts = new Set();
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    for (const [key, value] of Object.entries(node)) {
      if (/^font(Family)?$/i.test(key) && typeof value === 'string') {
        for (const family of value.split(',')) {
          const name = family.trim().replace(/^["']|["']$/g, '');
          if (name && !GENERIC_FONTS.has(name.toLowerCase())) fonts.add(name);
        }
      } else visit(value);
    }
  };
  visit(data);
  return [...fonts].sort();
}
/**
 * Decide where every media file of a show goes under `folder` in a packed
 * copy, and point the project at those places (relative to the packed
 * project file). Returns the files to copy, what could not be packed, and
 * the fonts the show needs installed.
 */
async function planPackedMedia(data, projectDir, folder = 'Media') {
  const files = [];
  const placed = new Map();
  const taken = new Set();
  const missing = [];
  const unique = name => {
    const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };
  for (const entry of mediaEntries(data, projectDir)) {
    const found = await existingFile(entry.candidates);
    if (!found) { missing.push(entry.name); continue; }
    let key;
    try { key = await fs.realpath(found.path); } catch { key = found.path; }
    let target = placed.get(key);
    if (!target) {
      const name = path.basename(found.path).replace(SAFE_NAME, '_');
      const dependencies = await modelDependencies(found.path);
      if (dependencies.inside.length || dependencies.outside.length) {
        const own = `${folder}/${unique(name.slice(0, name.length - path.extname(name).length) || 'Model')}`;
        target = `${own}/${name}`;
        files.push({ source: found.path, target, size: found.size });
        for (const dependency of dependencies.inside) {
          const stat = await existingFile([dependency.absolute]);
          if (stat) files.push({ source: dependency.absolute, target: `${own}/${dependency.relative}`, size: stat.size });
          else missing.push(`${dependency.relative} (used by ${name})`);
        }
        for (const outside of dependencies.outside) missing.push(`${outside} (outside the folder of ${name})`);
      } else {
        target = `${folder}/${unique(name)}`;
        files.push({ source: found.path, target, size: found.size });
      }
      placed.set(key, target);
    }
    for (const ref of entry.refs) {
      ref.kind = 'project-file'; ref.projectPath = './' + target;
      delete ref.originalPath; delete ref.relativePath;
    }
    for (const { node, field } of entry.fields) node[field] = './' + target;
  }
  return { files, missing, fonts: fontsUsed(data) };
}
async function exists(target) {
  try { await fs.stat(target); return true; } catch { return false; }
}
/**
 * Collect: a new project file with every media file copied into a "Media"
 * folder beside it ("Media 2"… when taken). Files that cannot be found are
 * listed, not packed; the copy is still written.
 */
async function collectProjectMedia(data, projectDir, outputPath) {
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.gha') throw new Error('Choose a .gha project filename.');
  if (await exists(outputPath)) throw new Error('Choose a new filename; an existing project will not be overwritten.');
  const parent = path.dirname(outputPath);
  await fs.mkdir(parent, { recursive: true });
  let folderName = 'Media';
  for (let n = 2; await exists(path.join(parent, folderName)); n++) folderName = `Media ${n}`;
  const plan = await planPackedMedia(data, projectDir, folderName);
  const folder = path.join(parent, folderName);
  await fs.mkdir(folder);
  let published = false;
  try {
    for (const file of plan.files) {
      const destination = path.join(parent, ...file.target.split('/'));
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(file.source, destination, fs.constants.COPYFILE_EXCL);
    }
    // Exclusive create means another save cannot be silently overwritten.
    const handle = await fs.open(outputPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync(); published = true;
    } catch (error) { await handle.close(); await fs.unlink(outputPath); throw error; }
    await handle.close();
    return { outputPath, mediaFolder: folder, filesCopied: plan.files.length, missing: plan.missing, fonts: plan.fonts };
  } finally { if (!published) await fs.rm(folder, { recursive: true, force: true }); }
}
module.exports = {
  mediaEntries, scanProjectMedia, relinkProjectMedia, relinkMissingInFolder, collectProjectMedia,
  prepareProjectMediaForOpen, makeProjectPortable, planPackedMedia, modelDependencies,
};
