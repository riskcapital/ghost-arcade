import { describe, expect, it, vi } from 'vitest';
import { LightPaintingWebGLRenderer } from './webglRenderer';

describe('light painting WebGL renderer', () => {
  it('gives its WebGL2 context back on dispose', () => {
    const loseContext = vi.fn();
    // Every gl.delete* call is a no-op; only the extension matters here.
    const gl = new Proxy({} as Record<string, unknown>, {
      get: (_t, prop) => (prop === 'getExtension'
        ? (name: string) => (name === 'WEBGL_lose_context' ? { loseContext } : null)
        : () => {}),
    });
    const rt = { tex: {}, fb: {} };
    const r: any = Object.create(LightPaintingWebGLRenderer.prototype);
    Object.assign(r, {
      gl,
      committedRT: rt, currentRT: rt, workRT: rt, finalRT: rt, persistRT: rt, bloomRT_A: rt, bloomRT_B: rt,
      texture: { dispose: vi.fn() },
    });
    r.dispose();
    expect(r.texture.dispose).toHaveBeenCalledTimes(1);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
});
