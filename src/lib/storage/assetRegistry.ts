// Unified asset reference + resolver
//
// Why this exists:
//   The renderer used to store a transient runtime URL (blob:, data:, file://,
//   './sibling.mp4', etc.) directly on every layer's `src` / `modelData` /
//   `filePath` field and trust it for both runtime AND persistence. That broke
//   in three ways:
//
//   1) `blob:` URLs die at session end — saving a project that only knew the
//      blob URL meant on reload the layer's src was a dead reference.
//   2) `materializeBlobsInProject` clobbered the original src with `./filename`
//      so even the in-memory project lost the original disk path the user
//      picked it from. After save, autosave snapshots couldn't recover the
//      original location either.
//   3) Different content types used different field names (src, modelData,
//      filePath, texturePath) and different capture paths captured different
//      info — splats/3D-models grabbed `getPathForFile`, images mostly didn't.
//      Result: depending on which import site you used, the same media might
//      or might not survive save/reload.
//
// AssetRef is the single durable identity for any media file. Callers attach
// it as `_assetRef` (and `_textureAssetRef` for splat textures) alongside the
// runtime `src`/`modelData`/etc. The runtime URL is recomputed on each load
// from the AssetRef using `resolveAssetRefForRuntime`.

import { writable, type Writable } from 'svelte/store';

export type AssetKind = 'local-file' | 'project-file' | 'embedded' | 'url';

export interface AssetRef {
  kind: AssetKind;
  // Absolute disk path where the user originally picked the file (Electron
  // only — webUtils.getPathForFile). Survives across sessions on the same
  // machine even without a Save As copy.
  originalPath?: string;
  // Path relative to the .gha file, set at Save time when the asset is copied
  // alongside as a portable sibling. Tried first on reload because it
  // survives moving the project to another machine.
  projectPath?: string;
  // Inline base64 — only used for tiny assets (textures < 1MB). Heavy media
  // never embeds.
  dataUrl?: string;
  // Remote URL (http/https). Pass-through.
  url?: string;
  // Display name + filename hint when materializing to a sibling file.
  name?: string;
  mime?: string;
  size?: number;
  lastModified?: number;
}

export interface CapturedAsset {
  assetRef: AssetRef;
  runtimeUrl: string;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/**
 * Capture an AssetRef + a fresh runtime URL from a freshly picked File.
 * In Electron this captures the absolute disk path so reload works without
 * relying on the .gha sibling-copy (and even without saving at all).
 *
 * The returned `runtimeUrl` is a `blob:` URL the caller can hand to <video>,
 * <img>, Three.js loaders, etc. immediately.
 */
export function createAssetRefFromFile(file: File): CapturedAsset {
  const w = window as any;
  const electronPath: string | null = w.electronAPI?.getPathForFile?.(file) || null;
  const blob = URL.createObjectURL(file);
  const ref: AssetRef = {
    kind: electronPath ? 'local-file' : 'embedded',
    originalPath: electronPath || undefined,
    name: file.name,
    mime: file.type || undefined,
    size: file.size,
    lastModified: file.lastModified,
  };
  return { assetRef: ref, runtimeUrl: blob };
}

/**
 * Capture a durable AssetRef for media generated inside Ghost Arcade.
 *
 * User-picked files can use webUtils.getPathForFile, but AI videos, looped
 * clips, and recordings start life as in-memory Blobs. In Electron we persist
 * those blobs once into the app's managed project-assets folder and save that
 * disk path in the project. In browser builds, fall back to data URLs so the
 * file remains self-contained.
 */
export async function createAssetRefFromGeneratedBlob(
  blob: Blob,
  name: string,
  mime?: string,
  existingRuntimeUrl?: string,
): Promise<CapturedAsset> {
  const runtimeUrl = existingRuntimeUrl || URL.createObjectURL(blob);
  const baseRef: AssetRef = {
    kind: 'embedded',
    name,
    mime: mime || blob.type || undefined,
    size: blob.size,
    lastModified: Date.now(),
  };

  const w = window as any;
  if (w.__ELECTRON__ && w.electronAPI?.invoke) {
    try {
      const bytes = await blob.arrayBuffer();
      const result = await w.electronAPI.invoke('save_generated_asset', {
        filename: name,
        mime: baseRef.mime,
        bytes,
      });
      if (result?.success && result.path) {
        return {
          runtimeUrl,
          assetRef: {
            ...baseRef,
            kind: 'local-file',
            originalPath: result.path,
          },
        };
      }
      console.warn('[AssetRef] save_generated_asset failed:', result?.error || 'unknown error');
    } catch (err) {
      console.warn('[AssetRef] Failed to persist generated asset:', err);
    }
  }

  try {
    return {
      runtimeUrl,
      assetRef: {
        ...baseRef,
        kind: 'embedded',
        dataUrl: await blobToDataUrl(blob),
      },
    };
  } catch (err) {
    console.warn('[AssetRef] Failed to embed generated asset:', err);
    return { runtimeUrl, assetRef: baseRef };
  }
}

/**
 * Rebuild runtime URLs from AssetRefs anywhere in an arbitrary object tree.
 *
 * The project import path resolves each known field explicitly, but several
 * subtrees are copied through wholesale — stage presets, SV keyboard presets,
 * global presets in localStorage. Those hold the same layer/media shapes, and
 * because save-time blob-stripping blanks a runtime URL whenever an AssetRef
 * exists, a tree that never gets resolved comes back with empty `src` fields
 * and renders nothing. This walker is the catch-all for those trees.
 *
 * `resolve` lets the caller supply a project-dir-aware resolver (the import
 * path has one, and it also handles legacy relative paths); the default is
 * plain AssetRef resolution with no project directory.
 */
export type AssetFieldResolver = (ref: unknown, currentValue: string) => string;

const ASSET_TREE_FIELDS: Array<[field: string, refKey: string]> = [
  ['src', '_assetRef'],
  ['mediaSrc', '_assetRef'],
  ['modelData', '_assetRef'],
  ['filePath', '_assetRef'],
  ['texturePath', '_textureAssetRef'],
  ['sourceUrl', '_sourceAssetRef'],
  // Projection-sim imported models (ProjectionSimObject).
  ['assetUrl', 'assetRef'],
  ['url', 'assetRef'],
];

export function resolveAssetTreeInPlace(root: unknown, resolve?: AssetFieldResolver): void {
  const resolveField: AssetFieldResolver =
    resolve ?? ((ref, current) => resolveAssetRefForRuntime(ref as AssetRef, undefined, current) ?? current);
  const seen = new WeakSet<object>();
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    for (const [field, refKey] of ASSET_TREE_FIELDS) {
      if (!(field in node)) continue;
      const ref = node[refKey] ?? (refKey === 'assetRef' ? node._assetRef : undefined);
      if (!ref || typeof ref !== 'object') continue;
      const current = typeof node[field] === 'string' ? node[field] : '';
      const resolved = resolveField(ref, current);
      if (resolved) node[field] = resolved;
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(root);
}

/**
 * Convert a Windows or Unix absolute path to a renderer-loadable URL.
 *
 * Why not file://: Chromium blocks file:// in the renderer ("Not allowed
 * to load local resource"), which kills <video> + <img> + fetch on every
 * disk-backed asset. We register a custom `ghost-asset://` scheme in
 * Electron main that resolves back to the disk file via net.fetch,
 * giving us range-request streaming that <video> seek depends on.
 *
 * In the browser build (no custom protocol available), fall back to
 * file:// — the file: input only happens when running outside Electron,
 * in which case the Files API provides blob URLs and this branch is
 * cosmetic / rarely hit.
 */
export function pathToFileUrl(p: string): string {
  let urlPath = p.replace(/\\/g, '/');
  if (!urlPath.startsWith('/')) urlPath = '/' + urlPath;
  const encoded = urlPath
    .replace(/%/g, '%25')
    .replace(/ /g, '%20')
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F');
  // Renderer running inside Electron — use the custom protocol so
  // Chromium's file:// ban doesn't apply.
  if (typeof window !== 'undefined' && (window as any).__ELECTRON__) {
    return 'ghost-asset://localhost' + encoded;
  }
  return 'file://' + encoded;
}

/**
 * Resolve an AssetRef to a runtime URL on reload.
 *
 * Resolution order (each step falls through if it would yield nothing):
 *   1) projectPath relative to projectDir — the portable sibling-file copy
 *   2) originalPath — where the user picked it from on disk
 *   3) dataUrl — embedded asset
 *   4) url — remote URL
 *   5) fallbackSrc — pass-through for legacy projects with no AssetRef
 *
 * Returns null only when nothing in the ref nor the fallback resolved.
 */
export function resolveAssetRefForRuntime(
  ref: AssetRef | undefined | null,
  projectDir: string | undefined,
  fallbackSrc?: string,
): string | null {
  if (ref) {
    if (ref.projectPath && projectDir) {
      const sep = projectDir.includes('\\') ? '\\' : '/';
      const base = projectDir.endsWith(sep) ? projectDir : projectDir + sep;
      const abs = base + ref.projectPath.replace(/^\.\//, '');
      return pathToFileUrl(abs);
    }
    if (ref.originalPath) return pathToFileUrl(ref.originalPath);
    if (ref.dataUrl) return ref.dataUrl;
    if (ref.url) return ref.url;
  }
  // Legacy fallback — relative-path projects from before AssetRef shipped.
  if (fallbackSrc) {
    // Drive letters before schemes: `C:\clip.mp4` looks like one, but a real
    // scheme is two or more characters and a drive is exactly one.
    if (/^[A-Za-z]:[\\/]/.test(fallbackSrc)) return pathToFileUrl(fallbackSrc);
    if (/^file:/i.test(fallbackSrc)) {
      const m = fallbackSrc.match(/^file:\/\/+(.*)$/i);
      if (!m) return fallbackSrc;
      try {
        return pathToFileUrl(decodeURIComponent(m[1]));
      } catch {
        return fallbackSrc;
      }
    }
    /* Any other scheme passes through untouched. Listing only
       https/blob/data/ghost-asset meant `builtin:grid` and `live://webcam/<id>`
       fell through to the projectDir join below and came back as paths to
       files that do not exist. */
    if (/^[A-Za-z][A-Za-z0-9+.-]+:/.test(fallbackSrc)) return fallbackSrc;
    if (fallbackSrc.startsWith('/')) {
      return pathToFileUrl(fallbackSrc);
    }
    if (projectDir) {
      const sep = projectDir.includes('\\') ? '\\' : '/';
      const base = projectDir.endsWith(sep) ? projectDir : projectDir + sep;
      return pathToFileUrl(base + fallbackSrc.replace(/^\.\//, ''));
    }
    return fallbackSrc; // hand back what we have
  }
  return null;
}

/**
 * A short hash-ish stable id from the assetRef so we can dedupe sibling-copy
 * destinations when many layers share the same file. Avoids copying a 500MB
 * video twice when it's referenced from a layer + the media library.
 */
export function assetRefIdentity(ref: AssetRef): string {
  if (ref.originalPath) return 'op:' + ref.originalPath;
  if (ref.url) return 'url:' + ref.url;
  if (ref.dataUrl) return 'data:' + ref.dataUrl.slice(0, 64);
  return 'name:' + (ref.name || '?') + ':' + (ref.size || 0) + ':' + (ref.lastModified || 0);
}

// Missing-asset registry — populated during importProject when a ref can't
// resolve. UI surfaces a "Locate Missing Media" repair flow off this store.
export interface MissingAsset {
  assetRef: AssetRef;
  layerId?: string;
  fieldHint: string; // e.g. 'image source', '3D model', 'splat texture'
}
export const missingAssetsStore: Writable<MissingAsset[]> = writable([]);

export function recordMissingAsset(entry: MissingAsset): void {
  missingAssetsStore.update((arr) => [...arr, entry]);
}

export function clearMissingAssets(): void {
  missingAssetsStore.set([]);
}
