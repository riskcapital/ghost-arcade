import { describe, expect, it, vi } from 'vitest';
import { physicalOutputWindowArgs, physicalOutputWindowConfig } from '../../../electron/output-window-placement.js';

// A 150% 4K laptop panel (primary) and a 100% 1080p projector to its right.
// Electron gives the projector DIP bounds starting at the panel's DIP width;
// physically it starts at the panel's pixel width.
function dipToScreenRect(rect: { x: number; y: number; width: number; height: number }) {
  if (rect.x >= 2560) return { x: rect.x - 2560 + 3840, y: rect.y, width: rect.width, height: rect.height };
  return { x: rect.x * 1.5, y: rect.y * 1.5, width: rect.width * 1.5, height: rect.height * 1.5 };
}

describe('Live Output placement on Windows', () => {
  it('sends a fullscreen projector rect in physical pixels', () => {
    const config = { attached: true, fullscreen: true, x: 2560, y: 0, width: 1920, height: 1080, title: 'Out' };
    expect(physicalOutputWindowConfig(config, dipToScreenRect)).toEqual({
      ...config, x: 3840, y: 0, width: 1920, height: 1080, coordinate_space: 'physical',
    });
  });

  it('converts a window on the scaled panel with that panel\'s scale', () => {
    const out = physicalOutputWindowConfig({ x: 640, y: 360, width: 1280, height: 720 }, dipToScreenRect);
    expect(out).toMatchObject({ x: 960, y: 540, width: 1920, height: 1080, coordinate_space: 'physical' });
  });

  it('leaves a detach or a partial update alone', () => {
    const convert = vi.fn(dipToScreenRect);
    const detach = { attached: false, visible: false };
    expect(physicalOutputWindowConfig(detach, convert)).toBe(detach);
    const partial = { width: 1280, height: 720 };
    expect(physicalOutputWindowConfig(partial, convert)).toBe(partial);
    expect(convert).not.toHaveBeenCalled();
  });

  it('does not convert twice', () => {
    const config = { x: 3840, y: 0, width: 1920, height: 1080, coordinate_space: 'physical' };
    expect(physicalOutputWindowConfig(config, dipToScreenRect)).toBe(config);
  });

  it('rewrites the IPC payload the renderer sends', () => {
    const args = { config: { fullscreen: true, x: 2560, y: 0, width: 1920, height: 1080 } };
    expect(physicalOutputWindowArgs(args, dipToScreenRect).config).toMatchObject({ x: 3840, coordinate_space: 'physical' });
    const detach = { config: { attached: false } };
    expect(physicalOutputWindowArgs(detach, dipToScreenRect)).toBe(detach);
  });
});
