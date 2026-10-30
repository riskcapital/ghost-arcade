import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Performer stamps its effect chain onto the clip it drives on its row. A
 * grid clip fired on that row is the deck's, and must keep its own saved
 * effects; Performer's next launch gets the chain again.
 */
vi.mock('../bridge', async (original) => ({
  ...(await original<typeof import('../bridge')>()),
  isDesktopApp: true,
  isElectron: true,
  invoke: vi.fn(async () => null),
}));

vi.stubGlobal('document', {
  createElement: () => ({ getContext: () => null, style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, remove() {} }),
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {}, removeChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false } },
  documentElement: {
    style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => '' },
    setAttribute() {}, removeAttribute() {}, getAttribute: () => null,
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    dataset: {},
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  visibilityState: 'visible',
});
const storage = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => storage.clear(), key: () => null, length: 0,
});
vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => setTimeout(() => callback(performance.now()), 16));
vi.stubGlobal('cancelAnimationFrame', (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));

const { vjClipLauncher } = await import('./vjClipLauncher');
const { isPerformerClip, stampPerformerEffects } = await import('./synthVision');
const { createNativePerformerShaderClip } = await import('../performer/nativeClip');
const { keyframeTimeline } = await import('./keyframeTimeline');
const { get } = await import('svelte/store');

afterAll(() => {
  keyframeTimeline.stop();
  vi.unstubAllGlobals();
});

const effect = (id: string, type = 'blur') =>
  ({ id, type, enabled: true, opacity: 1, blendMode: 'normal', params: { amount: 0.5 } }) as any;
const state = () => get(vjClipLauncher);
const playing = (layer: number) => state().layerStates[layer].activeClip as any;
const gridCell = (layer: number, column: number) => state().clipGrid[layer][column] as any;
const performerShader = (id: string) => createNativePerformerShaderClip(
  { type: 'shader', shaderName: 'P', shaderCode: 'void main(){}' } as any,
  id,
)!;

const chain = [effect('perf-1', 'kaleidoscope'), effect('perf-2')];

beforeEach(() => vjClipLauncher.reset());

describe('Performer effect chain', () => {
  it('leaves a grid clip fired on Performer\'s row with its own effects', () => {
    const own = [effect('grid-fx')];
    vjClipLauncher.setClip(0, 1, { id: 'grid', type: 'shader', name: 'Grid', src: '', shaderCode: 'void main(){}', effects: own } as any);
    vjClipLauncher.triggerClipNow(0, 1);

    expect(stampPerformerEffects(vjClipLauncher, 0, chain, 'A')).toBe(false);
    expect(playing(0).effects.map((e: any) => e.id)).toEqual(['grid-fx']);
    expect(gridCell(0, 1).effects.map((e: any) => e.id)).toEqual(['grid-fx']);
  });

  it('applies to the next clip Performer launches on that row', () => {
    vjClipLauncher.setClip(0, 1, { id: 'grid', type: 'shader', name: 'Grid', src: '', shaderCode: 'void main(){}', effects: [effect('grid-fx')] } as any);
    vjClipLauncher.triggerClipNow(0, 1);
    stampPerformerEffects(vjClipLauncher, 0, chain, 'A');

    vjClipLauncher.launchTransientClip(0, performerShader('performer-shader-1'));
    expect(stampPerformerEffects(vjClipLauncher, 0, chain, 'A')).toBe(true);
    expect(playing(0).effects.map((e: any) => e.id)).toEqual(['perf-1', 'perf-2']);
    // The grid cell it replaced on air still has its own chain.
    expect(gridCell(0, 1).effects.map((e: any) => e.id)).toEqual(['grid-fx']);
  });

  it('works on deck B and leaves other rows alone', () => {
    vjClipLauncher.launchTransientClip(2, performerShader('performer-b'), 'B');
    expect(stampPerformerEffects(vjClipLauncher, 2, chain, 'B')).toBe(true);
    expect((state().bankBLayerStates[2].activeClip as any).effects).toHaveLength(2);
    expect(stampPerformerEffects(vjClipLauncher, 1, chain, 'B')).toBe(false);
  });

  it('knows which clips are Performer\'s', () => {
    expect(isPerformerClip(performerShader('x'))).toBe(true);
    expect(isPerformerClip({ type: 'synthvision' } as any)).toBe(true);
    expect(isPerformerClip({ type: 'shader' } as any)).toBe(false);
    expect(isPerformerClip(null)).toBe(false);
  });

  it('is the only way the Performer panel writes its chain', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'SynthVision.svelte'), 'utf8');
    expect(source).toContain('stampPerformerEffects(vjClipLauncher, assignedVJLayer, effects,');
    expect(source).not.toContain('vjClipLauncher.setActiveClipEffects(');
  });
});
