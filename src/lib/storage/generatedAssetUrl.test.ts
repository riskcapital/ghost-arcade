import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAssetRefFromGeneratedBlob } from './assetRegistry';

/**
 * A generated asset written to disk used to get an object URL made before the
 * write; callers that play the saved file never revoked it, so every looper
 * layer leaked a blob. preferFile hands back the file URL and makes none.
 */
describe('createAssetRefFromGeneratedBlob', () => {
  const made: string[] = [];
  function electron(success: boolean) {
    (globalThis as any).window = { __ELECTRON__: true, electronAPI: { invoke: async () => (success ? { success: true, path: '/assets/a.wav' } : { success: false }) } };
    (globalThis as any).URL.createObjectURL = vi.fn(() => { made.push('x'); return `blob:${made.length}`; });
  }
  afterEach(() => { delete (globalThis as any).window; made.length = 0; });

  it('makes no object URL for a file-preferring caller once the file is on disk', async () => {
    electron(true);
    const c = await createAssetRefFromGeneratedBlob(new Blob(['x']), 'a.wav', 'audio/wav', undefined, { preferFile: true });
    expect(made).toHaveLength(0);
    expect(c.runtimeUrl).not.toMatch(/^blob:/);
    expect(c.assetRef.originalPath).toBe('/assets/a.wav');
  });

  it('still gives other callers a preview URL, and keeps one they brought', async () => {
    electron(true);
    expect((await createAssetRefFromGeneratedBlob(new Blob(['x']), 'a.png')).runtimeUrl).toBe('blob:1');
    expect((await createAssetRefFromGeneratedBlob(new Blob(['x']), 'a.png', undefined, 'blob:mine')).runtimeUrl).toBe('blob:mine');
    expect(made).toHaveLength(1);
  });
});
