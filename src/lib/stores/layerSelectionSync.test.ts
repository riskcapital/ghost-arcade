import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { selectionForPrimary } from './layerSelection';

describe('multi-selection follows the primary selection', () => {
  it('a newly selected layer outside the multi-selection replaces it', () => {
    // Clicked "clip", then Add Layer -> Custom Shape selected "shape".
    expect(selectionForPrimary('shape', ['clip'])).toEqual(['shape']);
    expect(selectionForPrimary('shape', [])).toEqual(['shape']);
  });

  it('leaves a genuine multi-selection and a cleared primary alone', () => {
    expect(selectionForPrimary('a', ['a', 'b'])).toBeNull();
    expect(selectionForPrimary(null, ['a'])).toBeNull();
  });

  it('is wired to the project store', () => {
    // Importing layers.ts needs a DOM, so check the wiring at source level.
    const source = readFileSync(join(process.cwd(), 'src', 'lib', 'stores', 'layers.ts'), 'utf8');
    expect(source).toMatch(/project\.subscribe\(\(\$project\) => \{\s*const next = selectionForPrimary\(\$project\.selectedLayerId, get\(selectedLayerIdsState\)\);\s*if \(next\) selectedLayerIdsState\.set\(next\);/);
  });
});
