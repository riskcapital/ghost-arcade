/**
 * Find latest with the signed community catalog: brings in new and updated
 * shaders, p5.js sketches and three.js pages, and removes ones that were
 * taken down. Shaders go to the shader library; sketches and pages go to
 * the sketch library (the media tray's JS tab). Layers and clips that use
 * an item keep their own copy, so removing one never breaks a show.
 */
import { CatalogTrustError, communityJsSource, downloadVerified, readSignedCatalog, type CommunityCatalog, type CommunityEntry } from './catalogV2';
import type { StoredSketch } from '../stores/sketchLibrary';

export interface CommunitySyncResult {
  added: number;
  updated: number;
  removed: number;
  skipped: number;
  total: number;
  /** Items left out because they failed a check; named so they can be reported. */
  rejected: string[];
}

/** A shader as the shader library keeps it. */
export interface CommunityShaderRecord {
  id: string;
  name: string;
  description: string;
  code: string;
  thumbnail?: string;
  tags: string[];
  version: number;
  author?: string;
  authorUrl?: string;
  licence?: 'MIT' | 'CC0';
  createdAt: number;
}

export interface CommunitySyncDeps {
  fetch: typeof fetch;
  /** Local cloud/community shaders: id → version. */
  shaderVersions(): Map<string, number>;
  putShader(record: CommunityShaderRecord, isNew: boolean): Promise<void>;
  removeShader(id: string): Promise<void>;
  /** Community sketches and pages already kept. */
  loadSketches(): Promise<StoredSketch[]>;
  putSketch(sketch: StoredSketch): Promise<boolean>;
  removeSketch(id: string): Promise<void>;
  /** Tell the tray what changed. */
  sketchesChanged(change: { put: StoredSketch[]; removed: string[] }): void;
  now?: () => number;
}

/**
 * Fetch {base}/catalog/v2. Null when the site has no signed catalog to offer
 * (older site, or not signed yet), so the caller uses the v1 shader feed.
 */
export async function fetchCommunityCatalog(base: string, fetchImpl: typeof fetch): Promise<CommunityCatalog | null> {
  let res: Response;
  try {
    res = await fetchImpl(`${base}/catalog/v2`, { cache: 'no-store' });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/Failed to fetch|NetworkError|TypeError/i.test(msg)) throw new Error('offline');
    throw e;
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Catalog responded ${res.status}`);
  return readSignedCatalog(await res.json(), new URL(res.url || base).origin);
}

export async function syncCommunityCatalog(catalog: CommunityCatalog, deps: CommunitySyncDeps): Promise<CommunitySyncResult> {
  const now = deps.now ?? Date.now;
  const result: CommunitySyncResult = { added: 0, updated: 0, removed: 0, skipped: 0, total: catalog.entries.length, rejected: [] };

  const shaderVersions = deps.shaderVersions();
  const stored = await deps.loadSketches();
  const sketchVersions = new Map<string, number>();
  for (const s of stored) {
    const c = s.jsAnimation.origin?.community;
    if (c) sketchVersions.set(c.id, c.version);
  }

  const put: StoredSketch[] = [];
  for (const entry of catalog.entries) {
    const local = entry.kind === 'isf' ? shaderVersions.get(entry.id) : sketchVersions.get(entry.id);
    if (local !== undefined && local >= entry.version) {
      result.skipped++;
      continue;
    }
    let code: string;
    try {
      code = await downloadVerified(entry, deps.fetch);
    } catch (e) {
      if (e instanceof CatalogTrustError) result.rejected.push(entry.name);
      else console.warn(`[community-sync] skipped ${entry.name}:`, e);
      continue;
    }

    if (entry.kind === 'isf') {
      await deps.putShader(shaderRecord(entry, code), local === undefined);
    } else {
      const sketch: StoredSketch = {
        id: entry.id,
        name: entry.name,
        jsAnimation: communityJsSource(entry, code, now()),
        ...(entry.thumbnailUrl ? { thumbnail: entry.thumbnailUrl } : {}),
        addedAt: entry.dateAdded || now(),
      };
      if (!(await deps.putSketch(sketch))) continue;
      put.push(sketch);
    }
    if (local === undefined) result.added++;
    else result.updated++;
  }

  const removed: string[] = [];
  for (const id of catalog.withdrawn) {
    if (shaderVersions.has(id)) {
      await deps.removeShader(id);
      result.removed++;
    }
    if (sketchVersions.has(id)) {
      await deps.removeSketch(id);
      removed.push(id);
      result.removed++;
    }
  }

  if (put.length || removed.length) deps.sketchesChanged({ put, removed });
  return result;
}

function shaderRecord(entry: CommunityEntry, code: string): CommunityShaderRecord {
  return {
    id: entry.id,
    name: entry.name,
    description: entry.description,
    code,
    ...(entry.thumbnailUrl ? { thumbnail: entry.thumbnailUrl } : {}),
    tags: entry.tags,
    version: entry.version,
    ...(entry.author?.name ? { author: entry.author.name } : {}),
    ...(entry.author?.url ? { authorUrl: entry.author.url } : {}),
    ...(entry.licence ? { licence: entry.licence } : {}),
    createdAt: entry.dateAdded,
  };
}
