import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The clip visuals editor's Blend and Follows selects are 22 px tall, and the
 * app's select style pads them 5 px top and bottom: the text ("Normal",
 * "Kick") was cut off at the bottom. They keep the side padding and drop the
 * vertical one.
 */
describe('clip visuals editor selects', () => {
  it('pad only the sides at 22 px', () => {
    const src = readFileSync(join(process.cwd(), 'src', 'lib', 'components', 'music', 'ClipStackEditor.svelte'), 'utf8');
    const style = src.slice(src.indexOf('<style'));
    const rule = style.slice(style.indexOf('\n  select {'), style.indexOf('}', style.indexOf('\n  select {')));
    expect(rule).toMatch(/height: var\(--ga-control-h-sm, 22px\)/);
    expect(rule).toMatch(/padding-top: 0/);
    expect(rule).toMatch(/padding-bottom: 0/);
  });
});
