import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createJSAnimationContext, disposeJSAnimationContext, getJSAnimationContext } from './js-animation';

function fakeElement(tag: string) {
  return {
    tag,
    style: {},
    src: '',
    width: 0,
    height: 0,
    remove: vi.fn(),
    getContext: () => ({ fillRect() {}, fillStyle: '' }),
  };
}

describe('JS animation context dispose', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { location: { origin: 'http://app', pathname: '/index.html' } });
    vi.stubGlobal('document', {
      createElement: (tag: string) => fakeElement(tag),
      body: { appendChild: vi.fn() },
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const page = { htmlCode: '<html><head></head><body></body></html>', animationType: 'threejs' } as any;

  it('removes the iframe and frees the page once', () => {
    const context = createJSAnimationContext('anim-1', page);
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
});
