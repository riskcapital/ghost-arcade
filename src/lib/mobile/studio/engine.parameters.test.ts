import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioEngine } from './engine';
import { defaultShow, type Clip } from './model';

const renderers = vi.hoisted(() => [] as Array<{
  setShaderInputs: ReturnType<typeof vi.fn>;
  clearSource: ReturnType<typeof vi.fn>;
}>);
vi.mock('../standaloneRenderer', () => ({
  StandaloneRenderer: class {
    setShaderInputs = vi.fn();
    clearSource = vi.fn();
    loadShaderSource = vi.fn().mockResolvedValue(undefined);
    setShaderImage = vi.fn();
    setAudio = vi.fn();
    setClipParams = vi.fn();
    drawFrame = vi.fn();
    destroy = vi.fn();
    textureOutput = null;
    constructor() { renderers.push(this); }
  },
}));
vi.mock('./compositor', () => ({
  StudioCompositor: class {
    context = {};
    beginFrame = vi.fn();
    render = vi.fn();
    destroy = vi.fn();
    constructor(public canvas: HTMLCanvasElement) {}
  },
}));

let frame: FrameRequestCallback;
let engine: StudioEngine | undefined;
beforeEach(() => {
  renderers.length = 0;
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    text: async () => '/*{"INPUTS":[{"NAME":"gain","TYPE":"float","DEFAULT":0.5},{"NAME":"_ghostClock","TYPE":"float"}]}*/\nvoid main(){gl_FragColor=vec4(gain);}',
  })));
});
afterEach(() => {
  engine?.destroy();
  engine = undefined;
  vi.unstubAllGlobals();
});

function setup() {
  let show = defaultShow();
  const canvas = { addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as HTMLCanvasElement;
  engine = new StudioEngine(canvas, () => show);
  const clip = show.clips.find(candidate => candidate.id === show.layers[0].clipId)!;
  return { engine, clip, get show() { return show; }, replaceShow(next: typeof show) { show = next; } };
}

describe('mobile shader parameter routing', () => {
  it('uses the latest independent layer values each frame after immutable show edits', async () => {
    const context = setup();
    const secondClip: Clip = { ...context.clip, id: 'second-layer-clip' };
    context.show.clips.push(secondClip);
    context.show.layers[1].clipId = secondClip.id;
    context.show.layers[0].params = { gain: 0.2 };
    context.show.layers[1].params = { gain: 0.8 };
    await context.engine.launch(0, context.clip);
    await context.engine.launch(1, secondClip);
    context.engine.start();
    frame(performance.now());
    // Composition renderer is first; each layer has source and effect renderers.
    expect(renderers[1].setShaderInputs).toHaveBeenLastCalledWith({ gain: 0.2 });
    expect(renderers[3].setShaderInputs).toHaveBeenLastCalledWith({ gain: 0.8 });
    context.replaceShow({ ...context.show, layers: context.show.layers.map((layer, row) => row === 1
      ? { ...layer, params: { gain: 0, enabled: false, point: [0.25, 0.75] } }
      : layer) });
    frame(performance.now() + 16);
    expect(renderers[1].setShaderInputs).toHaveBeenLastCalledWith({ gain: 0.2 });
    expect(renderers[3].setShaderInputs).toHaveBeenLastCalledWith({ gain: 0, enabled: false, point: [0.25, 0.75] });
  });

  it('removes stale controls when a layer stops and restores them on relaunch', async () => {
    const context = setup();
    await context.engine.launch(0, context.clip);
    expect(context.engine.parameters(0).map(input => input.NAME)).toEqual(['gain']);
    context.engine.clear(0);
    expect(context.engine.parameters(0)).toEqual([]);
    expect(renderers[1].clearSource).toHaveBeenCalledOnce();
    await context.engine.launch(0, context.clip);
    expect(context.engine.parameters(0).map(input => input.NAME)).toEqual(['gain']);
  });
});
