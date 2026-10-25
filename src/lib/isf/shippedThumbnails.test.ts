import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { shaderThumbnailKey } from './thumbnail';

// The library ships its thumbnails (public/ISF/thumbs) so opening the VJ
// library compiles nothing. A shader added or edited without regenerating
// them would quietly go back to compiling in the background.
it('ships a thumbnail for every library shader', () => {
  const isf = join(process.cwd(), 'public', 'ISF');
  const manifest = JSON.parse(readFileSync(join(isf, 'manifest.json'), 'utf8'));
  const files: string[] = manifest.version === 2 ? manifest.shaders.map((s: { file: string }) => s.file) : manifest.shaders;
  const index: Record<string, string> = JSON.parse(readFileSync(join(isf, 'thumbs', 'index.json'), 'utf8'));
  const missing = files.filter((file) => {
    const key = shaderThumbnailKey(readFileSync(join(isf, file), 'utf8'));
    return !index[key] || !existsSync(join(isf, 'thumbs', index[key]));
  });
  expect(missing, 'Regenerate with: node scripts/build-isf-thumbnails.mjs --cdp <port> (see the script)').toEqual([]);
});
