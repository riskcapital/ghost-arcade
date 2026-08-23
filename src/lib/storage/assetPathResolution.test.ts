/**
 * Asset path resolution, and specifically which strings are paths.
 *
 * `resolveAssetRefForRuntime`'s legacy branch exists for projects saved before
 * AssetRef shipped, where a media src was a bare relative path to be joined to
 * the .gha's folder. The danger is what counts as "bare": the scheme check used
 * to be an allowlist of four (https, blob, data, ghost-asset), so every other
 * scheme fell through and was joined to the project directory.
 *
 * Found by opening a real 1.9.3 project: `builtin:grid` came back as
 * `<projectDir>/builtin:grid`, and re-saving persisted it. Shader sources
 * survived that because they carry inline shaderCode, but a live source has no
 * fallback — `live://webcam/<session>` is the whole definition, and
 * nativeLiveSourceType() recognises it by that exact prefix. Mangle the prefix
 * and a saved webcam, Spout or NDI clip stops being a live source at all.
 */

import { describe, expect, it } from 'vitest';
import { resolveAssetRefForRuntime } from './assetRegistry';

const PROJECT_DIR = '/Users/vj/Shows/Tour/';

describe('resolveAssetRefForRuntime — scheme handling', () => {
  it('passes through every URI scheme untouched', () => {
    // The four that were allowlisted...
    for (const src of [
      'https://example.com/clip.mp4',
      'http://example.com/clip.mp4',
      'blob:null/abc-123',
      'data:image/png;base64,iVBORw0KG',
      'ghost-asset://localhost/Users/vj/clip.mp4',
    ]) {
      expect(resolveAssetRefForRuntime(null, PROJECT_DIR, src), src).toBe(src);
    }

    // ...and the ones that were not, which is the bug.
    for (const src of [
      'builtin:grid',
      'live://webcam/1f0c-4a2b',
      'live://capture/screen-2',
      'live://spout/Resolume',
      'live://ndi/Studio',
      'library-shader:SM-ParticleNodes',
      'generated://text/layer-7/atlas',
    ]) {
      expect(resolveAssetRefForRuntime(null, PROJECT_DIR, src), src).toBe(src);
    }
  });

  it('still treats bare relative paths as project-relative', () => {
    const resolved = resolveAssetRefForRuntime(null, PROJECT_DIR, './clips/intro.mp4');
    expect(resolved).toContain('clips/intro.mp4');
    expect(resolved).not.toContain('./clips');
  });

  it('treats a Windows drive letter as a path, not a scheme', () => {
    // `C:` matches a naive scheme test. Schemes are two or more characters,
    // drives are exactly one — which is what keeps these apart.
    const resolved = resolveAssetRefForRuntime(null, PROJECT_DIR, 'C:\\Media\\clip.mp4');
    expect(resolved).toBeTruthy();
    expect(resolved).not.toContain(PROJECT_DIR);
  });

  it('prefers the AssetRef over any fallback src', () => {
    const resolved = resolveAssetRefForRuntime(
      { projectPath: './media/clip.mp4' } as never,
      PROJECT_DIR,
      'live://webcam/should-be-ignored',
    );
    expect(resolved).toContain('media/clip.mp4');
  });
});
