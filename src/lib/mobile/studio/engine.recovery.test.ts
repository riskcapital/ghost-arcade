import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StudioEngine } from './engine';
import { defaultShow } from './model';

const compositor = vi.hoisted(() => ({ render: null as null | ReturnType<typeof vi.fn> }));
vi.mock('../standaloneRenderer', () => ({
  StandaloneRenderer: class {
    setShaderInputs = vi.fn(); clearSource = vi.fn(); loadShaderSource = vi.fn().mockResolvedValue(undefined);
    setShaderImage = vi.fn(); setAudio = vi.fn(); setClipParams = vi.fn(); drawFrame = vi.fn(); destroy = vi.fn();
    textureOutput = null;
  },
}));
vi.mock('./compositor', () => ({
  StudioCompositor: class {
    context = {}; beginFrame = vi.fn(); destroy = vi.fn();
    render = (compositor.render = vi.fn());
    constructor(public canvas: HTMLCanvasElement) {}
  },
}));

let frame: FrameRequestCallback | undefined;
let engine: StudioEngine | undefined;
beforeEach(() => {
  frame = undefined;
  vi.stubGlobal('HTMLVideoElement', class {});
  vi.stubGlobal('HTMLImageElement', class {});
  vi.stubGlobal('document', { hidden: false });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frame = callback; return 7; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => { engine?.destroy(); engine = undefined; vi.unstubAllGlobals(); });

function setup() {
  const listeners: Record<string, (event: Event) => void> = {};
  const canvas = {
    addEventListener: vi.fn((type: string, fn: (event: Event) => void) => { listeners[type] = fn; }),
    removeEventListener: vi.fn((type: string) => { delete listeners[type]; }),
  } as unknown as HTMLCanvasElement;
  const show = defaultShow();
  engine = new StudioEngine(canvas, () => show);
  const stopped: Array<[string, string | undefined]> = [];
  const errors: string[] = [];
  let restored = 0;
  engine.onStopped = (reason, message) => stopped.push([reason, message]);
  engine.onRestored = () => restored++;
  engine.onError = message => errors.push(message);
  return { engine, listeners, stopped, errors, restoredCount: () => restored };
}

describe('WebGL context loss', () => {
  it('asks the browser to restore the context and reports the stop instead of a dead-end error', () => {
    const { engine, listeners, stopped, errors } = setup();
    engine.start();
    frame!(performance.now());
    expect(compositor.render).toHaveBeenCalledTimes(1);
    const event = { preventDefault: vi.fn() } as unknown as Event;
    listeners.webglcontextlost(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(stopped).toEqual([['lost', undefined]]);
    expect(errors).toEqual([]);
    expect(engine.stopped).toBe(true);
    expect(cancelAnimationFrame).toHaveBeenCalledWith(7);
    // A frame that was already scheduled must not touch the dead context.
    frame!(performance.now() + 16);
    expect(compositor.render).toHaveBeenCalledTimes(1);
  });
  it('tells its owner when the context comes back so the engine can be rebuilt', () => {
    const { listeners, restoredCount } = setup();
    listeners.webglcontextlost({ preventDefault: vi.fn() } as unknown as Event);
    listeners.webglcontextrestored({} as Event);
    expect(restoredCount()).toBe(1);
  });
  it('stops cleanly when a frame cannot be drawn', () => {
    const { engine, stopped } = setup();
    engine.start();
    compositor.render!.mockImplementation(() => { throw new Error('Output resolution exceeds available GPU memory.'); });
    frame!(performance.now());
    expect(stopped).toEqual([['failed', 'Output resolution exceeds available GPU memory.']]);
    expect(engine.stopped).toBe(true);
    frame!(performance.now() + 16);
    expect(compositor.render).toHaveBeenCalledTimes(1);
  });
  it('ignores context events after it has been destroyed and removes both listeners', () => {
    const { engine, listeners, stopped, restoredCount } = setup();
    const lost = listeners.webglcontextlost, back = listeners.webglcontextrestored;
    engine.destroy();
    expect(listeners.webglcontextlost).toBeUndefined();
    expect(listeners.webglcontextrestored).toBeUndefined();
    lost({ preventDefault: vi.fn() } as unknown as Event);
    back({} as Event);
    expect(stopped).toEqual([]);
    expect(restoredCount()).toBe(0);
  });
});
