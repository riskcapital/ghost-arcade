import { beforeAll, describe, expect, it } from 'vitest';
import { get } from 'svelte/store';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A layer's media source is saved whole, minus runtime state.
 *
 * It used to be saved through a hand-kept list of fields, and everything
 * added since was dropped: Auto on shader params, the selfie mirror,
 * beat-synced playback and the NDI source. A shader param on Auto reopened
 * frozen wherever its sweep was at save time.
 */

let layers: typeof import('./layers');
let types: typeof import('../types');

function installDomShim(): void {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
    clear: () => storage.clear(),
    key: () => null,
    length: 0,
  };
  (globalThis as any).document = {
    documentElement: { style: { setProperty() {}, removeProperty() {} } },
    addEventListener() {}, removeEventListener() {},
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}

beforeAll(async () => {
  installDomShim();
  types = await import('../types');
  layers = await import('./layers');
});

function mediaSourceInterfaceFields(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/types.ts'), 'utf8');
  const match = source.match(/export interface MediaSource \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('MediaSource interface not found in types.ts');
  const fields: string[] = [];
  let depth = 0;
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*')) {
      const field = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (field) fields.push(field[1]);
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
  }
  return fields;
}

describe('media source persistence', () => {
  it('saves every MediaSource field that is not runtime state', () => {
    const fields = mediaSourceInterfaceFields();
    expect(fields).toContain('shaderValueAuto');
    const source: Record<string, unknown> = {};
    for (const field of fields) source[field] = `saved-${field}`;
    const layer = { ...types.createLayer('every-field', 'Every field', 'media'), source };
    const exported = layers.project._exportLayer(layer as any) as any;
    const restored = layers.project._importLayer(JSON.parse(JSON.stringify(exported))) as any;
    const lost = fields
      .filter((field) => !layers.isRuntimeOnlySourceField(field))
      .filter((field) => restored.source[field] !== `saved-${field}`);
    expect(
      lost,
      `MediaSource fields lost between save and reopen. Persist them, or mark them `
      + `runtime-only in RUNTIME_ONLY_SOURCE_FIELDS if they really should not:\n  ${lost.join('\n  ')}`,
    ).toEqual([]);
    for (const field of fields.filter((f) => layers.isRuntimeOnlySourceField(f))) {
      expect(exported.source[field], `${field} is runtime state and must not be saved`).toBeUndefined();
    }
  });

  it('never saves a live texture or element, whatever the field is called', () => {
    const layer = {
      ...types.createLayer('live', 'Live', 'media'),
      source: { id: 's', type: 'image', src: '/x.png', name: 'x', extraTexture: { isTexture: true }, preview: { nodeType: 1 } },
    };
    const exported = layers.project._exportLayer(layer as any) as any;
    expect(exported.source.extraTexture).toBeUndefined();
    expect(exported.source.preview).toBeUndefined();
    expect(exported.source.src).toBe('/x.png');
  });

  it('reopens Auto on a shader param, the selfie mirror, beat sync and an NDI source', () => {
    const shader = {
      id: 'src-shader', type: 'shader', src: 'builtin:grid', name: 'Grid',
      shaderValues: { gridSize: 37.2 },
      shaderValueAuto: { gridSize: { enabled: true, mode: 'sine', rate: 0.5, min: 4, max: 100 } },
    };
    const camera = { id: 'src-camera', type: 'webcam', src: 'webcam://cam-1', name: 'Camera', mirrorX: true };
    const ndi = { id: 'src-ndi', type: 'ndi', src: 'ndi://Stage', name: 'NDI', ndiSource: { senderName: 'STAGE (Media Server)' }, playbackSyncBeats: 8 };
    const make = (id: string, src: any) => ({ ...types.createLayer(id, id, 'media'), source: src });
    const payload = { version: '1.9.3', project: { id: 'sources', name: 'Sources', width: 1920, height: 1080,
      layers: [make('shader', shader), make('camera', camera), make('ndi', ndi)] } };
    expect(layers.project.importProject(JSON.parse(JSON.stringify(payload)))).toBe(true);
    const saved = JSON.parse(JSON.stringify(layers.project.exportProject()));
    expect(layers.project.importProject(saved)).toBe(true);
    const byId = (id: string) => get(layers.project).layers.find((l) => l.id === id)!.source as any;
    expect(byId('shader').shaderValueAuto).toEqual(shader.shaderValueAuto);
    expect(byId('camera').mirrorX).toBe(true);
    expect(byId('ndi').ndiSource).toEqual({ senderName: 'STAGE (Media Server)' });
    expect(byId('ndi').playbackSyncBeats).toBe(8);
  });
});
