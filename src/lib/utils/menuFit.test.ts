import { describe, expect, it } from 'vitest';
import { menuMaxHeight } from './menuFit';

describe('menuMaxHeight', () => {
  it('ends the menu a margin above the window bottom', () => {
    // macOS: 30 px title strip + 52 px toolbar + 4 px gap.
    expect(menuMaxHeight(86, 700)).toBe(606);
    expect(menuMaxHeight(86, 700, 12)).toBe(602);
  });

  it('keeps a usable minimum in a very short window', () => {
    expect(menuMaxHeight(86, 200)).toBe(160);
    expect(menuMaxHeight(86, 200, 8, 100)).toBe(106);
  });

  it('treats a menu above the window top as starting at the top', () => {
    expect(menuMaxHeight(-40, 500)).toBe(492);
  });
});
