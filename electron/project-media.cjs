'use strict';
const fs = require('fs/promises');
const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');
const crypto = require('crypto');
const REF_FIELDS = new Set(['_assetRef', '_textureAssetRef', '_sourceAssetRef', 'assetRef']);
const MEDIA_FIELDS = ['src', 'mediaSrc', 'modelData', 'filePath', 'texturePath', 'sourceUrl', 'assetUrl', 'url'];
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
  if (projectDir) return path.resolve(projectDir, value);
  return null;
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
      for (const candidate of [ref.projectPath && projectDir ? localPath(ref.projectPath, projectDir) : null, localPath(ref.originalPath)]) {
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
  for (const ref of entry.refs) {
    ref.kind = 'local-file'; ref.originalPath = replacementPath; ref.name = path.basename(replacementPath); ref.size = found.size;
    delete ref.projectPath; delete ref.dataUrl; delete ref.url;
    const relative = projectDir ? path.relative(projectDir, replacementPath) : null;
    if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep)) {
      ref.kind = 'project-file'; ref.projectPath = './' + relative.split(path.sep).join('/');
    }
  }
  for (const { node, field } of entry.fields) node[field] = pathToFileURL(replacementPath).href;
  return data;
}
async function collectProjectMedia(data, projectDir, outputPath) {
  if (!path.isAbsolute(outputPath) || path.extname(outputPath).toLowerCase() !== '.gha') throw new Error('Choose a .gha project filename.');
  try { await fs.stat(outputPath); throw new Error('Choose a new filename; an existing project will not be overwritten.'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const entries = mediaEntries(data, projectDir);
  const sources = new Map();
  for (const entry of entries) {
    const found = await existingFile(entry.candidates);
    if (!found) throw new Error(`Locate missing media before collecting: ${entry.name}`);
    // External model/playlist dependencies need their own dependency collector.
    if (['.gltf', '.obj', '.mtl', '.m3u8'].includes(path.extname(found.path).toLowerCase())) throw new Error(`Collect does not yet include external dependencies for ${entry.name}. Use a self-contained media file first.`);
    sources.set(entry.id, found.path);
  }
  const parent = path.dirname(outputPath);
  await fs.mkdir(parent, { recursive: true });
  const folder = await fs.mkdtemp(path.join(parent, 'Media-'));
  const copied = new Map();
  let published = false;
  try {
    for (const entry of entries) {
      const source = sources.get(entry.id), canonical = await fs.realpath(source);
      let filename = copied.get(canonical);
      if (!filename) {
        const safeName = path.basename(source).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        filename = crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 12) + '-' + safeName;
        await fs.copyFile(source, path.join(folder, filename), fs.constants.COPYFILE_EXCL);
        copied.set(canonical, filename);
      }
      const relative = './' + path.basename(folder) + '/' + filename;
      for (const ref of entry.refs) {
        ref.kind = 'project-file'; ref.projectPath = relative;
        delete ref.originalPath;
      }
      for (const { node, field } of entry.fields) node[field] = relative;
    }
    // Exclusive create means another save cannot be silently overwritten.
    const handle = await fs.open(outputPath, 'wx');
    try {
      await handle.writeFile(JSON.stringify(data, null, 2), 'utf8');
      await handle.sync(); published = true;
    } catch (error) { await handle.close(); await fs.unlink(outputPath); throw error; }
    await handle.close();
    return { outputPath, mediaFolder: folder, filesCopied: copied.size };
  } finally { if (!published) await fs.rm(folder, { recursive: true, force: true }); }
}
module.exports = { mediaEntries, scanProjectMedia, relinkProjectMedia, collectProjectMedia };
