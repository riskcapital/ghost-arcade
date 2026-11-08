import { describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { readSignedCatalog, sha256Hex, verifyEd25519, CatalogTrustError, communityJsSource, COMMUNITY_CATALOG_PUBLIC_KEY, type CommunityEntry } from './catalogV2';
import { fetchCommunityCatalog, syncCommunityCatalog, type CommunitySyncDeps } from './communitySync';
import type { StoredSketch } from '../stores/sketchLibrary';

const ORIGIN = 'https://ghostarcade.live';
const hex = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('hex');

/** A throwaway signing key, standing in for the website's. */
async function keyPair() {
  const pair = (await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const publicHex = hex(await webcrypto.subtle.exportKey('raw', pair.publicKey));
  const sign = async (payload: string) => hex(await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, new TextEncoder().encode(payload)));
  return { publicHex, sign };
}

const ISF = '/*{ "INPUTS": [] }*/\nvoid main(){ gl_FragColor = vec4(1.0); }\n';
const P5 = 'function setup(){ createCanvas(windowWidth, windowHeight); }\nfunction draw(){ background(0); }\n';
const THREE = '<!doctype html><html><body><script>window.shaderParams = { speed: 1 };</script></body></html>\n';

async function entry(id: string, kind: 'isf' | 'p5' | 'three', code: string, version = 1): Promise<Record<string, unknown>> {
  return {
    id,
    kind,
    name: `${kind} ${id}`,
    description: '',
    version,
    tags: ['test'],
    category: null,
    author: { name: 'Neon Kite', handle: 'neon-kite', url: `${ORIGIN}/artists/neon-kite` },
    licence: 'MIT',
    sha256: await sha256Hex(code),
    downloadUrl: `${ORIGIN}/api/shaders/${id}/content`,
    thumbnailUrl: `${ORIGIN}/api/shaders/${id}/thumbnail?v=${version}`,
    dateAdded: 1,
  };
}

async function signedBody(entries: unknown[], withdrawn: string[] = []) {
  const { publicHex, sign } = await keyPair();
  const payload = JSON.stringify({ version: 2, generatedAt: '2026-11-08T00:00:00Z', entries, withdrawn });
  return { publicHex, body: { format: 'ghost-arcade-catalog', payload, signature: await sign(payload), keyId: publicHex.slice(0, 16) } };
}

function fakeFetch(files: Record<string, string>): typeof fetch {
  return vi.fn(async (url: string) => {
    const id = String(url).match(/shaders\/([^/]+)\/content/)?.[1];
    const text = id ? files[id] : undefined;
    return { ok: text !== undefined, status: text !== undefined ? 200 : 404, text: async () => text ?? '' } as Response;
  }) as unknown as typeof fetch;
}

function deps(files: Record<string, string>, opts: { shaders?: Map<string, number>; sketches?: StoredSketch[] } = {}) {
  const shaders = new Map(opts.shaders ?? []);
  const sketches = new Map((opts.sketches ?? []).map((s) => [s.id, s]));
  const changes: { put: StoredSketch[]; removed: string[] }[] = [];
  const d: CommunitySyncDeps = {
    fetch: fakeFetch(files),
    shaderVersions: () => new Map(shaders),
    putShader: async (r) => { shaders.set(r.id, r.version); },
    removeShader: async (id) => { shaders.delete(id); },
    loadSketches: async () => [...sketches.values()],
    putSketch: async (s) => { sketches.set(s.id, s); return true; },
    removeSketch: async (id) => { sketches.delete(id); },
    sketchesChanged: (c) => changes.push(c),
    now: () => 1000,
  };
  return { d, shaders, sketches, changes };
}

describe('signed community catalog', () => {
  it('reads a correctly signed catalog', async () => {
    const { publicHex, body } = await signedBody([await entry('a', 'isf', ISF)]);
    const catalog = await readSignedCatalog(body, ORIGIN, publicHex);
    expect(catalog?.entries.map((e) => e.id)).toEqual(['a']);
    expect(catalog?.entries[0].author?.name).toBe('Neon Kite');
  });

  it('refuses a catalog whose payload was changed after signing', async () => {
    const { publicHex, body } = await signedBody([await entry('a', 'isf', ISF)]);
    const tampered = { ...body, payload: body.payload.replace('"MIT"', '"CC0"') };
    await expect(readSignedCatalog(tampered, ORIGIN, publicHex)).rejects.toBeInstanceOf(CatalogTrustError);
  });

  it('refuses a catalog signed with another key', async () => {
    const { body } = await signedBody([await entry('a', 'isf', ISF)]);
    await expect(readSignedCatalog(body, ORIGIN, COMMUNITY_CATALOG_PUBLIC_KEY)).rejects.toBeInstanceOf(CatalogTrustError);
  });

  it('treats an unsigned catalog as "no signed catalog" so the shader feed is used', async () => {
    const { publicHex, body } = await signedBody([]);
    expect(await readSignedCatalog({ ...body, signature: null }, ORIGIN, publicHex)).toBeNull();
  });

  it('drops entries that download from another site, or have a bad id or hash', async () => {
    const good = await entry('ok', 'isf', ISF);
    const elsewhere = { ...(await entry('elsewhere', 'isf', ISF)), downloadUrl: 'https://evil.example/x.fs' };
    const badId = { ...(await entry('x', 'isf', ISF)), id: '../escape' };
    const badHash = { ...(await entry('h', 'isf', ISF)), sha256: 'nothex' };
    const { publicHex, body } = await signedBody([good, elsewhere, badId, badHash]);
    const catalog = await readSignedCatalog(body, ORIGIN, publicHex);
    expect(catalog?.entries.map((e) => e.id)).toEqual(['ok']);
  });

  it('verifies with the platform Ed25519 (RFC 8032 test vector 1)', async () => {
    const pub = 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
    const sig = 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b';
    expect(await verifyEd25519('', sig, pub)).toBe(true);
    expect(await verifyEd25519('x', sig, pub)).toBe(false);
  });
});

describe('Find latest with the community catalog', () => {
  it('brings in a shader, a p5.js sketch and a three.js page, credited', async () => {
    const { publicHex, body } = await signedBody([await entry('s1', 'isf', ISF), await entry('p1', 'p5', P5), await entry('t1', 'three', THREE)]);
    const catalog = (await readSignedCatalog(body, ORIGIN, publicHex))!;
    const { d, shaders, sketches, changes } = deps({ s1: ISF, p1: P5, t1: THREE });
    const result = await syncCommunityCatalog(catalog, d);
    expect(result).toMatchObject({ added: 3, updated: 0, removed: 0, rejected: [] });
    expect(shaders.get('s1')).toBe(1);
    expect(sketches.get('p1')?.jsAnimation.animationType).toBe('p5js');
    expect(sketches.get('p1')?.jsAnimation.origin).toMatchObject({ kind: 'community', author: 'Neon Kite', community: { id: 'p1', version: 1, licence: 'MIT' } });
    expect(sketches.get('t1')?.jsAnimation.animationType).toBe('threejs');
    expect(changes[0].put.map((s) => s.id).sort()).toEqual(['p1', 't1']);
  });

  it('skips a file whose contents do not match its signed hash', async () => {
    const { publicHex, body } = await signedBody([await entry('s1', 'isf', ISF)]);
    const catalog = (await readSignedCatalog(body, ORIGIN, publicHex))!;
    const { d, shaders } = deps({ s1: ISF.replace('1.0', '0.0') });
    const result = await syncCommunityCatalog(catalog, d);
    expect(result.added).toBe(0);
    expect(result.rejected).toEqual(['isf s1']);
    expect(shaders.has('s1')).toBe(false);
  });

  it('updates only what has a newer version, and removes what was taken down', async () => {
    const existingSketch: StoredSketch = {
      id: 'p1',
      name: 'old',
      jsAnimation: communityJsSource((await entry('p1', 'p5', P5, 1)) as unknown as CommunityEntry, P5, 1),
      addedAt: 1,
    };
    const goneSketch: StoredSketch = { ...existingSketch, id: 'gone', jsAnimation: { ...existingSketch.jsAnimation, origin: { ...existingSketch.jsAnimation.origin!, community: { id: 'gone', version: 1, licence: 'MIT' } } } };
    const { publicHex, body } = await signedBody([await entry('s1', 'isf', ISF, 3), await entry('p1', 'p5', P5, 2)], ['gone', 'old-shader']);
    const catalog = (await readSignedCatalog(body, ORIGIN, publicHex))!;
    const { d, shaders, sketches, changes } = deps({ s1: ISF, p1: P5 }, { shaders: new Map([['s1', 3], ['old-shader', 1]]), sketches: [existingSketch, goneSketch] });
    const result = await syncCommunityCatalog(catalog, d);
    expect(result).toMatchObject({ added: 0, updated: 1, skipped: 1, removed: 2 });
    expect(sketches.get('p1')?.jsAnimation.origin?.community?.version).toBe(2);
    expect(sketches.has('gone')).toBe(false);
    expect(shaders.has('old-shader')).toBe(false);
    expect(changes[0].removed).toEqual(['gone']);
  });

  it('uses the shader feed when the site has no signed catalog (404)', async () => {
    const f = vi.fn(async () => ({ status: 404, ok: false, url: `${ORIGIN}/api/shaders/catalog/v2` }) as Response) as unknown as typeof fetch;
    expect(await fetchCommunityCatalog(`${ORIGIN}/api/shaders`, f)).toBeNull();
  });

  it('reports offline when the site cannot be reached', async () => {
    const f = vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchCommunityCatalog(`${ORIGIN}/api/shaders`, f)).rejects.toThrow('offline');
  });
});
