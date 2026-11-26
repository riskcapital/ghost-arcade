import { afterEach, describe, expect, it, vi } from 'vitest';
import { isUsableSvgSource } from './svgSourceCheck';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1"/></svg>';

afterEach(() => vi.unstubAllGlobals());

/** The browser's parser, reduced to what the check reads. */
function stubParser(result: { root: string; error: boolean }) {
  vi.stubGlobal('DOMParser', class {
    parseFromString() {
      return {
        documentElement: { localName: result.root },
        getElementsByTagName: (name: string) => (name === 'parsererror' && result.error ? [{}] : []),
      };
    }
  });
}

describe('isUsableSvgSource', () => {
  it('accepts an SVG', () => {
    expect(isUsableSvgSource(SVG)).toBe(true);
    expect(isUsableSvgSource('﻿<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toBe(true);
  });

  it('turns down text that is not an SVG', () => {
    expect(isUsableSvgSource('')).toBe(false);
    expect(isUsableSvgSource('hello')).toBe(false);
    expect(isUsableSvgSource('<html><body></body></html>')).toBe(false);
  });

  it('turns down XML the browser cannot read', () => {
    stubParser({ root: 'svg', error: true });
    expect(isUsableSvgSource(SVG)).toBe(false);
  });

  it('turns down a document whose root is not an svg', () => {
    stubParser({ root: 'html', error: false });
    expect(isUsableSvgSource('<html><svg></svg></html>')).toBe(false);
  });

  it('accepts what the browser reads as an svg', () => {
    stubParser({ root: 'svg', error: false });
    expect(isUsableSvgSource(SVG)).toBe(true);
  });
});
