import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The app's button skin sets every .text-btn's colours with !important, so a
 * component's own `.text-btn.on` never showed: Audio Lab's Cables, Mixer and
 * favourites buttons looked the same on and off. An "on" chip gets the same
 * pressed colours as aria-pressed="true".
 */
const css = readFileSync(join(process.cwd(), 'src', 'lib', 'theming', 'studio-skin.css'), 'utf8');

describe('the button skin shows a switched-on .text-btn', () => {
  it('styles .text-btn.on like a pressed toggle', () => {
    const at = css.indexOf('/* A plain chip that is switched on');
    expect(at).toBeGreaterThanOrEqual(0);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toMatch(/:is\([^)]*\.text-btn[^)]*\)\.on\b/);
    expect(rule).toMatch(/background: var\(--ga-selection-bg\) !important/);
  });
});
