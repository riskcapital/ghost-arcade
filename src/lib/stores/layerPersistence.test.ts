/**
 * Layer persistence round trip: what a user sets is what reopens.
 *
 * The failure this guards is silent and specific. `_exportLayer` writes an
 * explicit field list, `_importLayer` reads one, and the two are maintained by
 * hand. A field added to the Layer type and wired into a panel will save fine
 * in the autosave (which serializes the live object) and then come back at its
 * default from the .gha, because nobody added the one line to the exporter.
 * Two fields were already in that state when this suite was written:
 * `arcadeContent` (imported, never exported) and `stageTextureFlipV` (set by
 * Stage Designer, in neither list).
 *
 * The guard is a diff of the Layer interface against the exporter's source
 * text, with an explicit allow-list of fields that are runtime-only. Adding a
 * persistent field without exporting it fails here rather than in someone's
 * set.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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
  const makeEl = (): any => ({
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    appendChild: (c: any) => c, removeChild: (c: any) => c,
    addEventListener() {}, removeEventListener() {},
    querySelector: () => null, querySelectorAll: () => [],
    load() {}, play: () => Promise.resolve(), pause() {},
  });
  (globalThis as any).document = {
    documentElement: makeEl(),
    body: makeEl(),
    head: makeEl(),
    createElement: () => makeEl(),
    querySelector: () => null,
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {}, removeEventListener() {},
    visibilityState: 'visible',
  };
  (globalThis as any).window = globalThis;
  (globalThis as any).matchMedia = () => ({
    matches: false,
    addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {},
  });
  (globalThis as any).requestAnimationFrame = (cb: (t: number) => void) =>
    setTimeout(() => cb(Date.now()), 0) as unknown as number;
  (globalThis as any).cancelAnimationFrame = (id: number) => clearTimeout(id as never);
}

beforeAll(async () => {
  installDomShim();
  layers = await import('./layers');
  types = await import('../types');
});

/**
 * Fields that legitimately do not belong in a save file.
 *
 * Underscore-prefixed keys are runtime scratch. The rest are recomputed on
 * load or set per-session by the engine; persisting them would restore stale
 * routing rather than user intent. Anything NOT listed here is expected to
 * survive a save.
 */
const RUNTIME_ONLY_LAYER_FIELDS = new Set([
  '_deckMonitorBank',    // set per frame by the deck monitor passes
  '_deckMonitorOpacity',
  'bank',                // assigned by vjOutputLayers when the crossfader is on
  'texture',             // live GPU/DOM object
  'videoElement',        // live DOM element
  'isPlaying',           // transport state, not a setting
  'selectedElementId',   // editor selection
]);

function layerInterfaceFields(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/types.ts'), 'utf8');
  const match = source.match(/export interface Layer \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('Layer interface not found in types.ts');
  const fields: string[] = [];
  let depth = 0;
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const field = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (field) fields.push(field[1]);
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
  }
  return fields;
}

function exporterSource(): string {
  const source = readFileSync(join(process.cwd(), 'src/lib/stores/layers.ts'), 'utf8');
  const start = source.indexOf('    _exportLayer(layer: Layer)');
  const end = source.indexOf('    async _exportLayerForSave(', start);
  if (start < 0 || end < 0) throw new Error('_exportLayer not found in layers.ts');
  return source.slice(start, end);
}

/**
 * The VJ clip grid is the performer's set. It is exported by the same kind of
 * hand-maintained whitelist as layers, inside exportProject, so it carries the
 * same risk: a clip property added for a new feature is simply absent from the
 * saved show.
 */
function vjClipInterfaceFields(): string[] {
  const source = readFileSync(join(process.cwd(), 'src/lib/stores/vjClipLauncher.ts'), 'utf8');
  const match = source.match(/export interface VJClip \{([\s\S]*?)\n\}/);
  if (!match) throw new Error('VJClip interface not found');
  const fields: string[] = [];
  let depth = 0;
  for (const line of match[1].split('\n')) {
    const trimmed = line.trim();
    if (depth === 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const field = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\??\s*:/);
      if (field) fields.push(field[1]);
    }
    depth += (line.match(/\{/g)?.length ?? 0) - (line.match(/\}/g)?.length ?? 0);
  }
  return fields;
}

function projectExporterSource(): string {
  const source = readFileSync(join(process.cwd(), 'src/lib/stores/layers.ts'), 'utf8');
  const start = source.indexOf('    exportProject()');
  const end = source.indexOf('    async exportProjectForSave(', start);
  if (start < 0 || end < 0) throw new Error('exportProject not found in layers.ts');
  return source.slice(start, end);
}

describe('VJ clip persistence', () => {
  it('exports every VJClip field that is not runtime scratch', () => {
    const exporter = projectExporterSource();
    // Underscore-prefixed clip fields are native playback bookkeeping, rewritten
    // every frame; saving them would restore a stale playhead.
    const missing = vjClipInterfaceFields()
      .filter((field) => !field.startsWith('_'))
      .filter((field) => !exporter.includes(field));

    expect(
      missing,
      `VJClip fields absent from exportProject — a performer's set would reopen `
      + `without them:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('Layer persistence', () => {
  it('exports every Layer field that is not runtime-only', () => {
    const exporter = exporterSource();
    const missing = layerInterfaceFields()
      .filter((field) => !RUNTIME_ONLY_LAYER_FIELDS.has(field))
      .filter((field) => !exporter.includes(field));

    expect(
      missing,
      `Layer fields absent from _exportLayer — they will reopen at their default.\n`
      + `Add them to the exporter, or to RUNTIME_ONLY_LAYER_FIELDS if they really `
      + `should not persist:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('round-trips the settings a performer actually reaches for', () => {
    const source = { id: 'src-1', type: 'image', src: '/tmp/x.png', name: 'x' };
    const original = {
      ...types.createLayer('layer-1', 'Test', 'gpu'),
      // Per-layer render quality: overrides the global tier for one heavy
      // instrument. An override that silently reverted to "match global" on
      // reload is the kind of thing found mid-set.
      renderQuality: 0.56,
      // Stage Designer's texture orientation. Without this the reload falls
      // back to inferring from corner geometry.
      stageTextureFlipV: true,
      contentFit: 'crop' as const,
      vjLayerIndex: 2,
      source: source as any,
      gpuLayerContent: {
        shaderId: 'flythrough',
        params: {
          // A camera source and its selfie flip.
          source: { type: 'camera', deviceId: 'ABC-123' },
          mirrorX: true,
          topology: 'points',
          particleCount: 40960,
        },
      } as any,
    };

    const exported = layers.project._exportLayer(original as any);
    // Through JSON, because that is what actually happens on the way to disk.
    const restored = layers.project._importLayer(JSON.parse(JSON.stringify(exported)));

    expect(restored.renderQuality).toBe(0.56);
    expect(restored.stageTextureFlipV).toBe(true);
    expect(restored.contentFit).toBe('crop');
    expect(restored.vjLayerIndex).toBe(2);
    expect((restored.gpuLayerContent as any)?.shaderId).toBe('flythrough');
    expect((restored.gpuLayerContent as any)?.params?.mirrorX).toBe(true);
    expect((restored.gpuLayerContent as any)?.params?.particleCount).toBe(40960);
    expect((restored.gpuLayerContent as any)?.params?.source).toEqual({
      type: 'camera',
      deviceId: 'ABC-123',
    });
  });
});
