import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A legacy `export let` prop is a derived per component instance. On the VJ
 * deck's layer settings the column count's derived stayed subscribed to the
 * deck store after its row was destroyed, so every redraw of the deck kept
 * the old rows' DOM alive (the soak test's editor leak). These components
 * take runes props, which are plain getters.
 */
describe('VJ layer settings props', () => {
  for (const file of ['VJLayerSettings.svelte', 'VJAutopilotControls.svelte']) {
    it(`${file} takes runes props`, () => {
      const source = readFileSync(join(process.cwd(), 'src/lib/components', file), 'utf8');
      expect(source).toMatch(/\$props\(\)/);
      expect(source).not.toMatch(/^\s*export let /m);
    });
  }
});
