import { describe, expect, it } from 'vitest';
import { bayPlacement, keepInWindow } from './cablePatching';

const view = { width: 1440, height: 900 };

describe('the patch bay', () => {
  it('opens centred over the output, under its top edge', () => {
    const p = bayPlacement({ left: 400, top: 100, width: 700 }, view);
    expect(p.width).toBe(620);
    expect(p.left + p.width / 2).toBe(750);
    expect(p.top).toBe(134);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(view.height - 8);
  });

  it('stays inside a narrow or short window', () => {
    const p = bayPlacement({ left: -50, top: 700, width: 300 }, { width: 320, height: 760 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + p.width).toBeLessThanOrEqual(312);
    // Too near the bottom for a list: it moves up to keep room.
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(752);
    expect(p.maxHeight).toBeGreaterThanOrEqual(200);
  });

  it('opens at the top of the window with no output to sit over', () => {
    const p = bayPlacement(null, view);
    expect(p.top).toBe(8);
    expect(p.left).toBe((view.width - 620) / 2);
  });
});

describe('a cable popover', () => {
  it('opens at the pointer when it fits', () => {
    expect(keepInWindow({ x: 100, y: 120 }, { width: 280, height: 200 }, view)).toEqual({ x: 100, y: 120 });
  });

  it('moves back inside the window near an edge', () => {
    expect(keepInWindow({ x: 1400, y: 880 }, { width: 280, height: 200 }, view)).toEqual({ x: 1152, y: 692 });
    expect(keepInWindow({ x: -20, y: -5 }, { width: 280, height: 200 }, view)).toEqual({ x: 8, y: 8 });
  });
});
