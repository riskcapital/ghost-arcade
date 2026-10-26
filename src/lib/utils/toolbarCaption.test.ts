import { describe, expect, it } from 'vitest';
import { isToolbarCaption, type CaptionElement } from './toolbarCaption';

function el(classes: string, parent: CaptionElement | null = null): CaptionElement {
  const own = classes.split(/\s+/).filter(Boolean);
  return {
    parentElement: parent,
    matches(selector: string) {
      return selector.split(',').some((part) => {
        const name = part.trim().replace(/^\./, '');
        return own.includes(name);
      });
    },
  };
}

describe('isToolbarCaption', () => {
  const bar = el('toolbar');
  const left = el('toolbar-left', bar);
  const center = el('toolbar-center', bar);
  const right = el('toolbar-right', bar);
  const logo = el('header-logo', left);
  const fileMenu = el('file-menu-container', left);
  const dropdown = el('file-menu-dropdown', fileMenu);
  const separator = el('menu-separator', dropdown);
  const sectionLabel = el('menu-section-label', dropdown);
  const meter = el('amp-strip', right);
  const popover = el('amp-popover', meter);
  const popoverTitle = el('amp-popover-title', popover);
  const button = el('output-btn', center);

  it('moves the window from the bar background and its group rows', () => {
    expect(isToolbarCaption(bar, bar)).toBe(true);
    expect(isToolbarCaption(left, bar)).toBe(true);
    expect(isToolbarCaption(center, bar)).toBe(true);
    expect(isToolbarCaption(right, bar)).toBe(true);
    expect(isToolbarCaption(logo, bar)).toBe(true);
  });

  it('never moves the window from inside a menu or popover', () => {
    expect(isToolbarCaption(dropdown, bar)).toBe(false);
    expect(isToolbarCaption(separator, bar)).toBe(false);
    expect(isToolbarCaption(sectionLabel, bar)).toBe(false);
    expect(isToolbarCaption(popover, bar)).toBe(false);
    expect(isToolbarCaption(popoverTitle, bar)).toBe(false);
  });

  it('never moves the window from a control', () => {
    expect(isToolbarCaption(button, bar)).toBe(false);
    expect(isToolbarCaption(fileMenu, bar)).toBe(false);
    expect(isToolbarCaption(meter, bar)).toBe(false);
  });

  it('ignores elements outside the bar', () => {
    const other = el('toolbar-left', el('somewhere-else'));
    expect(isToolbarCaption(other, bar)).toBe(false);
    expect(isToolbarCaption(null, bar)).toBe(false);
    expect(isToolbarCaption(bar, null)).toBe(false);
  });
});
