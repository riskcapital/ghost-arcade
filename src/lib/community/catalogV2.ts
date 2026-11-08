/**
 * The community catalog behind Find latest (version 2): shaders, p5.js
 * sketches and three.js pages made by Ghost Arcade contributors, with their
 * author, licence and the SHA-256 of every file.
 *
 * The website sends the catalog as a JSON string (`payload`) with an
 * Ed25519 signature of exactly those bytes. Nothing in it is used until the
 * signature checks out against the key below, and no file is kept unless
 * its hash matches the one the signed catalog gives. So a file can only
 * reach the library if ghostarcade.live published it, unchanged.
 */
import type { JSAnimationOrigin, JSAnimationSource } from '../types';
import { importSketch } from '../p5import/importSketch';
import { jsAnimationFromHtml } from '../renderer/jsAnimationPage';

/** ghostarcade.live's catalog signing key (public half). */
export const COMMUNITY_CATALOG_PUBLIC_KEY = 'a20b6ae81c181768c10f65ab353226b1dbe6de51166e9e4fe0d5b39b4d7eae02';

export type CommunityKind = 'isf' | 'p5' | 'three';

export interface CommunityAuthor {
  name: string;
  handle: string | null;
  url: string | null;
}

export interface CommunityEntry {
  id: string;
  kind: CommunityKind;
  name: string;
  description: string;
  version: number;
  tags: string[];
  category: string | null;
  author: CommunityAuthor | null;
  licence: 'MIT' | 'CC0' | null;
  sha256: string;
  downloadUrl: string;
  thumbnailUrl: string | null;
  dateAdded: number;
}

export interface CommunityCatalog {
  generatedAt: string;
  entries: CommunityEntry[];
  /** Ids taken down since they were published; remove them locally. */
  withdrawn: string[];
}

/** Raised when the catalog came back but can't be trusted. Never fall back silently on this. */
export class CatalogTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogTrustError';
  }
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new CatalogTrustError('Malformed hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyEd25519(message: string, signatureHex: string, publicKeyHex: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', hexToBytes(publicKeyHex) as BufferSource, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, hexToBytes(signatureHex) as BufferSource, new TextEncoder().encode(message) as BufferSource);
  } catch {
    return false;
  }
}

const ID = /^[a-zA-Z0-9._-]{1,128}$/;
const KINDS: CommunityKind[] = ['isf', 'p5', 'three'];

/** Only https downloads from the site the catalog came from. */
function sameSiteHttps(url: unknown, catalogOrigin: string): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.origin === catalogOrigin : u.origin === catalogOrigin && /^(localhost|127\.0\.0\.1)$/.test(u.hostname);
  } catch {
    return false;
  }
}

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : '';
}

function parseEntry(raw: any, catalogOrigin: string): CommunityEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !ID.test(raw.id)) return null;
  if (!KINDS.includes(raw.kind)) return null;
  if (typeof raw.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(raw.sha256)) return null;
  if (!sameSiteHttps(raw.downloadUrl, catalogOrigin)) return null;
  const version = Number(raw.version);
  if (!Number.isInteger(version) || version < 1) return null;
  const author = raw.author && typeof raw.author === 'object' && typeof raw.author.name === 'string'
    ? {
        name: str(raw.author.name, 80),
        handle: typeof raw.author.handle === 'string' ? str(raw.author.handle, 40) : null,
        url: sameSiteHttps(raw.author.url, catalogOrigin) ? raw.author.url : null,
      }
    : null;
  return {
    id: raw.id,
    kind: raw.kind,
    name: str(raw.name, 100) || raw.id,
    description: str(raw.description, 2000),
    version,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t: unknown) => typeof t === 'string').slice(0, 8).map((t: string) => t.slice(0, 32)) : [],
    category: typeof raw.category === 'string' ? raw.category.slice(0, 60) : null,
    author,
    licence: raw.licence === 'MIT' || raw.licence === 'CC0' ? raw.licence : null,
    sha256: raw.sha256,
    downloadUrl: raw.downloadUrl,
    thumbnailUrl: sameSiteHttps(raw.thumbnailUrl, catalogOrigin) ? raw.thumbnailUrl : null,
    dateAdded: Number(raw.dateAdded) || Date.now(),
  };
}

/**
 * Check and read a v2 catalog response. Returns null when the site has no
 * signed catalog to offer (the caller then uses the v1 shader feed);
 * throws CatalogTrustError when one came back and fails the check.
 */
export async function readSignedCatalog(
  body: unknown,
  catalogOrigin: string,
  publicKeyHex: string = COMMUNITY_CATALOG_PUBLIC_KEY,
): Promise<CommunityCatalog | null> {
  const b = body as { format?: unknown; payload?: unknown; signature?: unknown } | null;
  if (!b || b.format !== 'ghost-arcade-catalog' || typeof b.payload !== 'string') {
    throw new CatalogTrustError('The catalog was not in the expected format');
  }
  if (b.signature === null || b.signature === undefined) return null;
  if (typeof b.signature !== 'string' || !(await verifyEd25519(b.payload, b.signature, publicKeyHex))) {
    throw new CatalogTrustError('The catalog signature did not match');
  }
  let payload: any;
  try {
    payload = JSON.parse(b.payload);
  } catch {
    throw new CatalogTrustError('The signed catalog could not be read');
  }
  if (payload?.version !== 2 || !Array.isArray(payload.entries)) throw new CatalogTrustError('Unknown catalog version');
  const entries = payload.entries.map((e: unknown) => parseEntry(e, catalogOrigin)).filter(Boolean) as CommunityEntry[];
  const withdrawn = Array.isArray(payload.withdrawn) ? payload.withdrawn.filter((id: unknown) => typeof id === 'string' && ID.test(id)) : [];
  return { generatedAt: str(payload.generatedAt, 40), entries, withdrawn };
}

/** Download one entry's file and check it is exactly what the signed catalog says. */
export async function downloadVerified(entry: CommunityEntry, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(entry.downloadUrl, { cache: 'no-store' });
  if (!res.ok) throw new Error(`download ${res.status}`);
  const text = await res.text();
  if (text.length > 600_000) throw new CatalogTrustError(`${entry.name} is larger than the catalog allows`);
  if ((await sha256Hex(text)) !== entry.sha256) throw new CatalogTrustError(`${entry.name} did not match its signed hash`);
  return text;
}

/** Where a community page came from: shown as its credit, and how sync recognises it later. */
export function communityOrigin(entry: CommunityEntry, now = Date.now()): JSAnimationOrigin {
  return {
    kind: 'community',
    sketchName: entry.name,
    ...(entry.author?.name ? { author: entry.author.name } : {}),
    ...(entry.author?.url ? { url: entry.author.url } : {}),
    importedFrom: 'community',
    importedAt: now,
    community: { id: entry.id, version: entry.version, licence: entry.licence },
  };
}

/** The media source for a community p5.js sketch or three.js page. */
export function communityJsSource(entry: CommunityEntry, code: string, now = Date.now()): JSAnimationSource {
  const origin = communityOrigin(entry, now);
  if (entry.kind === 'p5') {
    const imported = importSketch(
      { name: entry.name, author: entry.author?.name, source: 'files', files: [{ path: 'sketch.js', text: code }] },
      { now },
    );
    return { ...imported.source, origin };
  }
  return { ...jsAnimationFromHtml(code), origin };
}

/** "by Name · MIT" for a tile or a tooltip. */
export function communityCredit(author: string | null | undefined, licence: string | null | undefined): string {
  return [author ? `by ${author}` : '', licence ?? ''].filter(Boolean).join(' · ');
}
