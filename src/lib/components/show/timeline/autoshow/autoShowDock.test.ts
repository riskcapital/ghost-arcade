import { describe, expect, it } from 'vitest';
import { autoShowDockInset } from './autoShowUi';

describe('the docked "Playing your show" card', () => {
  const viewport = { width: 1920, height: 1131 };
  it('sits over the grid, clear of the side column and the status bar', () => {
    const side = { left: 1320, top: 396, right: 1920, bottom: 1101 };
    const statusbar = { left: 0, top: 1101, right: 1920, bottom: 1131 };
    expect(autoShowDockInset(viewport, side, statusbar)).toEqual({ right: 616, bottom: 46 });
  });
  it('without them, the window corner', () => {
    expect(autoShowDockInset(viewport, null, null)).toEqual({ right: 16, bottom: 16 });
  });
});
