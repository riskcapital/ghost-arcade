import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJSAnimationContext, disposeJSAnimationContext, getJSAnimationContext } from './js-animation';

interface FakeElement {
  tag: string;
  style: Record<string, string>;
  attributes: Record<string, string>;
  src: string;
  width: number;
  height: number;
  remove: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  setAttribute: (name: string, value: string) => void;
  getContext: () => unknown;
  contentWindow: { postMessage: ReturnType<typeof vi.fn> };
  drawn: unknown[];
}

function fakeElement(tag: string): FakeElement {
  const element: FakeElement = {
    tag,
    style: {},
    attributes: {},
    src: '',
    width: 0,
    height: 0,
    remove: vi.fn(),
    addEventListener: vi.fn(),
    setAttribute(name, value) { element.attributes[name] = value; },
    getContext: () => ({
      fillRect() {},
      clearRect() {},
      drawImage(image: unknown) { element.drawn.push(image); },
      fillStyle: '',
    }),
    contentWindow: { postMessage: vi.fn() },
    drawn: [],
  };
  return element;
}

describe('JS animation contexts', () => {
  let messageListener: ((event: { source: unknown; data: unknown }) => void) | null;
  const created: FakeElement[] = [];
  const blobs: Blob[] = [];

  beforeEach(() => {
    messageListener = null;
    created.length = 0;
    blobs.length = 0;
    vi.stubGlobal('window', {
      location: { origin: 'http://app', href: 'http://app/index.html', pathname: '/index.html' },
      addEventListener: (type: string, listener: (event: { source: unknown; data: unknown }) => void) => {
        if (type === 'message') messageListener = listener;
      },
    });
    vi.stubGlobal('document', {
      baseURI: 'http://app/index.html',
      createElement: (tag: string) => {
        const element = fakeElement(tag);
        created.push(element);
        return element;
      },
      body: { appendChild: vi.fn() },
    });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => '/* library */' })));
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      blobs.push(blob as Blob);
      return `blob:page-${blobs.length}`;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const page = { htmlCode: '<html><head></head><body><canvas></canvas></body></html>', animationType: 'threejs' } as any;

  async function started(id: string) {
    const context = createJSAnimationContext(id, page);
    await vi.waitFor(() => expect(URL.createObjectURL).toHaveBeenCalled());
    const iframe = context.iframe as unknown as FakeElement;
    const nonce = /var N="([^"]+)"/.exec(await blobs[blobs.length - 1].text())![1];
    const send = (data: Record<string, unknown>) => messageListener!({ source: iframe.contentWindow, data: { ghost: nonce, ...data } });
    return { context, iframe, nonce, send };
  }

  it('plays the page in a frame that may run scripts and nothing else', async () => {
    const { context, iframe } = await started('anim-0');
    expect(iframe.attributes.sandbox).toBe('allow-scripts');
    expect(iframe.src).toBe('blob:page-1');
    context.dispose();
  });

  it('removes the iframe and frees the page once', async () => {
    const { context } = await started('anim-1');
    disposeJSAnimationContext('anim-1');
    context.dispose();
    expect(context.iframe.remove).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(getJSAnimationContext('anim-1')).toBeUndefined();
  });

  it('a late dispose of an old context leaves a newer one with the same id', () => {
    const first = createJSAnimationContext('anim-2', page);
    first.dispose();
    const second = createJSAnimationContext('anim-2', page);
    first.dispose();
    expect(getJSAnimationContext('anim-2')).toBe(second);
    second.dispose();
    expect(getJSAnimationContext('anim-2')).toBeUndefined();
  });

  it('asks the page for pictures, draws each one and only then asks for the next', async () => {
    const { context, iframe, nonce, send } = await started('anim-3');
    send({ type: 'hello' });
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'frames', on: true, ghost: nonce }), '*');
    const bitmap = { width: 64, height: 32, close: vi.fn() };
    context.updateTexture();
    send({ type: 'frame', bitmap });
    const output = context.canvas as unknown as FakeElement;
    expect(output.width).toBe(64);
    expect(output.height).toBe(32);
    expect(output.drawn).toContain(bitmap);
    expect(bitmap.close).toHaveBeenCalled();
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ack' }), '*');
    context.dispose();
  });

  it('keeps the errors of the run it is playing, and ignores messages from any other', async () => {
    const { context, iframe, send } = await started('anim-4');
    send({ type: 'error', message: 'Uncaught ReferenceError: x is not defined', line: 1 });
    send({ type: 'error', message: 'Uncaught ReferenceError: x is not defined', line: 1 });
    messageListener!({ source: iframe.contentWindow, data: { ghost: 'someone-else', type: 'error', message: 'forged', line: 1 } });
    messageListener!({ source: {}, data: { ghost: 'x', type: 'error', message: 'other frame', line: 1 } });
    const errors = context.readErrors();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ message: 'Uncaught ReferenceError: x is not defined', count: 2 });
    context.dispose();
  });

  it('runs the code once its page has loaded', async () => {
    const { context, send } = await started('anim-5');
    expect(context.runs(page.htmlCode)).toBe(false);
    send({ type: 'loaded' });
    expect(context.runs(page.htmlCode)).toBe(true);
    expect(context.runs('<html>other</html>')).toBe(false);
    context.dispose();
  });

  it('hands slider values to each new run of the page', async () => {
    const { context, iframe, send } = await started('anim-6');
    context.updateParams({ speed: 3 });
    send({ type: 'hello' });
    expect(iframe.contentWindow.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'params', values: { speed: 3 } }), '*');
    context.dispose();
  });
});
