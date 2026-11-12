import { describe, expect, it } from 'vitest';
import { isCaptionPress, type CaptionBar, type CaptionTarget } from './windowCaption';

/**
 * An element and its ancestors, nearest first, each a selector it matches.
 * Entries before `header` sit inside the bar; `header` is the bar; the rest
 * are outside it.
 */
function el(...chain: string[]): { target: CaptionTarget; bar: CaptionBar } {
  const nodes = chain.map((tag, depth) => ({ tag, depth }));
  const barDepth = chain.indexOf('header');
  return {
    target: {
      closest: (selector: string) => {
        const wanted = selector.split(',').map((s) => s.trim());
        return nodes.find((n) => wanted.includes(n.tag)) ?? null;
      },
    },
    bar: { contains: (node: never) => (node as { depth: number }).depth <= barDepth },
  };
}
const press = (chain: string[], inScrollbar = false) => {
  const { target, bar } = el(...chain);
  return isCaptionPress(target, bar, inScrollbar);
};

describe('a full-screen view top bar as the title bar', () => {
  it('moves and maximizes from empty space, a title or a group background', () => {
    expect(press(['header'])).toBe(true);
    expect(press(['span', 'header'])).toBe(true);
    expect(press(['div', 'header'])).toBe(true);
  });

  it('still does when the view around the bar is a dialog', () => {
    expect(press(['header', '[role="dialog"]'])).toBe(true);
    expect(press(['span', 'header', '[role="dialog"]'])).toBe(true);
  });

  it('never from a control in the bar, or anything inside one', () => {
    expect(press(['button', 'header'])).toBe(false);
    expect(press(['svg', 'button', 'header'])).toBe(false);
    expect(press(['select', 'header', '[role="dialog"]'])).toBe(false);
    expect(press(['span', '[role="dialog"]', 'header'])).toBe(false);
    expect(press(['div', '[data-no-caption]', 'header'])).toBe(false);
  });

  it('never from the bar scrollbar, or with no target', () => {
    expect(press(['header'], true)).toBe(false);
    expect(isCaptionPress(null, { contains: () => true })).toBe(false);
  });
});
