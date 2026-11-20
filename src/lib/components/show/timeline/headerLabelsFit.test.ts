import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Translated labels must fit: in German the Audio header's "Auto-Show"
 * button was cut at the column edge (Japanese: 自), and Perform's "キュー"
 * (Cues) label broke onto two lines. The header's title gives way first (it
 * ellipsizes) so its buttons stay whole; the eyebrow never wraps.
 */
const dir = join(process.cwd(), 'src', 'lib', 'components', 'show', 'timeline');
const css = (file: string, selector: string) => {
  const src = readFileSync(join(dir, file), 'utf8');
  const style = src.slice(src.indexOf('<style'));
  const at = style.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return style.slice(at, style.indexOf('}', at));
};

describe('header labels fit in every language', () => {
  it('a row section header\'s title shrinks before its buttons are cut', () => {
    const fold = css('RowSectionHeader.svelte', '.rsh-fold');
    expect(fold).toMatch(/flex:\s*0 1 auto/);
    expect(fold).toMatch(/min-width:\s*0/);
    expect(css('RowSectionHeader.svelte', '.rsh-title')).toMatch(/min-width:\s*0/);
  });

  it('the Perform list\'s eyebrow stays on one line', () => {
    expect(css('perform/PerformPanel.svelte', '.pf-eyebrow')).toMatch(/white-space:\s*nowrap/);
  });
});
